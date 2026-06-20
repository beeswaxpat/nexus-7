// Yahoo Finance stock adapter. Uses the `yahoo-finance2` npm package in the main
// process (handles the Yahoo crumb/cookie dance, no API key). One quote() call per
// symbol; per-symbol failures are tolerated (skipped) so one thin/dead ticker never
// sinks the whole batch. Thin tickers like STRC can return a payload that fails the
// library's strict schema validation, so we call with validateResult:false and read
// the fields defensively.

import type { AssetDescriptor, AssetQuote } from '../../../shared/types';
import { httpJson } from '../http';

const SOURCE = 'yahoo';

/**
 * Yahoo quoteTypes we accept as a real, tradeable security for the asset resolver.
 * Explicitly EXCLUDES 'CRYPTOCURRENCY' and 'CURRENCY' so a crypto symbol that also
 * exists on Yahoo (e.g. a *-USD pair) never gets misclassified as a stock; those
 * belong to the CoinGecko/DexScreener path instead.
 */
const SECURITY_TYPES = new Set(['EQUITY', 'ETF', 'MUTUALFUND', 'INDEX']);

// Minimal shape of the yahoo-finance2 quote() result we consume. The library types
// it as a large union (QuoteEquity | QuoteEtf | ...); we only need these fields and
// keep them optional because validateResult:false can yield partial payloads.
interface YahooQuote {
  symbol?: string;
  regularMarketPrice?: number;
  regularMarketChangePercent?: number;
  marketCap?: number;
  longName?: string;
  shortName?: string;
  // 'EQUITY' | 'ETF' | 'MUTUALFUND' | 'INDEX' | 'CRYPTOCURRENCY' | 'CURRENCY' | ...
  quoteType?: string;
  // Extended-hours fields: present only when the security trades pre/post market.
  // Used as a SECONDARY source for afterHoursPrice when the chart probe comes up
  // empty (e.g. the includePrePost bars are sparse for a thin ticker).
  postMarketPrice?: number;
  postMarketChangePercent?: number;
  preMarketPrice?: number;
  preMarketChangePercent?: number;
}

// The yahoo-finance2 default export is a class whose data methods (quote, ...) live
// on the prototype, so it must be instantiated. We keep a single warmed instance:
// the crumb/cookie is cached internally and reused across calls.
interface YahooClient {
  quote(
    symbol: string,
    queryOptions?: Record<string, unknown>,
    moduleOptions?: { validateResult?: boolean }
  ): Promise<YahooQuote>;
}

// A no-op logger silences the library's per-request debug spam and the "expected a
// redirect" warning. Real failures still surface as thrown errors we catch below.
const QUIET_LOGGER = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {}
};

// Yahoo's consent/crumb endpoint occasionally answers 429 on a cold first call. The
// crumb is then cached inside the library for every later call, so a single bounded
// retry (matching http.ts's one-backoff philosophy) is enough to ride out that
// transient without hammering the endpoint.
const CRUMB_RETRIES = 1;
const CRUMB_RETRY_DELAY_MS = 1_500;

