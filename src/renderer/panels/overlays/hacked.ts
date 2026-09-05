// Center overlay text for dump ("HACKED") and big pump ("LFG"). Text-only on the
// contained, pointer-events:none overlay layer, so it never reflows the grid. The
// two text nodes always exist (built once, lazily); the active one is revealed
// purely by the data-center-overlay attribute the CSS keys on.
//
// Timing: a mode change SLAMS the giant text over the whole dashboard for a few
// seconds (the theatrical moment), then it settles into a compact badge in the
// bottom-right corner for as long as the mode holds, so a -5% day does not hide
// the clock and the Fear and Greed gauge for hours. The badge re-slams briefly
// every so often to keep the chaos alive. Phase is data-center-phase ('slam' |
// 'badge'); CSS handles every visual (opacity / transform / size on the overlay).
// Signature FROZEN (setCenterOverlay).

export type CenterOverlay = 'none' | 'hacked' | 'lfg';

const ROOT_CLASS = 'nx-center';

/** How long the full-screen slam holds before settling into the badge. */
const SLAM_MS = 6_000;
/** Cadence of the short re-slams while a mode holds (min, max). */
const RESLAM_MIN_MS = 4 * 60_000;
const RESLAM_MAX_MS = 9 * 60_000;
/** Length of a re-slam. */
const RESLAM_MS = 2_400;

let current: CenterOverlay = 'none';
let settleTimer: number | null = null;
let reslamTimer: number | null = null;

function clearTimers(): void {
  if (settleTimer !== null) {
    window.clearTimeout(settleTimer);
    settleTimer = null;
  }
  if (reslamTimer !== null) {
    window.clearTimeout(reslamTimer);
    reslamTimer = null;
  }
}

function reducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Build the (hidden) HACKED + LFG text nodes once, on demand. Idempotent. */
function ensureCenter(host: HTMLElement): void {
  if (host.querySelector('.' + ROOT_CLASS)) return;

  const hacked = document.createElement('div');
  hacked.className = 'nx-center__text nx-center__text--hacked';
  hacked.setAttribute('aria-hidden', 'true');
  hacked.textContent = 'HACKED';

  const lfg = document.createElement('div');
  lfg.className = 'nx-center__text nx-center__text--lfg';
  lfg.setAttribute('aria-hidden', 'true');
  lfg.textContent = 'LFG';

  const wrap = document.createElement('div');
  wrap.className = ROOT_CLASS;
  wrap.append(hacked, lfg);
  host.appendChild(wrap);
}

/** Enter the badge phase and arm the next short re-slam. */
function settle(host: HTMLElement): void {
  host.setAttribute('data-center-phase', 'badge');
  if (reducedMotion()) return; // a calm badge only, no periodic slams
  const wait = RESLAM_MIN_MS + Math.random() * (RESLAM_MAX_MS - RESLAM_MIN_MS);
  reslamTimer = window.setTimeout(() => {
    reslamTimer = null;
    if (current === 'none') return;
    host.setAttribute('data-center-phase', 'slam');
    settleTimer = window.setTimeout(() => {
      settleTimer = null;
      if (current !== 'none') settle(host);
    }, RESLAM_MS);
  }, wait);
}

/**
 * Set the center overlay text state on the overlay host. 'none' clears it; the CSS
 * reveals exactly the matching text node (HACKED for dump, LFG for big pump) via
 * the data-center-overlay attribute. A new mode slams full-screen first, then
 * settles into the corner badge. Re-applying the same mode is a no-op.
 */
export function setCenterOverlay(host: HTMLElement, mode: CenterOverlay): void {
  if (!host) return;
  ensureCenter(host);
  if (mode === current) return;
  current = mode;
  clearTimers();
  if (mode === 'none') {
    host.removeAttribute('data-center-overlay');
    host.removeAttribute('data-center-phase');
    return;
  }
  host.setAttribute('data-center-overlay', mode);
  // Reduced motion: skip the slam, go straight to the quiet badge.
  if (reducedMotion()) {
    settle(host);
    return;
  }
  host.setAttribute('data-center-phase', 'slam');
  settleTimer = window.setTimeout(() => {
    settleTimer = null;
    if (current !== 'none') settle(host);
  }, SLAM_MS);
}
