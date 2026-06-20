// Cached settings for the renderer. main.ts loads settings via the bridge once at
// startup and seeds this; panels read getCachedSettings() synchronously and call
// update(patch) to persist + refresh the cache.

import { defaultSettings } from '../../shared/constants';
import type { Settings } from '../../shared/types';
import type { Bridge } from '../bridge';

let cached: Settings = defaultSettings();
let bridgeRef: Bridge | null = null;

/** Wire the bridge and seed the cache with the persisted settings. */
export async function initSettings(bridge: Bridge): Promise<Settings> {
  bridgeRef = bridge;
  cached = await bridge.getSettings();
  return cached;
}

/** Synchronous read of the last-known settings. */
export function getCachedSettings(): Settings {
  return cached;
}

/** Persist a patch through the bridge and refresh the cache. */
export async function update(patch: Partial<Settings>): Promise<Settings> {
  if (!bridgeRef) {
    cached = {
      ...cached,
      ...patch,
      chaos: { ...cached.chaos, ...(patch.chaos ?? {}) },
      boxTitles: { ...cached.boxTitles, ...(patch.boxTitles ?? {}) },
      holdings: { ...cached.holdings, ...(patch.holdings ?? {}) },
      scenes: { ...cached.scenes, ...(patch.scenes ?? {}) }
    };
    return cached;
  }
  cached = await bridgeRef.setSettings(patch);
  return cached;
}
