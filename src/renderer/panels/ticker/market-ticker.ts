// Phase 1 (Track B). Bottom full-width marquee. Renders store.ticker coins as
// "SYMBOL: $price (+x.xx%)" with an up/down class, laid out as one non-wrapping
// row inside `.ticker__track`. The coin list is duplicated TWICE so the Visual
// phase's translateX(-50%) keyframes loop seamlessly. Signature FROZEN: matches
// the stub and the main.ts call site mountMarketTicker(resolve('#ticker'), ctx).
//
// The hard requirement: when prices update we must NOT restart the CSS scroll
// animation. The animation lives on `.ticker__track`, so we (a) create that track
// element exactly once and never replace it, and (b) on each push update the cell
// text/class IN PLACE whenever the symbol sequence is unchanged. Only when the set
// of coins actually changes (different symbols/order/count) do we rebuild the
// track's children via replaceChildren, which still preserves the track element's
// running animation (animations restart on element replacement, not on child
// changes). Runs identically under Electron and the dev:web browser mock.

import './market-ticker.css';

import type { AppContext } from '../../app-context';
import type { TickerCoin } from '../../../shared/types';
import { el } from '../../core/dom';
import { formatPrice, formatPercent } from '../../core/format';

/** Handles to the mutable text/class targets inside one rendered coin cell. */
interface Cell {
  root: HTMLElement;
  price: HTMLElement;
  chg: HTMLElement;
}

/** Stable symbol used for empty/garbage entries so the fast path stays robust. */
function symbolOf(coin: TickerCoin | null | undefined): string {
  const s = coin && typeof coin.symbol === 'string' ? coin.symbol.trim() : '';
  return s || '?';
}

/** The signature key for a coin list: order + symbols. If unchanged between
 *  pushes we can update text in place and leave the animation running. */
function sequenceKey(coins: readonly TickerCoin[]): string {
  return coins.map(symbolOf).join('');
}

/** Build one coin cell. Returns the node plus its mutable inner targets. */
function buildCell(coin: TickerCoin): Cell {
  const sym = el('span', { class: 'ticker__sym', text: symbolOf(coin) + ':' });
  const price = el('span', { class: 'ticker__price', text: formatPrice(coin?.price) });
  const chg = el('span', { class: 'ticker__chg', text: '(' + formatPercent(coin?.change24h) + ')' });
  const root = el('span', { class: 'ticker__item' }, sym, price, chg);
  applyChange(root, coin?.change24h);
  return { root, price, chg };
}

/** Set the up/down class on a cell root from a (possibly null) 24h change. */
function applyChange(root: HTMLElement, change24h: number | null | undefined): void {
  const up = typeof change24h === 'number' && Number.isFinite(change24h) && change24h >= 0;
  const down = typeof change24h === 'number' && Number.isFinite(change24h) && change24h < 0;
  root.classList.toggle('is-up', up);
  root.classList.toggle('is-down', down);
}

export function mountMarketTicker(container: HTMLElement, ctx: AppContext): void {
  if (!container) return;

  // Persistent children: the track (animated, never replaced) and an empty-state
  // node shown before any data arrives. Created once.
  const track = el('div', { class: 'ticker__track', 'aria-hidden': 'false' });
  const empty = el('div', { class: 'ticker__empty', text: 'Awaiting market feed...' });
  container.replaceChildren(track, empty);

  // Fast-path bookkeeping. cellsA/cellsB are the two duplicated halves, index-aligned.
  let lastKey = '';
  let cellsA: Cell[] = [];
  let cellsB: Cell[] = [];

  // Pause the marquee when the page is hidden (cheap CPU win; the keyframes added
  // in the Visual phase honor [data-paused]). Guarded for non-DOM/test contexts.
  const syncPaused = (): void => {
    const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
    track.dataset.paused = hidden ? 'true' : 'false';
  };
  syncPaused();
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('visibilitychange', syncPaused);
  }

  const render = (raw: readonly TickerCoin[] | null | undefined): void => {
    // Defensive: store may hold [] (initial) or, under odd mock/data conditions,
    // a non-array. Coerce to a clean array and drop null/garbage entries.
    const coins: TickerCoin[] = Array.isArray(raw) ? raw.filter((c): c is TickerCoin => !!c) : [];

    if (coins.length === 0) {
      // No data yet: keep the bar height, show the faint notice, leave the track
      // element in place (so we never restart the animation when data returns).
      track.replaceChildren();
      track.style.display = 'none';
      empty.style.display = '';
      lastKey = '';
      cellsA = [];
      cellsB = [];
      return;
    }

    empty.style.display = 'none';
    track.style.display = '';

    const key = sequenceKey(coins);
    if (key === lastKey && cellsA.length === coins.length && cellsB.length === coins.length) {
      // FAST PATH: same coins in the same order. Update price + percent + sign in
      // place across BOTH duplicated halves. The track element is untouched, so
      // its CSS scroll animation keeps running without a hitch.
      for (let i = 0; i < coins.length; i++) {
        const coin = coins[i];
        const price = formatPrice(coin?.price);
        const chg = '(' + formatPercent(coin?.change24h) + ')';
        const a = cellsA[i];
        const b = cellsB[i];
        if (a) {
          if (a.price.textContent !== price) a.price.textContent = price;
          if (a.chg.textContent !== chg) a.chg.textContent = chg;
          applyChange(a.root, coin?.change24h);
        }
        if (b) {
          if (b.price.textContent !== price) b.price.textContent = price;
          if (b.chg.textContent !== chg) b.chg.textContent = chg;
          applyChange(b.root, coin?.change24h);
        }
      }
      return;
    }

    // STRUCTURE CHANGED: rebuild the cells (different symbols/order/count). Build
    // the list TWICE for a seamless -50% loop, then swap the track's CHILDREN in
    // one shot. We replace children, never the track node, so the animation that
    // the Visual phase attaches to `.ticker__track` is preserved across rebuilds.
    cellsA = coins.map(buildCell);
    cellsB = coins.map(buildCell);
    const nodes: Node[] = [];
    for (const c of cellsA) nodes.push(c.root);
    for (const c of cellsB) nodes.push(c.root);
    track.replaceChildren(...nodes);
    lastKey = key;
  };

  // subscribe() fires immediately with the current value (often [] at boot), then
  // on every push. ctx.store is the frozen pub/sub seam.
  const unsub = ctx.store.subscribe('ticker', render);

  // Tear down the store subscription AND the visibilitychange listener if this
  // container is re-mounted, so neither leaks across mounts.
  const host = container as HTMLElement & { __tickerUnsub?: () => void };
  host.__tickerUnsub?.();
  host.__tickerUnsub = () => {
    unsub();
    if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
      document.removeEventListener('visibilitychange', syncPaused);
    }
  };
}
