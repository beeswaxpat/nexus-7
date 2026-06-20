// Persists Settings to app.getPath('userData')/settings.json. Defaults come from
// constants.defaultSettings(); saved values are merged over them so new fields
// added later still get sane defaults on old profiles.

import { app } from 'electron';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  defaultSettings,
  DEFAULT_BOX_TITLES,
  DEFAULT_FRIEND_KEYS,
  DEFAULT_OWNER_KEYS,
  LEGACY_BOX_TITLES,
  LEGACY_FRIEND_KEYS,
  LEGACY_OWNER_KEYS
} from '../../shared/constants';
import type { Settings } from '../../shared/types';

let cached: Settings | null = null;

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json');
}

// First-run seed: a portfolio baked into the build so the buddy exe opens already
// configured. app.getAppPath() resolves inside app.asar in production (fs reads
// through asar transparently) and the project root in dev; both fine. Generated
// offline by scripts/make-seed.mjs and never present in the repo, so absence is
// the normal case and just means plain defaults.
function seedPath(): string {
  return join(app.getAppPath(), 'resources', 'seed-settings.json');
}

/**
 * Read a JSON file as UTF-8 and strip a leading byte-order mark before parsing.
 * readFileSync('utf-8') does NOT strip a BOM and JSON.parse throws on a leading
 * U+FEFF, so a settings.json hand-edited in an editor that saves-with-BOM (Notepad,
 * PowerShell Out-File) would otherwise be unreadable. Throws on genuinely malformed
 * JSON so callers can distinguish a parse failure from an absent file.
 */
function readJsonFile<T>(file: string): T {
  const raw = readFileSync(file, 'utf-8');
  const txt = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  return JSON.parse(txt) as T;
}

/**
 * Back up an unparseable settings file (rename to .bak) so a malformed hand-edit is
 * recoverable instead of being silently overwritten with defaults on the next write.
 * Best-effort: a failure to rename is logged and ignored, never thrown.
 */
function backupCorruptFile(file: string): void {
  try {
    if (existsSync(file)) {
      const bak = `${file}.bak`;
      renameSync(file, bak);
      console.error('[settings] unparseable settings backed up to', bak);
    }
  } catch (err) {
    console.error('[settings] could not back up corrupt settings:', err);
  }
}

function deepMerge(base: Settings, saved: Partial<Settings>): Settings {
  return {
    ...base,
    ...saved,
    chaos: { ...base.chaos, ...(saved.chaos ?? {}) },
    boxTitles: { ...base.boxTitles, ...(saved.boxTitles ?? {}) },
    holdings: { ...base.holdings, ...(saved.holdings ?? {}) },
    scenes: { ...base.scenes, ...(saved.scenes ?? {}) },
    // Deep-merge leftFlex too, so a partial weight patch (e.g. {leftFlex:{friend:2}})
    // keeps the sibling weights instead of dropping them. base.leftFlex is always the
    // complete default object from defaultSettings(), so the merged result is complete.
    leftFlex: mergeLeftFlex(base.leftFlex, saved.leftFlex),
    // arrays replace wholesale when present
    friendAssets: Array.isArray(saved.friendAssets) ? saved.friendAssets : base.friendAssets,
    ownerAssets: Array.isArray(saved.ownerAssets) ? saved.ownerAssets : base.ownerAssets
  };
}

/** Merge a (possibly partial) leftFlex patch over the complete default weights. */
function mergeLeftFlex(
  base: Settings['leftFlex'],
  saved: Settings['leftFlex']
): Settings['leftFlex'] {
  const b = base ?? defaultSettings().leftFlex ?? { friend: 1, owner: 1, chart: 1.25 };
  return { friend: b.friend, owner: b.owner, chart: b.chart, ...(saved ?? {}) };
}

/**
 * Old profiles persisted the pre-rename default titles wholesale (any save bakes
 * the full Settings object into settings.json), so a default rename alone never
 * reaches them. Swap a saved legacy default for the current one; user-chosen
 * custom names are left alone.
 */
function migrateLegacyTitles(s: Settings): Settings {
  const friend = s.boxTitles.friend === LEGACY_BOX_TITLES.friend ? DEFAULT_BOX_TITLES.friend : s.boxTitles.friend;
  const owner = s.boxTitles.owner === LEGACY_BOX_TITLES.owner ? DEFAULT_BOX_TITLES.owner : s.boxTitles.owner;
  if (friend === s.boxTitles.friend && owner === s.boxTitles.owner) return s;
  return { ...s, boxTitles: { friend, owner } };
}

/** True when two key lists match exactly, order-sensitive. */
function sameKeys(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((k, i) => k === b[i]);
}

/**
 * Mirror of migrateLegacyTitles for the default asset lists: a saved list that
 * still equals the OLD default list exactly (order-sensitive) is swapped for the
 * current defaults. Users who edited their lists keep them untouched.
 */
