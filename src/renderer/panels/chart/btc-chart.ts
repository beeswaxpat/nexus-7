// Live BTC candlestick chart via lightweight-charts
// v5: createChart -> chart.addSeries(CandlestickSeries, opts). History comes from
// ctx.bridge.onCandlesInit (and store.candles for the instant snapshot paint); the
// live bar comes from ctx.bridge.onCandleUpdate. A ResizeObserver keeps the canvas
// matched to its grid cell. Transform-free, null-safe: the renderer also runs in a
// plain browser via dev:web with mocked data, so every external call is guarded and
// out-of-order / duplicate candles (which lightweight-charts throws on) are filtered.
// Signature FROZEN.

import {
  CandlestickSeries,
  ColorType,
  createChart,
  type CandlestickData,
  type DeepPartial,
  type ChartOptions,
  type IChartApi,
  type ISeriesApi,
  type Time,
  type UTCTimestamp
} from 'lightweight-charts';

import type { AppContext } from '../../app-context';
import type { Candle } from '../../../shared/types';
import './btc-chart.css';

// NEXUS-7 neon palette for candles (matches the green/red accents used across the
// reaction system). Up = neon green, down = neon magenta-red.
const UP_COLOR = '#00ff9c';
const DOWN_COLOR = '#ff3b6b';
const GRID_COLOR = 'rgba(120, 200, 255, 0.06)'; // faint cyan grid, no geometry shift
const TEXT_COLOR = 'rgba(170, 220, 255, 0.55)';

/** Chart options: dark transparent layout, faint grid, time-visible scale. */
function chartOptions(): DeepPartial<ChartOptions> {
  return {
    layout: {
      background: { type: ColorType.Solid, color: 'transparent' },
      textColor: TEXT_COLOR,
      fontFamily: "'Share Tech Mono', 'Chakra Petch', monospace",
      fontSize: 11
    },
    grid: {
      vertLines: { color: GRID_COLOR },
      horzLines: { color: GRID_COLOR }
    },
    timeScale: {
      timeVisible: true,
      secondsVisible: false,
      borderColor: 'rgba(120, 200, 255, 0.15)',
      // fixed spacing so the view shows the most recent bars at a readable width
      // instead of fitContent squashing all ~300 candles into the cell.
      barSpacing: 9,
      minBarSpacing: 3,
      rightOffset: 6
    },
    rightPriceScale: {
      borderColor: 'rgba(120, 200, 255, 0.15)'
    },
    crosshair: {
      // thin neon crosshair lines; purely cosmetic
      vertLine: { color: 'rgba(0, 255, 156, 0.35)', width: 1, labelBackgroundColor: '#0a0f14' },
      horzLine: { color: 'rgba(0, 255, 156, 0.35)', width: 1, labelBackgroundColor: '#0a0f14' }
    },
    // No fixed width/height: the ResizeObserver drives sizing from the grid cell.
    autoSize: false,
    handleScale: true,
    handleScroll: true
  };
}

/** Map our shared Candle (time in SECONDS) to a lightweight-charts CandlestickData. */
function toCandle(c: Candle): CandlestickData<Time> {
  return {
    time: c.time as UTCTimestamp,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close
  };
}

/** True only if every OHLC field + the time are finite numbers (drop junk/mocks). */
function isValid(c: Candle | null | undefined): c is Candle {
  return (
    !!c &&
    Number.isFinite(c.time) &&
    Number.isFinite(c.open) &&
    Number.isFinite(c.high) &&
    Number.isFinite(c.low) &&
    Number.isFinite(c.close)
  );
}

/**
 * Sanitize a history array for setData: drop invalid bars, sort ascending by time,
 * and dedupe (keep the last bar per timestamp). lightweight-charts requires strictly
 * ascending, unique times and throws otherwise, which the mock feed can violate.
 */
