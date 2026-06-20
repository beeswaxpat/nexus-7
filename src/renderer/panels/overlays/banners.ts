// IMPLEMENTED (Phase 2, Track C1). Blinking BTC easter-egg banner on the contained
// overlay layer. Given a BTC 24h change, overlay-root computes the verbatim text via
// core/reactions.bannerFor and calls showBanner/clearBanner here. The strip blinks
// (CSS, opacity-only) and lives on the fixed pointer-events:none overlay, so it can
// NEVER reflow the grid. Idempotent: re-showing the same text is a no-op (the blink
// keeps running uninterrupted); a different text swaps in place. Signatures FROZEN.

const BANNER_CLASS = 'nx-banner';

/**
 * Show a banner with the given text on the overlay host (blinking). If a banner
 * with the same text is already up, leave it (so the animation does not restart).
 * Empty/whitespace text clears any active banner.
 */
export function showBanner(host: HTMLElement, text: string): void {
  if (!host) return;
  const next = (text ?? '').trim();
  if (!next) {
    clearBanner(host);
    return;
  }

  // keep the contract's data hook for debugging / external styling
  host.setAttribute('data-banner', next);

  let node = host.querySelector<HTMLElement>('.' + BANNER_CLASS + ':not(.is-leaving)');
  if (node) {
    // same text -> do nothing (uninterrupted blink); changed text -> swap content
    if (node.textContent === next) return;
    node.textContent = next;
    return;
  }

  node = document.createElement('div');
  node.className = BANNER_CLASS;
  node.setAttribute('role', 'status');
  node.setAttribute('aria-live', 'polite');
  node.textContent = next;
  host.appendChild(node);
}

/** Clear any active banner (with a short fade-out, then remove). */
export function clearBanner(host: HTMLElement): void {
  if (!host) return;
  host.removeAttribute('data-banner');

  const nodes = host.querySelectorAll<HTMLElement>('.' + BANNER_CLASS + ':not(.is-leaving)');
  nodes.forEach((node) => {
    node.classList.add('is-leaving');
    const done = (): void => node.remove();
    node.addEventListener('animationend', done, { once: true });
    // safety net if animationend never fires (e.g. reduced-motion paths)
    window.setTimeout(done, 360);
  });
}
