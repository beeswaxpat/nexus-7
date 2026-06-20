// IMPLEMENTED (pure formatters per PORTING_SPEC.md "Number formatting"). Central so
// every panel renders digits identically and they never jitter geometry.

/**
 * Price: >=1 -> 2 decimals; >=0.01 -> 4 decimals; else 8 decimals with trailing
 * zeros trimmed. Prefixed with `$`. null/NaN -> em-dash-free placeholder.
 */
export function formatPrice(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '$...';
  const abs = Math.abs(value);
  if (abs >= 1) return '$' + value.toFixed(2);
  if (abs >= 0.01) return '$' + value.toFixed(4);
  // sub-cent: 8 decimals, trim trailing zeros (but keep at least one decimal)
  const fixed = value.toFixed(8).replace(/0+$/, '').replace(/\.$/, '.0');
  return '$' + fixed;
}

/**
 * Market cap: >=1e12 $X.XT; >=1e9 $X.XB; >=1e6 $X.XM; >=1e3 $X.XK; else $X.
 */
export function formatMarketCap(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return '$...';
  if (value >= 1e12) return '$' + (value / 1e12).toFixed(1) + 'T';
  if (value >= 1e9) return '$' + (value / 1e9).toFixed(1) + 'B';
  if (value >= 1e6) return '$' + (value / 1e6).toFixed(1) + 'M';
  if (value >= 1e3) return '$' + (value / 1e3).toFixed(1) + 'K';
  return '$' + Math.round(value).toString();
}

/**
 * Holding (bag) value: compact like market cap above 100K, otherwise exact dollars
 * with cents so small bags read precisely ($1,234.56).
 */
export function formatHoldingValue(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return '$...';
  if (value >= 1e12) return '$' + (value / 1e12).toFixed(2) + 'T';
  if (value >= 1e9) return '$' + (value / 1e9).toFixed(2) + 'B';
  if (value >= 1e6) return '$' + (value / 1e6).toFixed(2) + 'M';
  if (value >= 1e5) return '$' + (value / 1e3).toFixed(1) + 'K';
  return (
    '$' +
    value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  );
}

/**
 * News age from epoch ms: <60s "just now"; minutes "Xm ago"; hours "Xh ago";
 * days "Xd ago".
 */
export function formatAge(epochMs: number | null | undefined, now: number = Date.now()): string {
  if (epochMs == null || !Number.isFinite(epochMs)) return '';
  const secs = Math.max(0, Math.floor((now - epochMs) / 1000));
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return mins + 'm ago';
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours + 'h ago';
  const days = Math.floor(hours / 24);
  return days + 'd ago';
}

/**
 * Percent change with sign, 2 decimals, trailing `%`. e.g. +6.20% / -3.40%.
 * null -> placeholder.
 */
export function formatPercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '...%';
  const sign = value > 0 ? '+' : '';
  return sign + value.toFixed(2) + '%';
}
