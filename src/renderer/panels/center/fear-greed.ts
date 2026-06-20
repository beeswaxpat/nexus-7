// Fear & Greed: filling bar + level text + skull
// emoji per the spec bands, color by band. Subscribes store.fng. Geometry never
// changes on update: the bar is a fixed-height track whose fill is transform:
// scaleX only, the value/level are tabular text. Signature FROZEN.

import type { AppContext } from '../../app-context';
import { el, mount } from '../../core/dom';
import { fngBands } from '../../core/reactions';
import './center.css';

export function mountFearGreed(container: HTMLElement, ctx: AppContext): void {
  const value = el('span', { class: 'fng__value', text: '...' });
  const skull = el('span', { class: 'fng__skull', text: '\u{1F480}', 'aria-hidden': 'true' });
  const fill = el('div', { class: 'fng__fill' });
  const level = el('span', { class: 'fng__level', text: '...' });

  const root = el('div', { class: 'fng' },
    el('div', { class: 'fng__head' },
      el('span', { class: 'fng__title', text: 'Fear & Greed' }),
      value
    ),
    el('div', { class: 'fng__track' }, fill),
    el('div', { class: 'fng__foot' }, level, skull)
  );

  mount(container, root);

  const unsub = ctx.store.subscribe('fng', (fng) => {
    if (!fng || typeof fng.value !== 'number' || !Number.isFinite(fng.value)) {
      value.textContent = '...';
      level.textContent = '...';
      fill.style.transform = 'scaleX(0)';
      return;
    }
    const v = Math.max(0, Math.min(100, fng.value));
    const band = fngBands(v);
    value.textContent = String(Math.round(v));
    // prefer the live classification text when present, else the band label
    level.textContent = fng.classification || band.level;
    root.style.setProperty('--fng-color', band.color);
    fill.style.transform = `scaleX(${v / 100})`;
    // skull animates only on Extreme Fear (band label is canonical here)
    root.classList.toggle('fng--extreme-fear', band.level === 'Extreme Fear');
  });

  // tidy up if the container is ever torn down by a re-mount
  (container as HTMLElement & { __fngUnsub?: () => void }).__fngUnsub?.();
  (container as HTMLElement & { __fngUnsub?: () => void }).__fngUnsub = unsub;
}
