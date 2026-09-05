// The two center-column asset pickers share one implementation: the FEATURED
// asset (click the asset name above the big price) and the gold SECOND SLOT
// (click the card under it). Each is a thin config over openSlotPicker: which
// settings field to persist, the default key + label for the reset row, the
// titles, and the window event to broadcast so the consumers re-render.
//
// Search goes through the same resolver as the asset-box picker (any coin or
// stock); the result list shows every candidate with a STOCK / CRYPTO / DEX tag.
// Reuses the .ap-* skin injected by asset-picker's ensureStyles.

import type { AppContext } from '../../app-context';
import { el } from '../../core/dom';
import type { AssetDescriptor, ResolveResult, Settings } from '../../../shared/types';
import { DEFAULT_CENTER_KEY, SECONDARY_DEFAULT_KEY } from '../../../shared/constants';
import { CENTER_CHANGED, SECONDARY_CHANGED, emit } from '../../core/events';
import { ensureStyles } from '../asset-box/asset-picker';
import { centerKey, secondaryKey } from '../../core/center';

const DEBOUNCE_MS = 280;

export interface SlotPickerConfig {
  /** Modal title, e.g. 'FEATURED ASSET'. */
  title: string;
  /** Label above the current-selection row, e.g. 'CURRENT CENTER'. */
  currentLabel: string;
  /** Search box placeholder + accessible label. */
  placeholder: string;
  ariaLabel: string;
  /** Verb on each result button, e.g. 'feature' / 'set'. */
  verb: string;
  /** The settings field that stores the chosen key. */
  field: 'centerAsset' | 'secondaryAsset';
  /** Reads the current key (falls back to the default). */
  currentKey: () => string;
  /** Default key + human label for the reset row. */
  defaultKey: string;
  defaultLabel: string;
  /** Window event broadcast after a change persists. */
  event: string;
}

const CENTER_CONFIG: SlotPickerConfig = {
  title: 'FEATURED ASSET',
  currentLabel: 'CURRENT CENTER',
  placeholder: 'Search any coin or stock (e.g. solana, TSLA)',
  ariaLabel: 'Search assets for the center spot',
  verb: 'feature',
  field: 'centerAsset',
  currentKey: centerKey,
  defaultKey: DEFAULT_CENTER_KEY,
  defaultLabel: 'Bitcoin',
  event: CENTER_CHANGED
};

const SECONDARY_CONFIG: SlotPickerConfig = {
  title: 'SECOND SLOT',
  currentLabel: 'CURRENT SLOT',
  placeholder: 'Search any coin or stock for the gold slot',
  ariaLabel: 'Search assets for the gold second slot',
  verb: 'set',
  field: 'secondaryAsset',
  currentKey: secondaryKey,
  defaultKey: SECONDARY_DEFAULT_KEY,
  defaultLabel: 'SpaceX',
  event: SECONDARY_CHANGED
};

/** Open the featured-asset picker. onChange fires after the new center persists. */
export function openCenterPicker(ctx: AppContext, onChange: () => void): void {
  openSlotPicker(ctx, CENTER_CONFIG, onChange);
}

/** Open the gold second-slot picker. onChange fires after the new slot persists. */
export function openSecondaryPicker(ctx: AppContext, onChange: () => void): void {
  openSlotPicker(ctx, SECONDARY_CONFIG, onChange);
}

function kindTag(d: AssetDescriptor): { text: string; cls: string } {
  if (d.kind === 'stock') return { text: 'STOCK', cls: 'stock' };
  if (d.source === 'dexscreener') return { text: 'DEX', cls: 'dex' };
  return { text: 'CRYPTO', cls: 'crypto' };
}

function keyId(key: string): string {
  return key.includes(':') ? key.slice(key.indexOf(':') + 1) : key;
}
function keySource(key: string): string {
  return key.includes(':') ? key.slice(0, key.indexOf(':')) : '';
}

function errText(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string') return err;
  return 'Please try again.';
}