function migrateLegacyAssetDefaults(s: Settings): Settings {
  const friendIsLegacy = sameKeys(s.friendAssets ?? [], LEGACY_FRIEND_KEYS);
  const ownerIsLegacy = sameKeys(s.ownerAssets ?? [], LEGACY_OWNER_KEYS);
  if (!friendIsLegacy && !ownerIsLegacy) return s;
  return {
    ...s,
    friendAssets: friendIsLegacy ? [...DEFAULT_FRIEND_KEYS] : s.friendAssets,
    ownerAssets: ownerIsLegacy ? [...DEFAULT_OWNER_KEYS] : s.ownerAssets
  };
}

function load(): Settings {
  if (cached) return cached;
  const base = defaultSettings();
  const file = settingsPath();
  if (existsSync(file)) {
    // An existing profile always wins; the seed is first-run only. A parse failure
    // here must NOT silently fall through to defaults, because load() caches those
    // defaults and the very next persist() would overwrite the (possibly recoverable)
    // file with them, destroying the user's real profile. Back the bad file up first.
    try {
      const raw = readJsonFile<Partial<Settings>>(file);
      cached = migrateLegacyAssetDefaults(migrateLegacyTitles(deepMerge(base, raw)));
    } catch (err) {
      console.error('[settings] existing profile unparseable, backing up + using defaults:', err);
      backupCorruptFile(file);
      cached = base;
    }
    return cached;
  }
  // No profile yet: try the bundled seed before plain defaults. On success we
  // persist immediately (write-through) so the first run materializes settings.json
  // from the seed, making the seed observable and testable. Any failure (missing
  // seed, bad JSON, unreadable path) falls through to plain defaults: the seed is a
  // convenience, never a requirement.
  try {
    const seed = loadSeed();
    if (seed) {
      cached = migrateLegacyAssetDefaults(migrateLegacyTitles(deepMerge(base, seed)));
      persist(cached);
    } else {
      cached = base;
    }
  } catch (err) {
    console.error('[settings] load failed, using defaults:', err);
    cached = base;
  }
  return cached;
}

/** Read+parse the first-run seed if it exists; null on absence or any error. */
function loadSeed(): Partial<Settings> | null {
  try {
    const file = seedPath();
    if (!existsSync(file)) return null;
    return readJsonFile<Partial<Settings>>(file);
  } catch (err) {
    console.error('[settings] seed load failed, using defaults:', err);
    return null;
  }
}

function persist(next: Settings): void {
  cached = next;
  try {
    const file = settingsPath();
    mkdirSync(dirname(file), { recursive: true });
    // Atomic write: stage the JSON in a sibling .tmp, then rename over the live file.
    // A same-volume rename is atomic on Windows and POSIX, so a crash, power loss, or
    // full disk mid-write never leaves a truncated settings.json: a reader sees either
    // the old complete file or the new complete file, not a half-written one. A failed
    // temp write or rename leaves the prior good file untouched (the catch just logs).
    const tmp = `${file}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf-8');
      renameSync(tmp, file);
    } catch (err) {
      // Best-effort: remove the leftover temp so a failed write does not litter userData.
      try {
        if (existsSync(tmp)) rmSync(tmp);
      } catch {
        // ignore cleanup failure, nothing recoverable to do here
      }
      throw err;
    }
  } catch (err) {
    console.error('[settings] save failed:', err);
  }
}

/** Return the current settings (loads + caches on first call). */
export function getSettings(): Settings {
  return load();
}

/** Patch settings (nested chaos/boxTitles/holdings/scenes/leftFlex are deep-merged; asset arrays replace wholesale), persist, and return the result. */
export function setSettings(patch: Partial<Settings>): Settings {
  // Guard the IPC boundary: a non-object patch (null/undefined/primitive) from the
  // renderer must not throw inside deepMerge (which reads patch.chaos etc.).
  const p: Partial<Settings> = patch && typeof patch === 'object' ? patch : {};
  const next = deepMerge(load(), p);
  persist(next);
  return next;
}

/** Add an asset key to the friend box (no duplicates), persist, return settings. */
export function addAsset(key: string): Settings {
  const cur = load();
  // Ignore a non-string/empty key rather than persisting JSON null into friendAssets.
  if (typeof key !== 'string' || key.length === 0) return cur;
  if (cur.friendAssets.includes(key)) return cur;
  return setSettings({ friendAssets: [...cur.friendAssets, key] });
}

/** Remove an asset key from the friend box, persist, return settings. */
export function removeAsset(key: string): Settings {
  const cur = load();
  if (typeof key !== 'string' || key.length === 0) return cur;
  return setSettings({ friendAssets: cur.friendAssets.filter((k) => k !== key) });
}
