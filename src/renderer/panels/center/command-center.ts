// The Bitcoin command center: lays out and mounts the graphic cell, the live
// clock, Fear & Greed, BTC stats + road-bar, and COMMS. The .cc grid geometry
// lives in components.css; child order maps to its rows (graphic on top, then
// the stacked stat blocks). The top cell (#cc-wormhole) is left EMPTY here: the scene
// manager (core/scenes.ts) decides whether the wormhole or NIGHT CITY fills it,
// and mounts after this. Signature FROZEN.

import type { AppContext } from '../../app-context';
import { el, mount } from '../../core/dom';
import { mountFearGreed } from './fear-greed';
import { mountBtcStats } from './btc-stats';
import { mountClock } from './clock';
import { mountChatPanel } from '../chat/chat-panel';
import './center.css';

export function mountCommandCenter(container: HTMLElement, ctx: AppContext): void {
  const wormhole = el('div', { class: 'cc__wormhole', id: 'cc-wormhole' });
  const stats = el('div', { class: 'cc__stats', id: 'cc-stats' });
  const fng = el('div', { class: 'cc__fng', id: 'cc-fng' });
  const clock = el('div', { class: 'cc__clock', id: 'cc-clock' });
  // COMMS (the encrypted chat) lives at the bottom of the center column now; the
  // rotating quote generator moved out to the right column (see main.ts).
  const comms = el('div', { class: 'cc__comms', id: 'cc-comms' });

  // order matches the .cc grid rows (wormhole | clock | fng | stats | comms)
  mount(container, el('div', { class: 'cc' }, wormhole, clock, fng, stats, comms));

  mountBtcStats(stats, ctx);
  mountFearGreed(fng, ctx);
  mountClock(clock, ctx);
  mountChatPanel(comms, ctx);
}
