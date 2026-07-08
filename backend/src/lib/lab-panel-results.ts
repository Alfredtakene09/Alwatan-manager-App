import { LAB_RESULTS_PREFIX, parsePrescribedExamsByKind } from "./lab-notes.js";

export const LAB_PANEL_SLUGS = [
  "routine",
  "hormones",
  "biochemie",
  "electrolytes",
  "fertility",
  "liver",
  "lipid",
  "screening",
  "semen",
  "thyroid",
  "coagulation",
  "diabetic",
  "renal",
  "torch",
] as const;

export type LabPanelSlug = (typeof LAB_PANEL_SLUGS)[number];

export const LAB_PANEL_LABELS: Record<LabPanelSlug, string> = {
  routine: "Routine Investigation",
  hormones: "Hormones",
  biochemie: "Biochimie",
  electrolytes: "ABG + Electrolytes",
  fertility: "Fertility Hormones",
  liver: "LFT",
  lipid: "Lipid Profile",
  screening: "Screening Test",
  semen: "Semen Analysis",
  thyroid: "Thyroid Hormones Test",
  coagulation: "Coagulation Test",
  diabetic: "Diabetic Test",
  renal: "Renal function",
  torch: "TORCH IgG Combo Rapid Test",
};

const LEGACY_LAB_PANEL_LABELS: Record<string, string> = {
  'Liver Function': 'liver',
  'Thyroids Hormones Test': 'thyroid',
  'Routine Investigation 2': 'routine',
}

/**
 * Registre dynamique alimenté depuis la base (formulaires gérés via le CRUD labo).
 * Il complète/écrase les valeurs codées en dur ci-dessus tout en gardant la
 * rétro-compatibilité du stockage historique dans `clinicalNotes`.
 */
let dynamicLabelBySlug: Record<string, string> = {};

export function registerLabPanels(panels: { slug: string; label: string }[]) {
  const next: Record<string, string> = {};
  for (const panel of panels) {
    next[panel.slug] = panel.label;
  }
  dynamicLabelBySlug = next;
}

/** Libellé courant d'un slug (dynamique > statique > slug brut). */
export function labelForSlug(slug: string): string {
  return dynamicLabelBySlug[slug] ?? LAB_PANEL_LABELS[slug as LabPanelSlug] ?? slug;
}

function knownSlugs(): string[] {
  return Array.from(
    new Set([...(LAB_PANEL_SLUGS as readonly string[]), ...Object.keys(dynamicLabelBySlug)]),
  );
}

function resolveLabPanelSlug(label: string): string | undefined {
  const dynamic = Object.entries(dynamicLabelBySlug).find(([, panelLabel]) => panelLabel === label)?.[0];
  if (dynamic) return dynamic;
  const current = Object.entries(LAB_PANEL_LABELS).find(([, panelLabel]) => panelLabel === label)?.[0];
  if (current) return current;
  return LEGACY_LAB_PANEL_LABELS[label];
}

const PANEL_LINE_RE = /^Labo panel \(([^)]+)\) : (\{.*\})$/

export function hasLabExamsPrescribed(notes?: string | null) {
  return parsePrescribedExamsByKind(notes).examen.length > 0;
}

export function parseLabPanelResults(notes?: string | null): Record<string, Record<string, string>> {
  const result: Record<string, Record<string, string>> = {};
  if (!notes) return result;

  for (const line of notes.split("\n")) {
    const match = line.trim().match(PANEL_LINE_RE);
    if (!match) continue;
    const label = match[1];
    const slug = resolveLabPanelSlug(label);
    if (!slug) continue;
    try {
      result[slug] = JSON.parse(match[2]) as Record<string, string>;
    } catch {
      // ignore invalid JSON
    }
  }

  return result;
}

function stripPanelLines(notes: string, slug: string) {
  const label = labelForSlug(slug);
  const prefix = `Labo panel (${label}) : `;
  return notes
    .split("\n")
    .filter((line) => !line.trim().startsWith(prefix))
    .join("\n")
    .trim();
}

const PANEL_RECEIVED_RE = /^Labo panel reçu \(([^)]+)\) : (.+)$/;

