// The add/remove asset picker overlay, shared by BOTH boxes. Flow: debounced text
// input -> ctx.bridge.resolveAsset(query) -> render the single descriptor or the
// candidates[] list -> confirm persists the box's key list (friendAssets or
// ownerAssets, chosen by `scope`) through ctx.updateSettings, and fires onChange so
// the box re-renders. Also lists the box's current assets with remove buttons.
//
// Disambiguation (SPEC5 Part P): resolveAsset() can return ok with candidates[] that
// hold BOTH a stock and one or more crypto coins for the same ticker (e.g. STRK =
// Starknet crypto primary AND Strategy's Strike preferred stock). When candidates
// number more than one we render a compact list (up to 6 rows: symbol, truncated name,
// STOCK/CRYPTO/DEX badge), the primary (res.descriptor, always candidates[0]) listed
// first and highlighted as the default. ArrowUp/Down move the selection, Enter adds the
// selected row (Enter with nothing selected adds the primary), and clicking a row adds
// that candidate via the same add path. With at most one candidate the flow is identical
// to before: one result row, click/Enter adds it.
//
// Contained, self-cleaning overlay: one fixed backdrop appended to <body>, removed on
// close. Built with core/dom el(); all glyphs/text are plain ASCII or unicode (no
// em-dashes in user-facing strings). Null-safe throughout: it runs under the real
// Electron bridge AND the dev:web browser-mock, so every async result is guarded.

import type { AppContext } from '../../app-context';
import { el } from '../../core/dom';
import type { AssetDescriptor, ResolveResult, Settings } from '../../../shared/types';

const STYLE_ID = 'asset-picker-styles';
const DEBOUNCE_MS = 280;

/** Inject the co-located stylesheet once (mirrors asset-picker.css). Idempotent.
    Exported so the center-asset picker can reuse the same .ap-* skin. */
export function ensureStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const style = el('style', { id: STYLE_ID, type: 'text/css' });
  style.textContent = PICKER_CSS;
  document.head.appendChild(style);
}

/** Pretty label for a canonical key like 'coingecko:ripple' or 'yahoo:MSTR'. */
function keyLabel(key: string): { source: string; id: string } {
  const idx = key.indexOf(':');
  if (idx === -1) return { source: '', id: key };
  return { source: key.slice(0, idx), id: key.slice(idx + 1) };
}

/** Part P kind badge text from descriptor.kind + source: stocks read STOCK, DEX tokens
    (DexScreener-sourced crypto) read DEX, everything else CRYPTO. */
function kindBadge(d: AssetDescriptor): string {
  if (d.kind === 'stock') return 'STOCK';
  if (d.source === 'dexscreener') return 'DEX';
  return 'CRYPTO';
}

/** Matching .ap-tag-- modifier class for kindBadge() (stock | dex | crypto). */
function kindClass(d: AssetDescriptor): string {
  if (d.kind === 'stock') return 'stock';
  if (d.source === 'dexscreener') return 'dex';
  return 'crypto';
}

/** Trim an over-long candidate name; CSS also ellipsizes, this caps the DOM string. */
function truncateName(name: string): string {
  const n = name.trim();
  return n.length > 48 ? n.slice(0, 47).trimEnd() + '…' : n;
}

/** Which box a picker session edits, and the Settings field that backs it. */
export type PickerScope = 'friend' | 'owner';

function fieldFor(scope: PickerScope): 'friendAssets' | 'ownerAssets' {
  return scope === 'owner' ? 'ownerAssets' : 'friendAssets';
}

