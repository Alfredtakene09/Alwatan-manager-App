/** Période calendaire locale `[from, to[` à partir de `YYYY-MM`. */
export function yearMonthRange(yearMonth: string | null | undefined): { from: Date; to: Date } | null {
  if (!yearMonth) return null;
  const match = /^(\d{4})-(\d{2})$/.exec(yearMonth.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return null;
  }
  return {
    from: new Date(year, month - 1, 1),
    to: new Date(year, month, 1),
  };
}

export function parseLimitParam(raw: unknown, fallback: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(1, Math.trunc(n)));
}
