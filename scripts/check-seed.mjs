// Pre-packaging guard. electron-builder bundles resources/** into the asar, so a
// PERSONAL resources/seed-settings.json (real holdings) would ship inside the exe.
// This runs from `npm run build:exe` and refuses to package while a seed is present
// that is not byte-for-byte the neutral example, unless NEXUS_ALLOW_SEED=1 is set
// on purpose (a deliberate personal build). No seed at all is the normal case.

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const seed = join(root, 'resources', 'seed-settings.json');
const example = join(root, 'resources', 'seed-settings.example.json');

if (!existsSync(seed)) {
  console.log('[check-seed] no resources/seed-settings.json: packaging plain defaults. OK.');
  process.exit(0);
}

const norm = (p) => JSON.stringify(JSON.parse(readFileSync(p, 'utf-8').replace(/^﻿/, '')));
let sameAsExample = false;
try {
  sameAsExample = existsSync(example) && norm(seed) === norm(example);
} catch (err) {
  console.error('[check-seed] seed is not valid JSON:', err instanceof Error ? err.message : err);
  process.exit(1);
}

if (sameAsExample) {
  console.log('[check-seed] seed equals the neutral example: OK to package.');
  process.exit(0);
}

if (process.env.NEXUS_ALLOW_SEED === '1') {
  console.warn('[check-seed] WARNING: packaging a NON-example seed because NEXUS_ALLOW_SEED=1. Keep this exe local.');
  process.exit(0);
}

console.error(
  '[check-seed] REFUSING to package: resources/seed-settings.json differs from the neutral example.\n' +
    '  It would ship inside the exe. Move it aside, or set NEXUS_ALLOW_SEED=1 for a deliberate personal build.'
);
process.exit(1);
