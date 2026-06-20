// Resizable left-column boxes. Inserts two dividers into #col-left, one between
// box-friend and box-owner, one between box-owner and box-chart, and lets the user
// drag (or arrow-key) the boundary to re-weight the three stacked boxes. We only
// touch flex-grow, so the grid never reflows; layout-swap re-parents slot CONTENT
// (never the slot divs), so these dividers keep working regardless of arrangement.
//
// The weights live in Settings.leftFlex ({ friend, owner, chart }) and persist on
// pointerup / double-click / keyboard commit. Null-safe for dev:web: ctx.settings
// may be absent and ctx.updateSettings may reject (we catch and keep the in-memory
// flex). No timers except the keyboard commit debounce, which is self-cleaning.

import './col-resize.css';
import { defaultSettings } from '../../shared/constants';
import type { AppContext } from '../app-context';
import type { Settings } from '../../shared/types';

/** The three resizable slot ids, top to bottom. */
const SLOT_IDS = ['box-friend', 'box-owner', 'box-chart'] as const;
type SlotKey = 'friend' | 'owner' | 'chart';

/** Slot id -> the leftFlex key it carries. */
const KEY_OF: Record<(typeof SLOT_IDS)[number], SlotKey> = {
  'box-friend': 'friend',
  'box-owner': 'owner',
  'box-chart': 'chart'
};

/** Each box's flex weight is clamped here so no box can collapse or dominate. */
const MIN_WEIGHT = 0.25;
const MAX_WEIGHT = 2.5;

/** Keyboard arrow step and the commit-after-idle debounce. */
const KEY_STEP = 0.05;
const KEY_COMMIT_MS = 600;

type Flex = Record<SlotKey, number>;

/** The default weights, read once from defaultSettings() so we stay in sync. */
function defaultFlex(): Flex {
  const d = defaultSettings().leftFlex;
  // defaultSettings always sets leftFlex, but stay defensive in case it changes.
  return d ? { ...d } : { friend: 1, owner: 1, chart: 1.25 };
}

const clampWeight = (w: number): number => Math.min(MAX_WEIGHT, Math.max(MIN_WEIGHT, w));

