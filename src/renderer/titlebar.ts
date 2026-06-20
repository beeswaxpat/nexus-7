// Custom titlebar for the frameless window: a draggable bar with the NEXUS-7
// wordmark on the left and minimize / maximize / close controls on the right.
// The bar is -webkit-app-region: drag (moves the window); the buttons are no-drag.
// Actions go through the bridge -> preload -> main BrowserWindow.

import './titlebar.css';
import type { AppContext } from './app-context';
import { el } from './core/dom';
import { openSettings } from './core/settings-panel';

export function mountTitlebar(container: HTMLElement, ctx: AppContext): void {
  if (!container) return;

  const brand = el('div', { class: 'titlebar__brand' },
    el('span', { class: 'titlebar__dot', 'aria-hidden': 'true' }),
    el('span', { class: 'titlebar__name', text: 'NEXUS-7' }),
    // Animated neon/lava wordmark (CSS does the flowing-gradient + glow work).
    el('span', { class: 'titlebar__fable', text: 'FABLE-POWERED' })
  );

  const mkBtn = (cls: string, glyph: string, title: string, onClick: () => void): HTMLElement => {
    const b = el('button', {
      class: 'titlebar__btn ' + cls,
      type: 'button',
      title,
      'aria-label': title
    }, glyph);
    b.addEventListener('click', onClick);
    return b;
  };

  const fsBtn = mkBtn('titlebar__btn--fullscreen', '⛶', 'Fullscreen (F11)', () =>
    ctx.bridge.toggleFullscreen?.()
  );

  const controls = el('div', { class: 'titlebar__controls' },
    mkBtn('titlebar__btn--settings', '⚙', 'Settings', () => openSettings(ctx)),
    fsBtn,
    mkBtn('titlebar__btn--min', '–', 'Minimize', () => ctx.bridge.minimizeWindow?.()),
    mkBtn('titlebar__btn--max', '□', 'Maximize / Restore', () => ctx.bridge.toggleMaximizeWindow?.()),
    mkBtn('titlebar__btn--close', '✕', 'Close', () => ctx.bridge.closeWindow?.())
  );

  container.replaceChildren(brand, controls);

  // Reflect fullscreen state on the button (also catches F11 / OS-driven changes).
  ctx.bridge.onFullscreenState?.((on) => {
    fsBtn.classList.toggle('is-active', on);
    const label = on ? 'Exit fullscreen (F11)' : 'Fullscreen (F11)';
    fsBtn.title = label;
    fsBtn.setAttribute('aria-label', label);
  });

  // F11 toggles true fullscreen from anywhere in the app.
  window.addEventListener('keydown', (e) => {
    if (e.key === 'F11') {
      e.preventDefault();
      ctx.bridge.toggleFullscreen?.();
    }
  });
}
