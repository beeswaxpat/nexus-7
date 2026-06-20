// Selftest harness. Phase 1 adds one `selftest-<adapter>.mjs` per data source that
// hits the live endpoint and asserts a normalized AssetQuote / Candle / NewsItem.
// This runner discovers and runs them all. With no adapter selftests present yet it
// reports a clean no-op so `npm run selftest` succeeds in Phase 0.

import { readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

const files = readdirSync(here).filter(
  (f) => f.startsWith('selftest-') && f.endsWith('.mjs') && f !== 'selftest-all.mjs'
);

if (files.length === 0) {
  console.log('[selftest] no adapter selftests yet (added in Phase 1). OK.');
  process.exit(0);
}

let failed = 0;
for (const f of files) {
  try {
    console.log(`\n[selftest] ${f}`);
    await import(pathToFileURL(join(here, f)).href);
  } catch (err) {
    failed++;
    console.error(`[selftest] FAILED: ${f}\n`, err);
  }
}

console.log(`\n[selftest] done. ${files.length - failed}/${files.length} passed.`);
process.exit(failed === 0 ? 0 : 1);
