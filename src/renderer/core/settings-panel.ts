// SETTINGS modal: a single fixed overlay (backdrop + centered card) opened from
// the titlebar gear. Sections: COMMS (callsign, private passphrase reset), CHAOS
// (the reaction toggles), SCENES (arrangement + ULTRA), LAYOUT (reset panel
// arrangement / box sizes), MEME IMAGES (the user's own overlay images), ABOUT.
//
// Every change persists through ctx.updateSettings and then broadcasts one of the
// window events in core/events.ts, so the live panels apply it without a remount.
//
// Built with the core/dom el() helper; co-located CSS is imported (Vite). Fully
// null-safe: it runs under the real Electron bridge AND the dev:web browser-mock,
// so ctx and ctx.updateSettings may be missing. Only one instance opens at a
// time. No em-dashes in any visible copy.

import './settings-panel.css';
import type { AppContext } from '../app-context';
import type { ChaosSettings, ImageSettings, SceneSettings, Settings } from '../../shared/types';
import { defaultSettings } from '../../shared/constants';
import { el } from './dom';
import {
  CHAOS_CHANGED,
  IMAGES_CHANGED,
  LAYOUT_RESET,
  LEFTFLEX_RESET,
  PASSPHRASE_RESET,
  SCENES_CHANGED,
  USERNAME_CHANGED,
  emit
} from './events';

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
  emit(IMAGES_CHANGED);
}

/**
 * Persist any settings patch (best-effort: dev:web may reject) and keep
 * ctx.settings current either way, so the panels that read it live agree with
 * what the modal shows. Returns true when the write went through.
 */
async function persistPatch(ctx: AppContext, patch: Partial<Settings>): Promise<boolean> {
  try {
    if (ctx?.updateSettings) {
      const updated = await ctx.updateSettings(patch);
      if (updated) ctx.settings = updated;
      return true;
    }
  } catch {
    /* fall through to the in-memory patch */
  }
  try {
    if (ctx?.settings) ctx.settings = { ...ctx.settings, ...patch };
  } catch {
    /* ignore */
  }
  return false;
}

// --- small form primitives (all scoped .nx-set-*) -----------------------------

/** A labeled on/off switch row. `onChange` receives the new value. */
function toggleRow(label: string, hint: string, checked: boolean, onChange: (on: boolean) => void): HTMLElement {
  const input = el('input', { type: 'checkbox', class: 'nx-set-switch__input' }) as HTMLInputElement;
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  const track = el('span', { class: 'nx-set-switch__track', 'aria-hidden': 'true' }, el('span', { class: 'nx-set-switch__knob' }));
  const text = el('span', { class: 'nx-set-row__text' }, el('span', { class: 'nx-set-row__label', text: label }));
  if (hint) text.append(el('span', { class: 'nx-set-row__hint', text: hint }));
  return el('label', { class: 'nx-set-row nx-set-switch' }, text, input, track);
}

/** A labeled row with a secondary button on the right. */
function actionRow(label: string, hint: string, buttonText: string, onClick: (btn: HTMLButtonElement) => void): HTMLElement {
  const btn = el('button', { class: 'nx-set-btn', type: 'button' }, buttonText) as HTMLButtonElement;
  btn.addEventListener('click', () => onClick(btn));
  const text = el('span', { class: 'nx-set-row__text' }, el('span', { class: 'nx-set-row__label', text: label }));
  if (hint) text.append(el('span', { class: 'nx-set-row__hint', text: hint }));
  return el('div', { class: 'nx-set-row' }, text, btn);
}

