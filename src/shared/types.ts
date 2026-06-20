// FROZEN CONTRACT: the normalized data shapes that flow across IPC. Every adapter
// must return these shapes; every panel reads them. Do not change a field name or
// type without coordinating across all agents.

/** Asset kind. CoinGecko/DexScreener => 'crypto', Yahoo => 'stock'. */
export type AssetKind = 'crypto' | 'stock';

/**
 * Unified per-row asset model. Every source (CoinGecko, DexScreener, Yahoo)
 * normalizes into this single shape so asset-row.ts never branches on source.
 * `key` is the canonical "namespace:id" identifier, e.g. 'coingecko:bitcoin'
 * or 'yahoo:MSTR'. Nullable numbers mean "unknown / not provided by source".
 */
export interface AssetQuote {
  key: string;
  symbol: string;
  name: string;
  kind: AssetKind;
  price: number | null;
  change24h: number | null;
  change7d: number | null;
  marketCap: number | null;
  source: string;
  stale: boolean;
  asOf: number; // epoch ms when this quote was produced
  /**
   * Post-market / extended-hours price (or pre-market when that is the active
   * session). null/absent when the source has no extended-hours data.
   */
  afterHoursPrice?: number | null;
  /**
   * Extended-hours percent change vs the regular-session close. null/absent when
   * the source has no extended-hours data.
   */
  afterHoursChangePercent?: number | null;
}

/** OHLC candle. NOTE: time is in SECONDS (lightweight-charts UTCTimestamp). */
export interface Candle {
  time: number; // epoch SECONDS
  open: number;
  high: number;
  low: number;
  close: number;
}

/** Fear & Greed index reading. */
export interface FngData {
  value: number; // 0..100
  classification: string; // e.g. 'Extreme Fear'
  asOf: number; // epoch ms
}

/** News categories: crypto headlines vs US economy/finance headlines. */
export type NewsCategory = 'crypto' | 'econ';

/** Which Celestrak GP group a satellite was fetched from. */
export type SatGroup = 'stations' | 'visual' | 'gps-ops';

/**
 * One orbital element set for a satellite (Celestrak GP / mean Keplerian).
 * Angles are in DEGREES, meanMotion is in rev/day, epoch is epoch MS UTC.
 * The renderer (core/orbits.ts) derives radians + semi-major axis from these.
 */
export interface SatElement {
  name: string;
  noradId: number;
  group: SatGroup;
  epoch: number; // epoch ms UTC
  meanMotion: number; // rev/day
  ecc: number;
  incl: number; // deg
  raan: number; // deg
  argp: number; // deg
  meanAnomaly: number; // deg
}

/** A single news headline. */
export interface NewsItem {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: number; // epoch ms
  /** Which tab this belongs to. Absent (old cache/mock) means 'crypto'. */
  category?: NewsCategory;
}

/** One coin in the bottom scrolling market ticker. */
export interface TickerCoin {
  symbol: string;
  price: number;
  change24h: number;
}

/** Health of one data source, surfaced for the status lights / stale badges. */
export interface SourceStatus {
  source: string;
  ok: boolean;
  lastSuccess: number; // epoch ms (0 if never)
  lastError?: string;
}

/** A resolved asset descriptor produced by the asset resolver. */
export interface AssetDescriptor {
  key: string; // canonical 'namespace:id'
  symbol: string;
  name: string;
  kind: AssetKind;
  source: string; // 'coingecko' | 'dexscreener' | 'yahoo'
  pairAddress?: string; // DEX tokens only
  chainId?: string; // DEX tokens only
}

/** Result of asset:resolve. ok=true => descriptor; ambiguous => candidates. */
export interface ResolveResult {
  ok: boolean;
  descriptor?: AssetDescriptor;
  candidates?: AssetDescriptor[];
  error?: string;
}

/** Chaos / easter-egg toggles. All default ON except autoMessage (publishes to chat). */
export interface ChaosSettings {
  wormhole: boolean;
  banners: boolean;
  scanlines: boolean;
  autoMessage: boolean;
}

