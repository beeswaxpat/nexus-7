// SETTINGS modal: a single fixed overlay (backdrop + centered card) opened from
// the titlebar gear. Section "MEME IMAGES" lets the user add and manage their OWN
// images (the app ships with none). Uploaded files are downscaled in-browser
// (longest side <= 240px) and stored as small JPEG data: URLs in
// settings.images.custom, so they survive across runs and feed straight into the
// image overlay <img src>.
//
// Built with the core/dom el() helper; co-located CSS is imported (Vite). Fully
// null-safe: it runs under the real Electron bridge AND the dev:web browser-mock,
// so ctx and ctx.updateSettings may be missing. Only one instance opens at a
// time. Every change persists then fires window 'nexus:images-changed' so the
// overlay re-reads its pools live. No em-dashes in any visible copy.

import './settings-panel.css';
import type { AppContext } from '../app-context';
import type { ImageSettings } from '../../shared/types';
import { el } from './dom';

/** Hard cap on user images (each is a small downscaled data URL). */
const MAX_CUSTOM = 24;
/** Skip any source file larger than this (pre-downscale guard). */
const MAX_FILE_BYTES = 12 * 1024 * 1024;
/** Longest side of a stored thumbnail, in CSS px. */
const MAX_EDGE = 240;
/** Stored thumbnail JPEG quality. */
const JPEG_QUALITY = 0.82;

/** Module-level guard so only one modal exists at a time. */
let openEl: HTMLElement | null = null;

/** Maintainer credit shown in the About card. */
const GH_HANDLE = 'beeswaxpat';
const GH_URL = 'https://github.com/beeswaxpat';
const GH_AVATAR = 'https://github.com/beeswaxpat.png?size=160';
/** Neon sigil shown if the GitHub avatar cannot load (e.g. offline). */
const SIGIL_FALLBACK =
  'data:image/svg+xml,' +
  encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><polygon points='32,4 56,18 56,46 32,60 8,46 8,18' fill='none' stroke='#22e3ff' stroke-width='2'/><text x='32' y='41' font-family='monospace' font-size='18' fill='#22e3ff' text-anchor='middle'>N7</text></svg>"
  );

/** Open the maintainer's GitHub profile in the system browser (never navigate the app). */
function openProfile(ctx: AppContext | null | undefined): void {
  try {
    if (ctx?.bridge?.openExternal) {
      void ctx.bridge.openExternal(GH_URL);
      return;
    }
  } catch {
    /* ignore */
  }
  try {
    window.open(GH_URL, '_blank', 'noopener');
  } catch {
    /* ignore */
  }
}

/** Live read of the image settings with a safe default for old/dev profiles. */
function readImages(ctx: AppContext | null | undefined): ImageSettings {
  const cur = ctx?.settings?.images;
  return {
    useDefaults: cur?.useDefaults !== false,
    custom: Array.isArray(cur?.custom) ? [...cur!.custom] : []
  };
}

/**
 * Persist a new ImageSettings. Uses ctx.updateSettings when available (assigns
 * the result back to ctx.settings); on failure or absence falls back to setting
 * ctx.settings.images in memory (dev:web). Always dispatches the change event.
 */
async function persist(ctx: AppContext | null | undefined, next: ImageSettings): Promise<void> {
  try {
    if (ctx?.updateSettings) {
      const updated = await ctx.updateSettings({ images: next });
      if (updated) ctx.settings = updated;
    } else if (ctx?.settings) {
      ctx.settings.images = next;
    }
  } catch {
    // dev:web or a rejected write: keep the change in memory so the UI is consistent
    try {
      if (ctx?.settings) ctx.settings.images = next;
    } catch {
      /* ignore */
    }
  }
  try {
    window.dispatchEvent(new CustomEvent('nexus:images-changed'));
  } catch {
    /* ignore */
  }
}

/**
 * Read a File, downscale it so its longest side is <= MAX_EDGE while preserving
 * aspect ratio, and resolve a small JPEG data URL. Rejects on non-image/decode
 * failure (the caller skips those). Never rejects the whole batch.
 */