/** Flash a short confirmation on a row button, then restore its text. */
function flashBtn(btn: HTMLButtonElement, text: string): void {
  const prior = btn.textContent;
  btn.textContent = text;
  btn.disabled = true;
  window.setTimeout(() => {
    btn.textContent = prior;
    btn.disabled = false;
  }, 1100);
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

  // --- COMMS: callsign + private passphrase ----------------------------------
  const nameInput = el('input', {
    type: 'text',
    class: 'nx-set-input',
    maxlength: '24',
    placeholder: 'callsign',
    autocomplete: 'off',
    spellcheck: false,
    'aria-label': 'Callsign shown next to your chat messages'
  }) as HTMLInputElement;
  nameInput.value = (ctx?.settings?.username ?? '').trim();
  const nameNote = el('span', { class: 'nx-set-row__hint', text: 'Shown next to your messages. Enter to save.' });
  const saveName = async (): Promise<void> => {
    const next = nameInput.value.trim().slice(0, 24);
    if (next === (ctx?.settings?.username ?? '').trim()) return;
    await persistPatch(ctx, { username: next });
    emit(USERNAME_CHANGED, { name: next });
    nameNote.textContent = next ? `Saved: ${next}` : 'Cleared. You will be asked for a callsign on your next send.';
  };
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void saveName();
    }
  });
  nameInput.addEventListener('blur', () => void saveName());
  const nameRow = el(
    'div',
    { class: 'nx-set-row nx-set-row--stack' },
    el('span', { class: 'nx-set-row__label', text: 'Callsign' }),
    nameInput,
    nameNote
  );

  const commsSection = el(
    'section',
    { class: 'nx-set-section' },
    el('div', { class: 'nx-set-section-label', text: 'COMMS' }),
    nameRow,
    actionRow(
      'Private room passphrase',
      'Stored on this device only, never shown. Resetting asks for a new one the next time you enter the private room.',
      'Reset',
      (btn) => {
        emit(PASSPHRASE_RESET);
        flashBtn(btn, 'Cleared');
      }
    )
  );

  // --- CHAOS: the reaction toggles --------------------------------------------
  const chaosNow = (): ChaosSettings => ({
    ...defaultSettings().chaos,
    ...(ctx?.settings?.chaos ?? {})
  });
  const setChaos = (patch: Partial<ChaosSettings>): void => {
    void persistPatch(ctx, { chaos: { ...chaosNow(), ...patch } }).then(() => emit(CHAOS_CHANGED));
  };
  const c0 = chaosNow();
  const chaosSection = el(
    'section',
    { class: 'nx-set-section' },
    el('div', { class: 'nx-set-section-label', text: 'CHAOS' }),
    el('div', { class: 'nx-set-hint', text: 'The price-driven theatrics. The accent recolor on pumps and dumps always stays on.' }),
    toggleRow('Reaction banners', 'The blinking one-liner at the top on a 5% move or more.', c0.banners, (on) => setChaos({ banners: on })),
    toggleRow('HACKED / LFG takeover', 'Giant center text on a 5% dump or a 20% pump.', c0.wormhole, (on) => setChaos({ wormhole: on })),
    toggleRow('CRT scanlines', 'The drifting tube lines over the whole dashboard.', c0.scanlines, (on) => setChaos({ scanlines: on })),
    toggleRow('Auto message', 'Posts "<callsign> NOT REAL" to the chat every 15 minutes.', c0.autoMessage, (on) => setChaos({ autoMessage: on }))
  );

  // --- SCENES: arrangement + ULTRA --------------------------------------------
  const scenesNow = (): SceneSettings => ({
    ...defaultSettings().scenes,
    ...(ctx?.settings?.scenes ?? {})
  });
  const setScenes = (patch: Partial<SceneSettings>): void => {
    void persistPatch(ctx, { scenes: { ...scenesNow(), ...patch } }).then(() => emit(SCENES_CHANGED));
  };
  const s0 = scenesNow();
  const scenesSection = el(
    'section',
    { class: 'nx-set-section' },
    el('div', { class: 'nx-set-section-label', text: 'SCENES' }),
    toggleRow('Night City in the center', 'Off puts the Globe in the center and Night City in the corner.', s0.swapped, (on) => setScenes({ swapped: on })),
    toggleRow('Show Globe', 'Hide it to give the neighbors its space.', s0.showWormhole, (on) => setScenes({ showWormhole: on })),
    toggleRow('Show Night City', 'Hide it to give the neighbors its space.', s0.showNightCity, (on) => setScenes({ showNightCity: on })),
    toggleRow('Night City ULTRA', 'Synthwave inversion: violet sky, retro sun, neon grid street.', s0.ultraCity, (on) => setScenes({ ultraCity: on }))
  );

  // --- LAYOUT: resets ---------------------------------------------------------
  const layoutSection = el(
    'section',
    { class: 'nx-set-section' },
    el('div', { class: 'nx-set-section-label', text: 'LAYOUT' }),
    actionRow('Panel arrangement', 'Put every panel back in its original slot (drag a panel grip to rearrange).', 'Reset', (btn) => {
      emit(LAYOUT_RESET);
      flashBtn(btn, 'Done');
    }),
    actionRow('Left column box sizes', 'Restore the default heights of the two asset boxes and the chart.', 'Reset', (btn) => {
      emit(LEFTFLEX_RESET);
      flashBtn(btn, 'Done');
    })
  );

  const body = el('div', { class: 'nx-set-body' }, commsSection, chaosSection, scenesSection, layoutSection, section, aboutSection);

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