/** User-editable asset-box titles (click a title in the UI to rename; persists). */
export interface BoxTitles {
  friend: string;
  owner: string;
}

/**
 * Meme-image settings for the Pepe overlay. `useDefaults` toggles the bundled
 * thumbnail pool on/off; `custom` holds the user's own images as already
 * downscaled JPEG data: URLs (longest side <= 240px), ready to drop into an
 * <img src>. Both pools are merged live by the overlay.
 */
export interface ImageSettings {
  useDefaults: boolean;
  custom: string[];
}

/**
 * The two ambient graphics (wormhole + night city) are user-arrangeable: either
 * can sit in the big center cell, and each can be hidden independently.
 */
export interface SceneSettings {
  /** false: wormhole in the center, night city in the corner. true: swapped. */
  swapped: boolean;
  showWormhole: boolean;
  showNightCity: boolean;
  /** Wormhole ULTRA mode: gravity-lensed, chromatic, time-dilated rendering. */
  ultra: boolean;
  /** Night City ULTRA mode: synthwave inversion (retro sun, neon grid street). */
  ultraCity: boolean;
}

/** Persisted user settings (app.getPath('userData')/settings.json). */
export interface Settings {
  // Naming is historical: friendAssets backs the STONKS box (stocks); ownerAssets backs the CRYPTO box.
  friendAssets: string[]; // canonical keys, e.g. 'coingecko:ripple', 'yahoo:MSTR'
  /** Keys for the second (owner) box. Fully user-editable, same shape as friendAssets. */
  ownerAssets: string[];
  username: string;
  btcTargetPrice: number;
  liveTvUrl: string;
  /** Source for the Video tab (crypto live streams). Same forms as liveTvUrl. */
  videoTvUrl: string;
  /** Source for the MONITOR tab (public city/surveillance cams). Same forms as liveTvUrl. */
  monitorUrl: string;
  activeRightTab: 'news' | 'econ' | 'live' | 'jukebox' | 'monitor';
  chaos: ChaosSettings;
  /** Editable asset-box titles (click-to-rename in the UI; merged over defaults). */
  boxTitles: BoxTitles;
  /**
   * The featured center asset (canonical key). Defaults to 'coingecko:bitcoin'.
   * Whatever sits here drives the wormhole bands, banners, and recolor triggers.
   */
  centerAsset: string;
  /** Canonical key for the gold "second slot" card (default SpaceX). */
  secondaryAsset?: string;
  /**
   * How many units of each asset the user holds, keyed by canonical asset key.
   * The UI multiplies by the live price to show what each bag is worth.
   */
  holdings: Record<string, number>;
  /** Graphic arrangement: which scene is front and center, and what is hidden. */
  scenes: SceneSettings;
  /** Drag-and-drop panel arrangement: maps a slot id to the panel id currently in it. */
  layout?: Record<string, string>;
  /**
   * Per-box flex-grow weights for the three resizable left-column boxes (friend,
   * owner, chart). Set by the divider drag in core/col-resize.ts; absent on old
   * profiles, which fall back to the defaultSettings() weights.
   */
  leftFlex?: { friend: number; owner: number; chart: number };
  /**
   * Privacy mode: when true, bag dollar values and portfolio totals render
   * blurred (core/privacy.ts). Prices and percentages stay visible.
   */
  privateMode?: boolean;
  /** Editable label for the combined-portfolio cell in the BTC strip. */
  bugNutLabel?: string;
  /**
   * Meme-image overlay settings: whether the bundled defaults show, plus the
   * user's own uploaded images (downscaled JPEG data: URLs). Absent on old
   * profiles, which fall back to { useDefaults: true, custom: [] }.
   */
  images?: ImageSettings;
}

/**
 * Full snapshot returned by data:get-snapshot so the renderer paints instantly
 * on startup without waiting for the next push tick.
 */
export interface Snapshot {
  crypto: AssetQuote[];
  stocks: AssetQuote[];
  fng: FngData | null;
  news: NewsItem[];
  ticker: TickerCoin[];
  candles: Candle[];
  statuses: SourceStatus[];
  sats: SatElement[];
}
