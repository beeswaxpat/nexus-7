// Turns a free-text query (symbol, name, CoinGecko id, ticker, or DEX address) into
// a single canonical AssetDescriptor, returning candidates[] when a search is
// ambiguous. Signature is FROZEN.
//
// Resolution strategy (reconciles the plan's "crypto preferred" with the spec's
// explicit stock defaults MSTR/STRC, which are Yahoo equities). The key subtlety:
// CoinGecko lists same-symbol crypto tokens for real tickers (e.g. searching "MSTR"
// returns mstr2100 and tokenized-stock derivatives), so a naive CoinGecko-first order
// would hand back a meme coin when the friend meant the stock. We therefore:
//
//   1. DEX contract address (0x... EVM, or a long base58 Solana mint) -> DexScreener
//      directly. These never appear in CoinGecko's /search.
//
//   2. If the query looks like a stock ticker, try Yahoo FIRST, but accept it ONLY if
//      Yahoo classifies it as a real security (equity/etf/fund/index) with a live
//      price (yahoo.resolveStock). A genuine equity (MSTR, STRC, AAPL) wins here; a
//      crypto symbol that merely happens to exist on Yahoo as a *-USD pair is rejected
//      and falls through to CoinGecko. Yahoo unreachable (rate limit) -> also falls
//      through, so resolution degrades to crypto rather than failing. When the stock
//      DOES resolve we still best-effort searchCoins(q) and append those as candidates
//      AFTER the stock, so a symbol that is both (STRK = Strategy's Strike preferred
//      AND Starknet) lists both in the picker, stock first.
//
//   3. CoinGecko /search. An exact symbol or id match wins outright (XRP ->
//      coingecko:ripple, SOL -> coingecko:solana, plasma/aleo/thena/hyperliquid);
//      otherwise the best fuzzy hit is returned with the rest as candidates.
//
//   4. DexScreener search as a last resort for DEX-only tokens referenced by name.

import type { AssetDescriptor, ResolveResult } from '../../shared/types';
import { searchCoins } from './adapters/coingecko';
import { resolveStock } from './adapters/yahoo';
import { resolveBestPair, searchToken } from './adapters/dexscreener';

/** EVM contract address: 0x + 40 hex. */
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** Solana mint / other base58 address: 32-44 base58 chars (no 0 O I l). */
const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * Stock-ticker shape: 1-6 letters, optionally with a class/exchange suffix like
 * BRK.B or RDS-A. Used to decide whether Yahoo is worth trying first.
 */
const STOCK_TICKER = /^[A-Za-z]{1,6}([.\-][A-Za-z]{1,3})?$/;

/** A bare symbol with no class/exchange suffix (e.g. XRP, ETH): letters only. */
const BARE_SYMBOL = /^[A-Za-z]{1,6}$/;

function looksLikeDexAddress(q: string): boolean {
  return EVM_ADDRESS.test(q) || BASE58_ADDRESS.test(q);
}

function looksLikeStockTicker(q: string): boolean {
  return STOCK_TICKER.test(q);
}

function isBareSymbol(q: string): boolean {
  return BARE_SYMBOL.test(q);
}

/** The 'id' half of a 'coingecko:<id>' key. */
function coingeckoId(descriptor: AssetDescriptor): string {
  const idx = descriptor.key.indexOf(':');
  return idx < 0 ? descriptor.key : descriptor.key.slice(idx + 1);
}

/**
 * An exact CoinGecko match for the query: the query equals the coin's id or symbol
 * (case-insensitive). ID match is checked FIRST and wins, because ids are unique and
 * canonical while symbols are not: scam tokens register a symbol equal to a popular
 * coin's NAME (e.g. a token with symbol "ETHEREUM"), which would otherwise shadow the
 * real coin (id "ethereum", symbol "ETH"). For pure symbols like XRP/SOL there is no
 * id collision, so the symbol pass still resolves them (XRP -> ripple, SOL -> solana).
 * CoinGecko /search returns results by market-cap relevance, so the first matching
 * entry in each pass is the most legitimate one.
 */
