// GLOBE: the interactive Earth centerpiece (replaces the wormhole scene).
// Canvas 2D, orthographic projection, calm and readable:
//   - dot-matrix Earth: land as a Fibonacci sphere of ~17000 candidate points
//     (golden-angle spiral, no latitude banding), kept where they fall on a
//     hand-authored set of simplified continent polygons (lat/lon). Each kept
//     point draws as a soft round glow SPRITE (prebuilt radial-gradient canvas),
//     not a square; the frame loop only indexes a sprite, never builds a string.
//   - real day/night: the subsolar point is computed from the actual UTC time
//     (declination from a day-of-year approximation + hour angle). Day dots are
//     warm gold/amber, night dots cool cyan/blue, with a soft terminator band.
//     The night hue tracks the Fear & Greed index (cold violet when fearful,
//     teal when greedy) by rebuilding the 4 night sprites, not per-frame strings.
//     The Sun draws as an off-globe glow when its side faces the viewer, or a
//     faint limb corona when it is behind; both ease via a critically damped
//     view-space sun so the glow drifts smoothly instead of snapping.
//   - rotation: slow auto-spin (one rev per ~6 min, 1 deg/s) + drag to rotate
//     longitude and tilt latitude (clamped), with decaying inertia; auto-spin
//     resumes a few seconds after release. prefers-reduced-motion: no auto-spin,
//     drag still works, arcs render without animation pulses.
//   - comm traffic: hub markers at real financial centers; neon great-circle
//     arcs (lifted, bright head + fading trail) fire between random hub pairs on
//     store 'ticker'/'news' pushes plus an idle heartbeat whose cadence tracks
//     the center asset 24h mood. Segments are depth-tested against the sphere so
//     they hide behind the limb.
//   - live splice: a corner uplink readout cycles EARTH UPLINK // LIVE against
//     the live center-asset price; the atmosphere rim warms/cools and reddens on
//     a dump; a faint limb pulse fires when BTC candles stream. Data is read only
//     from the store (crypto, stocks, fng, candles, ticker, news) + center.ts.
//
//   - COSMIC LADDER + ORBIT LINES (round 14 / stage 2): the wheel now climbs the
//     full ladder E -> C -> S -> G -> X -> U -> M -> P in ~33 notches
//     (ZOOM_MAX 6.2). P (STACKED BRANES) is the terminal, deepest zoom-out phase.
//     Regime E gains faint analytic orbit lines under the live sats (one g.ellipse
//     per representative orbit, normals precomputed in rebuildSats, ISS ring
//     brightest). Four prerendered cosmic regimes extend the climb: G the Milky
//     Way (spiral arms, bar, dust lanes, a live SOL marker on the Orion Spur into
//     which the solar Sun shrinks), X the Local Group (Milky Way + Andromeda M31 +
//     Triangulum + satellites + dwarfs), and U the observable universe (a
//     cosmic-web lattice with a CMB rim and a LANIAKEA marker).
//     Each cosmic canvas builds lazily on first band entry, at most one heavy
//     build per frame, with an idle prewarm of the galaxy. All new auto-motion is
//     gated by reduced motion. Earth-level features are untouched.
//
//   - HOLOGRAM + LIVE ORBITS + SOLAR ZOOM (round 12): the whole scene now reads as
//     a yacht-bridge holotank. A panel-level emitter cone projects up from the
//     bottom into a bezel/glass/lip viewport; a cyan holo wash, twin counter
//     rotating HUD rings, drifting scanlines and an occasional chromatic limb
//     jitter ride over the Earth. Real Celestrak elements (store key 'sats',
//     propagated by core/orbits.ts) put ~live satellites in orbit: earth-fixed
//     trails, a labeled ISS, a Starlink train, GPS and station traffic. The mouse
//     wheel zooms OUT through three regimes that crossfade: Earth (E), a cislunar
//     view (C) with a real-phase Schlyter Moon and true-scale orbits, and the full
//     solar system (S) with all eight planets on sqrt-compressed orbits, rings,
//     labels and a YOU ARE HERE marker on Earth. A telemetry line on the viewport
//     lip reads ISS ALT/VEL, then LUNA RANGE, then EARTH AU FROM SOL as you pull
//     back.
//
// Perf: dot unit vectors and glow sprites are prebuilt; per frame each dot costs
// a handful of multiplies plus one drawImage (no trig, no allocations, no string
// builds); back-hemisphere dots are skipped. Satellites sample at 250 ms and lerp
// between snapshots; Moon and planet ephemerides run at 1 Hz in tickChrome and the
// frame loop only projects cached vectors. One rAF loop that pauses on
// document.hidden. DPR capped at 2. Theme accents sampled from the CSS custom
// properties once a second so pump/dump recolors the scene.
// Null-safe so it also runs under the dev:web browser-mock bridge.

import './globe.css';
import type { AppContext } from '../../app-context';
import { el, mount } from '../../core/dom';
import { formatPrice } from '../../core/format';
import { findCenterQuote } from '../../core/center';
import { LAND } from './land-data';
import type { SatElement } from '../../../shared/types';
import type { SatConst, SatState } from '../../core/orbits';
import { deriveConst, gmstRad, propagate, telemetry } from '../../core/orbits';

const TAU = Math.PI * 2;
const D2R = Math.PI / 180;

/** Cap the backing-store scale: 2x is plenty for the dot glow. */
const MAX_DPR = 2;

/**
 * Fibonacci-sphere sample count and the golden-angle step. ~17000 candidate
 * points spiral evenly over the unit sphere; the ones that land on land/Antarctica
 * are kept (~5000), giving a banding-free dot field at near-uniform density.
 */
const SPHERE_N = 17000;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** Tilt clamp: +/-45 degrees. */
const MAX_TILT = Math.PI / 4;

/** Auto-spin: one revolution every ~6 minutes (1.0 deg/s orbital-webcam drift). */
const BASE_SPIN = TAU / 360;

/** Half-width of the day/night terminator blend band (cosine of sun angle). */
const TERM_BAND = 0.17;

/** Samples per great-circle arc and the preallocated arc pool size. */
const ARC_N = 44;
const ARC_POOL = 10;

// ------------------------------------------------------------------- meteors
// Occasional meteors streak in from off-screen and strike the Earth disc, each
// firing an expanding shockwave ring clipped to the sphere face. Tasteful and
// infrequent (one every ~16-40 s), Earth-regime only, never under reduced
// motion. Both the meteor and the ring use fixed-size pools with packed typed
// arrays so the draw loop never allocates (same style as the arc pool).
/** Active-meteor pool size and active impact-ring pool size. */
const METEOR_POOL = 3;
const METEOR_RING_POOL = 4;
/** Spawn cadence: a new meteor roughly every rand(METEOR_MIN, METEOR_MAX) sec. */
const METEOR_MIN_SEC = 16;
const METEOR_MAX_SEC = 40;
/** Only spawn meteors when the Earth view is dominant (aE above this). */
const METEOR_AE_GATE = 0.6;
/** Meteor travel time (head off-screen -> impact point), seconds. */
const METEOR_FLIGHT_MIN = 0.8;
const METEOR_FLIGHT_MAX = 1.4;
/** Target offset cap as a fraction of Rearth so impacts land on the sphere face. */
const METEOR_TARGET_FRAC = 0.8;
/** Off-screen spawn radius as a multiple of Rearth (a bit beyond the disc). */
const METEOR_START_MUL = 1.9;
/** Motion-trail length (px back along the velocity) as a fraction of Rearth. */
const METEOR_TRAIL_FRAC = 0.5;
/** Impact-ring lifetime + final radius as a fraction of Rearth. */
const METEOR_RING_SEC = 1.1;
const METEOR_RING_R_FRAC = 0.5;
/** Hot-head color (warm white/orange) and the cool cyan shockwave ring color. */
const METEOR_HEAD_STYLE = 'rgba(255, 244, 224, 1)';
const METEOR_GLOW_STYLE = 'rgba(255, 196, 120, 1)';
const METEOR_RING_RGB: [number, number, number] = [120, 220, 255];
const METEOR_FLASH_STYLE = 'rgba(255, 250, 238, 1)';

// ----------------------------------------------------------- data-splice tuning
// Live market data colors the scene: the center asset's 24h move picks a mood
// band, and the band drives idle-arc cadence + rim warmth. Fear & Greed recolors
// the night sprites. None of these touch the frozen terminator palette.

/** Center 24h % thresholds for the four mood bands (dump / soft / warm / pump). */
const MOOD_DUMP = -5;
const MOOD_SOFT = 0;
const MOOD_PUMP = 5;

/** Idle-arc base seconds per mood band [dump, soft, warm, pump]. */
const MOOD_IDLE = [2.4, 3.4, 4.4, 2.0];

/** Atmosphere-rim alpha multiplier per mood band. */
const MOOD_RIM = [1.35, 0.85, 1.0, 1.35];

/** Rim hue override on a dump (otherwise the rim uses the accent). */
const DUMP_RIM = '#ff5a6a';

/** Fear & Greed night-hue endpoints (0 -> fear, 50 -> neutral == night, 100 -> greed). */
const FNG_FEAR_RGB: [number, number, number] = [120, 150, 255];
const FNG_NEUTRAL_RGB: [number, number, number] = [88, 178, 255]; // == NIGHT_RGB
const FNG_GREED_RGB: [number, number, number] = [96, 226, 196];

/** Uplink readout cycle and candle-pulse rate limit (seconds). */
const TAG_CYCLE_SEC = 5;
const LIMB_PULSE_MIN = 1.5;

// ---------------------------------------------------------------- continents
// Clean Natural Earth 110m coastline RINGS as flat [lon, lat, lon, lat, ...] loops,
// imported from ./land-data (GENERATED by scripts/gen-globe-coast.mjs). Each
// Polygon/MultiPolygon ring is kept SEPARATE and is NOT dilated: concatenating or
// buffering rings is what bridged narrow oceans and visually merged the Americas
// into Europe/Africa/Asia. Antarctic + micro-island rings are dropped (the
// analytic isAntarctica band paints the southern cap). The MAIN globe no longer
// draws land at all (it is a wireframe sphere, see draw()); the inPoly/isLand/
// LAND_BOX/isAntarctica helpers and the cislunar-thumbnail dot field (buildDots)
// still operate on this imported LAND.
// Regenerate: node scripts/gen-globe-coast.mjs ; verify: node scripts/selftest-globe.mjs

/** Per-polygon bounding boxes so the grid test skips most loops instantly. */
const LAND_BOX: number[][] = LAND.map((p) => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < p.length; i += 2) {
    if (p[i] < minX) minX = p[i];
    if (p[i] > maxX) maxX = p[i];
    if (p[i + 1] < minY) minY = p[i + 1];
    if (p[i + 1] > maxY) maxY = p[i + 1];
  }
  return [minX, minY, maxX, maxY];
});

/** Even-odd ray cast over a flat [lon,lat,...] loop. */
function inPoly(lon: number, lat: number, p: number[]): boolean {
  let inside = false;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const x1 = p[j];
    const y1 = p[j + 1];
    const x2 = p[i];
    const y2 = p[i + 1];
    if (y1 > lat !== y2 > lat && lon < ((x2 - x1) * (lat - y1)) / (y2 - y1) + x1) {
      inside = !inside;
    }
  }
  return inside;
}

function isLand(lon: number, lat: number): boolean {
  for (let k = 0; k < LAND.length; k++) {
    const b = LAND_BOX[k];
    if (lon < b[0] || lon > b[2] || lat < b[1] || lat > b[3]) continue;
    if (inPoly(lon, lat, LAND[k])) return true;
  }
  return false;
}

/** Antarctica as a wiggly latitude band + the peninsula reaching toward S America. */
function isAntarctica(lon: number, lat: number): boolean {
  if (lat <= -71 + 3.5 * Math.sin((lon + 30) * D2R * 2)) return true;
  return lat <= -64 && lon >= -68 && lon <= -55;
}

// ------------------------------------------------------------- the dot field
// Built ONCE at module init: unit 3D vectors per land dot (earth-fixed frame)
// and a dim flag (Antarctica).
// The candidate points are a golden-angle Fibonacci spiral over the unit sphere
// (uniform density, no latitude banding rows); the spiral's y axis equals
// sin(lat), the same axis the sun dot product and view transform already use, so
// downstream geometry is unchanged. Only points that fall on land/Antarctica are
// kept (~5000), lat/lon resolved at build time purely to test the polygons.

interface DotField {
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  dim: Uint8Array;
  count: number;
}

function buildDots(): DotField {
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  const dims: number[] = [];
  for (let i = 0; i < SPHERE_N; i++) {
    const y = 1 - (2 * i + 1) / SPHERE_N;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = GOLDEN_ANGLE * i;
    const x = Math.cos(theta) * r;
    const z = Math.sin(theta) * r;
    const lat = Math.asin(y) / D2R; // build time only (polygon test)
    const lon = Math.atan2(z, x) / D2R;
    let dim = 0;
    if (isAntarctica(lon, lat)) dim = 1;
    else if (!isLand(lon, lat)) continue;
    xs.push(x);
    ys.push(y);
    zs.push(z);
    dims.push(dim);
  }
  return {
    x: Float32Array.from(xs),
    y: Float32Array.from(ys),
    z: Float32Array.from(zs),
    dim: Uint8Array.from(dims),
    count: xs.length
  };
}

const DOTS = buildDots();

// The Earth no longer renders coastline line-art: it is a wireframe sphere
// (graticule + limb circle, below). The LAND import + isLand/LAND_BOX + buildDots
// are kept because the cislunar regime-C thumbnail and the dev hook still use the
// dot field; only the main-globe coastline render + its precompute were removed.

// --------------------------------------------------------------- graticule grid
// The primary holographic wireframe globe (no land): meridians every 15 deg lon
// and parallels every 15 deg lat, each a polyline of unit vectors sampled along
// its great/small circle. Precomputed ONCE (the same earth-fixed frame the view
// transform uses) so the draw loop only projects cached vectors, never builds
// geometry. Gated by aE like everything Earth-level. The poles are skipped (a
// parallel at +/-90 is a point).

const GRAT_STEP_DEG = 15;
const GRAT_SAMPLES = 48; // points per line (sub-pixel chords at this disc size)

function gratLine(makeLonLat: (t: number) => [number, number]): Float32Array {
  const v = new Float32Array(GRAT_SAMPLES * 3);
  for (let s = 0; s < GRAT_SAMPLES; s++) {
    const [lonDeg, latDeg] = makeLonLat(s / (GRAT_SAMPLES - 1));
    const lon = lonDeg * D2R;
    const lat = latDeg * D2R;
    const cl = Math.cos(lat);
    v[s * 3] = cl * Math.cos(lon);
    v[s * 3 + 1] = Math.sin(lat);
    v[s * 3 + 2] = cl * Math.sin(lon);
  }
  return v;
}

function buildGraticule(): Float32Array[] {
  const lines: Float32Array[] = [];
  // meridians: fixed lon, lat runs -90..90
  for (let lon = -180; lon < 180; lon += GRAT_STEP_DEG) {
    lines.push(gratLine((t) => [lon, -90 + 180 * t]));
  }
  // parallels: fixed lat, lon runs -180..180 (skip the poles at +/-90)
  for (let lat = -75; lat <= 75; lat += GRAT_STEP_DEG) {
    lines.push(gratLine((t) => [-180 + 360 * t, lat]));
  }
  return lines;
}

const GRATICULE = buildGraticule();

// ------------------------------------------------------------------ palettes
// Style strings are PREBUILT so the frame loop never builds a string. Day is
// warm gold/amber, night cool cyan/blue (slightly dimmer), with 4 interpolated
// terminator mixes between them; each has 4 limb-brightness levels.

const DAY_RGB: [number, number, number] = [255, 198, 112];
const NIGHT_RGB: [number, number, number] = [88, 178, 255];
const DAY_A = [0.3, 0.5, 0.72, 0.95];
const NIGHT_A = [0.16, 0.27, 0.4, 0.58];

