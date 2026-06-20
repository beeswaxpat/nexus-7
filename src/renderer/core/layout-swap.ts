// Drag-and-drop panel rearrangement. Adds a small drag grip to each top-level slot;
// dragging one slot's grip onto another SWAPS their mounted panels by RE-PARENTING
// the content nodes, so panel state (chart series, wormhole rAF loop, chat socket)
// survives the move. The arrangement persists in Settings.layout ({ [slotId]: panelId })
// and is restored on the next boot. Non-invasive: panels do not know this exists.

import './layout-swap.css';
import type { AppContext } from '../app-context';

/** Swappable top-level slots (container element ids). The ticker is intentionally out. */
const SLOT_IDS = ['box-friend', 'box-owner', 'box-chart', 'center', 'panel-news', 'panel-chat'] as const;

/** Braille drag dots. */
const GRIP_GLYPH = '⠿';

/** The mounted panel node inside a slot (tagged with data-nx-panel), if present. */
function contentOf(slot: HTMLElement): HTMLElement | null {
  return slot.querySelector<HTMLElement>(':scope > [data-nx-panel]');
}

export function initLayoutSwap(ctx: AppContext): void {
  const slots = SLOT_IDS.map((id) => document.getElementById(id)).filter(
    (e): e is HTMLElement => e instanceof HTMLElement
  );
  if (slots.length < 2) return;

  for (const slot of slots) {
    slot.classList.add('nx-swap-slot');

    // tag the mounted panel (first element child) with its ORIGINAL slot id, once.
    const content = slot.firstElementChild as HTMLElement | null;
    if (content && !content.hasAttribute('data-nx-panel')) {
      content.setAttribute('data-nx-panel', slot.id);
    }

    // add a drag grip, once.
    if (!slot.querySelector(':scope > .nx-grip')) {
      const grip = document.createElement('button');
      grip.className = 'nx-grip';
      grip.type = 'button';
      grip.draggable = true;
      grip.title = 'Drag to swap this panel with another';
      grip.setAttribute('aria-label', 'Drag to rearrange panels');
      grip.textContent = GRIP_GLYPH;
      grip.addEventListener('dragstart', (e) => {
        e.dataTransfer?.setData('text/plain', slot.id);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
        document.body.classList.add('nx-swapping');
      });
      grip.addEventListener('dragend', () => {
        document.body.classList.remove('nx-swapping');
        for (const s of slots) s.classList.remove('nx-swap-over');
      });
      slot.appendChild(grip);
    }

    slot.addEventListener('dragover', (e) => {
      if (!document.body.classList.contains('nx-swapping')) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      slot.classList.add('nx-swap-over');
    });
    slot.addEventListener('dragleave', (e) => {
      if (e.target === slot) slot.classList.remove('nx-swap-over');
    });
    slot.addEventListener('drop', (e) => {
      e.preventDefault();
      slot.classList.remove('nx-swap-over');
      const from = e.dataTransfer?.getData('text/plain') ?? '';
      if (from && from !== slot.id) swapSlots(from, slot.id);
    });
  }

  /** Swap the mounted panels between two slots by re-parenting (state preserved). */
  function swapSlots(aId: string, bId: string): void {
    const a = document.getElementById(aId);
    const b = document.getElementById(bId);
    if (!a || !b) return;
    const ca = contentOf(a);
    const cb = contentOf(b);
    if (!ca || !cb) return;
    b.appendChild(ca);
    a.appendChild(cb);
    persist();
  }

  /** Current slotId -> panelId arrangement, read from the tagged content nodes. */
  function currentMap(): Record<string, string> {
    const map: Record<string, string> = {};
    for (const slot of slots) {
      const c = contentOf(slot);
      if (c) map[slot.id] = c.getAttribute('data-nx-panel') ?? slot.id;
    }
    return map;
  }

  function persist(): void {
    const p = ctx?.updateSettings?.({ layout: currentMap() });
    if (p && typeof p.catch === 'function') p.catch(() => undefined);
  }

  /** Restore a saved arrangement: append each panel into its target slot. */
  function applyLayout(map: Record<string, string> | undefined): void {
    if (!map) return;
    const byPanel = new Map<string, HTMLElement>();
    for (const slot of slots) {
      const c = contentOf(slot);
      if (c) byPanel.set(c.getAttribute('data-nx-panel') ?? slot.id, c);
    }
    for (const slot of slots) {
      const want = map[slot.id];
      if (!want) continue;
      const node = byPanel.get(want);
      if (node && node.parentElement !== slot) slot.appendChild(node);
    }
  }

  applyLayout(ctx?.settings?.layout);
}
