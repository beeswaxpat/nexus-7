// FROZEN CONTRACT: shared constants. Values lifted from PORTING_SPEC.md.

import type { Settings } from './types';

/** Poll cadences in milliseconds (scheduler applies ~10% jitter on top). */
export const POLL = {
  crypto: 60_000,
  stocks: 300_000,
  fng: 1_800_000,
  news: 600_000,
  ticker: 60_000,
  candlesReconcile: 300_000,
  sats: 28_800_000 // 8 h: orbital elements drift slowly
} as const;

/** Second box ("CRYPTO") defaults: BTC, ETH, SOL, XRP, HYPE. User-editable. */
export const DEFAULT_OWNER_KEYS = [
  'coingecko:bitcoin',
  'coingecko:ethereum',
  'coingecko:solana',
  'coingecko:ripple',
  'coingecko:hyperliquid'
] as const;

/** First box ("STONKS") defaults: SPCX, TSLA, NVDA, AAPL, INTC. User-editable. */
export const DEFAULT_FRIEND_KEYS = [
  'yahoo:SPCX',
  'yahoo:TSLA',
  'yahoo:NVDA',
  'yahoo:AAPL',
  'yahoo:INTC'
] as const;

/** The featured / centered coin everything reacts to. */
export const CENTER_COIN_ID = 'bitcoin';

/** Default center-asset key. The user can swap the featured asset in the UI. */
export const DEFAULT_CENTER_KEY = `coingecko:${CENTER_COIN_ID}`;

/** Default BTC road-bar target price (user-configurable in settings). */
export const DEFAULT_BTC_TARGET = 444_000;

/**
 * IPO placeholder shown under Bitcoin in the center column. SpaceX (SPCX) IPO date
 * was 2026-06-12; before that the slot showed a pre-IPO countdown, after it it shows
 * the live Yahoo quote. ipoDate is roughly US market open (13:30 UTC).
 */
export const SPCX_IPO = {
  symbol: 'SPCX',
  name: 'SpaceX',
  ipoDateUtc: '2026-06-12T13:30:00Z'
} as const;

/** Default key for the gold "second slot" card under the big price. Resolves to
 *  'yahoo:SPCX' until the user re-points it. */
export const SECONDARY_DEFAULT_KEY = 'yahoo:' + SPCX_IPO.symbol;

/**
 * Default live finance stream. Yahoo Finance's persistent 24/7 markets stream
 * (video KQp-e_XQnDE), which ALLOWS embedding. CNBC's free YouTube stream disables
 * embedding (YouTube "Error 153" in the player), and the legacy `live_stream?channel=`
 * form is unreliable, so Yahoo is the dependable first-run default. The live-tv panel
 * offers one-click presets (Yahoo / Bloomberg / CNBC), an "open on YouTube" pop-out
 * for any stream that blocks embedding, and a clean offline fallback. Overridable via
 * Settings.liveTvUrl; the panel forces autoplay + mute and enables the JS API.
 */
export const DEFAULT_LIVE_TV_URL = 'https://www.youtube.com/embed/KQp-e_XQnDE';

/**
 * Default Video-tab source: the "Bitcoin LIVE" 24/7 chart + liquidation-watch
 * channel (youtube.com/@BitcoinLIVEyt, canonical id UCObE3J0qQ0DzcouV1w4DlGg).
 * Stored as a bare channel id so the player resolves to whatever that channel is
 * CURRENTLY streaming (live_stream?channel=...), surviving stream restarts; a
 * fixed video id would die whenever they cycle the broadcast.
 */
export const DEFAULT_VIDEO_TV_URL = 'UCObE3J0qQ0DzcouV1w4DlGg';

/**
 * Default MONITOR-tab feed: EarthCam's 24/7 Times Square cam (New York). The
 * MONITOR tab is a grid of public city/surveillance webcams; this is the first
 * one shown. Embeddable as of 2026-06-15. Overridable via Settings.monitorUrl.
 */
export const DEFAULT_MONITOR_URL = 'https://www.youtube.com/embed/z-jYdOIKcTQ';

/**
 * Ticker denylist: stablecoins + wrapped tokens (CoinGecko ids). Also drop any id
 * beginning with `wrapped-` (handled in code, not listed exhaustively here).
 */
export const TICKER_DENYLIST: readonly string[] = [
  'tether',
  'usd-coin',
  'binance-usd',
  'dai',
  'true-usd',
  'usdd',
  'first-digital-usd',
  'ethena-usde',
  'wrapped-bitcoin',
  'wrapped-steth',
  'wrapped-tron',
  'weth',
  'staked-ether'
];

/** Max coins shown in the scrolling ticker. */
export const TICKER_MAX = 50;

/** Max news items kept after merge/dedupe/sort. */
export const NEWS_MAX = 50;

/**
 * Reaction thresholds on 24h % change (see PORTING_SPEC.md). Centralized so the
 * pure helpers in core/reactions.ts and the overlays share one source of truth.
 */
