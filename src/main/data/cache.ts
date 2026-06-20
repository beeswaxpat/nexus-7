// TTL + last-good cache. The scheduler writes fresh values here; on a fetch
// failure the last-good value is served with stale=true so the UI never blanks.

import type {
  AssetQuote,
  Candle,
  FngData,
  NewsItem,
  SatElement,
  Snapshot,
  SourceStatus,
  TickerCoin
} from '../../shared/types';

interface CacheState {
  crypto: AssetQuote[];
  stocks: AssetQuote[];
  fng: FngData | null;
  news: NewsItem[];
  ticker: TickerCoin[];
  candles: Candle[];
  statuses: Map<string, SourceStatus>;
  sats: SatElement[];
}

const state: CacheState = {
  crypto: [],
  stocks: [],
  fng: null,
  news: [],
  ticker: [],
  candles: [],
  statuses: new Map(),
  sats: []
};

export const cache = {
  setCrypto(v: AssetQuote[]): void {
    state.crypto = v;
  },
  getCrypto(): AssetQuote[] {
    return state.crypto;
  },
  setStocks(v: AssetQuote[]): void {
    state.stocks = v;
  },
  getStocks(): AssetQuote[] {
    return state.stocks;
  },
  setFng(v: FngData): void {
    // Once set, fng is never cleared back to null; it is nullable only for the initial state.
    state.fng = v;
  },
  getFng(): FngData | null {
    return state.fng;
  },
  setNews(v: NewsItem[]): void {
    state.news = v;
  },
  getNews(): NewsItem[] {
    return state.news;
  },
  setTicker(v: TickerCoin[]): void {
    state.ticker = v;
  },
  getTicker(): TickerCoin[] {
    return state.ticker;
  },
  setCandles(v: Candle[]): void {
    state.candles = v;
  },
  getCandles(): Candle[] {
    return state.candles;
  },
  /** Upsert a single live candle (replace by time, else append, keep sorted). */
  upsertCandle(c: Candle): void {
    const arr = state.candles;
    const idx = arr.findIndex((x) => x.time === c.time);
    if (idx >= 0) arr[idx] = c;
    else {
      arr.push(c);
      arr.sort((a, b) => a.time - b.time);
    }
  },
  setStatus(s: SourceStatus): void {
    state.statuses.set(s.source, s);
  },
  getStatuses(): SourceStatus[] {
    return [...state.statuses.values()];
  },
  setSats(v: SatElement[]): void {
    state.sats = v;
  },
  getSats(): SatElement[] {
    return state.sats;
  },
  /** Full snapshot for data:get-snapshot so the renderer paints instantly. */
  snapshot(): Snapshot {
    return {
      crypto: state.crypto,
      stocks: state.stocks,
      fng: state.fng,
      news: state.news,
      ticker: state.ticker,
      candles: state.candles,
      statuses: [...state.statuses.values()],
      sats: state.sats
    };
  }
};
