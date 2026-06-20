// Live self-test for the market-ticker adapter. Hits the real CoinGecko endpoint,
// applies the same stablecoin/wrapped denylist + transform as market-ticker.ts,
// asserts a normalized TickerCoin shape, and prints the first 10 coins.
// Run directly (`node scripts/selftest-market-ticker.mjs`) or via `npm run selftest`.
//
// Note: this .mjs cannot import the CommonJS adapter (.ts), so the denylist and
// cap below mirror src/shared/constants.ts. Keep them in sync if those change.

const MARKETS_URL =
  'https://api.coingecko.com/api/v3/coins/markets' +
  '?vs_currency=usd&order=market_cap_desc&per_page=60&page=1&sparkline=false';

const DENYLIST = new Set([
  'tether',
  'usd-coin',
  'binance-usd',
  'dai',
  'true-usd',
  'usdd',
  'first-digital-usd',
  'ethena-usde',
  'wrapped-bitcoin',
  'wrapped-steth',
  'wrapped-tron',
  'weth',
  'staked-ether'
]);
const TICKER_MAX = 50;

function isExcluded(id) {
  return DENYLIST.has(id) || id.startsWith('wrapped-');
}

function assert(cond, msg) {
  if (!cond) throw new Error('assertion failed: ' + msg);
}

const res = await fetch(MARKETS_URL, {
  headers: {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 NEXUS-7',
    Accept: 'application/json'
  }
});
assert(res.ok, `HTTP ${res.status} from CoinGecko markets`);

const rows = await res.json();
assert(Array.isArray(rows), 'markets response is an array');
assert(rows.length > 0, 'markets response is non-empty');

const coins = [];
for (const row of rows) {
  if (coins.length >= TICKER_MAX) break;
  if (!row || typeof row.id !== 'string') continue;
  if (isExcluded(row.id)) continue;
  if (typeof row.current_price !== 'number') continue;
  coins.push({
    symbol: (row.symbol ?? '').toUpperCase(),
    price: row.current_price,
    change24h:
      typeof row.price_change_percentage_24h === 'number' ? row.price_change_percentage_24h : 0
  });
}

// Shape + content assertions on the normalized TickerCoin output.
assert(coins.length > 0, 'produced at least one ticker coin');
assert(coins.length <= TICKER_MAX, `capped at ${TICKER_MAX} (got ${coins.length})`);
for (const c of coins) {
  assert(typeof c.symbol === 'string' && c.symbol.length > 0, 'symbol is a non-empty string');
  assert(c.symbol === c.symbol.toUpperCase(), `symbol is upper-cased (${c.symbol})`);
  assert(typeof c.price === 'number' && Number.isFinite(c.price), `price is finite (${c.symbol})`);
  assert(
    typeof c.change24h === 'number' && Number.isFinite(c.change24h),
    `change24h is finite (${c.symbol})`
  );
}
// Denylist actually applied.
const symbols = new Set(coins.map((c) => c.symbol));
assert(!symbols.has('USDT'), 'tether (USDT) excluded');
assert(!symbols.has('USDC'), 'usd-coin (USDC) excluded');
assert(coins.some((c) => c.symbol === 'BTC'), 'BTC present (sanity)');

console.log(`[market-ticker] OK: ${coins.length} coins (cap ${TICKER_MAX}). First 10:`);
for (const c of coins.slice(0, 10)) {
  const sign = c.change24h >= 0 ? '+' : '';
  console.log(`  ${c.symbol.padEnd(6)} $${c.price}  (${sign}${c.change24h.toFixed(2)}%)`);
}
