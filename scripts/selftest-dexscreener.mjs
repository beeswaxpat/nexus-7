// Live self-test for the DexScreener adapter. Hits the real search endpoint for
// q=thena, applies the same highest-liquidity selection + field mapping the
// adapter uses, and asserts the result is a well-formed crypto AssetQuote /
// AssetDescriptor. Throwing on any failed assertion is how selftest-all.mjs marks
// this source failed. Mirrors src/main/data/adapters/dexscreener.ts (the adapter
// is TS and this runner is plain .mjs, so we re-derive the mapping here rather
// than build the project).

const SOURCE = 'dexscreener';
const SEARCH_URL = 'https://api.dexscreener.com/latest/dex/search?q=';
const Q = 'thena';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 NEXUS-7';

function assert(cond, msg) {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}

function liquidityUsd(p) {
  const v = p.liquidity?.usd;
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function isUsablePair(p) {
  return Boolean(p.chainId && p.pairAddress && p.baseToken?.symbol);
}

const res = await fetch(SEARCH_URL + encodeURIComponent(Q), { headers: { 'User-Agent': UA } });
assert(res.ok, `HTTP ${res.status} from search endpoint`);

const data = await res.json();
const pairs = (Array.isArray(data.pairs) ? data.pairs : []).filter(isUsablePair);
assert(pairs.length > 0, `expected usable pairs for q=${Q}`);

// highest-liquidity pair (same reducer as the adapter's bestPair)
const top = pairs.reduce((best, p) => (liquidityUsd(p) > liquidityUsd(best) ? p : best));

// confirm it really is the max liquidity, not just first
const maxLiq = Math.max(...pairs.map(liquidityUsd));
assert(liquidityUsd(top) === maxLiq, 'selected pair is not the highest-liquidity one');

const key = `${SOURCE}:${top.chainId}/${top.pairAddress}`;
const price = Number(top.priceUsd);
const cap = top.marketCap ?? top.fdv ?? null;

const quote = {
  key,
  symbol: top.baseToken?.symbol ?? '',
  name: top.baseToken?.name ?? top.baseToken?.symbol ?? '',
  kind: 'crypto',
  price: Number.isFinite(price) ? price : null,
  change24h: typeof top.priceChange?.h24 === 'number' ? top.priceChange.h24 : null,
  change7d: null,
  marketCap: typeof cap === 'number' && Number.isFinite(cap) ? cap : null,
  source: SOURCE,
  stale: false,
  asOf: Date.now()
};

// AssetQuote / AssetDescriptor contract assertions
assert(quote.kind === 'crypto', 'kind must be crypto');
assert(quote.source === SOURCE, 'source must be dexscreener');
assert(quote.key === `${SOURCE}:${top.chainId}/${top.pairAddress}`, 'key format dexscreener:<chainId>/<pairAddress>');
assert(typeof quote.symbol === 'string' && quote.symbol.length > 0, 'symbol present');
assert(typeof quote.name === 'string' && quote.name.length > 0, 'name present');
assert(quote.price === null || (typeof quote.price === 'number' && quote.price > 0), 'price is positive number or null');
assert(quote.change24h === null || typeof quote.change24h === 'number', 'change24h is number or null');
assert(quote.change7d === null, 'change7d must be null (no 7d from DexScreener)');
assert(quote.marketCap === null || (typeof quote.marketCap === 'number' && quote.marketCap >= 0), 'marketCap is number or null');
assert(Number.isInteger(quote.asOf) && quote.asOf > 0, 'asOf is epoch ms');

console.log(`[selftest dexscreener] OK q=${Q}: chainId=${top.chainId} pair=${top.pairAddress}`);
console.log(
  `  -> ${quote.symbol} (${quote.name}) $${quote.price} 24h=${quote.change24h}% mcap=${quote.marketCap} liq=$${Math.round(
    liquidityUsd(top)
  )} key=${quote.key}`
);