/** Open the asset picker overlay for one box. onChange gets the updated settings. */
export function openAssetPicker(
  ctx: AppContext,
  scope: PickerScope,
  onChange: (settings: Settings) => void
): void {
  if (typeof document === 'undefined' || !ctx?.bridge) {
    console.warn('[asset-picker] no document/bridge available; cannot open.');
    return;
  }
  ensureStyles();
  const field = fieldFor(scope);
  /** The box's current key list, straight from the renderer settings cache. */
  const currentKeys = (): string[] => {
    const keys = ctx.settings?.[field];
    return Array.isArray(keys) ? keys.filter((k) => typeof k === 'string' && k.length > 0) : [];
  };

  // Guard against opening twice (e.g. double-click on the add button).
  const existing = document.querySelector('.ap-backdrop');
  if (existing) {
    (existing as HTMLElement).querySelector<HTMLInputElement>('.ap-input')?.focus();
    return;
  }

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let reqSeq = 0; // monotonically increasing so stale resolve() responses are dropped
  let closed = false;

  // Disambiguation state (SPEC5 Part P). When a resolve returns more than one candidate
  // we show a selectable list; these track the rows on screen and the keyboard highlight.
  // -1 means "no explicit selection yet" so Enter falls back to the primary (index 0).
  let candList: AssetDescriptor[] = [];
  let selectedIdx = -1;

  // --- elements -------------------------------------------------------------
  const input = el('input', {
    class: 'ap-input',
    type: 'text',
    placeholder: 'Search any coin or stock (e.g. ethereum, AAPL)',
    'aria-label': 'Search assets to add',
    autocomplete: 'off',
    spellcheck: false
  }) as HTMLInputElement;

  const results = el('div', { class: 'ap-results', role: 'listbox', 'aria-label': 'Search results' });
  const currentList = el('div', { class: 'ap-current-list' });
  const status = el('div', { class: 'ap-status', 'aria-live': 'polite' });

  const closeBtn = el('button', {
    class: 'ap-close',
    type: 'button',
    title: 'Close',
    'aria-label': 'Close asset picker'
  }, 'x');

  const boxName = (ctx.settings?.boxTitles?.[scope] ?? '').trim();
  const card = el('div', { class: 'ap-card', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Add or remove assets in this box' },
    el('div', { class: 'ap-head' },
      el('div', { class: 'ap-title', text: boxName ? `MANAGE ASSETS: ${boxName}` : 'MANAGE ASSETS' }),
      closeBtn
    ),
    input,
    status,
    results,
    el('div', { class: 'ap-section-label', text: 'ASSETS IN THIS BOX' }),
    currentList
  );

  const backdrop = el('div', { class: 'ap-backdrop' }, card);

  // --- lifecycle ------------------------------------------------------------
  function close(): void {
    if (closed) return;
    closed = true;
    if (debounceTimer) clearTimeout(debounceTimer);
    document.removeEventListener('keydown', onKeydown, true);
    backdrop.remove();
  }

  function onKeydown(ev: KeyboardEvent): void {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      close();
    }
  }

  // --- status helpers -------------------------------------------------------
  function setStatus(text: string, kind: 'info' | 'error' | 'busy' = 'info'): void {
    status.textContent = text;
    status.dataset.kind = kind;
  }

  // --- current friend assets list ------------------------------------------
  function renderCurrent(): void {
    currentList.replaceChildren();
    const keys = currentKeys();
    if (keys.length === 0) {
      currentList.appendChild(el('div', { class: 'ap-empty', text: 'No assets in this box yet. Add one above.' }));
      return;
    }
    for (const key of keys) {
      const { source, id } = keyLabel(key);
      const row = el('div', { class: 'ap-current', 'data-key': key },
        el('span', { class: 'ap-current__id', text: id || key }),
        source ? el('span', { class: 'ap-current__src', text: source }) : el('span', { class: 'ap-current__src' })
      );
      const remove = el('button', {
        class: 'ap-remove',
        type: 'button',
        title: 'Remove ' + (id || key),
        'aria-label': 'Remove ' + (id || key)
      }, 'remove') as HTMLButtonElement;
      remove.addEventListener('click', () => {
        void doRemove(key, remove);
      });
      row.appendChild(remove);
      currentList.appendChild(row);
    }
  }

  async function doRemove(key: string, btn: HTMLButtonElement): Promise<void> {
    btn.disabled = true;
    try {
      const merged = await persist(currentKeys().filter((k) => k !== key));
      onChange(merged);
      renderCurrent();
      setStatus('Removed ' + (keyLabel(key).id || key) + '.', 'info');
    } catch (err) {
      btn.disabled = false;
      setStatus('Could not remove asset. ' + errText(err), 'error');
    }
  }

  // --- search / resolve -----------------------------------------------------
  function onInput(): void {
    const query = input.value.trim();
    if (debounceTimer) clearTimeout(debounceTimer);
    if (!query) {
      results.replaceChildren();
      clearCandidateState();
      setStatus('', 'info');
      return;
    }
    setStatus('Searching...', 'busy');
    debounceTimer = setTimeout(() => {
      void runResolve(query);
    }, DEBOUNCE_MS);
  }

  async function runResolve(query: string): Promise<void> {
    const seq = ++reqSeq;
    let res: ResolveResult | null = null;
    try {
      res = await ctx.bridge.resolveAsset(query);
    } catch (err) {
      if (seq !== reqSeq || closed) return;
      results.replaceChildren();
      clearCandidateState();
      setStatus('Search failed. ' + errText(err), 'error');
      return;
    }
    if (seq !== reqSeq || closed) return; // a newer query superseded this one
    renderResults(res, query);
  }

  /** Reset the Part P keyboard-selection state (no list currently active). */
  function clearCandidateState(): void {
    candList = [];
    selectedIdx = -1;
  }

  function renderResults(res: ResolveResult | null, query: string): void {
    results.replaceChildren();
    clearCandidateState();
    if (!res || res.ok === false) {
      setStatus(res?.error ? res.error : 'No match for "' + query + '".', res ? 'error' : 'info');
      return;
    }

    // SPEC5 Part P: more than one distinct candidate is ambiguous (e.g. STRK = Starknet
    // crypto + Strategy's Strike stock). Show a selectable list with the primary
    // (res.descriptor, always candidates[0]) first and highlighted as the default,
    // capped at 6 rows. At most one candidate keeps the original single-row behavior.
    const ambiguous: AssetDescriptor[] = dedupeCandidates(res);
    if (ambiguous.length > 1) {
      renderCandidateList(ambiguous);
      return;
    }

    const candidates: AssetDescriptor[] =
      res.descriptor ? [res.descriptor] : Array.isArray(res.candidates) ? res.candidates : [];

    if (candidates.length === 0) {
      setStatus('No match for "' + query + '".', 'info');
      return;
    }

    setStatus(candidates.length === 1 ? 'Found 1 match.' : 'Found ' + candidates.length + ' matches.', 'info');
    for (const d of candidates) {
      results.appendChild(buildCandidate(d));
    }
  }

  /** The candidate list, primary first, deduped by key. Empty when not ambiguous. */
  function dedupeCandidates(res: ResolveResult): AssetDescriptor[] {
    const raw = Array.isArray(res.candidates) ? res.candidates : [];
    // The resolver always seeds candidates[0] with the primary, but guard for mocks: if
    // descriptor is set and missing from the list, prepend it so the primary leads.
    const ordered = res.descriptor && !raw.some((c) => c?.key === res.descriptor!.key)
      ? [res.descriptor, ...raw]
      : raw;
    const seen = new Set<string>();
    const out: AssetDescriptor[] = [];
    for (const d of ordered) {
      if (!d || typeof d.key !== 'string' || d.key.length === 0) continue;
      if (seen.has(d.key)) continue;
      seen.add(d.key);
      out.push(d);
    }
    return out;
  }

  /** Render the Part P disambiguation list (up to 6 rows) and prime keyboard nav. */
  function renderCandidateList(cands: AssetDescriptor[]): void {
    candList = cands.slice(0, 6);
    selectedIdx = -1; // no explicit pick yet; Enter defaults to the primary (row 0)
    setStatus('Found ' + cands.length + ' matches. Pick one to add.', 'info');
    candList.forEach((d, i) => {
      results.appendChild(buildCandidateRow(d, i === 0));
    });
    syncSelection();
  }

  /** Apply the .ap-result--active highlight to the keyboard-selected row (or the
      primary when nothing is selected yet), and keep it scrolled into view. */
  function syncSelection(): void {
    const rows = results.querySelectorAll<HTMLElement>('.ap-result');
    const active = selectedIdx >= 0 ? selectedIdx : 0;
    rows.forEach((r, i) => {
      const on = i === active;
      r.classList.toggle('ap-result--active', on);
      r.setAttribute('aria-selected', on ? 'true' : 'false');
      if (on) r.scrollIntoView({ block: 'nearest' });
    });
  }

  /** Move the highlight by delta within the active candidate list (clamped). */
  function moveSelection(delta: number): void {
    if (candList.length === 0) return;
    const base = selectedIdx >= 0 ? selectedIdx : 0;
    selectedIdx = Math.max(0, Math.min(candList.length - 1, base + delta));
    syncSelection();
  }

  /** Add the keyboard-highlighted candidate, or the primary if none is selected. */
  function addSelectedCandidate(): void {
    if (candList.length === 0) return;
    const d = candList[selectedIdx >= 0 ? selectedIdx : 0];
    if (!d) return;
    const btn = results
      .querySelectorAll<HTMLButtonElement>('.ap-result .ap-add')
      [selectedIdx >= 0 ? selectedIdx : 0];
    if (btn && !btn.disabled) void doAdd(d, btn);
  }

  function buildCandidate(d: AssetDescriptor): HTMLElement {
    const already = currentKeys().includes(d.key);
    const row = el('div', { class: 'ap-result', role: 'option', 'data-key': d.key },
      el('div', { class: 'ap-result__main' },
        el('span', { class: 'ap-result__sym', text: d.symbol || keyLabel(d.key).id }),
        el('span', { class: 'ap-result__name', text: d.name || '' })
      ),
      el('div', { class: 'ap-result__meta' },
        el('span', { class: 'ap-tag ap-tag--' + kindClass(d), text: kindBadge(d) }),
        el('span', { class: 'ap-result__src', text: d.source || keyLabel(d.key).source })
      )
    );
    const add = el('button', {
      class: 'ap-add',
      type: 'button',
      title: already ? 'Already added' : 'Add ' + (d.symbol || d.key),
      'aria-label': 'Add ' + (d.symbol || d.key)
    }, already ? 'added' : 'add') as HTMLButtonElement;
    add.disabled = already;
    add.addEventListener('click', () => {
      void doAdd(d, add);
    });
    row.appendChild(add);
    return row;
  }

  /** One row in the Part P disambiguation list. `primary` adds the default highlight
      and a PRIMARY pill. Built from the same .ap-result skin as buildCandidate(), plus
      a DEX-aware kind badge. Clicking anywhere on the row selects it; the add button
      (or Enter) commits it. */
  function buildCandidateRow(d: AssetDescriptor, primary: boolean): HTMLElement {
    const already = currentKeys().includes(d.key);
    const symline = el('div', { class: 'ap-result__symline' },
      el('span', { class: 'ap-result__sym', text: d.symbol || keyLabel(d.key).id })
    );
    if (primary) symline.appendChild(el('span', { class: 'ap-result__primary', text: 'PRIMARY' }));
    const row = el('div',
      {
        class: 'ap-result ap-result--pick' + (primary ? ' ap-result--primary' : ''),
        role: 'option',
        'aria-selected': 'false',
        'data-key': d.key
      },
      el('div', { class: 'ap-result__main' },
        symline,
        el('span', { class: 'ap-result__name', text: truncateName(d.name || '') })
      ),
      el('div', { class: 'ap-result__meta' },
        el('span', { class: 'ap-tag ap-tag--' + kindClass(d), text: kindBadge(d) }),
        el('span', { class: 'ap-result__src', text: d.source || keyLabel(d.key).source })
      )
    );
    const add = el('button', {
      class: 'ap-add',
      type: 'button',
      title: already ? 'Already added' : 'Add ' + (d.symbol || d.key),
      'aria-label': 'Add ' + (d.symbol || d.key)
    }, already ? 'added' : 'add') as HTMLButtonElement;
    add.disabled = already;
    add.addEventListener('click', (ev) => {
      ev.stopPropagation();
      void doAdd(d, add);
    });
    row.appendChild(add);
    // Click anywhere on the row highlights it (so keyboard + mouse share one selection).
    row.addEventListener('click', () => {
      const idx = candList.findIndex((c) => c.key === d.key);
      if (idx >= 0) {
        selectedIdx = idx;
        syncSelection();
      }
    });
    return row;
  }

  async function doAdd(d: AssetDescriptor, btn: HTMLButtonElement): Promise<void> {
    // The bridge keys assets by the canonical descriptor key. Fall back to the raw
    // query only if a resolver somehow returned no key (defensive: mock/edge cases).
    const key = (d?.key && d.key.length > 0) ? d.key : input.value.trim();
    if (!key) {
      setStatus('Nothing to add.', 'error');
      return;
    }
    btn.disabled = true;
    btn.textContent = 'adding';
    try {
      const keys = currentKeys();
      const merged = await persist(keys.includes(key) ? keys : [...keys, key]);
      onChange(merged);
      renderCurrent();
      btn.textContent = 'added';
      setStatus('Added ' + (d.symbol || keyLabel(key).id || key) + '.', 'info');
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'add';
      setStatus('Could not add asset. ' + errText(err), 'error');
    }
  }

  // Persist this box's key list through ctx.updateSettings (the main process kicks an
  // immediate refetch on friendAssets/ownerAssets changes). Falls back to patching the
  // local settings object so dev:web edge cases never strand the dialog.
  async function persist(keys: string[]): Promise<Settings> {
    if (typeof ctx.updateSettings === 'function') {
      try {
        const next = await ctx.updateSettings({ [field]: keys });
        ctx.settings = next;
        return next;
      } catch {
        // fall through to the local patch
      }
    }
    const fallback: Settings = { ...ctx.settings, [field]: keys };
    ctx.settings = fallback;
    return fallback;
  }

  // --- wire + mount ---------------------------------------------------------
  input.addEventListener('input', onInput);
  input.addEventListener('keydown', (ev) => {
    // SPEC5 Part P: while a candidate list is on screen, the arrow keys move the
    // highlight and Enter commits the selection (defaulting to the primary). With no
    // active list, Enter keeps its original behavior of forcing an immediate resolve.
    if (candList.length > 0) {
      if (ev.key === 'ArrowDown') {
        ev.preventDefault();
        moveSelection(1);
        return;
      }
      if (ev.key === 'ArrowUp') {
        ev.preventDefault();
        moveSelection(-1);
        return;
      }
      if (ev.key === 'Enter') {
        ev.preventDefault();
        addSelectedCandidate();
        return;
      }
    }
    if (ev.key === 'Enter') {
      ev.preventDefault();
      if (debounceTimer) clearTimeout(debounceTimer);
      const q = input.value.trim();
      if (q) void runResolve(q);
    }
  });
  closeBtn.addEventListener('click', close);
  backdrop.addEventListener('mousedown', (ev) => {
    if (ev.target === backdrop) close(); // click outside the card closes
  });
  document.addEventListener('keydown', onKeydown, true);

  renderCurrent();
  document.body.appendChild(backdrop);
  input.focus();
}

