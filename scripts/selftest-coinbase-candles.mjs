// Live self-test for the Coinbase (+ Kraken fallback) candle adapters.
// Hits the real endpoints and asserts a normalized Candle shape, mirroring the
// remap logic in src/main/data/adapters/{coinbase,kraken}-candles.ts. Standalone so
// it runs under plain `node` without a TS build (per the build-agent constraints).
//
//   node scripts/selftest-coinbase-candles.mjs
//
// Prints candle count + the last candle for each source, then exercises the live WS
// ticker for a few seconds. Exits non-zero on any failed assertion.

import assert from 'node:assert/strict';

const UA = { 'User-Agent': 'NEXUS-7-selftest' };

function assertCandle(c, label) {
  assert.ok(c && typeof c === 'object', `${label}: candle is an object`);
  for (const k of ['time', 'open', 'high', 'low', 'close']) {
    assert.ok(Number.isFinite(c[k]), `${label}: ${k} is a finite number (got ${c[k]})`);
  }
  // time must be in SECONDS (lightweight-charts UTCTimestamp), not ms.
  assert.ok(c.time > 1e9 && c.time < 1e11, `${label}: time looks like epoch SECONDS (got ${c.time})`);
  assert.ok(c.high >= c.low, `${label}: high >= low`);
  assert.ok(c.high >= c.open && c.high >= c.close, `${label}: high is the max`);
  assert.ok(c.low <= c.open && c.low <= c.close, `${label}: low is the min`);
}

function assertAscending(candles, label) {
  for (let i = 1; i < candles.length; i++) {
    assert.ok(candles[i].time >= candles[i - 1].time, `${label}: sorted ascending at index ${i}`);
  }
}

// ---- Coinbase REST history ----------------------------------------------------
async function testCoinbase() {
  const url = 'https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=60';
  const res = await fetch(url, { headers: UA });
  assert.equal(res.status, 200, `coinbase HTTP status (got ${res.status})`);
  const rows = await res.json();
  assert.ok(Array.isArray(rows) && rows.length > 0, 'coinbase returned a non-empty array');

  // Remap [time, low, high, open, close, volume] -> {time, open, high, low, close}.
  const candles = rows
    .map(([time, low, high, open, close]) => ({ time, open, high, low, close }))
    .sort((a, b) => a.time - b.time);

  assertCandle(candles[0], 'coinbase first');
  assertCandle(candles[candles.length - 1], 'coinbase last');
  assertAscending(candles, 'coinbase');

  const last = candles[candles.length - 1];
  console.log(`[coinbase] candle count: ${candles.length}`);
  console.log(`[coinbase] last candle: ${JSON.stringify(last)}`);
  return candles;
}

// ---- Kraken REST fallback -----------------------------------------------------
async function testKraken() {
  const url = 'https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=1';
  const res = await fetch(url, { headers: UA });
  assert.equal(res.status, 200, `kraken HTTP status (got ${res.status})`);
  const body = await res.json();
  assert.ok(Array.isArray(body.error) && body.error.length === 0, `kraken error empty (got ${JSON.stringify(body.error)})`);
  const pairKey = Object.keys(body.result).find((k) => k !== 'last');
  assert.ok(pairKey, 'kraken has a pair key');
  const rows = body.result[pairKey];
  assert.ok(Array.isArray(rows) && rows.length > 0, 'kraken returned non-empty rows');

  // [time, open, high, low, close, vwap, volume, count] (string numerics).
  const candles = rows
    .map((r) => ({ time: Number(r[0]), open: Number(r[1]), high: Number(r[2]), low: Number(r[3]), close: Number(r[4]) }))
    .sort((a, b) => a.time - b.time);

  assertCandle(candles[0], 'kraken first');
  assertCandle(candles[candles.length - 1], 'kraken last');
  assertAscending(candles, 'kraken');

  const last = candles[candles.length - 1];
  console.log(`[kraken]   candle count: ${candles.length}`);
  console.log(`[kraken]   last candle: ${JSON.stringify(last)}`);
  return candles;
}

// ---- Coinbase live WS ticker --------------------------------------------------
async function testLiveTicker() {
  const { default: WebSocket } = await import('ws');
  return await new Promise((resolve, reject) => {
    const ws = new WebSocket('wss://ws-feed.exchange.coinbase.com');
    let ticks = 0;
    const deadline = setTimeout(() => {
      ws.close();
      if (ticks > 0) {
        console.log(`[ws]       received ${ticks} live tick candle(s).`);
        resolve();
      } else {
        reject(new Error('live ticker produced no candles within timeout'));
      }
    }, 12_000);

    // Mirror the adapter's bucketing: build a candle from parsed price + runtime seconds.
    let bucket = -1;
    let open = NaN;
    let high = NaN;
    let low = NaN;
    const onPrice = (price) => {
      if (!Number.isFinite(price)) return;
      const now = Math.floor(Date.now() / 1000);
      const time = Math.floor(now / 60) * 60;
      if (time !== bucket) {
        bucket = time;
        open = high = low = price;
      } else {
        high = Math.max(high, price);
        low = Math.min(low, price);
      }
      const candle = { time, open, high, low, close: price };
      ticks++;
      if (ticks === 1) {
        assertCandle(candle, 'ws first tick');
        console.log(`[ws]       first live candle: ${JSON.stringify(candle)}`);
      }
      if (ticks >= 3) {
        clearTimeout(deadline);
        console.log(`[ws]       received ${ticks} live tick candle(s).`);
        ws.close();
        resolve();
      }
    };

    ws.on('open', () => ws.send(JSON.stringify({ type: 'subscribe', product_ids: ['BTC-USD'], channels: ['ticker'] })));
    ws.on('message', (d) => {
      let msg;
      try {
        msg = JSON.parse(d.toString());
      } catch {
        return;
      }
      if (msg.type === 'ticker') onPrice(Number(msg.price));
    });
    ws.on('error', (e) => {
      clearTimeout(deadline);
      reject(e);
    });
  });
}

async function main() {
  await testCoinbase();
  await testKraken();
  await testLiveTicker();
  console.log('[selftest-coinbase-candles] OK');
}

main().catch((err) => {
  console.error('[selftest-coinbase-candles] FAILED\n', err);
  process.exit(1);
});
