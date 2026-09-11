export const log1p = (x: number): number => Math.log1p(Math.max(0, x));

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? ((s[mid - 1]! + s[mid]!) / 2) : s[mid]!;
}

export function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return s[lo]!;
  return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
}

/**
 * Percentile rank within a cohort, 0–100.
 *
 * Raw dimension values have wildly different units (weighted change volume vs
 * review threads vs effective areas). Percentile-ranking makes them
 * commensurable AND makes the score robust to the long tail — one 4,723-line
 * PR cannot dominate the ranking.
 *
 * Uses the midpoint ("mean rank") convention so ties share a rank fairly.
 */
export function percentileRank(value: number, sortedCohort: number[]): number {
  const n = sortedCohort.length;
  if (n === 0) return 0;
  if (n === 1) return 50;
  let below = 0;
  let equal = 0;
  for (const v of sortedCohort) {
    if (v < value) below += 1;
    else if (v === value) equal += 1;
  }
  return ((below + equal / 2) / n) * 100;
}

/**
 * Effective number of categories = exp(Shannon entropy).
 *
 * This is why "5 areas at 20% each" (→ 5.0) beats "96/1/1/1/1" (→ ~1.2)
 * even though both touch 5 areas. Breadth means spread, not a long tail
 * of drive-by commits.
 */
export function effectiveCount(counts: number[]): number {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  let h = 0;
  for (const c of counts) {
    if (c <= 0) continue;
    const p = c / total;
    h -= p * Math.log(p);
  }
  return Math.exp(h);
}

export const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

export function isoWeek(dateISO: string): string {
  const d = new Date(dateISO);
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export const hoursBetween = (aISO: string, bISO: string): number =>
  (new Date(bISO).getTime() - new Date(aISO).getTime()) / 3_600_000;
