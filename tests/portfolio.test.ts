import { describe, it, expect, beforeEach } from 'vitest';
import { computePortfolio } from '../src/renderer/core/portfolio';
import { store } from '../src/renderer/state/store';
import { update } from '../src/renderer/state/settings';
import type { AppContext } from '../src/renderer/app-context';
import type { AssetQuote } from '../src/shared/types';

function quote(
  key: string,
  price: number | null,
  change24h: number | null = null,
  change7d: number | null = null
): AssetQuote {
  return {
    key,
    symbol: key.split(':')[1] ?? key,
    name: key,
    kind: key.startsWith('yahoo:') ? 'stock' : 'crypto',
    price,
    change24h,
    change7d,
    marketCap: null,
    source: 'test',
    stale: false,
    asOf: 0
  };
}

// computePortfolio only touches ctx.store; cast the real store singleton into a
// minimal AppContext shape (the other fields are never read by the function).
function ctxWithStore(): AppContext {
  return { store } as unknown as AppContext;
}

beforeEach(() => {
  store.set('crypto', []);
  store.set('stocks', []);
});

describe('computePortfolio', () => {
  it('returns a zeroed snapshot for a null context', () => {
    expect(computePortfolio(null)).toEqual({ totalUsd: 0, change24h: null, change7d: null });
    expect(computePortfolio(undefined)).toEqual({ totalUsd: 0, change24h: null, change7d: null });
  });

  it('sums qty * price across both boxes with value-weighted deltas', async () => {
    store.set('crypto', [quote('coingecko:bitcoin', 100, 10, 2)]);
    store.set('stocks', [quote('yahoo:MSTR', 50, -10, 4)]);
    await update({
      friendAssets: ['coingecko:bitcoin'],
      ownerAssets: ['yahoo:MSTR'],
      holdings: { 'coingecko:bitcoin': 2, 'yahoo:MSTR': 4 }
    });

    const out = computePortfolio(ctxWithStore());
    // BTC: 2 * 100 = 200 (v=200, c24=10). MSTR: 4 * 50 = 200 (v=200, c24=-10).
    expect(out.totalUsd).toBe(400);
    // weighted 24h: (200*10 + 200*-10) / 400 = 0
    expect(out.change24h).toBeCloseTo(0, 10);
    // weighted 7d: (200*2 + 200*4) / 400 = 3
    expect(out.change7d).toBeCloseTo(3, 10);
  });

  it('counts a key in BOTH boxes only once (deduped union)', async () => {
    store.set('crypto', [quote('coingecko:bitcoin', 100, 5, 5)]);
    await update({
      friendAssets: ['coingecko:bitcoin'],
      ownerAssets: ['coingecko:bitcoin'],
      holdings: { 'coingecko:bitcoin': 3 }
    });
    const out = computePortfolio(ctxWithStore());
    expect(out.totalUsd).toBe(300); // not 600
    expect(out.change24h).toBeCloseTo(5, 10);
  });

  it('skips assets with no holding, non-positive qty, or non-finite price', async () => {
    store.set('crypto', [
      quote('coingecko:bitcoin', 100, 1, 1),
      quote('coingecko:ethereum', null, 1, 1), // non-finite price -> skipped
      quote('coingecko:solana', 10, 1, 1)
    ]);
    await update({
      friendAssets: ['coingecko:bitcoin', 'coingecko:ethereum', 'coingecko:solana'],
      ownerAssets: [],
      holdings: {
        'coingecko:bitcoin': 1,
        'coingecko:ethereum': 5, // price null -> skipped
        'coingecko:solana': 0 // qty 0 -> skipped
      }
    });
    const out = computePortfolio(ctxWithStore());
    expect(out.totalUsd).toBe(100); // only BTC contributes
  });

  it('keeps the two deltas independent when one field is missing', async () => {
    // BTC has only a 24h change; ETH has only a 7d change.
    store.set('crypto', [
      quote('coingecko:bitcoin', 100, 8, null),
      quote('coingecko:ethereum', 100, null, 12)
    ]);
    await update({
      friendAssets: ['coingecko:bitcoin', 'coingecko:ethereum'],
      ownerAssets: [],
      holdings: { 'coingecko:bitcoin': 1, 'coingecko:ethereum': 1 }
    });
    const out = computePortfolio(ctxWithStore());
    expect(out.totalUsd).toBe(200);
    // only BTC has a 24h change, weighted over its own value -> 8
    expect(out.change24h).toBeCloseTo(8, 10);
    // only ETH has a 7d change -> 12
    expect(out.change7d).toBeCloseTo(12, 10);
  });

  it('returns null deltas when nothing has a finite change', async () => {
    store.set('crypto', [quote('coingecko:bitcoin', 100, null, null)]);
    await update({
      friendAssets: ['coingecko:bitcoin'],
      ownerAssets: [],
      holdings: { 'coingecko:bitcoin': 2 }
    });
    const out = computePortfolio(ctxWithStore());
    expect(out.totalUsd).toBe(200);
    expect(out.change24h).toBeNull();
    expect(out.change7d).toBeNull();
  });

  it('totals zero when the only holding is zeroed out', async () => {
    // update() MERGES the holdings map (state/settings.update spreads the cache),
    // so to express "no qty held" we explicitly set the key to 0 (qty <= 0 is
    // skipped by computePortfolio), rather than relying on an empty patch.
    store.set('crypto', [quote('coingecko:bitcoin', 100, 5, 5)]);
    await update({
      friendAssets: ['coingecko:bitcoin'],
      ownerAssets: [],
      holdings: { 'coingecko:bitcoin': 0 }
    });
    const out = computePortfolio(ctxWithStore());
    expect(out.totalUsd).toBe(0);
    expect(out.change24h).toBeNull();
    expect(out.change7d).toBeNull();
  });
});
