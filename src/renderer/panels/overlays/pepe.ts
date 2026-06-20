// Image overlay: small, non-intrusive meme thumbnails on the contained overlay layer.
// The app ships with NO bundled images. Users add their own from Settings (stored as
// downscaled data: URLs in settings.images.custom). When the user has added images:
// - a random one fades in at a corner every couple of minutes, briefly
// - a celebratory one fades in on BTC pump / lfg
// With no user images the overlay stays silent. All motion is opacity/transform on the
// pointer-events:none layer, so nothing ever reflows.

import './pepe.css';
import type { AppContext } from '../../app-context';
import type { AssetQuote } from '../../../shared/types';
import { btcMode, type BtcMode } from '../../core/reactions';
import { findCenterQuote } from '../../core/center';

/**
 * The user's images, read FRESH each call so uploads/removals apply without a
 * remount. Each entry is a full data: URL assigned straight to img.src. May be empty.
 */
function userImages(ctx: AppContext | null | undefined): string[] {
  const custom = ctx?.settings?.images?.custom;
  return Array.isArray(custom) ? custom : [];
}

type Corner = Partial<Record<'top' | 'left' | 'right' | 'bottom', string>>;
// kept clear of the panel headers/tabs (top) and the ticker (very bottom)
const CORNERS: Corner[] = [
  { top: '120px', left: '18px' },
  { top: '120px', right: '18px' },
  { bottom: '96px', left: '18px' },
  { bottom: '96px', right: '18px' }
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

interface ShowOpts {
  sizePx?: number;
  durationMs?: number;
  corner?: Corner;
  cls?: string;
}

export function mountPepe(host: HTMLElement, ctx: AppContext): void {
  if (!host) return;
  const layer = document.createElement('div');
  layer.className = 'nx-pepe-layer';
  host.appendChild(layer);

  // `src` is a ready-to-use image URL: a user-supplied data: URL assigned to
  // img.src verbatim.
  function show(src: string, opts: ShowOpts = {}): () => void {
    const img = document.createElement('img');
    img.className = 'nx-pepe' + (opts.cls ? ' ' + opts.cls : '');
    img.alt = '';
    img.decoding = 'async';
    img.setAttribute('aria-hidden', 'true');
    if (opts.sizePx) img.style.setProperty('--pepe-size', opts.sizePx + 'px');
    const corner = opts.corner ?? pick(CORNERS);
    img.style.top = corner.top ?? '';
    img.style.left = corner.left ?? '';
    img.style.right = corner.right ?? '';
    img.style.bottom = corner.bottom ?? '';
    let removed = false;
    const remove = (): void => {
      if (removed) return;
      removed = true;
      img.classList.remove('is-in');
      setTimeout(() => img.remove(), 420);
    };
    // a missing/broken image must never leave a stuck element on the layer
    img.onerror = remove;
    img.src = src;
    layer.appendChild(img);
    requestAnimationFrame(() => img.classList.add('is-in'));
    if (opts.durationMs) setTimeout(remove, opts.durationMs);
    return remove;
  }

  // --- a celebratory user image on BTC pump / lfg ---------------------------
  let lastMode: BtcMode | null = null;
  const onMode = (mode: BtcMode): void => {
    if (mode === lastMode) return;
    if (mode === 'pump' || mode === 'lfg') {
      const pool = userImages(ctx);
      if (pool.length) {
        show(pick(pool), { sizePx: 124, durationMs: 8000, corner: { bottom: '96px', right: '18px' } });
      }
    }
    lastMode = mode;
  };

  let lastCrypto: AssetQuote[] | null = null;
  let lastStocks: AssetQuote[] | null = null;
  const reapply = (): void => {
    const center = findCenterQuote(lastCrypto, lastStocks);
    onMode(btcMode(center?.change24h ?? null));
  };
  const subCrypto = ctx?.store?.subscribe?.('crypto', (list) => {
    lastCrypto = list;
    reapply();
  });
  const subStocks = ctx?.store?.subscribe?.('stocks', (list) => {
    lastStocks = list;
    reapply();
  });
  const onCenterChanged = (): void => reapply();
  window.addEventListener('nexus:center-changed', onCenterChanged);

  // Pool is read live on every show, so a settings change applies on the next
  // tick without a remount. This listener is a refresh hook (no-op today).
  const onImagesChanged = (): void => {
    /* pool is read fresh per show; nothing to do here */
  };
  window.addEventListener('nexus:images-changed', onImagesChanged);

  // --- random ambient user image every ~2 minutes --------------------------
  const timer = window.setInterval(() => {
    if (document.hidden) return;
    const pool = userImages(ctx);
    if (!pool.length) return; // no user images: skip, never crash
    show(pick(pool), { sizePx: 100 + Math.floor(Math.random() * 44), durationMs: 6500 });
  }, 120000);

  (host as HTMLElement & { __pepeDispose?: () => void }).__pepeDispose = () => {
    try {
      subCrypto?.();
      subStocks?.();
    } catch {
      /* ignore */
    }
    window.removeEventListener('nexus:center-changed', onCenterChanged);
    window.removeEventListener('nexus:images-changed', onImagesChanged);
    window.clearInterval(timer);
    layer.remove(); // drop the layer node so teardown leaves nothing stuck
  };
}
