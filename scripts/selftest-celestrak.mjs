// Live self-test for the Celestrak adapter (src/main/data/adapters/celestrak.ts)
// plus the orbit math in src/renderer/core/orbits.ts. Hits the real keyless GP
// JSON endpoint for the three groups the adapter fetches and asserts:
//   - the required field set is present on stations[0],
//   - the ISS (NORAD 25544) is present with inclination ~51.6 deg,
//   - propagating the ISS to now (inline copies of the orbits.ts math) puts its
//     sub-point at |lat| <= 52.2 deg and altitude in (300, 500) km,
//   - the visual group returns > 50 rows and gps-ops > 20 rows.
// Runs under plain `node` (no TS build), so it mirrors the adapter + propagation
// rather than importing the .ts sources. selftest-all.mjs treats any throw as a
// fail. Run: node scripts/selftest-celestrak.mjs

const API = 'https://celestrak.org/NORAD/elements/gp.php';
const GROUPS = ['stations', 'visual', 'gps-ops'];

const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 NEXUS-7';

const REQUIRED = [
  'OBJECT_NAME',
  'EPOCH',
  'MEAN_MOTION',
  'ECCENTRICITY',
  'INCLINATION',
  'RA_OF_ASC_NODE',
  'ARG_OF_PERICENTER',
  'MEAN_ANOMALY',
  'NORAD_CAT_ID'
];

function assert(cond, msg) {
  if (!cond) throw new Error(`[celestrak] assertion failed: ${msg}`);
}

async function fetchGroup(group) {
  const url = `${API}?GROUP=${group}&FORMAT=json`;
  const res = await fetch(url, { headers: { 'User-Agent': DESKTOP_UA, Accept: 'application/json' } });
  assert(res.ok, `HTTP ${res.status} for ${group}`);
  const rows = await res.json();
  assert(Array.isArray(rows), `${group} returned a JSON array`);
  return rows;
}

// --- inline copies of the orbits.ts math (kept in lockstep with the .ts) -------

const TAU = Math.PI * 2;
const D2R = Math.PI / 180;
const MU = 398600.4418;
const R_EARTH = 6371;
const J2000_MS = 946728000000;

function gmstRad(t) {
  const days = (t - J2000_MS) / 86400000;
  let deg = (280.46061837 + 360.98564736629 * days) % 360;
  if (deg < 0) deg += 360;
  return deg * D2R;
}

function deriveConst(s) {
  const n = (s.meanMotion * TAU) / 86400;
  const a = Math.cbrt(MU / (n * n));
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

function kepler(M, e) {
  let E = M;
  for (let i = 0; i < 4; i++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  return E;
}

/** Returns { latDeg, altKm } for the satellite sub-point at time t (epoch ms). */
function subpoint(c, t, cg, sg) {
  let M = c.M0 + (c.n * (t - c.epoch)) / 1000;
  M %= TAU;
  if (M < 0) M += TAU;

  const E = kepler(M, c.e);
  const cosE = Math.cos(E);
  const sinE = Math.sin(E);
  const r = c.a * (1 - c.e * cosE);

  const xPf = c.a * (cosE - c.e);
  const yPf = c.a * Math.sqrt(1 - c.e * c.e) * sinE;

  const { ci, si, cO, sO, cw, sw } = c;
  const eciX = xPf * (cO * cw - sO * sw * ci) - yPf * (cO * sw + sO * cw * ci);
  const eciY = xPf * (sO * cw + cO * sw * ci) - yPf * (sO * sw - cO * cw * ci);
  const eciZ = xPf * (sw * si) + yPf * (cw * si);

  // ECEF (Z stays North); latitude = asin(north / r).
  const ecefZ = eciZ;
  const latDeg = Math.asin(ecefZ / r) / D2R;
  const altKm = r - R_EARTH;
  return { latDeg, altKm };
}

/** Mirror celestrak.ts toSat(): map + validate one GP row, or null. */
function toSat(row, group) {
  const name = (row.OBJECT_NAME ?? '').trim();
  const noradId = row.NORAD_CAT_ID;
  if (
    !name ||
    typeof noradId !== 'number' ||
    typeof row.MEAN_MOTION !== 'number' ||
    typeof row.ECCENTRICITY !== 'number' ||
    typeof row.INCLINATION !== 'number' ||
    typeof row.RA_OF_ASC_NODE !== 'number' ||
    typeof row.ARG_OF_PERICENTER !== 'number' ||
    typeof row.MEAN_ANOMALY !== 'number' ||
    !row.EPOCH
  ) {
    return null;
  }
  if (row.MEAN_MOTION <= 0 || row.ECCENTRICITY >= 0.75) return null;
  const epoch = Date.parse(`${row.EPOCH}Z`);
  if (!Number.isFinite(epoch)) return null;
  return {
    name,
    noradId,
    group,
    epoch,
    meanMotion: row.MEAN_MOTION,
    ecc: row.ECCENTRICITY,
    incl: row.INCLINATION,
    raan: row.RA_OF_ASC_NODE,
    argp: row.ARG_OF_PERICENTER,
    meanAnomaly: row.MEAN_ANOMALY
  };
}

// --- run -----------------------------------------------------------------------

const [stationsRaw, visualRaw, gpsRaw] = await Promise.all(GROUPS.map(fetchGroup));

// Required field set on stations[0].
assert(stationsRaw.length > 0, 'stations group is non-empty');
for (const f of REQUIRED) {
  assert(stationsRaw[0][f] !== undefined, `stations[0] has field ${f}`);
}

// ISS present with inclination ~51.6.
const issRow = stationsRaw.find((r) => r.NORAD_CAT_ID === 25544);
assert(issRow, 'ISS (25544) present in stations group');
assert(Math.abs(issRow.INCLINATION - 51.6) < 0.5, `ISS incl ~51.6 (got ${issRow.INCLINATION})`);

// Propagate the ISS sub-point to now and check lat band + altitude.
const iss = toSat(issRow, 'stations');
assert(iss, 'ISS row maps to a valid SatElement');
const now = Date.now();
const g = gmstRad(now);
const { latDeg, altKm } = subpoint(deriveConst(iss), now, Math.cos(g), Math.sin(g));
assert(Math.abs(latDeg) <= 52.2, `ISS |lat| <= 52.2 (got ${latDeg.toFixed(2)})`);
assert(altKm > 300 && altKm < 500, `ISS alt in (300, 500) km (got ${altKm.toFixed(1)})`);

// Group row counts after validation.
const visual = visualRaw.map((r) => toSat(r, 'visual')).filter(Boolean);
const gps = gpsRaw.map((r) => toSat(r, 'gps-ops')).filter(Boolean);
assert(visual.length > 50, `visual > 50 rows (got ${visual.length})`);
assert(gps.length > 20, `gps-ops > 20 rows (got ${gps.length})`);

console.log(
  `[celestrak] OK  stations=${stationsRaw.length} visual=${visual.length} gps-ops=${gps.length}  ` +
    `ISS lat=${latDeg.toFixed(2)} alt=${altKm.toFixed(0)}km`
);