function stripPanelReceivedLines(notes: string, slug: string) {
  const label = labelForSlug(slug);
  const prefix = `Labo panel reçu (${label}) : `;
  return notes
    .split("\n")
    .filter((line) => !line.trim().startsWith(prefix))
    .join("\n")
    .trim();
}

function upsertPanelReceivedStamp(notes: string, slug: string) {
  const label = labelForSlug(slug);
  const prefix = `Labo panel reçu (${label}) : `;
  const line = `${prefix}${new Date().toISOString()}`;
  const cleaned = stripPanelReceivedLines(notes, slug);
  return cleaned ? `${cleaned}\n${line}` : line;
}

export function parseLabPanelReceivedAt(
  notes?: string | null,
): Record<string, Date> {
  const result: Record<string, Date> = {};
  if (!notes) return result;

  for (const line of notes.split("\n")) {
    const match = line.trim().match(PANEL_RECEIVED_RE);
    if (!match) continue;
    const label = match[1];
    const slug = resolveLabPanelSlug(label);
    if (!slug) continue;
    const parsed = new Date(match[2].trim());
    if (Number.isNaN(parsed.getTime())) continue;
    result[slug] = parsed;
  }

  return result;
}

export function upsertLabPanelResult(
  notes: string | null | undefined,
  slug: string,
  values: Record<string, string>,
) {
  const cleaned = stripPanelLines(notes ?? "", slug);
  const line = `Labo panel (${labelForSlug(slug)}) : ${JSON.stringify(values)}`;
  const withPanel = cleaned ? `${cleaned}\n${line}` : line;
  return upsertPanelReceivedStamp(withPanel, slug);
}

/** Chaque validation (y compris résultats tardifs) ajoute un horodatage distinct. */
export function appendLabResultsCompletion(notes: string | null | undefined) {
  const base = (notes ?? "").trim();
  const stamp = new Date().toISOString();
  const line = `${LAB_RESULTS_PREFIX} — validé le ${stamp}`;
  return base ? `${base}\n${line}` : line;
}

export function isLabPanelSlug(value: string): boolean {
  return knownSlugs().includes(value);
}

export type LabPanelDoctorComment = {
  comment: string;
  doctorId: string;
  updatedAt: string;
};

const PANEL_DOCTOR_COMMENT_RE = /^Labo panel avis médecin \(([^)]+)\) : (\{.*\})$/;

function stripPanelDoctorCommentLines(notes: string, slug: string) {
  const label = labelForSlug(slug);
  const prefix = `Labo panel avis médecin (${label}) : `;
  return notes
    .split("\n")
    .filter((line) => !line.trim().startsWith(prefix))
    .join("\n")
    .trim();
}

export function parseLabPanelDoctorComments(
  notes?: string | null,
): Record<string, LabPanelDoctorComment> {
  const result: Record<string, LabPanelDoctorComment> = {};
  if (!notes) return result;

  for (const line of notes.split("\n")) {
    const match = line.trim().match(PANEL_DOCTOR_COMMENT_RE);
    if (!match) continue;
    const label = match[1];
    const slug = resolveLabPanelSlug(label);
    if (!slug) continue;
    try {
      const parsed = JSON.parse(match[2]) as LabPanelDoctorComment;
      if (typeof parsed.comment === "string" && parsed.comment.trim()) {
        result[slug] = {
          comment: parsed.comment.trim(),
          doctorId: parsed.doctorId ?? "",
          updatedAt: parsed.updatedAt ?? new Date().toISOString(),
        };
      }
    } catch {
      // ignore invalid JSON
    }
  }

  return result;
}

export function upsertLabPanelDoctorComment(
  notes: string | null | undefined,
  slug: string,
  comment: string,
  doctorId: string,
) {
  const cleaned = stripPanelDoctorCommentLines(notes ?? "", slug);
  const trimmed = comment.trim();
  if (!trimmed) return cleaned;

  const payload: LabPanelDoctorComment = {
    comment: trimmed,
    doctorId,
    updatedAt: new Date().toISOString(),
  };
  const line = `Labo panel avis médecin (${labelForSlug(slug)}) : ${JSON.stringify(payload)}`;
  return cleaned ? `${cleaned}\n${line}` : line;
}

export function countLabPanelDoctorComments(notes?: string | null) {
  return Object.keys(parseLabPanelDoctorComments(notes)).length;
}
