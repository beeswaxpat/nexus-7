// REAL plumbing. One job per source: read settings, build the crypto id list
// (owner + friend crypto keys + bitcoin) and the stock symbol list (friend yahoo
// keys), call the adapter on each POLL interval, update the cache, webContents.send
// the matching PUSH_* channel, and emit PUSH_STATUS. ~10% jitter per tick. The
// candle live ticker is opened once. Adapters are stubs today, so this pushes mock
// data; when adapters become real this file does NOT change.

import type { BrowserWindow } from 'electron';
import { IPC } from '../../shared/ipc-channels';
import { CENTER_COIN_ID, POLL, SPCX_IPO } from '../../shared/constants';
import type { AssetQuote, Candle, SourceStatus } from '../../shared/types';
import { cache } from './cache';
import { getSettings } from '../store/settings-store';
import { fetchMarkets } from './adapters/coingecko';
import { fetchQuotes } from './adapters/yahoo';
import { fetchFng } from './adapters/fng';
import { fetchNews } from './adapters/news';
import { fetchTicker } from './adapters/market-ticker';
import { fetchCandles, openLiveTicker } from './adapters/coinbase-candles';
import { fetchQuoteByPair } from './adapters/dexscreener';
import { fetchSats } from './adapters/celestrak';

const timers: NodeJS.Timeout[] = [];
let disposeLiveTicker: (() => void) | null = null;
/** Kept so notifySettingsChanged can re-run jobs without threading the window through. */
let activeWin: BrowserWindow | null = null;

/** Split a 'namespace:id' key. */
function parseKey(key: string): { ns: string; id: string } {
  const idx = key.indexOf(':');
  if (idx < 0) return { ns: 'coingecko', id: key };
  return { ns: key.slice(0, idx), id: key.slice(idx + 1) };
}

/** Every configured asset key: both boxes + the featured center + the second slot. */
function allKeys(): string[] {
  const s = getSettings();
  // The re-pointable second-slot asset rides along too so a non-SPCX slot gets polled.
  // SPCX still always rides via stockSymbols()'s SPCX_IPO seed, so the default is unaffected.
  return [...(s.ownerAssets ?? []), ...(s.friendAssets ?? []), s.centerAsset, s.secondaryAsset].filter(
    (k): k is string => typeof k === 'string' && k.length > 0
  );
}

/** CoinGecko ids to poll: both boxes' crypto + center asset + bitcoin. */
function cryptoIds(): string[] {
  const keys = allKeys();
  // bitcoin always rides along: the candle chart streams BTC regardless of center.
  const ids = new Set<string>([CENTER_COIN_ID]);
  for (const k of keys) {
    const { ns, id } = parseKey(k);
    if (ns === 'coingecko') ids.add(id);
  }
  return [...ids];
}

/**
 * Yahoo ticker symbols to poll: both boxes' stock keys + a stock center asset.
 * SPCX always rides along; it yields no quote until SpaceX is publicly listed,
 * and the adapter tolerates an empty per-symbol result either way.
 */
function stockSymbols(): string[] {
  const syms = new Set<string>([SPCX_IPO.symbol]);
  for (const k of allKeys()) {
    const { ns, id } = parseKey(k);
    if (ns === 'yahoo') syms.add(id);
  }
  return [...syms];
}

/**
 * DEX-only friend assets to refresh, as {key, chainId, pairAddress}. The id half of a
 * 'dexscreener:<chainId>/<pairAddress>' key is '<chainId>/<pairAddress>'. These ride
 * along the crypto job (same 60s cadence) so a friend-added DEX token gets live rows.
 */
function dexPairs(): Array<{ key: string; chainId: string; pairAddress: string }> {
  const out: Array<{ key: string; chainId: string; pairAddress: string }> = [];
  const seen = new Set<string>();
  for (const k of allKeys()) {
    if (seen.has(k)) continue;
    seen.add(k);
    const { ns, id } = parseKey(k);
    if (ns !== 'dexscreener') continue;
    const slash = id.indexOf('/');
    if (slash < 0) continue;
    const chainId = id.slice(0, slash);
    const pairAddress = id.slice(slash + 1);
    if (chainId && pairAddress) out.push({ key: k, chainId, pairAddress });
  }
  return out;
}

