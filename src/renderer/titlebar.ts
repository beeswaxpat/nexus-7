// Custom titlebar for the frameless window: a draggable bar with the NEXUS-7
// wordmark on the left, a row of source-health LEDs in the middle, and the
// settings / fullscreen / minimize / maximize / close controls on the right.
// The bar is -webkit-app-region: drag (moves the window); the buttons are no-drag.
// Actions go through the bridge -> preload -> main BrowserWindow.

import './titlebar.css';
import type { AppContext } from './app-context';
import type { SourceStatus } from '../shared/types';
import { el } from './core/dom';
import { openSettings } from './core/settings-panel';

/**
 * The data sources shown as LEDs, in display order. `sources` lists the
 * scheduler status keys folded into one light (worst wins); `label` is what the
 * tooltip calls it. Anything the user has not seen yet stays a dim "no data" dot.
 */
const LEDS: ReadonlyArray<{ id: string; label: string; sources: string[] }> = [
  { id: 'crypto', label: 'Crypto prices (CoinGecko)', sources: ['coingecko', 'ticker'] },
  { id: 'stocks', label: 'Stock quotes (Yahoo)', sources: ['yahoo'] },
  { id: 'chart', label: 'BTC candles (Coinbase)', sources: ['candles'] },
  { id: 'news', label: 'News feeds', sources: ['news'] },
  { id: 'fng', label: 'Fear and Greed', sources: ['fng'] }
];

function ago(ms: number): string {
  if (!ms) return 'never';
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.round(m / 60)}h ago`;
}

export function mountTitlebar(container: HTMLElement, ctx: AppContext): void {
  if (!container) return;

  const brand = el('div', { class: 'titlebar__brand' },
    el('span', { class: 'titlebar__dot', 'aria-hidden': 'true' }),
    el('span', { class: 'titlebar__name', text: 'NEXUS-7' }),
    // Animated neon/lava wordmark (CSS does the flowing-gradient + glow work).
    el('span', { class: 'titlebar__fable', text: 'FABLE-POWERED' })
  );

  // --- source-health LEDs ----------------------------------------------------
  // The scheduler pushes a SourceStatus per job; feeds.ts folds them into
  // store.statuses. Green = last fetch ok, red = last fetch failed (the panels
  // keep showing last-good data, marked stale), dim = nothing heard yet.
  const ledEls = new Map<string, HTMLElement>();
  const leds = el('div', { class: 'titlebar__leds', role: 'status', 'aria-label': 'Data source health' });
  for (const def of LEDS) {
    const led = el('span', { class: 'titlebar__led', 'data-state': 'idle', title: `${def.label}: no data yet` });
    ledEls.set(def.id, led);
    leds.append(led);
  }
  const renderLeds = (list: SourceStatus[]): void => {
    const byName = new Map<string, SourceStatus>();
    for (const s of Array.isArray(list) ? list : []) if (s && s.source) byName.set(s.source, s);
    for (const def of LEDS) {
      const led = ledEls.get(def.id);
      if (!led) continue;
      const hits = def.sources.map((n) => byName.get(n)).filter((s): s is SourceStatus => !!s);
      if (hits.length === 0) {
        led.dataset.state = 'idle';
        led.title = `${def.label}: no data yet`;
        continue;
      }
      const bad = hits.find((s) => !s.ok);
      const lastOk = Math.max(...hits.map((s) => s.lastSuccess || 0));
      if (bad) {
        led.dataset.state = 'error';
        led.title = `${def.label}: last fetch failed (${bad.lastError ?? 'unknown error'}). Last good data ${ago(lastOk)}; showing last known values.`;
      } else {
        led.dataset.state = 'ok';
        led.title = `${def.label}: ok, updated ${ago(lastOk)}`;
      }
    }
  };
  ctx.store?.subscribe?.('statuses', renderLeds);

  const mkBtn = (cls: string, glyph: string, title: string, onClick: () => void): HTMLElement => {
    const b = el('button', {
      class: 'titlebar__btn ' + cls,
      type: 'button',
      title,
      'aria-label': title
    }, glyph);
    b.addEventListener('click', onClick);
    return b;
  };

  const fsBtn = mkBtn('titlebar__btn--fullscreen', '⛶', 'Fullscreen (F11)', () =>
    ctx.bridge.toggleFullscreen?.()
  );
  const maxBtn = mkBtn('titlebar__btn--max', '□', 'Maximize', () => ctx.bridge.toggleMaximizeWindow?.());

  const controls = el('div', { class: 'titlebar__controls' },
    mkBtn('titlebar__btn--settings', '⚙', 'Settings', () => openSettings(ctx)),
    fsBtn,
    mkBtn('titlebar__btn--min', '–', 'Minimize', () => ctx.bridge.minimizeWindow?.()),
    maxBtn,
    mkBtn('titlebar__btn--close', '✕', 'Close', () => ctx.bridge.closeWindow?.())
  );

  container.replaceChildren(brand, leds, controls);

  // Windows convention: double-click the bar to maximize / restore.
  container.addEventListener('dblclick', (e) => {
    if ((e.target as HTMLElement | null)?.closest('.titlebar__controls')) return;
    ctx.bridge.toggleMaximizeWindow?.();
  });

  // Reflect maximize state on the button (also catches OS snap / double-click).
  ctx.bridge.onMaximizeState?.((on) => {
    maxBtn.textContent = on ? '❐' : '□';
    const label = on ? 'Restore' : 'Maximize';
    maxBtn.title = label;
    maxBtn.setAttribute('aria-label', label);
  });

  // Reflect fullscreen state on the button (also catches F11 / OS-driven changes).
  ctx.bridge.onFullscreenState?.((on) => {
    fsBtn.classList.toggle('is-active', on);
    const label = on ? 'Exit fullscreen (F11)' : 'Fullscreen (F11)';
    fsBtn.title = label;
    fsBtn.setAttribute('aria-label', label);
  });

  // F11 toggles true fullscreen from anywhere in the app.
  window.addEventListener('keydown', (e) => {
    if (e.key === 'F11') {
      e.preventDefault();
      ctx.bridge.toggleFullscreen?.();
    }
  });
}
