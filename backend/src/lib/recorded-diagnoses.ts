import { prisma } from "./db.js";
import { yearMonthRange } from "./year-month.js";

export type RecordedDiagnosisRow = {
  label: string;
  count: number;
  lastAt: Date;
};

function diagnosisKey(label: string) {
  return label.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Regroupe les diagnostics saisis (casse / espaces ignorés). */
export function aggregateDiagnoses(
  rows: Array<{ diagnosis: string | null; createdAt: Date }>,
): RecordedDiagnosisRow[] {
  const map = new Map<string, RecordedDiagnosisRow>();
  for (const row of rows) {
    const label = row.diagnosis?.trim() ?? "";
    if (!label) continue;
    const key = diagnosisKey(label);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { label, count: 1, lastAt: row.createdAt });
      continue;
    }
    existing.count += 1;
    if (row.createdAt > existing.lastAt) {
      existing.lastAt = row.createdAt;
      existing.label = label;
    }
  }
  return [...map.values()].sort(
    (a, b) => b.count - a.count || a.label.localeCompare(b.label, "fr", { sensitivity: "base" }),
  );
}

export async function listRecordedDiagnoses(month?: string | null) {
  const range = yearMonthRange(month ?? undefined);
  const rows = await prisma.consultation.findMany({
    where: {
      diagnosis: { not: null },
      ...(range ? { createdAt: { gte: range.from, lt: range.to } } : {}),
    },
    select: { diagnosis: true, createdAt: true },
  });
  return aggregateDiagnoses(rows);
}
