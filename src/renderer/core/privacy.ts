// Privacy mode: one global toggle that blurs bag dollar values and portfolio
// totals everywhere (asset boxes, BTC strip combined cell, yield payouts).
// Prices and percentages stay visible; only "how much I hold" is obscured.
// State persists as Settings.privateMode; panels learn of flips via a window
// CustomEvent (the codebase precedent for cross-panel signals, see
// nexus:center-changed). Visual treatment is a CSS blur (.nx-blur), not
// asterisks: the value stays laid out at its real width, just unreadable.

import type { AppContext } from '../app-context';
import './privacy.css';

/** Window CustomEvent fired after the privateMode setting flips. */
export const PRIVACY_EVENT = 'nexus:privacy-changed';

/** Current privacy state (null-safe for dev:web). */
export function isPrivate(ctx: AppContext | null | undefined): boolean {
  return ctx?.settings?.privateMode === true;
}

/**
 * Persist the new state and broadcast PRIVACY_EVENT. The event fires
 * immediately (optimistic) so the UI responds on the click, not after the
 * IPC round trip; updateSettings failures (possible in dev:web) are logged
 * and the in-memory ctx keeps the new value.
 */
export function setPrivate(ctx: AppContext, on: boolean): void {
  ctx.settings = { ...ctx.settings, privateMode: on };
  ctx.updateSettings({ privateMode: on }).catch((err) => {
    console.warn('[privacy] persist failed (in-memory only):', err);
  });
  window.dispatchEvent(new CustomEvent(PRIVACY_EVENT, { detail: { on } }));
}

/**
 * Toggle the .nx-blur class on a value element. Also hides the value from
 * assistive tech while blurred: a screen reader would otherwise read the exact
 * dollar amount the eye toggle is meant to hide. aria-hidden removes it from the
 * accessibility tree, and if the element is focusable (the cap cell is
 * role=button tabindex=0) we also drop it out of the tab order so AT cannot land
 * on it. Idempotent: re-calling with on=true keeps the saved tabindex intact;
 * on=false restores it. The visual treatment stays in .nx-blur (privacy.css).
 */
export function markPrivate(el: HTMLElement, on: boolean): void {
  el.classList.toggle('nx-blur', on);
  if (on) {
    el.setAttribute('aria-hidden', 'true');
    // Save and clear a real tabindex so a focusable value leaves the tab order.
    const ti = el.getAttribute('tabindex');
    if (ti !== null && ti !== '-1') {
      el.dataset.nxTabindex = ti;
      el.setAttribute('tabindex', '-1');
    }
  } else {
    el.removeAttribute('aria-hidden');
    if (el.dataset.nxTabindex !== undefined) {
      el.setAttribute('tabindex', el.dataset.nxTabindex);
      delete el.dataset.nxTabindex;
    }
  }
}
