// The renderer's single seam to data. In Electron it wraps window.nexus (exposed
// by preload). In a plain browser (npm run dev:web for visual QA) window.nexus is
// undefined, so we install a BROWSER-MOCK that implements the exact same surface,
// emitting believable sample crypto/stocks/fng/news/ticker/candle data on a timer
// and returning sample settings. The UI cannot tell the difference, so every panel
// runs standalone. The Bridge type IS the contract panels code against.

import { defaultSettings, SPCX_IPO } from '../shared/constants';
import type {
  AssetQuote,
  Candle,
  FngData,
  NewsItem,
  ResolveResult,
  SatElement,
  SatGroup,
  Settings,
  Snapshot,
  SourceStatus,
  TickerCoin
} from '../shared/types';

type Unsubscribe = () => void;

export interface Bridge {
  getSnapshot(): Promise<Snapshot>;
  refresh(): Promise<{ ok: boolean }>;
  resolveAsset(query: string): Promise<ResolveResult>;
  addAsset(key: string): Promise<Settings>;
  removeAsset(key: string): Promise<Settings>;
  getSettings(): Promise<Settings>;
  setSettings(patch: Partial<Settings>): Promise<Settings>;
  openExternal(url: string): Promise<{ ok: boolean; error?: string }>;
  minimizeWindow(): void;
  toggleMaximizeWindow(): void;
  closeWindow(): void;
  // Optional chat transport: present in the Electron preload bridge (MQTT runs in
  // main), absent in the dev:web browser-mock (where mqtt-client falls back to the
  // vendored window.mqtt directly, which works fine in a normal browser).
  chatConnect?(topic: string): void;
  chatPublish?(wireB64: string): void;
  chatDisconnect?(): void;
  onChatMessage?(cb: (wireB64: string) => void): Unsubscribe;
  onChatStatus?(cb: (status: 'connecting' | 'connected' | 'error') => void): Unsubscribe;
  onCrypto(cb: (q: AssetQuote[]) => void): Unsubscribe;
  onStocks(cb: (q: AssetQuote[]) => void): Unsubscribe;
  onFng(cb: (f: FngData) => void): Unsubscribe;
  onNews(cb: (n: NewsItem[]) => void): Unsubscribe;
  onTicker(cb: (t: TickerCoin[]) => void): Unsubscribe;
  onCandlesInit(cb: (c: Candle[]) => void): Unsubscribe;
  onCandleUpdate(cb: (c: Candle) => void): Unsubscribe;
  onStatus(cb: (s: SourceStatus) => void): Unsubscribe;
  onSats(cb: (s: SatElement[]) => void): Unsubscribe;
}

declare global {
  interface Window {
    nexus?: Bridge;
  }
}

// --- browser-mock data generators ------------------------------------------

const MOCK_CRYPTO: Array<[string, string, string, number, number]> = [
  // key, symbol, name, price, marketCap
  ['coingecko:bitcoin', 'BTC', 'Bitcoin', 96000, 1.9e12],
  ['coingecko:ethereum', 'ETH', 'Ethereum', 3650, 4.4e11],
  ['coingecko:ripple', 'XRP', 'XRP', 2.34, 1.3e11],
  ['coingecko:solana', 'SOL', 'Solana', 168, 8.0e10],
  ['coingecko:hyperliquid', 'HYPE', 'Hyperliquid', 28.5, 9.4e9],
  ['coingecko:plasma', 'XPL', 'Plasma', 0.62, 1.1e9],
  ['coingecko:aleo', 'ALEO', 'Aleo', 0.34, 2.1e8],
  ['coingecko:thena', 'THE', 'THENA', 0.41, 4.5e7]
];

// STRC stays even though it left the defaults: users who kept it still resolve.
// STRK / STRF are served here with their canonical uppercase keys (not via
// extraQuotes, which lowercases): the asset-box / yield / portfolio lookups are
// case-sensitive ('yahoo:STRK'), so a fabricated 'yahoo:strk' would miss and the
// round-15 yield rows would never resolve.
const MOCK_STOCKS: Array<[string, string, string, number, number | null]> = [
  ['yahoo:MSTR', 'MSTR', 'MicroStrategy Inc', 392.5, 9.7e10],
  ['yahoo:TSLA', 'TSLA', 'Tesla Inc', 310, 9.9e11],
  ['yahoo:STRC', 'STRC', 'Strategy Class C', 101.2, null],
  ['yahoo:STRK', 'STRK', 'Strategy Class K', 26.85, null],
  ['yahoo:STRF', 'STRF', 'Strategy Class F', 27.45, null]
];

