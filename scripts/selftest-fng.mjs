// Live self-test for the Fear & Greed adapter (src/main/data/adapters/fng.ts).
// Hits the real keyless endpoint and asserts the normalized FngData contract that
// fetchFng() produces: numeric `value` (0..100), non-empty `classification`, and
// an `asOf` epoch-ms timestamp. Runs under plain `node` (no TS build), so it
// mirrors the adapter's fetch + normalize rather than importing the .ts source.
// The selftest-all.mjs runner imports this module and treats any throw as a fail.

const URL = 'https://api.alternative.me/fng/?limit=1';

function assert(cond, msg) {
  if (!cond) throw new Error(`[fng] assertion failed: ${msg}`);
}

const res = await fetch(URL);
assert(res.ok, `HTTP ${res.status} from ${URL}`);

const json = await res.json();
const row = json?.data?.[0];
assert(row, 'response has data[0]');

// Mirror fetchFng() normalization exactly.
const value = Number(row.value);
const classification = row.value_classification ?? '';
const asOf = Date.now();

assert(Number.isFinite(value), `value is numeric (got '${row.value}')`);
assert(value >= 0 && value <= 100, `value in 0..100 (got ${value})`);
assert(typeof classification === 'string' && classification.length > 0, 'classification is a non-empty string');
assert(Number.isInteger(asOf) && asOf > 0, 'asOf is a positive epoch-ms integer');

console.log(`[fng] OK  value=${value}  classification="${classification}"  asOf=${asOf}`);