function rgba(r: number, g: number, b: number, a: number): string {
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${a.toFixed(3)})`;
}

const DAY_STYLES = DAY_A.map((a) => rgba(DAY_RGB[0], DAY_RGB[1], DAY_RGB[2], a));

/** 4 terminator mixes x 4 brightness levels (night -> day). */
const TERM_STYLES: string[][] = [0.2, 0.4, 0.6, 0.8].map((m) =>
  DAY_A.map((_, bi) =>
    rgba(
      NIGHT_RGB[0] + (DAY_RGB[0] - NIGHT_RGB[0]) * m,
      NIGHT_RGB[1] + (DAY_RGB[1] - NIGHT_RGB[1]) * m,
      NIGHT_RGB[2] + (DAY_RGB[2] - NIGHT_RGB[2]) * m,
      NIGHT_A[bi] + (DAY_A[bi] - NIGHT_A[bi]) * m
    )
  )
);

const DIM_STYLE = 'rgba(150, 190, 255, 0.16)';
const ARC_HEAD_STYLE = 'rgba(240, 250, 255, 0.95)';
const CORONA_STYLE = 'rgba(255, 214, 130, 1)';

// The coastline stroke ramps (COAST_RAMP / COAST_RAMP_ULTRA) were removed with the
// coastline render pass; the Earth is now a wireframe sphere with no land.

/** Cool cyan tone for the holographic wireframe globe (alpha rides on globalAlpha). */
const GRAT_STYLE = rgba(120, 200, 255, 1);

// ----------------------------------------------------- holo + orbits + zoom
// Round-12 tuning. The hologram chrome, live satellites, and the wheel zoom that
// recedes Earth out to the Moon and the solar system. All constants are module
// scope so nothing is rebuilt per frame; sprite/string prebuilds live below.

/** Smoothstep on [a, b] (clamped). Crossfades and recede curves ride this. */
function smoothstep(a: number, b: number, x: number): number {
  if (a === b) return x < a ? 0 : 1;
  let t = (x - a) / (b - a);
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  return t * t * (3 - 2 * t);
}

// --- B1: satellite sampling + earth-fixed trails ---
/** Hard cap on satellites we propagate / draw (stations + visual first, gps fills). */
const SAT_CAP = 120;
/** Resample the propagation every 250 ms; frames lerp between snapshots. */
const SAT_SAMPLE_MS = 250;
/** Trail ring buffer: 6 earth-fixed samples written every 0.7 s. */
const TRAIL_N = 6;
const SAT_TRAIL_DT = 0.7;
/** ISS is identified by NORAD id; its label is just 'ISS'. */
const ISS_NORAD = 25544;

/** Lift a satellite off the Earth disc by its altitude ratio (clamped). */
function satLift(altRatio: number): number {
  return Math.min(1.45, 1.04 + (altRatio - 1) * 2.5);
}

/** Per-group dot color (stations bright, visual cyan, gps cooler blue). */
const SAT_COLOR_STATIONS = 'rgba(170,255,245,0.95)';
const SAT_COLOR_VISUAL = 'rgba(120,232,255,0.85)';
const SAT_COLOR_GPS = 'rgba(150,190,255,0.70)';
const SAT_DOT_PX = 1.8;
const ISS_DOT_PX = 3.2;

// --- B2: holo overlay pass ---
const HOLO_RGB: [number, number, number] = [120, 232, 255];
const HOLO_TEAL_RGB: [number, number, number] = [90, 220, 210];
/** HUD ring radii as a multiple of the projected Earth radius. */
const HUD_R1 = 1.14;
const HUD_R2 = 1.27;
const HUD_A1 = 0.22;
const HUD_A2 = 0.14;
const HUD_SPIN1 = 0.06; // rad/s
const HUD_SPIN2 = -0.038;
const HUD_TICKS1 = 48;
const HUD_TICKS2 = 24;
const HUD_TICK_LEN = 4;
/** Drifting scanlines clipped to the disc. */
const SCAN_COUNT = 3;
const SCAN_SPEED = 26; // px/s
const SCAN_ALPHA = 0.05;
const SCAN_THICK = 1.5;
/** Emitter cone + base lens glow alphas. */
const CONE_ALPHA = 0.1;
const CONE_BASE_ALPHA = 0.16;
/** Chromatic limb jitter: ~1 per 22 s, +/- 1.5 px ghost ring. */
const JITTER_MEAN_SEC = 22;
const JITTER_PX = 1.5;
/** Cyan wash over the Earth disc. */
const HOLO_WASH_ALPHA = 0.06;
/** Prebuilt HUD stroke strings (alpha rides globalAlpha, color is fixed cyan). */
const HUD_STROKE = rgba(HOLO_RGB[0], HOLO_RGB[1], HOLO_RGB[2], 1);
const HUD_STROKE_TEAL = rgba(HOLO_TEAL_RGB[0], HOLO_TEAL_RGB[1], HOLO_TEAL_RGB[2], 1);
/** Cached 9px mono font string for the few static labels (ISS + planets). */
const HOLO_LABEL_FONT = '9px var(--font-mono, monospace)';

// --- B4: zoom system (round 14: ladder extended; stage-2: 8 regimes) ---
// E (Earth) C (cislunar) S (solar) G (Milky Way) X (Local Group) U (universe)
// M (multiverse) P (dimensional planes, terminal). ZOOM_MAX gives enough headroom
// so aM and aP each reach 1; the wheel curve is recurved so Earth -> P is ~33
// mouse notches end to end (RZ1). U and everything below it are unchanged; M and P
// slot in below U as the two deepest regimes.
const ZOOM_MIN = 0;
const ZOOM_MAX = 6.2; // P terminal: aP hits 1 at z=5.85, small dwell room past it
const ZOOM_TAU = 0.22;
const ZOOM_WHEEL_STEP = 0.0016;

type Regime = 'E' | 'C' | 'S' | 'G' | 'X' | 'U' | 'M' | 'P';

// --- B5: cislunar regime ---
/** Mean Earth radius in km (matches orbits.ts R_EARTH). */
const KM_EARTH_R = 6371;
/** Mean Earth-Moon distance, km (Schlyter a in Earth radii is rescaled to this). */
const MOON_DIST_KM = 384400;
const GEO_KM = 42164;
const LEO_KM = 6371 + 550;

// --- B6: solar system regime ---
const SOLAR_TILT = 25 * D2R; // fixed pitch
const AU_NEPTUNE = 30.0699; // sqrt-compression reference (Neptune's a)

// --- R14.1: satellite orbit lines (regime E) -----------------------------------
// Analytic projected ellipses (RZ2): one g.ellipse stroke per representative
// orbit, drawn under the live sat dots as faint holo chrome. Normals are
// precomputed in rebuildSats; the per-frame transform reuses the hoisted GMST
// cos/sin (satCg/satSg) the sampler already computes. No occlusion: the faint
// through-the-disc ring is the intended x-ray look (HUD rings + wash do the same).
const ORBIT_LINE_CAP = 28; // total rings drawn
const ORBIT_VISUAL_KEEP = 12; // first N visual orbits
const ORBIT_GPS_STRIDE = 4; // every 4th gps orbit
const ORBIT_GPS_KEEP = 8; // max gps orbits
const ORBIT_A_STATIONS = 0.1;
const ORBIT_A_VISUAL = 0.06;
const ORBIT_A_GPS = 0.045;
const ORBIT_A_ISS = 0.16;
// prebuilt opaque ring styles (alpha rides globalAlpha, like the HUD rings):
const ORBIT_STYLE_STATIONS = 'rgba(170,255,245,1)';
const ORBIT_STYLE_VISUAL = 'rgba(120,232,255,1)';
const ORBIT_STYLE_GPS = 'rgba(150,190,255,1)';

// --- R14.3: cosmic ladder art (regimes G/X/U/M/P) ------------------------------
// All four are prerendered on offscreen canvases, built lazily on first band
// entry (one heavy build per frame at most) and drawn per frame as a couple of
// drawImage calls. Sizes follow the cosmos design; band numbers track RZ1.
const GALAXY_PX_MUL = 1.6;
const GALAXY_PX_CAP = 1100;
const GAL_TILT = 55 * D2R; // cos ~ 0.5736 y-squash of the disc
const GAL_PITCH = 12.5 * D2R; // log-spiral b = tan(pitch)
const GAL_BAR_ANGLE = 25 * D2R;
const GAL_R_INNER_FRAC = 0.16; // bulge edge / Rd
const GAL_ARM_MAJOR_PARTS = 1400; // x2 major arms
const GAL_ARM_MINOR_PARTS = 700; // x2 minor arms
const GAL_BULGE_PARTS = 800;
const GAL_BAR_PARTS = 600;
const GAL_THETA_MAX = 4.2; // rad (~1.2 turns)
const GAL_ROT_SEC = 180; // visual seconds per revolution
const GAL_GLINT_N = 4;

const CLUSTER_PX_MUL = 1.5;
const CLUSTER_PX_CAP = 1000;
const CLUSTER_DWARF_N = 20;

const WEB_PX_MUL = 1.7;
const WEB_PX_CAP = 1200;
const WEB_NODE_N = 300;
const WEB_ATTRACTORS = 4;
const WEB_ATTRACT_FRAC = 0.7;
const WEB_ATTRACT_SIGMA_FRAC = 0.1;
const WEB_DISC_R_FRAC = 0.46;
const WEB_EDGE_MAXDIST_FRAC = 0.13;
const WEB_EDGE_NEIGHBORS = 3;
const WEB_EDGE_ALPHA = 0.1;
const WEB_BREATH_SEC = 8;
const WEB_GLINT_N = 4;


// --- STAGE 2 REGIME M: the multiverse (merging universe bubbles) ------------
// A prerendered field of soft radial-gradient "universe bubbles" with a faint
// internal cosmic-web speckle, drifting on slow per-frame offsets so they overlap
// and merge; the merging seams (lens-shaped intersections) get a brighter
// iridescent shimmer drawn live. Cool cyan/violet/teal palette. The static bubble
// layouts bake once; only the drift offsets + seam shimmer are per frame.
const MULTI_PX_MUL = 1.6;
const MULTI_PX_CAP = 1100;
const MULTI_BUBBLE_N = 6; // 5-7 large bubbles
const MULTI_SPECKLE_N = 26; // faint cosmic-web hints baked into each bubble
const MULTI_DRIFT_SEC = 26; // slow merge-and-part period (visual seconds)
// Cool iridescent bubble tints (cyan / violet / teal), [r,g,b].
const MULTI_TINTS: Array<[number, number, number]> = [
  [90, 200, 255],
  [150, 120, 255],
  [80, 220, 210],
  [120, 160, 255],
  [100, 210, 240],
  [170, 130, 245],
  [90, 230, 220]
];

// --- STAGE 2 REGIME P: dimensional planes (stacked wireframe branes) --------
// A live stack of large translucent wireframe grid planes (parallelograms of grid
// lines) at varied tilts/depths, depth-sorted so nearer sheets are brighter, with
// glowing edges and a faint hyperdimensional shimmer; a single faint tesseract
// wireframe sits at the center for flavor. Built per frame (cheap line work),
// slow rotation only when not reducedMotion. Cool palette.
const PLANE_N = 6; // 5-7 stacked branes
const PLANE_GRID_DIV = 6; // grid lines per axis on each plane
const PLANE_ROT_SEC = 90; // visual seconds per slow rotation
const PLANE_RGB: [number, number, number] = [120, 200, 255];
const PLANE_EDGE_RGB: [number, number, number] = [170, 140, 255];
const TESSERACT_RGB: [number, number, number] = [150, 230, 255];

// Chrome strings per cosmic regime (RZ4; uppercase mono, no em-dash, real data).
const CHROME_G_TAG = 'MILKY WAY // SOL 26700 LY FROM SGR A*';
const CHROME_G_TELEM = 'GALACTIC DISC // 100000 LY ACROSS';
const CHROME_X_TAG = 'LOCAL GROUP // 80 GALAXIES';
const CHROME_X_TELEM = 'ANDROMEDA M31 // 2.5 MLY';
const CHROME_U_TAG = 'OBSERVABLE UNIVERSE // 93 GLY ACROSS';
const CHROME_U_TELEM = 'COSMIC WEB // LANIAKEA SUPERCLUSTER';
const CHROME_M_TAG = 'MULTIVERSE // BUBBLE NUCLEATION';
const CHROME_M_TELEM = 'FALSE VACUUM // UNIVERSES MERGING';
const CHROME_P_TAG = 'DIMENSIONAL PLANES // STACKED BRANES';
const CHROME_P_TELEM = 'HILBERT MANIFOLD // ORTHOGONAL REALITIES';

/**
 * JPL low-precision planetary elements (J2000 epoch + per-century rates).
 * Columns: a (AU), e, I (deg), L (deg), wbar (deg), Omega (deg); each with a rate.
 * Transcribed verbatim from the spec (Standish/JPL, 1800-2050 set).
 */
interface PlanetEl {
  name: string;
  color: string;
  size: number;
  a: number;
  aR: number;
  e: number;
  eR: number;
  I: number;
  IR: number;
  L: number;
  LR: number;
  wbar: number;
  wbarR: number;
  Om: number;
  OmR: number;
}
const PLANETS: PlanetEl[] = [
  { name: 'MERCURY', color: '#b8b0a0', size: 6,
    a: 0.38709927, aR: 0.00000037, e: 0.20563593, eR: 0.00001906, I: 7.00497902, IR: -0.00594749,
    L: 252.2503235, LR: 149472.67411175, wbar: 77.45779628, wbarR: 0.16047689, Om: 48.33076593, OmR: -0.12534081 },
  { name: 'VENUS', color: '#ffd9a0', size: 8,
    a: 0.72333566, aR: 0.0000039, e: 0.00677672, eR: -0.00004107, I: 3.39467605, IR: -0.0007889,
    L: 181.9790995, LR: 58517.81538729, wbar: 131.60246718, wbarR: 0.00268329, Om: 76.67984255, OmR: -0.27769418 },
  { name: 'EARTH', color: '#6cc5ff', size: 8,
    a: 1.00000261, aR: 0.00000562, e: 0.01671123, eR: -0.00004392, I: -0.00001531, IR: -0.01294668,
    L: 100.46457166, LR: 35999.37244981, wbar: 102.93768193, wbarR: 0.32327364, Om: 0.0, OmR: 0.0 },
  { name: 'MARS', color: '#ff7a55', size: 7,
    a: 1.52371034, aR: 0.00001847, e: 0.0933941, eR: 0.00007882, I: 1.84969142, IR: -0.00813131,
    L: -4.55343205, LR: 19140.30268499, wbar: -23.94362959, wbarR: 0.44441088, Om: 49.55953891, OmR: -0.29257343 },
  { name: 'JUPITER', color: '#ffcf9e', size: 10,
    a: 5.202887, aR: -0.00011607, e: 0.04838624, eR: -0.00013253, I: 1.30439695, IR: -0.00183714,
    L: 34.39644051, LR: 3034.74612775, wbar: 14.72847983, wbarR: 0.21252668, Om: 100.47390909, OmR: 0.20469106 },
  { name: 'SATURN', color: '#ffe7b0', size: 9,
    a: 9.53667594, aR: -0.0012506, e: 0.05386179, eR: -0.00050991, I: 2.48599187, IR: 0.00193609,
    L: 49.95424423, LR: 1222.49362201, wbar: 92.59887831, wbarR: -0.41897216, Om: 113.66242448, OmR: -0.28867794 },
  { name: 'URANUS', color: '#9fe8ff', size: 8,
    a: 19.18916464, aR: -0.00196176, e: 0.04725744, eR: -0.00004397, I: 0.77263783, IR: -0.00242939,
    L: 313.23810451, LR: 428.48202785, wbar: 170.9542763, wbarR: 0.40805281, Om: 74.01692503, OmR: 0.04240589 },
  { name: 'NEPTUNE', color: '#7aa2ff', size: 8,
    a: 30.06992276, aR: 0.00026291, e: 0.00859048, eR: 0.00005105, I: 1.77004347, IR: 0.00035372,
    L: -55.12002969, LR: 218.45945325, wbar: 44.96476227, wbarR: -0.32241464, Om: 131.78422574, OmR: -0.00508664 }
];

// --------------------------------------------------------------------- hubs

const HUBS: Array<[string, number, number]> = [
  ['New York', -74.0, 40.7],
  ['San Francisco', -122.4, 37.8],
  ['London', -0.1, 51.5],
  ['Frankfurt', 8.7, 50.1],
  ['Dubai', 55.3, 25.2],
  ['Singapore', 103.8, 1.35],
  ['Hong Kong', 114.2, 22.3],
  ['Tokyo', 139.7, 35.7],
  ['Sydney', 151.2, -33.9],
  ['Sao Paulo', -46.6, -23.5]
];
const HUB_COUNT = HUBS.length;
const HUB_V = new Float32Array(HUB_COUNT * 3);
const HUB_PHASE = new Float32Array(HUB_COUNT);
for (let i = 0; i < HUB_COUNT; i++) {
  const lonR = HUBS[i][1] * D2R;
  const latR = HUBS[i][2] * D2R;
  HUB_V[i * 3] = Math.cos(latR) * Math.cos(lonR);
  HUB_V[i * 3 + 1] = Math.sin(latR);
  HUB_V[i * 3 + 2] = Math.cos(latR) * Math.sin(lonR);
  HUB_PHASE[i] = (i * TAU) / HUB_COUNT;
}

// -------------------------------------------------------------- tiny helpers

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

/** Tight signed-percent for the uplink readout. e.g. +6.2% / -3.4% / '' for null. */
const pct = (v: number | null | undefined): string =>
  v == null ? '' : (v > 0 ? '+' : '') + v.toFixed(1) + '%';

/** Parse the r,g,b,a out of an `rgba(r, g, b, a)` string (sprite source tables). */
function parseRgba(s: string): [number, number, number, number] {
  const m = s.match(/rgba?\(([^)]+)\)/);
  if (!m) return [255, 255, 255, 1];
  const p = m[1].split(',').map((v) => parseFloat(v));
  return [p[0] || 0, p[1] || 0, p[2] || 0, p[3] == null ? 1 : p[3]];
}

// ---------------------------------------------------------------- the scene

export function mountGlobe(container: HTMLElement, ctx: AppContext): void {
  const canvas = el('canvas', { class: 'globe__canvas' }) as HTMLCanvasElement;
  const tagLabel = el('span', { class: 'globe__tag-label', text: 'EARTH UPLINK // LIVE' });
  const tag = el(
    'div',
    { class: 'globe__tag', role: 'status', 'aria-live': 'off' },
    el('span', { class: 'globe__tag-dot', 'aria-hidden': 'true' }),
    tagLabel
  );
  const host = el('div', { class: 'globe' }, canvas, tag);

  // --- B3: yacht viewport chrome (pointer-events:none overlay DOM) ----------
  // A bezel hull ring + interior vignette, a swept glass streak, and a lip strip
  // hosting the live telemetry line. CSS owns all the cosmetics; the telemetry
  // text is written ONLY in tickChrome (1 Hz, regime-aware, only on change).
  const bezel = el('div', { class: 'globe__bezel', 'aria-hidden': 'true' });
  const glass = el('div', { class: 'globe__glass', 'aria-hidden': 'true' });
  const telem = el('span', { class: 'globe__telem-label', text: 'ISS // SYNC' });
  const lip = el(
    'div',
    { class: 'globe__lip', 'aria-hidden': 'true' },
    el(
      'div',
      { class: 'globe__telem' },
      el('span', { class: 'globe__telem-dot' }),
      telem
    )
  );
  host.append(bezel, glass, lip);
  mount(container, host);

  const c2d = canvas.getContext('2d', { alpha: true });
  if (!c2d) return; // no canvas support: leave the styled host, do not crash
  const g: CanvasRenderingContext2D = c2d;

  const reducedMotion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // --- sizing (devicePixelRatio aware) -------------------------------------
  let w = 0;
  let h = 0;
  let dpr = 1;
  let R = 100; // globe radius in CSS px
  let cx = 0;
  let cy = 0;

  // --- theme (sampled from tokens so pump/dump recolors the accents) -------
  let accent = '#22e3ff';
  let accent2 = '#ff3df0';
  let arcStyle = accent2;
  let hubStyle = accent;

  // --- live data splice (center asset mood + Fear & Greed) -----------------
  // moodBand: 0 dump / 1 soft / 2 warm / 3 pump. A band change rebuilds the
  // sphere rim; the center quote feeds the uplink readout; fng tints the night.
  let moodBand = 2;
  let prevMoodBand = 2;
  let centerPrice: number | null = null;
  let centerChange: number | null = null;
  let centerSymbol = 'BTC';
  let fngValue = 50;
  let limbPulseAt = -10; // scene seconds of the last candle-driven limb pulse

  // --- B1: live satellites (Celestrak elements, propagated via core/orbits) --
  // satConsts is rebuilt on every 'sats' store push (deriveConst per element,
  // capped at SAT_CAP with stations + gps-ops kept whole, visual filling the
  // remaining slots (see rebuildSats). prev/next
  // hold the last two 250 ms propagation snapshots (x,y,z,altRatio packed) and the
  // frame loop lerps + renormalizes between them. satTrails is a flat earth-fixed
  // ring buffer (TRAIL_N samples of x,y,z,lift) projected per frame so drags and
  // spins never smear the trails (Part R3). issIndex tracks NORAD 25544; its
  // ALT/VEL telemetry is sampled once a second in tickChrome.
  let satConsts: SatConst[] = [];
  let satGroups: Uint8Array = new Uint8Array(0); // 0 stations, 1 visual, 2 gps
  let satCount = 0;
  let satPrev = new Float32Array(0); // count * 4 (x,y,z,altRatio)
  let satNext = new Float32Array(0);
  let satTrails = new Float32Array(0); // count * TRAIL_N * 4 (x,y,z,lift)
  let satTrailHead = 0; // ring write cursor (shared across sats)
  let satTrailFill = 0; // how many trail slots are populated (0..TRAIL_N)
  let satSampleAt = -1; // scene seconds of the last 250 ms sample
  let satTrailAt = -1; // scene seconds of the last trail write
  let issIndex = -1;
  let issAltKm = 0;
  let issVelKms = 0;
  let issValid = false;
  const satTmp: SatState = { x: 0, y: 0, z: 0, altRatio: 0 };
  // Hoisted GMST cos/sin from the last sampleSats() so drawOrbits() can do the
  // same ECI -> ECEF (-GMST about Z) rotation without re-deriving the time (RZ2).
  let satCg = 1;
  let satSg = 0;
  // Wall-clock seconds for the satellite sample throttle + interpolation phase
  // (H5b): unlike the scene clock this keeps advancing across a tab-away, so the
  // first frame back resamples on real elapsed time instead of slewing trails.
  const satNow = (): number =>
    (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()) / 1000;

  // --- R14.1: satellite orbit lines (analytic ellipses, RZ2) -----------------
  // Per representative orbit we store the ECI orbit-plane normal h_hat =
  // Rz(O)*Rx(i)*zhat = (si*sO, -si*cO, ci), the altitude ratio (a/R_EARTH) and a
  // group index, all rebuilt on a 'sats' push in rebuildSats() and capped at
  // ORBIT_LINE_CAP. ORBISS flags the one ISS ring (drawn last, brightest). The
  // list is grouped so strokeStyle is set a few times, not per ring.
  let orbN = new Float32Array(0); // orbCount * 3 (nx,ny,nz)
  let orbAR = new Float32Array(0); // orbCount (a / R_EARTH)
  let orbGrp = new Uint8Array(0); // orbCount (0 stations, 1 visual, 2 gps)
  let orbIss = new Uint8Array(0); // orbCount (1 for the ISS ring)
  let orbCount = 0;

  // --- B4: zoom state (wheel-driven recede through Earth / Moon / Sol) -------
  let zoom = 0;
  let zoomTarget = 0;
  let eclipticAz = 0; // solar-regime yaw (drag in S)
  let prevRegime: Regime = 'E';
  // crossfades, recomputed once per frame in draw()
  let aE = 1;
  let aC = 0;
  let aS = 0;
  let aG = 0; // Milky Way band
  let aX = 0; // Local Group band
  let aU = 0; // observable-universe band
  let aM = 0; // multiverse band (merging universe bubbles)
  let aP = 0; // dimensional-planes band (stacked branes) -- terminal regime
  let Rearth = R; // receded Earth radius for the dot/hub/arc/sun blocks

  // --- B5 cache: Moon vector + range, recomputed at 1 Hz in tickChrome -------
  let moonX = 0;
  let moonY = 0;
  let moonZ = 1;
  let moonRangeKm = MOON_DIST_KM;
  // --- B6 cache: heliocentric planet positions (AU), recomputed at 1 Hz ------
  const planetX = new Float64Array(PLANETS.length);
  const planetY = new Float64Array(PLANETS.length);
  const planetZ = new Float64Array(PLANETS.length);
  const planetR = new Float64Array(PLANETS.length); // heliocentric distance, AU
  let earthAu = 1; // Earth's heliocentric distance for the S telemetry line
  // per-frame projection scratch for the solar pass (no per-frame allocation)
  const solarSX = new Float64Array(PLANETS.length);
  const solarSY = new Float64Array(PLANETS.length);
  const solarZBuf = new Float64Array(PLANETS.length);

  /** Current viewport regime from the eased zoom (RZ1 buckets at the crossfade
   * midpoints: E<0.7 C<1.3 S<2.05 G<3.10 X<4.15 U<4.95 M<5.70 else P). */
  function regime(): Regime {
    return zoom < 0.7
      ? 'E'
      : zoom < 1.3
        ? 'C'
        : zoom < 2.05
          ? 'S'
          : zoom < 3.1
            ? 'G'
            : zoom < 4.15
              ? 'X'
              : zoom < 4.95
                ? 'U'
                : zoom < 5.7
                  ? 'M'
                  : 'P';
  }

  // --- prerendered layers (rebuilt on resize / theme change; never per frame)
  const sphere = document.createElement('canvas');
  let sphereSize = 0;
  const sunSprite = document.createElement('canvas');

  // --- R14.3: cosmic-ladder offscreen art (built lazily on first band entry) ---
  // Each canvas is built once per entry/resize; resize() invalidates the flags so
  // the art rebuilds at the new size on the next entry (mount stays cosmic-free).
  // buildCluster reuses galaxyCv as its member sprite. At most one heavy canvas
  // is built per frame (sequenceCosmic).
  const galaxyCv = document.createElement('canvas');
  const clusterCv = document.createElement('canvas');
  const webCv = document.createElement('canvas');
  const multiCv = document.createElement('canvas'); // stage 2: multiverse bubbles
  let galaxyPx = 0;
  let clusterPx = 0;
  let webPx = 0;
  let multiPx = 0;
  let galaxyBuilt = false;
  let clusterBuilt = false;
  let webBuilt = false;
  let multiBuilt = false;
  let galaxyPrewarmed = false; // requestIdleCallback prewarm fired once after mount
  // SOL marker on the Orion Spur: stored canvas-center-relative, projected per
  // frame; galaxySunScreenX/Y are refreshed at the top of draw() (RZ7) so the
  // S->G sun handoff in drawSolar (called first) never reads a stale value.
  let galaxySunX = 0;
  let galaxySunY = 0;
  let galaxySunScreenX = 0;
  let galaxySunScreenY = 0;
  // 4 baked galaxy glint positions (canvas-center-relative) + phases.
  const galGlintX = new Float32Array(GAL_GLINT_N);
  const galGlintY = new Float32Array(GAL_GLINT_N);
  const galGlintPh = new Float32Array(GAL_GLINT_N);
  // cluster: Milky Way home position (canvas-center-relative) + two breathing cores.
  let clusterHomeX = 0;
  let clusterHomeY = 0;
  let clusterM31X = 0;
  let clusterM31Y = 0;
  // cosmic web: Laniakea home + 4 supercluster-knot glint positions + phases.
  let webHomeX = 0;
  let webHomeY = 0;
  const webGlintX = new Float32Array(WEB_GLINT_N);
  const webGlintY = new Float32Array(WEB_GLINT_N);
  const webGlintPh = new Float32Array(WEB_GLINT_N);
  // multiverse (M): each bubble's baked home center (canvas-center-relative),
  // radius (canvas px), tint index, and a drift phase so it slides slowly so the
  // bubbles merge and part. Built once in buildMultiverse; the seam shimmer is
  // computed live each frame from the per-frame drifted centers.
  const multiHomeX = new Float32Array(MULTI_BUBBLE_N);
  const multiHomeY = new Float32Array(MULTI_BUBBLE_N);
  const multiR = new Float32Array(MULTI_BUBBLE_N);
  const multiTint = new Uint8Array(MULTI_BUBBLE_N);
  const multiDriftPh = new Float32Array(MULTI_BUBBLE_N);
  const multiDriftAmp = new Float32Array(MULTI_BUBBLE_N); // canvas px
  // per-frame drifted screen centers (scratch; hoisted so drawMultiverse never
  // allocates per frame).
  const multiScreenX = new Float32Array(MULTI_BUBBLE_N);
  const multiScreenY = new Float32Array(MULTI_BUBBLE_N);
  // dimensional planes (P): per-plane baked depth z (-1..1), tilt, yaw and a phase
  // so each brane sits at its own orientation; rotation rides clock when not
  // reduced. Built once on first entry (cheap line work, but stable layout).
  let planesBuilt = false;
  const planeZ = new Float32Array(PLANE_N);
  const planeTilt = new Float32Array(PLANE_N);
  const planeYaw = new Float32Array(PLANE_N);
  const planeOrder = new Int32Array(PLANE_N);

  // --- dot glow sprites (one offscreen radial-gradient canvas per rgba style)
  // Source of truth is the rgba STRING tables (DAY/NIGHT/TERM/DIM); the
  // sprites are derived from them at resize time (they need R and dpr). The
  // frame loop only indexes a sprite and draws it, never builds a string.
  type Sprite = HTMLCanvasElement;
  let daySprites: Sprite[] = [];
  let nightSprites: Sprite[] = [];
  let termSprites: Sprite[][] = [];
  let dimSprite: Sprite | null = null;
  let spriteCssDia = 4; // nominal sprite footprint in CSS px (glow halo included)
  // B6 planet glow sprites (one per PLANETS entry), rebuilt on resize.
  let planetSprites: Sprite[] = [];

  /** Build one glow-dot sprite from an `rgba(...)` style string. */
  function makeSprite(styleString: string): Sprite {
    const cv = document.createElement('canvas');
    // device-px backing size: the full haloed footprint at dpr, forced even.
    let px = Math.max(2, Math.ceil(spriteCssDia * dpr));
    if (px % 2 !== 0) px += 1;
    cv.width = px;
    cv.height = px;
    const sg = cv.getContext('2d');
    if (!sg) return cv; // blank canvas when 2d is unavailable
    const [r, gC, b, a] = parseRgba(styleString);
    const c = px / 2;
    const grad = sg.createRadialGradient(c, c, 0, c, c, c);
    grad.addColorStop(0.0, rgba(r, gC, b, a));
    grad.addColorStop(0.45, rgba(r, gC, b, 0.55 * a));
    grad.addColorStop(0.75, rgba(r, gC, b, 0.18 * a));
    grad.addColorStop(1.0, rgba(r, gC, b, 0));
    sg.fillStyle = grad;
    sg.fillRect(0, 0, px, px);
    return cv;
  }

  /** Build a colored planet glow sprite: bright core fading to a soft halo. */
  function makePlanetSprite(hex: string, cssDia: number): Sprite {
    const cv = document.createElement('canvas');
    let px = Math.max(4, Math.ceil(cssDia * 2.4 * dpr));
    if (px % 2 !== 0) px += 1;
    cv.width = px;
    cv.height = px;
    const sg = cv.getContext('2d');
    if (!sg) return cv;
    const c = px / 2;
    const grad = sg.createRadialGradient(c, c, 0, c, c, c);
    grad.addColorStop(0.0, withAlpha(hex, 1));
    grad.addColorStop(0.32, withAlpha(hex, 0.85));
    grad.addColorStop(0.6, withAlpha(hex, 0.3));
    grad.addColorStop(1.0, withAlpha(hex, 0));
    sg.fillStyle = grad;
    sg.fillRect(0, 0, px, px);
    return cv;
  }

  /** Lerp the night RGB from the Fear & Greed reading (piecewise FEAR/NEUTRAL/GREED). */
  function fngNightRgb(fng: number): [number, number, number] {
    const v = Math.max(0, Math.min(100, fng));
    const lo = v <= 50 ? FNG_FEAR_RGB : FNG_NEUTRAL_RGB;
    const hi = v <= 50 ? FNG_NEUTRAL_RGB : FNG_GREED_RGB;
    const t = v <= 50 ? v / 50 : (v - 50) / 50;
    return [
      lo[0] + (hi[0] - lo[0]) * t,
      lo[1] + (hi[1] - lo[1]) * t,
      lo[2] + (hi[2] - lo[2]) * t
    ];
  }

  /** Rebuild ONLY the 4 night sprites from the live Fear & Greed value. */
  function rebuildNightSprites(fng: number): void {
    const [r, gC, b] = fngNightRgb(fng);
    nightSprites = NIGHT_A.map((a) => makeSprite(rgba(r, gC, b, a)));
  }

  /** Rebuild every dot sprite (sized to the current R/dpr); called from resize(). */
  function buildSprites(): void {
    const sRad = 2 * Math.sqrt(Math.PI / SPHERE_N); // ~0.0272 (unit-sphere dot radius)
    const dotDia = Math.max(2.2, Math.min(9, sRad * R * 1.7)); // nominal CSS px diameter
    spriteCssDia = dotDia * 1.6; // include the glow halo
    daySprites = DAY_STYLES.map((s) => makeSprite(s));
    rebuildNightSprites(fngValue); // honor the live mood, not the neutral baseline
    termSprites = TERM_STYLES.map((row) => row.map((s) => makeSprite(s)));
    dimSprite = makeSprite(DIM_STYLE);
    planetSprites = PLANETS.map((p) => makePlanetSprite(p.color, p.size));
  }

  function rebuildSunSprite(): void {
    const s = 96;
    sunSprite.width = s;
    sunSprite.height = s;
    const sg = sunSprite.getContext('2d');
    if (!sg) return;
    const grad = sg.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grad.addColorStop(0, 'rgba(255, 246, 220, 0.95)');
    grad.addColorStop(0.3, 'rgba(255, 208, 110, 0.5)');
    grad.addColorStop(1, 'rgba(255, 180, 60, 0)');
    sg.fillStyle = grad;
    sg.fillRect(0, 0, s, s);
  }

  /** Ocean disc + accent atmosphere rim, drawn once per resize/recolor. */
  function rebuildSphere(): void {
    const pad = Math.ceil(R * 0.4) + 8;
    sphereSize = Math.max(2, Math.ceil((R + pad) * 2));
    sphere.width = Math.max(1, Math.round(sphereSize * dpr));
    sphere.height = sphere.width;
    const sg = sphere.getContext('2d');
    if (!sg) return;
    sg.setTransform(dpr, 0, 0, dpr, 0, 0);
    const c = sphereSize / 2;
    // ocean disc (opaque)
    const ocean = sg.createRadialGradient(c - R * 0.25, c - R * 0.3, R * 0.1, c, c, R);
    ocean.addColorStop(0, 'rgba(16, 26, 56, 0.96)');
    ocean.addColorStop(0.7, 'rgba(8, 14, 34, 0.97)');
    ocean.addColorStop(1, 'rgba(4, 7, 18, 0.98)');
    sg.fillStyle = ocean;
    sg.beginPath();
    sg.arc(c, c, R, 0, TAU);
    sg.fill();
    // accent atmosphere rim. Market mood warms/cools the rim (and reddens on a
    // dump); the terminator palette stays frozen.
    const rimMul = MOOD_RIM[moodBand];
    const rimColor = moodBand === 0 ? DUMP_RIM : accent;
    sg.globalCompositeOperation = 'lighter';
    const rim = sg.createRadialGradient(c, c, R * 0.84, c, c, R + pad);
    rim.addColorStop(0, 'rgba(0, 0, 0, 0)');
    rim.addColorStop(0.42, withAlpha(rimColor, 0.14 * rimMul));
    rim.addColorStop(0.56, withAlpha(rimColor, 0.08 * rimMul));
    rim.addColorStop(1, 'rgba(0, 0, 0, 0)');
    sg.fillStyle = rim;
    sg.fillRect(0, 0, sphereSize, sphereSize);
    // thin limb line
    sg.strokeStyle = withAlpha(accent, 0.3);
    sg.lineWidth = 1;
    sg.beginPath();
    sg.arc(c, c, R + 0.5, 0, TAU);
    sg.stroke();
  }

  const sampleTheme = (): void => {
    const a = cssColor('--accent', '#22e3ff');
    const a2 = cssColor('--accent-2', '#ff3df0');
    if (a === accent && a2 === accent2) return;
    accent = a;
    accent2 = a2;
    arcStyle = accent2;
    hubStyle = accent;
    rebuildSphere();
  };

  /** Set the telemetry lip line, only when it changes (B3/B7, regime-aware). */
  function setTelem(text: string): void {
    if (telem.textContent !== text) telem.textContent = text;
  }

  // 1 s chrome tick: resample the theme, refresh the 1 Hz ephemerides (Moon +
  // planets + ISS telemetry), cycle the uplink readout (Earth view only), and
  // update the regime-aware telemetry line.
  function tickChrome(): void {
    sampleTheme();
    const reg = regime();

    // 1 Hz ephemerides: the frame loop only projects these cached vectors (R6).
    computeMoon();
    computePlanets();
    // ISS ALT/VEL once a second (only if NORAD 25544 is in the current set).
    if (issIndex >= 0 && issIndex < satConsts.length) {
      const t = telemetry(satConsts[issIndex], Date.now());
      issAltKm = t.altKm;
      issVelKms = t.velKms;
      issValid = true;
    } else {
      issValid = false;
    }

    // On a regime change, write the fixed tag line once (B7/RZ4). Leaving E
    // repaints the current cycle line immediately so the price tag is never
    // stale.
    if (reg !== prevRegime) {
      if (reg === 'C') tagLabel.textContent = 'LUNAR ORBIT // 384400 KM';
      else if (reg === 'S') tagLabel.textContent = 'SOL SYSTEM // LIVE EPHEMERIS';
      else if (reg === 'G') tagLabel.textContent = CHROME_G_TAG;
      else if (reg === 'X') tagLabel.textContent = CHROME_X_TAG;
      else if (reg === 'U') tagLabel.textContent = CHROME_U_TAG;
      else if (reg === 'M') tagLabel.textContent = CHROME_M_TAG;
      else if (reg === 'P') tagLabel.textContent = CHROME_P_TAG;
      else {
        const cur = tagShowingB ? tagLineB : tagLineA;
        if (tagLabel.textContent !== cur) tagLabel.textContent = cur;
      }
      prevRegime = reg;
    }

    // Uplink A/B readout cycles only in the Earth view (B7 flip guard).
    if (!reducedMotion && reg === 'E') {
      tagFlipTick++;
      if (tagFlipTick >= TAG_CYCLE_SEC) {
        tagFlipTick = 0;
        tagShowingB = !tagShowingB;
        const next = tagShowingB ? tagLineB : tagLineA;
        if (tagLabel.textContent !== next) tagLabel.textContent = next;
      }
    }

    // Telemetry lip line, per regime, written only on change (RZ4).
    if (reg === 'C') {
      setTelem('LUNA // RANGE ' + Math.round(moonRangeKm) + ' KM');
    } else if (reg === 'S') {
      setTelem('EARTH // ' + earthAu.toFixed(3) + ' AU FROM SOL');
    } else if (reg === 'G') {
      setTelem(CHROME_G_TELEM);
    } else if (reg === 'X') {
      setTelem(CHROME_X_TELEM);
    } else if (reg === 'U') {
      setTelem(CHROME_U_TELEM);
    } else if (reg === 'M') {
      setTelem(CHROME_M_TELEM);
    } else if (reg === 'P') {
      setTelem(CHROME_P_TELEM);
    } else if (issValid) {
      setTelem('ISS // ALT ' + Math.round(issAltKm) + ' KM // VEL ' + issVelKms.toFixed(2) + ' KM/S');
    } else {
      setTelem('ISS // SYNC');
    }
  }
  const themeId = window.setInterval(tickChrome, 1000);

  function resize(): void {
    const rect = host.getBoundingClientRect();
    w = Math.max(1, Math.round(rect.width));
    h = Math.max(1, Math.round(rect.height));
    dpr = Math.min(MAX_DPR, Math.max(1, window.devicePixelRatio || 1));
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    R = Math.max(30, Math.min(w, h) * 0.42);
    cx = w / 2;
    cy = h * 0.52;
    rebuildSphere();
    buildSprites();
    // Invalidate the cosmic art so it rebuilds at the new size on the next band
    // entry (RZ3). Resize stays cosmic-free so it never blocks a window drag.
    galaxyBuilt = false;
    clusterBuilt = false;
    webBuilt = false;
    multiBuilt = false;
    planesBuilt = false;
  }

  // --- real sun position (allocation-free; called once per frame) ----------
  let sunX = 1;
  let sunY = 0;
  let sunZ = 0;
  function computeSun(): void {
    const days = Date.now() / 86400000; // days since the UTC epoch
    const hours = (days - Math.floor(days)) * 24;
    // declination from a day-of-year approximation (epoch starts Jan 1, and the
    // mean-year modulo keeps alignment to within hours over decades).
    const doy = days % 365.2425;
    const decl = -23.44 * Math.cos((TAU * (doy + 10)) / 365.2425) * D2R;
    const lonSub = (12 - hours) * 15 * D2R; // subsolar longitude (hour angle)
    const cd = Math.cos(decl);
    sunX = cd * Math.cos(lonSub);
    sunY = Math.sin(decl);
    sunZ = cd * Math.sin(lonSub);
  }
  computeSun();

  // --- rotation state -------------------------------------------------------
  // Visible center longitude = lonOffset + 90 deg; start facing the day side.
  let lonOffset = Math.atan2(sunZ, sunX) - Math.PI / 2;
  let tilt = 0.3; // slight north tilt at mount
  let velLon = 0;
  let velTilt = 0;
  let dragging = false;
  let spinBlend = 1;
  let resumeAt = 0;
  let devSpin: number | null = null;

  // --- critically damped sun (view-space) ----------------------------------
  // The off-globe sun glow eases toward its view-space target with tau = 0.18 s
  // so it drifts smoothly instead of snapping each frame. Seeded at mount below.
  let ssx = 0;
  let ssy = 0;
  let ssz = 0;
  let sunSmoothInit = false;

  // Seed the smoothed sun from the mount-time orientation so the FIRST draw()
  // (which runs before any step()) reads a settled value, not (0,0,0).
  {
    const cosT = Math.cos(lonOffset);
    const sinT = Math.sin(lonOffset);
    const cosP = Math.cos(tilt);
    const sinP = Math.sin(tilt);
    const tsx = sunX * cosT + sunZ * sinT;
    const tz1 = -sunX * sinT + sunZ * cosT;
    ssx = tsx;
    ssy = sunY * cosP - tz1 * sinP;
    ssz = sunY * sinP + tz1 * cosP;
    sunSmoothInit = true;
  }

  const clampTilt = (v: number): number => Math.max(-MAX_TILT, Math.min(MAX_TILT, v));

  // --- arc pool (preallocated; spawn writes into a free slot) ---------------
  const arcPts = new Float32Array(ARC_POOL * ARC_N * 3);
  const arcOn = new Uint8Array(ARC_POOL);
  const arcBorn = new Float32Array(ARC_POOL);
  const arcDur = new Float32Array(ARC_POOL);

  let clock = 0; // scene seconds (only advances while visible)
  let nextIdleAt = 1.5 + Math.random() * 2;
  let lastEventArcAt = -10;

  // --- meteor pool (preallocated; spawn writes into a free slot) ------------
  // Each meteor is a screen-space straight-line streak from an off-disc start
  // point to a TARGET on the visible front hemisphere of the Earth disc. State
  // is packed in parallel typed arrays so the draw loop never allocates: start
  // x/y, target x/y, born time, flight duration, and an on flag. On impact a
  // shockwave ring is borrowed from the ring pool and the meteor returns free.
  const metOn = new Uint8Array(METEOR_POOL);
  const metSX = new Float32Array(METEOR_POOL); // start screen x (off-disc)
  const metSY = new Float32Array(METEOR_POOL);
  const metTX = new Float32Array(METEOR_POOL); // target screen x (impact point)
  const metTY = new Float32Array(METEOR_POOL);
  const metBorn = new Float32Array(METEOR_POOL);
  const metDur = new Float32Array(METEOR_POOL);
  // impact shockwave rings: center x/y, born time, on flag. Radius + alpha are
  // derived from age in the draw pass (clipped to the Earth disc).
  const ringOn = new Uint8Array(METEOR_RING_POOL);
  const ringX = new Float32Array(METEOR_RING_POOL);
  const ringY = new Float32Array(METEOR_RING_POOL);
  const ringBorn = new Float32Array(METEOR_RING_POOL);
  // scheduler: scene-seconds timestamp of the next meteor spawn attempt.
  let nextMeteorAt = METEOR_MIN_SEC + Math.random() * (METEOR_MAX_SEC - METEOR_MIN_SEC);

  /** Count of active meteors (dev hook). */
  function activeMeteors(): number {
    let n = 0;
    for (let s = 0; s < METEOR_POOL; s++) if (metOn[s]) n++;
    return n;
  }

  /** Spawn one meteor now into a free slot (no-op if the pool is full or the
   * geometry is degenerate). Target is a random point within METEOR_TARGET_FRAC
   * of the disc center so it lands on the sphere face; start is off the disc at a
   * random angle, METEOR_START_MUL * Rearth out, biased to come in toward the
   * target. Screen-space (cx/cy/Rearth are the live receded globe geometry). */
  function spawnMeteor(): void {
    let free = -1;
    for (let s = 0; s < METEOR_POOL; s++) {
      if (!metOn[s]) {
        free = s;
        break;
      }
    }
    if (free < 0 || Rearth <= 1) return;
    // target on the visible front hemisphere (within METEOR_TARGET_FRAC*Rearth).
    const tAng = Math.random() * TAU;
    const tRad = Math.sqrt(Math.random()) * METEOR_TARGET_FRAC * Rearth;
    const tx = cx + Math.cos(tAng) * tRad;
    const ty = cy + Math.sin(tAng) * tRad;
    // start off the disc at a random heading, a bit beyond the limb.
    const sAng = Math.random() * TAU;
    const sx = cx + Math.cos(sAng) * METEOR_START_MUL * Rearth;
    const sy = cy + Math.sin(sAng) * METEOR_START_MUL * Rearth;
    metSX[free] = sx;
    metSY[free] = sy;
    metTX[free] = tx;
    metTY[free] = ty;
    metBorn[free] = clock;
    metDur[free] = METEOR_FLIGHT_MIN + Math.random() * (METEOR_FLIGHT_MAX - METEOR_FLIGHT_MIN);
    metOn[free] = 1;
  }

  /** Borrow a free impact-ring slot and seed it at (x, y) now. */
  function spawnImpactRing(x: number, y: number): void {
    let free = -1;
    for (let s = 0; s < METEOR_RING_POOL; s++) {
      if (!ringOn[s]) {
        free = s;
        break;
      }
    }
    if (free < 0) return;
    ringX[free] = x;
    ringY[free] = y;
    ringBorn[free] = clock;
    ringOn[free] = 1;
  }

  function activeArcs(): number {
    let n = 0;
    for (let s = 0; s < ARC_POOL; s++) if (arcOn[s]) n++;
    return n;
  }

  function spawnArc(): void {
    const cap = 6;
    let free = -1;
    let active = 0;
    for (let s = 0; s < ARC_POOL; s++) {
      if (arcOn[s]) active++;
      else if (free < 0) free = s;
    }
    if (free < 0 || active >= cap) return;
    const a = (Math.random() * HUB_COUNT) | 0;
    const b = (a + 1 + ((Math.random() * (HUB_COUNT - 1)) | 0)) % HUB_COUNT;
    const ax = HUB_V[a * 3];
    const ay = HUB_V[a * 3 + 1];
    const az = HUB_V[a * 3 + 2];
    const bx = HUB_V[b * 3];
    const by = HUB_V[b * 3 + 1];
    const bz = HUB_V[b * 3 + 2];
    const d = Math.max(-1, Math.min(1, ax * bx + ay * by + az * bz));
    const om = Math.acos(d);
    if (om < 0.05) return;
    const so = Math.sin(om);
    const lift = 0.06 + 0.16 * (om / Math.PI);
    const base = free * ARC_N * 3;
    for (let i = 0; i < ARC_N; i++) {
      const u = i / (ARC_N - 1);
      const s1 = Math.sin((1 - u) * om) / so;
      const s2 = Math.sin(u * om) / so;
      const scale = 1 + lift * Math.sin(Math.PI * u);
      arcPts[base + i * 3] = (ax * s1 + bx * s2) * scale;
      arcPts[base + i * 3 + 1] = (ay * s1 + by * s2) * scale;
      arcPts[base + i * 3 + 2] = (az * s1 + bz * s2) * scale;
    }
    arcBorn[free] = clock;
    arcDur[free] = 2 + Math.random() * 1.4;
    arcOn[free] = 1;
  }

  /** Rate-limited arc trigger for real data events (ticker/news pushes). */
  function eventArc(): void {
    if (clock - lastEventArcAt < 0.8) return;
    lastEventArcAt = clock;
    spawnArc();
  }

  // --- uplink readout (layer 1) --------------------------------------------
  // The corner tag cycles between a fixed brand line and the live center-asset
  // price. Reduced motion shows the data line statically (no cycling).
  let tagLineA = 'EARTH UPLINK // LIVE';
  let tagLineB = 'UPLINK // SYNC';
  let tagShowingB = false;
  let tagFlipTick = 0; // counts 1 s tickChrome calls toward the next flip

  function updateTagLines(): void {
    tagLineA = 'EARTH UPLINK // LIVE';
    tagLineB =
      centerPrice == null
        ? 'UPLINK // SYNC'
        : `UPLINK // ${centerSymbol.toUpperCase()} ${formatPrice(centerPrice)} ${pct(centerChange)}`;
    if (reducedMotion) {
      // keep the live data visible (no cycling under reduced motion)
      if (tagLabel.textContent !== tagLineB) tagLabel.textContent = tagLineB;
      return;
    }
    // Hold the live overwrite outside the Earth view so the LUNAR / SOL fixed
    // lines stand.
    if (regime() !== 'E') return;
    if (tagShowingB && tagLabel.textContent !== tagLineB) {
      tagLabel.textContent = tagLineB;
    } else if (!tagShowingB && tagLabel.textContent !== tagLineA) {
      tagLabel.textContent = tagLineA;
    }
  }

  // --- data splice (layers 2-4) --------------------------------------------
  /** Read the live center quote, recompute the mood band, refresh the readout. */
  function recomputeSplice(): void {
    const q = findCenterQuote(store?.get?.('crypto') ?? [], store?.get?.('stocks') ?? []);
    centerPrice = q ? q.price : null;
    centerChange = q ? q.change24h : null;
    if (q && typeof q.symbol === 'string' && q.symbol.length > 0) centerSymbol = q.symbol;
    const ch = centerChange;
    moodBand =
      ch == null ? 2 : ch <= MOOD_DUMP ? 0 : ch < MOOD_SOFT ? 1 : ch < MOOD_PUMP ? 2 : 3;
    updateTagLines();
    if (moodBand !== prevMoodBand) {
      prevMoodBand = moodBand;
      rebuildSphere();
    }
  }

  // --- B1: rebuild satellite constants + buffers on a 'sats' store push ------
  // Per-group quota: stations + gps-ops are kept whole (the adapter caps them
  // at 25 / 35) and visual fills the remaining slots up to SAT_CAP. A plain
  // rank-sort starved gps entirely: live visual alone arrives at the cap (120),
  // so stations + visual filled every slot and the GPS shell never drew.
  // deriveConst once per element; buffers are zeroed and resampled on the next
  // step() tick. Empty pushes (before the data lands) leave the scene sat-free.
  function rebuildSats(list: ReadonlyArray<SatElement>): void {
    const valid = list.filter((s) => s && Number.isFinite(s.meanMotion) && s.meanMotion > 0);
    const stations = valid.filter((s) => s.group === 'stations');
    const gps = valid.filter((s) => s.group === 'gps-ops');
    const visual = valid.filter((s) => s.group !== 'stations' && s.group !== 'gps-ops');
    const room = Math.max(0, SAT_CAP - stations.length - gps.length);
    const kept = [...stations, ...gps, ...visual.slice(0, room)].slice(0, SAT_CAP);
    satCount = kept.length;
    satConsts = kept.map((s) => deriveConst(s));
    satGroups = new Uint8Array(satCount);
    issIndex = -1;
    for (let i = 0; i < satCount; i++) {
      satGroups[i] = kept[i].group === 'stations' ? 0 : kept[i].group === 'visual' ? 1 : 2;
      if (kept[i].noradId === ISS_NORAD) issIndex = i;
    }
    satPrev = new Float32Array(satCount * 4);
    satNext = new Float32Array(satCount * 4);
    satTrails = new Float32Array(satCount * TRAIL_N * 4);
    satTrailHead = 0;
    satTrailFill = 0;
    satSampleAt = -1; // force an immediate resample on the next step()
    satTrailAt = -1;
    issValid = false;
    buildOrbitRings();
  }

  // --- R14.1: pick the orbit rings to draw + precompute their plane normals ---
  // Clutter-free defaults (RZ2): every station orbit, the first 12 visual, every
  // 4th gps up to 8, capped at ORBIT_LINE_CAP total. The ISS ring is always kept
  // and flagged so it strokes last and brightest. GPS planes overlap (6 planes,
  // same a) so subsampling reads as a few clean rings. Buffers are filled grouped
  // (stations, visual, gps) so drawOrbits sets the stroke style only a few times.
  function buildOrbitRings(): void {
    orbCount = 0;
    if (satCount === 0) {
      orbN = new Float32Array(0);
      orbAR = new Float32Array(0);
      orbGrp = new Uint8Array(0);
      orbIss = new Uint8Array(0);
      return;
    }
    const idx: number[] = [];
    let gpsSeen = 0;
    let gpsKept = 0;
    let visualKept = 0;
    // grouped order (stations -> visual -> gps) so the buffers come out grouped
    for (let g0 = 0; g0 < 3 && idx.length < ORBIT_LINE_CAP; g0++) {
      for (let i = 0; i < satCount && idx.length < ORBIT_LINE_CAP; i++) {
        if (satGroups[i] !== g0) continue;
        if (g0 === 0) {
          idx.push(i); // stations: all
        } else if (g0 === 1) {
          if (visualKept < ORBIT_VISUAL_KEEP) {
            idx.push(i);
            visualKept++;
          }
        } else {
          // gps: every Nth, capped
          if (gpsSeen % ORBIT_GPS_STRIDE === 0 && gpsKept < ORBIT_GPS_KEEP) {
            idx.push(i);
            gpsKept++;
          }
          gpsSeen++;
        }
      }
    }
    // ensure the ISS ring is present even if its station slot was bumped by the cap
    if (issIndex >= 0 && !idx.includes(issIndex)) {
      if (idx.length >= ORBIT_LINE_CAP) idx.pop();
      idx.unshift(issIndex);
    }
    orbCount = idx.length;
    orbN = new Float32Array(orbCount * 3);
    orbAR = new Float32Array(orbCount);
    orbGrp = new Uint8Array(orbCount);
    orbIss = new Uint8Array(orbCount);
    for (let r = 0; r < orbCount; r++) {
      const i = idx[r];
      const c = satConsts[i];
      // ECI orbit-plane normal h_hat = Rz(O)*Rx(i)*zhat = (si*sO, -si*cO, ci)
      orbN[r * 3] = c.si * c.sO;
      orbN[r * 3 + 1] = -c.si * c.cO;
      orbN[r * 3 + 2] = c.ci;
      orbAR[r] = c.a / KM_EARTH_R; // altitude ratio (R_EARTH == KM_EARTH_R == 6371)
      orbGrp[r] = satGroups[i];
      orbIss[r] = i === issIndex ? 1 : 0;
    }
  }

  /** Propagate every sat into `satNext` (old next copied into prev) at time t. */
  function sampleSats(t: number): void {
    if (satCount === 0) return;
    satPrev.set(satNext);
    const gm = gmstRad(t);
    const cg = Math.cos(gm);
    const sg = Math.sin(gm);
    satCg = cg; // hoist for drawOrbits (same ECI -> ECEF rotation, no re-derive)
    satSg = sg;
    for (let i = 0; i < satCount; i++) {
      propagate(satConsts[i], t, cg, sg, satTmp);
      const o = i * 4;
      satNext[o] = satTmp.x;
      satNext[o + 1] = satTmp.y;
      satNext[o + 2] = satTmp.z;
      satNext[o + 3] = satTmp.altRatio;
    }
  }

  /** Write one earth-fixed trail sample (current interpolated positions). */
  function writeTrail(phase: number): void {
    if (satCount === 0) return;
    const slot = satTrailHead;
    for (let i = 0; i < satCount; i++) {
      const o = i * 4;
      const px = satPrev[o] + (satNext[o] - satPrev[o]) * phase;
      const py = satPrev[o + 1] + (satNext[o + 1] - satPrev[o + 1]) * phase;
      const pz = satPrev[o + 2] + (satNext[o + 2] - satPrev[o + 2]) * phase;
      const ar = satPrev[o + 3] + (satNext[o + 3] - satPrev[o + 3]) * phase;
      const inv = 1 / Math.max(1e-6, Math.hypot(px, py, pz));
      const w = (i * TRAIL_N + slot) * 4;
      satTrails[w] = px * inv;
      satTrails[w + 1] = py * inv;
      satTrails[w + 2] = pz * inv;
      satTrails[w + 3] = satLift(ar);
    }
    satTrailHead = (satTrailHead + 1) % TRAIL_N;
    if (satTrailFill < TRAIL_N) satTrailFill++;
  }

  // --- B5: Moon position (Schlyter truncated ephemeris), 1 Hz in tickChrome --
  // Returns a unit ecliptic-ish direction in the globe frame + the range in km.
  // The frame remap matches orbits.ts: globe.y = North, globe.z = 90 E meridian.
  function computeMoon(): void {
    const d = Date.now() / 86400000 - 10957.5; // days since the Schlyter epoch 2000 Jan 0.0 (1999-12-31.0 UT)
    const N = (125.1228 - 0.0529538083 * d) * D2R;
    const i = 5.1454 * D2R;
    const w = (318.0634 + 0.1643573223 * d) * D2R;
    const a = 60.2666; // Earth radii
    const e = 0.0549;
    let M = (115.3654 + 13.0649929509 * d) * D2R;
    const Ms = (356.047 + 0.9856002585 * d) * D2R;
    const ws = (282.9404 + 4.70935e-5 * d) * D2R;
    const Ls = ws + Ms;
    // Kepler solve for the Moon's orbit (E0 seed, 4 Newton iters)
    let E = M + e * Math.sin(M) * (1 + e * Math.cos(M));
    for (let it = 0; it < 4; it++) {
      E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    }
    const xv = a * (Math.cos(E) - e);
    const yv = a * Math.sqrt(1 - e * e) * Math.sin(E);
    let r = Math.hypot(xv, yv);
    const v = Math.atan2(yv, xv);
    // ecliptic rectangular (heliocentric of Earth-Moon -> geocentric of Moon)
    const cN = Math.cos(N);
    const sN = Math.sin(N);
    const cvw = Math.cos(v + w);
    const svw = Math.sin(v + w);
    const ci = Math.cos(i);
    const si = Math.sin(i);
    const xh = r * (cN * cvw - sN * svw * ci);
    const yh = r * (sN * cvw + cN * svw * ci);
    const zh = r * (svw * si);
    let lon = Math.atan2(yh, xh);
    let lat = Math.atan2(zh, Math.hypot(xh, yh));
    // perturbation terms (in degrees), the major lunar inequalities
    const Lm = N + w + M; // mean longitude
    const Dm = Lm - Ls; // mean elongation
    const F = Lm - N; // argument of latitude
    lon +=
      (-1.274 * Math.sin(M - 2 * Dm) +
        0.658 * Math.sin(2 * Dm) -
        0.186 * Math.sin(Ms) -
        0.059 * Math.sin(2 * M - 2 * Dm) -
        0.057 * Math.sin(M - 2 * Dm + Ms) +
        0.053 * Math.sin(M + 2 * Dm) +
        0.046 * Math.sin(2 * Dm - Ms) +
        0.041 * Math.sin(M - Ms) -
        0.035 * Math.sin(Dm) -
        0.031 * Math.sin(M + Ms)) *
      D2R;
    lat +=
      (-0.173 * Math.sin(F - 2 * Dm) -
        0.055 * Math.sin(M - F - 2 * Dm) -
        0.046 * Math.sin(M + F - 2 * Dm)) *
      D2R;
    r += -0.58 * Math.cos(M - 2 * Dm) - 0.46 * Math.cos(2 * Dm);
    // unit direction from corrected ecliptic lon/lat, remapped to the globe frame
    const cl = Math.cos(lat);
    const ux = cl * Math.cos(lon);
    const uy = cl * Math.sin(lon);
    const uz = Math.sin(lat);
    // globe frame: North along +Y, 90 E meridian along +Z (matches orbits remap)
    moonX = ux;
    moonY = uz;
    moonZ = uy;
    moonRangeKm = r * KM_EARTH_R;
  }

  // --- B6: heliocentric planet positions (JPL low-precision), 1 Hz -----------
  function computePlanets(): void {
    const JD = Date.now() / 86400000 + 2440587.5;
    const T = (JD - 2451545) / 36525;
    const wrap = (deg: number): number => {
      let x = deg % 360;
      if (x < 0) x += 360;
      return x;
    };
    for (let p = 0; p < PLANETS.length; p++) {
      const el = PLANETS[p];
      const a = el.a + el.aR * T;
      const e = el.e + el.eR * T;
      const I = (el.I + el.IR * T) * D2R;
      const L = el.L + el.LR * T;
      const wbar = el.wbar + el.wbarR * T;
      const Om = (el.Om + el.OmR * T) * D2R;
      const w = (wbar - (el.Om + el.OmR * T)) * D2R; // argument of perihelion
      let M = wrap(L - wbar) * D2R;
      if (M > Math.PI) M -= TAU;
      // Newton solve (same as orbits.ts: seed E=M, 4 iters)
      let E = M;
      for (let it = 0; it < 4; it++) {
        E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
      }
      // orbital-plane coords
      const xo = a * (Math.cos(E) - e);
      const yo = a * Math.sqrt(1 - e * e) * Math.sin(E);
      // rotate by w (in-plane), I (inclination), Om (node) to ecliptic X/Y/Z
      const cw = Math.cos(w);
      const sw = Math.sin(w);
      const cO = Math.cos(Om);
      const sO = Math.sin(Om);
      const cI = Math.cos(I);
      const sI = Math.sin(I);
      const X = (cw * cO - sw * sO * cI) * xo + (-sw * cO - cw * sO * cI) * yo;
      const Y = (cw * sO + sw * cO * cI) * xo + (-sw * sO + cw * cO * cI) * yo;
      const Z = sw * sI * xo + cw * sI * yo;
      planetX[p] = X;
      planetY[p] = Y;
      planetZ[p] = Z;
      planetR[p] = Math.hypot(X, Y, Z);
    }
    earthAu = planetR[2];
  }

  // --- animation loop (single rAF, pauses on hidden) ------------------------
  let rafId = 0;
  let running = false;
  let lastTs = 0;
  let lastFrameDt = 0.016; // seconds; read by the holo jitter probability

  function step(dt: number): void {
    if (!dragging) {
      if (velLon !== 0 || velTilt !== 0) {
        lonOffset += velLon * dt;
        tilt = clampTilt(tilt + velTilt * dt);
        const decay = Math.exp(-2.6 * dt);
        velLon *= decay;
        velTilt *= decay;
        if (Math.abs(velLon) < 0.001) velLon = 0;
        if (Math.abs(velTilt) < 0.001) velTilt = 0;
      }
      // auto-spin eases back in a few seconds after a drag ends. Reduced motion
      // gets no auto-spin (the QA override still applies for dev checks). The spin
      // fades out with the Earth as you zoom away (B4: x 0.4 + 0.6*aE).
      const target = devSpin !== null ? devSpin : reducedMotion ? 0 : BASE_SPIN;
      if (clock >= resumeAt) spinBlend = Math.min(1, spinBlend + dt / 2.6);
      lonOffset += target * spinBlend * (0.4 + 0.6 * aE) * dt;
    }
    if (lonOffset > TAU * 2) lonOffset -= TAU;
    else if (lonOffset < -TAU * 2) lonOffset += TAU;

    // critically damped view-space sun: draw() reads ssx/ssy/ssz so the glow
    // drifts smoothly. Compute the same projection draw() used to do inline.
    {
      computeSun();
      const cosT = Math.cos(lonOffset);
      const sinT = Math.sin(lonOffset);
      const cosP = Math.cos(tilt);
      const sinP = Math.sin(tilt);
      const tsx = sunX * cosT + sunZ * sinT;
      const tz1 = -sunX * sinT + sunZ * cosT;
      const tsy = sunY * cosP - tz1 * sinP;
      const tsz = sunY * sinP + tz1 * cosP;
      if (!sunSmoothInit) {
        ssx = tsx;
        ssy = tsy;
        ssz = tsz;
        sunSmoothInit = true;
      } else {
        const a = 1 - Math.exp(-dt / 0.18); // tau = 0.18 s
        ssx += (tsx - ssx) * a;
        ssy += (tsy - ssy) * a;
        ssz += (tsz - ssz) * a;
      }
    }

    // idle heartbeat so the uplink never looks dead; cadence tracks the mood.
    if (clock >= nextIdleAt) {
      spawnArc();
      nextIdleAt = clock + MOOD_IDLE[moodBand] + Math.random() * 2.5;
    }

    // meteor scheduler: occasional strike on the globe, Earth-view only, never
    // under reduced motion (early return like the other auto-motion). aE is the
    // crossfade computed in draw(); we read last frame's value, which is settled
    // since draw() runs right after step() each frame.
    if (!reducedMotion && clock >= nextMeteorAt) {
      if (aE > METEOR_AE_GATE) spawnMeteor();
      // reschedule whether or not we fired (so we don't spam attempts when zoomed
      // out, but resume promptly once back in the Earth view).
      nextMeteorAt = clock + METEOR_MIN_SEC + Math.random() * (METEOR_MAX_SEC - METEOR_MIN_SEC);
    }

    // --- B4 zoom ease: critically damped toward zoomTarget (snaps if reduced) -
    if (reducedMotion) {
      zoom = zoomTarget;
    } else if (zoom !== zoomTarget) {
      const a = 1 - Math.exp(-dt / ZOOM_TAU);
      zoom += (zoomTarget - zoom) * a;
      if (Math.abs(zoomTarget - zoom) < 1e-4) zoom = zoomTarget;
    }

    // --- B1 satellite sampling: 250 ms snapshots + earth-fixed trail writes ---
    // H5(b): the throttle + interpolation phase ride a WALL-CLOCK timestamp
    // (satNow(), performance.now-based) rather than the scene clock. The scene
    // clock pauses with the rAF loop on a tab-away, so on return it would only
    // have advanced a sliver while Date.now() jumped minutes; gating on wall time
    // resamples cleanly and the phase never overshoots and slews the trails. The
    // first sample seeds both prev and next so the very first frame has no jump.
    if (satCount > 0) {
      const sw = satNow();
      if (satSampleAt < 0) {
        sampleSats(Date.now());
        satPrev.set(satNext); // seed: no lerp jump on the first frame
        satSampleAt = sw;
      } else if (sw - satSampleAt >= SAT_SAMPLE_MS / 1000) {
        sampleSats(Date.now());
        satSampleAt = sw;
      }
      if (satTrailAt < 0 || sw - satTrailAt >= SAT_TRAIL_DT) {
        const phase = Math.min(1, (sw - satSampleAt) / (SAT_SAMPLE_MS / 1000));
        writeTrail(phase);
        satTrailAt = sw;
      }
    }
  }

  function frame(ts: number): void {
    if (!running) return;
    const dtMs = lastTs ? ts - lastTs : 16;
    lastTs = ts;
    const dt = Math.min(0.05, Math.max(0, dtMs / 1000));
    lastFrameDt = dt;
    clock += dt;
    step(dt);
    draw();
    rafId = requestAnimationFrame(frame);
  }

  function start(): void {
    if (running || document.hidden) return;
    running = true;
    lastTs = 0;
    rafId = requestAnimationFrame(frame);
  }

  function stop(): void {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  // --- the actual paint ------------------------------------------------------
  function draw(): void {
    // soft trail-clear: a hint of glow persistence on arcs without smearing dots
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = 'rgba(2, 3, 10, 0.6)';
    g.fillRect(0, 0, w, h);

    // --- B4 crossfades + Earth recede (computed once per frame) ---------------
    // aE/aC/aS/aG/aX/aU/aM/aP gate the eight regimes; the dot/hub/arc/sun blocks
    // ride aE and shrink to Rearth as the Earth pulls back. The whole Earth dot
    // loop is skipped (alpha-faded first) below 0.02 so nothing pops at the cutoff.
    const z = zoom;
    aE = 1 - smoothstep(0.55, 0.95, z);
    aC = smoothstep(0.55, 0.95, z) * (1 - smoothstep(1.1, 1.45, z));
    // RZ1 bands. S now dies into G via the trailing factor (for z<=1.75 it is
    // exactly 1, so S is byte-identical in its old operating range). The cosmic
    // bands crossfade on the same z with the RZ1 overlaps. E..U are unchanged:
    // U keeps its 3.95-4.3 onset and 4.75-5.05 downslope, but that downslope now
    // hands off to M -> P (the two new deepest regimes).
    aS = smoothstep(1.1, 1.55, z) * (1 - smoothstep(1.75, 2.05, z));
    aG = smoothstep(1.75, 2.1, z) * (1 - smoothstep(2.85, 3.2, z));
    aX = smoothstep(2.85, 3.2, z) * (1 - smoothstep(3.95, 4.3, z));
    aU = smoothstep(3.95, 4.3, z) * (1 - smoothstep(4.75, 5.05, z));
    aM = smoothstep(4.75, 5.05, z) * (1 - smoothstep(5.55, 5.85, z));
    aP = smoothstep(5.55, 5.85, z);
    Rearth = z <= 1 ? R * (1 - 0.84 * smoothstep(0, 1, z)) : R * 0.16;

    // RZ7: refresh the galaxy SOL marker screen position from the stored
    // canvas-relative coords + the current galaxy rotation BEFORE drawSolar runs,
    // so the S->G sun handoff never reads a one-frame-stale value.
    if (galaxyBuilt) {
      const gAng = reducedMotion ? 0 : (clock * TAU) / GAL_ROT_SEC;
      const ca = Math.cos(gAng);
      const sa = Math.sin(gAng);
      galaxySunScreenX = cx + (galaxySunX * ca - galaxySunY * sa);
      galaxySunScreenY = cy + (galaxySunX * sa + galaxySunY * ca);
    }

    // Earth ocean sphere at full size (faded by aE), plus a small thumbnail in
    // regime C (drawn later in the cislunar pass at 2 * R*0.16).
    if (sphereSize > 0 && aE > 0.003) {
      g.globalAlpha = aE;
      g.drawImage(sphere, cx - sphereSize / 2, cy - sphereSize / 2, sphereSize, sphereSize);
      g.globalAlpha = 1;
    }

    // sunX/sunY/sunZ are current: step() runs immediately before draw() each
    // frame and refreshes them (and the mount-time computeSun() seeds the very
    // first draw, which runs before any step()).
    const cosT = Math.cos(lonOffset);
    const sinT = Math.sin(lonOffset);
    const cosP = Math.cos(tilt);
    const sinP = Math.sin(tilt);

    // sun direction in view space (smoothed in step() so the glow drifts)
    const svx = ssx;
    const svy = ssy;
    const svz = ssz;

    g.globalCompositeOperation = 'lighter';

    // --- wireframe globe (holographic meridian/parallel grid, NO land) -------
    // The Earth reads as a clean cool-cyan wireframe sphere: the precomputed
    // meridians/parallels are projected and stroked front-facing only, plus a
    // crisp limb circle for the sphere outline. No coastline / landmass. Gated by
    // aE and thinned by Rearth so it fades and the stroke thins as Earth recedes,
    // and is skipped once aE is negligible. Cull-back-facing + projection are
    // identical to the old graticule pass; only alpha/density rose so it reads as
    // a proper wireframe rather than a faint grid. No per-frame string builds.
    if (aE >= 0.02) {
      const rsG = Rearth / R; // recede scale (1 at Earth level)
      g.lineCap = 'round';
      g.lineJoin = 'round';

      // grid lines: a wide faint halo pass then a thin bright core pass give a
      // holographic 2-pass glow, same shape as the old coastline glow.
      for (let pass = 0; pass < 2; pass++) {
        const wide = pass === 0;
        g.lineWidth = (wide ? 1.8 : 0.9) * (0.5 + 0.5 * rsG);
        g.strokeStyle = GRAT_STYLE;
        g.globalAlpha = (wide ? 0.1 : 0.26) * aE;
        for (let l = 0; l < GRATICULE.length; l++) {
          const v = GRATICULE[l];
          const m = v.length / 3;
          let prevFront = false;
          let ppx = 0;
          let ppy = 0;
          g.beginPath();
          for (let i = 0; i < m; i++) {
            const x = v[i * 3];
            const y = v[i * 3 + 1];
            const zz = v[i * 3 + 2];
            const x1 = x * cosT + zz * sinT;
            const z1 = -x * sinT + zz * cosT;
            const y2 = y * cosP - z1 * sinP;
            const z2 = y * sinP + z1 * cosP;
            const front = z2 > 0.02;
            const sx = cx + x1 * Rearth;
            const sy = cy - y2 * Rearth;
            if (front && prevFront) {
              g.moveTo(ppx, ppy);
              g.lineTo(sx, sy);
            }
            prevFront = front;
            ppx = sx;
            ppy = sy;
          }
          g.stroke();
        }
      }

      // crisp limb: a single cyan circle at radius Rearth gives the wireframe
      // sphere a clean edge. Gated by aE like the grid.
      g.lineWidth = 1 * (0.5 + 0.5 * rsG);
      g.strokeStyle = GRAT_STYLE;
      g.globalAlpha = 0.34 * aE;
      g.beginPath();
      g.arc(cx, cy, Rearth, 0, Math.PI * 2);
      g.stroke();

      g.globalAlpha = 1;
      // restore the default stroke caps so later passes (hubs/arcs) are unchanged
      g.lineCap = 'butt';
      g.lineJoin = 'miter';
    }

    // Hubs, arcs, the Sun glow and the candle limb pulse all belong to the Earth
    // and ride aE + Rearth (B4/B7): they fade and shrink as the camera pulls back
    // and are skipped entirely once the Earth is gone.
    const earthAlive = aE > 0.003;

    // --- hub markers ---------------------------------------------------------
    if (earthAlive) {
      g.lineWidth = 1;
      for (let i = 0; i < HUB_COUNT; i++) {
        const x = HUB_V[i * 3];
        const y = HUB_V[i * 3 + 1];
        const z = HUB_V[i * 3 + 2];
        const x1 = x * cosT + z * sinT;
        const z1 = -x * sinT + z * cosT;
        const y2 = y * cosP - z1 * sinP;
        const z2 = y * sinP + z1 * cosP;
        if (z2 <= 0.04) continue;
        const px = cx + x1 * Rearth;
        const py = cy - y2 * Rearth;
        const pulse = reducedMotion ? 0.6 : 0.5 + 0.5 * Math.sin(clock * 2.1 + HUB_PHASE[i]);
        g.globalAlpha = (0.55 + 0.4 * pulse) * aE;
        g.fillStyle = hubStyle;
        g.fillRect(px - 1.4, py - 1.4, 2.8, 2.8);
        g.globalAlpha = (1 - pulse) * 0.45 * aE;
        g.strokeStyle = hubStyle;
        g.beginPath();
        g.arc(px, py, 2.5 + 4 * pulse, 0, TAU);
        g.stroke();
      }
      g.globalAlpha = 1;
    }

    // --- comm arcs (bright head + fading trail; depth-tested per sample) -----
    if (earthAlive) {
    g.lineWidth = 1.3;
    for (let s = 0; s < ARC_POOL; s++) {
      if (!arcOn[s]) continue;
      const k = (clock - arcBorn[s]) / arcDur[s];
      if (k >= 1) {
        arcOn[s] = 0;
        continue;
      }
      let head: number;
      let tail: number;
      let env = 1;
      if (reducedMotion) {
        // no animation pulses: the whole arc fades in and out in place
        head = 1;
        tail = 0;
        env = Math.sin(Math.PI * k);
      } else {
        head = Math.min(1, k * 1.35);
        tail = Math.max(0, k * 1.35 - 0.35);
      }
      const i0 = Math.max(0, Math.floor(tail * (ARC_N - 1)));
      const i1 = Math.min(ARC_N - 1, Math.ceil(head * (ARC_N - 1)));
      const off = s * ARC_N * 3;
      let pvx = 0;
      let pvy = 0;
      let pvis = false;
      let hx = 0;
      let hy = 0;
      let hvis = false;
      g.strokeStyle = arcStyle;
      for (let i = i0; i <= i1; i++) {
        const x = arcPts[off + i * 3];
        const y = arcPts[off + i * 3 + 1];
        const z = arcPts[off + i * 3 + 2];
        const x1 = x * cosT + z * sinT;
        const z1 = -x * sinT + z * cosT;
        const y2 = y * cosP - z1 * sinP;
        const z2 = y * sinP + z1 * cosP;
        // visible if in front of the sphere, or past the limb (lifted samples)
        const vis = z2 > 0 || x1 * x1 + y2 * y2 > 1.04;
        const px = cx + x1 * Rearth;
        const py = cy - y2 * Rearth;
        if (vis && pvis) {
          const fade = (i - i0) / Math.max(1, i1 - i0);
          g.globalAlpha = (0.1 + 0.75 * fade) * env * aE;
          g.beginPath();
          g.moveTo(pvx, pvy);
          g.lineTo(px, py);
          g.stroke();
        }
        pvx = px;
        pvy = py;
        pvis = vis;
        if (i === i1) {
          hx = px;
          hy = py;
          hvis = vis;
        }
      }
      if (!reducedMotion && hvis && head < 1) {
        g.globalAlpha = 0.9 * env * aE;
        g.fillStyle = ARC_HEAD_STYLE;
        g.fillRect(hx - 1.6, hy - 1.6, 3.2, 3.2);
      }
    }
    g.globalAlpha = 1;
    }

    // --- the Sun: off-globe glow when its side faces the viewer, else corona -
    const len2 = Math.hypot(svx, svy);
    if (earthAlive && len2 > 0.18) {
      const ux = svx / len2;
      const uy = -svy / len2; // screen y points down
      if (svz > 0.05) {
        const sx = cx + ux * Rearth * 1.55;
        const sy = cy + uy * Rearth * 1.55;
        const ss = Rearth * 0.54;
        const lift = Math.min(1, svz / 0.6);
        g.globalAlpha = (0.3 + 0.55 * (lift * lift * (3 - 2 * lift))) * aE;
        g.drawImage(sunSprite, sx - ss / 2, sy - ss / 2, ss, ss);
      } else {
        const visAmt = Math.max(0, 1 + svz * 1.6);
        if (visAmt > 0.02) {
          const ang = Math.atan2(uy, ux);
          g.globalAlpha = 0.24 * (visAmt * visAmt * (3 - 2 * visAmt)) * aE;
          g.strokeStyle = CORONA_STYLE;
          g.lineWidth = 2.0;
          g.beginPath();
          g.arc(cx, cy, Rearth + 1.5, ang - 0.42, ang + 0.42);
          g.stroke();
        }
      }
      g.globalAlpha = 1;
    }

    // --- candle heartbeat: a brief limb pulse when BTC candles stream --------
    if (!reducedMotion && earthAlive) {
      const age = clock - limbPulseAt;
      if (age >= 0 && age < 0.6) {
        const e = 1 - age / 0.6;
        g.globalCompositeOperation = 'lighter';
        g.globalAlpha = 0.35 * e * e * aE;
        g.strokeStyle = accent;
        g.lineWidth = 1.5;
        g.beginPath();
        g.arc(cx, cy, Rearth + 1.5, 0, TAU);
        g.stroke();
        g.globalAlpha = 1;
      }
    }

    // --- meteors + impact shockwaves (Earth regime, over the wireframe) ------
    // Drawn after the Sun/candle passes and before the cislunar/solar passes so
    // the streaks + shockwaves read as striking the globe surface while still
    // sitting under the holo chrome (HUD rings, wash, scanlines) painted later.
    if (earthAlive) drawMeteors();

    // --- B5 cislunar regime + B6 solar system (drawn under the holo chrome) ---
    if (aC > 0.003) drawCislunar(cosT, sinT, cosP, sinP);
    if (aS > 0.003) drawSolar();

    // --- cosmic ladder (G/X/U/M/P), each gated to its band --------------------
    // Lazy-build the needed offscreen art, at most one heavy canvas per frame
    // (sequenceCosmic). The art draws additively under the holo chrome, which
    // itself rides aE and naturally fades to nothing this far out. Ladder order:
    // galaxy -> cluster -> web -> multiverse -> dimensional planes (terminal).
    sequenceCosmic();
    if (aG > 0.003) drawGalaxy();
    if (aX > 0.003) drawCluster();
    if (aU > 0.003) drawCosmicWeb();
    if (aM > 0.003) drawMultiverse();
    if (aP > 0.003) drawDimensionalPlanes();

    // --- B2 holographic overlay pass (cone + wash + HUD rings + sats + scan) --
    drawHolo(cosT, sinT, cosP, sinP);

    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
  }

  // --- B2: the holographic overlay pass -------------------------------------
  // Drawn over everything, composite 'lighter' throughout (except the ISS text).
  // The emitter cone + base lens glow are panel-level (all regimes, static under
  // reduced motion). The wash, HUD rings, satellites-at-Earth-scale, scanlines
  // and chromatic jitter ride aE so they fade as the camera pulls back.
  let jitterDt = 0.016; // last frame dt, for the ~1 per 22 s jitter probability
  function drawHolo(cosT: number, sinT: number, cosP: number, sinP: number): void {
    g.globalCompositeOperation = 'lighter';

    // 1) emitter cone from the holo-tank mouth, widening up to the globe ------
    // Tied to the Earth's presence (rides aE): full at Earth zoom (the holo-tank
    // projector look), and faded completely once the camera pulls back, so the
    // bright cone no longer hangs as an off-kilter beam over the empty cosmos in
    // the cislunar / solar / galaxy / cluster / universe / multiverse / plane
    // regimes. The cone fades from CONE_ALPHA*aE at the mouth to 0 at the disc; a
    // flattened lens glow pools at the base.
    if (aE >= 0.02) {
      const mouthX = cx;
      const mouthY = h - 6;
      const topY = cy;
      const halfTop = R * 1.35;
      const grad = g.createLinearGradient(0, mouthY, 0, topY);
      grad.addColorStop(0, rgba(HOLO_RGB[0], HOLO_RGB[1], HOLO_RGB[2], CONE_ALPHA * aE));
      grad.addColorStop(1, rgba(HOLO_RGB[0], HOLO_RGB[1], HOLO_RGB[2], 0));
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(mouthX - 5, mouthY);
      g.lineTo(mouthX + 5, mouthY);
      g.lineTo(mouthX + halfTop, topY);
      g.lineTo(mouthX - halfTop, topY);
      g.closePath();
      g.fill();
      // base lens glow: radial gradient squashed in y to a thin ellipse
      g.save();
      g.translate(mouthX, mouthY);
      g.scale(1, 0.32);
      const lens = g.createRadialGradient(0, 0, 0, 0, 0, R * 0.5);
      lens.addColorStop(0, rgba(HOLO_RGB[0], HOLO_RGB[1], HOLO_RGB[2], CONE_BASE_ALPHA * aE));
      lens.addColorStop(1, rgba(HOLO_RGB[0], HOLO_RGB[1], HOLO_RGB[2], 0));
      g.fillStyle = lens;
      g.beginPath();
      g.arc(0, 0, R * 0.5, 0, TAU);
      g.fill();
      g.restore();
    }

    // Everything below rides aE: once the Earth is gone there is nothing to wash
    // or ring, and satellites at Earth-scale are replaced by the regime passes.
    if (aE >= 0.02) {
      // 2) holo wash: cyan vignette clipped to the (receded) Earth disc --------
      {
        g.save();
        g.beginPath();
        g.arc(cx, cy, Rearth, 0, TAU);
        g.clip();
        const wa = HOLO_WASH_ALPHA * aE;
        const wash = g.createRadialGradient(cx, cy, Rearth * 0.1, cx, cy, Rearth);
        wash.addColorStop(0, rgba(HOLO_RGB[0], HOLO_RGB[1], HOLO_RGB[2], wa));
        wash.addColorStop(0.7, rgba(HOLO_RGB[0], HOLO_RGB[1], HOLO_RGB[2], wa * 0.5));
        wash.addColorStop(1, rgba(HOLO_RGB[0], HOLO_RGB[1], HOLO_RGB[2], 0));
        g.fillStyle = wash;
        g.fillRect(cx - Rearth, cy - Rearth, Rearth * 2, Rearth * 2);
        g.restore();
      }

      // 3) HUD rings x2: ring arc + ticks in one path each (4 strokes total) ---
      {
        const phase1 = reducedMotion ? 0 : clock * HUD_SPIN1;
        const phase2 = reducedMotion ? 0 : clock * HUD_SPIN2;
        drawHudRing(Rearth * HUD_R1, HUD_TICKS1, phase1, HUD_A1 * aE, HUD_STROKE);
        drawHudRing(Rearth * HUD_R2, HUD_TICKS2, phase2, HUD_A2 * aE, HUD_STROKE_TEAL);
      }

      // 4) orbit lines, then the satellites at Earth scale --------------------
      // The faint analytic orbit ellipses sit under the live dots/trails (RZ2).
      drawOrbits(cosT, sinT, cosP, sinP);
      drawSatsEarth(cosT, sinT, cosP, sinP);

      // 5) scanlines: thin bright bars drifting down, clipped to the disc -----
      {
        g.save();
        g.beginPath();
        g.arc(cx, cy, Rearth, 0, TAU);
        g.clip();
        g.fillStyle = rgba(HOLO_RGB[0], HOLO_RGB[1], HOLO_RGB[2], SCAN_ALPHA * aE);
        const drift = reducedMotion ? 0 : (clock * SCAN_SPEED) % (Rearth * 2);
        const span = Rearth * 2;
        for (let s = 0; s < SCAN_COUNT; s++) {
          let yy = cy - Rearth + ((drift + (s * span) / SCAN_COUNT) % span);
          g.fillRect(cx - Rearth, yy - SCAN_THICK / 2, Rearth * 2, SCAN_THICK);
        }
        g.restore();
      }

      // 6) chromatic jitter: a rare one-frame red/cyan limb ghost -------------
      if (!reducedMotion && Math.random() < jitterDt / JITTER_MEAN_SEC) {
        g.lineWidth = 1;
        g.globalAlpha = 0.5 * aE;
        g.strokeStyle = 'rgba(255,40,60,1)';
        g.beginPath();
        g.arc(cx + JITTER_PX, cy, Rearth + 1, 0, TAU);
        g.stroke();
        g.strokeStyle = 'rgba(40,230,255,1)';
        g.beginPath();
        g.arc(cx - JITTER_PX, cy, Rearth + 1, 0, TAU);
        g.stroke();
        g.globalAlpha = 1;
      }
    }
    jitterDt = lastFrameDt;
    g.globalCompositeOperation = 'source-over';
  }

  /** One HUD ring: the arc plus all radial ticks, two stroke calls. */
  function drawHudRing(rad: number, ticks: number, phase: number, alpha: number, style: string): void {
    if (alpha <= 0.001) return;
    g.lineWidth = 1;
    g.strokeStyle = style;
    g.globalAlpha = alpha;
    g.beginPath();
    g.arc(cx, cy, rad, 0, TAU);
    g.stroke();
    g.beginPath();
    for (let t = 0; t < ticks; t++) {
      const ang = phase + (t * TAU) / ticks;
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      g.moveTo(cx + ca * rad, cy + sa * rad);
      g.lineTo(cx + ca * (rad + HUD_TICK_LEN), cy + sa * (rad + HUD_TICK_LEN));
    }
    g.stroke();
    g.globalAlpha = 1;
  }

  /** Meteors in flight + their impact shockwave rings (Earth regime). All
   * alphas ride aE so the whole system fades as the camera pulls past Earth.
   * Allocation-free: only pooled state + a handful of strokes/arcs per frame.
   * Composite 'lighter' is already set by draw() before this runs; we restore it
   * after the clipped ring pass (g.save/clip toggles it via the saved state). */
  function drawMeteors(): void {
    if (aE <= 0.003) return;

    // --- meteors in flight: hot head + a short fading motion trail -----------
    for (let s = 0; s < METEOR_POOL; s++) {
      if (!metOn[s]) continue;
      const k = (clock - metBorn[s]) / metDur[s];
      if (k >= 1) {
        // impact: fire a shockwave at the (clamped-to-disc) target, then free.
        spawnImpactRing(metTX[s], metTY[s]);
        metOn[s] = 0;
        continue;
      }
      const sx = metSX[s];
      const sy = metSY[s];
      const tx = metTX[s];
      const ty = metTY[s];
      // current head position along the straight path.
      const hx = sx + (tx - sx) * k;
      const hy = sy + (ty - sy) * k;
      // unit velocity (start -> target) for the trail tail behind the head.
      let dx = tx - sx;
      let dy = ty - sy;
      const len = Math.hypot(dx, dy);
      if (len > 1e-3) {
        dx /= len;
        dy /= len;
      }
      const trail = METEOR_TRAIL_FRAC * Rearth;
      const txx = hx - dx * trail;
      const tyy = hy - dy * trail;
      // fade in fast, hold, then fade as it nears impact.
      const env = smoothstep(0, 0.12, k) * (1 - smoothstep(0.88, 1, k));
      const a = env * aE;
      if (a > 0.002) {
        // gradient trail: warm glow at the tail fading to a bright hot head.
        const grad = g.createLinearGradient(txx, tyy, hx, hy);
        grad.addColorStop(0, withAlpha(METEOR_GLOW_STYLE, 0));
        grad.addColorStop(0.6, withAlpha(METEOR_GLOW_STYLE, 0.45 * a));
        grad.addColorStop(1, withAlpha(METEOR_HEAD_STYLE, 0.9 * a));
        g.strokeStyle = grad;
        g.lineCap = 'round';
        g.lineWidth = 1.8 * (0.6 + 0.4 * (Rearth / R));
        g.beginPath();
        g.moveTo(txx, tyy);
        g.lineTo(hx, hy);
        g.stroke();
        g.lineCap = 'butt';
        // hot head: a small bright core dot.
        const hr = 2.2 * (0.6 + 0.4 * (Rearth / R));
        g.globalAlpha = Math.min(1, a * 1.1);
        g.fillStyle = METEOR_HEAD_STYLE;
        g.beginPath();
        g.arc(hx, hy, hr, 0, TAU);
        g.fill();
        g.globalAlpha = 1;
      }
    }

    // --- impact shockwaves: expanding rings clipped to the Earth disc --------
    let anyRing = false;
    for (let s = 0; s < METEOR_RING_POOL; s++) {
      if (ringOn[s]) {
        anyRing = true;
        break;
      }
    }
    if (anyRing) {
      g.save();
      g.beginPath();
      g.arc(cx, cy, Rearth, 0, TAU);
      g.clip();
      const maxR = METEOR_RING_R_FRAC * Rearth;
      const ringStyle = rgba(METEOR_RING_RGB[0], METEOR_RING_RGB[1], METEOR_RING_RGB[2], 1);
      for (let s = 0; s < METEOR_RING_POOL; s++) {
        if (!ringOn[s]) continue;
        const age = clock - ringBorn[s];
        const k = age / METEOR_RING_SEC;
        if (k >= 1) {
          ringOn[s] = 0;
          continue;
        }
        const ease = k * (2 - k); // ease-out radius growth (2 - 0..1)
        const baseR = 2 + ease * maxR;
        const fade = (1 - k) * (1 - k) * aE;
        const ix = ringX[s];
        const iy = ringY[s];
        // central flash early in the life, warm white core.
        if (k < 0.3) {
          const fa = (1 - k / 0.3) * 0.85 * aE;
          g.globalAlpha = fa;
          g.fillStyle = METEOR_FLASH_STYLE;
          g.beginPath();
          g.arc(ix, iy, 1.5 + ease * Rearth * 0.08, 0, TAU);
          g.fill();
        }
        // 1-2 concentric cyan shockwave rings.
        g.strokeStyle = ringStyle;
        g.lineWidth = 1.6 * (0.6 + 0.4 * (Rearth / R));
        g.globalAlpha = 0.75 * fade;
        g.beginPath();
        g.arc(ix, iy, baseR, 0, TAU);
        g.stroke();
        const r2 = baseR * 0.62;
        if (r2 > 2) {
          g.globalAlpha = 0.4 * fade;
          g.lineWidth = 1 * (0.6 + 0.4 * (Rearth / R));
          g.beginPath();
          g.arc(ix, iy, r2, 0, TAU);
          g.stroke();
        }
      }
      g.globalAlpha = 1;
      g.restore(); // restores composite + clip; draw() set 'lighter' before us
    }
  }

  /** R14.1: faint analytic orbit ellipses under the live sats (RZ2). One
   * g.ellipse stroke per representative orbit. The orbit plane is inertial; we
   * rotate its ECI normal into ECEF (-GMST) with the hoisted satCg/satSg, remap
   * to the globe frame, view-transform the normal, and project a foreshortened
   * ellipse. Radius uses satLift (NOT raw a) so each ring passes through its own
   * sats at Earth scale. Full ellipses (no occlusion): the through-the-disc back
   * arc reads as faint holo x-ray, like the HUD rings + wash. Gated aE >= 0.02. */
  function drawOrbits(cosT: number, sinT: number, cosP: number, sinP: number): void {
    if (orbCount === 0 || aE < 0.02) return;
    g.lineWidth = 1;
    let curStyle = -1; // -1 none, 0 stations, 1 visual, 2 gps
    let issR = -1; // defer the ISS ring so it strokes last (brightest)
    for (let r = 0; r < orbCount; r++) {
      if (orbIss[r]) {
        issR = r;
        continue;
      }
      curStyle = setOrbitStyle(orbGrp[r], curStyle);
      strokeOrbit(r, orbGrp[r], cosT, sinT, cosP, sinP, false);
    }
    if (issR >= 0) {
      setOrbitStyle(0, -1); // ISS uses the stations cyan, drawn last + brightest
      strokeOrbit(issR, 0, cosT, sinT, cosP, sinP, true);
    }
    g.globalAlpha = 1;
  }

  /** Set the prebuilt orbit stroke style for a group only when it changes. */
  function setOrbitStyle(grp: number, cur: number): number {
    if (grp === cur) return cur;
    g.strokeStyle = grp === 0 ? ORBIT_STYLE_STATIONS : grp === 1 ? ORBIT_STYLE_VISUAL : ORBIT_STYLE_GPS;
    return grp;
  }

  /** Stroke a single projected orbit ellipse (allocation-free). */
  function strokeOrbit(
    r: number,
    grp: number,
    cosT: number,
    sinT: number,
    cosP: number,
    sinP: number,
    iss: boolean
  ): void {
    const nx = orbN[r * 3];
    const ny = orbN[r * 3 + 1];
    const nz = orbN[r * 3 + 2];
    // ECI -> ECEF: rotate the normal by -GMST about Z (cg/sg from sampleSats).
    const ex = nx * satCg + ny * satSg;
    const ey = -nx * satSg + ny * satCg;
    const ez = nz;
    // globe-frame remap (matches propagate): North +Y, 90 E meridian +Z.
    const gX = ex;
    const gY = ez;
    const gZ = ey;
    // view transform of the plane normal -> projected normal + depth.
    const vx1 = gX * cosT + gZ * sinT;
    const vz1 = -gX * sinT + gZ * cosT;
    const vY2 = gY * cosP - vz1 * sinP;
    const vZ2 = gY * sinP + vz1 * cosP;
    const Rpx = satLift(orbAR[r]) * Rearth;
    const major = Rpx;
    const minor = Math.max(0.5, Rpx * Math.abs(vZ2));
    const rot = Math.atan2(vx1, vY2); // major axis perpendicular to the screen-space projected normal (vx1, -vY2); accounts for the y-flip (py = cy - y2*R)
    const a = (iss ? ORBIT_A_ISS : grp === 0 ? ORBIT_A_STATIONS : grp === 1 ? ORBIT_A_VISUAL : ORBIT_A_GPS) * aE;
    g.globalAlpha = a;
    g.beginPath();
    g.ellipse(cx, cy, major, minor, rot, 0, TAU);
    g.stroke();
  }

  /** B2.4: project + draw the live satellites at Earth scale (trails + ISS). */
  function drawSatsEarth(cosT: number, sinT: number, cosP: number, sinP: number): void {
    if (satCount === 0) return;
    const phase = satSampleAt < 0 ? 0 : Math.min(1, (satNow() - satSampleAt) / (SAT_SAMPLE_MS / 1000));
    const cap = Math.min(SAT_CAP, satCount);
    g.globalAlpha = aE;
    for (let i = 0; i < cap; i++) {
      const o = i * 4;
      // interpolated earth-fixed unit vector (slerp-lite: lerp + renormalize)
      let ex = satPrev[o] + (satNext[o] - satPrev[o]) * phase;
      let ey = satPrev[o + 1] + (satNext[o + 1] - satPrev[o + 1]) * phase;
      let ez = satPrev[o + 2] + (satNext[o + 2] - satPrev[o + 2]) * phase;
      const ar = satPrev[o + 3] + (satNext[o + 3] - satPrev[o + 3]) * phase;
      const inv = 1 / Math.max(1e-6, Math.hypot(ex, ey, ez));
      ex *= inv;
      ey *= inv;
      ez *= inv;
      const lift = satLift(ar);
      // standard view transform
      const x1 = ex * cosT + ez * sinT;
      const z1 = -ex * sinT + ez * cosT;
      const y2 = ey * cosP - z1 * sinP;
      const z2 = ey * sinP + z1 * cosP;
      // occlusion: behind the sphere AND projecting inside the disc -> skip
      if (z2 <= 0 && (x1 * lift) * (x1 * lift) + (y2 * lift) * (y2 * lift) < 1.0) continue;
      const grp = satGroups[i];
      const isIss = i === issIndex;
      // trail: project the earth-fixed ring-buffer samples, oldest -> newest
      if (satTrailFill > 1) {
        g.globalAlpha = 0.35 * aE;
        g.strokeStyle = grp === 0 ? SAT_COLOR_STATIONS : grp === 1 ? SAT_COLOR_VISUAL : SAT_COLOR_GPS;
        g.lineWidth = 1;
        g.beginPath();
        let started = false;
        for (let k = 0; k < satTrailFill; k++) {
          // oldest first: head is satTrailHead-1; walk forward from the tail
          const slot = (satTrailHead - satTrailFill + k + TRAIL_N * 2) % TRAIL_N;
          const w = (i * TRAIL_N + slot) * 4;
          const tx = satTrails[w];
          const ty = satTrails[w + 1];
          const tz = satTrails[w + 2];
          const tl = satTrails[w + 3];
          const tx1 = tx * cosT + tz * sinT;
          const tz1 = -tx * sinT + tz * cosT;
          const ty2 = ty * cosP - tz1 * sinP;
          const tz2 = ty * sinP + tz1 * cosP;
          if (tz2 <= 0 && (tx1 * tl) * (tx1 * tl) + (ty2 * tl) * (ty2 * tl) < 1.0) {
            started = false;
            continue;
          }
          const px = cx + tx1 * tl * Rearth;
          const py = cy - ty2 * tl * Rearth;
          if (started) g.lineTo(px, py);
          else {
            g.moveTo(px, py);
            started = true;
          }
        }
        g.stroke();
      }
      // dot
      const px = cx + x1 * lift * Rearth;
      const py = cy - y2 * lift * Rearth;
      g.globalAlpha = aE;
      g.fillStyle = grp === 0 ? SAT_COLOR_STATIONS : grp === 1 ? SAT_COLOR_VISUAL : SAT_COLOR_GPS;
      const dp = isIss ? ISS_DOT_PX : SAT_DOT_PX;
      g.fillRect(px - dp / 2, py - dp / 2, dp, dp);
      // ISS leader line + label (front side only), one cached fillText
      if (isIss && z2 > 0) {
        g.strokeStyle = SAT_COLOR_STATIONS;
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(px, py);
        g.lineTo(px + 14, py - 14);
        g.stroke();
        g.globalCompositeOperation = 'source-over';
        g.globalAlpha = 0.9 * aE;
        g.font = HOLO_LABEL_FONT;
        g.textBaseline = 'alphabetic';
        g.fillStyle = SAT_COLOR_STATIONS;
        g.fillText('ISS', px + 16, py - 14);
        g.globalCompositeOperation = 'lighter';
        g.globalAlpha = aE;
      }
    }
    g.globalAlpha = 1;
  }

  // --- B5: cislunar regime (small Earth thumbnail + Moon + true-scale sats) --
  // KM_TO_PX scales km onto the screen so the Moon's mean distance sits at a
  // fixed fraction of R. The Moon vector + range are cached at 1 Hz (tickChrome);
  // here we only project. Satellites render at TRUE scale (altRatio * 6371 * px).
  function drawCislunar(cosT: number, sinT: number, cosP: number, sinP: number): void {
    const CIS_RING_PX = R * 0.92;
    const KM_TO_PX = CIS_RING_PX / MOON_DIST_KM;
    g.globalCompositeOperation = 'lighter';

    // Earth thumbnail: the ocean sphere at 2 * R*0.16, plus a bright-bucket dot
    // subset so the small Earth still reads as land + city lights.
    const Rt = R * 0.16;
    if (sphereSize > 0) {
      g.globalAlpha = aC;
      const td = sphereSize * (Rt / R); // sphereSize bakes in the real pad; lands the ocean disc at exactly Rt
      g.drawImage(sphere, cx - td / 2, cy - td / 2, td, td);
      g.globalAlpha = 1;
    }
    // ~900-dot brightest-bucket subset over the thumbnail
    {
      const f = DOTS;
      const stepN = Math.max(1, Math.floor(f.count / 900));
      g.globalAlpha = aC;
      const sz = spriteCssDia * 0.5;
      for (let i = 0; i < f.count; i += stepN) {
        const x = f.x[i];
        const y = f.y[i];
        const zz = f.z[i];
        const x1 = x * cosT + zz * sinT;
        const z1 = -x * sinT + zz * cosT;
        const y2 = y * cosP - z1 * sinP;
        const z2 = y * sinP + z1 * cosP;
        if (z2 < 0.78) continue; // brightest bucket only
        let sprite: Sprite | null;
        if (f.dim[i]) sprite = dimSprite;
        else {
          const d = x * sunX + y * sunY + zz * sunZ;
          sprite = d > TERM_BAND ? daySprites[3] : d < -TERM_BAND ? nightSprites[3] : termSprites[2][3];
        }
        if (!sprite) continue;
        g.drawImage(sprite, cx + x1 * Rt - sz * 0.5, cy - y2 * Rt - sz * 0.5, sz, sz);
      }
      g.globalAlpha = 1;
    }

    // orbit rings: Moon ellipse (tilt-flattened), GEO + LEO circles ------------
    g.lineWidth = 1;
    {
      const ry = CIS_RING_PX * Math.cos(tilt);
      g.globalAlpha = 0.16 * aC;
      g.strokeStyle = HUD_STROKE;
      g.beginPath();
      g.ellipse(cx, cy, CIS_RING_PX, ry, 0, 0, TAU);
      g.stroke();
      g.globalAlpha = 0.18 * aC;
      g.beginPath();
      g.arc(cx, cy, GEO_KM * KM_TO_PX, 0, TAU);
      g.stroke();
      g.globalAlpha = 0.12 * aC;
      g.beginPath();
      g.arc(cx, cy, LEO_KM * KM_TO_PX, 0, TAU);
      g.stroke();
      g.globalAlpha = 1;
    }

    // satellites at TRUE scale: altRatio * 6371 * KM_TO_PX from Earth center ---
    if (satCount > 0) {
      const phase = satSampleAt < 0 ? 0 : Math.min(1, (satNow() - satSampleAt) / (SAT_SAMPLE_MS / 1000));
      const cap = Math.min(SAT_CAP, satCount);
      g.globalAlpha = 0.7 * aC;
      for (let i = 0; i < cap; i++) {
        const o = i * 4;
        let ex = satPrev[o] + (satNext[o] - satPrev[o]) * phase;
        let ey = satPrev[o + 1] + (satNext[o + 1] - satPrev[o + 1]) * phase;
        let ez = satPrev[o + 2] + (satNext[o + 2] - satPrev[o + 2]) * phase;
        const ar = satPrev[o + 3] + (satNext[o + 3] - satPrev[o + 3]) * phase;
        const inv = 1 / Math.max(1e-6, Math.hypot(ex, ey, ez));
        ex *= inv;
        ey *= inv;
        ez *= inv;
        const rpx = ar * KM_EARTH_R * KM_TO_PX;
        const x1 = ex * cosT + ez * sinT;
        const z1 = -ex * sinT + ez * cosT;
        const y2 = ey * cosP - z1 * sinP;
        const px = cx + x1 * rpx;
        const py = cy - y2 * rpx;
        const grp = satGroups[i];
        g.fillStyle = grp === 0 ? SAT_COLOR_STATIONS : grp === 1 ? SAT_COLOR_VISUAL : SAT_COLOR_GPS;
        g.fillRect(px - 0.7, py - 0.7, 1.4, 1.4);
      }
      g.globalAlpha = 1;
    }

    // the Moon: lit disc + dark-side phase overpaint (cached vector) ----------
    {
      const x1 = moonX * cosT + moonZ * sinT;
      const z1 = -moonX * sinT + moonZ * cosT;
      const y2 = moonY * cosP - z1 * sinP;
      const KM_TO_PX2 = CIS_RING_PX / MOON_DIST_KM;
      const mpx = cx + x1 * moonRangeKm * KM_TO_PX2;
      const mpy = cy - y2 * moonRangeKm * KM_TO_PX2;
      const mr = Math.max(2.5, R * 0.05);
      // lit disc
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = aC;
      g.fillStyle = 'rgba(225,230,245,1)';
      g.beginPath();
      g.arc(mpx, mpy, mr, 0, TAU);
      g.fill();
      // dark-side overpaint: the classic two-circle phase. Use the smoothed
      // view-space sun angle and a phase fraction from the Earth-fixed sun dot.
      const elongCos = Math.max(-1, Math.min(1, moonX * sunX + moonY * sunY + moonZ * sunZ));
      const elong = Math.acos(elongCos);
      const k = 0.5 * (1 - Math.cos(elong)); // illuminated fraction
      const sunAng = Math.atan2(-ssy, ssx);
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = aC;
      g.fillStyle = '#070a12';
      // terminator circle offset along the sun direction; width tracks phase
      const off = (1 - 2 * k) * mr; // -mr (full) .. +mr (new)
      g.save();
      g.beginPath();
      g.arc(mpx, mpy, mr, 0, TAU);
      g.clip();
      g.beginPath();
      g.arc(mpx - Math.cos(sunAng) * off, mpy - Math.sin(sunAng) * off, mr, 0, TAU);
      g.fill();
      g.restore();
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'lighter';
    }
    g.globalCompositeOperation = 'source-over';
  }

  // --- B6: solar system regime (8 planets, sqrt-compressed, rings + labels) --
  // Heliocentric positions (AU) are cached at 1 Hz (tickChrome). Radial distance
  // is sqrt-compressed so Neptune fits the panel; direction is preserved. Yaw is
  // the drag-controlled eclipticAz, pitch is the fixed SOLAR_TILT.
  const solarOrder = new Int32Array(PLANETS.length);
  function drawSolar(): void {
    const K = (R * 1.18) / Math.sqrt(AU_NEPTUNE);
    const cy2 = Math.cos(eclipticAz);
    const sy2 = Math.sin(eclipticAz);
    const cp = Math.cos(SOLAR_TILT);
    const sp = Math.sin(SOLAR_TILT);
    g.globalCompositeOperation = 'lighter';

    // Sun: reuse the sun sprite plus a small bright core. RZ3 S->G handoff: over
    // the overlap band tShift = ss(1.75,2.10,z) the Sun glides off-center toward
    // the galaxy's SOL marker, shrinks, and lands on that dot as aS->0/aG->1, so
    // the solar system collapses into one point on the Orion Spur. Before the
    // galaxy is built (galaxySunScreenX/Y unseeded) it stays at center.
    {
      const tShift = galaxyBuilt ? smoothstep(1.75, 2.1, zoom) : 0;
      const sShrink = 1 - tShift;
      const sunX2 = cx + (galaxySunScreenX - cx) * tShift;
      const sunY2 = cy + (galaxySunScreenY - cy) * tShift;
      const ss = R * 1.3 * aS * (0.25 + 0.75 * sShrink);
      g.globalAlpha = aS;
      g.drawImage(sunSprite, sunX2 - ss / 2, sunY2 - ss / 2, ss, ss);
      g.fillStyle = 'rgba(255,250,230,1)';
      g.globalAlpha = aS;
      g.beginPath();
      g.arc(sunX2, sunY2, Math.max(2, R * 0.02) * (0.25 + 0.75 * sShrink), 0, TAU);
      g.fill();
      g.globalAlpha = 1;
    }

    // orbit rings (sqrt-compressed a), tilted ellipses ------------------------
    g.lineWidth = 1;
    g.strokeStyle = HUD_STROKE;
    g.globalAlpha = 0.1 * aS;
    for (let p = 0; p < PLANETS.length; p++) {
      const srOrb = K * Math.sqrt(PLANETS[p].a);
      g.beginPath();
      g.ellipse(cx, cy, srOrb, srOrb * Math.cos(SOLAR_TILT), eclipticAz, 0, TAU);
      g.stroke();
    }
    g.globalAlpha = 1;

    // project planets, depth-order by view z (insertion sort on indices) ------
    for (let p = 0; p < PLANETS.length; p++) solarOrder[p] = p;
    // compute view-space z per planet into a scratch for the sort
    const zbuf = solarZBuf;
    for (let p = 0; p < PLANETS.length; p++) {
      const X = planetX[p];
      const Y = planetY[p];
      const Z = planetZ[p];
      const rAU = planetR[p];
      const rp = Math.max(1e-9, Math.hypot(X, Y));
      const sr = K * Math.sqrt(rAU);
      const px3 = (X / rp) * sr;
      const py3 = (Y / rp) * sr;
      const pz3 = (Z / rp) * sr * 0.5;
      // yaw about Z, then pitch about X
      const rx = px3 * cy2 - py3 * sy2;
      const ry = px3 * sy2 + py3 * cy2;
      const y2 = ry * cp - pz3 * sp;
      const z2 = ry * sp + pz3 * cp;
      solarSX[p] = cx + rx;
      solarSY[p] = cy - y2;
      zbuf[p] = z2;
    }
    // insertion sort indices back-to-front (smaller z = farther, drawn first)
    for (let a = 1; a < PLANETS.length; a++) {
      const idx = solarOrder[a];
      const zv = zbuf[idx];
      let b = a - 1;
      while (b >= 0 && zbuf[solarOrder[b]] > zv) {
        solarOrder[b + 1] = solarOrder[b];
        b--;
      }
      solarOrder[b + 1] = idx;
    }

    // sprites
    for (let oi = 0; oi < PLANETS.length; oi++) {
      const p = solarOrder[oi];
      const spr = planetSprites[p];
      if (!spr) continue;
      const sz = PLANETS[p].size * 2.4;
      g.globalAlpha = aS;
      g.drawImage(spr, solarSX[p] - sz / 2, solarSY[p] - sz / 2, sz, sz);
    }
    g.globalAlpha = 1;

    // labels: inner 4 always, outer 4 only when deep-zoomed ------------------
    g.globalCompositeOperation = 'source-over';
    g.font = HOLO_LABEL_FONT;
    g.textBaseline = 'alphabetic';
    for (let p = 0; p < PLANETS.length; p++) {
      const inner = p < 4;
      if (!inner && zoom <= 1.75) continue;
      g.globalAlpha = 0.5 * aS;
      g.fillStyle = PLANETS[p].color;
      g.fillText(PLANETS[p].name, solarSX[p] + PLANETS[p].size, solarSY[p] - PLANETS[p].size);
    }
    g.globalAlpha = 1;

    // Earth marker + YOU ARE HERE -------------------------------------------
    {
      const ei = 2; // EARTH index
      g.globalCompositeOperation = 'lighter';
      g.lineWidth = 1;
      g.globalAlpha = 0.6 * aS;
      g.strokeStyle = '#6cc5ff';
      g.beginPath();
      g.arc(solarSX[ei], solarSY[ei], 7, 0, TAU);
      g.stroke();
      g.globalAlpha = 1;
      if (aS > 0.9) {
        g.globalCompositeOperation = 'source-over';
        g.globalAlpha = aS;
        g.font = HOLO_LABEL_FONT;
        g.fillStyle = '#bfe6ff';
        g.fillText('YOU ARE HERE', solarSX[ei] - 28, solarSY[ei] - 12);
        g.globalAlpha = 1;
      }
    }
    g.globalCompositeOperation = 'source-over';
  }

  // ======================================================================
  // R14.3: the cosmic ladder (G Milky Way, X Local Group, U cosmic web,
  // M multiverse, P dimensional planes). Each regime's art is prerendered once onto an offscreen
  // canvas, built lazily on first band entry, and drawn per frame as a couple
  // of drawImage calls plus a handful of live markers/glints. Band onsets track
  // RZ1; the cosmos design owns the algorithms, counts, colors and timings.
  // ======================================================================

  /** Stable seeded RNG (mulberry32) so cluster/web layouts do not reshuffle on
   * every rebuild within a session. */
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

  /** Build at most ONE heavy cosmic canvas per frame (RZ3): if several are due,
   * build the nearest-band one and defer the rest to a later frame. Dependencies
   * (cluster needs the galaxy sprite; iris needs the web sprite) are satisfied in
   * order, still one heavy build per call. */
  function sequenceCosmic(): void {
    if (aG > 0.003 && !galaxyBuilt) {
      buildGalaxy();
      return;
    }
    if (aX > 0.003 && !clusterBuilt) {
      if (!galaxyBuilt) {
        buildGalaxy();
        return; // galaxy is the heavy build this frame; cluster next frame
      }
      buildCluster();
      return;
    }
    if (aU > 0.003 && !webBuilt) {
      buildCosmicWeb();
      return;
    }
    if (aM > 0.003 && !multiBuilt) {
      buildMultiverse();
      return; // the multiverse bubble field is the heavy build this frame
    }
    if (aP > 0.003 && !planesBuilt) {
      buildDimensionalPlaneLayout(); // light: just the per-plane orientations
      return;
    }
  }

  // --- REGIME G: the Milky Way ------------------------------------------------
  function buildGalaxy(): void {
    galaxyPx = Math.round(Math.min(GALAXY_PX_MUL * Math.min(w, h), GALAXY_PX_CAP) * dpr);
    if (galaxyPx < 2) galaxyPx = 2;
    galaxyCv.width = galaxyPx;
    galaxyCv.height = galaxyPx;
    const sg = galaxyCv.getContext('2d');
    if (!sg) return;
    sg.clearRect(0, 0, galaxyPx, galaxyPx);
    sg.globalCompositeOperation = 'lighter';
    const R0 = galaxyPx / 2;
    const Rd = R0 * 0.92; // disc visual radius == 50,000 ly
    const squash = Math.cos(GAL_TILT); // ~0.5736 y-compression
    const rng = makeRng(0x9e3779b1);
    const splat = (x: number, y: number, rad: number, r: number, gc: number, b: number, a: number): void => {
      const grad = sg.createRadialGradient(x, y, 0, x, y, rad);
      grad.addColorStop(0, rgba(r, gc, b, a));
      grad.addColorStop(1, rgba(r, gc, b, 0));
      sg.fillStyle = grad;
      sg.beginPath();
      sg.arc(x, y, rad, 0, TAU);
      sg.fill();
    };
    // faint disc haze
    {
      const haze = sg.createRadialGradient(R0, R0, 0, R0, R0, Rd * 1.3);
      haze.addColorStop(0, 'rgba(80,150,180,0.05)');
      haze.addColorStop(1, 'rgba(80,150,180,0)');
      sg.fillStyle = haze;
      sg.fillRect(0, 0, galaxyPx, galaxyPx);
    }
    const b = Math.tan(GAL_PITCH); // log-spiral coefficient
    const Rinner = Rd * GAL_R_INNER_FRAC;
    const dot = (galaxyPx / 1100) * 2.4; // particle splat radius scaled to backing size
    const armOffsets = [0, Math.PI];
    const armOffsetsMinor = [Math.PI / 2, (3 * Math.PI) / 2];
    const plotArm = (offset: number, count: number, dim: number): void => {
      for (let k = 0; k < count; k++) {
        const theta = 0.3 + rng() * (GAL_THETA_MAX - 0.3);
        const tNorm = theta / GAL_THETA_MAX;
        // log-spiral baseline radius, blended with a linear ramp so arms reach Rd
        const rSpiral = Rinner * Math.exp(b * theta);
        let r = Math.min(Rd, Rinner + (Rd - Rinner) * tNorm * 0.6 + rSpiral * 0.4);
        // cross-arm scatter, tighter at larger radius
        const angSig = 0.18 * (1 - 0.5 * tNorm);
        const ang = theta + offset + (rng() - 0.5) * 2 * angSig;
        r += (rng() - 0.5) * 2 * (Rd * 0.018);
        const x = R0 + r * Math.cos(ang);
        const y = R0 + r * Math.sin(ang) * squash;
        // inner warm -> mid holo cyan -> outer cool
        let cr: number, cg2: number, cb: number;
        if (tNorm < 0.33) {
          cr = 150;
          cg2 = 210;
          cb = 230;
        } else if (tNorm < 0.7) {
          cr = 120;
          cg2 = 232;
          cb = 255;
        } else {
          cr = 90;
          cg2 = 150;
          cb = 200;
        }
        const knot = rng() < 0.08 ? 2 : 1; // occasional bright star-forming knots
        const a = (0.05 + rng() * 0.09) * dim * knot;
        splat(x, y, dot * (0.7 + rng() * 0.7), cr, cg2, cb, Math.min(0.28, a));
      }
    };
    for (const o of armOffsets) plotArm(o, GAL_ARM_MAJOR_PARTS, 1);
    for (const o of armOffsetsMinor) plotArm(o, GAL_ARM_MINOR_PARTS, 0.6);
    // central bulge: warm-cyan core gradient (the selective warm accent)
    {
      const core = sg.createRadialGradient(R0, R0, 0, R0, R0, Rd * 0.22);
      core.addColorStop(0, 'rgba(255,230,180,0.5)');
      core.addColorStop(0.3, 'rgba(180,210,230,0.32)');
      core.addColorStop(0.7, 'rgba(110,180,210,0.12)');
      core.addColorStop(1, 'rgba(110,180,210,0)');
      sg.fillStyle = core;
      sg.beginPath();
      sg.arc(R0, R0, Rd * 0.22, 0, TAU);
      sg.fill();
    }
    // bulge particle puff, slightly elongated along the bar axis
    {
      const ca = Math.cos(GAL_BAR_ANGLE);
      const sa = Math.sin(GAL_BAR_ANGLE);
      for (let k = 0; k < GAL_BULGE_PARTS; k++) {
        const rr = Rd * 0.18 * Math.sqrt(rng());
        const a0 = rng() * TAU;
        let lx = rr * Math.cos(a0) * 1.25;
        let ly = rr * Math.sin(a0);
        const x = R0 + (lx * ca - ly * sa);
        const y = R0 + (lx * sa + ly * ca) * squash;
        splat(x, y, dot * 0.8, 200, 220, 230, 0.06);
      }
    }
    // bar: an elongated gaussian stripe through center
    {
      const ca = Math.cos(GAL_BAR_ANGLE);
      const sa = Math.sin(GAL_BAR_ANGLE);
      const halfLen = Rd * 0.34;
      const halfW = Rd * 0.06;
      for (let k = 0; k < GAL_BAR_PARTS; k++) {
        const lx = (rng() - 0.5) * 2 * halfLen;
        const ly = (rng() - 0.5) * 2 * halfW;
        const x = R0 + (lx * ca - ly * sa);
        const y = R0 + (lx * sa + ly * ca) * squash;
        splat(x, y, dot * 0.7, 200, 220, 230, 0.08);
      }
    }
    // dust lanes: thin dark log-spiral strokes inside each major arm
    {
      sg.globalCompositeOperation = 'source-over';
      sg.strokeStyle = 'rgba(2,4,12,0.5)';
      sg.lineWidth = Math.max(1, Rd * 0.012);
      for (const o of armOffsets) {
        sg.beginPath();
        let first = true;
        for (let t = 0.3; t <= GAL_THETA_MAX; t += 0.1) {
          const tNorm = t / GAL_THETA_MAX;
          const rSpiral = Rinner * Math.exp(b * t);
          const r = Math.min(Rd, Rinner + (Rd - Rinner) * tNorm * 0.6 + rSpiral * 0.4);
          const ang = t + o - 0.12; // just inside the bright arm
          const x = R0 + r * Math.cos(ang);
          const y = R0 + r * Math.sin(ang) * squash;
          if (first) {
            sg.moveTo(x, y);
            first = false;
          } else sg.lineTo(x, y);
        }
        sg.stroke();
      }
      sg.globalCompositeOperation = 'lighter';
    }
    // SOL marker: real location 26,700 / 50,000 = 0.534 of the disc radius, on a
    // minor-arm spur (the Orion Spur). Stored canvas-center-relative; drawn live.
    {
      const rSun = Rd * 0.534;
      const angSun = armOffsetsMinor[0] + 0.25; // a small spur lead off the minor arm
      galaxySunX = rSun * Math.cos(angSun);
      galaxySunY = rSun * Math.sin(angSun) * squash;
      // seed the screen-space marker so the first overlap frame is correct (RZ7)
      galaxySunScreenX = cx + galaxySunX;
      galaxySunScreenY = cy + galaxySunY;
    }
    // 4 baked glint positions (star-forming knots along the arms)
    for (let i = 0; i < GAL_GLINT_N; i++) {
      const theta = 1.0 + i * 0.7;
      const tNorm = theta / GAL_THETA_MAX;
      const r = Rinner + (Rd - Rinner) * tNorm * 0.8;
      const ang = theta + armOffsets[i % 2];
      galGlintX[i] = r * Math.cos(ang);
      galGlintY[i] = r * Math.sin(ang) * squash;
      galGlintPh[i] = i * 1.7;
    }
    galaxyBuilt = true;
  }

  function drawGalaxy(): void {
    if (!galaxyBuilt) return;
    const ang = reducedMotion ? 0 : (clock * TAU) / GAL_ROT_SEC;
    const sizeCss = galaxyPx / dpr;
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.translate(cx, cy);
    g.rotate(ang);
    g.globalAlpha = aG;
    g.drawImage(galaxyCv, -sizeCss / 2, -sizeCss / 2, sizeCss, sizeCss);
    g.restore();
    g.globalAlpha = 1;
    // SOL marker (galaxySunScreenX/Y were refreshed at the top of draw(), RZ7).
    g.globalCompositeOperation = 'lighter';
    g.lineWidth = 1;
    g.globalAlpha = 0.7 * aG;
    g.strokeStyle = '#6cc5ff';
    g.beginPath();
    g.arc(galaxySunScreenX, galaxySunScreenY, 7, 0, TAU);
    g.stroke();
    g.globalAlpha = 1;
    if (aG > 0.9) {
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = aG;
      g.font = HOLO_LABEL_FONT;
      g.textBaseline = 'alphabetic';
      g.fillStyle = '#bfe6ff';
      g.fillText('SOL', galaxySunScreenX + 10, galaxySunScreenY - 8);
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'lighter';
    }
    // a few twinkling star-forming knots (rotate with the disc)
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    for (let i = 0; i < GAL_GLINT_N; i++) {
      const gx = cx + (galGlintX[i] * ca - galGlintY[i] * sa);
      const gy = cy + (galGlintX[i] * sa + galGlintY[i] * ca);
      const tw = reducedMotion ? 0.45 : 0.3 + 0.3 * Math.sin(clock * 1.3 + galGlintPh[i]);
      g.globalAlpha = aG * tw;
      g.fillStyle = 'rgba(170,235,255,1)';
      g.fillRect(gx - 1, gy - 1, 2, 2);
    }
    g.globalAlpha = 1;
  }

  // --- REGIME X: the Local Group ----------------------------------------------
  function buildCluster(): void {
    if (!galaxyBuilt) buildGalaxy(); // cluster reuses the spiral sprite as members
    clusterPx = Math.round(Math.min(CLUSTER_PX_MUL * Math.min(w, h), CLUSTER_PX_CAP) * dpr);
    if (clusterPx < 2) clusterPx = 2;
    clusterCv.width = clusterPx;
    clusterCv.height = clusterPx;
    const sg = clusterCv.getContext('2d');
    if (!sg) return;
    sg.clearRect(0, 0, clusterPx, clusterPx);
    sg.globalCompositeOperation = 'lighter';
    const C = clusterPx / 2;
    const span = clusterPx * 0.62; // MW <-> M31 separation (2.5 Mly)
    const galDia = clusterPx * 0.16;
    const ySquash = 0.62;
    const rng = makeRng(0x1234abcd);
    // place a downscaled, rotated, optionally extra-squashed galaxy sprite
    const placeGal = (dx: number, dy: number, dia: number, rot: number, extraSquashY: number): void => {
      sg.save();
      sg.translate(C + dx, C + dy);
      sg.rotate(rot);
      sg.scale(1, extraSquashY);
      sg.globalAlpha = 0.85;
      sg.drawImage(galaxyCv, -dia / 2, -dia / 2, dia, dia);
      sg.restore();
    };
    // soft elliptical glow blob (ellipticals / dwarfs / satellites)
    const glow = (dx: number, dy: number, dia: number, r: number, gc: number, bb: number, a: number): void => {
      const x = C + dx;
      const y = C + dy;
      const grad = sg.createRadialGradient(x, y, 0, x, y, dia / 2);
      grad.addColorStop(0, rgba(r, gc, bb, a));
      grad.addColorStop(0.5, rgba(r, gc, bb, a * 0.3));
      grad.addColorStop(1, rgba(r, gc, bb, 0));
      sg.fillStyle = grad;
      sg.beginPath();
      sg.arc(x, y, dia / 2, 0, TAU);
      sg.fill();
    };
    // faint filament hints MW -> M31 -> M33 (baked)
    {
      sg.strokeStyle = 'rgba(90,180,200,0.05)';
      sg.lineWidth = 1;
      sg.beginPath();
      sg.moveTo(C - span / 2, C + 0.15 * span);
      sg.lineTo(C + span / 2, C - 0.1 * span);
      sg.lineTo(C + span * 0.62, C + 0.28 * span);
      sg.stroke();
    }
    // ~20 dwarfs scattered within an ellipse (seeded so the layout is stable)
    for (let k = 0; k < CLUSTER_DWARF_N; k++) {
      const a0 = rng() * TAU;
      const rr = Math.sqrt(rng()) * span * 0.85;
      const dx = rr * Math.cos(a0);
      const dy = rr * Math.sin(a0) * ySquash;
      glow(dx, dy, galDia * (0.05 + rng() * 0.05), 150, 190, 200, 0.12 + rng() * 0.13);
    }
    // satellites + companions
    glow(-span * 0.5 - galDia * 0.18, 0.3 * span, galDia * 0.22, 170, 200, 255, 0.3); // LMC
    glow(-span * 0.5 + galDia * 0.18, 0.32 * span, galDia * 0.16, 170, 200, 255, 0.26); // SMC
    glow(span / 2 - galDia * 0.7, -0.1 * span, galDia * 0.14, 230, 220, 200, 0.32); // M32
    glow(span / 2 + galDia * 0.7, -0.1 * span, galDia * 0.14, 230, 220, 200, 0.3); // M110
    // the three spirals (reuse the galaxy sprite)
    placeGal(-span / 2, 0.15 * span, galDia, 20 * D2R, 1); // Milky Way
    placeGal(span / 2, -0.1 * span, galDia * 1.25, -35 * D2R, 0.45); // Andromeda (edge-on)
    placeGal(span * 0.62, 0.28 * span, galDia * 0.6, 10 * D2R, 0.8); // Triangulum
    // store the home (Milky Way) + M31 core positions for live markers + glints
    clusterHomeX = -span / 2;
    clusterHomeY = 0.15 * span;
    clusterM31X = span / 2;
    clusterM31Y = -0.1 * span;
    clusterBuilt = true;
  }

  function drawCluster(): void {
    if (!clusterBuilt) return;
    const dx = reducedMotion ? 0 : 6 * Math.sin(clock * 0.06);
    const dy = reducedMotion ? 0 : 4 * Math.sin(clock * 0.045);
    const sizeCss = clusterPx / dpr;
    const sx = cx + dx;
    const sy = cy + dy;
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = aX;
    g.drawImage(clusterCv, sx - sizeCss / 2, sy - sizeCss / 2, sizeCss, sizeCss);
    g.globalAlpha = 1;
    // scale cluster-canvas px -> screen px (the sprite is drawn at sizeCss)
    const k = sizeCss / clusterPx;
    const hX = sx + clusterHomeX * k;
    const hY = sy + clusterHomeY * k;
    const mX = sx + clusterM31X * k;
    const mY = sy + clusterM31Y * k;
    // two cores breathe
    const breath = (ph: number): number => (reducedMotion ? 0.85 : 0.85 + 0.15 * Math.sin(clock * 0.5 + ph));
    g.fillStyle = 'rgba(200,230,255,1)';
    g.globalAlpha = aX * 0.5 * breath(0);
    g.fillRect(hX - 1.5, hY - 1.5, 3, 3);
    g.globalAlpha = aX * 0.5 * breath(1.6);
    g.fillRect(mX - 1.5, mY - 1.5, 3, 3);
    g.globalAlpha = 1;
    // home marker on the Milky Way
    g.lineWidth = 1;
    g.globalAlpha = 0.7 * aX;
    g.strokeStyle = '#6cc5ff';
    g.beginPath();
    g.arc(hX, hY, 6, 0, TAU);
    g.stroke();
    g.globalAlpha = 1;
    // labels fade in late (aX>0.85)
    if (aX > 0.85) {
      g.globalCompositeOperation = 'source-over';
      g.font = HOLO_LABEL_FONT;
      g.textBaseline = 'alphabetic';
      g.fillStyle = '#bfe6ff';
      g.globalAlpha = (aX - 0.85) / 0.15;
      g.fillText('MILKY WAY', hX + 8, hY - 8);
      g.fillText('ANDROMEDA M31', mX + 8, mY - 8);
      g.fillText('TRIANGULUM M33', sx + clusterPx * 0.62 * k + 6, sy + clusterPx * 0.28 * k);
      if (aX > 0.9) g.fillText('YOU ARE HERE', hX - 26, hY + 14);
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'lighter';
    }
    g.globalAlpha = 1;
  }

  // --- REGIME U: the observable universe (cosmic web) -------------------------
  function buildCosmicWeb(): void {
    webPx = Math.round(Math.min(WEB_PX_MUL * Math.min(w, h), WEB_PX_CAP) * dpr);
    if (webPx < 2) webPx = 2;
    webCv.width = webPx;
    webCv.height = webPx;
    const sg = webCv.getContext('2d');
    if (!sg) return;
    sg.clearRect(0, 0, webPx, webPx);
    sg.globalCompositeOperation = 'lighter';
    const C = webPx / 2;
    const rng = makeRng(0x55aa33cc);
    const discR = webPx * WEB_DISC_R_FRAC;
    const attractX = new Float64Array(WEB_ATTRACTORS);
    const attractY = new Float64Array(WEB_ATTRACTORS);
    for (let i = 0; i < WEB_ATTRACTORS; i++) {
      const a0 = rng() * TAU;
      const rr = rng() * webPx * 0.42;
      attractX[i] = C + rr * Math.cos(a0);
      attractY[i] = C + rr * Math.sin(a0);
    }
    const nodeX = new Float64Array(WEB_NODE_N);
    const nodeY = new Float64Array(WEB_NODE_N);
    const nodeMass = new Float64Array(WEB_NODE_N);
    const gauss = (): number => {
      // Box-Muller, one value
      const u1 = Math.max(1e-9, rng());
      const u2 = rng();
      return Math.sqrt(-2 * Math.log(u1)) * Math.cos(TAU * u2);
    };
    const sigma = webPx * WEB_ATTRACT_SIGMA_FRAC;
    for (let i = 0; i < WEB_NODE_N; i++) {
      let x: number, y: number, mass: number;
      if (rng() < WEB_ATTRACT_FRAC) {
        const ai = (rng() * WEB_ATTRACTORS) | 0;
        x = attractX[ai] + gauss() * sigma;
        y = attractY[ai] + gauss() * sigma;
        mass = 0.7 + rng() * 0.6;
      } else {
        const a0 = rng() * TAU;
        const rr = Math.sqrt(rng()) * discR;
        x = C + rr * Math.cos(a0);
        y = C + rr * Math.sin(a0);
        mass = 0.3 + rng() * 0.4;
      }
      // clamp inside the CMB rim
      const ddx = x - C;
      const ddy = y - C;
      const dd = Math.hypot(ddx, ddy);
      if (dd > discR) {
        x = C + (ddx / dd) * discR;
        y = C + (ddy / dd) * discR;
      }
      nodeX[i] = x;
      nodeY[i] = y;
      nodeMass[i] = mass;
    }
    // edges: connect each node to its nearest few neighbors within a max distance
    const maxD = webPx * WEB_EDGE_MAXDIST_FRAC;
    sg.lineWidth = 1;
    for (let i = 0; i < WEB_NODE_N; i++) {
      // find up to WEB_EDGE_NEIGHBORS nearest within maxD
      let found = 0;
      for (let j = i + 1; j < WEB_NODE_N && found < WEB_EDGE_NEIGHBORS; j++) {
        const d = Math.hypot(nodeX[i] - nodeX[j], nodeY[i] - nodeY[j]);
        if (d > maxD || d < 1) continue;
        const a = WEB_EDGE_ALPHA * (1 - d / maxD);
        sg.strokeStyle = rgba(80, 170, 190, a);
        sg.beginPath();
        sg.moveTo(nodeX[i], nodeY[i]);
        sg.lineTo(nodeX[j], nodeY[j]);
        sg.stroke();
        found++;
      }
    }
    // node glow dots
    for (let i = 0; i < WEB_NODE_N; i++) {
      const sz = 2 + nodeMass[i] * 4;
      const big = nodeMass[i] > 0.7;
      const cr = big ? 120 : 90;
      const cg2 = big ? 232 : 150;
      const cb = big ? 255 : 200;
      const grad = sg.createRadialGradient(nodeX[i], nodeY[i], 0, nodeX[i], nodeY[i], sz);
      grad.addColorStop(0, rgba(cr, cg2, cb, 0.5));
      grad.addColorStop(1, rgba(cr, cg2, cb, 0));
      sg.fillStyle = grad;
      sg.beginPath();
      sg.arc(nodeX[i], nodeY[i], sz, 0, TAU);
      sg.fill();
    }
    // attractor cores get a brighter warm-cyan accent + collect glint positions
    for (let i = 0; i < WEB_ATTRACTORS; i++) {
      const grad = sg.createRadialGradient(attractX[i], attractY[i], 0, attractX[i], attractY[i], 7);
      grad.addColorStop(0, 'rgba(200,220,230,0.6)');
      grad.addColorStop(1, 'rgba(200,220,230,0)');
      sg.fillStyle = grad;
      sg.beginPath();
      sg.arc(attractX[i], attractY[i], 7, 0, TAU);
      sg.fill();
      if (i < WEB_GLINT_N) {
        webGlintX[i] = attractX[i] - C;
        webGlintY[i] = attractY[i] - C;
        webGlintPh[i] = i * 1.3;
      }
    }
    // CMB horizon rim (warm primordial edge) + inner haze
    {
      sg.strokeStyle = 'rgba(255,210,170,0.06)';
      sg.lineWidth = 1.5;
      sg.beginPath();
      sg.arc(C, C, webPx * 0.47, 0, TAU);
      sg.stroke();
      const haze = sg.createRadialGradient(C, C, webPx * 0.4, C, C, webPx * 0.47);
      haze.addColorStop(0, 'rgba(150,120,160,0)');
      haze.addColorStop(1, 'rgba(150,120,160,0.04)');
      sg.fillStyle = haze;
      sg.beginPath();
      sg.arc(C, C, webPx * 0.47, 0, TAU);
      sg.fill();
    }
    // Laniakea home marker near the first attractor knot (our supercluster)
    webHomeX = attractX[0] - C;
    webHomeY = attractY[0] - C;
    webBuilt = true;
  }

  function drawCosmicWeb(): void {
    if (!webBuilt) return;
    const breath = reducedMotion ? 1 : 0.85 + 0.15 * Math.sin((clock * TAU) / WEB_BREATH_SEC);
    const sizeCss = webPx / dpr;
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = aU * breath;
    g.drawImage(webCv, cx - sizeCss / 2, cy - sizeCss / 2, sizeCss, sizeCss);
    g.globalAlpha = 1;
    const k = sizeCss / webPx;
    const hX = cx + webHomeX * k;
    const hY = cy + webHomeY * k;
    // supercluster knots pulse independently
    for (let i = 0; i < WEB_GLINT_N; i++) {
      const gx = cx + webGlintX[i] * k;
      const gy = cy + webGlintY[i] * k;
      const tw = reducedMotion ? 0.7 : 0.7 + 0.3 * Math.sin(clock * 0.5 + webGlintPh[i]);
      g.globalAlpha = aU * tw;
      g.fillStyle = 'rgba(200,230,255,1)';
      g.fillRect(gx - 1.5, gy - 1.5, 3, 3);
    }
    g.globalAlpha = 1;
    // Laniakea marker
    g.lineWidth = 1;
    g.globalAlpha = 0.7 * aU;
    g.strokeStyle = '#6cc5ff';
    g.beginPath();
    g.arc(hX, hY, 6, 0, TAU);
    g.stroke();
    g.globalAlpha = 1;
    if (aU > 0.9) {
      g.globalCompositeOperation = 'source-over';
      g.font = HOLO_LABEL_FONT;
      g.textBaseline = 'alphabetic';
      g.fillStyle = '#bfe6ff';
      g.globalAlpha = aU;
      g.fillText('LANIAKEA // HOME', hX + 8, hY - 8);
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'lighter';
    }
    g.globalAlpha = 1;
  }

  // --- REGIME M: the multiverse (merging universe bubbles) --------------------
  // Each bubble bakes once onto multiCv as a soft radial-gradient sphere with a
  // faint internal speckle (a cosmic-web hint). Per frame the bubbles are drawn
  // from multiCv at slowly drifting centers so they slide together and apart;
  // where two bubbles overlap, a brighter iridescent shimmer paints the lens-
  // shaped seam. Cool cyan/violet/teal. Static under reducedMotion (no drift, no
  // shimmer pulse). One heavy build (the bubble bake) gated through sequenceCosmic.
  function buildMultiverse(): void {
    multiPx = Math.round(Math.min(MULTI_PX_MUL * Math.min(w, h), MULTI_PX_CAP) * dpr);
    if (multiPx < 2) multiPx = 2;
    // The bubble canvas is one cell per bubble laid side by side so each bubble
    // can be drawn independently at its drifted center. Cell = the bubble's full
    // footprint; we bake MULTI_BUBBLE_N cells in a single row.
    const cell = Math.max(2, Math.round(multiPx * 0.5)); // per-bubble footprint
    multiCv.width = cell * MULTI_BUBBLE_N;
    multiCv.height = cell;
    const sg = multiCv.getContext('2d');
    if (!sg) return;
    sg.clearRect(0, 0, multiCv.width, multiCv.height);
    sg.globalCompositeOperation = 'lighter';
    const rng = makeRng(0x7a11bb22);
    // bubble homes are stored relative to the field center (cx/cy at draw time).
    for (let bI = 0; bI < MULTI_BUBBLE_N; bI++) {
      const tint = MULTI_TINTS[bI % MULTI_TINTS.length];
      multiTint[bI] = bI % MULTI_TINTS.length;
      // home center: scattered around the field center within a disc
      const a0 = (bI * TAU) / MULTI_BUBBLE_N + (rng() - 0.5) * 0.7;
      const rr = (0.12 + rng() * 0.22) * multiPx;
      multiHomeX[bI] = rr * Math.cos(a0);
      multiHomeY[bI] = rr * Math.sin(a0) * 0.82; // slight vertical squash
      const rad = (0.22 + rng() * 0.12) * multiPx; // large overlapping spheres
      multiR[bI] = rad;
      multiDriftPh[bI] = rng() * TAU;
      multiDriftAmp[bI] = (0.04 + rng() * 0.05) * multiPx;
      // bake the bubble into its cell (centered)
      const cc = cell / 2;
      const cr = Math.min(cc - 1, rad);
      const grad = sg.createRadialGradient(bI * cell + cc, cc, 0, bI * cell + cc, cc, cr);
      grad.addColorStop(0, rgba(tint[0], tint[1], tint[2], 0.16));
      grad.addColorStop(0.55, rgba(tint[0], tint[1], tint[2], 0.08));
      grad.addColorStop(0.85, rgba(tint[0], tint[1], tint[2], 0.03));
      grad.addColorStop(1, rgba(tint[0], tint[1], tint[2], 0));
      sg.fillStyle = grad;
      sg.beginPath();
      sg.arc(bI * cell + cc, cc, cr, 0, TAU);
      sg.fill();
      // faint internal cosmic-web speckle (a few dim dots inside the bubble)
      for (let k = 0; k < MULTI_SPECKLE_N; k++) {
        const sa = rng() * TAU;
        const sr = Math.sqrt(rng()) * cr * 0.9;
        const sx = bI * cell + cc + sr * Math.cos(sa);
        const sy = cc + sr * Math.sin(sa);
        const sz = 0.6 + rng() * 1.1;
        const sgrad = sg.createRadialGradient(sx, sy, 0, sx, sy, sz * 2);
        sgrad.addColorStop(0, rgba(tint[0] + 40, tint[1] + 20, 255, 0.18));
        sgrad.addColorStop(1, rgba(tint[0] + 40, tint[1] + 20, 255, 0));
        sg.fillStyle = sgrad;
        sg.beginPath();
        sg.arc(sx, sy, sz * 2, 0, TAU);
        sg.fill();
      }
    }
    multiBuilt = true;
  }

  function drawMultiverse(): void {
    if (!multiBuilt) return;
    const cell = multiCv.height; // square cells; height == cell size in device px
    const cssCell = cell / dpr; // baked cell drawn at this css size
    const phase = reducedMotion ? 0 : (clock * TAU) / MULTI_DRIFT_SEC;
    g.globalCompositeOperation = 'lighter';
    // per-frame drifted screen centers (multiHome / amp are device-canvas px, so
    // bring them to css px with /dpr); stored in the hoisted scratch arrays.
    for (let bI = 0; bI < MULTI_BUBBLE_N; bI++) {
      const dphase = phase + multiDriftPh[bI];
      const dx = reducedMotion ? 0 : Math.cos(dphase) * multiDriftAmp[bI];
      const dy = reducedMotion ? 0 : Math.sin(dphase * 0.8) * multiDriftAmp[bI];
      const scx = cx + (multiHomeX[bI] + dx) / dpr;
      const scy = cy + (multiHomeY[bI] + dy) / dpr;
      multiScreenX[bI] = scx;
      multiScreenY[bI] = scy;
      g.globalAlpha = aM;
      g.drawImage(multiCv, bI * cell, 0, cell, cell, scx - cssCell / 2, scy - cssCell / 2, cssCell, cssCell);
    }
    g.globalAlpha = 1;
    // iridescent seam shimmer: for each overlapping pair, paint a small bright
    // iridescent splat at the midpoint of the intersection (the merging lens).
    const shimmer = reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(clock * 0.7);
    for (let i = 0; i < MULTI_BUBBLE_N; i++) {
      const ri = multiR[i] / dpr;
      for (let j = i + 1; j < MULTI_BUBBLE_N; j++) {
        const rj = multiR[j] / dpr;
        const dxs = multiScreenX[j] - multiScreenX[i];
        const dys = multiScreenY[j] - multiScreenY[i];
        const dist = Math.hypot(dxs, dys);
        if (dist >= ri + rj || dist < 1) continue; // not overlapping
        const overlap = (ri + rj - dist) / (ri + rj); // 0..1 merge depth
        // seam center along the line between the two centers
        const t = (ri - rj + dist) / (2 * dist);
        const mxp = multiScreenX[i] + dxs * t;
        const myp = multiScreenY[i] + dys * t;
        const seamR = Math.max(3, Math.min(ri, rj) * 0.5 * overlap + 3);
        const ti = MULTI_TINTS[multiTint[i]];
        const tj = MULTI_TINTS[multiTint[j]];
        // iridescent: blend the two bubble tints, lifted toward white
        const cr = Math.min(255, (ti[0] + tj[0]) / 2 + 60);
        const cg = Math.min(255, (ti[1] + tj[1]) / 2 + 60);
        const cb = Math.min(255, (ti[2] + tj[2]) / 2 + 40);
        const a = aM * (0.1 + 0.22 * overlap) * (0.6 + 0.4 * shimmer);
        const grad = g.createRadialGradient(mxp, myp, 0, mxp, myp, seamR);
        grad.addColorStop(0, rgba(cr, cg, cb, a));
        grad.addColorStop(0.6, rgba(cr, cg, cb, a * 0.4));
        grad.addColorStop(1, rgba(cr, cg, cb, 0));
        g.fillStyle = grad;
        g.beginPath();
        g.arc(mxp, myp, seamR, 0, TAU);
        g.fill();
      }
    }
    g.globalAlpha = 1;
    // a faint label fades in late, like the other cosmic regimes
    if (aM > 0.9) {
      g.globalCompositeOperation = 'source-over';
      g.font = HOLO_LABEL_FONT;
      g.textBaseline = 'alphabetic';
      g.fillStyle = '#bfe6ff';
      g.globalAlpha = (aM - 0.9) / 0.1;
      g.fillText('MULTIVERSE // MERGING', cx - 48, cy - cssCell * 0.5);
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'lighter';
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }

  // --- REGIME P: dimensional planes (stacked wireframe branes) ----------------
  // A stack of large translucent wireframe grid parallelograms at varied tilts,
  // depth-sorted so nearer sheets are brighter, with glowing edges and a faint
  // hyperdimensional shimmer; a single faint tesseract wireframe sits at center
  // for flavor. Drawn per frame (line work is cheap); the per-plane orientations
  // are baked once (buildDimensionalPlaneLayout) so the stack does not reshuffle.
  // Slow rotation only when not reducedMotion.
  function buildDimensionalPlaneLayout(): void {
    const rng = makeRng(0x3c0ffee1);
    for (let p = 0; p < PLANE_N; p++) {
      planeZ[p] = -1 + (2 * p) / Math.max(1, PLANE_N - 1) + (rng() - 0.5) * 0.12;
      planeTilt[p] = (0.5 + rng() * 0.5) * (rng() < 0.5 ? 1 : -1); // radians of pitch
      planeYaw[p] = rng() * TAU;
      planeOrder[p] = p;
    }
    planesBuilt = true;
  }

  /** Project a brane-local (u, v) on plane p into screen space. The plane is a
   * grid in its own u/v axes, pitched by planeTilt, yawed by planeYaw + a slow
   * global spin, and pushed to depth planeZ; depth foreshortens v (a simple
   * orthographic tilt) and shifts the sheet vertically so the stack reads as
   * layered sheets receding in z. Returns into the passed out object. */
  function projectPlane(
    p: number,
    u: number,
    v: number,
    half: number,
    spin: number,
    out: { x: number; y: number }
  ): void {
    const cyaw = Math.cos(planeYaw[p] + spin);
    const syaw = Math.sin(planeYaw[p] + spin);
    // rotate u/v in-plane by yaw
    const ru = u * cyaw - v * syaw;
    const rv = u * syaw + v * cyaw;
    // pitch foreshortens the v axis (cos of the tilt) and the sheet's depth z
    // offsets it vertically so deeper sheets sit higher/farther.
    const pitch = Math.cos(planeTilt[p]);
    const x = cx + ru * half;
    const y = cy + rv * half * pitch + planeZ[p] * half * 0.55;
    out.x = x;
    out.y = y;
  }

  const planeOut = { x: 0, y: 0 };
  const planeOut2 = { x: 0, y: 0 };
  function drawDimensionalPlanes(): void {
    if (!planesBuilt) buildDimensionalPlaneLayout();
    const half = Math.min(w, h) * 0.42;
    const spin = reducedMotion ? 0 : (clock * TAU) / PLANE_ROT_SEC;
    const shimmer = reducedMotion ? 0.55 : 0.55 + 0.45 * Math.sin(clock * 0.6);
    const planeRgb = PLANE_RGB;
    const planeEdgeRgb = PLANE_EDGE_RGB;
    // depth-sort back-to-front so nearer (larger z) sheets draw last/brightest
    for (let a = 1; a < PLANE_N; a++) {
      const idx = planeOrder[a];
      const zv = planeZ[idx];
      let b = a - 1;
      while (b >= 0 && planeZ[planeOrder[b]] > zv) {
        planeOrder[b + 1] = planeOrder[b];
        b--;
      }
      planeOrder[b + 1] = idx;
    }
    g.globalCompositeOperation = 'lighter';
    g.lineWidth = 1;
    for (let oi = 0; oi < PLANE_N; oi++) {
      const p = planeOrder[oi];
      const depth = (planeZ[p] + 1) / 2; // 0 far .. 1 near
      const gridA = aP * (0.04 + 0.12 * depth);
      const edgeA = aP * (0.12 + 0.3 * depth) * (0.7 + 0.3 * shimmer);
      // interior grid lines (both axes)
      g.strokeStyle = rgba(planeRgb[0], planeRgb[1], planeRgb[2], 1);
      g.globalAlpha = gridA;
      g.beginPath();
      for (let i = 0; i <= PLANE_GRID_DIV; i++) {
        const t = -1 + (2 * i) / PLANE_GRID_DIV;
        // line of constant u (v sweeps -1..1)
        projectPlane(p, t, -1, half, spin, planeOut);
        projectPlane(p, t, 1, half, spin, planeOut2);
        g.moveTo(planeOut.x, planeOut.y);
        g.lineTo(planeOut2.x, planeOut2.y);
        // line of constant v (u sweeps -1..1)
        projectPlane(p, -1, t, half, spin, planeOut);
        projectPlane(p, 1, t, half, spin, planeOut2);
        g.moveTo(planeOut.x, planeOut.y);
        g.lineTo(planeOut2.x, planeOut2.y);
      }
      g.stroke();
      // glowing parallelogram edge (the brane border)
      g.strokeStyle = rgba(planeEdgeRgb[0], planeEdgeRgb[1], planeEdgeRgb[2], 1);
      g.globalAlpha = edgeA;
      g.beginPath();
      projectPlane(p, -1, -1, half, spin, planeOut);
      g.moveTo(planeOut.x, planeOut.y);
      projectPlane(p, 1, -1, half, spin, planeOut);
      g.lineTo(planeOut.x, planeOut.y);
      projectPlane(p, 1, 1, half, spin, planeOut);
      g.lineTo(planeOut.x, planeOut.y);
      projectPlane(p, -1, 1, half, spin, planeOut);
      g.lineTo(planeOut.x, planeOut.y);
      g.closePath();
      g.stroke();
    }
    g.globalAlpha = 1;
    // a single faint tesseract (hypercube) wireframe at center for flavor: an
    // outer cube and an inner cube joined corner to corner, slowly spinning.
    drawTesseract(half * 0.34, spin, shimmer);
    // label fades in late
    if (aP > 0.9) {
      g.globalCompositeOperation = 'source-over';
      g.font = HOLO_LABEL_FONT;
      g.textBaseline = 'alphabetic';
      g.fillStyle = '#cfe0ff';
      g.globalAlpha = (aP - 0.9) / 0.1;
      g.fillText('STACKED BRANES', cx - 44, cy - half * 0.62);
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'lighter';
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }

  // Tesseract: a 2D projection of a rotating hypercube (outer + inner square with
  // connecting struts), a faint flavor accent at the center of the brane stack.
  const tessOuter = new Float32Array(8); // 4 corners x (x,y)
  const tessInner = new Float32Array(8);
  function drawTesseract(size: number, spin: number, shimmer: number): void {
    const ca = Math.cos(spin * 0.6);
    const sa = Math.sin(spin * 0.6);
    const inner = size * 0.5;
    // 4 corners of a square, rotated by the slow spin, for outer + inner cube
    for (let k = 0; k < 4; k++) {
      const ang = (k * TAU) / 4 + Math.PI / 4;
      const ox = Math.cos(ang) * size;
      const oy = Math.sin(ang) * size;
      tessOuter[k * 2] = cx + (ox * ca - oy * sa);
      tessOuter[k * 2 + 1] = cy + (ox * sa + oy * ca) * 0.8;
      const ix = Math.cos(ang) * inner;
      const iy = Math.sin(ang) * inner;
      tessInner[k * 2] = cx + (ix * ca - iy * sa);
      tessInner[k * 2 + 1] = cy + (ix * sa + iy * ca) * 0.8;
    }
    g.globalCompositeOperation = 'lighter';
    g.lineWidth = 1;
    const tessRgb = TESSERACT_RGB;
    g.strokeStyle = rgba(tessRgb[0], tessRgb[1], tessRgb[2], 1);
    g.globalAlpha = aP * (0.18 + 0.12 * shimmer);
    g.beginPath();
    for (let k = 0; k < 4; k++) {
      const n = (k + 1) % 4;
      // outer edge
      g.moveTo(tessOuter[k * 2], tessOuter[k * 2 + 1]);
      g.lineTo(tessOuter[n * 2], tessOuter[n * 2 + 1]);
      // inner edge
      g.moveTo(tessInner[k * 2], tessInner[k * 2 + 1]);
      g.lineTo(tessInner[n * 2], tessInner[n * 2 + 1]);
      // strut outer -> inner
      g.moveTo(tessOuter[k * 2], tessOuter[k * 2 + 1]);
      g.lineTo(tessInner[k * 2], tessInner[k * 2 + 1]);
    }
    g.stroke();
    g.globalAlpha = 1;
  }

  // --- pointer interactivity (drag to rotate + tilt, inertia on release) ----
  let lastPX = 0;
  let lastPY = 0;
  let lastPT = 0;

  const onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragging = true;
    host.classList.add('globe--dragging');
    lastPX = e.clientX;
    lastPY = e.clientY;
    lastPT = e.timeStamp;
    velLon = 0;
    velTilt = 0;
    resumeAt = Infinity;
    spinBlend = 0;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const onPointerMove = (e: PointerEvent): void => {
    if (!dragging) return;
    const dx = e.clientX - lastPX;
    const dy = e.clientY - lastPY;
    lastPX = e.clientX;
    lastPY = e.clientY;
    const k = 1 / Math.max(60, R);
    // Per-regime drag (RZ6): in the solar view dx yaws the ecliptic (no inertia,
    // dy ignored). G/X/U/M/P get a slower parallax yaw on the same eclipticAz.
    // The Earth and cislunar views drag longitude + tilt with inertia.
    const reg = regime();
    if (reg === 'S' || reg === 'G' || reg === 'X' || reg === 'U' || reg === 'M' || reg === 'P') {
      eclipticAz += dx * k * (reg === 'S' ? 0.5 : 0.18);
      lastPT = e.timeStamp;
      velLon = 0;
      velTilt = 0;
      return;
    }
    const dLon = dx * k;
    const dTilt = dy * k;
    lonOffset += dLon;
    tilt = clampTilt(tilt + dTilt);
    const dtm = Math.max(1, e.timeStamp - lastPT) / 1000;
    lastPT = e.timeStamp;
    velLon = Math.max(-3, Math.min(3, velLon * 0.6 + (dLon / dtm) * 0.4));
    velTilt = Math.max(-3, Math.min(3, velTilt * 0.6 + (dTilt / dtm) * 0.4));
  };

  const onPointerUp = (): void => {
    if (!dragging) return;
    dragging = false;
    host.classList.remove('globe--dragging');
    if (reducedMotion) {
      velLon = 0;
      velTilt = 0;
    }
    resumeAt = clock + 3;
    spinBlend = 0;
  };

  canvas.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);

  // --- B4: wheel zoom (scroll out through Moon and the solar system) ---------
  // deltaMode is normalized to pixels (lines x 16, pages x viewport height) and
  // clamped per event so a flick cannot leap a whole regime. The step grows with
  // zoomTarget so the far reaches scroll at a comfortable pace.
  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    let px = e.deltaY;
    if (e.deltaMode === 1) px *= 16; // lines
    else if (e.deltaMode === 2) px *= h; // pages
    if (px > 120) px = 120;
    else if (px < -120) px = -120;
    // RZ1 wheel curve: the slope grows gently with zoomTarget so Earth -> P is
    // ~33 mouse notches end to end (~3 per band). The +/-120 px clamp caps a
    // single flick so it can never leap a whole crossfade band.
    zoomTarget += ZOOM_WHEEL_STEP * px * (0.7 + 0.28 * zoomTarget);
    if (zoomTarget < ZOOM_MIN) zoomTarget = ZOOM_MIN;
    else if (zoomTarget > ZOOM_MAX) zoomTarget = ZOOM_MAX;
  };
  canvas.addEventListener('wheel', onWheel, { passive: false });

  // --- wiring: store events, visibility, resize, theme ----------------------
  const unsubscribers: Array<() => void> = [];

  const store = ctx?.store;
  if (store && typeof store.subscribe === 'function') {
    // subscribe fires immediately with the current value: skip that first call
    // for traffic events so mounting does not fire phantom arcs. The data splice
    // WANTS the seed value (crypto/stocks/fng) so the scene reflects it at once.
    let firstTicker = true;
    let firstNews = true;
    let firstCandles = true;
    unsubscribers.push(
      store.subscribe('ticker', () => {
        if (firstTicker) {
          firstTicker = false;
          return;
        }
        eventArc();
      }),
      store.subscribe('news', () => {
        if (firstNews) {
          firstNews = false;
          return;
        }
        eventArc();
      }),
      // crypto/stocks: recompute the center-asset splice on every push (seed too)
      store.subscribe('crypto', () => recomputeSplice()),
      store.subscribe('stocks', () => recomputeSplice()),
      // Fear & Greed: take the seed fire too; null/NaN -> neutral 50
      store.subscribe('fng', (v) => {
        const raw = v && Number.isFinite(v.value) ? v.value : 50;
        fngValue = raw;
        rebuildNightSprites(fngValue);
      }),
      // candles: skip the seed, then rate-limit the limb pulse
      store.subscribe('candles', () => {
        if (firstCandles) {
          firstCandles = false;
          return;
        }
        if (clock - limbPulseAt < LIMB_PULSE_MIN) return;
        limbPulseAt = clock;
      }),
      // sats: take the seed fire too (may be [] until the push lands), rebuild
      // the propagation constants + buffers on every push.
      store.subscribe('sats', (list) => rebuildSats(list ?? []))
    );
  }

  let ro: ResizeObserver | null = null;
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => resize());
    ro.observe(host);
  } else {
    const onWinResize = (): void => resize();
    window.addEventListener('resize', onWinResize);
    unsubscribers.push(() => window.removeEventListener('resize', onWinResize));
  }

  const onVisibility = (): void => {
    if (document.hidden) stop();
    else start();
  };
  document.addEventListener('visibilitychange', onVisibility);
  unsubscribers.push(() => document.removeEventListener('visibilitychange', onVisibility));

  // dev-only QA hooks
  if (import.meta.env.DEV) {
    const win = window as unknown as Record<string, unknown>;
    win.__globeDebug = () => ({
      w,
      h,
      running,
      lonOffset,
      tilt,
      dots: DOTS.count,
      arcs: activeArcs(),
      zoom,
      regime: regime(),
      sats: satCount,
      meteors: activeMeteors()
    });
    win.__globeArc = () => spawnArc();
    // spawn one meteor right now (ignores the cadence + aE gate) for QA.
    win.__globeMeteor = () => spawnMeteor();
    win.__globeSpin = (degPerSec?: number) => {
      devSpin = typeof degPerSec === 'number' && Number.isFinite(degPerSec) ? degPerSec * D2R : null;
    };
    // B4: drive the zoom directly (no arg just reports). Returns the live state.
    win.__globeZoom = (zTarget?: number) => {
      if (typeof zTarget === 'number' && Number.isFinite(zTarget)) {
        zoomTarget = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zTarget));
        // QA under a hidden/throttled preview tab: the eased rAF loop never runs,
        // so snap zoom and repaint a few frames (sequenceCosmic builds one lazy
        // cosmic canvas per draw, so several draws are needed to bake + show M/P).
        zoom = zoomTarget;
        for (let i = 0; i < 6; i++) draw();
      }
      return { zoom, zoomTarget, regime: regime(), eclipticAz };
    };
  }

  // initial paint
  sampleTheme();
  rebuildSunSprite();
  computeMoon(); // seed the 1 Hz ephemeris caches before the first draw
  computePlanets();
  resize();
  draw(); // first frame even before rAF (and the only frame under a hidden doc)
  start();

  // RZ3: prewarm the Milky Way sprite at idle after mount so the first scroll out
  // to regime G does not drop a frame building it. Pure art, safe; runs once. The
  // mount itself stays cosmic-free so it never blocks under the 150 ms cap.
  if (!galaxyPrewarmed && typeof window.requestIdleCallback === 'function') {
    galaxyPrewarmed = true;
    window.requestIdleCallback(
      () => {
        if (!galaxyBuilt && w > 1 && h > 1) buildGalaxy();
      },
      { timeout: 4000 }
    );
  }

  // --- teardown --------------------------------------------------------------
  (host as HTMLElement & { dispose?: () => void }).dispose = (): void => {
    stop();
    window.clearInterval(themeId);
    if (ro) ro.disconnect();
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('wheel', onWheel);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
    for (const off of unsubscribers) {
      try {
        off();
      } catch {
        /* ignore */
      }
    }
    if (import.meta.env.DEV) {
      const win = window as unknown as Record<string, unknown>;
      delete win.__globeDebug;
      delete win.__globeArc;
      delete win.__globeMeteor;
      delete win.__globeSpin;
      delete win.__globeZoom;
    }
  };
}
