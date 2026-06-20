// IMPLEMENTED (Phase 2, Track C1). Center overlay text for dump ("HACKED") and big
// pump ("LFG"). Text-only on the contained, pointer-events:none overlay layer, so it
// never reflows the grid. The two text nodes always exist (built once, lazily); the
// active one is revealed purely by the data-center-overlay attribute the CSS keys on.
// Signature FROZEN.

export type CenterOverlay = 'none' | 'hacked' | 'lfg';

const ROOT_CLASS = 'nx-center';

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

/**
 * Set the center overlay text state on the overlay host. 'none' clears it; the CSS
 * reveals exactly the matching text node (HACKED for dump, LFG for big pump) via
 * the data-center-overlay attribute. Reveal/hide is opacity+transform only.
 */
export function setCenterOverlay(host: HTMLElement, mode: CenterOverlay): void {
  if (!host) return;
  ensureCenter(host);
  if (mode === 'none') host.removeAttribute('data-center-overlay');
  else host.setAttribute('data-center-overlay', mode);
}
