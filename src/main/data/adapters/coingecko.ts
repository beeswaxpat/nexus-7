// CoinGecko adapter. Keyless public API. One batched /coins/markets call covers
// price, 24h%, 7d%, and market cap for the whole default crypto set; /search backs
// the asset resolver/picker. Uses httpJson from ../http (10s timeout + 1 retry).
// Signatures are FROZEN (see types.ts + asset-resolver.ts).

import type { AssetDescriptor, AssetQuote } from '../../../shared/types';
import { httpJson } from '../http';

const SOURCE = 'coingecko';
const API = 'https://api.coingecko.com/api/v3';

/** Raw row shape returned by /coins/markets (only the fields we consume). */
interface MarketRow {
  id: string;
  symbol: string;
  name: string;
  current_price: number | null;
  market_cap: number | null;
  price_change_percentage_24h_in_currency: number | null;
  price_change_percentage_7d_in_currency: number | null;
}

/** Raw coin shape inside /search -> coins[]. */
interface SearchCoin {
  id: string;
  name: string;
  symbol: string;
}

interface SearchResponse {
  coins?: SearchCoin[];
}

/** Map one /coins/markets row into the unified AssetQuote shape. */
function toQuote(row: MarketRow): AssetQuote {
  return {
    key: `${SOURCE}:${row.id}`,
    symbol: (row.symbol ?? '').toUpperCase(),
    name: row.name,
    kind: 'crypto',
    price: row.current_price ?? null,
    change24h: row.price_change_percentage_24h_in_currency ?? null,
    change7d: row.price_change_percentage_7d_in_currency ?? null,
    marketCap: row.market_cap ?? null,
    source: SOURCE,
    stale: false,
    asOf: Date.now()
  };
}

/** Batched markets call covering price, 24h%, 7d%, market cap for the given ids. */
export async function fetchMarkets(ids: string[]): Promise<AssetQuote[]> {
  if (ids.length === 0) return [];
  const params = new URLSearchParams({
    vs_currency: 'usd',
    ids: ids.join(','),
    price_change_percentage: '24h,7d',
    sparkline: 'false'
  });
  const rows = await httpJson<MarketRow[]>(`${API}/coins/markets?${params.toString()}`);
  return rows.map(toQuote);
}

/** Search CoinGecko coins by free-text query; used by the asset resolver/picker. */
export async function searchCoins(q: string): Promise<AssetDescriptor[]> {
  const query = q.trim();
  if (!query) return [];
  const params = new URLSearchParams({ query });
  const data = await httpJson<SearchResponse>(`${API}/search?${params.toString()}`);
  const coins = data.coins ?? [];
  return coins.map((c) => ({
    key: `${SOURCE}:${c.id}`,
    symbol: (c.symbol ?? '').toUpperCase(),
    name: c.name,
    kind: 'crypto' as const,
    source: SOURCE
  }));
}
