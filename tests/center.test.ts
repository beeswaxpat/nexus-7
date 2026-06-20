import { describe, it, expect, beforeEach } from 'vitest';
import {
  centerKey,
  centerIsBitcoin,
  secondaryKey,
  secondaryIsSpcx,
  findQuoteByKey,
  findCenterQuote
} from '../src/renderer/core/center';
import { update } from '../src/renderer/state/settings';
import {
  DEFAULT_CENTER_KEY,
  SECONDARY_DEFAULT_KEY
} from '../src/shared/constants';
import type { AssetQuote } from '../src/shared/types';

function quote(key: string, price: number | null = 1): AssetQuote {
  return {
    key,
    symbol: key.split(':')[1] ?? key,
    name: key,
    kind: key.startsWith('yahoo:') ? 'stock' : 'crypto',
    price,
    change24h: null,
    change7d: null,
    marketCap: null,
    source: 'test',
    stale: false,
    asOf: 0
  };
}

// update() (no bridge wired in tests) mutates the in-memory settings cache that
// center.ts reads via getCachedSettings(). Reset to defaults before each test.
beforeEach(async () => {
  await update({ centerAsset: DEFAULT_CENTER_KEY, secondaryAsset: SECONDARY_DEFAULT_KEY });
});

describe('centerKey / centerIsBitcoin', () => {
  it('defaults to the Bitcoin center key', () => {
    expect(centerKey()).toBe(DEFAULT_CENTER_KEY);
    expect(centerIsBitcoin()).toBe(true);
  });

  it('tracks a user-swapped center asset', async () => {
    await update({ centerAsset: 'coingecko:ethereum' });
    expect(centerKey()).toBe('coingecko:ethereum');
    expect(centerIsBitcoin()).toBe(false);
  });

  it('centerIsBitcoin is case-insensitive against the default', async () => {
    await update({ centerAsset: DEFAULT_CENTER_KEY.toUpperCase() });
    expect(centerIsBitcoin()).toBe(true);
  });

  it('falls back to the default when the stored value is empty', async () => {
    await update({ centerAsset: '' });
    expect(centerKey()).toBe(DEFAULT_CENTER_KEY);
  });
});

describe('secondaryKey / secondaryIsSpcx', () => {
  it('defaults to the SpaceX second slot', () => {
    expect(secondaryKey()).toBe(SECONDARY_DEFAULT_KEY);
    expect(secondaryIsSpcx()).toBe(true);
  });

  it('tracks a user-swapped second slot', async () => {
    await update({ secondaryAsset: 'yahoo:NVDA' });
    expect(secondaryKey()).toBe('yahoo:NVDA');
    expect(secondaryIsSpcx()).toBe(false);
  });

  it('falls back to the default when the stored value is empty', async () => {
    await update({ secondaryAsset: '' });
    expect(secondaryKey()).toBe(SECONDARY_DEFAULT_KEY);
  });
});

describe('findQuoteByKey', () => {
  const crypto = [quote('coingecko:bitcoin', 60000), quote('coingecko:ethereum', 3000)];
  const stocks = [quote('yahoo:MSTR', 1500)];

  it('finds a quote in the crypto list', () => {
    expect(findQuoteByKey('coingecko:ethereum', crypto, stocks)?.price).toBe(3000);
  });

  it('finds a quote in the stock list', () => {
    expect(findQuoteByKey('yahoo:MSTR', crypto, stocks)?.price).toBe(1500);
  });

  it('matches case-insensitively', () => {
    expect(findQuoteByKey('COINGECKO:BITCOIN', crypto, stocks)?.price).toBe(60000);
  });

  it('returns null when not found or lists are nullish', () => {
    expect(findQuoteByKey('coingecko:nope', crypto, stocks)).toBeNull();
    expect(findQuoteByKey('coingecko:bitcoin', null, null)).toBeNull();
    expect(findQuoteByKey('coingecko:bitcoin', undefined, undefined)).toBeNull();
  });
});

describe('findCenterQuote', () => {
  const crypto = [quote('coingecko:bitcoin', 60000), quote('coingecko:ethereum', 3000)];
  const stocks = [quote('yahoo:MSTR', 1500)];

  it('resolves the live quote for the current center key', () => {
    expect(findCenterQuote(crypto, stocks)?.key).toBe('coingecko:bitcoin');
  });

  it('follows a swapped center asset', async () => {
    await update({ centerAsset: 'coingecko:ethereum' });
    expect(findCenterQuote(crypto, stocks)?.price).toBe(3000);
  });

  it('returns null when the center quote is not loaded', async () => {
    await update({ centerAsset: 'coingecko:dogecoin' });
    expect(findCenterQuote(crypto, stocks)).toBeNull();
  });
});
