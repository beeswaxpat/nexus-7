// Kraken BTC candle history, used as a fallback when Coinbase is unreachable.
//   GET https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=1
// Kraken returns { error: [...], result: { <PAIRKEY>: rows, last: <ts> } } where
// PAIRKEY is normalized (e.g. 'XXBTZUSD', not the literal 'XBTUSD'), so we read the
// non-`last` key dynamically. Each row is
//   [time, open, high, low, close, vwap, volume, count]
// with string numerics, normally ascending; we sort to be safe. We normalize to the Candle shape.
// Signature is FROZEN.

import type { Candle } from '../../../shared/types';
import { httpJson } from '../http';

const URL = 'https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=1';

interface KrakenOhlc {
  error?: string[];
  result?: Record<string, unknown>;
}

/** Fallback BTC candle history (Kraken), ascending. */
export async function fetchCandles(): Promise<Candle[]> {
  const body = await httpJson<KrakenOhlc>(URL);
  if (Array.isArray(body.error) && body.error.length > 0) {
    throw new Error(`Kraken OHLC error: ${body.error.join(', ')}`);
  }
  const result = body.result;
  if (!result) throw new Error('Kraken OHLC: missing result');

  // The OHLC rows live under the pair key; ignore the sibling `last` cursor.
  const pairKey = Object.keys(result).find((k) => k !== 'last');
  if (!pairKey) throw new Error('Kraken OHLC: no pair key in result');
  const rows = result[pairKey];
  if (!Array.isArray(rows)) throw new Error('Kraken OHLC: unexpected rows shape');

  const candles: Candle[] = [];
  for (const r of rows as unknown[][]) {
    // [time, open, high, low, close, vwap, volume, count] (numerics are strings).
    const time = Number(r[0]);
    const open = Number(r[1]);
    const high = Number(r[2]);
    const low = Number(r[3]);
    const close = Number(r[4]);
    if (!Number.isFinite(time) || !Number.isFinite(close)) continue;
    candles.push({ time, open, high, low, close });
  }
  candles.sort((a, b) => a.time - b.time);
  return candles;
}
