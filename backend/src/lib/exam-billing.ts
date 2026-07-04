import { parsePrescribedExamsByKind, type ExamKindSlug, LAB_BILLABLE_EXAM_KINDS } from "./lab-notes.js";
import { getLabExamPriceFcfa } from "./lab-exam-prices.js";

export type { ExamKindSlug };

export const EXAM_KIND_ORDER: ExamKindSlug[] = [
  "examen",
  "radio",
  "echo",
  "odonto",
  "operation",
  "hospitalisation",
];

export { LAB_BILLABLE_EXAM_KINDS };

export type ExamLineDto = {
  kind: ExamKindSlug;
  label: string;
  unitPriceFcfa: number;
};

export type ExamKindSheetDto = {
  kind: ExamKindSlug;
  lines: ExamLineDto[];
  grossFcfa: number;
};

export type ExamReductionsByKind = Record<ExamKindSlug, number>;

export function emptyExamReductionsByKind(): ExamReductionsByKind {
  return {
    examen: 0,
    radio: 0,
    echo: 0,
    odonto: 0,
    operation: 0,
    hospitalisation: 0,
  };
}

export function buildExamSheetsByKind(
  notes?: string | null,
  options?: { billableOnly?: boolean },
): ExamKindSheetDto[] {
  const byKind = parsePrescribedExamsByKind(notes);
  const kinds = options?.billableOnly ? LAB_BILLABLE_EXAM_KINDS : EXAM_KIND_ORDER;
  return kinds.flatMap((kind) => {
    const lines = byKind[kind].map((label) => ({
      kind,
      label,
      unitPriceFcfa: getLabExamPriceFcfa(label),
    }));
    if (!lines.length) return [];
    const grossFcfa = lines.reduce((sum, line) => sum + line.unitPriceFcfa, 0);
    return [{ kind, lines, grossFcfa }];
  });
}

export function buildExamLinesFromNotes(notes?: string | null): ExamLineDto[] {
  return buildExamSheetsByKind(notes).flatMap((sheet) => sheet.lines);
}

export function computeExamGrossFcfa(notes?: string | null): number {
  return buildExamSheetsByKind(notes).reduce((sum, sheet) => sum + sheet.grossFcfa, 0);
}

export function buildExamsByKindPayload(notes?: string | null): Record<
  ExamKindSlug,
  { lines: ExamLineDto[]; grossFcfa: number }
> {
  const sheets = buildExamSheetsByKind(notes);
  const payload = {} as Record<ExamKindSlug, { lines: ExamLineDto[]; grossFcfa: number }>;
  for (const kind of EXAM_KIND_ORDER) {
    const sheet = sheets.find((row) => row.kind === kind);
    payload[kind] = {
      lines: sheet?.lines ?? [],
      grossFcfa: sheet?.grossFcfa ?? 0,
    };
  }
  return payload;
}

export function clampReductionForSheet(sheet: ExamKindSheetDto, reductionFcfa: number): number {
  return Math.min(Math.max(0, Math.floor(reductionFcfa) || 0), sheet.grossFcfa);
}

export function normalizeExamReductionsByKind(
  sheets: ExamKindSheetDto[],
  input?: Partial<ExamReductionsByKind>,
  legacyTotal?: number,
): ExamReductionsByKind {
  const reductions = emptyExamReductionsByKind();
  const activeKinds = new Set(sheets.map((sheet) => sheet.kind));

  if (input) {
    for (const kind of EXAM_KIND_ORDER) {
      if (!activeKinds.has(kind)) continue;
      const sheet = sheets.find((row) => row.kind === kind)!;
      reductions[kind] = clampReductionForSheet(sheet, Number(input[kind]) || 0);
    }
    return reductions;
  }

  if (legacyTotal != null && legacyTotal > 0) {
    let remaining = Math.min(legacyTotal, sheets.reduce((sum, sheet) => sum + sheet.grossFcfa, 0));
    for (const sheet of sheets) {
      const applied = Math.min(remaining, sheet.grossFcfa);
      reductions[sheet.kind] = applied;
      remaining -= applied;
    }
  }

  return reductions;
}

export function sumExamReductionsByKind(reductions: ExamReductionsByKind, sheets: ExamKindSheetDto[]): number {
  const activeKinds = new Set(sheets.map((sheet) => sheet.kind));
  return EXAM_KIND_ORDER.reduce((sum, kind) => {
    if (!activeKinds.has(kind)) return sum;
    return sum + (reductions[kind] ?? 0);
  }, 0);
}

export function computeExamNetFcfa(sheets: ExamKindSheetDto[], reductions: ExamReductionsByKind): number {
  return sheets.reduce((sum, sheet) => sum + sheet.grossFcfa - (reductions[sheet.kind] ?? 0), 0);
}