export const REACTION = {
  // per-asset emoji
  emoji: {
    diamond: 20, // change >= 20
    rocket: 10, // change >= 10
    happyMin: 5, // bitcoin only: 5 <= change < 10
    happyMax: 10,
    poop: -10, // change <= -10
    skull: -20 // change <= -20
  },
  // BTC wormhole bands
  wormhole: {
    pump: 5, // >= 5 (green)
    dump: -5, // <= -5 (red + HACKED)
    lfg: 20 // >= 20 (gold takeover, final)
  },
  // BTC trigger banner thresholds: 5 / 10 / 15 / 20 up and down. Text in reactions.ts.
  banner: {
    p5: 5,
    p10: 10,
    p15: 15,
    p20: 20,
    n5: -5,
    n10: -10,
    n15: -15,
    n20: -20
  },
  // orbiting avatar trigger: abs(24h change) of any asset in a person's box
  avatarOrbit: 10
} as const;

/** RSS feeds for the news adapter, tagged by tab (crypto | econ). */
export const NEWS_FEEDS: ReadonlyArray<{ source: string; url: string; category: 'crypto' | 'econ' }> = [
  { source: 'Cointelegraph', url: 'https://cointelegraph.com/rss', category: 'crypto' },
  { source: 'Decrypt', url: 'https://decrypt.co/feed', category: 'crypto' },
  { source: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', category: 'crypto' },
  {
    source: 'CNBC',
    url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114',
    category: 'econ'
  },
  {
    source: 'CNBC Economy',
    url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258',
    category: 'econ'
  },
  { source: 'MarketWatch', url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories', category: 'econ' },
  { source: 'Yahoo Finance', url: 'https://finance.yahoo.com/news/rssindex', category: 'econ' }
];

/**
 * MQTT brokers for the encrypted chat (primary + fallback). WSS only. Verified
 * 2026-06-15: EMQX and mosquitto both complete the browser WS upgrade (HTTP 101);
 * HiveMQ's public 8884 endpoint was unreliable (no 101 in repeated probes) so it
 * was dropped. The /mqtt path is required by EMQX; mosquitto ignores the path.
 */
export const MQTT_BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://test.mosquitto.org:8081/mqtt'
] as const;

/** Default asset-box titles (click a title in the UI to rename; persists). */
export const DEFAULT_BOX_TITLES = {
  friend: 'STONKS',
  owner: 'CRYPTO'
} as const;

/**
 * Pre-rename default titles. settings-store migrates these to the current
 * defaults on load, since old profiles have the full Settings object persisted
 * (the defaults got baked into settings.json on the first unrelated save).
 */
export const LEGACY_BOX_TITLES = {
  friend: 'INSIGHT DIGITAL R&D DIV',
  owner: 'DINO NUGGET INDUSTRIES'
} as const;

/**
 * Pre-2026-06-11 default asset lists. settings-store migrates a saved list that
 * still equals one of these (exactly, order-sensitive) to the current defaults
 * on load; user-edited lists are left alone. Same rationale as LEGACY_BOX_TITLES:
 * any save bakes the full Settings object into settings.json, so a default change
 * alone never reaches old profiles.
 */
export const LEGACY_FRIEND_KEYS = [
  'coingecko:ripple',
  'coingecko:solana',
  'coingecko:hyperliquid',
  'yahoo:MSTR',
  'yahoo:STRC'
] as const;

export const LEGACY_OWNER_KEYS = [
  'coingecko:plasma',
  'coingecko:aleo',
  'coingecko:thena'
] as const;

/** Default persisted settings. settings-store merges saved values over these. */
export function defaultSettings(): Settings {
  return {
    friendAssets: [...DEFAULT_FRIEND_KEYS],
    ownerAssets: [...DEFAULT_OWNER_KEYS],
    username: '',
    btcTargetPrice: DEFAULT_BTC_TARGET,
    liveTvUrl: DEFAULT_LIVE_TV_URL,
    videoTvUrl: DEFAULT_VIDEO_TV_URL,
    monitorUrl: DEFAULT_MONITOR_URL,
    activeRightTab: 'news',
    chaos: {
      wormhole: true,
      banners: true,
      scanlines: true,
      autoMessage: false
    },
    boxTitles: { ...DEFAULT_BOX_TITLES },
    centerAsset: DEFAULT_CENTER_KEY,
    secondaryAsset: SECONDARY_DEFAULT_KEY,
    holdings: {
      'yahoo:SPCX': 1,
      'yahoo:TSLA': 1,
      'yahoo:NVDA': 1,
      'yahoo:AAPL': 1,
      'yahoo:INTC': 1,
      'coingecko:bitcoin': 0.01,
      'coingecko:ethereum': 1,
      'coingecko:solana': 1,
      'coingecko:ripple': 1,
      'coingecko:hyperliquid': 1
    },
    scenes: {
      swapped: true,
      showWormhole: true,
      showNightCity: true,
      ultra: false,
      ultraCity: false
    },
    // matches layout.css: the two asset boxes at 1, the chart a touch taller at 1.25.
    leftFlex: { friend: 1, owner: 1, chart: 1.25 },
    privateMode: false,
    bugNutLabel: 'TOTAL',
    images: { useDefaults: true, custom: [] }
  };
}
