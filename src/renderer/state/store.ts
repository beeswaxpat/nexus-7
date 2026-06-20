// Tiny typed pub/sub store. Keeps the renderer framework-free and the wormhole at
// 60fps. Panels subscribe to the keys they care about; feeds.ts writes them.

import type {
  AssetQuote,
  Candle,
  FngData,
  NewsItem,
  SatElement,
  SourceStatus,
  TickerCoin
} from '../../shared/types';

export interface AppState {
  crypto: AssetQuote[];
  stocks: AssetQuote[];
  fng: FngData | null;
  news: NewsItem[];
  ticker: TickerCoin[];
  candles: Candle[];
  statuses: SourceStatus[];
  sats: SatElement[];
}

type Key = keyof AppState;
type Listener<K extends Key> = (value: AppState[K]) => void;

const state: AppState = {
  crypto: [],
  stocks: [],
  fng: null,
  news: [],
  ticker: [],
  candles: [],
  statuses: [],
  sats: []
};

const listeners: { [K in Key]?: Set<Listener<K>> } = {};

export const store = {
  get<K extends Key>(key: K): AppState[K] {
    return state[key];
  },
  set<K extends Key>(key: K, value: AppState[K]): void {
    state[key] = value;
    const set = listeners[key] as Set<Listener<K>> | undefined;
    // Isolate each listener: one throwing subscriber (e.g. a panel choking on a
    // malformed quote or a detached node) must not abort the dispatch loop and
    // starve every later subscriber for this key.
    if (set) for (const fn of set) {
      try {
        fn(value);
      } catch (err) {
        console.error('[store] listener threw for key', key, err);
      }
    }
  },
  /** Subscribe to a key. Fires immediately with the current value. Returns unsub. */
  subscribe<K extends Key>(key: K, fn: Listener<K>): () => void {
    let set = listeners[key] as Set<Listener<K>> | undefined;
    if (!set) {
      set = new Set<Listener<K>>();
      listeners[key] = set as never;
    }
    set.add(fn);
    fn(state[key]);
    return () => set!.delete(fn);
  }
};
