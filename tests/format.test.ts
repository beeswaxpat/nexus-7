import { describe, it, expect } from 'vitest';
import {
  formatPrice,
  formatMarketCap,
  formatHoldingValue,
  formatAge,
  formatPercent
} from '../src/renderer/core/format';

describe('formatPrice', () => {
  it('>= 1 uses 2 decimals', () => {
    expect(formatPrice(1)).toBe('$1.00');
    expect(formatPrice(1234.5)).toBe('$1234.50');
    expect(formatPrice(99999.999)).toBe('$100000.00');
  });

  it('>= 0.01 and < 1 uses 4 decimals', () => {
    expect(formatPrice(0.5)).toBe('$0.5000');
    expect(formatPrice(0.01)).toBe('$0.0100');
    expect(formatPrice(0.1234)).toBe('$0.1234');
  });

  // The formatPrice ".replace(/\.$/,'.0')" restore branch is defensive and
  // effectively unreachable for abs < 0.01 inputs: those always keep a fractional digit.
  it('sub-cent uses up to 8 decimals with trailing zeros trimmed', () => {
    expect(formatPrice(0.00000123)).toBe('$0.00000123');
    // 0.001 -> toFixed(8) = 0.00100000 -> trimmed -> 0.001
    expect(formatPrice(0.001)).toBe('$0.001');
  });

  it('null / undefined / NaN -> placeholder', () => {
    expect(formatPrice(null)).toBe('$...');
    expect(formatPrice(undefined)).toBe('$...');
    expect(formatPrice(NaN)).toBe('$...');
  });
});

describe('formatMarketCap', () => {
  it('trillions / billions / millions / thousands', () => {
    expect(formatMarketCap(2.5e12)).toBe('$2.5T');
    expect(formatMarketCap(3.2e9)).toBe('$3.2B');
    expect(formatMarketCap(7.8e6)).toBe('$7.8M');
    expect(formatMarketCap(4.1e3)).toBe('$4.1K');
  });

  it('below 1000 rounds to whole dollars', () => {
    expect(formatMarketCap(999)).toBe('$999');
    expect(formatMarketCap(12.4)).toBe('$12');
  });

  it('non-positive / null / NaN -> placeholder', () => {
    expect(formatMarketCap(0)).toBe('$...');
    expect(formatMarketCap(-5)).toBe('$...');
    expect(formatMarketCap(null)).toBe('$...');
    expect(formatMarketCap(NaN)).toBe('$...');
  });
});

describe('formatHoldingValue', () => {
  it('compact above 100K, exact dollars with cents below', () => {
    expect(formatHoldingValue(1234.56)).toBe('$1,234.56');
    expect(formatHoldingValue(250000)).toBe('$250.0K');
    expect(formatHoldingValue(5e6)).toBe('$5.00M');
  });

  it('null / non-positive -> placeholder', () => {
    expect(formatHoldingValue(0)).toBe('$...');
    expect(formatHoldingValue(null)).toBe('$...');
  });
});

describe('formatAge', () => {
  const now = 1_000_000_000_000;

  it('< 60s -> "just now"', () => {
    expect(formatAge(now - 5_000, now)).toBe('just now');
    expect(formatAge(now, now)).toBe('just now');
  });

  it('minutes', () => {
    expect(formatAge(now - 5 * 60_000, now)).toBe('5m ago');
    expect(formatAge(now - 59 * 60_000, now)).toBe('59m ago');
  });

  it('hours', () => {
    expect(formatAge(now - 3 * 3_600_000, now)).toBe('3h ago');
    expect(formatAge(now - 23 * 3_600_000, now)).toBe('23h ago');
  });

  it('days', () => {
    expect(formatAge(now - 2 * 86_400_000, now)).toBe('2d ago');
  });

  it('future timestamps clamp to "just now"', () => {
    expect(formatAge(now + 10_000, now)).toBe('just now');
  });

  it('null / NaN -> empty string', () => {
    expect(formatAge(null, now)).toBe('');
    expect(formatAge(NaN, now)).toBe('');
  });
});

describe('formatPercent', () => {
  it('positive gets a + sign, 2 decimals, trailing %', () => {
    expect(formatPercent(6.2)).toBe('+6.20%');
    expect(formatPercent(0.005)).toBe('+0.01%');
  });

  it('negative keeps the minus, no extra +', () => {
    expect(formatPercent(-3.4)).toBe('-3.40%');
  });

  it('zero has no sign', () => {
    expect(formatPercent(0)).toBe('0.00%');
  });

  it('null / NaN -> placeholder', () => {
    expect(formatPercent(null)).toBe('...%');
    expect(formatPercent(NaN)).toBe('...%');
  });
});
