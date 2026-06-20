// Bakes the current live settings into a first-run seed for the buddy build.
//
// Reads the running app's saved profile from %APPDATA%\NEXUS-7\settings.json,
// strips the personal `username` field, and writes resources/seed-settings.json
// (pretty-printed). settings-store.ts picks that file up on a clean machine: when
// no settings.json exists yet it merges the seed over defaults and persists, so a
// fresh exe opens already configured.
//
// Buddy-build recipe:
//   1. Run the app and configure it exactly how the buddy should see it (boxes,
//      holdings, titles, scenes, theme).
//   2. Close the app (so settings.json is flushed to %APPDATA%\NEXUS-7).
//   3. node scripts/make-seed.mjs
//   4. npm run build:exe
// The seed is intentionally NOT committed; regenerate it per build. Run: node
// scripts/make-seed.mjs

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');

const appData = process.env.APPDATA;
if (!appData) {
  console.error('[make-seed] APPDATA is not set; this script must run on Windows.');
  process.exit(1);
}

const sourcePath = join(appData, 'NEXUS-7', 'settings.json');
if (!existsSync(sourcePath)) {
  console.error(`[make-seed] no settings to seed from: ${sourcePath} does not exist.`);
  console.error('[make-seed] run the app, configure it, close it, then re-run this script.');
  process.exit(1);
}

let settings;
try {
  settings = JSON.parse(readFileSync(sourcePath, 'utf-8'));
} catch (err) {
  console.error(`[make-seed] could not parse ${sourcePath}:`, err.message);
  process.exit(1);
}

// Drop the personal field: the seed is shared, the username is not.
delete settings.username;

const outPath = join(PROJECT_ROOT, 'resources', 'seed-settings.json');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(settings, null, 2), 'utf-8');

console.log(`[make-seed] wrote ${outPath}`);
console.log('[make-seed] next: npm run build:exe');
