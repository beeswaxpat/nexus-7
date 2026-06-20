// IMPLEMENTED (Phase 1, Track B). Builds one asset row element: name, reactive
// emoji, price, 24h %, 7d %, market cap, and a small stale dot. Pure presentation
// of one AssetQuote. Updates happen IN PLACE (updateAssetRow) so geometry never
// changes: only textContent/class swap and the emoji animates via transform.
// createAssetRow's signature is FROZEN ((quote) => HTMLElement).
//
// The cap cell doubles as the HOLDINGS cell: click it to type how many units you
// hold; the cell then shows what that bag is worth (gold) instead of market cap,
// updating live with the price. Quantities persist in Settings.holdings.

import type { AssetQuote } from '../../../shared/types';
import { el } from '../../core/dom';
import { formatPrice, formatMarketCap, formatPercent, formatHoldingValue } from '../../core/format';
import { emojiFor, emojiGlyph, emojiPulses, type Emoji } from '../../core/reactions';
import { centerKey } from '../../core/center';
import { getCachedSettings, update as updateSettings } from '../../state/settings';
import { PRIVACY_EVENT, markPrivate } from '../../core/privacy';

import './asset-box.css';

// Privacy state lives at module scope because createAssetRow's signature is FROZEN
// (no ctx param to read isPrivate from). The owning box refreshes this at render
// start via setRowPrivacy(); we also listen for PRIVACY_EVENT here so already-
// mounted rows re-blur on a toggle even between data pushes. The event detail
// carries { on }, so we trust it; getCachedSettings is the fallback.
let currentPrivate = getCachedSettings().privateMode === true;

/** Refresh the module-scope privacy flag (called by the box at render start). */
export function setRowPrivacy(on: boolean): void {
  currentPrivate = on === true;
}

if (typeof window !== 'undefined') {
  window.addEventListener(PRIVACY_EVENT, (e) => {
    const detail = (e as CustomEvent<{ on?: boolean }>).detail;
    currentPrivate =
      detail && typeof detail.on === 'boolean' ? detail.on : getCachedSettings().privateMode === true;
  });
}

/** The mutable cells of a row, cached so updates touch text only (no re-layout). */
interface RowRefs {
  root: HTMLElement;
  emoji: HTMLElement;
  name: HTMLElement;
  price: HTMLElement;
  change24h: HTMLElement;
  change7d: HTMLElement;
  cap: HTMLElement;
  /** Last quote applied; lets the holdings editor re-render without new data. */
  quote: AssetQuote;
  /** True while the cap cell is being edited (applyQuote leaves it alone). */
  editingQty: boolean;
}

// Keeps createAssetRow's public return type exactly HTMLElement while letting the
// box update a row in place. WeakMap so detached rows get GC'd with their refs.
const refsByRow = new WeakMap<HTMLElement, RowRefs>();

/** True when this quote is the featured center asset, per the happy-emoji rule. */
function isCenterAssetKey(key: string | null | undefined): boolean {
  return typeof key === 'string' && key.toLowerCase() === centerKey().toLowerCase();
}

/** Best label for the row: prefer the ticker symbol, fall back to name then key. */
function rowLabel(quote: AssetQuote): string {
  return quote.symbol || quote.name || quote.key || '';
}

/** Apply an emoji token to a cell (glyph + transform-only pulse class). */
function applyEmoji(cell: HTMLElement, token: Emoji): void {
  cell.textContent = emojiGlyph(token);
  cell.classList.toggle('asset-row__emoji--pulse', emojiPulses(token));
  // expose the token for the visual phase / debugging without changing geometry
  if (token) cell.dataset.emoji = token;
  else delete cell.dataset.emoji;
}

/** Apply up/down semantics to a change cell. null change clears both classes. */
function applyChange(cell: HTMLElement, change: number | null | undefined): void {
  cell.textContent = formatPercent(change ?? null);
  const up = change != null && Number.isFinite(change) && change >= 0;
  const down = change != null && Number.isFinite(change) && change < 0;
  cell.classList.toggle('asset-row__change--up', up);
  cell.classList.toggle('asset-row__change--down', down);
}

/** Units held of this row's asset (0 when none recorded). */
function heldQty(key: string): number {
  const qty = getCachedSettings().holdings?.[key];
  return typeof qty === 'number' && Number.isFinite(qty) && qty > 0 ? qty : 0;
}

/** Render the cap cell: the user's bag value when a quantity is set, else mkt cap. */
function renderCap(refs: RowRefs): void {
  if (refs.editingQty) return;
  const { cap, quote } = refs;
  const qty = heldQty(quote.key);
  const price = quote.price;
  const bagMode = qty > 0 && price != null && Number.isFinite(price);
  if (bagMode) {
    cap.textContent = formatHoldingValue(qty * price!);
    cap.classList.add('asset-row__cap--bag');
    cap.title = `Your bag: ${qty} ${rowLabel(quote)} (click to edit, 0 clears)`;
  } else {
    cap.textContent = formatMarketCap(quote.marketCap ?? null);
    cap.classList.remove('asset-row__cap--bag');
    cap.title = 'Market cap (click to enter how many you hold)';
  }
  // Blur the cap ONLY when it is showing a bag value; market cap stays visible.
  // pointer-events:none from .nx-blur also keeps the qty editor unreachable.
  markPrivate(cap, currentPrivate && bagMode);
}

