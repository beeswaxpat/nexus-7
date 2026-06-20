// Combined-portfolio math for the BTC strip BUG NUT cell (btc-stats.ts). Pure:
// reads the live quotes off ctx.store + the user's holdings off the settings
// cache (getCachedSettings, the same source asset-box renderTotal reads), and
// returns one rolled-up total plus value-weighted 24H / 7D deltas. By design
// this equals STONKS TOTAL + CRYPTO TOTAL: same per-key qty>0 + finite-price
// rules as the asset-box renderTotal, summed across the deduped union of both
// boxes' keys. Null-safe for dev:web (ctx?.store may be missing).

import type { AppContext } from '../app-context';
import type { AssetQuote } from '../../shared/types';
import { getCachedSettings } from '../state/settings';

/** Rolled-up portfolio snapshot. Deltas are null when no weighted input exists. */
export interface PortfolioTotal {
  totalUsd: number;
  change24h: number | null;
  change7d: number | null;
}

/** Index the latest crypto + stock quotes by canonical key (last write wins). */
function quoteIndex(ctx: AppContext): Map<string, AssetQuote> {
  const map = new Map<string, AssetQuote>();
  const crypto = ctx?.store?.get('crypto') ?? [];
  const stocks = ctx?.store?.get('stocks') ?? [];
  for (const q of crypto) if (q && typeof q.key === 'string') map.set(q.key, q);
  for (const q of stocks) if (q && typeof q.key === 'string') map.set(q.key, q);
  return map;
}

/**
 * Sum the user's whole portfolio across the DEDUPED union of friendAssets +
 * ownerAssets. For each key: qty = holdings[key] (skipped unless finite > 0),
 * price from the live quote index (skipped if non-finite). totalUsd is the
 * sum of qty * price. The 24H / 7D figures are value-weighted averages: each
 * included asset with a finite change contributes its delta weighted by its
 * dollar value v (w += v; s += v * change), result s / w (null when w == 0),
 * computed independently for 24H and 7D so one missing field does not poison
 * the other.
 */
export function computePortfolio(ctx: AppContext | null | undefined): PortfolioTotal {
  if (!ctx) return { totalUsd: 0, change24h: null, change7d: null };

  // Read the live settings cache (same source of truth as asset-box renderTotal),
  // not ctx.settings: the row qty editor commits via the bare state/settings
  // update(), which refreshes getCachedSettings() but never reassigns ctx.settings,
  // so reading ctx.settings.holdings here would go stale after the first qty edit.
  const settings = getCachedSettings();
  const holdings = settings?.holdings ?? {};
  const friend = Array.isArray(settings?.friendAssets) ? settings.friendAssets : [];
  const owner = Array.isArray(settings?.ownerAssets) ? settings.ownerAssets : [];

  // dedupe the union; a key in both boxes is counted once
  const keys = new Set<string>();
  for (const k of friend) if (typeof k === 'string' && k.length > 0) keys.add(k);
  for (const k of owner) if (typeof k === 'string' && k.length > 0) keys.add(k);

  const quotes = quoteIndex(ctx);

  let totalUsd = 0;
  // value-weighted accumulators for the two deltas, kept separate
  let w24 = 0;
  let s24 = 0;
  let w7 = 0;
  let s7 = 0;

  for (const key of keys) {
    const qty = holdings[key];
    if (typeof qty !== 'number' || !Number.isFinite(qty) || qty <= 0) continue;
    const quote = quotes.get(key);
    const price = quote?.price;
    if (typeof price !== 'number' || !Number.isFinite(price)) continue;

    const v = qty * price;
    totalUsd += v;

    const c24 = quote?.change24h;
    if (typeof c24 === 'number' && Number.isFinite(c24)) {
      w24 += v;
      s24 += v * c24;
    }
    const c7 = quote?.change7d;
    if (typeof c7 === 'number' && Number.isFinite(c7)) {
      w7 += v;
      s7 += v * c7;
    }
  }

  return {
    totalUsd,
    change24h: w24 > 0 ? s24 / w24 : null,
    change7d: w7 > 0 ? s7 / w7 : null
  };
}
