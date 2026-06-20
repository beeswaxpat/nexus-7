// Center-asset picker overlay. Opened by clicking the asset label in the center
// stats panel. Search any coin or stock (same resolver as the friend-box picker),
// pick one, and it becomes the FEATURED center asset: the big price, the wormhole
// bands, banners, pepes, and the theme recolor all follow it. A reset row swaps
// back to Bitcoin. Reuses the .ap-* skin injected by asset-picker's ensureStyles.

import type { AppContext } from '../../app-context';
import { el } from '../../core/dom';
import type { AssetDescriptor, ResolveResult } from '../../../shared/types';
import { DEFAULT_CENTER_KEY } from '../../../shared/constants';
import { ensureStyles } from '../asset-box/asset-picker';
import { centerKey } from '../../core/center';

const DEBOUNCE_MS = 280;

/** Open the center-asset picker. onChange fires after the new center persists. */
export function openCenterPicker(ctx: AppContext, onChange: () => void): void {
  if (typeof document === 'undefined' || !ctx?.bridge) {
    console.warn('[center-picker] no document/bridge available; cannot open.');
    return;
  }
  ensureStyles();

  // Guard against opening twice.
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
    placeholder: 'Search any coin or stock (e.g. solana, TSLA)',
    'aria-label': 'Search assets for the center spot',
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
    'aria-label': 'Close center asset picker'
  }, 'x');

  const card = el('div', { class: 'ap-card', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Choose the featured center asset' },
    el('div', { class: 'ap-head' },
      el('div', { class: 'ap-title', text: 'FEATURED ASSET' }),
      closeBtn
    ),
    input,
    status,
    results,
    el('div', { class: 'ap-section-label', text: 'CURRENT CENTER' }),
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

  /** Persist a new center key, notify every center consumer, then close. */
  async function choose(key: string, label: string): Promise<void> {
    try {
      const next = await ctx.updateSettings({ centerAsset: key });
      if (next) ctx.settings = next;
      window.dispatchEvent(new CustomEvent('nexus:center-changed'));
      onChange();
      close();
    } catch (err) {
      setStatus('Could not set ' + label + '. ' + errText(err), 'error');
    }
  }

  function renderCurrent(): void {
    currentRow.replaceChildren();
    const key = centerKey();
    const id = key.includes(':') ? key.slice(key.indexOf(':') + 1) : key;
    const row = el('div', { class: 'ap-current', 'data-key': key },
      el('span', { class: 'ap-current__id', text: id }),
      el('span', { class: 'ap-current__src', text: key.includes(':') ? key.slice(0, key.indexOf(':')) : '' })
    );
    if (key.toLowerCase() !== DEFAULT_CENTER_KEY.toLowerCase()) {
      const reset = el('button', {
        class: 'ap-add',
        type: 'button',
        title: 'Reset the center to Bitcoin',
        'aria-label': 'Reset the center to Bitcoin'
      }, 'reset to BTC') as HTMLButtonElement;
      reset.addEventListener('click', () => {
        void choose(DEFAULT_CENTER_KEY, 'Bitcoin');
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

  function renderResults(res: ResolveResult | null, query: string): void {
    results.replaceChildren();
    if (!res || res.ok === false) {
      setStatus(res?.error ? res.error : 'No match for "' + query + '".', res ? 'error' : 'info');
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

  function buildCandidate(d: AssetDescriptor): HTMLElement {
    const isCurrent = d.key.toLowerCase() === centerKey().toLowerCase();
    const kindTag = d.kind === 'stock' ? 'STOCK' : 'CRYPTO';
    const row = el('div', { class: 'ap-result', role: 'option', 'data-key': d.key },
      el('div', { class: 'ap-result__main' },
        el('span', { class: 'ap-result__sym', text: d.symbol || d.key }),
        el('span', { class: 'ap-result__name', text: d.name || '' })
      ),
      el('div', { class: 'ap-result__meta' },
        el('span', { class: 'ap-tag ap-tag--' + d.kind, text: kindTag }),
        el('span', { class: 'ap-result__src', text: d.source || '' })
      )
    );
    const set = el('button', {
      class: 'ap-add',
      type: 'button',
      title: isCurrent ? 'Already featured' : 'Feature ' + (d.symbol || d.key),
      'aria-label': 'Feature ' + (d.symbol || d.key)
    }, isCurrent ? 'current' : 'feature') as HTMLButtonElement;
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

function errText(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string') return err;
  return 'Please try again.';
}
