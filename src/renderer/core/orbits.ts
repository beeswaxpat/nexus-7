// Orbital mechanics for the holographic Earth's live satellites. Pure, dependency
// free, and allocation-free on the hot path: deriveConst() is called once per
// element set (on a 'sats' store push), propagate()/telemetry() run per sample
// against a caller-owned `out` object so the frame loop never allocates.
//
// Inputs are mean Keplerian elements (SatElement: angles in degrees, meanMotion
// in rev/day, epoch in ms UTC). We solve Kepler's equation, build the perifocal
// position, rotate to ECI, spin into ECEF (Earth-fixed) using a GMST the CALLER
// hoists once per tick, then remap to the globe's frame. Eccentricity is small
// for everything we draw, so a 4-iteration Newton solve is plenty.
//
// FRAME REMAP (critical, see propagate): the globe renderer uses Y-up with the
// North pole along +Y, so ECEF's Z (North) becomes globe.y and ECEF's Y (the
// 90 E meridian) becomes globe.z. Get this wrong and the orbits tilt sideways.

import type { SatElement } from '../../shared/types';

const TAU = Math.PI * 2;
const D2R = Math.PI / 180;

/** Standard gravitational parameter of Earth (km^3 / s^2). */
const MU = 398600.4418;
/** Mean Earth radius (km); altitude ratios and km conversions key off this. */
const R_EARTH = 6371;
/** 2000-01-01T12:00:00Z in epoch ms (J2000 epoch). */
const J2000_MS = 946728000000;

/**
 * Precomputed constants for one satellite, derived once per element set. n is the
 * mean motion in rad/s, a the semi-major axis in km, e the eccentricity; the
 * cos/sin pairs (ci/si, cO/sO, cw/sw) hold the cosine and sine of inclination,
 * RAAN and argument of perigee so the perifocal -> ECI rotation needs no trig per
 * sample. M0 is the mean anomaly at epoch (rad); epoch is epoch ms UTC.
 */
export interface SatConst {
  n: number; // mean motion, rad/s
  a: number; // semi-major axis, km
  e: number; // eccentricity
  ci: number; // cos(incl)
  si: number; // sin(incl)
  cO: number; // cos(raan)
  sO: number; // sin(raan)
  cw: number; // cos(argp)
  sw: number; // sin(argp)
  epoch: number; // epoch ms UTC
  M0: number; // mean anomaly at epoch, rad
}

/** Derive the per-sample constants for one satellite from its mean elements. */
export function deriveConst(s: SatElement): SatConst {
  const n = (s.meanMotion * TAU) / 86400; // rev/day -> rad/s
  const a = Math.cbrt(MU / (n * n)); // Kepler's third law, km
  const i = s.incl * D2R;
  const O = s.raan * D2R;
  const w = s.argp * D2R;
  return {
    n,
    a,
    e: s.ecc,
    ci: Math.cos(i),
    si: Math.sin(i),
    cO: Math.cos(O),
    sO: Math.sin(O),
    cw: Math.cos(w),
    sw: Math.sin(w),
    epoch: s.epoch,
    M0: s.meanAnomaly * D2R
  };
}

/**
 * Greenwich Mean Sidereal Time at epoch-ms `t`, in radians. The caller hoists
 * cos/sin of this once per tick and passes them to propagate() for every sat.
 */
export function gmstRad(t: number): number {
  const days = (t - J2000_MS) / 86400000;
  let deg = (280.46061837 + 360.98564736629 * days) % 360;
  if (deg < 0) deg += 360;
  return deg * D2R;
}

/** Solve Kepler's equation for eccentric anomaly E (Newton, seed E=M, 4 iters). */
function kepler(M: number, e: number): number {
  let E = M;
  for (let i = 0; i < 4; i++) {
    E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  }
  return E;
}

/**
 * One satellite's position in the globe frame: a UNIT direction (x,y,z) plus
 * altRatio = orbital radius / Earth radius (so altRatio ~ 1.05 for the ISS).
 */
export interface SatState {
  x: number;
  y: number;
  z: number;
  altRatio: number;
}

/**
 * Propagate satellite `c` to time `t` (epoch ms), writing the result into `out`
 * (returned for convenience; no allocation). `cg`/`sg` are cos/sin of the GMST
 * for this tick, hoisted once by the caller via gmstRad(). The output direction
 * is normalized to a unit vector; altRatio carries the true radial scale.
 */
export function propagate(c: SatConst, t: number, cg: number, sg: number, out: SatState): SatState {
  // Mean anomaly now, wrapped to [0, TAU).
  let M = c.M0 + (c.n * (t - c.epoch)) / 1000;
  M %= TAU;
  if (M < 0) M += TAU;

  const E = kepler(M, c.e);
  const cosE = Math.cos(E);
  const sinE = Math.sin(E);
  const r = c.a * (1 - c.e * cosE);

  // Perifocal coordinates (z = 0 in plane).
  const xPf = c.a * (cosE - c.e);
  const yPf = c.a * Math.sqrt(1 - c.e * c.e) * sinE;

  // Perifocal -> ECI via Rz(raan) * Rx(incl) * Rz(argp) applied to (xPf, yPf, 0).
  const { ci, si, cO, sO, cw, sw } = c;
  const eciX = xPf * (cO * cw - sO * sw * ci) - yPf * (cO * sw + sO * cw * ci);
  const eciY = xPf * (sO * cw + cO * sw * ci) - yPf * (sO * sw - cO * cw * ci);
  const eciZ = xPf * (sw * si) + yPf * (cw * si);

  // ECI -> ECEF: rotate about North (Z) by -GMST. cg/sg = cos/sin(GMST).
  const ecefX = eciX * cg + eciY * sg;
  const ecefY = -eciX * sg + eciY * cg;
  const ecefZ = eciZ;

  // FRAME REMAP to the globe frame: North along +Y, 90 E meridian along +Z.
  const gx = ecefX;
  const gy = ecefZ;
  const gz = ecefY;

  const inv = r > 0 ? 1 / r : 0;
  out.x = gx * inv;
  out.y = gy * inv;
  out.z = gz * inv;
  out.altRatio = r / R_EARTH;
  return out;
}

/**
 * ISS-style telemetry for the chrome line: orbital radius -> altitude above the
 * mean surface, and instantaneous speed via the vis-viva equation. Independent of
 * GMST (frame-invariant scalars), so no cg/sg needed.
 */
export function telemetry(c: SatConst, t: number): { altKm: number; velKms: number } {
  let M = c.M0 + (c.n * (t - c.epoch)) / 1000;
  M %= TAU;
  if (M < 0) M += TAU;

  const E = kepler(M, c.e);
  const r = c.a * (1 - c.e * Math.cos(E));
  const altKm = r - R_EARTH;
  const velKms = Math.sqrt(MU * (2 / r - 1 / c.a));
  return { altKm, velKms };
}
