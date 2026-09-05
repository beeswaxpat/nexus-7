// Jukebox: free 24/7 internet radio (synthwave + dance/electro). An <audio> element
// streams the selected station; the user switches stations by clicking the list.
// Autoplay with sound is gesture-gated by the browser, so the first click starts it.
// Stream origins are allowlisted in the index.html CSP (media-src). Null-safe.
//
// Visuals: a "deck" header with a spinning disc + ON AIR lamp, a 16-bar equalizer
// that dances while playing, a circular transport button, a neon volume rail, and
// numbered station cards over a synthwave horizon grid. All CSS-animated; the only
// JS-driven UI state is .is-playing on the root and .is-active on the station.

import './jukebox.css';
import type { AppContext } from '../../app-context';
import { el, mount } from '../../core/dom';

interface Station {
  name: string;
  genre: string;
  url: string;
}

// Free, 24/7, no-account streams. All direct stream URLs that <audio> can play,
// re-verified 2026-06-18 to return real audio bytes. Hosts: stream.nightride.fm
// (Nightride FM's Chillsynth/Nightride/Datawave channels) and ice1.somafm.com
// (ambient/electro) · both are allowlisted in the index.html CSP (media-src). Note
// stream.nightride.fm returns 405 on HEAD, so verification used ranged GET (200
// audio/mpeg, real bytes pulled) as the authoritative check. Nightride FM leads
// (CH 01) and is the playBtn nothing-selected fallback. A starred FAVORITE (the
// star on each row, one at a time) is selected on every open ahead of the last
// played station; both are remembered by NAME so reordering never shifts them.
const STATIONS: Station[] = [
  { name: 'Nightride FM', genre: 'Synthwave', url: 'https://stream.nightride.fm/nightride.mp3' },
  { name: 'Chillsynth', genre: 'Chill Synth', url: 'https://stream.nightride.fm/chillsynth.mp3' },
  { name: 'Datawave', genre: 'Darksynth', url: 'https://stream.nightride.fm/datawave.mp3' },
  { name: 'Space Station', genre: 'Space Electronica', url: 'https://ice1.somafm.com/spacestation-128-mp3' },
  { name: 'Synphaera', genre: 'Space Ambient', url: 'https://ice1.somafm.com/synphaera-128-mp3' },
  { name: 'Drone Zone', genre: 'Deep Ambient', url: 'https://ice1.somafm.com/dronezone-128-mp3' },
  { name: 'Groove Salad', genre: 'Downtempo', url: 'https://ice1.somafm.com/groovesalad-128-mp3' },
  { name: 'Lush', genre: 'Chill Vocals', url: 'https://ice1.somafm.com/lush-128-mp3' },
  { name: 'Vaporwaves', genre: 'Vaporwave', url: 'https://ice1.somafm.com/vaporwaves-128-mp3' },
  { name: 'Fluid', genre: 'Liquid Beats', url: 'https://ice1.somafm.com/fluid-128-mp3' },
  { name: 'Beat Blender', genre: 'Deep House', url: 'https://ice1.somafm.com/beatblender-128-mp3' },
  { name: 'DEF CON Radio', genre: 'Electro / Hacker', url: 'https://ice1.somafm.com/defcon-128-mp3' }
];

const EQ_BARS = 16;

const pad2 = (n: number): string => String(n).padStart(2, '0');

// Last station + favorite + volume, remembered across runs in Settings.jukebox
// (the packaged app serves the renderer on a random port, so localStorage is a
// fresh origin every launch and cannot remember anything; it is kept only as a
// same-session cache and the dev:web fallback). Restored on mount WITHOUT
// autoplay: the browser gesture rule still applies, so the deck just shows the
// start station selected and the play button lit.
const MEMORY_KEY = 'nexus7.jukebox';
interface JukeboxMemory {
  /** legacy index (pre-0.1.3); superseded by stationName */
  station?: number;
  stationName?: string;
  favorite?: string;
  volume?: number;
}
const stationIndex = (name: string | undefined): number =>
  typeof name === 'string' ? STATIONS.findIndex((s) => s.name === name) : -1;