function downscale(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type || !file.type.startsWith('image/')) {
      reject(new Error('not an image'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read failed'));
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      if (!dataUrl) {
        reject(new Error('empty read'));
        return;
      }
      const img = new Image();
      img.onload = () => {
        try {
          const w = img.naturalWidth || img.width;
          const h = img.naturalHeight || img.height;
          if (!w || !h) {
            reject(new Error('zero dims'));
            return;
          }
          const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
          const cw = Math.max(1, Math.round(w * scale));
          const ch = Math.max(1, Math.round(h * scale));
          const canvas = document.createElement('canvas');
          canvas.width = cw;
          canvas.height = ch;
          const cctx = canvas.getContext('2d');
          if (!cctx) {
            reject(new Error('no 2d context'));
            return;
          }
          cctx.drawImage(img, 0, 0, cw, ch);
          resolve(canvas.toDataURL('image/jpeg', JPEG_QUALITY));
        } catch (err) {
          reject(err instanceof Error ? err : new Error('draw failed'));
        }
      };
      img.onerror = () => reject(new Error('decode failed'));
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}

/** Open the SETTINGS modal. No-op (re-focus) if one is already open. */
export function openSettings(ctx: AppContext): void {
  if (typeof document === 'undefined') return;
  // only one instance at a time: remove any stale/leftover modal first
  if (openEl) {
    try {
      openEl.remove();
    } catch {
      /* ignore */
    }
    openEl = null;
  }

  // --- DOM scaffold ----------------------------------------------------------
  const grid = el('div', { class: 'nx-set-grid' });
  const note = el('div', { class: 'nx-set-note', 'aria-live': 'polite' });
  const emptyLine = el('div', { class: 'nx-set-empty', text: 'No custom images yet. Add some from your device.' });

  const fileInput = el('input', {
    type: 'file',
    multiple: true,
    accept: 'image/*'
  }) as HTMLInputElement;
  fileInput.style.display = 'none';

  const addBtn = el('button', {
    class: 'nx-set-add',
    type: 'button'
  }, 'Add images') as HTMLButtonElement;

  const section = el(
    'section',
    { class: 'nx-set-section' },
    el('div', { class: 'nx-set-section-label', text: 'MEME IMAGES' }),
    el('div', { class: 'nx-set-hint', text: 'Add your own images to drift in over the dashboard.' }),
    addBtn,
    fileInput,
    note,
    grid,
    emptyLine
  );

  // --- ABOUT / maintainer credit --------------------------------------------
  const avatar = el('img', { class: 'nx-set-about__img', alt: '', decoding: 'async' }) as HTMLImageElement;
  avatar.onerror = (): void => {
    avatar.onerror = null; // guard against a loop; the data: URL always resolves
    avatar.src = SIGIL_FALLBACK;
  };
  avatar.src = GH_AVATAR;

  const aboutBtn = el(
    'button',
    { class: 'nx-set-about', type: 'button', title: 'Open the GitHub profile in your browser' },
    avatar,
    el(
      'div',
      { class: 'nx-set-about__meta' },
      el('div', { class: 'nx-set-about__name', text: GH_HANDLE }),
      el('div', { class: 'nx-set-about__sub', text: 'Maker of NEXUS-7. Open the profile and source on GitHub.' }),
      el('div', { class: 'nx-set-about__link', text: 'github.com/' + GH_HANDLE })
    )
  ) as HTMLButtonElement;
  aboutBtn.addEventListener('click', () => openProfile(ctx));

  const aboutSection = el(
    'section',
    { class: 'nx-set-section' },
    el('div', { class: 'nx-set-section-label', text: 'ABOUT' }),
    aboutBtn
  );

  const body = el('div', { class: 'nx-set-body' }, section, aboutSection);

  const closeBtn = el('button', {
    class: 'nx-set-close',
    type: 'button',
    title: 'Close',
    'aria-label': 'Close settings'
  }, '✕');

  const head = el(
    'div',
    { class: 'nx-set-head' },
    el('div', { class: 'nx-set-title', text: 'SETTINGS' }),
    closeBtn
  );

  const card = el('div', { class: 'nx-set-card', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Settings' }, head, body);
  const backdrop = el('div', { class: 'nx-set-backdrop' }, card);

  // --- close wiring ----------------------------------------------------------
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close();
  };
  function close(): void {
    window.removeEventListener('keydown', onKey);
    try {
      backdrop.remove();
    } catch {
      /* ignore */
    }
    if (openEl === backdrop) openEl = null;
  }

  closeBtn.addEventListener('click', close);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });
  window.addEventListener('keydown', onKey);

  // --- render the custom-image grid from current settings --------------------
  function renderGrid(): void {
    const { custom } = readImages(ctx);
    grid.replaceChildren();
    emptyLine.style.display = custom.length ? 'none' : '';
    custom.forEach((src, idx) => {
      const img = el('img', { alt: '', decoding: 'async' }) as HTMLImageElement;
      img.src = src;
      const rm = el('button', {
        class: 'nx-set-thumb__rm',
        type: 'button',
        title: 'Remove image',
        'aria-label': 'Remove image'
      }, '✕');
      rm.addEventListener('click', async () => {
        const cur = readImages(ctx);
        cur.custom.splice(idx, 1);
        await persist(ctx, cur);
        renderGrid();
      });
      grid.append(el('div', { class: 'nx-set-thumb' }, img, rm));
    });
  }

  // --- add images ------------------------------------------------------------
  addBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const files = Array.from(fileInput.files ?? []);
    fileInput.value = ''; // allow re-selecting the same file later
    if (!files.length) return;

    note.dataset.kind = 'busy';
    note.textContent = 'Processing images...';
    addBtn.disabled = true;

    const cur = readImages(ctx);
    let added = 0;
    let skipped = 0;
    let capped = false;

    for (const file of files) {
      if (cur.custom.length >= MAX_CUSTOM) {
        capped = true;
        break;
      }
      if (!file.type.startsWith('image/') || file.size > MAX_FILE_BYTES) {
        skipped++;
        continue;
      }
      try {
        const small = await downscale(file);
        cur.custom.push(small);
        added++;
      } catch {
        skipped++;
      }
    }
    // if we stopped on the cap, there were still more files queued behind it
    if (capped || cur.custom.length >= MAX_CUSTOM) {
      const remaining = files.length - added - skipped;
      if (remaining > 0) capped = true;
    }

    if (added > 0) await persist(ctx, cur);

    addBtn.disabled = false;
    renderGrid();

    const parts: string[] = [];
    if (added) parts.push(`Added ${added}`);
    if (skipped) parts.push(`skipped ${skipped} (not an image or too large)`);
    if (capped) parts.push(`limit is ${MAX_CUSTOM} images, extras ignored`);
    if (parts.length) {
      note.dataset.kind = capped || skipped ? 'warn' : '';
      note.textContent = parts.join(', ') + '.';
    } else {
      note.dataset.kind = '';
      note.textContent = '';
    }
  });

  // --- mount -----------------------------------------------------------------
  renderGrid();
  document.body.appendChild(backdrop);
  openEl = backdrop;
}
