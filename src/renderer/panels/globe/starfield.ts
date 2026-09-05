// STARFIELD: the persistent parallax star tunnel behind every globe regime.
//
// Three depth layers of stars sit in a log-radial field around the panel center.
// Pulling the camera back (zoom up) makes near stars flow INWARD toward the
// vanishing point faster than far ones, so a scroll reads as travel rather than a
// crossfade; stars that reach the center respawn at the rim (and the reverse on
// zoom-in). While the zoom is moving each star also draws a short radial streak
// scaled by the zoom velocity: the "warp" cue. At rest the field is a calm,
// slowly rotating sky with a gentle twinkle on the bright layer and tiny
// diffraction crosses on the dozen brightest stars.
//
// Allocation-free per frame: all star state lives in typed arrays, colors are
// prebuilt strings grouped in contiguous blocks (one strokeStyle/fillStyle per
// block), and the draw loop is a handful of multiplies per star. Seeded RNG so
// the sky is the same every launch. Reduced motion: no drift, no twinkle, no
// streaks (the flow with zoom still happens, since the zoom itself snaps).

export interface Starfield {
  /**
   * Draw the field. `zoomVel` is d(zoom)/dt in zoom units per second (signed);
   * `alpha` is the regime-driven master alpha (fade the sky out past the
   * observable universe); `dt` is the frame delta in seconds.
   */
  draw(
    g: CanvasRenderingContext2D,
    w: number,
    h: number,
    cx: number,
    cy: number,
    dt: number,
    zoomVel: number,
    clock: number,
    alpha: number,
    reducedMotion: boolean
  ): void;
}

interface Layer {
  n: number;
  parallax: number; // radial flow per zoom unit (near layers flow faster)
  size: number; // dot size, css px
  alpha: number;
}

const LAYERS: Layer[] = [
  { n: 110, parallax: 0.62, size: 1.7, alpha: 0.95 },
  { n: 150, parallax: 0.36, size: 1.2, alpha: 0.62 },
  { n: 220, parallax: 0.17, size: 0.9, alpha: 0.38 }
];

/** Radial extent as a fraction of the half-diagonal. Stars wrap between these. */
const R_MIN = 0.015;
const R_MAX = 1.02;
/** Slow whole-sky drift (rad/s) and the twinkle rate (rad/s). */
const DRIFT = 0.0035;
const TWINKLE = 1.7;
/** Streak gain: px of streak per (zoomVel * parallax * r). Clamped to STREAK_MAX. */
const STREAK_GAIN = 0.55;
const STREAK_MAX = 46;
/** Number of layer-0 stars that get a diffraction cross. */
const CROSS_N = 12;

/** Four star tints; stars are assigned in contiguous blocks (index order). */
const TINTS: Array<[number, number, number]> = [
  [225, 240, 255], // blue-white (most)
  [255, 255, 255], // white
  [255, 232, 200], // warm
  [170, 215, 255] // cool cyan
];
/** Fraction of each block, in TINTS order. */
const TINT_SPLIT = [0.5, 0.25, 0.15, 0.1];

