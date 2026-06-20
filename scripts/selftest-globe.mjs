// selftest-globe.mjs :: gating self-test for the globe coastline geography.
// Reads scripts/land-data.json (the SAME array emitted into
// src/renderer/panels/globe/land-data.ts by gen-globe-coast.mjs) plus exact COPIES
// of inPoly / isLand / isAntarctica from globe.ts, then asserts:
//
//   (a) GEOGRAPHY: land cities fall INSIDE some ring; ocean points (>= 4 mid-
//       Atlantic, >= 2 mid-Pacific) fall in NO ring. The mid-Atlantic misses are
//       the objective proof that the Americas no longer merge into Europe/Africa.
//   (b) NO SPURIOUS BRIDGES: every consecutive-vertex edge of every ring spans
//       under EDGE_CAP degrees (|dlon| + |dlat|). A cross-continent bridge edge
//       (the old concatenation/dilation bug) would be huge; this catches it.
//   (c) SANE COUNTS: ring count and total vertices within reasonable bounds.
//
// Exit 0 = ALL PASS, exit 1 = any failure.
// Usage: node scripts/selftest-globe.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const D2R = Math.PI / 180;

// The generated coastline rings (same data imported by globe.ts via land-data.ts).
const LAND = JSON.parse(readFileSync(join(HERE, 'land-data.json'), 'utf8'));

// Per-polygon bounding boxes (COPY of the LAND_BOX builder in globe.ts).
const LAND_BOX = LAND.map((p) => {
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

// COPY of inPoly() from globe.ts (even-odd ray cast over a flat [lon,lat,...] loop).
function inPoly(lon, lat, p) {
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

// COPY of isLand() from globe.ts.
function isLand(lon, lat) {
  for (let k = 0; k < LAND.length; k++) {
    const b = LAND_BOX[k];
    if (lon < b[0] || lon > b[2] || lat < b[1] || lat > b[3]) continue;
    if (inPoly(lon, lat, LAND[k])) return true;
  }
  return false;
}

// COPY of isAntarctica() from globe.ts.
function isAntarctica(lon, lat) {
  if (lat <= -71 + 3.5 * Math.sin((lon + 30) * D2R * 2)) return true;
  return lat <= -64 && lon >= -68 && lon <= -55;
}

// A point counts as land if it falls on a coastline ring OR the analytic Antarctica
// band (the southern cap is painted analytically, not from the ring data).
function landOrPole(lon, lat) {
  return isAntarctica(lon, lat) || isLand(lon, lat);
}

// ---------------------------------------------------------------- (a) GEOGRAPHY

const LAND_POINTS = [
  ['New York', -74, 40.7],
  ['Los Angeles', -118.2, 34],
  ['London', -0.1, 51.5],
  ['Paris', 2.35, 48.85],
  ['Berlin', 13.4, 52.5],
  ['Moscow', 37.6, 55.75],
  ['Cairo', 31.2, 30],
  ['Tokyo', 139.7, 35.7],
  ['Beijing', 116.4, 39.9],
  ['Sydney', 151.2, -33.87],
  ['Sao Paulo', -46.6, -23.5],
  ['Cape Town', 18.4, -33.9],
  ['Reykjavik', -21.9, 64.1],
  ['Mexico City', -99.1, 19.4],
  ['Anchorage', -149.9, 61.2]
];

// OCEAN points that PROVE the continents no longer merge. At least 4 mid-Atlantic
// (Americas vs Europe/Africa) and 2 mid-Pacific (Americas vs Asia) must read ocean.
const OCEAN_POINTS = [
  ['mid-Atlantic 1', -30, 40],
  ['mid-Atlantic 2', -40, 20],
  ['mid-Atlantic 3', -25, 55],
  ['mid-Atlantic 4', -45, 0],
  ['mid-Pacific 1', -140, 0],
  ['mid-Pacific 2', -160, 30],
  ['mid-Indian', 80, -30],
  ['South-Atlantic', -10, -10]
];

let pass = 0;
let fail = 0;
const log = (ok, label, detail) => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(18)} ${detail}`);
};

console.log('(a) GEOGRAPHY');
console.log('  LAND (must be TRUE):');
for (const [name, lon, lat] of LAND_POINTS) {
  const v = landOrPole(lon, lat);
  log(v === true, name, `(${lon}, ${lat}) -> ${v}`);
}
console.log('  OCEAN (must be FALSE -- proves no Atlantic/Pacific merge):');
for (const [name, lon, lat] of OCEAN_POINTS) {
  const v = landOrPole(lon, lat);
  log(v === false, name, `(${lon}, ${lat}) -> ${v}`);
}
console.log('  ANTARCTICA (must be TRUE -- southern cap preserved):');
for (const [name, lon, lat] of [['South Pole', 0, -89], ['Antarctica E', 80, -75]]) {
  const v = isAntarctica(lon, lat);
  log(v === true, name, `(${lon}, ${lat}) -> ${v}`);
}

// --------------------------------------------------------- (b) NO SPURIOUS BRIDGES

const EDGE_CAP = 28; // deg; |dlon| + |dlat| per consecutive-vertex edge (incl. the closing edge)
let longestEdge = 0;
let longestWhere = '';
let overCap = 0;
for (let r = 0; r < LAND.length; r++) {
  const p = LAND[r];
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const dx = Math.abs(p[i] - p[j]);
    const dy = Math.abs(p[i + 1] - p[j + 1]);
    const span = dx + dy;
    if (span > longestEdge) {
      longestEdge = span;
      longestWhere = `ring ${r}: [${p[j]}, ${p[j + 1]}] -> [${p[i]}, ${p[i + 1]}]`;
    }
    if (span > EDGE_CAP) overCap++;
  }
}
console.log('\n(b) NO SPURIOUS BRIDGES');
console.log(`  longest edge (|dlon|+|dlat|): ${longestEdge.toFixed(2)} deg @ ${longestWhere}`);
log(overCap === 0, 'edges under cap', `${overCap} edge(s) over ${EDGE_CAP} deg`);

// ----------------------------------------------------------------- (c) SANE COUNTS

let verts = 0;
for (const p of LAND) verts += p.length / 2;
console.log('\n(c) SANE COUNTS');
console.log(`  rings: ${LAND.length}   vertices: ${verts}`);
log(LAND.length >= 30 && LAND.length <= 400, 'ring count', `${LAND.length} in [30, 400]`);
log(verts >= 1500 && verts <= 20000, 'vertex count', `${verts} in [1500, 20000]`);

// ------------------------------------------------------------------------ summary

console.log(`\nrings: ${LAND.length}   PASS: ${pass}   FAIL: ${fail}`);
if (fail === 0) {
  console.log('ALL PASS');
  process.exit(0);
} else {
  console.log('SELF-TEST FAILED');
  process.exit(1);
}