/**
 * The real Yahoo feed only serves SPCX once SpaceX actually trades, so the mock
 * mirrors that: the quote appears at/after the IPO timestamp, or immediately with
 * the `?spcx=live` query override so the live card is QA-able under dev:web.
 */
function spcxMockActive(): boolean {
  try {
    if (
      typeof location !== 'undefined' &&
      new URLSearchParams(location.search).get('spcx') === 'live'
    ) {
      return true;
    }
  } catch {
    // no location (non-browser host): fall through to the date check
  }
  const ipo = Date.parse(SPCX_IPO.ipoDateUtc);
  return Number.isFinite(ipo) && Date.now() >= ipo;
}

function wiggle(base: number, pct: number): number {
  return base * (1 + (Math.random() * 2 - 1) * pct);
}

function mockCrypto(): AssetQuote[] {
  return MOCK_CRYPTO.map(([key, symbol, name, price, cap]) => ({
    key,
    symbol,
    name,
    kind: 'crypto' as const,
    price: Number(wiggle(price, 0.01).toFixed(price >= 1 ? 2 : 6)),
    change24h: Number((Math.random() * 24 - 8).toFixed(2)),
    change7d: Number((Math.random() * 40 - 15).toFixed(2)),
    marketCap: Math.round(cap),
    source: 'coingecko',
    stale: false,
    asOf: Date.now()
  }));
}

function mockStocks(): AssetQuote[] {
  const rows: Array<[string, string, string, number, number | null]> = [...MOCK_STOCKS];
  if (spcxMockActive()) {
    rows.push([`yahoo:${SPCX_IPO.symbol}`, SPCX_IPO.symbol, SPCX_IPO.name, 45, 1.5e11]);
  }
  return rows.map(([key, symbol, name, price, cap]) => {
    const regular = Number(wiggle(price, 0.01).toFixed(2));
    // Fabricate an extended-hours print: nudge the regular price by +/- 0.3 to
    // 1.5 percent so the crescent-moon after-hours line is visible under dev:web.
    const ahPct = Number(((Math.random() * 2 - 1) * 1.2).toFixed(2));
    const afterHoursPrice = Number((regular * (1 + ahPct / 100)).toFixed(2));
    return {
      key,
      symbol,
      name,
      kind: 'stock' as const,
      price: regular,
      change24h: Number((Math.random() * 10 - 4).toFixed(2)),
      change7d: Number((Math.random() * 20 - 8).toFixed(2)),
      marketCap: cap,
      source: 'yahoo',
      stale: false,
      asOf: Date.now(),
      afterHoursPrice,
      afterHoursChangePercent: ahPct
    };
  });
}

function mockFng(): FngData {
  const value = Math.floor(35 + Math.random() * 45);
  const classification =
    value <= 24 ? 'Extreme Fear' : value <= 49 ? 'Fear' : value === 50 ? 'Neutral' : value <= 74 ? 'Greed' : 'Extreme Greed';
  return { value, classification, asOf: Date.now() };
}

function mockNews(): NewsItem[] {
  const titles: Array<[string, string, 'crypto' | 'econ']> = [
    ['Bitcoin reclaims key level as ETF inflows accelerate', 'Cointelegraph', 'crypto'],
    ['Solana network activity hits new monthly high', 'Decrypt', 'crypto'],
    ['XRP ruling clarity boosts institutional interest', 'CoinDesk', 'crypto'],
    ['MicroStrategy adds to Bitcoin treasury position', 'Cointelegraph', 'crypto'],
    ['Hyperliquid volume surges across perps markets', 'Decrypt', 'crypto'],
    ['Fear and Greed index swings toward greed', 'CoinDesk', 'crypto'],
    ['Fed officials signal patience on rate cuts', 'CNBC', 'econ'],
    ['Jobs report tops expectations as hiring stays firm', 'CNBC Economy', 'econ'],
    ['Treasury yields slip ahead of inflation data', 'MarketWatch', 'econ'],
    ['S&P 500 closes at record on tech strength', 'Yahoo Finance', 'econ'],
    ['Consumer sentiment improves for third straight month', 'MarketWatch', 'econ']
  ];
  const now = Date.now();
  return titles.map(([title, source, category], i) => ({
    id: `mock-${i}`,
    title,
    url: 'https://example.com/news/' + i,
    source,
    publishedAt: now - i * 9 * 60_000,
    category
  }));
}

