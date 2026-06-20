// Live self-test for the crumb-free resolver fallback (yahoo.resolveStockViaChart).
// Hits the public chart endpoint the same way the adapter does
// (query1.finance.yahoo.com/v8/finance/chart/<SYM>?range=5d&interval=1d via fetch)
// and asserts the fields the resolver relies on: a recognized instrumentType, a finite
// price, and the right issuer name. This proves the fallback's data source works WITHOUT
// the crumb/cookie, which is the whole reason it exists: the crumb-gated quote() 429s
// often and that is why real tickers (STRK = Strategy Inc Strike Preferred, STRF =
// Strife Preferred) drop out of asset search. The adapter is TS and this runner is plain
// node, so the request + field reads are re-derived here rather than building the project.
//
// MSTR is the liquid gate. STRK/STRF are the deliverable: they must classify as EQUITY,
// carry a finite price, and name back to Strategy. Throwing on a failed assertion is how
// selftest-all.mjs marks this source failed. Run: node scripts/selftest-resolver.mjs

const SECURITY_TYPES = new Set(['EQUITY', 'ETF', 'MUTUALFUND', 'INDEX']);
const SYMBOLS = ['STRK', 'STRF', 'MSTR'];

// Symbols whose issuer name must contain 'Strategy' (the Strike/Strife preferreds).
const STRATEGY_SYMBOLS = new Set(['STRK', 'STRF']);

const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 NEXUS-7';

function assert(cond, msg) {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Read one symbol off the chart endpoint, deriving exactly what resolveStockViaChart
// reads: instrumentType, a finite price (meta.regularMarketPrice else last finite close),
// and the resolved name (longName/shortName/sym). Returns null on any failure.
async function readViaChart(symbol) {
  const sym = symbol.trim().toUpperCase();
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}` +
    `?range=5d&interval=1d`;
  const res = await fetch(url, {
    headers: { 'User-Agent': DESKTOP_UA, Accept: 'application/json' }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${sym}`);
  const data = await res.json();
  const result = data?.chart?.result?.[0];
  const meta = result?.meta;
  if (!meta) return null;

  const rawCloses = result?.indicators?.quote?.[0]?.close ?? [];
  let lastClose = null;
  for (let i = rawCloses.length - 1; i >= 0; i--) {
    const c = rawCloses[i];
    if (typeof c === 'number' && Number.isFinite(c)) {
      lastClose = c;
      break;
    }
  }
  const price =
    typeof meta.regularMarketPrice === 'number' && Number.isFinite(meta.regularMarketPrice)
      ? meta.regularMarketPrice
      : lastClose;

  const resolvedSym = (meta.symbol ?? sym).toUpperCase();
  return {
    requested: sym,
    symbol: resolvedSym,
    name: meta.longName ?? meta.shortName ?? resolvedSym,
    instrumentType: meta.instrumentType ?? null,
    price
  };
}

const rows = new Map();

for (const symbol of SYMBOLS) {
  try {
    const row = await readViaChart(symbol);
    assert(row, `${symbol}: no meta in chart response`);

    // Core resolver guarantees: recognized security type + finite price.
    assert(
      row.instrumentType && SECURITY_TYPES.has(row.instrumentType.toUpperCase()),
      `${symbol}: instrumentType must be a security type, got ${row.instrumentType}`
    );
    assert(
      typeof row.price === 'number' && Number.isFinite(row.price) && row.price > 0,
      `${symbol}: price must be a finite positive number, got ${row.price}`
    );

    // The deliverable tickers must classify as EQUITY and name back to Strategy.
    if (STRATEGY_SYMBOLS.has(row.requested)) {
      assert(
        row.instrumentType.toUpperCase() === 'EQUITY',
        `${symbol}: instrumentType must be EQUITY, got ${row.instrumentType}`
      );
      assert(
        /strategy/i.test(row.name),
        `${symbol}: name must contain 'Strategy', got "${row.name}"`
      );
    }

    rows.set(row.requested, row);
    console.log(
      `OK   ${row.symbol.padEnd(6)} type=${String(row.instrumentType).padEnd(10)} ` +
        `price=$${String(row.price).padEnd(10)} ${row.name}`
    );
  } catch (err) {
    // No tolerance here: the fallback's data source IS what this test proves, so any
    // failed symbol fails the test (selftest-all.mjs surfaces the throw).
    throw new Error(`[selftest resolver] ${symbol} failed: ${err.message}`);
  }
  await sleep(400); // gentle spacing between requests
}

// MSTR is the liquid gate: it must classify as EQUITY too.
const mstr = rows.get('MSTR');
assert(mstr, 'MSTR did not resolve via the chart endpoint');
assert(mstr.instrumentType.toUpperCase() === 'EQUITY', 'MSTR must classify as EQUITY');

console.log(
  `\n[selftest resolver] OK. ${rows.size}/${SYMBOLS.length} resolved crumb-free; ` +
    `STRK/STRF classified EQUITY and named to Strategy.`
);
