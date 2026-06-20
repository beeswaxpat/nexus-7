// Shared helper for Phase-0 panel stubs: render a labeled placeholder so the app
// boots and every import resolves. Phase 1/2 agents replace the body of each
// mount with the real panel; the EXPORTS and SIGNATURES must not change.

import { el, mount } from '../core/dom';

/** Render a titled placeholder card into `container`. */
export function placeholder(container: HTMLElement, title: string, note = ''): HTMLElement {
  const card = el('div', { class: 'panel-stub' },
    el('div', { class: 'panel-stub__title', text: title }),
    el('div', { class: 'panel-stub__note', text: note || 'stub: implemented in a later phase' })
  );
  mount(container, card);
  return card;
}
