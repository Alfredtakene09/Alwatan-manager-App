import { PatientCategory } from "@prisma/client";

export const EXAMS_PRESCRIBED_PREFIX = "Examens prescrits";
export const EXAMS_PAID_PREFIX = "Examens payés";
export const EXAM_COMMENT_PREFIX = "Commentaire";
export const LAB_RESULTS_PREFIX = "Résultats laboratoire";
export const LAB_RESULTS_COMPLETION_MARKER = `${LAB_RESULTS_PREFIX} — validé le `;

export const EXAM_KIND_SECTION_LABELS = {
  examen: "Laboratoire",
  radio: "Radio",
  echo: "Écho",
  odonto: "Odonto",
  operation: "Opération",
  hospitalisation: "Hospitalisation",
} as const;

export type ExamKindSlug = keyof typeof EXAM_KIND_SECTION_LABELS;

export const EXAM_KIND_ORDER: ExamKindSlug[] = [
  "examen",
  "radio",
  "echo",
  "odonto",
  "operation",
  "hospitalisation",
];

export const LAB_BILLABLE_EXAM_KINDS: ExamKindSlug[] = ["examen", "radio", "echo", "odonto"];

/** Commentaires par type conservés sur les factures examens. */
export const INVOICE_EXAM_COMMENT_KINDS: ExamKindSlug[] = ["radio", "echo", "odonto"];

export const HOSPITALISATION_DAYS_PREFIX = "Durée hospitalisation prévue";

export function hasExamsPrescribed(notes?: string | null): boolean {
  if (!notes) return false;
  if (notes.includes(EXAMS_PRESCRIBED_PREFIX)) return true;
  return Object.values(EXAM_KIND_SECTION_LABELS).some((label) =>
    notes.includes(`${EXAMS_PRESCRIBED_PREFIX} (${label})`),
  );
}

export function hasLabResults(notes?: string | null): boolean {
  return !!notes?.includes(LAB_RESULTS_COMPLETION_MARKER);
}

function allPrescriptionOrClauses() {
  return EXAM_KIND_ORDER.map((kind) => ({
    clinicalNotes: { contains: `${EXAMS_PRESCRIBED_PREFIX} (${EXAM_KIND_SECTION_LABELS[kind]})` },
  }));
}

export function labsPendingApprovalWhere() {
  return {
    OR: [
      { clinicalNotes: { contains: `${EXAMS_PRESCRIBED_PREFIX} : ` } },
      ...allPrescriptionOrClauses(),
    ],
    visit: {
      patient: {
        category: PatientCategory.STANDARD,
      },
    },
  };
}

export function labsPaidExamsWhere() {
  return {
    OR: [
      { labSentToLabAt: { not: null } },
      ...EXAM_KIND_ORDER.map((kind) => ({
        clinicalNotes: { contains: `${EXAMS_PAID_PREFIX} (${EXAM_KIND_SECTION_LABELS[kind]})` },
      })),
    ],
    visit: {
      patient: {
        category: PatientCategory.STANDARD,
      },
    },
  };
}

export function labsWaitingWhere(doctorId?: string) {
  return {
    ...(doctorId ? { doctorId } : {}),
    OR: [
      { labSentToLabAt: { not: null } },
      ...LAB_BILLABLE_EXAM_KINDS.map((kind) => ({
        clinicalNotes: { contains: `${EXAMS_PAID_PREFIX} (${EXAM_KIND_SECTION_LABELS[kind]})` },
      })),
    ],
    NOT: { clinicalNotes: { contains: LAB_RESULTS_COMPLETION_MARKER } },
  };
}

/** Dossiers laboratoire clôturés (résultats validés). */
export function labsCompletedWhere(doctorId?: string) {
  return {
    ...(doctorId ? { doctorId } : {}),
    clinicalNotes: { contains: LAB_RESULTS_COMPLETION_MARKER },
  };
}

function parseExamCommentLine(line: string): { kind: ExamKindSlug; comment: string } | null {
  const trimmed = line.trim();
  for (const kind of EXAM_KIND_ORDER) {
    const prefix = `${EXAM_COMMENT_PREFIX} (${EXAM_KIND_SECTION_LABELS[kind]}) : `;
    if (trimmed.startsWith(prefix)) {
      return { kind, comment: trimmed.slice(prefix.length).trim() };
    }
  }
  return null;
}