/** Turn the cap cell into an inline quantity editor until commit/cancel. */
function startQtyEdit(refs: RowRefs): void {
  if (refs.editingQty) return;
  // Privacy guard: while private the bag value is blurred and must stay
  // unreachable. pointer-events:none blocks the click path; this blocks the
  // keyboard path (the cap has role=button tabindex=0, so Enter/Space land here).
  if (currentPrivate && heldQty(refs.quote.key) > 0) return;
  refs.editingQty = true;
  const { cap } = refs;
  const prior = heldQty(refs.quote.key);
  cap.classList.add('asset-row__cap--editing');
  cap.textContent = prior > 0 ? String(prior) : '';
  cap.setAttribute('contenteditable', 'plaintext-only');
  cap.title = 'Units held. Enter saves, Esc cancels, 0 clears';
  cap.focus();
  // select existing digits so a fresh number overwrites in one keystroke
  const sel = window.getSelection();
  if (sel) {
    const range = document.createRange();
    range.selectNodeContents(cap);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  const finish = (commit: boolean): void => {
    cap.removeEventListener('keydown', onKey);
    cap.removeEventListener('blur', onBlur);
    cap.removeAttribute('contenteditable');
    cap.classList.remove('asset-row__cap--editing');
    refs.editingQty = false;
    if (commit) {
      const raw = (cap.textContent ?? '').replace(/[,$\s]/g, '');
      const parsed = raw === '' ? 0 : Number(raw);
      const qty = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
      if (qty !== prior) {
        void updateSettings({ holdings: { [refs.quote.key]: qty } });
        // let the owning box recompute its header total
        refs.root.dispatchEvent(new CustomEvent('nexus:holdings-changed', { bubbles: true }));
      }
    }
    renderCap(refs);
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      finish(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      finish(false);
    }
  };
  const onBlur = (): void => finish(true);
  cap.addEventListener('keydown', onKey);
  cap.addEventListener('blur', onBlur);
}

/** Write a quote's values into a row's cached cells. Used by create + update. */
function applyQuote(refs: RowRefs, quote: AssetQuote): void {
  refs.quote = quote;
  refs.root.dataset.key = quote.key;

  applyEmoji(refs.emoji, emojiFor(quote.change24h ?? null, isCenterAssetKey(quote.key)));

  refs.name.textContent = rowLabel(quote);
  refs.name.title = quote.name || rowLabel(quote);

  refs.price.textContent = formatPrice(quote.price ?? null);

  applyChange(refs.change24h, quote.change24h ?? null);
  applyChange(refs.change7d, quote.change7d ?? null);

  renderCap(refs);

  refs.root.classList.toggle('asset-row--stale', quote.stale === true);
  refs.root.title = quote.stale === true ? `${rowLabel(quote)} (last known, source stale)` : '';
}

/** Create (do not mount) a row element for one quote. Signature FROZEN. */
export function createAssetRow(quote: AssetQuote): HTMLElement {
  const emoji = el('span', { class: 'asset-row__emoji' });
  const name = el('span', { class: 'asset-row__name' });
  const price = el('span', { class: 'asset-row__price' });
  const change24h = el('span', { class: 'asset-row__change asset-row__change--24h' });
  const change7d = el('span', { class: 'asset-row__change asset-row__change--7d' });
  const cap = el('span', { class: 'asset-row__cap', role: 'button', tabindex: '0' });
  const stale = el('span', { class: 'asset-row__stale', 'aria-hidden': 'true' });

  const root = el(
    'div',
    { class: 'asset-row', 'data-key': quote.key },
    emoji,
    name,
    price,
    change24h,
    change7d,
    cap,
    stale
  );

  const refs: RowRefs = {
    root,
    emoji,
    name,
    price,
    change24h,
    change7d,
    cap,
    quote,
    editingQty: false
  };
  refsByRow.set(root, refs);

  cap.addEventListener('click', () => startQtyEdit(refs));
  cap.addEventListener('keydown', (e) => {
    if (!refs.editingQty && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      startQtyEdit(refs);
    }
  });

  applyQuote(refs, quote);
  return root;
}

/**
 * Update a row created by createAssetRow with a fresh quote, IN PLACE. Geometry is
 * unchanged (only text/class swap; emoji animates via transform). If the element
 * was not produced by createAssetRow it is a no-op (defensive for dev:web).
 */
export function updateAssetRow(row: HTMLElement, quote: AssetQuote): void {
  const refs = refsByRow.get(row);
  if (!refs) return;
  applyQuote(refs, quote);
}