/** ~10% jitter so jobs do not align and hammer a source on the same tick. */
function jitter(intervalMs: number): number {
  return intervalMs * (1 + (Math.random() * 2 - 1) * 0.1);
}

function send(win: BrowserWindow, channel: string, payload: unknown): void {
  if (win.isDestroyed()) return;
  win.webContents.send(channel, payload);
}

function pushStatus(win: BrowserWindow, source: string, ok: boolean, error?: string): void {
  const prev = cache.getStatuses().find((s) => s.source === source);
  const status: SourceStatus = {
    source,
    ok,
    lastSuccess: ok ? Date.now() : prev?.lastSuccess ?? 0,
    lastError: ok ? undefined : error
  };
  cache.setStatus(status);
  send(win, IPC.PUSH_STATUS, status);
}

/** Mark cached quotes stale and re-push them when a fetch fails (last-good serve). */
function serveStale(win: BrowserWindow, kind: 'crypto' | 'stocks'): void {
  const list = kind === 'crypto' ? cache.getCrypto() : cache.getStocks();
  if (list.length === 0) return;
  const stale = list.map((q) => ({ ...q, stale: true }));
  if (kind === 'crypto') {
    cache.setCrypto(stale);
    send(win, IPC.PUSH_CRYPTO, stale);
  } else {
    cache.setStocks(stale);
    send(win, IPC.PUSH_STOCKS, stale);
  }
}

// ---- jobs -----------------------------------------------------------------

/** Refresh all DEX-only friend assets in parallel, tolerating per-pair failures. */
async function fetchDexQuotes(): Promise<AssetQuote[]> {
  const pairs = dexPairs();
  if (pairs.length === 0) return [];
  const settled = await Promise.allSettled(
    pairs.map((p) => fetchQuoteByPair(p.chainId, p.pairAddress))
  );
  const out: AssetQuote[] = [];
  for (const r of settled) {
    if (r.status === 'fulfilled' && r.value) out.push(r.value);
  }
  return out;
}

async function jobCrypto(win: BrowserWindow): Promise<void> {
  const ids = cryptoIds();
  const hasDex = dexPairs().length > 0;
  // cryptoIds() always seeds CENTER_COIN_ID, so ids is never empty; this guard is effectively !hasDex.
  if (ids.length === 0 && !hasDex) return;

  // DEX runs independently of CoinGecko so one source failing does not blank the other.
  const dexQuotes = await fetchDexQuotes();
  try {
    const cgQuotes: AssetQuote[] = ids.length > 0 ? await fetchMarkets(ids) : [];
    const quotes = [...cgQuotes, ...dexQuotes];
    cache.setCrypto(quotes);
    send(win, IPC.PUSH_CRYPTO, quotes);
    pushStatus(win, 'coingecko', true);
    if (hasDex) pushStatus(win, 'dexscreener', dexQuotes.length > 0);
  } catch (err) {
    pushStatus(win, 'coingecko', false, String(err));
    // CoinGecko failed: still surface fresh DEX rows merged over the last-good crypto
    // set (marked stale) so neither half blanks the box.
    if (dexQuotes.length > 0) {
      const dexKeys = new Set(dexQuotes.map((q) => q.key));
      const keptStale = cache
        .getCrypto()
        .filter((q) => !dexKeys.has(q.key))
        .map((q) => ({ ...q, stale: true }));
      const merged = [...keptStale, ...dexQuotes];
      cache.setCrypto(merged);
      send(win, IPC.PUSH_CRYPTO, merged);
      pushStatus(win, 'dexscreener', true);
    } else {
      serveStale(win, 'crypto');
    }
  }
}

async function jobStocks(win: BrowserWindow): Promise<void> {
  const syms = stockSymbols();
  try {
    const quotes = await fetchQuotes(syms);
    // fetchQuotes swallows per-symbol failures by design, so it cannot throw on
    // a total outage; it just comes back empty. An empty result while real
    // symbols are configured means the source is down: serve last-good instead
    // of wiping the cache. The one legitimate empty case is SPCX (always seeded)
    // as the only polled symbol while SpaceX is not publicly listed, where
    // stale-serve is a no-op.
    const onlySpcx = syms.every((s) => s === SPCX_IPO.symbol);
    if (quotes.length === 0 && !onlySpcx) {
      throw new Error(`yahoo returned no quotes for ${syms.join(', ')}`);
    }
    cache.setStocks(quotes);
    send(win, IPC.PUSH_STOCKS, quotes);
    pushStatus(win, 'yahoo', true);
  } catch (err) {
    pushStatus(win, 'yahoo', false, String(err));
    serveStale(win, 'stocks');
  }
}

