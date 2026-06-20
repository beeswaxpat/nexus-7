// Celestrak adapter. Keyless public GP (general perturbations) element sets in
// JSON form, one request per group: stations (crewed + ISS), visual (bright
// naked-eye birds incl. the Starlink trains) and gps-ops (the GPS constellation).
// Each group is fetched independently via httpJson (10s timeout + 1 retry); one
// dead group never sinks the rest (Promise.allSettled), and the call only throws
// if EVERY group failed. Rows are validated + capped per group, then deduped by
// NORAD id (the ISS rides in both stations and visual). Follows the coingecko /
// news adapter voice; the renderer's core/orbits.ts derives the orbit math.
// Signature is FROZEN (see types.ts + scheduler.ts jobSats).

import type { SatElement, SatGroup } from '../../../shared/types';
import { httpJson } from '../http';

const API = 'https://celestrak.org/NORAD/elements/gp.php';

/** Groups to fetch, each with a per-group row cap. TOTAL_CAP bounds the merged set. */
const GROUPS: ReadonlyArray<{ group: SatGroup; cap: number }> = [
  { group: 'stations', cap: 25 },
  { group: 'visual', cap: 120 },
  { group: 'gps-ops', cap: 35 }
];

const TOTAL_CAP = 220;

/** Reject anything more eccentric than this (drawing assumes near-circular LEO/MEO). */
const MAX_ECC = 0.75;

/** Reject decayed/garbage LEO: the ISS is ~15.5 rev/day and nothing real exceeds ~16.5. */
const MAX_MEAN_MOTION = 17;

/** Raw GP row shape (only the fields we consume; Celestrak supplies many more). */
interface GpRow {
  OBJECT_NAME?: string;
  EPOCH?: string;
  MEAN_MOTION?: number;
  ECCENTRICITY?: number;
  INCLINATION?: number;
  RA_OF_ASC_NODE?: number;
  ARG_OF_PERICENTER?: number;
  MEAN_ANOMALY?: number;
  NORAD_CAT_ID?: number;
}

/**
 * Map one GP row into a SatElement, or null if it is unusable. Rejects rows
 * missing any required field, a non-positive mean motion, or an eccentricity
 * too high to draw. Celestrak EPOCH is ISO-8601 UTC WITHOUT a trailing Z, so we
 * append one before parsing. One bad row never sinks the rest of the set.
 */
function toSat(row: GpRow, group: SatGroup): SatElement | null {
  const name = (row.OBJECT_NAME ?? '').trim();
  const noradId = row.NORAD_CAT_ID;
  const meanMotion = row.MEAN_MOTION;
  const ecc = row.ECCENTRICITY;
  const incl = row.INCLINATION;
  const raan = row.RA_OF_ASC_NODE;
  const argp = row.ARG_OF_PERICENTER;
  const meanAnomaly = row.MEAN_ANOMALY;

  if (
    !name ||
    typeof noradId !== 'number' ||
    !Number.isFinite(noradId) ||
    typeof meanMotion !== 'number' ||
    !Number.isFinite(meanMotion) ||
    typeof ecc !== 'number' ||
    !Number.isFinite(ecc) ||
    typeof incl !== 'number' ||
    !Number.isFinite(incl) ||
    typeof raan !== 'number' ||
    !Number.isFinite(raan) ||
    typeof argp !== 'number' ||
    !Number.isFinite(argp) ||
    typeof meanAnomaly !== 'number' ||
    !Number.isFinite(meanAnomaly) ||
    !row.EPOCH
  ) {
    return null;
  }

  if (meanMotion <= 0 || meanMotion > MAX_MEAN_MOTION || ecc >= MAX_ECC) return null;

  const epoch = Date.parse(`${row.EPOCH}Z`); // Celestrak omits the trailing Z
  if (!Number.isFinite(epoch)) return null;

  return { name, noradId, group, epoch, meanMotion, ecc, incl, raan, argp, meanAnomaly };
}

/** Fetch + map a single group, capped. Throws so the caller's allSettled isolates it. */
async function fetchGroup(group: SatGroup, cap: number): Promise<SatElement[]> {
  const url = `${API}?GROUP=${group}&FORMAT=json`;
  const rows = await httpJson<GpRow[]>(url);
  const out: SatElement[] = [];
  for (const row of rows) {
    const sat = toSat(row, group);
    if (sat) out.push(sat);
    if (out.length >= cap) break;
  }
  return out;
}

/**
 * Live orbital element sets across all groups. Each group is fetched
 * independently; one failing group never sinks the others. Rows are deduped by
 * NORAD id (the ISS appears in both stations and visual) and the merged set is
 * capped at TOTAL_CAP. Throws only if EVERY group failed.
 */
export async function fetchSats(): Promise<SatElement[]> {
  const settled = await Promise.allSettled(GROUPS.map(({ group, cap }) => fetchGroup(group, cap)));

  let anyOk = false;
  const byId = new Map<number, SatElement>();
  for (let i = 0; i < settled.length; i++) {
    const r = settled[i];
    if (r.status === 'fulfilled') {
      anyOk = true;
      for (const sat of r.value) {
        // First write wins; group priority is stations -> visual -> gps-ops.
        if (!byId.has(sat.noradId)) byId.set(sat.noradId, sat);
      }
    } else {
      const { group } = GROUPS[i];
      console.warn(
        `[celestrak] group failed: ${group}:`,
        r.reason instanceof Error ? r.reason.message : r.reason
      );
    }
  }

  if (!anyOk) throw new Error('celestrak: every group failed');

  return [...byId.values()].slice(0, TOTAL_CAP);
}
