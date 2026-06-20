// NIGHT CITY: the ambient noir panel (bottom-right by default). A pure-canvas
// cyberpunk nightscape: layered parallax skyline with lit windows, flickering
// neon signage, three depths of wind-blown rain, drifting fog, blinking rooftop
// beacons, passing spinners (flying cars), a sweeping searchlight, neon storm
// lightning (real bolts + cloud crawlers; rare when green, raging on a dump),
// and a wet-street reflection strip along the bottom.
//
// MARKET ROCKETS + FIREWORKS: when the featured center asset or SPCX pumps 5%+
// in 24h, rockets blast off the rooftops and fly to the moon ("to the moon").
// Independently, any positive 24h change sets off fireworks over the skyline,
// brighter and faster the greener it gets. One intro moon rocket always launches
// a few seconds in so the easter egg is seen at least once. A 5%+ dump still
// brews the neon lightning storm.
//
// This replaced the old rotating "transmissions" quote generator; this panel is
// visual only (assets/quotes.json remains as data for the open-source release).
//
// Perf notes: the three skyline silhouettes are pre-rendered to offscreen canvases
// on resize, so a frame is mostly drawImage + a few hundred line strokes. The rAF
// loop pauses when the document is hidden. DPR capped at 2. The scene recolors with
// the reactive theme by sampling --accent/--accent-2 once a second.

import './night-city.css';
import type { AppContext } from '../../app-context';
import type { AssetQuote } from '../../../shared/types';
import { el, mount } from '../../core/dom';
import { findCenterQuote } from '../../core/center';

// ----------------------------------------------------------------- scene types

interface Drop {
  x: number;
  y: number;
  len: number;
  sp: number;
  layer: 0 | 1 | 2; // 0 = far (thin/slow) .. 2 = near (long/fast)
}

interface Star {
  x: number; // 0..1 of width
  y: number; // 0..1 of sky height
  r: number;
  phase: number;
  speed: number;
}

interface LiveWindow {
  x: number;
  y: number;
  w: number;
  h: number;
  phase: number; // flicker timing offset
  period: number; // seconds between state flips
  on: boolean;
}

interface NeonSign {
  x: number;
  y: number;
  w: number;
  h: number;
  vertical: boolean;
  color: 'accent' | 'accent2' | 'amber';
  phase: number;
  buzzy: boolean; // buzzy signs cut out at random; steady signs just breathe
}

interface Beacon {
  x: number;
  y: number;
  phase: number;
}

interface Spinner {
  x: number;
  y: number;
  vx: number;
  bobPhase: number;
  born: number;
}

/**
 * A rare off-world ship drifting across the upper sky band (Part A). Dark hull,
 * thin neon rim, three sequenced underglow lights, slow ominous crossing. Many
 * cross together in a loose staggered formation; the towers occlude them since
 * the flyover draws before the skyline layers.
 */
interface Ship {
  x: number; // current center x
  y: number; // base center y (bob added per frame)
  vx: number; // px/s, sign sets crossing direction
  hw: number; // hull half-width (px); full hull is 2*hw
  bobPhase: number; // sinusoidal bob offset
  blinkPhase: number; // underglow blink-sequence offset
  tint: string; // neon rim color (accent or accent2)
  beamAt: number; // scene time the scan beam fires (-1 = no beam this crossing)
  active: boolean; // false once it has cleared the far edge
}

interface Ripple {
  x: number;
  born: number;
}

interface Bolt {
  /** The main jagged channel, cloud level downward (strike) or across (crawler). */
  main: Array<{ x: number; y: number }>;
  /** Shorter forks off the main channel. */
  branches: Array<Array<{ x: number; y: number }>>;
  color: string;
  born: number; // scene seconds
  dur: number; // visible lifetime, seconds
  kind: 'strike' | 'crawler';
  /** Center of the soft local sky illumination. */
  cx: number;
  cy: number;
}

interface Rocket {
  /** Launch pad (a rooftop). */
  sx: number;
  sy: number;
  /** Quadratic-bezier control point (vertical ascent bending toward the moon). */
  cx: number;
  cy: number;
  born: number; // scene seconds
  dur: number; // seconds of powered flight to the moon
  mode: 'moon';
  /** Set when the flight ends (lunar arrival); drives the outro. */
  endedAt: number;
}

interface FwShell {
  x: number;
  y: number;
  vx: number;
  vy: number;
  born: number; // scene seconds
  fuse: number; // seconds of ascent before the burst
  hue: 'accent' | 'accent2' | 'amber' | 'gold' | 'white';
  power: number; // 0..1 launch intensity, drives burst size
}

interface FwSpark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  born: number; // scene seconds
  life: number; // seconds before it fades out
  color: string;
  size: number;
  twinkle: number; // phase offset for the shimmer
}

interface SkylineLayer {
  canvas: HTMLCanvasElement;
  liveWindows: LiveWindow[];
  signs: NeonSign[];
  beacons: Beacon[];
  reflectors: Array<{ x: number; w: number; color: 'accent' | 'accent2' | 'amber' }>;
}

// --------------------------------------------------------------- tiny helpers

const rand = (a: number, b: number): number => a + Math.random() * (b - a);
const TAU = Math.PI * 2;

/** Resolve a CSS custom property to a concrete color (with a safe fallback). */
function cssColor(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v.length > 0 ? v : fallback;
}

/** `rgba()` from a hex color + alpha; tolerates already-rgb() strings. */
function withAlpha(color: string, alpha: number): string {
  if (color.startsWith('#')) {
    const hex = color.length === 4
      ? color.slice(1).split('').map((c) => c + c).join('')
      : color.slice(1, 7);
    const n = parseInt(hex, 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }
  const m = color.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const [r, g, b] = m[1].split(',').map((s) => parseFloat(s));
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return color;
}

// ----------------------------------------------------------- skyline building

/**
 * Pre-render one skyline silhouette band into an offscreen canvas and collect its
 * animated features (flickering windows, neon signs, rooftop beacons, reflection
 * sources). depth 0 = far hazy, 2 = near dark + detailed.
 */
function buildSkyline(
  w: number,
  h: number,
  dpr: number,
  depth: 0 | 1 | 2,
  horizonY: number
): SkylineLayer {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * dpr));
  canvas.height = Math.max(1, Math.round(h * dpr));
  const g = canvas.getContext('2d');
  const layer: SkylineLayer = { canvas, liveWindows: [], signs: [], beacons: [], reflectors: [] };
  if (!g) return layer;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);

  // silhouette fill + window palette per depth (far = hazier, near = darkest)
  const fills = ['rgba(18, 24, 48, 0.85)', 'rgba(10, 14, 30, 0.95)', 'rgba(4, 6, 14, 1)'] as const;
  const winAlpha = [0.16, 0.26, 0.42][depth];
  const hMin = [0.18, 0.3, 0.42][depth];
  const hMax = [0.4, 0.58, 0.78][depth];
  const wMin = [10, 16, 24][depth];
  const wMax = [26, 42, 64][depth];

  let x = -rand(0, 12);
  while (x < w + 8) {
    const bw = rand(wMin, wMax);
    const bh = (horizonY - 4) * rand(hMin, hMax);
    const top = horizonY - bh;

    // body (near buildings get a faint cool edge highlight on one side)
    g.fillStyle = fills[depth];
    g.fillRect(x, top, bw, bh);
    if (depth === 2) {
      g.fillStyle = 'rgba(34, 227, 255, 0.05)';
      g.fillRect(x, top, 1.5, bh);
    }

    // rooftop furniture: stepped crowns, antennas (mid/near), beacons (near)
    if (depth > 0 && Math.random() < 0.4) {
      const cw = bw * rand(0.25, 0.5);
      g.fillStyle = fills[depth];
      g.fillRect(x + (bw - cw) / 2, top - rand(3, 9), cw, 10);
    }
    if (depth > 0 && Math.random() < 0.35) {
      const ax = x + bw * rand(0.25, 0.75);
      const ah = rand(8, depth === 2 ? 26 : 16);
      g.strokeStyle = fills[depth];
      g.lineWidth = depth === 2 ? 2 : 1;
      g.beginPath();
      g.moveTo(ax, top);
      g.lineTo(ax, top - ah);
      g.stroke();
      if (depth === 2 && Math.random() < 0.6) {
        layer.beacons.push({ x: ax, y: top - ah - 1, phase: rand(0, TAU) });
      }
    }

    // window grid: most are static (pre-rendered), a few become "live" flickerers
    const cw = depth === 2 ? 3 : 2;
    const ch = depth === 2 ? 4 : 3;
    const gapX = depth === 2 ? 6 : 5;
    const gapY = depth === 2 ? 8 : 6;
    for (let wy = top + 6; wy < horizonY - 8; wy += gapY) {
      for (let wx = x + 3; wx < x + bw - cw - 2; wx += gapX) {
        const lit = Math.random() < (depth === 2 ? 0.3 : 0.22);
        if (!lit) continue;
        const warm = Math.random() < 0.35;
        const a = winAlpha * rand(0.55, 1);
        g.fillStyle = warm ? `rgba(255, 196, 110, ${a})` : `rgba(150, 220, 255, ${a})`;
        g.fillRect(wx, wy, cw, ch);
        if (depth === 2 && Math.random() < 0.05 && layer.liveWindows.length < 26) {
          layer.liveWindows.push({
            x: wx, y: wy, w: cw, h: ch,
            phase: rand(0, 10), period: rand(1.5, 7), on: Math.random() < 0.5
          });
        }
      }
    }

    // neon signage on a few near buildings (animated per-frame, so only recorded)
    if (depth === 2 && bw > 30 && bh > h * 0.3 && Math.random() < 0.45 && layer.signs.length < 5) {
      const vertical = Math.random() < 0.6;
      const colors = ['accent', 'accent2', 'amber'] as const;
      const color = colors[Math.floor(Math.random() * colors.length)];
      const sw = vertical ? rand(4, 6) : rand(14, Math.min(30, bw - 10));
      const sh = vertical ? rand(22, Math.min(54, bh * 0.4)) : rand(5, 8);
      layer.signs.push({
        x: x + rand(4, Math.max(5, bw - sw - 4)),
        y: top + rand(8, Math.max(9, bh * 0.45 - sh)),
        w: sw, h: sh, vertical, color,
        phase: rand(0, TAU), buzzy: Math.random() < 0.5
      });
    }

    // big bright facades reflect on the wet street below
    if (depth === 2 && Math.random() < 0.5) {
      const colors = ['accent', 'accent2', 'amber'] as const;
      layer.reflectors.push({
        x: x + bw / 2,
        w: bw * rand(0.4, 0.8),
        color: colors[Math.floor(Math.random() * colors.length)]
      });
    }

    x += bw + rand(2, depth === 2 ? 10 : 6);
  }

  return layer;
}

