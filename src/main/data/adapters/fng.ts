// Fear & Greed adapter. Hits api.alternative.me/fng/?limit=1 (keyless) and
// normalizes the latest reading into FngData. The API supplies its own
// value_classification label ('Extreme Fear' ... 'Extreme Greed'), which we pass
// through; classify() is a band-matching fallback for the rare case the API omits
// it. The backup heuristic (50 + btcChange*2 clamped 0..100) lives in the
// scheduler, which has the BTC change to feed it; fetchFng keeps the frozen
// no-arg signature. Signature is FROZEN.

import type { FngData } from '../../../shared/types';
import { httpJson } from '../http';

const URL = 'https://api.alternative.me/fng/?limit=1';

/** Raw shape returned by api.alternative.me/fng. */
interface FngResponse {
  data?: Array<{ value?: string; value_classification?: string }>;
}

/** Map a 0..100 value to its band label (fallback when the API omits one). */
function classify(value: number): string {
  if (value <= 24) return 'Extreme Fear';
  if (value <= 49) return 'Fear';
  // Exactly 50 is the only Neutral value, matching alternative.me's own banding.
  if (value === 50) return 'Neutral';
  if (value <= 74) return 'Greed';
  return 'Extreme Greed';
}

/** Current Fear & Greed reading from alternative.me. */
export async function fetchFng(): Promise<FngData> {
  const json = await httpJson<FngResponse>(URL);
  const row = json.data?.[0];
  if (!row) throw new Error('fng: empty data array');

  const value = Number(row.value);
  if (!Number.isFinite(value)) throw new Error(`fng: non-numeric value '${row.value}'`);

  return {
    value,
    classification: row.value_classification ?? classify(value),
    asOf: Date.now()
  };
}
