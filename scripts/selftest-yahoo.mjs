// Live self-test for the Yahoo Finance stock adapter. Drives the real yahoo-finance2
// package the same way src/main/data/adapters/yahoo.ts does (one quote() call per
// symbol, validateResult:false, identical field mapping) and asserts a well-formed
// stock AssetQuote. Throwing on a failed assertion is how selftest-all.mjs marks this
// source failed. The adapter is TS and this runner is plain .mjs, so the mapping is
// re-derived here rather than building the project.
//
// MSTR is the hard gate (a liquid, always-present ticker). STRC is a thin ticker the
// task wants reported on: we print whether it returns data but do NOT fail the test
// if it is missing, since per-symbol failures are tolerated by design.
//
// Yahoo throttles its crumb endpoint (HTTP 429) under bursty access, so we retry the
// first quote with backoff to warm the shared crumb; once warmed, later symbols reuse
// it. Run: node scripts/selftest-yahoo.mjs

const SOURCE = 'yahoo';
const SYMBOLS = ['MSTR', 'STRC'];

function assert(cond, msg) {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const QUIET_LOGGER = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

// Map a raw yahoo-finance2 quote into the AssetQuote shape, exactly as the adapter does.
function toQuote(q, requested, asOf) {
  const sym = (q.symbol ?? requested).toUpperCase();
  return {
    key: `${SOURCE}:${requested}`,
    symbol: sym,
    name: q.longName ?? q.shortName ?? sym,
    kind: 'stock',
    price: q.regularMarketPrice ?? null,
    change24h: q.regularMarketChangePercent ?? null,
    change7d: null,
    marketCap: q.marketCap ?? null,
    source: SOURCE,
    stale: false,
    asOf
  };
}

// Contract assertions shared by every returned row.
function assertContract(quote, requested) {
  assert(quote.kind === 'stock', 'kind must be stock');
  assert(quote.source === SOURCE, 'source must be yahoo');
  assert(quote.key === `${SOURCE}:${requested}`, 'key format yahoo:<symbol>');
  assert(typeof quote.symbol === 'string' && quote.symbol.length > 0, 'symbol present');
  assert(quote.symbol === quote.symbol.toUpperCase(), 'symbol is upper-case');
  assert(typeof quote.name === 'string' && quote.name.length > 0, 'name present');
  assert(quote.price === null || (typeof quote.price === 'number' && quote.price > 0), 'price is positive number or null');
  assert(quote.change24h === null || typeof quote.change24h === 'number', 'change24h is number or null');
  assert(quote.change7d === null, 'change7d must be null (Yahoo path provides no 7d)');
  assert(quote.marketCap === null || (typeof quote.marketCap === 'number' && quote.marketCap >= 0), 'marketCap is number or null');
  assert(Number.isInteger(quote.asOf) && quote.asOf > 0, 'asOf is epoch ms');
}

// yahoo-finance2 v2.14+ is ESM-only; import it dynamically. This runner is already
// ESM (.mjs) so a plain dynamic import is fine here.
const mod = await import('yahoo-finance2');
const YahooFinance = mod.default;
const yf = new YahooFinance({ logger: QUIET_LOGGER });

// One quote() with crumb-429 backoff. Returns the raw quote or throws after retries.
async function quoteWithRetry(symbol) {
  let lastErr;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await yf.quote(symbol, {}, { validateResult: false });
    } catch (err) {
      lastErr = err;
      const is429 = /429|Too Many Requests|crumb/i.test(String(err && err.message));
      if (!is429 || attempt === 4) throw err;
      const wait = 1500 * Math.pow(2, attempt);
      console.log(`  [retry] ${symbol}: ${err.message}; waiting ${wait}ms`);
      await sleep(wait);
    }
  }
  throw lastErr;
}

const asOf = Date.now();
const results = new Map();

for (const symbol of SYMBOLS) {
  try {
    const raw = await quoteWithRetry(symbol);
    if (!raw) {
      console.log(`SKIP ${symbol}: empty response`);
      continue;
    }
    const quote = toQuote(raw, symbol, asOf);
    assertContract(quote, symbol);
    results.set(symbol, quote);
    const price = quote.price === null ? 'n/a' : `$${quote.price}`;
    const c24 = quote.change24h === null ? 'n/a' : `${quote.change24h.toFixed(2)}%`;
    const cap = quote.marketCap === null ? 'n/a' : `$${quote.marketCap.toLocaleString('en-US')}`;
    console.log(
      `OK   ${quote.key.padEnd(12)} ${quote.symbol.padEnd(6)} ${quote.name.padEnd(26)} ` +
        `price=${price.padEnd(12)} 24h=${c24.padEnd(9)} 7d=n/a cap=${cap}`
    );
  } catch (err) {
    // Per-symbol failure is tolerated by the adapter (skipped), so we log and move on.
    console.log(`SKIP ${symbol}: ${err.message}`);
  }
  await sleep(1200); // gentle spacing to avoid re-tripping the crumb throttle
}

// Hard gate: MSTR must resolve with a real price. If it does not, the whole source is
// considered failed (matches the adapter being usable for stocks).
const mstr = results.get('MSTR');
assert(mstr, 'MSTR did not resolve (Yahoo unreachable or rate-limited); cannot validate adapter');
assert(typeof mstr.price === 'number' && mstr.price > 0, 'MSTR price must be a positive number');

// Report on STRC (the task deliverable) without failing on its absence.
const strc = results.get('STRC');
const strcHasData = Boolean(strc && typeof strc.price === 'number' && strc.price > 0);
console.log('');
console.log(`[selftest yahoo] STRC returns data: ${strcHasData ? 'YES' : 'NO'}`);
if (strcHasData) {
  console.log(`  STRC -> ${strc.symbol} (${strc.name}) $${strc.price} 24h=${strc.change24h}% mcap=${strc.marketCap}`);
} else if (strc) {
  console.log(`  STRC resolved but price is ${strc.price} (thin/partial payload)`);
} else {
  console.log('  STRC did not resolve this run (thin ticker and/or rate limit). Adapter skips it; batch still returns MSTR.');
}

console.log(`\n[selftest yahoo] OK. Resolved ${results.size}/${SYMBOLS.length} symbol(s); MSTR validated.`);