function exactCoinMatch(query: string, coins: AssetDescriptor[]): AssetDescriptor | null {
  const q = query.toLowerCase();
  for (const c of coins) if (coingeckoId(c).toLowerCase() === q) return c;
  for (const c of coins) if (c.symbol.toLowerCase() === q) return c;
  return null;
}

/** Resolve a user query to a single asset (or candidates / error). */
export async function resolveAsset(query: string): Promise<ResolveResult> {
  const q = query.trim();
  if (!q) return { ok: false, error: 'Empty query' };

  // 1) DEX contract address -> DexScreener directly.
  if (looksLikeDexAddress(q)) {
    try {
      const descriptor = await resolveBestPair(q);
      if (descriptor) return { ok: true, descriptor };
      return { ok: false, error: 'No DEX pair found for that address' };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  // 2) Stock-ticker-shaped query -> Yahoo first, securities only. If it resolves,
  // also pull any same-symbol crypto coins so dual-listed tickers offer both in the
  // picker.
  //
  // Subtlety: spot-crypto ETFs now trade under the BARE crypto ticker (XRP -> Bitwise
  // XRP ETF, ETH -> Grayscale ETH trust), so a Yahoo-first short-circuit would hand
  // back the ETF as the primary pick when the user meant the coin. We therefore demote
  // the Yahoo security to a candidate (crypto becomes primary) when, AND ONLY when, the
  // bare-symbol query's exact CoinGecko match is also that symbol's TOP relevance hit
  // (coins[0]). CoinGecko /search ranks by market-cap relevance, so an exact match that
  // is coins[0] is the dominant coin for the symbol (XRP->ripple, ETH->ethereum,
  // ADA->cardano, SOL->solana, STRK->starknet). A genuine equity has no exact crypto
  // match (STRC, AAPL) or only a low-relevance same-symbol meme that is NOT coins[0]
  // (MSTR -> mstr2100, while coins[0] is microstrategy-xstock), so the stock stays
  // primary and the spec's MSTR/STRC stock defaults are preserved.
  if (looksLikeStockTicker(q)) {
    const stock = await resolveStock(q);
    if (stock) {
      let coins: AssetDescriptor[] = [];
      try {
        coins = await searchCoins(q);
      } catch {
        // ignore: crypto candidates are a best-effort add-on; the stock stands alone
      }
      // Stock keys (yahoo:) and coin keys (coingecko:) are namespaced, so the merged candidate list needs no cross-list dedupe.
      const exact = isBareSymbol(q) ? exactCoinMatch(q, coins) : null;
      if (exact && coins[0] && coins[0].key === exact.key) {
        // Dominant crypto for a bare ticker: it leads, the same-ticker stock follows.
        return { ok: true, descriptor: exact, candidates: [exact, stock, ...coins.filter((c) => c.key !== exact.key)] };
      }
      return { ok: true, descriptor: stock, candidates: [stock, ...coins] };
    }
  }

  // 3) CoinGecko search (crypto). Exact symbol/id wins; else best fuzzy hit.
  let cgError: string | null = null;
  try {
    const coins = await searchCoins(q);
    if (coins.length > 0) {
      const exact = exactCoinMatch(q, coins);
      return { ok: true, descriptor: exact ?? coins[0], candidates: coins };
    }
  } catch (err) {
    cgError = err instanceof Error ? err.message : String(err);
  }

  // 4) DexScreener search as a last resort (DEX-only tokens by name/symbol).
  try {
    const dex = await searchToken(q);
    if (dex.length > 0) {
      return { ok: true, descriptor: dex[0], candidates: dex };
    }
  } catch {
    // ignore: fall through to the no-match result below
  }

  return { ok: false, error: cgError ?? `No matches for "${q}"` };
}
