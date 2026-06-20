// Self-test for the CoinGecko adapter. Hits the live keyless API the same way
// src/main/data/adapters/coingecko.ts does (one batched /coins/markets call) and
// prints a normalized AssetQuote-shaped row per id, then reports any that did not
// resolve. Run: node scripts/selftest-coingecko.mjs
//
// This mirrors the adapter's request + field mapping exactly so a pass here
// validates the real adapter logic against the live endpoint. (The .ts adapter
// is not imported directly because this runs under plain node, not the TS build.)

const API = 'https://api.coingecko.com/api/v3';
const SOURCE = 'coingecko';
const IDS = ['bitcoin', 'plasma', 'aleo', 'thena', 'ripple', 'solana', 'hyperliquid'];

const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 NEXUS-7';

function toQuote(row) {
  return {
    key: `${SOURCE}:${row.id}`,
    symbol: (row.symbol ?? '').toUpperCase(),
    name: row.name,
    kind: 'crypto',
    price: row.current_price ?? null,
    change24h: row.price_change_percentage_24h_in_currency ?? null,
    change7d: row.price_change_percentage_7d_in_currency ?? null,
    marketCap: row.market_cap ?? null,
    source: SOURCE,
    stale: false,
    asOf: Date.now()
  };
}

async function main() {
  const params = new URLSearchParams({
    vs_currency: 'usd',
    ids: IDS.join(','),
    price_change_percentage: '24h,7d',
    sparkline: 'false'
  });
  const url = `${API}/coins/markets?${params.toString()}`;
  console.log('GET', url, '\n');

  const res = await fetch(url, {
    headers: { 'User-Agent': DESKTOP_UA, Accept: 'application/json' }
  });
  if (!res.ok) {
    console.error(`HTTP ${res.status} ${res.statusText}`);
    process.exit(1);
  }
  const rows = await res.json();
  const quotes = rows.map(toQuote);

  const byId = new Map(quotes.map((q) => [q.key.slice(SOURCE.length + 1), q]));

  for (const id of IDS) {
    const q = byId.get(id);
    if (!q) {
      console.log(`MISSING  ${id}`);
      continue;
    }
    const price = q.price === null ? 'n/a' : `$${q.price}`;
    const c24 = q.change24h === null ? 'n/a' : `${q.change24h.toFixed(2)}%`;
    const c7 = q.change7d === null ? 'n/a' : `${q.change7d.toFixed(2)}%`;
    const cap = q.marketCap === null ? 'n/a' : `$${q.marketCap.toLocaleString('en-US')}`;
    console.log(
      `OK  ${q.key.padEnd(22)} ${q.symbol.padEnd(6)} ${q.name.padEnd(14)} ` +
        `price=${price.padEnd(12)} 24h=${c24.padEnd(9)} 7d=${c7.padEnd(9)} cap=${cap}`
    );
  }

  const resolved = IDS.filter((id) => byId.has(id));
  const missing = IDS.filter((id) => !byId.has(id));
  console.log(`\nResolved ${resolved.length}/${IDS.length}.`);
  if (missing.length > 0) {
    console.log(`Did NOT resolve: ${missing.join(', ')}`);
    process.exit(2);
  }
  console.log('All ids resolved.');
}

main().catch((err) => {
  console.error('Self-test failed:', err);
  process.exit(1);
});