async function jobFng(win: BrowserWindow): Promise<void> {
  try {
    const fng = await fetchFng();
    cache.setFng(fng);
    send(win, IPC.PUSH_FNG, fng);
    pushStatus(win, 'fng', true);
  } catch (err) {
    pushStatus(win, 'fng', false, String(err));
  }
}

async function jobSats(win: BrowserWindow): Promise<void> {
  try {
    const sats = await fetchSats();
    cache.setSats(sats);
    send(win, IPC.PUSH_SATS, sats);
    pushStatus(win, 'celestrak', true);
  } catch (err) {
    pushStatus(win, 'celestrak', false, String(err));
    // Stale-serve: re-push the last-good elements so the holo orbits never blank.
    const last = cache.getSats();
    if (last.length > 0) send(win, IPC.PUSH_SATS, last);
  }
}

async function jobNews(win: BrowserWindow): Promise<void> {
  try {
    const news = await fetchNews();
    cache.setNews(news);
    send(win, IPC.PUSH_NEWS, news);
    pushStatus(win, 'news', true);
  } catch (err) {
    pushStatus(win, 'news', false, String(err));
  }
}

async function jobTicker(win: BrowserWindow): Promise<void> {
  try {
    const ticker = await fetchTicker();
    cache.setTicker(ticker);
    send(win, IPC.PUSH_TICKER, ticker);
    pushStatus(win, 'ticker', true);
  } catch (err) {
    pushStatus(win, 'ticker', false, String(err));
  }
}

async function jobCandlesReconcile(win: BrowserWindow): Promise<void> {
  try {
    const candles: Candle[] = await fetchCandles(60);
    cache.setCandles(candles);
    send(win, IPC.PUSH_CANDLES_INIT, candles);
    pushStatus(win, 'candles', true);
  } catch (err) {
    pushStatus(win, 'candles', false, String(err));
  }
}

/** Run `fn` immediately, then re-arm a jittered timer that reschedules itself. */
function every(intervalMs: number, fn: () => void | Promise<void>): void {
  const run = (): void => {
    void fn();
    const handle = setTimeout(run, jitter(intervalMs));
    timers.push(handle);
  };
  // first run immediately so the snapshot fills fast, then schedule
  void fn();
  const handle = setTimeout(run, jitter(intervalMs));
  timers.push(handle);
}

/**
 * Start every polling job and open the live candle ticker. Safe to call once
 * after the window is created. Call stopScheduler() on shutdown.
 */
export function startScheduler(win: BrowserWindow): void {
  activeWin = win;
  every(POLL.crypto, () => jobCrypto(win));
  every(POLL.stocks, () => jobStocks(win));
  every(POLL.fng, () => jobFng(win));
  every(POLL.news, () => jobNews(win));
  every(POLL.ticker, () => jobTicker(win));
  every(POLL.candlesReconcile, () => jobCandlesReconcile(win));
  every(POLL.sats, () => jobSats(win));

  // live BTC candle: push each in-progress bar as it updates
  disposeLiveTicker = openLiveTicker((candle) => {
    cache.upsertCandle(candle);
    send(win, IPC.PUSH_CANDLE_UPDATE, candle);
  });
}

/**
 * Re-run the asset-bearing jobs NOW because settings changed (e.g. a friend added or
 * removed an asset). The jobs read getSettings() fresh on every call, so this simply
 * fires crypto (incl. DEX) + stocks immediately instead of waiting up to a full poll
 * interval. Safe to call repeatedly; a no-op if the scheduler is not running. The
 * regular jittered timers keep running on their own cadence afterward.
 */
export function notifySettingsChanged(): void {
  if (!activeWin || activeWin.isDestroyed()) return;
  void jobCrypto(activeWin);
  void jobStocks(activeWin);
}

/** Stop all timers and close the live ticker (call on app shutdown / reload). */
export function stopScheduler(): void {
  for (const t of timers) clearTimeout(t);
  timers.length = 0;
  if (disposeLiveTicker) {
    disposeLiveTicker();
    disposeLiveTicker = null;
  }
  activeWin = null;
}