function rgba(r: number, g: number, b: number, a: number): string {
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** mulberry32 */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function smoothstep(a: number, b: number, x: number): number {
  let t = (x - a) / (b - a);
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  return t * t * (3 - 2 * t);
}

export function createStarfield(seed = 0x5eedf1e1): Starfield {
  const rng = makeRng(seed);
  const total = LAYERS.reduce((s, l) => s + l.n, 0);
  // packed state: angle, radius (fraction of half-diag), size mul, phase, layer, tint
  const ang = new Float32Array(total);
  const rad = new Float32Array(total);
  const sizeMul = new Float32Array(total);
  const phase = new Float32Array(total);
  const layer = new Uint8Array(total);
  const tint = new Uint8Array(total);
  // block boundaries per (layer, tint) so the draw loop sets a style per block
  const blockStart: number[] = [];
  const blockEnd: number[] = [];
  const blockLayer: number[] = [];
  const blockTint: number[] = [];
  let i = 0;
  for (let l = 0; l < LAYERS.length; l++) {
    const L = LAYERS[l];
    let placed = 0;
    for (let t = 0; t < TINTS.length; t++) {
      const count = t === TINTS.length - 1 ? L.n - placed : Math.round(L.n * TINT_SPLIT[t]);
      blockStart.push(i);
      blockLayer.push(l);
      blockTint.push(t);
      for (let k = 0; k < count; k++) {
        ang[i] = rng() * Math.PI * 2;
        // area-uniform initial radius in the annulus
        rad[i] = Math.sqrt(R_MIN * R_MIN + rng() * (R_MAX * R_MAX - R_MIN * R_MIN));
        sizeMul[i] = 0.75 + rng() * 0.6;
        phase[i] = rng() * Math.PI * 2;
        layer[i] = l;
        tint[i] = t;
        i++;
      }
      placed += count;
      blockEnd.push(i);
    }
  }
  // prebuilt opaque styles per tint (alpha rides globalAlpha)
  const fill = TINTS.map((c) => rgba(c[0], c[1], c[2], 1));
  let drift = 0;

  function draw(
    g: CanvasRenderingContext2D,
    w: number,
    h: number,
    cx: number,
    cy: number,
    dt: number,
    zoomVel: number,
    clock: number,
    alpha: number,
    reducedMotion: boolean
  ): void {
    if (alpha <= 0.004) return;
    const halfDiag = Math.hypot(w, h) * 0.5;
    if (!reducedMotion) drift += DRIFT * dt;
    const cd = Math.cos(drift);
    const sd = Math.sin(drift);
    // radial flow this frame: zoom up -> stars converge (r shrinks)
    const flow = zoomVel * dt;
    const streaking = !reducedMotion && Math.abs(zoomVel) > 0.02;
    const prevComp = g.globalCompositeOperation;
    g.globalCompositeOperation = 'lighter';
    g.lineWidth = 1;
    for (let b = 0; b < blockStart.length; b++) {
      const L = LAYERS[blockLayer[b]];
      const style = fill[blockTint[b]];
      g.fillStyle = style;
      g.strokeStyle = style;
      const k = L.parallax;
      const baseA = L.alpha * alpha;
      const sz = L.size;
      // streaks first (one path per block, one stroke), then dots
      if (streaking) {
        g.globalAlpha = baseA * 0.55;
        g.beginPath();
        for (let s = blockStart[b]; s < blockEnd[b]; s++) {
          const r = rad[s];
          let len = Math.abs(zoomVel) * k * r * halfDiag * STREAK_GAIN;
          if (len > STREAK_MAX) len = STREAK_MAX;
          if (len < 1.5) continue;
          const a = ang[s];
          const ca = Math.cos(a);
          const sa = Math.sin(a);
          const ux = ca * cd - sa * sd;
          const uy = ca * sd + sa * cd;
          const px = cx + ux * r * halfDiag;
          const py = cy + uy * r * halfDiag;
          // streak points along the flow: inward on zoom-out, outward on zoom-in
          const dir = zoomVel > 0 ? 1 : -1;
          g.moveTo(px, py);
          g.lineTo(px + ux * len * dir, py + uy * len * dir);
        }
        g.stroke();
      }
      for (let s = blockStart[b]; s < blockEnd[b]; s++) {
        // advance the radial flow (multiplicative in r == parallax by distance)
        let r = rad[s];
        if (flow !== 0) {
          r *= Math.exp(-flow * k * 1.7);
          if (r < R_MIN) {
            r = R_MAX * (0.97 + rng() * 0.03);
            ang[s] = rng() * Math.PI * 2;
          } else if (r > R_MAX) {
            r = R_MIN * (1 + rng() * 0.6);
            ang[s] = rng() * Math.PI * 2;
          }
          rad[s] = r;
        }
        const a = ang[s];
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const px = cx + (ca * cd - sa * sd) * r * halfDiag;
        const py = cy + (ca * sd + sa * cd) * r * halfDiag;
        if (px < -2 || py < -2 || px > w + 2 || py > h + 2) continue;
        // fade near the vanishing point and at the rim so wraps never pop
        const edge = smoothstep(R_MIN, R_MIN * 4, r) * (1 - smoothstep(R_MAX * 0.94, R_MAX, r));
        let tw = 1;
        if (!reducedMotion && blockLayer[b] === 0) tw = 0.72 + 0.28 * Math.sin(clock * TWINKLE + phase[s]);
        const al = baseA * edge * tw;
        if (al < 0.01) continue;
        const d = sz * sizeMul[s];
        g.globalAlpha = al;
        g.fillRect(px - d * 0.5, py - d * 0.5, d, d);
        // diffraction cross on the brightest few
        if (blockLayer[b] === 0 && s < CROSS_N) {
          g.globalAlpha = al * 0.35;
          const c = d * 2.4;
          g.fillRect(px - c, py - 0.35, c * 2, 0.7);
          g.fillRect(px - 0.35, py - c, 0.7, c * 2);
        }
      }
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = prevComp;
  }

  return { draw };
}