function parseHospitalisationDaysLine(line: string): number | null {
  const trimmed = line.trim();
  const prefix = `${HOSPITALISATION_DAYS_PREFIX} : `;
  if (!trimmed.startsWith(prefix)) return null;
  const days = Number.parseInt(trimmed.slice(prefix.length).trim(), 10);
  if (!Number.isFinite(days) || days < 1) return null;
  return days;
}

export function parsePrescribedHospitalisationDays(notes?: string | null): number | null {
  if (!notes) return null;
  for (const line of notes.split("\n")) {
    const days = parseHospitalisationDaysLine(line);
    if (days) return days;
  }
  return null;
}

export function mergeHospitalisationDaysInNotes(notes: string, days: number): string {
  const normalizedDays = Math.max(1, Math.floor(days));
  const line = `${HOSPITALISATION_DAYS_PREFIX} : ${normalizedDays}`;
  const kept = notes
    .split("\n")
    .filter((entry) => !parseHospitalisationDaysLine(entry))
    .join("\n")
    .trim();
  return kept ? `${kept}\n${line}` : line;
}

function isStructuredExamNoteLine(line: string) {
  return (
    !!parseExamLine(line) ||
    !!parseExamCommentLine(line) ||
    !!parsePaidKindLine(line) ||
    !!parseHospitalisationDaysLine(line)
  );
}

function parsePaidKindLine(line: string): { kind: ExamKindSlug; paidAt: Date } | null {
  const trimmed = line.trim();
  for (const kind of EXAM_KIND_ORDER) {
    const prefix = `${EXAMS_PAID_PREFIX} (${EXAM_KIND_SECTION_LABELS[kind]}) : `;
    if (!trimmed.startsWith(prefix)) continue;
    const dateStr = trimmed.slice(prefix.length).trim();
    const parsed = new Date(dateStr);
    if (Number.isNaN(parsed.getTime())) return null;
    return { kind, paidAt: parsed };
  }
  return null;
}

export function parsePaidExamKindsByKind(notes?: string | null): Partial<Record<ExamKindSlug, Date>> {
  const result: Partial<Record<ExamKindSlug, Date>> = {};
  if (!notes) return result;

  for (const line of notes.split("\n")) {
    const parsed = parsePaidKindLine(line);
    if (parsed) result[parsed.kind] = parsed.paidAt;
  }

  return result;
}

export function isExamKindPaid(notes: string | null | undefined, kind: ExamKindSlug): boolean {
  return !!parsePaidExamKindsByKind(notes)[kind];
}

export function getUnpaidPrescribedExamKinds(notes?: string | null): ExamKindSlug[] {
  const prescribed = parsePrescribedExamsByKind(notes);
  const paid = parsePaidExamKindsByKind(notes);
  return EXAM_KIND_ORDER.filter((kind) => (prescribed[kind]?.length ?? 0) > 0 && !paid[kind]);
}

export function hasUnpaidPrescribedExams(notes?: string | null): boolean {
  return getUnpaidPrescribedExamKinds(notes).length > 0;
}

/** Types encaissables à la réception / comptabilité (hors hospitalisation, gérée à part). */
export const CASHIER_PAYMENT_QUEUE_KINDS: ExamKindSlug[] = [
  ...LAB_BILLABLE_EXAM_KINDS,
  "operation",
];

export function getUnpaidCashierQueueKinds(notes?: string | null): ExamKindSlug[] {
  return getUnpaidPrescribedExamKinds(notes).filter((kind) =>
    CASHIER_PAYMENT_QUEUE_KINDS.includes(kind),
  );
}

export function hasUnpaidCashierQueueExams(notes?: string | null): boolean {
  return getUnpaidCashierQueueKinds(notes).length > 0;
}

export function hasAnyPaidExamKind(notes?: string | null): boolean {
  return Object.keys(parsePaidExamKindsByKind(notes)).length > 0;
}

/** Dossier avec examens labo/radio/écho/odonto prescrits et déjà payés ou envoyés au labo. */
export function hasPaidLabWorkPending(
  notes?: string | null,
  labSentToLabAt?: Date | null,
): boolean {
  const prescribed = parsePrescribedExamsByKind(notes);
  const hasBillableExams = LAB_BILLABLE_EXAM_KINDS.some(
    (kind) => (prescribed[kind]?.length ?? 0) > 0,
  );
  if (!hasBillableExams) return false;

  const paid = parsePaidExamKindsByKind(notes);
  if (LAB_BILLABLE_EXAM_KINDS.some((kind) => (prescribed[kind]?.length ?? 0) > 0 && paid[kind])) {
    return true;
  }

  // Paiement direct à la réception (patient externe) : labSentToLabAt sans marqueurs par type.
  return !!labSentToLabAt;
}