function mockTicker(): TickerCoin[] {
  const coins: Array<[string, number]> = [
    ['BTC', 96000],
    ['ETH', 3650],
    ['SOL', 168],
    ['XRP', 2.34],
    ['BNB', 612],
    ['DOGE', 0.39],
    ['ADA', 1.02],
    ['AVAX', 41.2],
    ['LINK', 22.7],
    ['HYPE', 28.5]
  ];
  return coins.map(([symbol, price]) => ({
    symbol,
    price: Number(wiggle(price, 0.01).toFixed(price >= 1 ? 2 : 4)),
    change24h: Number((Math.random() * 16 - 6).toFixed(2))
  }));
}

let mockLastClose = 96000;
function mockCandleHistory(): Candle[] {
  const now = Math.floor(Date.now() / 1000);
  const out: Candle[] = [];
  let last = 96000;
  for (let i = 120; i > 0; i--) {
    const time = now - i * 60;
    const open = last;
    const close = Math.max(1, open + (Math.random() * 2 - 1) * 96000 * 0.0015);
    out.push({
      time,
      open: Number(open.toFixed(2)),
      high: Number((Math.max(open, close) * 1.0008).toFixed(2)),
      low: Number((Math.min(open, close) * 0.9992).toFixed(2)),
      close: Number(close.toFixed(2))
    });
    last = close;
  }
  mockLastClose = last;
  return out;
}

function mockCandleTick(): Candle {
  const time = Math.floor(Date.now() / 1000 / 60) * 60;
  const open = mockLastClose;
  const close = Math.max(1, open + (Math.random() * 2 - 1) * 96000 * 0.0008);
  mockLastClose = close;
  return {
    time,
    open: Number(open.toFixed(2)),
    high: Number((Math.max(open, close) * 1.0005).toFixed(2)),
    low: Number((Math.min(open, close) * 0.9995).toFixed(2)),
    close: Number(close.toFixed(2))
  };
}

/**
 * ~40 plausible satellites for dev:web: the ISS + the two other crewed stations,
 * a 22-bird Starlink train (so the holo Earth shows a visible chain), the GPS
 * shell, and a handful of well-known LEO birds. Angles in degrees, meanMotion in
 * rev/day, epoch = now (so the propagation starts from "right now" with no drift).
 * Mirrors the SatElement shape the real Celestrak adapter produces.
 */
function mockSats(): SatElement[] {
  const epoch = Date.now();
  const sat = (
    name: string,
    noradId: number,
    group: SatGroup,
    meanMotion: number,
    ecc: number,
    incl: number,
    raan: number,
    argp: number,
    meanAnomaly: number
  ): SatElement => ({ name, noradId, group, epoch, meanMotion, ecc, incl, raan, argp, meanAnomaly });

  const out: SatElement[] = [
    // crewed stations
    sat('ISS (ZARYA)', 25544, 'stations', 15.49, 0.0005, 51.63, 326.6, 175.2, 184.9),
    sat('CSS (TIANHE)', 48274, 'stations', 15.62, 0.0006, 41.47, 110.4, 88.3, 12.7),
    sat('HST', 20580, 'stations', 15.09, 0.0003, 28.47, 210.2, 64.1, 296.5)
  ];

  // 22-sat Starlink train (visual): same plane, marched along in mean anomaly.
  for (let i = 0; i < 22; i++) {
    out.push(
      sat(`STARLINK-${3000 + i}`, 70000 + i, 'visual', 15.06, 0.0001, 53.05, 80 + i * 0.6, 0, (i * 360) / 22)
    );
  }

  // GPS constellation (gps-ops): 6 planes-ish, ~12h period (mm ~2.0056).
  for (let i = 0; i < 8; i++) {
    out.push(sat(`GPS BIIF-${i + 1}`, 41000 + i, 'gps-ops', 2.0056, 0.012, 55, i * 60, 0, i * 45));
  }

  // misc visual LEO birds with plausible mean motions / inclinations.
  out.push(sat('COSMOS 1408', 13552, 'visual', 15.18, 0.002, 82.56, 145.3, 130.7, 230.1));
  out.push(sat('ENVISAT', 27386, 'visual', 14.38, 0.0001, 98.21, 24.8, 90.4, 270.6));
  out.push(sat('NOAA 19', 33591, 'visual', 14.13, 0.0014, 99.02, 300.1, 40.2, 320.4));
  out.push(sat('TERRA', 25994, 'visual', 14.57, 0.0001, 98.13, 75.6, 200.8, 159.2));
  out.push(sat('AQUA', 27424, 'visual', 14.57, 0.0001, 98.18, 78.9, 210.5, 149.7));
  out.push(sat('LANDSAT 8', 39084, 'visual', 14.57, 0.0001, 98.22, 81.2, 220.1, 139.9));

  return out;
}

