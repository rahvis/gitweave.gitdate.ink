export const pct = (x: number, digits = 0): string => `${(x * 100).toFixed(digits)}%`;
export const pts = (x: number): string => x.toFixed(1);

export function hours(h: number | null): string {
  if (h === null) return 'n/a';
  if (h < 1) return `${Math.round(h * 60)}min`;
  if (h < 48) return `${h < 10 ? h.toFixed(1) : Math.round(h)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

export function compactDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

/**
 * Deliberately NOT a red/green scale: these are five different kinds of
 * valuable, not a performance gradient. Carbon's categorical palette keeps
 * them distinguishable and colour-blind safe.
 */
export const DIMENSION_COLORS: Record<string, string> = {
  ownership: '#8a3ffc',
  leverage: '#33b1ff',
  reach: '#007d79',
  initiative: '#ff7eb6',
  problemShaping: '#fa4d56',
};
