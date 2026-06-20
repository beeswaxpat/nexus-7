// DexScreener adapter. Fallback resolver for arbitrary DEX-only tokens a friend
// adds (anything CoinGecko does not list). Search returns candidate pairs; we
// resolve the highest-liquidity pair into a canonical descriptor (and, for the
// scheduler, an AssetQuote). h24 only: DexScreener has no 7d, so change7d is null,
// and marketCap falls back to fdv when null. Pairs are resolved at add time, never
// hardcoded. Signatures are FROZEN.

import type { AssetDescriptor, AssetQuote } from '../../../shared/types';
import { httpJson } from '../http';

const SOURCE = 'dexscreener';
const SEARCH_URL = 'https://api.dexscreener.com/latest/dex/search?q=';
const PAIR_URL = 'https://api.dexscreener.com/latest/dex/pairs';

/** Subset of the DexScreener /latest/dex/search response we read. */
interface DexToken {
  address?: string;
  name?: string;
  symbol?: string;
}

interface DexPair {
  chainId?: string;
  pairAddress?: string;
  baseToken?: DexToken;
  priceUsd?: string;
  priceChange?: { h24?: number };
  liquidity?: { usd?: number };
  marketCap?: number;
  fdv?: number;
}

interface DexSearchResponse {
  pairs?: DexPair[] | null;
}

/** USD liquidity of a pair, defaulting to 0 so partial/empty pairs sort last. */
function liquidityUsd(p: DexPair): number {
  const v = p.liquidity?.usd;
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** A pair is usable only if it has the identifiers we key and display on. */
function isUsablePair(p: DexPair): boolean {
  return Boolean(p.chainId && p.pairAddress && p.baseToken?.symbol);
}

/** Canonical key for a DEX pair: 'dexscreener:<chainId>/<pairAddress>'. */
function pairKey(p: DexPair): string {
  return `${SOURCE}:${p.chainId}/${p.pairAddress}`;
}

/** Fetch the raw search results for a query (empty list on no/blank match). */
async function search(q: string): Promise<DexPair[]> {
  const query = q.trim();
  if (!query) return [];
  const data = await httpJson<DexSearchResponse>(SEARCH_URL + encodeURIComponent(query));
  const pairs = Array.isArray(data.pairs) ? data.pairs : [];
  return pairs.filter(isUsablePair);
}

/** The single highest-liquidity usable pair for a query, or null if none. */
async function bestPair(q: string): Promise<DexPair | null> {
  const pairs = await search(q);
  if (pairs.length === 0) return null;
  return pairs.reduce((best, p) => (liquidityUsd(p) > liquidityUsd(best) ? p : best));
}

/** Map a DexScreener pair onto the canonical AssetDescriptor shape. */
function toDescriptor(p: DexPair): AssetDescriptor {
  return {
    key: pairKey(p),
    symbol: p.baseToken?.symbol ?? '',
    name: p.baseToken?.name ?? p.baseToken?.symbol ?? '',
    kind: 'crypto',
    source: SOURCE,
    pairAddress: p.pairAddress,
    chainId: p.chainId
  };
}

/** Map a DexScreener pair onto the unified AssetQuote row shape. */
function toQuote(p: DexPair): AssetQuote {
  const price = Number(p.priceUsd);
  const cap = p.marketCap ?? p.fdv ?? null;
  // isUsablePair upstream guarantees baseToken.symbol, so the '' fallbacks below are defensive.
  return {
    key: pairKey(p),
    symbol: p.baseToken?.symbol ?? '',
    name: p.baseToken?.name ?? p.baseToken?.symbol ?? '',
    kind: 'crypto',
    price: Number.isFinite(price) ? price : null,
    change24h: typeof p.priceChange?.h24 === 'number' ? p.priceChange.h24 : null,
    change7d: null, // DexScreener does not provide 7d
    marketCap: typeof cap === 'number' && Number.isFinite(cap) ? cap : null,
    source: SOURCE,
    stale: false,
    asOf: Date.now()
  };
}

/** Search DEX tokens by name/symbol/address. Returns candidate descriptors,
 * highest-liquidity first. */
export async function searchToken(q: string): Promise<AssetDescriptor[]> {
  const pairs = await search(q);
  return pairs.sort((a, b) => liquidityUsd(b) - liquidityUsd(a)).map(toDescriptor);
}

/** Pick the highest-liquidity pair for a query and return one descriptor. */
export async function resolveBestPair(q: string): Promise<AssetDescriptor | null> {
  const p = await bestPair(q);
  return p ? toDescriptor(p) : null;
}

/** Fetch a live AssetQuote for a query, mapping the highest-liquidity pair
 * (priceUsd, h24, marketCap||fdv). Used when a friend tracks a DEX-only token. */
export async function fetchQuote(q: string): Promise<AssetQuote | null> {
  const p = await bestPair(q);
  return p ? toQuote(p) : null;
}

/**
 * Refresh a single, already-resolved DEX pair by its canonical identifiers, with no
 * re-search (stable identity: the key never drifts to a different pair). chainId and
 * pairAddress come from a stored 'dexscreener:<chainId>/<pairAddress>' key. Returns a
 * fresh AssetQuote, or null if the pair no longer resolves. Never throws on a bad shape.
 */
export async function fetchQuoteByPair(
  chainId: string,
  pairAddress: string
): Promise<AssetQuote | null> {
  if (!chainId || !pairAddress) return null;
  const url = `${PAIR_URL}/${encodeURIComponent(chainId)}/${encodeURIComponent(pairAddress)}`;
  const data = await httpJson<DexSearchResponse & { pair?: DexPair | null }>(url);
  // The endpoint returns { pairs: [...] }; older shapes used { pair: {...} }.
  const p = (Array.isArray(data.pairs) ? data.pairs[0] : undefined) ?? data.pair ?? null;
  if (!p || !isUsablePair(p)) return null;
  return toQuote(p);
}
