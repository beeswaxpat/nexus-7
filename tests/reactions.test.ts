import { describe, it, expect } from 'vitest';
import {
  bannerFor,
  emojiFor,
  emojiGlyph,
  emojiPulses,
  btcMode,
  fngBands,
  shouldOrbit
} from '../src/renderer/core/reactions';
import type { AssetQuote } from '../src/shared/types';

// Helper: build a minimal AssetQuote with just the change24h we care about.
function quote(change24h: number | null): AssetQuote {
  return {
    key: 'coingecko:test',
    symbol: 'TEST',
    name: 'Test',
    kind: 'crypto',
    price: 1,
    change24h,
    change7d: null,
    marketCap: null,
    source: 'test',
    stale: false,
    asOf: 0
  };
}

describe('bannerFor', () => {
  it('templates the +5 band with the provided asset name', () => {
    expect(bannerFor(6, 'ETHEREUM')).toBe('ETHEREUM is feeling nicey');
    expect(bannerFor(5, 'SOLANA')).toBe('SOLANA is feeling nicey');
    expect(bannerFor(9.99, 'XRP')).toBe('XRP is feeling nicey');
  });

  it('defaults the +5 band subject to Bitcoin', () => {
    expect(bannerFor(6)).toBe('Bitcoin is feeling nicey');
    expect(bannerFor(5)).toBe('Bitcoin is feeling nicey');
  });

  it('returns the unchanged exact strings for the higher up-bands', () => {
    expect(bannerFor(10)).toBe('Starting to like this guy!');
    expect(bannerFor(14.9)).toBe('Starting to like this guy!');
    expect(bannerFor(15)).toBe('SOMETHING LIKE A PHENOMENON!');
    expect(bannerFor(19.9)).toBe('SOMETHING LIKE A PHENOMENON!');
    expect(bannerFor(20)).toBe('OHHHH MAAAAAAN!!!');
    expect(bannerFor(100)).toBe('OHHHH MAAAAAAN!!!');
  });

  it('higher up-bands ignore the asset name (only the +5 band templates it)', () => {
    expect(bannerFor(10, 'ETHEREUM')).toBe('Starting to like this guy!');
    expect(bannerFor(20, 'ETHEREUM')).toBe('OHHHH MAAAAAAN!!!');
  });

  it('returns the unchanged exact strings for the down-bands', () => {
    expect(bannerFor(-5)).toBe("Isn't that just grape");
    expect(bannerFor(-9.9)).toBe("Isn't that just grape");
    expect(bannerFor(-10)).toBe('Idk.');
    expect(bannerFor(-14.9)).toBe('Idk.');
    expect(bannerFor(-15)).toBe('CAPITULATION WARNING');
    expect(bannerFor(-19.9)).toBe('CAPITULATION WARNING');
    expect(bannerFor(-20)).toBe('GGWP');
    expect(bannerFor(-100)).toBe('GGWP');
  });

  it('returns null when |change| < 5', () => {
    expect(bannerFor(0)).toBeNull();
    expect(bannerFor(4.99)).toBeNull();
    expect(bannerFor(-4.99)).toBeNull();
  });

  it('returns null for null / NaN / non-finite input', () => {
    expect(bannerFor(null)).toBeNull();
    expect(bannerFor(NaN)).toBeNull();
    // Infinity is not finite (Number.isFinite(Infinity) === false) -> null.
    expect(bannerFor(Infinity, 'X')).toBeNull();
    expect(bannerFor(-Infinity)).toBeNull();
  });
});

describe('emojiFor', () => {
  it('bitcoin happy band: 5 <= change < 10 -> happy', () => {
    expect(emojiFor(5, true)).toBe('happy');
    expect(emojiFor(7, true)).toBe('happy');
    expect(emojiFor(9.99, true)).toBe('happy');
  });

  it('non-bitcoin in the happy range falls through to rocket at >=10 only, none below', () => {
    // 5..10 for a non-bitcoin asset is NOT happy and below rocket -> none
    expect(emojiFor(5, false)).toBe('');
    expect(emojiFor(9.99, false)).toBe('');
  });

  it('diamond threshold: change >= 20', () => {
    expect(emojiFor(20, true)).toBe('diamond');
    expect(emojiFor(20, false)).toBe('diamond');
    expect(emojiFor(50, false)).toBe('diamond');
  });

  it('rocket threshold: 10 <= change < 20', () => {
    expect(emojiFor(10, true)).toBe('rocket');
    expect(emojiFor(10, false)).toBe('rocket');
    expect(emojiFor(19.99, false)).toBe('rocket');
  });

  it('skull threshold: change <= -20', () => {
    expect(emojiFor(-20, true)).toBe('skull');
    expect(emojiFor(-50, false)).toBe('skull');
  });

  it('poop threshold: -20 < change <= -10', () => {
    expect(emojiFor(-10, true)).toBe('poop');
    expect(emojiFor(-19.99, false)).toBe('poop');
  });

  it('returns none in the neutral middle band', () => {
    expect(emojiFor(0, true)).toBe('');
    expect(emojiFor(-9.99, false)).toBe('');
    expect(emojiFor(4.99, true)).toBe('');
  });

  it('returns none for null / NaN', () => {
    expect(emojiFor(null, true)).toBe('');
    expect(emojiFor(NaN, false)).toBe('');
  });
});

