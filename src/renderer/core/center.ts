// Center-asset helpers. The user can swap the featured center asset (default
// Bitcoin) via the center picker; everything that reacts to "the center coin"
// (wormhole bands, banners, pepes, theme recolor, big price) resolves the live
// quote through these helpers instead of hardcoding bitcoin.

import { DEFAULT_CENTER_KEY, SECONDARY_DEFAULT_KEY } from '../../shared/constants';
import type { AssetQuote } from '../../shared/types';
import { getCachedSettings } from '../state/settings';

/** The canonical key of the current center asset (e.g. 'coingecko:bitcoin'). */
export function centerKey(): string {
  const k = getCachedSettings().centerAsset;
  return typeof k === 'string' && k.length > 0 ? k : DEFAULT_CENTER_KEY;
}

/** True when the center asset is the default (Bitcoin). */
export function centerIsBitcoin(): boolean {
  return centerKey().toLowerCase() === DEFAULT_CENTER_KEY;
}

/** The canonical key of the gold "second slot" card (e.g. 'yahoo:SPCX'). */
export function secondaryKey(): string {
  const k = getCachedSettings().secondaryAsset;
  return typeof k === 'string' && k.length > 0 ? k : SECONDARY_DEFAULT_KEY;
}

/** True when the second slot is the default (SpaceX). */
export function secondaryIsSpcx(): boolean {
  return secondaryKey().toLowerCase() === SECONDARY_DEFAULT_KEY.toLowerCase();
}

/** Find a quote by canonical key across the crypto and stock lists. */
export function findQuoteByKey(
  key: string,
  crypto: AssetQuote[] | null | undefined,
  stocks: AssetQuote[] | null | undefined
): AssetQuote | null {
  const want = key.toLowerCase();
  for (const list of [crypto, stocks]) {
    if (!Array.isArray(list)) continue;
    const hit = list.find((q) => q && typeof q.key === 'string' && q.key.toLowerCase() === want);
    if (hit) return hit;
  }
  return null;
}

/** The live quote for the current center asset, or null if not loaded yet. */
export function findCenterQuote(
  crypto: AssetQuote[] | null | undefined,
  stocks: AssetQuote[] | null | undefined
): AssetQuote | null {
  return findQuoteByKey(centerKey(), crypto, stocks);
}
