// Renders one titled asset box. BOTH boxes are fully user-editable: title
// (click to rename), asset list (the + button opens the picker; keys persist in
// settings.friendAssets / settings.ownerAssets by scope), and units held per
// asset (click a row's cap cell). Subscribes to store.crypto + store.stocks and
// reconciles rows by key so updates happen in place (no reflow).
// mountAssetBox's signature is FROZEN ((container, opts, ctx) => void).

import type { AppContext } from '../../app-context';
import type { AssetQuote } from '../../../shared/types';
import { el, mount } from '../../core/dom';
import { DEFAULT_BOX_TITLES, DEFAULT_FRIEND_KEYS, DEFAULT_OWNER_KEYS } from '../../../shared/constants';
import { formatHoldingValue } from '../../core/format';
import { getCachedSettings } from '../../state/settings';
import { PRIVACY_EVENT, isPrivate, setPrivate, markPrivate } from '../../core/privacy';
import { createAssetRow, updateAssetRow, setRowPrivacy } from './asset-row';
import { openAssetPicker } from './asset-picker';

import './asset-box.css';

// Inline eye icons (stroke currentColor, ~14px). Eye = values visible; eye-off
// (diagonal slash) = private/blurred. No external asset, no fill, matches chrome.
const EYE_OPEN_SVG =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" ' +
  'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M1.5 12S5 5 12 5s10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12Z"/>' +
  '<circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF_SVG =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" ' +
  'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M9.9 5.2A10.5 10.5 0 0 1 12 5c7 0 10.5 7 10.5 7a18 18 0 0 1-3.3 4.1M6.3 6.6A18 18 0 0 0 1.5 12S5 19 12 19a10 10 0 0 0 4.3-.9"/>' +
  '<path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/><path d="M3 3l18 18"/></svg>';

export interface AssetBoxOptions {
  editable: boolean;
  scope: 'owner' | 'friend';
}

/** Current title for this box: persisted settings first, then the default. */
function titleFor(scope: AssetBoxOptions['scope'], ctx: AppContext): string {
  const saved = ctx.settings?.boxTitles?.[scope];
  return typeof saved === 'string' && saved.trim().length > 0 ? saved : DEFAULT_BOX_TITLES[scope];
}

/**
 * Make a box title renamable in place: click to edit, Enter/blur commits (persists
 * via settings.boxTitles), Escape cancels. Empty input falls back to the default.
 */
function makeTitleEditable(
  title: HTMLElement,
  scope: AssetBoxOptions['scope'],
  ctx: AppContext
): void {
  title.classList.add('asset-box__title--editable');
  title.title = 'Click to rename';
  title.setAttribute('role', 'textbox');
  title.setAttribute('aria-label', 'Box title (click to rename)');
  title.tabIndex = 0;

  let before = title.textContent ?? '';

  const beginEdit = (): void => {
    if (title.isContentEditable) return;
    before = title.textContent ?? '';
    title.contentEditable = 'true';
    title.spellcheck = false;
    title.focus();
    // select the whole title so typing replaces it
    const range = document.createRange();
    range.selectNodeContents(title);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  };

  const endEdit = (commit: boolean): void => {
    if (!title.isContentEditable) return;
    title.contentEditable = 'false';
    const raw = (title.textContent ?? '').replace(/\s+/g, ' ').trim();
    const next = commit && raw.length > 0 ? raw.slice(0, 40) : '';
    if (!commit || next === before) {
      title.textContent = before;
      return;
    }
    const value = next || DEFAULT_BOX_TITLES[scope];
    title.textContent = value;
    void ctx
      .updateSettings({ boxTitles: { ...(ctx.settings?.boxTitles ?? {}), [scope]: value } })
      .catch(() => {
        title.textContent = before; // persist failed: restore the old name
      });
  };

  title.addEventListener('click', beginEdit);
  title.addEventListener('keydown', (e) => {
    if (!title.isContentEditable) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        beginEdit();
      }
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      endEdit(true); // blur handler is a no-op once contentEditable flips off
      title.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      endEdit(false);
      title.blur();
    }
  });
  title.addEventListener('blur', () => endEdit(true));
}