describe('emojiGlyph', () => {
  it('maps each token to its glyph', () => {
    expect(emojiGlyph('happy')).toBe('\u{1F600}');
    expect(emojiGlyph('rocket')).toBe('\u{1F680}');
    expect(emojiGlyph('diamond')).toBe('\u{1F48E}');
    expect(emojiGlyph('poop')).toBe('\u{1F4A9}');
    expect(emojiGlyph('skull')).toBe('\u{1F480}');
  });

  it('returns empty string for the empty token', () => {
    expect(emojiGlyph('')).toBe('');
  });
});

describe('emojiPulses', () => {
  it('only diamond and happy pulse', () => {
    expect(emojiPulses('diamond')).toBe(true);
    expect(emojiPulses('happy')).toBe(true);
  });

  it('other tokens do not pulse', () => {
    expect(emojiPulses('rocket')).toBe(false);
    expect(emojiPulses('poop')).toBe(false);
    expect(emojiPulses('skull')).toBe(false);
    expect(emojiPulses('')).toBe(false);
  });
});

describe('btcMode', () => {
  it('lfg at change >= 20', () => {
    expect(btcMode(20)).toBe('lfg');
    expect(btcMode(100)).toBe('lfg');
  });

  it('pump at 5 <= change < 20', () => {
    expect(btcMode(5)).toBe('pump');
    expect(btcMode(19.99)).toBe('pump');
  });

  it('dump at change <= -5', () => {
    expect(btcMode(-5)).toBe('dump');
    expect(btcMode(-50)).toBe('dump');
  });

  it('normal in the middle band', () => {
    expect(btcMode(0)).toBe('normal');
    expect(btcMode(4.99)).toBe('normal');
    expect(btcMode(-4.99)).toBe('normal');
  });

  it('normal for null / NaN', () => {
    expect(btcMode(null)).toBe('normal');
    expect(btcMode(NaN)).toBe('normal');
  });
});

describe('fngBands', () => {
  it('Extreme Fear at <= 24 (darker red)', () => {
    expect(fngBands(0)).toEqual({ level: 'Extreme Fear', color: '#8b0000' });
    expect(fngBands(24)).toEqual({ level: 'Extreme Fear', color: '#8b0000' });
  });

  it('Fear at 25..49', () => {
    expect(fngBands(25)).toEqual({ level: 'Fear', color: '#ff4d4d' });
    expect(fngBands(49)).toEqual({ level: 'Fear', color: '#ff4d4d' });
  });

  it('Neutral exactly at 50', () => {
    expect(fngBands(50)).toEqual({ level: 'Neutral', color: '#cccccc' });
  });

  it('Greed at 51..74', () => {
    expect(fngBands(51)).toEqual({ level: 'Greed', color: '#37d67a' });
    expect(fngBands(74)).toEqual({ level: 'Greed', color: '#37d67a' });
  });

  it('Extreme Greed at >= 75', () => {
    expect(fngBands(75)).toEqual({ level: 'Extreme Greed', color: '#00ff88' });
    expect(fngBands(100)).toEqual({ level: 'Extreme Greed', color: '#00ff88' });
  });
});

describe('shouldOrbit', () => {
  it('true when any asset has abs(change) >= 10', () => {
    expect(shouldOrbit([quote(2), quote(10)])).toBe(true);
    expect(shouldOrbit([quote(-15)])).toBe(true);
  });

  it('false when no asset reaches the orbit threshold', () => {
    expect(shouldOrbit([quote(2), quote(-9.99)])).toBe(false);
    expect(shouldOrbit([quote(null)])).toBe(false);
    expect(shouldOrbit([])).toBe(false);
  });
});
