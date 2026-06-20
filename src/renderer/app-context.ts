// The context object threaded into every panel mount. Panels read live data from
// `store` (seeded by feeds.ts), call the `bridge` for requests, and read/update
// `settings`. This keeps panels decoupled: they never import main.ts.

import type { Bridge } from './bridge';
import type { Settings } from '../shared/types';
import type { store as Store } from './state/store';
import * as settingsApi from './state/settings';

export interface AppContext {
  bridge: Bridge;
  store: typeof Store;
  settings: Settings;
  /** Persist a settings patch and refresh ctx.settings + the cache. */
  updateSettings: (patch: Partial<Settings>) => Promise<Settings>;
}

/** Build the context. main.ts calls this after settings are loaded. */
export function createContext(bridge: Bridge, store: typeof Store, settings: Settings): AppContext {
  const ctx: AppContext = {
    bridge,
    store,
    settings,
    updateSettings: async (patch) => {
      const next = await settingsApi.update(patch);
      ctx.settings = next;
      return next;
    }
  };
  return ctx;
}