export function appendPaidExamKindMarker(
  notes: string | null | undefined,
  kind: ExamKindSlug,
  paidAt: Date,
): string {
  const marker = `${EXAMS_PAID_PREFIX} (${EXAM_KIND_SECTION_LABELS[kind]}) : ${paidAt.toISOString()}`;
  const lines = (notes ?? "").split("\n");
  const filtered = lines.filter((line) => {
    const parsed = parsePaidKindLine(line);
    return !parsed || parsed.kind !== kind;
  });
  const trimmed = filtered.join("\n").trim();
  return trimmed ? `${trimmed}\n${marker}` : marker;
}

export function removePaidExamKindMarker(
  notes: string | null | undefined,
  kind: ExamKindSlug,
): string {
  const lines = (notes ?? "").split("\n");
  const filtered = lines.filter((line) => {
    const parsed = parsePaidKindLine(line);
    return !parsed || parsed.kind !== kind;
  });
  return filtered.join("\n").trim();
}

export function removePrescribedExamLabelsFromNotes(
  notes: string | null | undefined,
  removals: Array<{ examKind: ExamKindSlug; examLabel: string }>,
): string {
  const byKind = parsePrescribedExamsByKind(notes);
  const comments = parsePrescribedExamCommentsByKind(notes);
  for (const { examKind, examLabel } of removals) {
    const target = examLabel.trim();
    byKind[examKind] = (byKind[examKind] ?? []).filter((label) => label.trim() !== target);
  }
  return buildPrescribedExamsNotesByKind(byKind, notes, undefined, comments);
}

function parseExamLine(line: string): { kind: ExamKindSlug; exams: string[] } | null {
  const trimmed = line.trim();
  for (const kind of EXAM_KIND_ORDER) {
    const prefix = `${EXAMS_PRESCRIBED_PREFIX} (${EXAM_KIND_SECTION_LABELS[kind]}) : `;
    if (trimmed.startsWith(prefix)) {
      const exams = trimmed
        .slice(prefix.length)
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      return { kind, exams };
    }
  }

  const legacyPrefix = `${EXAMS_PRESCRIBED_PREFIX} : `;
  if (trimmed.startsWith(legacyPrefix)) {
    const exams = trimmed
      .slice(legacyPrefix.length)
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    return { kind: "examen", exams };
  }

  return null;
}

export function parsePrescribedExamsByKind(notes?: string | null): Record<ExamKindSlug, string[]> {
  const result: Record<ExamKindSlug, string[]> = {
    examen: [],
    radio: [],
    echo: [],
    odonto: [],
    operation: [],
    hospitalisation: [],
  };
  if (!notes) return result;

  for (const line of notes.split("\n")) {
    const parsed = parseExamLine(line);
    if (!parsed) continue;
    result[parsed.kind] = [...result[parsed.kind], ...parsed.exams];
  }

  return result;
}

export function parsePrescribedExamCommentsByKind(notes?: string | null): Record<ExamKindSlug, string> {
  const result: Record<ExamKindSlug, string> = {
    examen: "",
    radio: "",
    echo: "",
    odonto: "",
    operation: "",
    hospitalisation: "",
  };
  if (!notes) return result;

  for (const line of notes.split("\n")) {
    const parsed = parseExamCommentLine(line);
    if (!parsed?.comment) continue;
    result[parsed.kind] = parsed.comment;
  }

  return result;
}

export function flattenPrescribedExams(examsByKind: Record<ExamKindSlug, string[]>) {
  return EXAM_KIND_ORDER.flatMap((kind) => examsByKind[kind]);
}

export function mergeExamsByKind(
  existing: Record<ExamKindSlug, string[]>,
  additional: Partial<Record<ExamKindSlug, string[]>>,
): Record<ExamKindSlug, string[]> {
  const result = { ...existing };
  for (const kind of EXAM_KIND_ORDER) {
    const added = additional[kind]?.filter(Boolean) ?? [];
    if (!added.length) continue;
    result[kind] = [...new Set([...(result[kind] ?? []), ...added])];
  }
  return result;
}

