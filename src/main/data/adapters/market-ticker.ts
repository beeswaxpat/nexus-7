// Market ticker adapter: top coins by market cap for the bottom marquee.
// CoinGecko /coins/markets, minus the stablecoin/wrapped denylist (and any id
// beginning with `wrapped-`). Signature is FROZEN.

import type { TickerCoin } from '../../../shared/types';
import { TICKER_DENYLIST, TICKER_MAX } from '../../../shared/constants';
import { httpJson } from '../http';

const MARKETS_URL =
  'https://api.coingecko.com/api/v3/coins/markets' +
  '?vs_currency=usd&order=market_cap_desc&per_page=60&page=1&sparkline=false';

/** Subset of the CoinGecko /coins/markets row we read. */
interface MarketRow {
  id: string;
  symbol: string;
  name: string;
  current_price: number | null;
  price_change_percentage_24h: number | null;
}

const denied = new Set(TICKER_DENYLIST);

/** Symbol fragments that mark a fiat stablecoin (USD1, USDG, USDY, FDUSD, DAI...). */
const STABLE_SYM = /usd|dai|frax|usde|fdusd|pyusd|gusd|tusd|usdp|usds|eurc|eurs|crvusd|lusd|susd|buidl/i;

/**
 * True for stablecoins / wrapped tokens we exclude from the ticker. Catches the
 * denylist, anything wrapped-*, any USD/EUR-pegged symbol or name, and anything
 * sitting on a tight $1 peg (so new stables like USD1/USDG/USDY drop out too).
 * Gold-backed tokens (PAXG, XAUT ~ $4k) are NOT pegged to $1, so they stay.
 */
function isExcluded(row: MarketRow): boolean {
  if (denied.has(row.id) || row.id.startsWith('wrapped-')) return true;
  const sym = (row.symbol ?? '').toLowerCase();
  const name = (row.name ?? '').toLowerCase();
  if (STABLE_SYM.test(sym)) return true;
  if (name.includes('usd') || name.includes('dollar') || name.includes('stablecoin')) return true;
  const p = row.current_price;
  if (typeof p === 'number' && p >= 0.99 && p <= 1.01) return true; // $1 peg
  return false;
}

/** Top coins by market cap for the bottom marquee (stables/wrapped excluded). */
export async function fetchTicker(): Promise<TickerCoin[]> {
  const rows = await httpJson<MarketRow[]>(MARKETS_URL);
  if (!Array.isArray(rows)) return [];

  const out: TickerCoin[] = [];
  for (const row of rows) {
    if (out.length >= TICKER_MAX) break;
    if (!row || typeof row.id !== 'string') continue;
    if (isExcluded(row)) continue;
    if (typeof row.current_price !== 'number') continue;

    out.push({
      symbol: (row.symbol ?? '').toUpperCase(),
      price: row.current_price,
      change24h: typeof row.price_change_percentage_24h === 'number' ? row.price_change_percentage_24h : 0
    });
  }
  return out;
}
