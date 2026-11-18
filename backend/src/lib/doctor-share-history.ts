import { parseLocalDay } from "./local-day.js";

export function doctorShareSettlementRange(from: unknown, to: unknown) {
  const start = parseLocalDay(from);
  const end = parseLocalDay(to);
  if (!start || !end || start > end) return null;
  end.setDate(end.getDate() + 1);
  return { gte: start, lt: end };
}
