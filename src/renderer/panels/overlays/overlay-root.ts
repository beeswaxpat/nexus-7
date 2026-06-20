// IMPLEMENTED (Phase 2, Track C1). The single contained overlay layer that hosts
// every reactive visual so they NEVER reflow the grid. mountOverlays:
//   - reads the BTC row from store.crypto and maps its 24h change via
//     core/reactions.btcMode to normal|pump|dump|lfg, then drives
//     document.documentElement.dataset.btc (the --accent recolor swap in tokens.css)
//   - shows the blinking BTC easter-egg banner (reactions.bannerFor text)
//   - shows the center HACKED (dump) and LFG (>=10) overlay text
//   - mirrors settings.chaos.scanlines onto <body data-scanlines>
//
// Everything is opacity/transform/recolor only; the host is fixed + pointer-events
// none (layout.css). Respects the chaos toggles: banners gate the banner, wormhole
// gates the center text, scanlines gate the CRT lines. autoMessage is a
// chat-only toggle (no overlay effect). Null-safe so it also runs under dev:web.
// Signature FROZEN.

import type { AppContext } from '../../app-context';
import type { AssetQuote } from '../../../shared/types';
import { btcMode, bannerFor, type BtcMode } from '../../core/reactions';
import { findCenterQuote } from '../../core/center';
import { showBanner, clearBanner } from './banners';
import { setCenterOverlay } from './hacked';
import { mountPepe } from './pepe';

export function mountOverlays(container: HTMLElement, ctx: AppContext): void {
  if (!container) return;
  const host = container;

  // chaos toggles (default-on per the spec; tolerate a missing settings object).
  const chaos = ctx?.settings?.chaos ?? {
    wormhole: true,
    banners: true,
    scanlines: true,
    autoMessage: false
  };

  // --- scanlines: mirror chaos.scanlines onto <body data-scanlines> ----------
  if (typeof document !== 'undefined' && document.body) {
    document.body.setAttribute('data-scanlines', chaos.scanlines ? 'on' : 'off');
  }

  // pre-build the center text nodes so the first reveal is instant (no rebuild).
  setCenterOverlay(host, 'none');

  let lastMode: BtcMode | null = null;

  /** Apply the global BTC mode: recolor swap + center HACKED/LFG text. */
  function applyBtcMode(mode: BtcMode): void {
    // global accent recolor (drives tokens.css). Always set this, even with the
    // wormhole toggle off, so prices/headers still reflect the move.
    document.documentElement.dataset.btc = mode;

    // center overlay text is part of the "wormhole" chaos band.
    if (!chaos.wormhole) {
      setCenterOverlay(host, 'none');
    } else if (mode === 'dump') {
      setCenterOverlay(host, 'hacked');
    } else if (mode === 'lfg') {
      setCenterOverlay(host, 'lfg');
    } else {
      setCenterOverlay(host, 'none');
    }
    lastMode = mode;
  }

  /** Apply the easter-egg banner (own thresholds; gated by chaos.banners). */
  function applyBanner(change: number | null, assetName?: string): void {
    if (!chaos.banners) {
      clearBanner(host);
      return;
    }
    const text = bannerFor(change, assetName);
    if (text) showBanner(host, text);
    else clearBanner(host);
  }

  // --- wiring ----------------------------------------------------------------
  const unsubs: Array<() => void> = [];

  // Center-asset-driven mode + banner (Bitcoin by default; user-swappable, can be a
  // stock). store.subscribe fires immediately with current value.
  let lastCrypto: AssetQuote[] | null = null;
  let lastStocks: AssetQuote[] | null = null;
  const reapply = (): void => {
    const center = findCenterQuote(lastCrypto, lastStocks);
    const change = center?.change24h ?? null;
    const name = center?.name || center?.symbol || 'Bitcoin';
    const mode = btcMode(change);
    if (mode !== lastMode) applyBtcMode(mode);
    applyBanner(change, name);
  };
  unsubs.push(
    ctx.store.subscribe('crypto', (crypto) => {
      lastCrypto = crypto;
      reapply();
    }),
    ctx.store.subscribe('stocks', (stocks) => {
      lastStocks = stocks;
      reapply();
    })
  );

  // Re-evaluate immediately when the user swaps the center asset in the picker.
  const onCenterChanged = (): void => reapply();
  window.addEventListener('nexus:center-changed', onCenterChanged);
  unsubs.push(() => window.removeEventListener('nexus:center-changed', onCenterChanged));

  // Pepe overlay: random thumbnails + the "this is fine" image on BTC dumps.
  mountPepe(host, ctx);

  // expose teardown for any future host that unmounts the overlay layer.
  (host as HTMLElement & { __unmountOverlays?: () => void }).__unmountOverlays = () => {
    for (const off of unsubs) {
      try {
        off();
      } catch {
        /* ignore */
      }
    }
    // H3(b): also tear down the pepe overlay layer (timer, store subs, listener, node).
    try {
      (host as HTMLElement & { __pepeDispose?: () => void }).__pepeDispose?.();
    } catch {
      /* ignore */
    }
  };
}