function isTransient(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /429|too many requests|crumb|ETIMEDOUT|ENOTFOUND|ECONNRESET|fetch failed/i.test(msg);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// yahoo-finance2 v2.14+ is ESM-only (no CommonJS entry). This file compiles to
// CommonJS (tsconfig.main.json), where a normal `import` would become require() and
// throw ERR_REQUIRE_ESM at runtime. Routing the dynamic import through an indirection
// keeps TypeScript from down-leveling it to require(), so Node's native ESM loader
// handles it. The promise is cached so we instantiate exactly once.
const importEsm = new Function('specifier', 'return import(specifier);') as (
  specifier: string
) => Promise<{ default: new (opts?: { logger?: unknown }) => YahooClient }>;

let clientPromise: Promise<YahooClient> | null = null;

function getClient(): Promise<YahooClient> {
  if (!clientPromise) {
    // The specifier must stay a constant literal, never user-derived, since importEsm runs a dynamic import.
    clientPromise = importEsm('yahoo-finance2').then((mod) => {
      const c = new mod.default({ logger: QUIET_LOGGER });
      // silence the library's one-time survey / deprecation notices on the console
      (c as unknown as { suppressNotices?: (keys: string[]) => void }).suppressNotices?.([
        'yahooSurvey',
        'ripHistorical'
      ]);
      return c;
    });
    // Do not cache a rejected import: a transient module-load failure should be
    // retryable on the next batch rather than poisoning every future call.
    clientPromise.catch(() => {
      clientPromise = null;
    });
  }
  return clientPromise;
}

// One quote() call with a single bounded retry on a transient crumb/429/network
// error. validateResult:false tolerates thin tickers (e.g. STRC) whose payload omits
// fields the library otherwise asserts on.
async function quoteWithRetry(client: YahooClient, symbol: string): Promise<YahooQuote> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= CRUMB_RETRIES; attempt++) {
    try {
      return await client.quote(symbol, {}, { validateResult: false });
    } catch (err) {
      lastErr = err;
      if (attempt < CRUMB_RETRIES && isTransient(err)) {
        await delay(CRUMB_RETRY_DELAY_MS);
        continue;
      }
      throw err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

// --- crumb-free source of truth: the public chart endpoint ------------------
// query1.finance.yahoo.com/v8/finance/chart returns daily OHLC with NO crumb/cookie
// and keeps the last close when the market is closed. We request a MONTH of daily
// bars and derive the change from the actual close-to-close series, because the
// `meta` previousClose fields are unreliable over a multi-day range: they can point
// at the close BEFORE the whole window, which is exactly what made MSTR read as
// "-14% (24h)" when it was really a multi-day move. Close-to-close is correct
// whether the market is open (last bar = today) or closed (last bar = last session).

interface YahooChartMeta {
  symbol?: string;
  shortName?: string;
  longName?: string;
  regularMarketPrice?: number;
  previousClose?: number;
  chartPreviousClose?: number;
  // 'EQUITY' | 'ETF' | 'MUTUALFUND' | 'INDEX' | 'CRYPTOCURRENCY' | 'CURRENCY' | ...
  // The chart endpoint's analogue of quote()'s quoteType, available WITHOUT a crumb.
  instrumentType?: string;
  // Regular-session window for the latest trading day; the post/pre bars sit
  // OUTSIDE [start, end] in the timestamp array. Epoch seconds.
  currentTradingPeriod?: {
    pre?: { start?: number; end?: number };
    regular?: { start?: number; end?: number };
    post?: { start?: number; end?: number };
  };
}
interface YahooChartResult {
  meta?: YahooChartMeta;
  timestamp?: number[];
  indicators?: { quote?: Array<{ close?: Array<number | null> }> };
}
interface YahooChartResp {
  chart?: { result?: YahooChartResult[] };
}

/** A single finite daily close paired with its epoch-seconds timestamp. */
interface DailyClose {
  t: number;
  c: number;
}

async function fetchViaChart(symbol: string): Promise<AssetQuote | null> {
  try {
    const url =
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
      `?range=1mo&interval=1d`;
    const data = await httpJson<YahooChartResp>(url);
    const res = data?.chart?.result?.[0];
    const meta = res?.meta;

    // Pair each finite daily close with its timestamp (ascending by time).
    const tsArr = res?.timestamp ?? [];
    const rawCloses = res?.indicators?.quote?.[0]?.close ?? [];
    const bars: DailyClose[] = [];
    for (let i = 0; i < rawCloses.length; i++) {
      const c = rawCloses[i];
      const t = tsArr[i];
      if (typeof c === 'number' && Number.isFinite(c) && typeof t === 'number') {
        bars.push({ t, c });
      }
    }

    const lastBarClose = bars.length ? bars[bars.length - 1].c : null;
    const price =
      typeof meta?.regularMarketPrice === 'number' && Number.isFinite(meta.regularMarketPrice)
        ? meta.regularMarketPrice
        : lastBarClose;
    if (typeof price !== 'number' || !Number.isFinite(price)) return null;

    // 24h change = price vs the PREVIOUS trading day's close (second-to-last bar).
    let change24h: number | null = null;
    if (bars.length >= 2) {
      const prev = bars[bars.length - 2].c;
      if (prev) change24h = ((price - prev) / prev) * 100;
    } else if (typeof meta?.chartPreviousClose === 'number' && meta.chartPreviousClose) {
      change24h = ((price - meta.chartPreviousClose) / meta.chartPreviousClose) * 100;
    }

    // 7d change = price vs the close ~7 calendar days before the most recent bar.
    let change7d: number | null = null;
    if (bars.length >= 2) {
      const lastT = bars[bars.length - 1].t;
      const target = lastT - 7 * 86_400;
      let ref: DailyClose | null = null;
      for (const b of bars) {
        if (b.t <= target) ref = b;
        else break;
      }
      if (!ref) ref = bars[0];
      if (ref.c && ref.t < lastT) change7d = ((price - ref.c) / ref.c) * 100;
    }

    const sym = (meta?.symbol ?? symbol).toUpperCase();
    return {
      key: `${SOURCE}:${symbol}`,
      symbol: sym,
      name: meta?.longName ?? meta?.shortName ?? sym,
      kind: 'stock',
      price,
      change24h,
      change7d,
      marketCap: null,
      source: SOURCE,
      stale: false,
      asOf: Date.now()
    };
  } catch {
    return null;
  }
}

// --- extended-hours (post/pre market) enrichment, crumb-free -----------------
// The same public chart endpoint serves the pre/post minute bars when asked with
// includePrePost. We pull a single day of 5m bars and read the LAST finite close
// that sits OUTSIDE the regular-session window (post bars after it, or pre bars
// before the next session opens). The percent change is vs the regular-session
// close (meta.regularMarketPrice, else meta.chartPreviousClose). This is pure
// best-effort enrichment, exactly like marketCap: it must NEVER sink the quote, so
// every failure path returns null.

/** Latest extended-hours close + its percent change vs the regular close, or null. */
interface AfterHours {
  price: number;
  changePercent: number | null;
}

async function fetchAfterHours(symbol: string): Promise<AfterHours | null> {
  try {
    const url =
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
      `?range=1d&interval=5m&includePrePost=true`;
    const data = await httpJson<YahooChartResp>(url);
    const res = data?.chart?.result?.[0];
    const meta = res?.meta;
    if (!meta) return null;

    // The regular-session window: bars at or before `end` are the regular session;
    // bars after it are post-market, bars before `start` are pre-market.
    const period = meta.currentTradingPeriod?.regular;
    const regStart = typeof period?.start === 'number' ? period.start : null;
    const regEnd = typeof period?.end === 'number' ? period.end : null;

    const tsArr = res?.timestamp ?? [];
    const closes = res?.indicators?.quote?.[0]?.close ?? [];

    // Walk from the most recent bar back to the first finite close that lies in an
    // extended-hours window. Without a known window we cannot tell regular from
    // extended bars, so bail (the chart price already covers the regular session).
    if (regStart == null && regEnd == null) return null;
    let extClose: number | null = null;
    for (let i = closes.length - 1; i >= 0; i--) {
      const c = closes[i];
      const t = tsArr[i];
      if (typeof c !== 'number' || !Number.isFinite(c) || typeof t !== 'number') continue;
      const isPost = regEnd != null && t >= regEnd;
      const isPre = regStart != null && t < regStart;
      if (isPost || isPre) {
        extClose = c;
        break;
      }
    }
    if (extClose == null) return null;

    // Reference close for the percent change: the regular-session price.
    const refClose =
      typeof meta.regularMarketPrice === 'number' && Number.isFinite(meta.regularMarketPrice)
        ? meta.regularMarketPrice
        : typeof meta.chartPreviousClose === 'number' && Number.isFinite(meta.chartPreviousClose)
          ? meta.chartPreviousClose
          : null;
    const changePercent =
      refClose != null && refClose !== 0 ? ((extClose - refClose) / refClose) * 100 : null;

    return { price: extClose, changePercent };
  } catch {
    return null;
  }
}

/** Fetch one symbol's quote. Returns null when the symbol has no data (e.g. pre-IPO). */
async function fetchOne(symbol: string): Promise<AssetQuote | null> {
  const viaChart = await fetchViaChart(symbol);

  // Best-effort enrichment (marketCap + a better name), and a price fallback if
  // the chart endpoint itself failed. Never fatal: the chart result stands alone.
  let marketCap: number | null = viaChart?.marketCap ?? null;
  let name = viaChart?.name;
  let quote: YahooQuote | null = null;
  try {
    const client = await getClient();
    quote = await quoteWithRetry(client, symbol);
    if (quote) {
      if (quote.marketCap != null) marketCap = quote.marketCap;
      name = quote.longName ?? quote.shortName ?? name;
    }
  } catch {
    // crumb/429/network: the chart endpoint already covers price + changes.
  }

  // Extended-hours price: primary = the includePrePost chart probe; secondary =
  // the post/pre fields off quote(). Both best-effort, both already null-safe.
  let afterHoursPrice: number | null = null;
  let afterHoursChangePercent: number | null = null;
  const ah = await fetchAfterHours(symbol);
  if (ah) {
    afterHoursPrice = ah.price;
    afterHoursChangePercent = ah.changePercent;
  } else if (quote) {
    if (quote.postMarketPrice != null && Number.isFinite(quote.postMarketPrice)) {
      afterHoursPrice = quote.postMarketPrice;
      afterHoursChangePercent = quote.postMarketChangePercent ?? null;
    } else if (quote.preMarketPrice != null && Number.isFinite(quote.preMarketPrice)) {
      afterHoursPrice = quote.preMarketPrice;
      afterHoursChangePercent = quote.preMarketChangePercent ?? null;
    }
  }

  if (viaChart) {
    // name was seeded from viaChart.name and only ever upgraded; the coalesce keeps
    // it non-undefined for the type checker as well.
    return { ...viaChart, name: name ?? viaChart.name, marketCap, afterHoursPrice, afterHoursChangePercent };
  }

  // Chart endpoint failed: fall back to whatever quote() returned.
  if (quote && quote.regularMarketPrice != null) {
    const sym = (quote.symbol ?? symbol).toUpperCase();
    return {
      key: `${SOURCE}:${symbol}`,
      symbol: sym,
      name: quote.longName ?? quote.shortName ?? sym,
      kind: 'stock',
      price: quote.regularMarketPrice,
      change24h: quote.regularMarketChangePercent ?? null,
      change7d: null,
      marketCap: quote.marketCap ?? null,
      source: SOURCE,
      stale: false,
      asOf: Date.now(),
      afterHoursPrice,
      afterHoursChangePercent
    };
  }
  return null;
}

/**
 * Fetch quotes for the given ticker symbols (e.g. ['MSTR','SPCX']).
 *
 * The keyless chart endpoint is the source of truth for price + 24h + 7d (it is
 * close-to-close accurate and works while the market is closed). yahoo-finance2's
 * quote() is then best-effort layered on top ONLY to enrich marketCap + a nicer
 * name; if it 429s on the crumb (common) we still return correct daily numbers.
 *
 * Per-symbol failures are ISOLATED: a symbol with no data (e.g. SPCX pre-IPO, a
 * delisted ticker) is simply skipped and never sinks the batch, so the symbols
 * that worked still get fresh quotes.
 */
export async function fetchQuotes(symbols: string[]): Promise<AssetQuote[]> {
  if (symbols.length === 0) return [];
  const out: AssetQuote[] = [];

  for (const symbol of symbols) {
    try {
      const q = await fetchOne(symbol);
      if (q) out.push(q);
    } catch {
      // Defensive: fetchOne already tolerates the known failure modes, but no
      // unexpected throw for one symbol may take down the rest of the batch.
    }
  }

  return out;
}

/**
 * Crumb-free resolver: classify a ticker as a real security straight off the public
 * chart endpoint, no crumb/cookie needed. This is the resilient sibling of resolveStock
 * for when the crumb-gated quote() 429s (which it does often) and silently drops real
 * tickers like STRK/STRF from asset search. We require BOTH a finite price (meta
 * regularMarketPrice, else the last finite daily close) AND an instrumentType that is a
 * known security type, mirroring resolveStock's reject-non-security guard. The
 * descriptor is built identically to resolveStock (key 'yahoo:<SYM>', kind 'stock',
 * name from longName/shortName/sym). Never throws.
 */
export async function resolveStockViaChart(symbol: string): Promise<AssetDescriptor | null> {
  const sym = symbol.trim().toUpperCase();
  if (!sym) return null;
  try {
    const url =
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}` +
      `?range=5d&interval=1d`;
    const data = await httpJson<YahooChartResp>(url);
    const res = data?.chart?.result?.[0];
    const meta = res?.meta;
    if (!meta) return null;

    // Price: prefer meta.regularMarketPrice, else the last finite daily close.
    const rawCloses = res?.indicators?.quote?.[0]?.close ?? [];
    let lastClose: number | null = null;
    for (let i = rawCloses.length - 1; i >= 0; i--) {
      const c = rawCloses[i];
      if (typeof c === 'number' && Number.isFinite(c)) {
        lastClose = c;
        break;
      }
    }
    const price =
      typeof meta.regularMarketPrice === 'number' && Number.isFinite(meta.regularMarketPrice)
        ? meta.regularMarketPrice
        : lastClose;
    if (typeof price !== 'number' || !Number.isFinite(price)) return null;

    // Reject non-securities (crypto/currency) and require a recognized instrumentType:
    // unlike quote()'s quoteType, the chart endpoint reliably stamps this field, so we
    // can insist on it here rather than tolerating its absence.
    if (!meta.instrumentType || !SECURITY_TYPES.has(meta.instrumentType.toUpperCase())) return null;

    const resolvedSym = (meta.symbol ?? sym).toUpperCase();
    return {
      key: `${SOURCE}:${resolvedSym}`,
      symbol: resolvedSym,
      name: meta.longName ?? meta.shortName ?? resolvedSym,
      kind: 'stock',
      source: SOURCE
    };
  } catch {
    return null;
  }
}

/**
 * Resolve a single ticker to a canonical stock AssetDescriptor, but ONLY if Yahoo
 * classifies it as a real security (equity/etf/fund/index) with a live price. Returns
 * null for unknown tickers, crypto/currency quoteTypes, or any error. Used by the
 * asset resolver so a stock-looking query (MSTR, STRC, AAPL) becomes a Yahoo stock
 * rather than a same-symbol crypto token on CoinGecko. Never throws.
 *
 * The crumb-gated quote() path is tried first (it carries marketCap and the richest
 * name), but it 429s frequently and that is exactly why real tickers like STRK/STRF
 * vanish from asset search. So on null OR error we fall back to resolveStockViaChart,
 * the crumb-free chart endpoint, which still classifies and prices the security.
 */
export async function resolveStock(symbol: string): Promise<AssetDescriptor | null> {
  const sym = symbol.trim().toUpperCase();
  if (!sym) return null;
  try {
    const client = await getClient();
    const q = await quoteWithRetry(client, sym);
    if (!q || q.regularMarketPrice == null) return await resolveStockViaChart(sym);
    // A quoteType is normally present; if it is missing we still accept a priced result
    // (thin tickers sometimes omit it), but a present non-security type is rejected.
    if (q.quoteType && !SECURITY_TYPES.has(q.quoteType.toUpperCase())) return null;
    const resolvedSym = (q.symbol ?? sym).toUpperCase();
    return {
      key: `${SOURCE}:${resolvedSym}`,
      symbol: resolvedSym,
      name: q.longName ?? q.shortName ?? resolvedSym,
      kind: 'stock',
      source: SOURCE
    };
  } catch {
    return await resolveStockViaChart(sym);
  }
}
