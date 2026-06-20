// Live clock, ticks once per second. Tabular
// mono digits (set in center.css) so the time never jitters geometry. Signature
// FROZEN.

import type { AppContext } from '../../app-context';
import { el, mount } from '../../core/dom';
import './center.css';

const pad = (n: number): string => String(n).padStart(2, '0');

export function mountClock(container: HTMLElement, _ctx: AppContext): void {
  const time = el('div', { class: 'clock__time', text: '00:00:00' });
  const date = el('div', { class: 'clock__date', text: '' });

  mount(container, el('div', { class: 'clock' }, time, date));

  const tick = (): void => {
    const now = new Date();
    time.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    // e.g. "TUE, JUN 03"; weekday + month abbreviations, uppercased by CSS
    date.textContent = now
      .toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: '2-digit' })
      .replace(/—|–/g, '-');
  };

  tick();
  const id = window.setInterval(tick, 1000);

  // replace any prior interval if this container is re-mounted
  const host = container as HTMLElement & { __clockId?: number };
  if (host.__clockId) window.clearInterval(host.__clockId);
  host.__clockId = id;
}