/** Keys for this box, from persisted settings (defaults if the field is absent). */
function keysFor(opts: AssetBoxOptions, ctx: AppContext): string[] {
  const saved = opts.scope === 'owner' ? ctx.settings?.ownerAssets : ctx.settings?.friendAssets;
  if (Array.isArray(saved)) return saved.filter((k) => typeof k === 'string' && k.length > 0);
  return opts.scope === 'owner' ? [...DEFAULT_OWNER_KEYS] : [...DEFAULT_FRIEND_KEYS];
}

/** Index the latest crypto + stock quotes by their canonical key. */
function quoteIndex(ctx: AppContext): Map<string, AssetQuote> {
  const map = new Map<string, AssetQuote>();
  const crypto = ctx.store.get('crypto') ?? [];
  const stocks = ctx.store.get('stocks') ?? [];
  for (const q of crypto) if (q && typeof q.key === 'string') map.set(q.key, q);
  for (const q of stocks) if (q && typeof q.key === 'string') map.set(q.key, q);
  return map;
}

/** A minimal "waiting for data" placeholder row for a configured-but-unresolved key. */
function pendingRow(key: string): HTMLElement {
  const symbol = key.includes(':') ? key.slice(key.indexOf(':') + 1) : key;
  return el(
    'div',
    { class: 'asset-row asset-row--pending', 'data-key': key },
    el('span', { class: 'asset-row__emoji' }),
    el('span', { class: 'asset-row__name', text: symbol }),
    el('span', { class: 'asset-row__price', text: '$...' })
  );
}