function readLocal(): JukeboxMemory {
  try {
    const raw = localStorage.getItem(MEMORY_KEY);
    const m = raw ? (JSON.parse(raw) as JukeboxMemory) : {};
    return m && typeof m === 'object' ? m : {};
  } catch {
    return {};
  }
}
/** Settings.jukebox wins over the local cache (it is the one that survives a restart). */
function readMemory(ctx: AppContext | undefined): JukeboxMemory {
  const local = readLocal();
  const j = ctx?.settings?.jukebox;
  if (!j) return local;
  return {
    ...local,
    stationName: j.station || local.stationName,
    favorite: typeof j.favorite === 'string' ? j.favorite : local.favorite,
    volume: typeof j.volume === 'number' && Number.isFinite(j.volume) ? j.volume : local.volume
  };
}
function writeMemory(ctx: AppContext | undefined, patch: JukeboxMemory): void {
  try {
    localStorage.setItem(MEMORY_KEY, JSON.stringify({ ...readLocal(), ...patch }));
  } catch {
    /* storage unavailable: the settings write below still persists */
  }
  const j: Partial<{ station: string; favorite: string; volume: number }> = {};
  if ('stationName' in patch) j.station = patch.stationName ?? '';
  if ('favorite' in patch) j.favorite = patch.favorite ?? '';
  if (typeof patch.volume === 'number') j.volume = patch.volume;
  if (Object.keys(j).length === 0 || typeof ctx?.updateSettings !== 'function') return;
  const p = ctx.updateSettings({ jukebox: j } as Parameters<typeof ctx.updateSettings>[0]);
  if (p && typeof p.then === 'function') {
    p.then(
      (next) => {
        if (next) ctx.settings = next;
      },
      () => undefined
    );
  }
}