export function countNewExamsInAppend(
  existingNotes: string | null | undefined,
  additional: Partial<Record<ExamKindSlug, string[]>>,
) {
  const existing = parsePrescribedExamsByKind(existingNotes);
  let count = 0;
  for (const kind of EXAM_KIND_ORDER) {
    const known = new Set(existing[kind] ?? []);
    for (const exam of additional[kind] ?? []) {
      if (exam && !known.has(exam)) count += 1;
    }
  }
  return count;
}

/**
 * Dossiers avec au moins un résultat labo (panneau ou validation).
 * Le filtre médecin est appliqué au niveau visite (medecinMatchWhere) :
 * ne pas restreindre consultation.doctorId ici — sinon les résultats tardifs
 * d'une visite réassignée n'apparaissent pas chez le médecin concerné.
 */
export function labsResultsWhere() {
  return {
    clinicalNotes: { contains: LAB_RESULTS_COMPLETION_MARKER },
  };
}

/** Dernière validation globale des résultats labo (ligne la plus récente). */
export function parseLabResultsCompletionAt(notes?: string | null): Date | null {
  if (!notes) return null;
  const marker = LAB_RESULTS_COMPLETION_MARKER;
  let latest: Date | null = null;
  for (const line of notes.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.includes(marker)) continue;
    const dateStr = trimmed.slice(trimmed.indexOf(marker) + marker.length).trim();
    const parsed = new Date(dateStr);
    if (Number.isNaN(parsed.getTime())) continue;
    if (!latest || parsed > latest) latest = parsed;
  }
  return latest;
}

/** Horodatage le plus récent parmi validations et panneaux reçus. */
export function parseLatestLabResultAt(notes?: string | null): Date | null {
  const completion = parseLabResultsCompletionAt(notes);
  let latest = completion;
  for (const line of (notes ?? "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("Labo panel reçu (")) continue;
    const colon = trimmed.lastIndexOf(" : ");
    if (colon < 0) continue;
    const parsed = new Date(trimmed.slice(colon + 3).trim());
    if (Number.isNaN(parsed.getTime())) continue;
    if (!latest || parsed > latest) latest = parsed;
  }
  return latest;
}

function preserveNonPrescriptionClinicalLines(notes?: string | null): string[] {
  if (!notes) return [];
  return notes.split("\n").filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    if (parsePaidKindLine(trimmed)) return true;
    if (trimmed.startsWith(LAB_RESULTS_PREFIX)) return true;
    if (trimmed.startsWith("Labo panel")) return true;
    if (parseHospitalisationDaysLine(trimmed)) return true;
    return false;
  });
}

export function parsePrescribedExamLabels(notes?: string | null): string[] {
  const byKind = parsePrescribedExamsByKind(notes);
  return flattenPrescribedExams(byKind);
}

export function buildPrescribedExamsNotesByKind(
  examsByKind: Partial<Record<ExamKindSlug, string[]>>,
  existingNotes?: string | null,
  extraNotes?: string,
  commentsByKind?: Partial<Record<ExamKindSlug, string>>,
): string {
  const examLines = EXAM_KIND_ORDER.flatMap((kind) => {
    const exams = examsByKind[kind]?.filter(Boolean) ?? [];
    const comment =
      INVOICE_EXAM_COMMENT_KINDS.includes(kind) ? (commentsByKind?.[kind]?.trim() ?? "") : "";
    const lines: string[] = [];
    if (exams.length) {
      lines.push(`${EXAMS_PRESCRIBED_PREFIX} (${EXAM_KIND_SECTION_LABELS[kind]}) : ${exams.join(", ")}`);
    }
    if (comment) {
      lines.push(`${EXAM_COMMENT_PREFIX} (${EXAM_KIND_SECTION_LABELS[kind]}) : ${comment}`);
    }
    return lines;
  });

  const preserved = preserveNonPrescriptionClinicalLines(existingNotes);
  const trailing = (existingNotes ?? "")
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      if (isStructuredExamNoteLine(trimmed)) return false;
      if (trimmed.startsWith("Labo panel")) return false;
      if (trimmed.startsWith(LAB_RESULTS_PREFIX)) return false;
      return true;
    })
    .join("\n")
    .trim();

  const blocks = [...examLines, ...preserved];
  if (trailing) blocks.push(trailing);
  if (extraNotes?.trim()) blocks.push(extraNotes.trim());
  return blocks.join("\n");
}

export function buildPrescribedExamsNotes(
  exams: string[],
  existingNotes?: string | null,
  extraNotes?: string,
): string {
  return buildPrescribedExamsNotesByKind({ examen: exams }, existingNotes, extraNotes);
}