export function mountColResize(col: HTMLElement, ctx: AppContext): void {
  if (!(col instanceof HTMLElement)) return;
  if (col.querySelector('.colsplit')) return; // idempotent: dividers already inserted

  const boxes = SLOT_IDS.map((id) => document.getElementById(id)).filter(
    (e): e is HTMLElement => e instanceof HTMLElement
  );
  if (boxes.length < 3) return; // need all three to insert two dividers between them

  const [friendBox, ownerBox, chartBox] = boxes;

  // current weights, seeded from settings (fallback to defaults), kept in memory
  const flex: Flex = { ...defaultFlex(), ...(ctx?.settings?.leftFlex ?? {}) };

  /** Push the in-memory weights onto the slot divs (the only thing we ever mutate). */
  function applyFlex(): void {
    friendBox.style.flexGrow = String(flex.friend);
    ownerBox.style.flexGrow = String(flex.owner);
    chartBox.style.flexGrow = String(flex.chart);
  }

  /** Persist the current weights; tolerate a rejecting bridge (dev:web). */
  function persist(): void {
    const patch: Partial<Settings> = { leftFlex: { ...flex } };
    const p = ctx?.updateSettings?.(patch);
    if (p && typeof p.catch === 'function') p.catch(() => undefined);
  }

  applyFlex();

  // Build the two dividers. Each one resizes the pair of boxes ABOVE and BELOW it.
  makeDivider(friendBox, ownerBox, 'friend', 'owner', friendBox); // before owner
  makeDivider(ownerBox, chartBox, 'owner', 'chart', ownerBox); // before chart

  /**
   * Insert a divider after `afterBox` (so it sits between the two passed boxes) and
   * wire its drag + keyboard handlers. `aKey`/`bKey` are the upper/lower box weights;
   * dragging down (dy > 0) grows the upper box and shrinks the lower one.
   */
  function makeDivider(
    aBox: HTMLElement,
    bBox: HTMLElement,
    aKey: SlotKey,
    bKey: SlotKey,
    afterBox: HTMLElement
  ): void {
    const div = document.createElement('div');
    div.className = 'colsplit';
    div.setAttribute('role', 'separator');
    div.setAttribute('aria-orientation', 'horizontal');
    div.tabIndex = 0;
    div.setAttribute('aria-label', `Resize the ${aKey} and ${bKey} boxes`);

    // place it directly after the upper box so flex order is box / divider / box
    afterBox.after(div);

    // --- pointer drag: transfer weight between the two adjacent boxes only ------
    let dragging = false;
    let startY = 0;
    let startA = 0;
    let startB = 0;

    div.addEventListener('pointerdown', (e: PointerEvent) => {
      dragging = true;
      startY = e.clientY;
      startA = flex[aKey];
      startB = flex[bKey];
      div.setPointerCapture(e.pointerId);
      e.preventDefault();
    });

    div.addEventListener('pointermove', (e: PointerEvent) => {
      if (!dragging) return;
      const h = col.clientHeight || 1;
      const total = startA + startB; // the pair's combined weight is conserved
      const dy = e.clientY - startY;
      const delta = (dy / h) * total;
      // dragging down grows the upper box (aKey), shrinks the lower (bKey)
      let a = clampWeight(startA + delta);
      let b = total - a;
      // re-clamp the lower box and reflect any spillover back onto the upper one,
      // then re-clamp the upper box too so neither side can escape [MIN,MAX] even
      // if the pair total were ever entered in a degenerate state
      b = clampWeight(b);
      a = clampWeight(total - b);
      b = total - a;
      flex[aKey] = a;
      flex[bKey] = b;
      applyFlex();
    });

    const endDrag = (e: PointerEvent): void => {
      if (!dragging) return;
      dragging = false;
      if (div.hasPointerCapture(e.pointerId)) div.releasePointerCapture(e.pointerId);
      persist(); // single write per gesture
    };
    div.addEventListener('pointerup', endDrag);
    div.addEventListener('pointercancel', endDrag);

    // --- double-click: reset ALL three boxes to defaults --------------------------
    div.addEventListener('dblclick', () => {
      const d = defaultFlex();
      flex.friend = d.friend;
      flex.owner = d.owner;
      flex.chart = d.chart;
      applyFlex();
      persist();
    });

    // --- keyboard a11y: ArrowUp/Down move 0.05, Home resets; commit on idle/blur --
    let commitTimer: number | null = null;
    const scheduleCommit = (): void => {
      if (commitTimer !== null) window.clearTimeout(commitTimer);
      commitTimer = window.setTimeout(() => {
        commitTimer = null;
        persist();
      }, KEY_COMMIT_MS);
    };

    div.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        // ArrowDown grows the upper box (mirrors a downward drag); ArrowUp shrinks it
        const dir = e.key === 'ArrowDown' ? 1 : -1;
        const total = flex[aKey] + flex[bKey];
        let a = clampWeight(flex[aKey] + dir * KEY_STEP);
        let b = clampWeight(total - a);
        a = clampWeight(total - b);
        b = total - a;
        flex[aKey] = a;
        flex[bKey] = b;
        applyFlex();
        scheduleCommit();
        e.preventDefault();
      } else if (e.key === 'Home') {
        const d = defaultFlex();
        flex.friend = d.friend;
        flex.owner = d.owner;
        flex.chart = d.chart;
        applyFlex();
        scheduleCommit();
        e.preventDefault();
      }
    });

    // commit immediately on blur if an arrow/Home change is still pending
    div.addEventListener('blur', () => {
      if (commitTimer !== null) {
        window.clearTimeout(commitTimer);
        commitTimer = null;
        persist();
      }
    });
  }
}