/** Build the standalone browser-mock bridge (no Electron, no main process). */
function createBrowserMock(): Bridge {
  console.info('[nexus] window.nexus missing -> browser-mock bridge active (dev:web).');
  // mock-only demo bags for round-15 QA: seed extra yield-bearing keys + holdings so
  // dev:web shows the YLD lines, privacy blur, and Bug Nut with real numbers.
  // STRC/STRK/STRF are served by MOCK_STOCKS with canonical uppercase keys (the
  // case-sensitive yield/portfolio lookups need the exact 'yahoo:STRK' form);
  // coingecko:cardano falls through to extraQuotes() for a synthetic price.
  // Electron uses real persisted settings (unchanged).
  const base = defaultSettings();
  let settings: Settings = {
    ...base,
    friendAssets: [...base.friendAssets, 'yahoo:STRC', 'yahoo:STRK', 'yahoo:STRF'],
    ownerAssets: [...base.ownerAssets, 'coingecko:cardano'],
    holdings: {
      'yahoo:STRK': 119.4004,
      'yahoo:STRF': 32.2326,
      'yahoo:STRC': 110.3059,
      'coingecko:solana': 12,
      'coingecko:cardano': 2500,
      'coingecko:ethereum': 1.5,
      'coingecko:plasma': 4000
    }
  };

  // typed registries of push subscribers
  const subs = {
    crypto: new Set<(q: AssetQuote[]) => void>(),
    stocks: new Set<(q: AssetQuote[]) => void>(),
    fng: new Set<(f: FngData) => void>(),
    news: new Set<(n: NewsItem[]) => void>(),
    ticker: new Set<(t: TickerCoin[]) => void>(),
    candleUpdate: new Set<(c: Candle) => void>(),
    candlesInit: new Set<(c: Candle[]) => void>(),
    status: new Set<(s: SourceStatus) => void>(),
    sats: new Set<(s: SatElement[]) => void>()
  };

  const emitStatus = (source: string): void => {
    const s: SourceStatus = { source, ok: true, lastSuccess: Date.now() };
    subs.status.forEach((cb) => cb(s));
  };

  // start emitters once a subscriber exists (kept simple: start on first call)
  let started = false;
  const startTimers = (): void => {
    if (started) return;
    started = true;
    const pushCrypto = (): void => {
      subs.crypto.forEach((cb) => cb(cryptoNow()));
      emitStatus('coingecko');
    };
    const pushStocks = (): void => {
      subs.stocks.forEach((cb) => cb(mockStocks()));
      emitStatus('yahoo');
    };
    const pushFng = (): void => {
      const f = mockFng();
      subs.fng.forEach((cb) => cb(f));
      emitStatus('fng');
    };
    const pushNews = (): void => {
      subs.news.forEach((cb) => cb(mockNews()));
      emitStatus('news');
    };
    const pushTicker = (): void => {
      subs.ticker.forEach((cb) => cb(mockTicker()));
      emitStatus('ticker');
    };
    const pushSats = (): void => {
      subs.sats.forEach((cb) => cb(mockSats()));
      emitStatus('celestrak');
    };
    // initial paint
    const hist = mockCandleHistory();
    subs.candlesInit.forEach((cb) => cb(hist));
    pushCrypto();
    pushStocks();
    pushFng();
    pushNews();
    pushTicker();
    pushSats();
    // intervals (faster than prod cadence so QA sees motion)
    setInterval(pushCrypto, 5_000);
    setInterval(pushStocks, 8_000);
    setInterval(pushFng, 15_000);
    setInterval(pushNews, 30_000);
    setInterval(pushTicker, 6_000);
    setInterval(() => subs.candleUpdate.forEach((cb) => cb(mockCandleTick())), 2_000);
    // sats refresh: epochs re-stamped to "now" so dev:web propagation never drifts
    setInterval(pushSats, 60_000);
  };

  // The real scheduler polls every configured key (both boxes + the center asset);
  // mirror that here so the pickers are exercisable under dev:web. Any configured
  // key outside the fixed mock lists gets a synthetic quote instead of loading
  // forever.
  const extraQuotes = (): AssetQuote[] => {
    const configured = [
      ...(settings.friendAssets ?? []),
      ...(settings.ownerAssets ?? []),
      settings.centerAsset ?? '',
      settings.secondaryAsset ?? '' // re-pointed gold slot gets a fabricated mock quote too
    ];
    const out: AssetQuote[] = [];
    const seen = new Set<string>();
    for (const raw of configured) {
      const key = (raw ?? '').trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const known =
        MOCK_CRYPTO.some(([k]) => k.toLowerCase() === key) ||
        MOCK_STOCKS.some(([k]) => k.toLowerCase() === key);
      if (known) continue;
      const id = key.split(':')[1] ?? key;
      out.push({
        key,
        symbol: id.slice(0, 5).toUpperCase(),
        name: id.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        kind: 'crypto' as const,
        price: Number(wiggle(123.45, 0.01).toFixed(2)),
        change24h: Number((Math.random() * 24 - 8).toFixed(2)),
        change7d: Number((Math.random() * 40 - 15).toFixed(2)),
        marketCap: 1.2e9,
        source: 'coingecko',
        stale: false,
        asOf: Date.now()
      });
    }
    return out;
  };
  const cryptoNow = (): AssetQuote[] => [...mockCrypto(), ...extraQuotes()];

  const snapshot = (): Snapshot => ({
    crypto: cryptoNow(),
    stocks: mockStocks(),
    fng: mockFng(),
    news: mockNews(),
    ticker: mockTicker(),
    candles: mockCandleHistory(),
    statuses: ['coingecko', 'yahoo', 'fng', 'news', 'ticker', 'candles', 'celestrak'].map((source) => ({
      source,
      ok: true,
      lastSuccess: Date.now()
    })),
    sats: mockSats()
  });

  const sub = <T>(set: Set<(v: T) => void>, cb: (v: T) => void): Unsubscribe => {
    set.add(cb);
    startTimers();
    return () => set.delete(cb);
  };

  return {
    getSnapshot: async () => snapshot(),
    refresh: async () => ({ ok: true }),
    resolveAsset: async (query: string): Promise<ResolveResult> => ({
      ok: true,
      descriptor: {
        key: `coingecko:${query.trim().toLowerCase().replace(/\s+/g, '-')}`,
        symbol: query.trim().slice(0, 5).toUpperCase(),
        name: query.trim() || 'Unknown',
        kind: 'crypto',
        source: 'coingecko'
      }
    }),
    addAsset: async (key: string) => {
      if (!settings.friendAssets.includes(key)) {
        settings = { ...settings, friendAssets: [...settings.friendAssets, key] };
      }
      return settings;
    },
    removeAsset: async (key: string) => {
      settings = { ...settings, friendAssets: settings.friendAssets.filter((k) => k !== key) };
      return settings;
    },
    getSettings: async () => settings,
    setSettings: async (patch: Partial<Settings>) => {
      settings = {
        ...settings,
        ...patch,
        chaos: { ...settings.chaos, ...(patch.chaos ?? {}) },
        boxTitles: { ...settings.boxTitles, ...(patch.boxTitles ?? {}) },
        holdings: { ...settings.holdings, ...(patch.holdings ?? {}) },
        scenes: { ...settings.scenes, ...(patch.scenes ?? {}) }
      };
      return settings;
    },
    openExternal: async (url: string) => {
      window.open(url, '_blank', 'noopener');
      return { ok: true };
    },
    // window controls are no-ops in a plain browser (dev:web)
    minimizeWindow: () => {},
    toggleMaximizeWindow: () => {},
    closeWindow: () => {},
    onCrypto: (cb) => sub(subs.crypto, cb),
    onStocks: (cb) => sub(subs.stocks, cb),
    onFng: (cb) => sub(subs.fng, cb),
    onNews: (cb) => sub(subs.news, cb),
    onTicker: (cb) => sub(subs.ticker, cb),
    onCandlesInit: (cb) => sub(subs.candlesInit, cb),
    onCandleUpdate: (cb) => sub(subs.candleUpdate, cb),
    onStatus: (cb) => sub(subs.status, cb),
    onSats: (cb) => sub(subs.sats, cb)
  };
}

/** Return the real bridge (Electron) or the browser-mock (plain browser). */
export function getBridge(): Bridge {
  return window.nexus ?? createBrowserMock();
}