function errText(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string') return err;
  return 'Please try again.';
}

// Co-located styles, injected once at runtime (kept in sync with asset-picker.css).
// Geometry-stable, neon cyberpunk skin using the shared design tokens. Numbers use the
// tabular mono so they never jitter. Scoped under .ap-* so it cannot leak into panels.
const PICKER_CSS = `
.ap-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: color-mix(in srgb, var(--bg, #05060a) 72%, transparent);
  backdrop-filter: blur(3px);
}
.ap-card {
  width: min(560px, 100%);
  max-height: min(80vh, 720px);
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: var(--bg-elev, #0b0e16);
  border: 1px solid color-mix(in srgb, var(--accent, #22e3ff) 45%, var(--border, #1b2233));
  border-radius: var(--radius, 10px);
  padding: 16px;
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent, #22e3ff) 20%, transparent),
    0 18px 60px rgba(0, 0, 0, 0.65),
    0 0 40px color-mix(in srgb, var(--accent, #22e3ff) 18%, transparent);
  color: var(--text, #d7e2f3);
  font-family: var(--font-label, system-ui, sans-serif);
}
.ap-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.ap-title {
  font-family: var(--font-display, sans-serif);
  font-size: 14px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--accent, #22e3ff);
  text-shadow: 0 0 12px color-mix(in srgb, var(--accent, #22e3ff) 55%, transparent);
}
.ap-close {
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  background: transparent;
  border: 1px solid var(--border, #1b2233);
  border-radius: 6px;
  color: var(--text-dim, #8593ad);
  font-family: var(--font-mono, monospace);
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
  transition: color 0.12s, border-color 0.12s, background 0.12s;
}
.ap-close:hover {
  color: var(--accent, #22e3ff);
  border-color: color-mix(in srgb, var(--accent, #22e3ff) 55%, var(--border, #1b2233));
  background: color-mix(in srgb, var(--accent, #22e3ff) 8%, transparent);
}
.ap-input {
  width: 100%;
  box-sizing: border-box;
  padding: 10px 12px;
  background: var(--bg-box, #0a0d15);
  border: 1px solid var(--border, #1b2233);
  border-radius: 8px;
  color: var(--text, #d7e2f3);
  font-family: var(--font-mono, monospace);
  font-size: 13px;
  letter-spacing: 0.02em;
  outline: none;
  transition: border-color 0.12s, box-shadow 0.12s;
}
.ap-input::placeholder {
  color: var(--text-faint, #4d5876);
}
.ap-input:focus {
  border-color: color-mix(in srgb, var(--accent, #22e3ff) 60%, var(--border, #1b2233));
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent, #22e3ff) 40%, transparent),
    0 0 16px color-mix(in srgb, var(--accent, #22e3ff) 18%, transparent);
}
.ap-status {
  min-height: 14px;
  font-size: 11px;
  letter-spacing: 0.04em;
  color: var(--text-dim, #8593ad);
}
.ap-status[data-kind='error'] {
  color: var(--neon-red, #ff4d4d);
}
.ap-status[data-kind='busy'] {
  color: var(--accent, #22e3ff);
}
.ap-results {
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow-y: auto;
  max-height: 240px;
}
.ap-results:empty {
  display: none;
}
.ap-result,
.ap-current {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  background: var(--bg-box, #0a0d15);
  border: 1px solid var(--border, #1b2233);
  border-radius: 8px;
  font-variant-numeric: tabular-nums;
}
.ap-result__main,
.ap-current {
  min-width: 0;
}
.ap-result__main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1 1 auto;
  min-width: 0;
}
.ap-result__sym,
.ap-current__id {
  font-family: var(--font-mono, monospace);
  font-size: 13px;
  color: var(--text, #d7e2f3);
  letter-spacing: 0.03em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ap-result__name {
  font-size: 11px;
  color: var(--text-dim, #8593ad);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ap-result__meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
}
.ap-result__src,
.ap-current__src {
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-faint, #4d5876);
}
.ap-tag {
  font-family: var(--font-mono, monospace);
  font-size: 9px;
  letter-spacing: 0.12em;
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid currentColor;
  opacity: 0.85;
}
.ap-tag--crypto {
  color: var(--neon-cyan, #22e3ff);
}
.ap-tag--stock {
  color: var(--neon-gold, #ffcc33);
}
.ap-tag--dex {
  color: var(--neon-violet, #9d6bff);
}
/* SPEC5 Part P: disambiguation candidate list. .ap-result--pick rows are selectable,
   --primary marks the default, --active is the keyboard/click highlight. */
.ap-result--pick {
  cursor: pointer;
}
.ap-result__symline {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.ap-result__primary {
  flex: 0 0 auto;
  font-family: var(--font-mono, monospace);
  font-size: 8px;
  letter-spacing: 0.14em;
  padding: 1px 5px;
  border-radius: 3px;
  color: var(--accent, #22e3ff);
  border: 1px solid color-mix(in srgb, var(--accent, #22e3ff) 50%, transparent);
  background: color-mix(in srgb, var(--accent, #22e3ff) 10%, transparent);
}
.ap-result--primary {
  border-color: color-mix(in srgb, var(--accent, #22e3ff) 35%, var(--border, #1b2233));
}
.ap-result--active {
  border-color: color-mix(in srgb, var(--accent, #22e3ff) 70%, var(--border, #1b2233));
  background: color-mix(in srgb, var(--accent, #22e3ff) 10%, var(--bg-box, #0a0d15));
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent, #22e3ff) 30%, transparent),
    0 0 14px color-mix(in srgb, var(--accent, #22e3ff) 14%, transparent);
}
.ap-current {
  justify-content: space-between;
}
.ap-current__id {
  flex: 1 1 auto;
}
.ap-add,
.ap-remove {
  flex: 0 0 auto;
  padding: 6px 12px;
  border-radius: 6px;
  font-family: var(--font-label, sans-serif);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  cursor: pointer;
  transition: color 0.12s, border-color 0.12s, background 0.12s, opacity 0.12s;
}
.ap-add {
  background: color-mix(in srgb, var(--accent, #22e3ff) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent, #22e3ff) 55%, var(--border, #1b2233));
  color: var(--accent, #22e3ff);
}
.ap-add:hover:not(:disabled) {
  background: color-mix(in srgb, var(--accent, #22e3ff) 26%, transparent);
}
.ap-remove {
  background: transparent;
  border: 1px solid color-mix(in srgb, var(--neon-red, #ff4d4d) 40%, var(--border, #1b2233));
  color: var(--neon-red, #ff4d4d);
}
.ap-remove:hover:not(:disabled) {
  background: color-mix(in srgb, var(--neon-red, #ff4d4d) 16%, transparent);
}
.ap-add:disabled,
.ap-remove:disabled {
  opacity: 0.45;
  cursor: default;
}
.ap-section-label {
  margin-top: 4px;
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-faint, #4d5876);
}
.ap-current-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow-y: auto;
  max-height: 200px;
}
.ap-empty {
  font-size: 11px;
  color: var(--text-faint, #4d5876);
  padding: 6px 2px;
}
`;
