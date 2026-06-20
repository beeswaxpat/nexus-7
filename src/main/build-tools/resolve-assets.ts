// Build-time tool: resolve the DEFAULT asset ids (owner + friend) into
// resources/asset-registry.json so first launch never depends on a live search
// call succeeding. It hits the same keyless adapters the app uses (CoinGecko for
// crypto ids, Yahoo for stock tickers) to capture each asset's real symbol + name,
// and falls back to a key-derived descriptor if a source is briefly down, so the
// registry always covers the full default set.
//
// Run AFTER the TypeScript build (it is CommonJS, like the rest of main):
//   tsc -p tsconfig.main.json && node dist-electron/main/build-tools/resolve-assets.js
//
// resolveDefaultAssets() keeps its FROZEN no-arg signature and returns the resolved
// set; running the file as a script also writes the JSON to disk.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { AssetDescriptor } from '../../shared/types';
import { DEFAULT_FRIEND_KEYS, DEFAULT_OWNER_KEYS, CENTER_COIN_ID } from '../../shared/constants';
import { fetchMarkets } from '../data/adapters/coingecko';
import { fetchQuotes } from '../data/adapters/yahoo';

/** Split a 'namespace:id' key. */
function parseKey(key: string): { ns: string; id: string } {
  const idx = key.indexOf(':');
  if (idx < 0) return { ns: 'coingecko', id: key };
  return { ns: key.slice(0, idx), id: key.slice(idx + 1) };
}

/** Walk up from a starting dir to the first folder containing package.json. */
function findProjectRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return start;
}

/** Last-resort descriptor when a source cannot confirm a key (kind by namespace). */
function fallbackDescriptor(key: string): AssetDescriptor {
  const { ns, id } = parseKey(key);
  if (ns === 'yahoo') {
    const sym = id.toUpperCase();
    return { key, symbol: sym, name: sym, kind: 'stock', source: 'yahoo' };
  }
  if (ns === 'dexscreener') {
    return { key, symbol: id, name: id, kind: 'crypto', source: 'dexscreener' };
  }
  // coingecko (or unknown -> treat as coingecko id)
  return { key, symbol: id.toUpperCase(), name: id, kind: 'crypto', source: 'coingecko' };
}

/**
 * Resolve the default owner + friend ids (plus the center coin) into descriptors.
 * CoinGecko ids resolve in one batched markets call; Yahoo tickers resolve per-symbol.
 * Order: center coin first, then owner, then friend, de-duplicated by key.
 */
export async function resolveDefaultAssets(): Promise<AssetDescriptor[]> {
  // Build the ordered, de-duplicated key list (bitcoin first so it always exists).
  const orderedKeys: string[] = [];
  const seen = new Set<string>();
  const push = (k: string): void => {
    if (!seen.has(k)) {
      seen.add(k);
      orderedKeys.push(k);
    }
  };
  push(`coingecko:${CENTER_COIN_ID}`);
  for (const k of DEFAULT_OWNER_KEYS) push(k);
  for (const k of DEFAULT_FRIEND_KEYS) push(k);

  // Bucket by namespace so each source gets one batched call where possible.
  const cgIds: string[] = [];
  const yahooSyms: string[] = [];
  for (const k of orderedKeys) {
    const { ns, id } = parseKey(k);
    if (ns === 'coingecko') cgIds.push(id);
    else if (ns === 'yahoo') yahooSyms.push(id);
  }

  // Resolve each source, tolerating failure (we fall back per key below).
  const cgByKey = new Map<string, AssetDescriptor>();
  try {
    const quotes = await fetchMarkets(cgIds);
    for (const q of quotes) {
      cgByKey.set(q.key, {
        key: q.key,
        symbol: q.symbol,
        name: q.name,
        kind: 'crypto',
        source: 'coingecko'
      });
    }
  } catch (err) {
    console.warn('[resolve-assets] CoinGecko batch failed, using fallbacks:', String(err));
  }

  const yahooByKey = new Map<string, AssetDescriptor>();
  try {
    const quotes = await fetchQuotes(yahooSyms);
    for (const q of quotes) {
      yahooByKey.set(q.key, {
        key: q.key,
        symbol: q.symbol,
        name: q.name,
        kind: 'stock',
        source: 'yahoo'
      });
    }
  } catch (err) {
    console.warn('[resolve-assets] Yahoo batch failed, using fallbacks:', String(err));
  }

  // Assemble in the original order, falling back to a key-derived descriptor.
  const out: AssetDescriptor[] = [];
  for (const key of orderedKeys) {
    const resolved = cgByKey.get(key) ?? yahooByKey.get(key) ?? fallbackDescriptor(key);
    out.push(resolved);
  }
  return out;
}

/** Write resources/asset-registry.json. Returns the written path. */
export async function writeRegistry(): Promise<string> {
  const descriptors = await resolveDefaultAssets();
  const root = findProjectRoot(__dirname);
  const outDir = join(root, 'resources');
  const outFile = join(outDir, 'asset-registry.json');
  mkdirSync(outDir, { recursive: true });

  const payload = {
    generatedAt: new Date().toISOString(),
    centerCoinKey: `coingecko:${CENTER_COIN_ID}`,
    ownerKeys: [...DEFAULT_OWNER_KEYS],
    friendKeys: [...DEFAULT_FRIEND_KEYS],
    assets: descriptors
  };
  writeFileSync(outFile, JSON.stringify(payload, null, 2) + '\n', 'utf-8');
  return outFile;
}

// Run as a script: `node dist-electron/main/build-tools/resolve-assets.js`.
// require.main === module is the CommonJS "is this the entry point" check.
if (require.main === module) {
  writeRegistry()
    .then((file) => {
      console.log('[resolve-assets] wrote', file);
      process.exit(0);
    })
    .catch((err) => {
      console.error('[resolve-assets] failed:', err);
      process.exit(1);
    });
}