function sanitizeHistory(candles: readonly Candle[]): Candle[] {
  const byTime = new Map<number, Candle>();
  for (const c of candles) {
    if (isValid(c)) byTime.set(c.time, c); // later entry wins on duplicate time
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

export function mountBtcChart(container: HTMLElement, ctx: AppContext): void {
  // Null-safe: in dev:web a panel could be mounted before its cell exists.
  if (!container) return;

  // Dedicated host so lightweight-charts owns a clean, absolutely-positioned box
  // and our empty-state label can sit on top without the lib clearing it.
  const host = document.createElement('div');
  host.className = 'btc-chart__canvas';
  const empty = document.createElement('div');
  empty.className = 'btc-chart__empty';
  empty.textContent = 'awaiting candles';
  // Corner label so it is unmistakable WHAT this chart shows. The candle stream is
  // always Coinbase BTC-USD, independent of the user-chosen center asset.
  const label = document.createElement('div');
  label.className = 'btc-chart__label';
  label.textContent = 'BITCOIN · BTC/USD';
  label.setAttribute('aria-hidden', 'true');
  container.classList.add('btc-chart');
  container.replaceChildren(host, empty, label);

  let chart: IChartApi;
  let series: ISeriesApi<'Candlestick'>;
  try {
    chart = createChart(host, chartOptions());
    series = chart.addSeries(CandlestickSeries, {
      upColor: UP_COLOR,
      downColor: DOWN_COLOR,
      wickUpColor: UP_COLOR,
      wickDownColor: DOWN_COLOR,
      borderVisible: false
    });
  } catch (err) {
    // Charting failed to init (e.g. zero-size container in a headless context).
    // Leave the empty-state label and bail rather than crash the renderer.
    console.error('[btc-chart] failed to create chart', err);
    return;
  }

  // Track the last applied bar time so live updates never go backwards (which
  // would make lightweight-charts throw). Equal time = in-place update of the
  // current bar; greater time = a new bar; lesser time = stale, ignored.
  let lastTime = -Infinity;
  let hasData = false;

  const setHistory = (candles: readonly Candle[] | null | undefined): void => {
    if (!candles || candles.length === 0) return;
    const clean = sanitizeHistory(candles);
    if (clean.length === 0) return;
    try {
      series.setData(clean.map(toCandle));
      lastTime = clean[clean.length - 1].time;
      hasData = true;
      empty.style.display = 'none';
      // keep the latest bars in view at the fixed bar spacing (NOT fitContent,
      // which would squash the whole history into the cell).
      chart.timeScale().scrollToRealTime();
    } catch (err) {
      console.error('[btc-chart] setData failed', err);
    }
  };

  const applyTick = (candle: Candle | null | undefined): void => {
    if (!isValid(candle)) return;
    // Reject bars older than the last one we drew; allow same (update) or newer.
    if (candle.time < lastTime) return;
    const isNewBar = Number.isFinite(lastTime) && candle.time > lastTime;
    try {
      series.update(toCandle(candle));
      lastTime = candle.time;
      if (!hasData) {
        hasData = true;
        empty.style.display = 'none';
      }
      // a brand-new minute bar: keep the view tracking real time so it visibly moves.
      if (isNewBar) chart.timeScale().scrollToRealTime();
    } catch (err) {
      console.error('[btc-chart] update failed', err);
    }
  };

  // Instant paint from whatever snapshot the store already holds, then live feeds.
  // Guard ctx/bridge/store individually so a partial context never throws here.
  if (ctx?.store) {
    try {
      setHistory(ctx.store.get('candles'));
    } catch (err) {
      console.error('[btc-chart] snapshot read failed', err);
    }
  }

  const offInit = ctx?.bridge?.onCandlesInit?.((c) => setHistory(c));
  const offUpdate = ctx?.bridge?.onCandleUpdate?.((c) => applyTick(c));

  // Keep the canvas sized to its grid cell. Round + clamp so we never feed the
  // chart a fractional or negative dimension. Apply once up front in case the
  // observer's first callback is deferred past the initial layout.
  const resize = (width: number, height: number): void => {
    const w = Math.max(0, Math.floor(width));
    const h = Math.max(0, Math.floor(height));
    if (w === 0 || h === 0) return;
    try {
      chart.applyOptions({ width: w, height: h });
    } catch (err) {
      console.error('[btc-chart] resize failed', err);
    }
  };

  const ro = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const rect = entry.contentRect;
      resize(rect.width, rect.height);
    }
  });
  ro.observe(container);
  // Initial sizing from the current box (ResizeObserver also fires once on observe,
  // but this covers environments where layout is already settled).
  resize(container.clientWidth, container.clientHeight);

  // Best-effort teardown if the host element is ever removed from the DOM. Keeps
  // the WS-fed chart from leaking a detached canvas + observer during dev HMR.
  const mo = new MutationObserver(() => {
    if (!container.isConnected) {
      try {
        ro.disconnect();
        mo.disconnect();
        offInit?.();
        offUpdate?.();
        chart.remove();
      } catch {
        /* already torn down */
      }
    }
  });
  if (container.parentNode) {
    mo.observe(container.parentNode, { childList: true });
  }
}