export function mountJukebox(container: HTMLElement, ctx: AppContext): void {
  if (!container) return;

  const remembered = readMemory(ctx);
  const startVolume =
    typeof remembered.volume === 'number' && Number.isFinite(remembered.volume)
      ? Math.max(0, Math.min(100, Math.round(remembered.volume)))
      : 80;

  const audio = el('audio', { preload: 'none' }) as HTMLAudioElement;
  audio.volume = startVolume / 100;

  let current = -1;
  let playing = false;
  // Error auto-recovery state. errorHops counts how many times we have auto-advanced
  // since the LAST manual station/play click; it caps at STATIONS.length - 1 so a wall
  // of dead streams can never loop forever. userPaused suppresses recovery when the
  // user deliberately paused (the 'error' event must not fight a user choice).
  let errorHops = 0;
  let userPaused = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  // --- deck (now playing) ---------------------------------------------------
  const disc = el(
    'div',
    { class: 'jukebox__disc', 'aria-hidden': 'true' },
    el('span', { class: 'jukebox__disc-hub' })
  );
  const nowChannel = el('div', { class: 'jukebox__now-ch', text: 'CH --' });
  const nowName = el('div', { class: 'jukebox__now-name', text: 'Select a station' });
  const nowGenre = el('div', { class: 'jukebox__now-genre', text: 'free 24/7 radio' });
  const onAir = el('span', { class: 'jukebox__onair', text: 'ON AIR' });
  const deck = el(
    'div',
    { class: 'jukebox__deck' },
    disc,
    el('div', { class: 'jukebox__now-text' }, nowChannel, nowName, nowGenre),
    onAir
  );

  // --- equalizer (pure CSS animation; bars get a per-bar delay/duration) -----
  const eq = el(
    'div',
    { class: 'jukebox__eq', 'aria-hidden': 'true' },
    ...Array.from({ length: EQ_BARS }, (_, i) => {
      const bar = el('span', { class: 'jukebox__eq-bar' });
      // de-sync the bars so the wall of bars reads as music, not a metronome
      bar.style.animationDelay = `${(i * 0.37) % 1.1}s`;
      bar.style.animationDuration = `${0.55 + ((i * 0.13) % 0.5)}s`;
      return bar;
    })
  );

  // --- transport --------------------------------------------------------------
  const playBtn = el(
    'button',
    { class: 'jukebox__play', type: 'button', title: 'Play / Pause', 'aria-label': 'Play or pause' },
    el('span', { class: 'jukebox__play-glyph', text: '▶' })
  );
  const vol = el('input', {
    class: 'jukebox__vol',
    type: 'range',
    min: '0',
    max: '100',
    value: '80',
    'aria-label': 'Volume'
  }) as HTMLInputElement;
  const volVal = el('span', { class: 'jukebox__vol-val', text: 'VOL 80' });

  // --- station list ------------------------------------------------------------
  const list = el('div', { class: 'jukebox__list' });
  let favorite = stationIndex(remembered.favorite || undefined);
  const starBtns: HTMLButtonElement[] = [];
  const stationBtns = STATIONS.map((s, i) => {
    const star = el('button', {
      class: 'jukebox__star',
      type: 'button',
      title: 'Star this station: it is selected every time NEXUS-7 opens',
      'aria-label': `Star ${s.name}`,
      'aria-pressed': 'false',
      text: '★'
    });
    starBtns.push(star);
    // the row is a div (not a button) so the star can be a real button inside it
    const b = el(
      'div',
      { class: 'jukebox__station', role: 'button', tabindex: '0', 'aria-label': `Play ${s.name}` },
      el('span', { class: 'jukebox__station-idx', text: pad2(i + 1) }),
      el('span', { class: 'jukebox__station-name', text: s.name }),
      el('span', { class: 'jukebox__station-genre', text: s.genre }),
      star
    );
    b.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.jukebox__star')) return;
      selectStation(i, true);
    });
    b.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selectStation(i, true);
      }
    });
    star.addEventListener('click', (e) => {
      e.stopPropagation();
      favorite = favorite === i ? -1 : i;
      writeMemory(ctx, { favorite: favorite >= 0 ? STATIONS[favorite].name : '' });
      renderStars();
    });
    return b;
  });
  function renderStars(): void {
    stationBtns.forEach((b, i) => {
      const on = i === favorite;
      b.classList.toggle('is-fav', on);
      starBtns[i].setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }
  renderStars();
  list.append(...stationBtns);

  const root = el(
    'div',
    { class: 'jukebox' },
    deck,
    eq,
    el('div', { class: 'jukebox__controls' }, playBtn, vol, volVal),
    list,
    audio
  );
  mount(container, root);

  // --- behavior (unchanged from v1) -------------------------------------------
  function setPlayingUI(on: boolean): void {
    playing = on;
    const glyph = playBtn.querySelector('.jukebox__play-glyph');
    if (glyph) glyph.textContent = on ? '❚❚' : '▶';
    root.classList.toggle('is-playing', on);
  }
  function highlight(): void {
    stationBtns.forEach((b, i) => b.classList.toggle('is-active', i === current));
  }
  function play(): void {
    audio.play().then(() => setPlayingUI(true)).catch(() => setPlayingUI(false));
  }
  // manual=true means the user clicked this station (or the play-button fallback), so
  // the error-recovery guard resets; manual=false is an internal auto-advance hop.
  function selectStation(i: number, autoplay: boolean, manual = true): void {
    if (manual) errorHops = 0;
    userPaused = false;
    current = i;
    highlight();
    const s = STATIONS[i];
    nowChannel.textContent = `CH ${pad2(i + 1)}`;
    nowName.textContent = s.name;
    nowGenre.textContent = s.genre;
    audio.src = s.url;
    if (manual) writeMemory(ctx, { station: i, stationName: s.name });
    if (autoplay) play();
  }

  /** Favorite first, then the last played (by name, legacy index as fallback). */
  function startStation(): number {
    if (favorite >= 0) return favorite;
    const byName = stationIndex(remembered.stationName);
    if (byName >= 0) return byName;
    return typeof remembered.station === 'number' && remembered.station >= 0 && remembered.station < STATIONS.length
      ? remembered.station
      : -1;
  }
  // show the start station selected on mount (no autoplay: the gesture rule)
  {
    const start = startStation();
    if (start >= 0) selectStation(start, false, false);
  }

  playBtn.addEventListener('click', () => {
    if (current < 0) {
      selectStation(Math.max(0, startStation()), true);
      return;
    }
    if (playing) {
      userPaused = true;
      audio.pause();
      setPlayingUI(false);
    } else {
      // manual resume: reset the recovery guard so a fresh user gesture gets a full walk
      errorHops = 0;
      userPaused = false;
      play();
    }
  });
  vol.addEventListener('input', () => {
    const v = Math.max(0, Math.min(100, Number(vol.value)));
    audio.volume = v / 100;
    volVal.textContent = `VOL ${v}`;
  });
  vol.addEventListener('change', () => writeMemory(ctx, { volume: Number(vol.value) }));
  // A station that survives the auto-advance walk is healthy; clear the guard so a
  // later transient blip on it gets a fresh full walk rather than instant give-up.
  audio.addEventListener('playing', () => {
    errorHops = 0;
    setPlayingUI(true);
  });
  audio.addEventListener('pause', () => setPlayingUI(false));
  audio.addEventListener('error', () => {
    setPlayingUI(false);
    // Never recover from a deliberate user pause, and never recover before a station
    // is even selected (CH-01 fallback path owns that).
    if (userPaused || current < 0) return;
    // Bounded auto-advance: walk forward at most STATIONS.length - 1 hops per manual
    // selection. When the budget is spent, surface the existing error and stop.
    if (errorHops >= STATIONS.length - 1) {
      nowGenre.textContent = 'stream error, try another station';
      return;
    }
    errorHops += 1;
    const next = (current + 1) % STATIONS.length;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      // manual=false: this hop must NOT reset the guard or it would loop forever.
      selectStation(next, true, false);
    }, 400);
  });

  const host = container as HTMLElement & { __jukeboxDispose?: () => void };
  host.__jukeboxDispose?.();
  host.__jukeboxDispose = () => {
    try {
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    } catch {
      /* ignore */
    }
  };
}