export function mountAssetBox(
  container: HTMLElement,
  opts: AssetBoxOptions,
  ctx: AppContext
): void {
  const rowsHost = el('div', { class: 'asset-box__rows' });
  const empty = el('div', { class: 'asset-box__empty', text: 'No assets yet.' });

  const title = el('span', { class: 'asset-box__title', text: titleFor(opts.scope, ctx) });
  makeTitleEditable(title, opts.scope, ctx);

  // privacy eye toggle: sits between the title and the TOTAL, present in BOTH boxes.
  // Click flips the global privateMode; setPrivate broadcasts PRIVACY_EVENT so both
  // boxes + the BTC strip re-blur from one click. State is mirrored below.
  const eye = el('button', { class: 'asset-box__eye', type: 'button' });
  const syncEye = (): void => {
    const on = isPrivate(ctx);
    eye.innerHTML = on ? EYE_OFF_SVG : EYE_OPEN_SVG;
    eye.setAttribute('aria-pressed', on ? 'true' : 'false');
    const label = on ? 'SHOW BAG VALUES' : 'HIDE BAG VALUES';
    eye.title = label;
    eye.setAttribute('aria-label', label);
  };
  syncEye();
  eye.addEventListener('click', () => setPrivate(ctx, !isPrivate(ctx)));

  // running total of the user's bags in THIS box (hidden until a quantity is set)
  const total = el('span', {
    class: 'asset-box__total',
    title: 'Total value of your holdings in this box'
  });
  const header = el('div', { class: 'asset-box__header' }, title, eye, total);

  if (opts.editable) {
    const addBtn = el('button', {
      class: 'asset-box__add',
      type: 'button',
      text: '+',
      title: 'Add or remove assets',
      'aria-label': 'Add or remove assets'
    });
    addBtn.addEventListener('click', () => {
      openAssetPicker(ctx, opts.scope, (next) => {
        // settings changed (add/remove): ctx.settings is refreshed by updateSettings,
        // but the picker hands us the authoritative copy too. Keep ctx in sync.
        if (next) ctx.settings = next;
        render();
      });
    });
    header.append(addBtn);
  }

  const root = el('div', { class: `asset-box asset-box--${opts.scope}` }, header, rowsHost);
  mount(container, root);

  // key -> currently mounted row node (real rows carry an updater; pending rows do not)
  const rowsByKey = new Map<string, HTMLElement>();
  // track which keys are currently rendered as pending so we know to replace them
  const pendingKeys = new Set<string>();

  /** Sum of (units held x live price) across this box's keys; hides at zero. */
  function renderTotal(): void {
    const holdings = getCachedSettings().holdings ?? {};
    const quotes = quoteIndex(ctx);
    let sum = 0;
    for (const key of keysFor(opts, ctx)) {
      const qty = holdings[key];
      const price = quotes.get(key)?.price;
      if (typeof qty === 'number' && qty > 0 && typeof price === 'number' && Number.isFinite(price)) {
        sum += qty * price;
      }
    }
    total.textContent = sum > 0 ? `TOTAL ${formatHoldingValue(sum)}` : '';
    total.style.display = sum > 0 ? '' : 'none';
    // blur the whole TOTAL while private (it is a bag-revealing dollar figure)
    markPrivate(total, isPrivate(ctx));
  }

  /** Biggest bag first; assets with no holdings keep their configured order after. */
  function sortByBag(keys: string[], quotes: Map<string, AssetQuote>): string[] {
    const holdings = getCachedSettings().holdings ?? {};
    const bagValue = (key: string): number => {
      const qty = holdings[key];
      const price = quotes.get(key)?.price;
      return typeof qty === 'number' && qty > 0 && typeof price === 'number' && Number.isFinite(price)
        ? qty * price
        : 0;
    };
    return keys
      .map((key, i) => ({ key, i, v: bagValue(key) }))
      .sort((a, b) => b.v - a.v || a.i - b.i)
      .map((x) => x.key);
  }

  /** Reconcile the rows host to exactly `keys` (in order), updating in place. */
  function render(): void {
    // refresh the row-module privacy flag BEFORE any createAssetRow/updateAssetRow
    // so freshly built/updated rows blur their bag cells + yield amounts correctly.
    setRowPrivacy(isPrivate(ctx));
    const quotes = quoteIndex(ctx);
    const keys = sortByBag(keysFor(opts, ctx), quotes);
    renderTotal();

    // drop rows for keys no longer configured
    for (const [key, node] of rowsByKey) {
      if (!keys.includes(key)) {
        node.remove();
        rowsByKey.delete(key);
        pendingKeys.delete(key);
      }
    }

    // empty-state note (only meaningful for the editable/friend box; owner is fixed)
    if (keys.length === 0) {
      if (empty.parentNode !== rowsHost) rowsHost.replaceChildren(empty);
      return;
    }
    if (empty.parentNode === rowsHost) empty.remove();

    // create / update / re-order rows to match `keys`
    let prev: ChildNode | null = null; // last node we placed; next goes after it
    for (const key of keys) {
      const quote = quotes.get(key);
      const existing = rowsByKey.get(key);
      let node: HTMLElement;

      if (quote) {
        // need a real (updatable) row. if missing or currently a pending shell, build it.
        if (!existing || pendingKeys.has(key)) {
          if (existing) existing.remove(); // drop the pending shell before replacing it
          node = createAssetRow(quote);
          rowsByKey.set(key, node);
          pendingKeys.delete(key);
        } else {
          updateAssetRow(existing, quote);
          node = existing;
        }
      } else if (existing) {
        // no quote yet but we already have a (pending) shell: keep it.
        node = existing;
      } else {
        // no quote yet: show a pending placeholder (build once, then leave it)
        node = pendingRow(key);
        rowsByKey.set(key, node);
        pendingKeys.add(key);
      }

      // place node in the correct position without disturbing others unnecessarily
      const target: ChildNode | null = prev ? prev.nextSibling : rowsHost.firstChild;
      if (node !== target) rowsHost.insertBefore(node, target);
      prev = node;
    }
  }

  // initial paint + live updates. store.subscribe fires immediately with current value.
  const unsubCrypto = ctx.store.subscribe('crypto', () => render());
  const unsubStocks = ctx.store.subscribe('stocks', () => render());

  // a row's quantity editor bubbles this after persisting; re-render so the box
  // total updates AND the rows re-order by bag size (biggest bag on top). The
  // persist is async (the event fires before the settings cache refreshes), so
  // render again shortly after to pick up the committed quantity.
  root.addEventListener('nexus:holdings-changed', () => {
    render();
    setTimeout(render, 250);
  });

  // privacy flips broadcast on window: re-sync this box's eye glyph + re-render so
  // the TOTAL, bag cells, and yield amounts all blur/unblur together (both boxes +
  // the BTC strip respond from one click). Asset boxes live for app life, so a
  // module-scope listener wired at mount is fine; removed in __unmount for safety.
  const onPrivacy = (): void => {
    syncEye();
    render();
  };
  window.addEventListener(PRIVACY_EVENT, onPrivacy);

  // expose teardown on the element for any future host that unmounts panels.
  (root as HTMLElement & { __unmount?: () => void }).__unmount = () => {
    unsubCrypto();
    unsubStocks();
    window.removeEventListener(PRIVACY_EVENT, onPrivacy);
  };
}