/** Open a single-slot picker described by `cfg`. */
export function openSlotPicker(ctx: AppContext, cfg: SlotPickerConfig, onChange: () => void): void {
  if (typeof document === 'undefined' || !ctx?.bridge) {
    console.warn('[slot-picker] no document/bridge available; cannot open.');
    return;
  }
  ensureStyles();

  // Guard against opening twice (any .ap-* picker counts).
  const existing = document.querySelector('.ap-backdrop');
  if (existing) {
    (existing as HTMLElement).querySelector<HTMLInputElement>('.ap-input')?.focus();
    return;
  }

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let reqSeq = 0;
  let closed = false;

  const input = el('input', {
    class: 'ap-input',
    type: 'text',
    placeholder: cfg.placeholder,
    'aria-label': cfg.ariaLabel,
    autocomplete: 'off',
    spellcheck: false
  }) as HTMLInputElement;

  const results = el('div', { class: 'ap-results', role: 'listbox', 'aria-label': 'Search results' });
  const status = el('div', { class: 'ap-status', 'aria-live': 'polite' });
  const currentRow = el('div', { class: 'ap-current-list' });

  const closeBtn = el('button', {
    class: 'ap-close',
    type: 'button',
    title: 'Close',
    'aria-label': 'Close ' + cfg.title.toLowerCase() + ' picker'
  }, 'x');

  const card = el('div', { class: 'ap-card', role: 'dialog', 'aria-modal': 'true', 'aria-label': cfg.title },
    el('div', { class: 'ap-head' },
      el('div', { class: 'ap-title', text: cfg.title }),
      closeBtn
    ),
    input,
    status,
    results,
    el('div', { class: 'ap-section-label', text: cfg.currentLabel }),
    currentRow
  );

  const backdrop = el('div', { class: 'ap-backdrop' }, card);

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

  function setStatus(text: string, kind: 'info' | 'error' | 'busy' = 'info'): void {
    status.textContent = text;
    status.dataset.kind = kind;
  }

  /** Persist the new key, notify every consumer, then close. */
  async function choose(key: string, label: string): Promise<void> {
    try {
      const patch: Partial<Settings> = { [cfg.field]: key };
      const next = await ctx.updateSettings(patch);
      if (next) ctx.settings = next;
      emit(cfg.event);
      onChange();
      close();
    } catch (err) {
      setStatus('Could not set ' + label + '. ' + errText(err), 'error');
    }
  }

  function renderCurrent(): void {
    currentRow.replaceChildren();
    const key = cfg.currentKey();
    const row = el('div', { class: 'ap-current', 'data-key': key },
      el('span', { class: 'ap-current__id', text: keyId(key) }),
      el('span', { class: 'ap-current__src', text: keySource(key) })
    );
    if (key.toLowerCase() !== cfg.defaultKey.toLowerCase()) {
      const reset = el('button', {
        class: 'ap-add',
        type: 'button',
        title: 'Reset to ' + cfg.defaultLabel,
        'aria-label': 'Reset to ' + cfg.defaultLabel
      }, 'reset to ' + cfg.defaultLabel) as HTMLButtonElement;
      reset.addEventListener('click', () => {
        void choose(cfg.defaultKey, cfg.defaultLabel);
      });
      row.appendChild(reset);
    }
    currentRow.appendChild(row);
  }

  function onInput(): void {
    const query = input.value.trim();
    if (debounceTimer) clearTimeout(debounceTimer);
    if (!query) {
      results.replaceChildren();
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
      setStatus('Search failed. ' + errText(err), 'error');
      return;
    }
    if (seq !== reqSeq || closed) return;
    renderResults(res, query);
  }

  /** Primary first, then the rest of the candidates, deduped by key. */
  function candidatesOf(res: ResolveResult): AssetDescriptor[] {
    const raw = Array.isArray(res.candidates) ? res.candidates : [];
    const ordered = res.descriptor && !raw.some((c) => c?.key === res.descriptor!.key) ? [res.descriptor, ...raw] : raw;
    const seen = new Set<string>();
    const out: AssetDescriptor[] = [];
    for (const d of ordered.length ? ordered : res.descriptor ? [res.descriptor] : []) {
      if (!d || typeof d.key !== 'string' || !d.key || seen.has(d.key)) continue;
      seen.add(d.key);
      out.push(d);
    }
    return out.slice(0, 6);
  }

  function renderResults(res: ResolveResult | null, query: string): void {
    results.replaceChildren();
    if (!res || res.ok === false) {
      setStatus(res?.error ? res.error : 'No match for "' + query + '".', res ? 'error' : 'info');
      return;
    }
    const candidates = candidatesOf(res);
    if (candidates.length === 0) {
      setStatus('No match for "' + query + '".', 'info');
      return;
    }
    setStatus(candidates.length === 1 ? 'Found 1 match.' : 'Found ' + candidates.length + ' matches.', 'info');
    for (const d of candidates) results.appendChild(buildCandidate(d));
  }

  function buildCandidate(d: AssetDescriptor): HTMLElement {
    const isCurrent = d.key.toLowerCase() === cfg.currentKey().toLowerCase();
    const tag = kindTag(d);
    const row = el('div', { class: 'ap-result', role: 'option', 'data-key': d.key },
      el('div', { class: 'ap-result__main' },
        el('span', { class: 'ap-result__sym', text: d.symbol || keyId(d.key) }),
        el('span', { class: 'ap-result__name', text: d.name || '' })
      ),
      el('div', { class: 'ap-result__meta' },
        el('span', { class: 'ap-tag ap-tag--' + tag.cls, text: tag.text }),
        el('span', { class: 'ap-result__src', text: d.source || keySource(d.key) })
      )
    );
    const set = el('button', {
      class: 'ap-add',
      type: 'button',
      title: isCurrent ? 'Already selected' : cfg.verb + ' ' + (d.symbol || d.key),
      'aria-label': cfg.verb + ' ' + (d.symbol || d.key)
    }, isCurrent ? 'current' : cfg.verb) as HTMLButtonElement;
    set.disabled = isCurrent;
    set.addEventListener('click', () => {
      set.disabled = true;
      set.textContent = 'setting';
      void choose(d.key, d.symbol || d.key);
    });
    row.appendChild(set);
    return row;
  }

  input.addEventListener('input', onInput);
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      if (debounceTimer) clearTimeout(debounceTimer);
      const q = input.value.trim();
      if (q) void runResolve(q);
    }
  });
  closeBtn.addEventListener('click', close);
  backdrop.addEventListener('mousedown', (ev) => {
    if (ev.target === backdrop) close();
  });
  document.addEventListener('keydown', onKeydown, true);

  renderCurrent();
  document.body.appendChild(backdrop);
  input.focus();
}
