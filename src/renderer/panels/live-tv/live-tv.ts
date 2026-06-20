// The live-stream player behind BOTH the TV tab and the Video tab: a YouTube
// iframe embed of a persisted source (autoplay=1&mute=1), a one-click Unmute
// button, one-click channel presets, a small source-config input, and a clean
// "stream offline, open on YouTube" fallback when there is no url or the embed
// fails to load. Each tab passes its own settings key / default / presets via
// LiveTvOptions; with no options it behaves as the original TV tab. CSP already
// allows frame-src https://www.youtube.com. Signature FROZEN.
//
// Defensive by design: also runs in a plain browser (dev:web) with the mocked
// bridge, so every ctx access is null-safe and openExternal degrades gracefully.
//
// Shipboard console chrome (NEXUS-7 holo round): the frame is dressed as a
// receiver bezel. A header strip (channel id + LED) sits above a CRT glass
// overlay (glare + scanlines + vignette). BOTH overlays are pointer-events:none
// and the iframe mounts into a dedicated inner element, so nothing interactive
// ever sits over the YouTube controls and the OFFLINE fallback still hides the
// whole frame as before.

import './live-tv.css';

import type { AppContext } from '../../app-context';
import { el, mount } from '../../core/dom';
import { DEFAULT_LIVE_TV_URL } from '../../../shared/constants';

// If the iframe has not fired `load` within this window we assume the embed is
// blocked / offline and show the fallback. YouTube does not expose a reliable
// cross-origin error event, so a load-watchdog is the portable signal.
const LOAD_TIMEOUT_MS = 8000;

/**
 * Normalize any user-provided YouTube source into a player embed URL with
 * autoplay + mute forced on. Accepts:
 *   - a channel id           -> live_stream?channel=...
 *   - a watch url            -> /embed/<id>
 *   - a youtu.be short url   -> /embed/<id>
 *   - a /embed/... url       -> kept as-is (params normalized)
 *   - a /embed/live_stream?channel=... url (CNBC default) -> kept as-is
 * Returns null when the input cannot be turned into an embeddable URL.
 */