// ----------------------------------------------------------------- the scene

/** Mount the animated nightscape onto a canvas. Returns a dispose function. */
function mountScene(canvas: HTMLCanvasElement, ctx?: AppContext): () => void {
  const g = canvas.getContext('2d');
  if (!g) return () => {};

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ULTRA mode (Settings.scenes.ultraCity): the city inverts into synthwave.
  // Violet sky, a striped retro sun where the moon was, hue-shifted skyline, and
  // the wet street becomes a scrolling neon perspective grid. The scene manager
  // remounts this panel when the user toggles it, so a mount-time read is enough.
  const ultraCity = ctx?.settings?.scenes?.ultraCity === true;

  let w = 0;
  let h = 0;
  let horizonY = 0;
  let raf = 0;
  let running = false;
  let last = 0;
  let t = 0; // scene clock, seconds

  let layers: SkylineLayer[] = [];
  let drops: Drop[] = [];
  let stars: Star[] = [];
  let spinners: Spinner[] = [];
  let ships: Ship[] = []; // alien flyover, capped 3, reused across crossings
  let ripples: Ripple[] = [];
  let rockets: Rocket[] = [];
  let fwShells: FwShell[] = [];
  let fwSparks: FwSpark[] = [];
  let nextVolleyAt = Infinity;
  let nextSpinnerAt = rand(2, 6);
  let nextAlienAt = rand(30, 75); // first off-world flyover within the first minute or so (the intro rocket is the early guaranteed sighting)
  let nextLightningAt = rand(20, 60);
  let bolts: Bolt[] = [];
  let searchBase = 0; // x of the searchlight source (picked on resize)

  // --- market rocket triggers (center asset + SPCX, 24h change vs +/-5%) -----
  let pumpActive = false;
  let dumpActive = false;
  /** Featured asset 24h % change; a falling market brews the lightning storm. */
  let centerChange = 0;
  const introAt = rand(6, 10); // guaranteed early sighting, once per session
  let introDone = false;
  let nextMoonAt = Infinity;

  let lastCrypto: AssetQuote[] | null = null;
  let lastStocks: AssetQuote[] | null = null;
  const marketUnsubs: Array<() => void> = [];

  const updateTriggers = (): void => {
    const center = findCenterQuote(lastCrypto, lastStocks);
    const cch = center?.change24h;
    centerChange = typeof cch === 'number' && Number.isFinite(cch) ? cch : 0;
    const watch: Array<AssetQuote | null> = [center];
    if (Array.isArray(lastStocks)) {
      watch.push(
        lastStocks.find((q) => q && typeof q.symbol === 'string' && q.symbol.toUpperCase() === 'SPCX') ?? null
      );
    }
    let up = false;
    let down = false;
    for (const q of watch) {
      const ch = q?.change24h;
      if (typeof ch !== 'number' || !Number.isFinite(ch)) continue;
      if (ch >= 5) up = true;
      if (ch <= -5) down = true;
    }
    // arm the moon cadence on a rising edge so a fresh pump answers quickly
    if (up && !pumpActive) nextMoonAt = t + rand(4, 12);
    pumpActive = up;
    dumpActive = down;
  };

  if (ctx?.store && typeof ctx.store.subscribe === 'function') {
    marketUnsubs.push(
      ctx.store.subscribe('crypto', (c) => {
        lastCrypto = c;
        updateTriggers();
      }),
      ctx.store.subscribe('stocks', (s) => {
        lastStocks = s;
        updateTriggers();
      })
    );
  }
  const onCenterChanged = (): void => updateTriggers();
  window.addEventListener('nexus:center-changed', onCenterChanged);
  marketUnsubs.push(() => window.removeEventListener('nexus:center-changed', onCenterChanged));

  // theme colors, re-sampled on an interval so pump/dump recolors the city
  let accent = '#22e3ff';
  let accent2 = '#ff3df0';
  const amber = '#ffb02e';
  const sampleTheme = (): void => {
    accent = cssColor('--accent', '#22e3ff');
    accent2 = cssColor('--accent-2', '#ff3df0');
  };
  sampleTheme();
  const themeId = window.setInterval(sampleTheme, 1000);

  const signColor = (c: NeonSign['color']): string =>
    c === 'accent' ? accent : c === 'accent2' ? accent2 : amber;

  function resize(): void {
    const r = canvas.getBoundingClientRect();
    w = Math.max(1, Math.round(r.width));
    h = Math.max(1, Math.round(r.height));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    g!.setTransform(dpr, 0, 0, dpr, 0, 0);

    horizonY = Math.round(h * 0.86); // street strip below

    layers = [
      buildSkyline(w, horizonY, dpr, 0, horizonY),
      buildSkyline(w, horizonY, dpr, 1, horizonY),
      buildSkyline(w, horizonY, dpr, 2, horizonY)
    ];
    searchBase = w * rand(0.2, 0.8);

    // rain: density scales with area, split across three depth layers
    const base = Math.round((w * h) / 4200);
    const n = Math.max(30, Math.min(240, reducedMotion ? Math.round(base / 2) : base));
    drops = Array.from({ length: n }, (_, i) => {
      const layer = (i % 3) as 0 | 1 | 2;
      return {
        x: Math.random() * w,
        y: Math.random() * h,
        len: [5, 9, 15][layer] * rand(0.8, 1.3),
        sp: [120, 210, 330][layer] * rand(0.85, 1.2),
        layer
      };
    });

    stars = Array.from({ length: 50 }, () => ({
      x: Math.random(),
      y: Math.random() * 0.5,
      r: rand(0.4, 1.1),
      phase: rand(0, TAU),
      speed: rand(0.4, 1.6)
    }));

    spinners = [];
    ships = []; // in-flight crossings are sized to the old canvas; respawn fresh
    ripples = [];
    rockets = []; // in-flight paths are sized to the old canvas; relaunch fresh
    fwShells = [];
    fwSparks = [];
    nextVolleyAt = Infinity;
  }

  // ------------------------------------------------------------ frame pieces

  function drawSky(): void {
    if (ultraCity) {
      drawSynthSky();
      return;
    }
    const sky = g!.createLinearGradient(0, 0, 0, horizonY);
    sky.addColorStop(0, '#010208');
    sky.addColorStop(0.55, '#040818');
    sky.addColorStop(0.85, '#0a1228');
    sky.addColorStop(1, '#101a36');
    g!.fillStyle = sky;
    g!.fillRect(0, 0, w, horizonY);

    // city light pollution: a broad warm-violet dome low on the horizon
    const dome = g!.createRadialGradient(w * 0.5, horizonY, 0, w * 0.5, horizonY, w * 0.55);
    dome.addColorStop(0, withAlpha(accent2, 0.07));
    dome.addColorStop(0.6, withAlpha(accent, 0.04));
    dome.addColorStop(1, 'rgba(0,0,0,0)');
    g!.fillStyle = dome;
    g!.fillRect(0, 0, w, horizonY);

    for (const s of stars) {
      const a = 0.25 + 0.3 * (0.5 + 0.5 * Math.sin(t * s.speed + s.phase));
      g!.fillStyle = `rgba(190, 215, 255, ${a})`;
      g!.fillRect(s.x * w, s.y * horizonY, s.r, s.r);
    }

    // the moon: high, hazy, partially veiled
    const mx = w * 0.76;
    const my = horizonY * 0.2;
    const mr = Math.max(10, Math.min(w, h) * 0.055);
    const halo = g!.createRadialGradient(mx, my, mr * 0.4, mx, my, mr * 4);
    halo.addColorStop(0, 'rgba(215, 228, 255, 0.16)');
    halo.addColorStop(1, 'rgba(215, 228, 255, 0)');
    g!.fillStyle = halo;
    g!.fillRect(mx - mr * 4, my - mr * 4, mr * 8, mr * 8);
    g!.fillStyle = 'rgba(225, 234, 252, 0.85)';
    g!.beginPath();
    g!.arc(mx, my, mr, 0, TAU);
    g!.fill();
    g!.fillStyle = 'rgba(150, 165, 200, 0.3)'; // craters, vaguely
    g!.beginPath();
    g!.arc(mx - mr * 0.3, my - mr * 0.15, mr * 0.22, 0, TAU);
    g!.arc(mx + mr * 0.25, my + mr * 0.3, mr * 0.15, 0, TAU);
    g!.fill();
  }

  /** ULTRA sky: violet gradient, hot magenta horizon, striped retro sun. */
  function drawSynthSky(): void {
    const sky = g!.createLinearGradient(0, 0, 0, horizonY);
    sky.addColorStop(0, '#0d0118');
    sky.addColorStop(0.5, '#1c0533');
    sky.addColorStop(0.82, '#3a0a55');
    sky.addColorStop(1, '#6d1260');
    g!.fillStyle = sky;
    g!.fillRect(0, 0, w, horizonY);

    for (const s of stars) {
      const a = 0.25 + 0.3 * (0.5 + 0.5 * Math.sin(t * s.speed + s.phase));
      g!.fillStyle = `rgba(255, 205, 245, ${a})`;
      g!.fillRect(s.x * w, s.y * horizonY, s.r, s.r);
    }

    // the retro sun: gold at the top melting into hot pink, sliced by widening
    // horizontal gaps across the lower half (drawn as 1.5px disc rows)
    const mx = w * 0.76;
    const my = horizonY * 0.26;
    const mr = Math.max(16, Math.min(w, h) * 0.095);
    const halo = g!.createRadialGradient(mx, my, mr * 0.4, mx, my, mr * 3.4);
    halo.addColorStop(0, 'rgba(255, 80, 175, 0.22)');
    halo.addColorStop(1, 'rgba(255, 80, 175, 0)');
    g!.fillStyle = halo;
    g!.fillRect(mx - mr * 3.4, my - mr * 3.4, mr * 6.8, mr * 6.8);
    for (let yy = -mr; yy < mr; yy += 1.5) {
      const frac = (yy + mr) / (2 * mr); // 0 top .. 1 bottom
      if (frac > 0.5) {
        const k = (frac - 0.5) / 0.5;
        const period = 9;
        const gap = 1.5 + k * 4.5; // gaps thicken downward
        if ((yy + mr) % period < gap) continue;
      }
      const half = Math.sqrt(Math.max(0, mr * mr - yy * yy));
      const gc = Math.round(214 - frac * 150);
      const bc = Math.round(96 + frac * 84);
      g!.fillStyle = `rgb(255, ${gc}, ${bc})`;
      g!.fillRect(mx - half, my + yy, half * 2, 1.5);
    }
  }

  function drawFog(yFrac: number, alpha: number, speed: number, phase: number): void {
    const y = horizonY * yFrac;
    const bandH = h * 0.07;
    const off = ((t * speed + phase) % (w * 2)) - w;
    for (const ox of [off, off + w * 2]) {
      const fog = g!.createLinearGradient(0, y - bandH, 0, y + bandH);
      fog.addColorStop(0, 'rgba(70, 90, 130, 0)');
      fog.addColorStop(0.5, `rgba(70, 90, 130, ${alpha})`);
      fog.addColorStop(1, 'rgba(70, 90, 130, 0)');
      g!.fillStyle = fog;
      g!.fillRect(ox - w * 0.5, y - bandH, w * 2, bandH * 2);
    }
  }

  function drawSearchlight(): void {
    const angle = -Math.PI / 2 + Math.sin(t * 0.21) * 0.55; // slow sweep
    const sx = searchBase;
    const sy = horizonY * 0.995;
    const len = h * 1.15;
    const half = 0.045; // beam half-angle
    const ex = sx + Math.cos(angle) * len;
    const ey = sy + Math.sin(angle) * len;
    const grad = g!.createLinearGradient(sx, sy, ex, ey);
    grad.addColorStop(0, 'rgba(190, 220, 255, 0.10)');
    grad.addColorStop(1, 'rgba(190, 220, 255, 0)');
    g!.save();
    g!.globalCompositeOperation = 'lighter';
    g!.fillStyle = grad;
    g!.beginPath();
    g!.moveTo(sx, sy);
    g!.lineTo(sx + Math.cos(angle - half) * len, sy + Math.sin(angle - half) * len);
    g!.lineTo(sx + Math.cos(angle + half) * len, sy + Math.sin(angle + half) * len);
    g!.closePath();
    g!.fill();
    g!.restore();
  }

  function drawSpinners(dt: number): void {
    if (!reducedMotion && t >= nextSpinnerAt && spinners.length < 3) {
      const ltr = Math.random() < 0.5;
      spinners.push({
        x: ltr ? -20 : w + 20,
        y: horizonY * rand(0.12, 0.45),
        vx: (ltr ? 1 : -1) * rand(22, 60),
        bobPhase: rand(0, TAU),
        born: t
      });
      nextSpinnerAt = t + rand(5, 13);
    }
    spinners = spinners.filter((s) => s.x > -40 && s.x < w + 40);
    for (const s of spinners) {
      s.x += s.vx * dt;
      const y = s.y + Math.sin(t * 0.9 + s.bobPhase) * 2.5;
      const dir = Math.sign(s.vx);
      // light trail
      const trail = g!.createLinearGradient(s.x - dir * 26, y, s.x, y);
      trail.addColorStop(0, 'rgba(255, 90, 90, 0)');
      trail.addColorStop(1, 'rgba(255, 90, 90, 0.30)');
      g!.strokeStyle = trail;
      g!.lineWidth = 1.2;
      g!.beginPath();
      g!.moveTo(s.x - dir * 26, y);
      g!.lineTo(s.x, y);
      g!.stroke();
      // rear strobe (red, blinking) + forward lamp (white)
      const blink = Math.sin(t * 7 + s.bobPhase) > 0 ? 0.9 : 0.25;
      g!.fillStyle = `rgba(255, 80, 80, ${blink})`;
      g!.fillRect(s.x - dir * 3, y - 1, 2, 2);
      g!.fillStyle = 'rgba(235, 245, 255, 0.9)';
      g!.fillRect(s.x + dir * 2, y - 1, 2.4, 2.4);
    }
  }

  // ----------------------------------------------------------- alien flyover
  // Rare off-world traffic crossing the upper sky: a loose staggered formation of
  // 1 to 3 dark saucer hulls, thin neon rims, sequenced underglow, drifting slow
  // and ominous. Scheduled like the lightning (a treat, every 7 to 17 min) and
  // moved like the spinners (full-width sky crossing). Drawn before the skyline so
  // the towers occlude them. Off-world flavor: no flash, low alphas.

  const ALIEN_MARGIN = 60; // px of off-screen runway on each side of a crossing

  /** Spawn a flyover now: normally a single UFO; a 2-3 ship formation is a rare treat. n clamps 1..3. */
  function spawnAlienFlyover(n?: number): void {
    let count: number;
    if (typeof n === 'number' && Number.isFinite(n)) {
      count = Math.max(1, Math.min(3, Math.round(n)));
    } else if (ultraCity) {
      const r = Math.random(); // ULTRA: mostly 1, sometimes 2. 1 ship 55%, 2 ships 35%, 3 ships 10%
      count = r < 0.55 ? 1 : r < 0.9 ? 2 : 3;
    } else {
      const r = Math.random(); // NORMAL: almost always a single UFO. 1 ship 85%, 2 ships 12%, 3 ships 3%
      count = r < 0.85 ? 1 : r < 0.97 ? 2 : 3;
    }
    const ltr = Math.random() < 0.5;
    const dir = ltr ? 1 : -1;
    const span = w + ALIEN_MARGIN * 2; // distance to traverse, edge to edge
    const speed = span / rand(14, 22); // ~14-22 s for the full slow crossing
    // hull half-width scales with the canvas, clamped to the spec's 26..44 px range
    const scale = Math.min(1, Math.max(0.55, Math.min(w, h) / 520));
    const lead = ltr ? -ALIEN_MARGIN : w + ALIEN_MARGIN; // lead-ship entry x
    const baseY = horizonY * rand(0.08, 0.34); // the upper sky band
    const beamShip = Math.random() < 0.5 ? Math.floor(Math.random() * count) : -1;

    ships.length = 0; // reuse the module array (capped 3, no per-frame alloc)
    for (let i = 0; i < count; i++) {
      const hw = (rand(26, 44) * scale) / 2;
      // stagger: each follower trails behind and rides a slightly different lane
      const back = i * rand(70, 120);
      const x = lead - dir * back;
      const y = baseY + (i === 0 ? 0 : rand(-14, 14));
      ships.push({
        x,
        y,
        vx: dir * speed,
        hw,
        bobPhase: rand(0, TAU),
        blinkPhase: rand(0, TAU),
        tint: Math.random() < 0.6 ? accent : accent2,
        beamAt: i === beamShip ? t + rand(2, 6) : -1,
        active: true
      });
    }
  }

  /** Draw one ship at (cx, cy). Allocation-free apart from the small glow gradients. */
  function drawShip(s: Ship, cx: number, cy: number): void {
    const dir = Math.sign(s.vx) || 1;
    const hw = s.hw;
    const hh = hw * 0.42; // hull half-height (a flattened lens)
    // ULTRA brightens the neon rims / underglow so the hulls read even when a tower
    // partly occludes them; NORMAL keeps the subtle off-world alphas (mul = 1).
    const lum = ultraCity ? 1.8 : 1;

    // faint underglow halo beneath the hull (soft, low alpha, no flash)
    const halo = g!.createRadialGradient(cx, cy + hh * 0.6, 0, cx, cy + hh * 0.6, hw * 1.5);
    halo.addColorStop(0, withAlpha(s.tint, 0.09 * lum));
    halo.addColorStop(1, withAlpha(s.tint, 0));
    g!.fillStyle = halo;
    g!.fillRect(cx - hw * 1.6, cy - hh, hw * 3.2, hh * 3.4);

    // short light-trail behind the hull (fades from the rim color to nothing)
    const tx = cx - dir * hw * 2.1;
    const trail = g!.createLinearGradient(tx, cy, cx, cy);
    if (dir > 0) {
      trail.addColorStop(0, withAlpha(s.tint, 0));
      trail.addColorStop(1, withAlpha(s.tint, 0.22 * lum));
    } else {
      trail.addColorStop(0, withAlpha(s.tint, 0.22 * lum));
      trail.addColorStop(1, withAlpha(s.tint, 0));
    }
    g!.strokeStyle = trail;
    g!.lineWidth = 1.1;
    g!.beginPath();
    g!.moveTo(tx, cy);
    g!.lineTo(cx, cy);
    g!.stroke();

    // dark saucer hull: near-black fill, thin neon rim stroke
    g!.fillStyle = 'rgba(3, 5, 11, 0.95)';
    g!.beginPath();
    g!.ellipse(cx, cy, hw, hh, 0, 0, TAU);
    g!.fill();
    g!.strokeStyle = withAlpha(s.tint, Math.min(1, 0.6 * lum));
    g!.lineWidth = 1;
    g!.beginPath();
    g!.ellipse(cx, cy, hw, hh, 0, 0, TAU);
    g!.stroke();

    // low dome / fin riding the hull's top, same dark fill + faint rim
    const domeW = hw * 0.5;
    const domeH = hh * 1.3;
    g!.fillStyle = 'rgba(4, 6, 13, 0.95)';
    g!.beginPath();
    g!.ellipse(cx, cy - hh * 0.45, domeW, domeH, 0, Math.PI, TAU);
    g!.fill();
    g!.strokeStyle = withAlpha(s.tint, Math.min(1, 0.45 * lum));
    g!.lineWidth = 0.8;
    g!.beginPath();
    g!.ellipse(cx, cy - hh * 0.45, domeW, domeH, 0, Math.PI, TAU);
    g!.stroke();

    // three underglow running lights blinking in sequence along the belly
    for (let i = 0; i < 3; i++) {
      const lx = cx + (i - 1) * hw * 0.55;
      const ly = cy + hh * 0.7;
      // each light leads the next by a third of the cycle -> a running blink
      const blink = 0.5 + 0.5 * Math.sin(t * 5 + s.blinkPhase + i * (TAU / 3));
      const a = Math.min(1, (0.2 + 0.7 * Math.max(0, blink)) * lum);
      g!.fillStyle = withAlpha(s.tint, a);
      g!.beginPath();
      g!.arc(lx, ly, 1.2, 0, TAU);
      g!.fill();
    }

    // optional brief scan beam: thin, angled down, very low alpha, ~1.5 s
    if (s.beamAt >= 0 && t >= s.beamAt && t < s.beamAt + 1.5) {
      const bk = (t - s.beamAt) / 1.5; // 0..1 over the beam's life
      const env = Math.sin(bk * Math.PI); // fade in then out
      const ba = 0.1 * env; // capped at <= 0.10
      const beamLen = horizonY * 0.5;
      const ang = Math.PI / 2 - dir * 0.32; // angled down, leaning forward
      const ex = cx + Math.cos(ang) * beamLen;
      const ey = cy + Math.sin(ang) * beamLen;
      const beam = g!.createLinearGradient(cx, cy, ex, ey);
      beam.addColorStop(0, withAlpha(s.tint, ba));
      beam.addColorStop(1, withAlpha(s.tint, 0));
      g!.strokeStyle = beam;
      g!.lineWidth = 1.4;
      g!.beginPath();
      g!.moveTo(cx, cy + hh * 0.6);
      g!.lineTo(ex, ey);
      g!.stroke();
    }
  }

  function drawAlienShips(dt: number): void {
    if (reducedMotion) return; // ships never spawn under reduced motion

    // rare scheduler (lightning model): fire a flyover, reschedule on completion
    if (t >= nextAlienAt && ships.length === 0) {
      spawnAlienFlyover();
    }

    if (ships.length === 0) return;

    let allCleared = true;
    g!.save();
    g!.lineJoin = 'round';
    g!.lineCap = 'round';
    for (const s of ships) {
      s.x += s.vx * dt;
      const dir = Math.sign(s.vx) || 1;
      // off the far edge once the whole hull has cleared the margin
      if (dir > 0 ? s.x - s.hw > w + ALIEN_MARGIN : s.x + s.hw < -ALIEN_MARGIN) {
        s.active = false;
        continue;
      }
      allCleared = false;
      const cy = s.y + Math.sin(t * 0.5 + s.bobPhase) * 2.5; // slow +-2.5 px bob
      drawShip(s, s.x, cy);
    }
    g!.restore();

    // crossing done: clear the array and schedule the next rare window
    if (allCleared) {
      ships.length = 0;
      // catchable but still special: ULTRA ~1.5-3.7 min, NORMAL ~2.5-6 min
      nextAlienAt = t + (ultraCity ? rand(90, 220) : rand(150, 360));
    }
  }

  // ------------------------------------------------------------ market rockets

  const ROCKET_OUTRO = 1.15; // seconds of lunar-arrival glow

  // fireworks: skyline celebration that scales with how green the center asset is
  const FW_MAX_SHELLS = 6;
  const FW_MAX_SPARKS = 320;
  const FW_GRAVITY = 60; // px/s^2, pulls shells and sparks back down
  const FW_DRAG = 0.86; // per-second velocity retention, applied as pow(FW_DRAG, dt)
  const FW_SHELL_ASCENT = [0.55, 0.95]; // seconds of rise before the burst
  const FW_SPARK_LIFE = [0.9, 1.7]; // seconds a spark lives

  /** Quadratic bezier component: start a, control c, end b, progress u in [0,1]. */
  function bez(a: number, c: number, b: number, u: number): number {
    const v = 1 - u;
    return v * v * a + 2 * v * u * c + u * u * b;
  }

  function spawnRocket(): void {
    if (rockets.length >= 2) return;
    const mx = w * 0.76;
    const my = horizonY * 0.2;
    const sx = w * rand(0.1, 0.58); // launch from the city, left of the moon
    const sy = horizonY * rand(0.52, 0.8); // a rooftop
    rockets.push({
      sx,
      sy,
      // control point: nearly straight up off the pad, bending toward the moon late
      cx: sx + (mx - sx) * 0.18,
      cy: Math.max(6, my - h * 0.2),
      born: t,
      dur: rand(6.5, 9.5),
      mode: 'moon',
      endedAt: -1
    });
  }

  // dev-only QA hook: lets dev:web force a rocket without waiting on market data
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).__ncitySpawn = () => spawnRocket();
    (window as unknown as Record<string, unknown>).__ncityFireworks = (change?: number) => {
      if (typeof change === 'number') centerChange = change;
      else if (centerChange <= 0.1) centerChange = 8;
      launchVolley();
    };
    (window as unknown as Record<string, unknown>).__ncityBolt = (change?: number) => {
      if (typeof change === 'number') centerChange = change;
      spawnBolt();
    };
    (window as unknown as Record<string, unknown>).__ncityAlien = (n?: number) => spawnAlienFlyover(n);
    (window as unknown as Record<string, unknown>).__ncityResize = () => resize();
    (window as unknown as Record<string, unknown>).__ncityDebug = () => ({
      t,
      running,
      reducedMotion,
      w,
      h,
      horizonY,
      rockets: rockets.map((r) => ({ ...r })),
      fwShells: fwShells.length,
      fwSparks: fwSparks.length,
      nextVolleyAt
    });
  }

  function drawRockets(dt: number): void {
    void dt;
    if (reducedMotion) return;

    // spawn: one guaranteed intro moon rocket early in the session, then pump
    // cadence. Pumps answer often ("to the moon").
    if (!introDone && t >= introAt) {
      spawnRocket();
      introDone = true;
    }
    if (pumpActive && t >= nextMoonAt) {
      spawnRocket();
      nextMoonAt = t + rand(35, 75);
    }

    if (rockets.length === 0) return;
    const mx = w * 0.76;
    const my = horizonY * 0.2;
    rockets = rockets.filter((r) => r.endedAt < 0 || t - r.endedAt < ROCKET_OUTRO);

    for (const r of rockets) {
      const uRaw = Math.min(1, (t - r.born) / r.dur);
      const u = uRaw * uRaw * (3 - 2 * uRaw); // smoothstep: slow lift, gentle cruise
      const p = u;
      if (r.endedAt < 0 && u >= 1) r.endedAt = t;

      const x = bez(r.sx, r.cx, mx, p);
      const y = bez(r.sy, r.cy, my, p);

      // ---- outro: touchdown glow on the moon ---------------------------------
      if (r.endedAt >= 0) {
        const k = Math.min(1, (t - r.endedAt) / ROCKET_OUTRO); // 0..1
        g!.save();
        g!.globalCompositeOperation = 'lighter';
        // made it: a brief gold halo + expanding ring on the moon
        const glow = g!.createRadialGradient(mx, my, 0, mx, my, 20);
        glow.addColorStop(0, `rgba(255, 226, 140, ${0.5 * (1 - k)})`);
        glow.addColorStop(1, 'rgba(255, 226, 140, 0)');
        g!.fillStyle = glow;
        g!.beginPath();
        g!.arc(mx, my, 20, 0, TAU);
        g!.fill();
        g!.strokeStyle = `rgba(255, 226, 140, ${0.6 * (1 - k)})`;
        g!.lineWidth = 1.1;
        g!.beginPath();
        g!.arc(mx, my, 3 + k * 14, 0, TAU);
        g!.stroke();
        g!.restore();
        continue;
      }

      // ---- exhaust trail: the last stretch of flown path, fading out ---------
      g!.save();
      g!.globalCompositeOperation = 'lighter';
      const steps = 8;
      const pTail = Math.max(0, p - 0.2);
      let px = bez(r.sx, r.cx, mx, pTail);
      let py = bez(r.sy, r.cy, my, pTail);
      for (let i = 1; i <= steps; i++) {
        const q = pTail + ((p - pTail) * i) / steps;
        const qx = bez(r.sx, r.cx, mx, q);
        const qy = bez(r.sy, r.cy, my, q);
        const fade = i / steps; // brighter near the ship
        g!.strokeStyle = `rgba(160, 215, 255, ${0.05 + 0.2 * fade})`;
        g!.lineWidth = 0.6 + fade * 1.1;
        g!.beginPath();
        g!.moveTo(px, py);
        g!.lineTo(qx, qy);
        g!.stroke();
        px = qx;
        py = qy;
      }

      // ---- the ship (shrinks with distance) -----------------------------------
      // heading from the bezier derivative; local +y is "behind" the rocket
      const dx = 2 * (1 - p) * (r.cx - r.sx) + 2 * p * (mx - r.cx);
      const dy = 2 * (1 - p) * (r.cy - r.sy) + 2 * p * (my - r.cy);
      const s = 1 - 0.45 * p;
      g!.translate(x, y);
      g!.rotate(Math.atan2(dy, dx) + Math.PI / 2);
      g!.scale(s, s);
      // flame: flickering two-tone plume
      const flick = 0.75 + 0.5 * (0.5 + 0.5 * Math.sin(t * 23 + r.born * 7));
      g!.fillStyle = 'rgba(255, 170, 60, 0.85)';
      g!.beginPath();
      g!.moveTo(-1.7, 5);
      g!.lineTo(0, 5 + 8 * flick);
      g!.lineTo(1.7, 5);
      g!.closePath();
      g!.fill();
      g!.fillStyle = 'rgba(255, 245, 215, 0.9)';
      g!.beginPath();
      g!.moveTo(-0.8, 5);
      g!.lineTo(0, 5 + 4.5 * flick);
      g!.lineTo(0.8, 5);
      g!.closePath();
      g!.fill();
      // body + nose + fins + porthole
      g!.fillStyle = 'rgba(215, 226, 243, 0.95)';
      g!.fillRect(-2, -5, 4, 10);
      g!.fillStyle = withAlpha(accent2, 0.95);
      g!.beginPath();
      g!.moveTo(-2, -5);
      g!.lineTo(0, -10);
      g!.lineTo(2, -5);
      g!.closePath();
      g!.fill();
      g!.beginPath(); // fins
      g!.moveTo(-2, 5);
      g!.lineTo(-4, 7);
      g!.lineTo(-2, 2);
      g!.moveTo(2, 5);
      g!.lineTo(4, 7);
      g!.lineTo(2, 2);
      g!.closePath();
      g!.fill();
      g!.fillStyle = withAlpha(accent, 0.95);
      g!.beginPath();
      g!.arc(0, -1.5, 1.1, 0, TAU);
      g!.fill();
      g!.restore();
    }
  }

  // ------------------------------------------------------------ fireworks
  // Independent of the rockets: the greener the featured asset is, the bigger and
  // more frequent the volleys. Driven entirely by the existing centerChange var.

  /** Celebration intensity 0..1: idle below +0.1%, full at +15%, then capped. */
  function fwLevel(): number {
    if (centerChange <= 0.1) return 0;
    return Math.min(1, (centerChange - 0.1) / 14.9);
  }

  /** Stand down when red/flat; arm a first volley on the rising edge into green. */
  function maybeArmVolley(): void {
    const L = fwLevel();
    if (L <= 0) {
      nextVolleyAt = Infinity;
      return;
    }
    if (nextVolleyAt === Infinity && L > 0) {
      nextVolleyAt = t + rand(0.3, 1.2);
    }
  }

  /** Fire a clutch of shells off the skyline, then schedule the next volley. */
  function launchVolley(): void {
    const L = fwLevel();
    const shells = Math.min(1 + Math.round(L * 2), FW_MAX_SHELLS - fwShells.length);
    for (let i = 0; i < shells; i++) {
      const sx = w * rand(0.08, 0.92);
      const sy = horizonY * rand(0.55, 0.82);
      const targetY = horizonY * (0.5 - 0.32 * L) * rand(0.9, 1.1);
      const fuse = rand(FW_SHELL_ASCENT[0], FW_SHELL_ASCENT[1]);
      const rise = targetY - sy;
      // vy chosen so the shell coasts to targetY exactly when the fuse burns out
      const vy = rise / fuse - 0.5 * FW_GRAVITY * fuse;
      const vx = rand(-12, 12);
      const r = Math.random();
      const hue: FwShell['hue'] =
        r < 0.34 ? 'accent' : r < 0.55 ? 'accent2' : r < 0.74 ? 'amber' : r < 0.92 ? 'gold' : 'white';
      fwShells.push({ x: sx, y: sy, vx, vy, born: t, fuse, hue, power: L });
    }
    nextVolleyAt = t + (4.5 - 3.4 * L) * rand(0.85, 1.15);
  }

  function fwColor(hue: FwShell['hue']): string {
    return hue === 'accent'
      ? accent
      : hue === 'accent2'
        ? accent2
        : hue === 'amber'
          ? amber
          : hue === 'gold'
            ? '#ffd76b'
            : '#eef7ff';
  }

  /** Detonate a shell into a ring of sparks (respecting the global spark cap). */
  function burst(shell: FwShell): void {
    const L = shell.power;
    const room = FW_MAX_SPARKS - fwSparks.length;
    if (room <= 0) return;
    const count = Math.min(Math.round(26 + 44 * L), room);
    const base = fwColor(shell.hue);
    for (let i = 0; i < count; i++) {
      const speed = (70 + 80 * L) * rand(0.6, 1.05);
      const angle = (i / count) * TAU + rand(-0.08, 0.08);
      const color = Math.random() < 0.12 ? '#fff7e6' : base;
      const life = rand(FW_SPARK_LIFE[0], FW_SPARK_LIFE[1]) * (0.5 + 0.5 * L) * rand(0.7, 1);
      fwSparks.push({
        x: shell.x,
        y: shell.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        born: t,
        life,
        color,
        size: rand(1, 2.4),
        twinkle: rand(0, TAU)
      });
    }
  }

  function drawFireworks(dt: number): void {
    if (reducedMotion) return;

    maybeArmVolley();
    if (nextVolleyAt !== Infinity && t >= nextVolleyAt) launchVolley();

    // integrate shells: gravity-only ascent; detonate when the fuse burns out
    if (fwShells.length > 0) {
      const survivors: FwShell[] = [];
      for (const s of fwShells) {
        s.vy += FW_GRAVITY * dt;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        if (t - s.born >= s.fuse) burst(s);
        else survivors.push(s);
      }
      fwShells = survivors;
    }

    // integrate sparks: gravity + air drag; drop them at end of life
    if (fwSparks.length > 0) {
      const retain = Math.pow(FW_DRAG, dt);
      const survivors: FwSpark[] = [];
      for (const p of fwSparks) {
        p.vy += FW_GRAVITY * dt;
        p.vx *= retain;
        p.vy *= retain;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (t - p.born < p.life) survivors.push(p);
      }
      fwSparks = survivors;
    }

    if (fwShells.length === 0 && fwSparks.length === 0) return;

    g!.save();
    g!.globalCompositeOperation = 'lighter';

    // rising shells: a short hot trail plus a white-hot head
    for (const s of fwShells) {
      const flick = 0.7 + 0.3 * Math.sin(t * 30 + s.born * 11);
      const c = fwColor(s.hue);
      g!.strokeStyle = withAlpha(c, 0.25 * flick);
      g!.lineWidth = 1;
      g!.beginPath();
      g!.moveTo(s.x, s.y);
      g!.lineTo(s.x - s.vx * 0.03, s.y - s.vy * 0.03);
      g!.stroke();
      g!.fillStyle = withAlpha('#fff7e6', 0.9 * flick);
      g!.fillRect(s.x - 0.8, s.y - 0.8, 1.6, 1.6);
    }

    // burst sparks: fading, twinkling embers
    for (const p of fwSparks) {
      const age = (t - p.born) / p.life; // 0..1
      const fade = (1 - age) * (1 - age);
      const tw = 0.75 + 0.25 * Math.sin(t * 18 + p.twinkle);
      const alpha = fade * tw;
      if (alpha <= 0.02) continue;
      g!.fillStyle = withAlpha(p.color, alpha);
      g!.fillRect(p.x, p.y, p.size, p.size);
    }

    g!.restore();
  }

  function drawLayerExtras(layer: SkylineLayer): void {
    // flickering windows
    for (const lw of layer.liveWindows) {
      const cycle = Math.sin((t + lw.phase) * (TAU / lw.period));
      lw.on = cycle > -0.2;
      if (!lw.on) {
        g!.fillStyle = 'rgba(4, 6, 14, 1)'; // paint it out (window goes dark)
        g!.fillRect(lw.x - 0.5, lw.y - 0.5, lw.w + 1, lw.h + 1);
      } else {
        const a = 0.3 + 0.18 * cycle;
        g!.fillStyle = `rgba(150, 220, 255, ${a})`;
        g!.fillRect(lw.x, lw.y, lw.w, lw.h);
      }
    }
    // neon signs: breathe, and the buzzy ones cut out hard at pseudo-random
    for (const sign of layer.signs) {
      const breathe = 0.62 + 0.25 * Math.sin(t * 1.7 + sign.phase);
      let a = breathe;
      if (sign.buzzy) {
        const buzz = Math.sin(t * 13 + sign.phase) * Math.sin(t * 0.47 + sign.phase * 2);
        if (buzz > 0.93) a *= 0.15; // hard dropout
      }
      const c = signColor(sign.color);
      g!.save();
      g!.shadowColor = withAlpha(c, Math.min(1, a));
      g!.shadowBlur = 9;
      g!.fillStyle = withAlpha(c, Math.min(1, a));
      g!.fillRect(sign.x, sign.y, sign.w, sign.h);
      // segment gaps make a bar read as lettering
      g!.fillStyle = 'rgba(4, 6, 14, 0.9)';
      if (sign.vertical) {
        for (let yy = sign.y + 4; yy < sign.y + sign.h - 2; yy += 7) {
          g!.fillRect(sign.x, yy, sign.w, 1.6);
        }
      } else {
        for (let xx = sign.x + 4; xx < sign.x + sign.w - 2; xx += 6) {
          g!.fillRect(xx, sign.y, 1.6, sign.h);
        }
      }
      g!.restore();
    }
    // rooftop aviation beacons (slow red pulse)
    for (const b of layer.beacons) {
      const a = 0.25 + 0.65 * (0.5 + 0.5 * Math.sin(t * 1.4 + b.phase));
      g!.save();
      g!.shadowColor = `rgba(255, 70, 70, ${a})`;
      g!.shadowBlur = 6;
      g!.fillStyle = `rgba(255, 70, 70, ${a})`;
      g!.beginPath();
      g!.arc(b.x, b.y, 1.4, 0, TAU);
      g!.fill();
      g!.restore();
    }
  }

  /** ULTRA street: the scrolling neon perspective grid. */
  function drawGridStreet(): void {
    const streetH = h - horizonY;
    const floor = g!.createLinearGradient(0, horizonY, 0, h);
    floor.addColorStop(0, '#170230');
    floor.addColorStop(1, '#05010d');
    g!.fillStyle = floor;
    g!.fillRect(0, horizonY, w, streetH);

    g!.save();
    g!.globalCompositeOperation = 'lighter';
    // hot horizon edge
    g!.shadowColor = 'rgba(255, 61, 240, 0.9)';
    g!.shadowBlur = 8;
    g!.fillStyle = 'rgba(255, 61, 240, 0.55)';
    g!.fillRect(0, horizonY, w, 1.4);
    g!.shadowBlur = 0;

    g!.strokeStyle = 'rgba(255, 61, 240, 0.55)';
    g!.lineWidth = 1;
    // horizontal lines accelerate toward the viewer (perspective scroll)
    const phase = (t * 0.45) % 1;
    for (let j = 0; j < 9; j++) {
      const u = (j + phase) / 9;
      const y = horizonY + streetH * u * u;
      g!.globalAlpha = 0.15 + u * 0.4;
      g!.beginPath();
      g!.moveTo(0, y);
      g!.lineTo(w, y);
      g!.stroke();
    }
    // verticals converge on the vanishing point at the horizon center
    const vpx = w * 0.5;
    for (let i = 0; i <= 14; i++) {
      const xb = (i / 14) * w * 1.6 - w * 0.3; // bottom x, spread past the edges
      g!.globalAlpha = 0.12 + 0.25 * Math.min(1, Math.abs(xb - vpx) / w);
      g!.beginPath();
      g!.moveTo(vpx + (xb - vpx) * 0.04, horizonY);
      g!.lineTo(xb, h);
      g!.stroke();
    }
    g!.globalAlpha = 1;
    g!.restore();
  }

  function drawStreet(): void {
    if (ultraCity) {
      drawGridStreet();
      return;
    }
    // wet asphalt
    const street = g!.createLinearGradient(0, horizonY, 0, h);
    street.addColorStop(0, '#0b101f');
    street.addColorStop(1, '#04060c');
    g!.fillStyle = street;
    g!.fillRect(0, horizonY, w, h - horizonY);
    // a thin bright kerb line right at the horizon
    g!.fillStyle = withAlpha(accent, 0.22);
    g!.fillRect(0, horizonY, w, 1);

    // neon smears: every reflector + sign mirrors as a wobbling vertical streak
    g!.save();
    g!.globalCompositeOperation = 'lighter';
    const sources: Array<{ x: number; w: number; c: string; a: number }> = [];
    const near = layers[2];
    if (near) {
      for (const r of near.reflectors) sources.push({ x: r.x, w: r.w, c: signColor(r.color), a: 0.05 });
      for (const s of near.signs) {
        sources.push({ x: s.x + s.w / 2, w: Math.max(6, s.w * 1.4), c: signColor(s.color), a: 0.1 });
      }
    }
    sources.push({ x: w * 0.76, w: 26, c: '#cdd9f5', a: 0.07 }); // the moon
    // each smear is a radial glow squashed to the strip: soft edges on every side,
    // so reflections read as wet-street light pools (no hard-edged color slabs).
    const streetH = h - horizonY;
    for (const src of sources) {
      const wob = Math.sin(t * 1.1 + src.x) * 1.5;
      g!.save();
      g!.translate(src.x + wob, horizonY);
      g!.scale(Math.max(0.1, src.w / 2 / 40), Math.max(0.1, streetH / 40));
      const grad = g!.createRadialGradient(0, 0, 0, 0, 0, 40);
      grad.addColorStop(0, withAlpha(src.c, src.a * 2));
      grad.addColorStop(0.55, withAlpha(src.c, src.a * 0.9));
      grad.addColorStop(1, withAlpha(src.c, 0));
      g!.fillStyle = grad;
      g!.fillRect(-40, 0, 80, 40);
      g!.restore();
    }
    g!.restore();

    // rain ripples on the street
    const now = t;
    ripples = ripples.filter((r) => now - r.born < 0.5);
    g!.strokeStyle = 'rgba(160, 200, 240, 0.22)';
    g!.lineWidth = 0.8;
    for (const r of ripples) {
      const age = (now - r.born) / 0.5; // 0..1
      const ry = horizonY + (h - horizonY) * 0.45;
      g!.globalAlpha = 1 - age;
      g!.beginPath();
      g!.ellipse(r.x, ry, 1 + age * 7, (1 + age * 7) * 0.32, 0, 0, TAU);
      g!.stroke();
    }
    g!.globalAlpha = 1;
  }

  function drawRain(dt: number): void {
    const gust = Math.sin(t * 0.13) * 0.5 + Math.sin(t * 0.041) * 0.3; // wandering wind
    const alphas = [0.1, 0.17, 0.3];
    for (let layerIdx = 0; layerIdx < 3; layerIdx++) {
      g!.strokeStyle = `rgba(140, 190, 230, ${alphas[layerIdx]})`;
      g!.lineWidth = layerIdx === 2 ? 1.2 : 1;
      g!.beginPath();
      for (const d of drops) {
        if (d.layer !== layerIdx) continue;
        const wind = d.sp * (0.1 + gust * 0.14) * dt;
        d.y += d.sp * dt;
        d.x += wind;
        if (d.y > h) {
          if (d.layer === 2 && ripples.length < 14 && Math.random() < 0.3) {
            ripples.push({ x: d.x, born: t });
          }
          d.y = -d.len;
          d.x = Math.random() * (w * 1.2) - w * 0.1;
        }
        const tilt = 1.2 + gust * 2.2;
        g!.moveTo(d.x, d.y);
        g!.lineTo(d.x - tilt, d.y - d.len);
      }
      g!.stroke();
    }
  }

  // -------------------------------------------------------------- lightning
  // No full-screen strobe: each event is an actual bolt (cloud-to-skyline strike
  // or chain lightning crawling across the cloud deck) in a neon color, with a
  // soft LOCAL sky glow around it. Calm markets keep it rare; the storm picks up
  // while the featured asset is red and rages during a 5%+ dump.

  /** Seconds until the next bolt, scaled by how red the featured asset is. */
  function lightningDelay(): number {
    if (centerChange <= -5) return rand(10, 26); // dump: the sky answers
    if (centerChange < 0) return rand(24, 60); // drifting down: occasional
    return rand(50, 110); // green/flat: rare mood flashes
  }

  /** Midpoint-displacement jagged path between two points. */
  function jaggedPath(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    rough: number
  ): Array<{ x: number; y: number }> {
    let pts = [
      { x: x0, y: y0 },
      { x: x1, y: y1 }
    ];
    for (let level = 0; level < 5; level++) {
      const next: Array<{ x: number; y: number }> = [pts[0]];
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        const segLen = Math.hypot(b.x - a.x, b.y - a.y);
        next.push(
          {
            x: (a.x + b.x) / 2 + (Math.random() - 0.5) * segLen * rough,
            y: (a.y + b.y) / 2 + (Math.random() - 0.5) * segLen * rough
          },
          b
        );
      }
      pts = next;
    }
    return pts;
  }

  function spawnBolt(): void {
    const dumping = centerChange <= -5;
    // neon storm palette: ice blue / teal / violet / magenta; dumps skew hot
    const palette = dumping
      ? ['#ff3df0', '#b86bff', '#ff5d7a', '#9fd8ff']
      : ['#9fd8ff', '#7dffea', '#b86bff', '#ff3df0'];
    const color = palette[Math.floor(Math.random() * palette.length)];

    if (Math.random() < 0.42) {
      // chain lightning crawling sideways through the cloud deck
      const y0 = horizonY * rand(0.06, 0.2);
      const x0 = w * rand(0.05, 0.55);
      const x1 = x0 + w * rand(0.22, 0.42);
      const main = jaggedPath(x0, y0, x1, y0 + horizonY * rand(-0.05, 0.06), 0.34);
      const branches: Array<Array<{ x: number; y: number }>> = [];
      const twigs = 2 + Math.floor(Math.random() * 3);
      for (let i = 0; i < twigs; i++) {
        const at = main[Math.floor(rand(0.15, 0.85) * main.length)];
        branches.push(
          jaggedPath(
            at.x,
            at.y,
            at.x + w * rand(-0.05, 0.05),
            at.y + horizonY * rand(0.05, 0.14),
            0.4
          )
        );
      }
      bolts.push({
        main,
        branches,
        color,
        born: t,
        dur: rand(0.5, 0.8),
        kind: 'crawler',
        cx: (x0 + x1) / 2,
        cy: y0
      });
      return;
    }

    // a strike: cloud level down toward the skyline (it dies behind the towers)
    const x0 = w * rand(0.12, 0.88);
    const y0 = horizonY * rand(0.02, 0.1);
    const x1 = x0 + w * rand(-0.08, 0.08);
    const y1 = horizonY * rand(0.45, 0.72);
    const main = jaggedPath(x0, y0, x1, y1, 0.2);
    const branches: Array<Array<{ x: number; y: number }>> = [];
    const forks = 1 + Math.floor(Math.random() * 2);
    for (let i = 0; i < forks; i++) {
      const at = main[Math.floor(rand(0.25, 0.65) * main.length)];
      branches.push(
        jaggedPath(
          at.x,
          at.y,
          at.x + w * rand(-0.09, 0.09),
          at.y + (y1 - at.y) * rand(0.35, 0.7),
          0.3
        )
      );
    }
    bolts.push({
      main,
      branches,
      color,
      born: t,
      dur: rand(0.3, 0.5),
      kind: 'strike',
      cx: (x0 + x1) / 2,
      cy: (y0 + y1) / 2
    });
  }

  function strokeBoltPath(pts: Array<{ x: number; y: number }>, width: number, style: string): void {
    if (pts.length < 2) return;
    g!.strokeStyle = style;
    g!.lineWidth = width;
    g!.beginPath();
    g!.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) g!.lineTo(pts[i].x, pts[i].y);
    g!.stroke();
  }

  function drawLightning(): void {
    if (reducedMotion) return;
    if (t >= nextLightningAt) {
      spawnBolt();
      nextLightningAt = t + lightningDelay();
    }
    if (bolts.length === 0) return;

    g!.save();
    g!.globalCompositeOperation = 'lighter';
    g!.lineJoin = 'round';
    g!.lineCap = 'round';
    for (const b of bolts) {
      const k = (t - b.born) / b.dur; // 0..1 life
      if (k >= 1) continue;
      // envelope: fast attack, decaying flicker (re-strike shimmer, no strobe)
      const attack = k < 0.08 ? k / 0.08 : 1;
      const flick = 0.65 + 0.35 * Math.sin((t - b.born) * 52 + b.cx);
      const a = (1 - k) * attack * flick;

      // soft local illumination around the bolt only (the subtle flash)
      const r = Math.max(w, horizonY) * 0.26;
      const lum = g!.createRadialGradient(b.cx, b.cy, 0, b.cx, b.cy, r);
      lum.addColorStop(0, withAlpha(b.color, 0.055 * a));
      lum.addColorStop(1, 'rgba(0,0,0,0)');
      g!.fillStyle = lum;
      g!.fillRect(b.cx - r, b.cy - r, r * 2, r * 2);

      // glow pass, then the hot core
      const coreW = b.kind === 'strike' ? 1.4 : 1.1;
      strokeBoltPath(b.main, coreW * 3.2, withAlpha(b.color, 0.28 * a));
      strokeBoltPath(b.main, coreW, withAlpha('#eef7ff', 0.8 * a));
      for (const br of b.branches) {
        strokeBoltPath(br, coreW * 2.2, withAlpha(b.color, 0.2 * a));
        strokeBoltPath(br, coreW * 0.7, withAlpha('#eef7ff', 0.55 * a));
      }
    }
    g!.restore();
    bolts = bolts.filter((b) => t - b.born < b.dur);
  }

  // ------------------------------------------------------------------- loop

  function frame(ts: number): void {
    if (!running) return;
    const dt = last ? Math.min(0.05, (ts - last) / 1000) : 0.016;
    last = ts;
    t += dt;

    // ULTRA: the pre-rendered skyline silhouettes shift into magenta/violet.
    // Only the building canvases are filtered; signs/windows stay native neon.
    const layerFilter = ultraCity ? 'hue-rotate(155deg) saturate(1.7) brightness(1.15)' : 'none';

    drawSky();
    // off-world ships ride the upper sky band; drawn here so every skyline layer
    // paints over them and the towers occlude their crossing (depth)
    drawAlienShips(dt);
    if (layers[0]) {
      g!.filter = layerFilter;
      g!.drawImage(layers[0].canvas, 0, 0, w, horizonY);
      g!.filter = 'none';
    }
    drawFog(0.72, 0.05, 5, 0);
    if (layers[1]) {
      g!.filter = layerFilter;
      g!.drawImage(layers[1].canvas, 0, 0, w, horizonY);
      g!.filter = 'none';
      drawLayerExtras(layers[1]);
    }
    drawSpinners(dt);
    drawSearchlight();
    if (layers[2]) {
      g!.filter = layerFilter;
      g!.drawImage(layers[2].canvas, 0, 0, w, horizonY);
      g!.filter = 'none';
      drawLayerExtras(layers[2]);
    }
    drawRockets(dt);
    drawFireworks(dt);
    drawFog(0.93, 0.07, -3.4, w);
    drawStreet();
    drawRain(dt);
    drawLightning();

    raf = requestAnimationFrame(frame);
  }

  const start = (): void => {
    if (running || document.hidden) return;
    running = true;
    last = 0;
    raf = requestAnimationFrame(frame);
  };
  const stop = (): void => {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };
  const onVis = (): void => {
    if (document.hidden) stop();
    else start();
  };
  document.addEventListener('visibilitychange', onVis);

  // debounce ResizeObserver rebuilds (~150 ms trailing) so dragging the window
  // edge does not re-prerender the three skylines on every frame
  const RESIZE_DEBOUNCE_MS = 150;
  let resizeTimer: number | null = null;
  const debouncedResize = (): void => {
    if (resizeTimer !== null) window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      resizeTimer = null;
      resize();
    }, RESIZE_DEBOUNCE_MS);
  };

  let ro: ResizeObserver | null = null;
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => debouncedResize());
    ro.observe(canvas);
  }

  resize(); // immediate first build at mount
  start();

  return () => {
    stop();
    window.clearInterval(themeId);
    if (resizeTimer !== null) {
      window.clearTimeout(resizeTimer);
      resizeTimer = null;
    }
    document.removeEventListener('visibilitychange', onVis);
    ro?.disconnect();
    for (const u of marketUnsubs) u();
    marketUnsubs.length = 0;
  };
}

// ------------------------------------------------------------------- mounting

export function mountNightCity(container: HTMLElement, ctx: AppContext): void {
  const canvas = el('canvas', { class: 'ncity__canvas', 'aria-hidden': 'true' }) as HTMLCanvasElement;
  const stage = el('div', { class: 'ncity__stage' }, canvas);

  const head = el(
    'div',
    { class: 'ncity__head' },
    el('span', { class: 'ncity__title', text: 'NIGHT CITY' }),
    el(
      'span',
      { class: 'ncity__feed' },
      el('span', { class: 'ncity__dot', 'aria-hidden': 'true' }),
      el('span', { text: 'SECTOR 7 // LIVE' })
    )
  );

  mount(container, el('div', { class: 'ncity' }, head, stage));

  const dispose = mountScene(canvas, ctx);
  const host = container as HTMLElement & { __ncityDispose?: () => void };
  host.__ncityDispose?.();
  host.__ncityDispose = dispose;
}