export function toEmbedUrl(raw: string | null | undefined): string | null {
  const input = (raw ?? '').trim();
  if (!input) return null;

  // Bare channel id (e.g. "UCvJJ_dzjViJCoLf5uKUTwoA"): no scheme, no slashes.
  if (/^UC[\w-]{20,}$/.test(input)) {
    return withPlaybackParams(
      `https://www.youtube.com/embed/live_stream?channel=${encodeURIComponent(input)}`
    );
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  const host = url.hostname.replace(/^www\./, '').toLowerCase();
  const isYouTube =
    host === 'youtube.com' ||
    host === 'm.youtube.com' ||
    host === 'youtube-nocookie.com' ||
    host === 'youtu.be';
  if (!isYouTube) return null;

  // youtu.be/<id>
  if (host === 'youtu.be') {
    const id = url.pathname.replace(/^\/+/, '').split('/')[0];
    return id ? withPlaybackParams(`https://www.youtube.com/embed/${id}`) : null;
  }

  // Already an embed url (covers /embed/<id> and /embed/live_stream?channel=...).
  if (url.pathname.startsWith('/embed/')) {
    return withPlaybackParams(`https://www.youtube.com${url.pathname}${url.search}`);
  }

  // watch?v=<id>
  if (url.pathname === '/watch') {
    const id = url.searchParams.get('v');
    return id ? withPlaybackParams(`https://www.youtube.com/embed/${id}`) : null;
  }

  // /live/<id> (YouTube's live permalink form)
  if (url.pathname.startsWith('/live/')) {
    const id = url.pathname.slice('/live/'.length).split('/')[0];
    return id ? withPlaybackParams(`https://www.youtube.com/embed/${id}`) : null;
  }

  return null;
}

/** Force autoplay + mute (and a couple of safe defaults) onto an embed URL. */
function withPlaybackParams(embed: string): string {
  let url: URL;
  try {
    url = new URL(embed);
  } catch {
    return embed;
  }
  url.searchParams.set('autoplay', '1');
  url.searchParams.set('mute', '1');
  url.searchParams.set('playsinline', '1');
  // enablejsapi: required for the postMessage unmute commands AND helps the player
  // initialize its config (a missing config is a common Error 153 trigger).
  url.searchParams.set('enablejsapi', '1');
  if (!url.searchParams.has('rel')) url.searchParams.set('rel', '0');
  return url.toString();
}

export interface LiveTvOptions {
  /** Settings field that persists this player's source. */
  settingsKey: 'liveTvUrl' | 'videoTvUrl' | 'monitorUrl';
  /** Source used when nothing is persisted yet. */
  defaultUrl: string;
  /** One-click channel buttons. */
  presets: ReadonlyArray<{ label: string; src: string }>;
  /** Optional bezel-header label (e.g. 'SURVEILLANCE'); default is the receiver chrome. */
  title?: string;
}

// The TV tab's defaults (also used when mountLiveTv is called without options).
// Yahoo embeds reliably; CNBC usually blocks embedding (use Open to watch it on
// YouTube); the rest are 24/7 news channels (bare channel ids resolve to that
// channel's current live stream) that generally allow embeds. Anything that
// blocks falls back to OFFLINE + the pop-out.
const TV_PRESETS: ReadonlyArray<{ label: string; src: string }> = [
  { label: 'Yahoo Finance', src: 'https://www.youtube.com/embed/KQp-e_XQnDE' },
  { label: 'Bloomberg', src: 'UCIALMKvObZNtJ6AmdCLP7Lg' },
  { label: 'CNBC', src: 'UCrp_UI8XtuYfpiqluWLD7Lw' },
  { label: 'Sky News', src: 'UCoMdktPbSTixAyNGwb-UYkQ' },
  { label: 'DW News', src: 'UCknLrEdhRCp1aegoMqRaCZg' },
  { label: 'France 24', src: 'UCQfwfsi5VrQ8yKZ-UWmAEFg' },
  { label: 'Al Jazeera', src: 'UCNye-wNBqNL5ZzHSJj3l8Bg' },
  { label: 'ABC News AU', src: 'UCVgO39Bk5sMo66-6o6Spn6Q' },
  { label: 'LiveNOW FOX', src: 'UCJg9wBPyKMNA5sRDnvzmkdg' }
];

export function mountLiveTv(container: HTMLElement, ctx: AppContext, opts?: LiveTvOptions): void {
  if (!container) return;

  const settingsKey = opts?.settingsKey ?? 'liveTvUrl';
  const defaultUrl = opts?.defaultUrl ?? DEFAULT_LIVE_TV_URL;
  const settingsUrl = ctx?.settings?.[settingsKey];
  const currentRaw = (settingsUrl ?? defaultUrl) || '';

  // --- structure ---------------------------------------------------------
  const frameWrap = el('div', { class: 'live-tv__frame' });

  // Shipboard receiver bezel. Both overlays are decorative and MUST stay
  // pointer-events:none so the YouTube controls inside the iframe remain
  // clickable. The iframe mounts into frameInner (not frameWrap), so it never
  // replaces the overlays, and frameWrap.hidden in showFallback still hides all.
  const chLabel =
    settingsKey === 'monitorUrl' ? 'CH-03' : settingsKey === 'videoTvUrl' ? 'CH-02' : 'CH-01';
  // Default chrome reads as a shipboard receiver; callers (e.g. the MONITOR tab)
  // may override the prefix via opts.title to dress the same player differently.
  const hdPrefix = (opts?.title ?? '').trim() || 'SHIPBOARD RECEIVER';
  const tvOverlay = el('div', { class: 'live-tv__crt', 'aria-hidden': 'true' });
  const tvHeader = el('div', { class: 'live-tv__bezel-hd', 'aria-hidden': 'true' },
    el('span', { class: 'live-tv__led' }),
    el('span', { class: 'live-tv__hd-label', text: hdPrefix + ' // ' + chLabel })
  );
  const frameInner = el('div', { class: 'live-tv__inner' });
  frameWrap.append(tvOverlay, tvHeader, frameInner);

  const fallback = el('div', { class: 'live-tv__fallback', hidden: true });

  const unmuteBtn = el('button', {
    class: 'live-tv__btn live-tv__unmute',
    type: 'button',
    title: 'Unmute the live stream',
    'aria-label': 'Unmute the live stream'
  }, 'Unmute');

  const sourceInput = el('input', {
    class: 'live-tv__source-input',
    type: 'text',
    spellcheck: false,
    autocomplete: 'off',
    placeholder: 'YouTube channel id or live URL',
    'aria-label': 'Live stream source',
    value: currentRaw
  }) as HTMLInputElement;

  const saveBtn = el('button', {
    class: 'live-tv__btn live-tv__save',
    type: 'button',
    title: 'Save this source'
  }, 'Set');

  // Pop the current stream out to the system browser. ALWAYS available, because a
  // stream that disables embedding (e.g. CNBC -> YouTube Error 153) shows YouTube's
  // own error INSIDE the iframe, which we cannot detect cross-origin.
  const popOutBtn = el('button', {
    class: 'live-tv__btn live-tv__popout',
    type: 'button',
    title: 'Open the current stream on YouTube'
  }, 'Open ↗');
  popOutBtn.addEventListener('click', () => {
    const target = toWatchUrl(sourceInput.value.trim() || defaultUrl);
    if (target && ctx?.bridge?.openExternal) void ctx.bridge.openExternal(target);
  });

  const PRESETS = opts?.presets ?? TV_PRESETS;
  const presets = el(
    'div',
    { class: 'live-tv__presets' },
    ...PRESETS.map(({ label, src }) => {
      const b = el('button', { class: 'live-tv__preset', type: 'button', title: 'Switch to ' + label }, label);
      b.addEventListener('click', () => {
        sourceInput.value = src;
        applySource();
      });
      return b;
    })
  );

  const controls = el('div', { class: 'live-tv__controls' },
    unmuteBtn,
    popOutBtn,
    sourceInput,
    saveBtn
  );

  const root = el('div', { class: 'live-tv' },
    frameWrap,
    fallback,
    presets,
    controls
  );

  // --- iframe lifecycle --------------------------------------------------
  let iframe: HTMLIFrameElement | null = null;
  let watchdog: ReturnType<typeof setTimeout> | null = null;

  const clearWatchdog = (): void => {
    if (watchdog != null) {
      clearTimeout(watchdog);
      watchdog = null;
    }
  };

  const showFallback = (rawUrl: string): void => {
    clearWatchdog();
    if (iframe) {
      iframe.remove();
      iframe = null;
    }
    frameWrap.hidden = true;
    unmuteBtn.disabled = true;

    const watchUrl = toWatchUrl(rawUrl);
    const link = el('a', {
      class: 'live-tv__fallback-link',
      href: watchUrl ?? '#',
      rel: 'noopener noreferrer'
    }, 'open on YouTube');
    link.addEventListener('click', (ev) => {
      ev.preventDefault();
      const target = watchUrl ?? rawUrl;
      if (target && ctx?.bridge?.openExternal) {
        void ctx.bridge.openExternal(target);
      }
    });

    mount(fallback,
      el('div', { class: 'live-tv__fallback-icon', 'aria-hidden': 'true' }, 'OFFLINE'),
      el('div', { class: 'live-tv__fallback-msg' }, 'stream offline, ', link),
      el('div', { class: 'live-tv__fallback-sub' }, 'or set a different source below')
    );
    fallback.hidden = false;
  };

  const loadStream = (rawUrl: string): void => {
    const embed = toEmbedUrl(rawUrl);
    if (!embed) {
      showFallback(rawUrl);
      return;
    }

    clearWatchdog();
    fallback.hidden = true;
    frameWrap.hidden = false;
    unmuteBtn.disabled = false;

    const next = el('iframe', {
      class: 'live-tv__iframe',
      src: embed,
      title: 'Live market stream',
      frameborder: '0',
      // enable the YouTube IFrame API postMessage channel for unmute
      allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen',
      allowfullscreen: true,
      referrerpolicy: 'strict-origin-when-cross-origin'
    }) as HTMLIFrameElement;

    next.addEventListener('load', clearWatchdog);
    // Best-effort belt and suspenders to the LOAD_TIMEOUT_MS watchdog, which is the
    // real fallback trigger for cross-origin YouTube (the 'error' event rarely fires there).
    next.addEventListener('error', () => showFallback(rawUrl));

    if (iframe) iframe.remove();
    iframe = next;
    mount(frameInner, next);

    // If the frame never loads (blocked / offline channel), fall back.
    watchdog = setTimeout(() => {
      if (iframe === next) showFallback(rawUrl);
    }, LOAD_TIMEOUT_MS);
  };

  // --- unmute via the YouTube IFrame API postMessage protocol ------------
  unmuteBtn.addEventListener('click', () => {
    const win = iframe?.contentWindow;
    if (!win) return;
    // unMute then setVolume so the click reliably brings audio up.
    const send = (func: string, args: unknown[] = []): void => {
      try {
        win.postMessage(JSON.stringify({ event: 'command', func, args }), '*');
      } catch {
        /* cross-origin postMessage can throw in odd hosts; ignore */
      }
    };
    send('unMute');
    send('setVolume', [100]);
    send('playVideo');
    unmuteBtn.classList.add('is-active');
    unmuteBtn.textContent = 'Unmuted';
  });

  // --- save / change source ----------------------------------------------
  const applySource = (): void => {
    const value = sourceInput.value.trim();
    const rawUrl = value || defaultUrl;

    // reset the unmute affordance for the new stream
    unmuteBtn.classList.remove('is-active');
    unmuteBtn.textContent = 'Unmute';

    loadStream(rawUrl);

    // persist (only if it actually changed). updateSettings is async + may be
    // absent under odd contexts, so guard and swallow rejections.
    if (value && value !== (ctx?.settings?.[settingsKey] ?? '') && ctx?.updateSettings) {
      void ctx.updateSettings({ [settingsKey]: value }).catch(() => {
        /* persistence is best-effort; the stream already switched */
      });
    }
  };

  saveBtn.addEventListener('click', applySource);
  sourceInput.addEventListener('keydown', (ev) => {
    if ((ev as KeyboardEvent).key === 'Enter') {
      ev.preventDefault();
      applySource();
    }
  });

  // --- go ----------------------------------------------------------------
  mount(container, root);
  loadStream(currentRaw);
}

/**
 * Best-effort "open on YouTube" link target derived from the configured source:
 * a channel-live url -> the channel's live page; a video embed -> its watch url;
 * otherwise the original string (or null if empty).
 */
export function toWatchUrl(raw: string | null | undefined): string | null {
  const input = (raw ?? '').trim();
  if (!input) return null;

  if (/^UC[\w-]{20,}$/.test(input)) {
    return `https://www.youtube.com/channel/${encodeURIComponent(input)}/live`;
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return input;
  }

  const host = url.hostname.replace(/^www\./, '').toLowerCase();
  if (host === 'youtu.be') {
    const id = url.pathname.replace(/^\/+/, '').split('/')[0];
    return id ? `https://www.youtube.com/watch?v=${id}` : input;
  }
  if (url.pathname.startsWith('/embed/')) {
    const tail = url.pathname.slice('/embed/'.length);
    if (tail === 'live_stream') {
      const ch = url.searchParams.get('channel');
      return ch
        ? `https://www.youtube.com/channel/${encodeURIComponent(ch)}/live`
        : 'https://www.youtube.com/';
    }
    return tail ? `https://www.youtube.com/watch?v=${tail.split('/')[0]}` : input;
  }
  return input;
}
