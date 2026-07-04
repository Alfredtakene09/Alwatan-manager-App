import { LAB_RESULTS_PREFIX, parsePrescribedExamsByKind } from "./lab-notes.js";

export const LAB_PANEL_SLUGS = [
  "coagulation",
  "diabetic",
  "fertility",
  "lipid",
  "liver",
  "renal",
  "routine",
  "screening",
  "semen",
  "thyroid",
  "torch",
] as const;

export type LabPanelSlug = (typeof LAB_PANEL_SLUGS)[number];

export const LAB_PANEL_LABELS: Record<LabPanelSlug, string> = {
  coagulation: "Coagulation Test",
  diabetic: "Diabetic Test",
  fertility: "Fertility Hormones",
  lipid: "Lipid Profile",
  liver: "Liver Function",
  renal: "Renal function",
  routine: "Routine Investigation",
  screening: "Screening Test",
  semen: "Semen Analysis",
  thyroid: "Thyroids Hormones Test",
  torch: "TORCH IgG Combo Rapid Test",
};

const PANEL_LINE_RE = /^Labo panel \(([^)]+)\) : (\{.*\})$/;

export function hasLabExamsPrescribed(notes?: string | null) {
  return parsePrescribedExamsByKind(notes).examen.length > 0;
}

export function parseLabPanelResults(notes?: string | null): Partial<Record<LabPanelSlug, Record<string, string>>> {
  const result: Partial<Record<LabPanelSlug, Record<string, string>>> = {};
  if (!notes) return result;

  for (const line of notes.split("\n")) {
    const match = line.trim().match(PANEL_LINE_RE);
    if (!match) continue;
    const label = match[1];
    const slug = Object.entries(LAB_PANEL_LABELS).find(([, l]) => l === label)?.[0] as LabPanelSlug | undefined;
    if (!slug) continue;
    try {
      result[slug] = JSON.parse(match[2]) as Record<string, string>;
    } catch {
      // ignore invalid JSON
    }
  }

  return result;
}

function stripPanelLines(notes: string, slug: LabPanelSlug) {
  const label = LAB_PANEL_LABELS[slug];
  const prefix = `Labo panel (${label}) : `;
  return notes
    .split("\n")
    .filter((line) => !line.trim().startsWith(prefix))
    .join("\n")
    .trim();
}

const PANEL_RECEIVED_RE = /^Labo panel reçu \(([^)]+)\) : (.+)$/;

function stripPanelReceivedLines(notes: string, slug: LabPanelSlug) {
  const label = LAB_PANEL_LABELS[slug];
  const prefix = `Labo panel reçu (${label}) : `;
  return notes
    .split("\n")
    .filter((line) => !line.trim().startsWith(prefix))
    .join("\n")
    .trim();
}

function upsertPanelReceivedStamp(notes: string, slug: LabPanelSlug) {
  const label = LAB_PANEL_LABELS[slug];
  const prefix = `Labo panel reçu (${label}) : `;
  const line = `${prefix}${new Date().toISOString()}`;
  const cleaned = stripPanelReceivedLines(notes, slug);
  return cleaned ? `${cleaned}\n${line}` : line;
}

export function parseLabPanelReceivedAt(
  notes?: string | null,
): Partial<Record<LabPanelSlug, Date>> {
  const result: Partial<Record<LabPanelSlug, Date>> = {};
  if (!notes) return result;

  for (const line of notes.split("\n")) {
    const match = line.trim().match(PANEL_RECEIVED_RE);
    if (!match) continue;
    const label = match[1];
    const slug = Object.entries(LAB_PANEL_LABELS).find(([, l]) => l === label)?.[0] as
      | LabPanelSlug
      | undefined;
    if (!slug) continue;
    const parsed = new Date(match[2].trim());
    if (Number.isNaN(parsed.getTime())) continue;
    result[slug] = parsed;
  }

  return result;
}

export function upsertLabPanelResult(
  notes: string | null | undefined,
  slug: LabPanelSlug,
  values: Record<string, string>,
) {
  const cleaned = stripPanelLines(notes ?? "", slug);
  const line = `Labo panel (${LAB_PANEL_LABELS[slug]}) : ${JSON.stringify(values)}`;
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

export function isLabPanelSlug(value: string): value is LabPanelSlug {
  return (LAB_PANEL_SLUGS as readonly string[]).includes(value);
}

export type LabPanelDoctorComment = {
  comment: string;
  doctorId: string;
  updatedAt: string;
};

const PANEL_DOCTOR_COMMENT_RE = /^Labo panel avis médecin \(([^)]+)\) : (\{.*\})$/;

function stripPanelDoctorCommentLines(notes: string, slug: LabPanelSlug) {
  const label = LAB_PANEL_LABELS[slug];
  const prefix = `Labo panel avis médecin (${label}) : `;
  return notes
    .split("\n")
    .filter((line) => !line.trim().startsWith(prefix))
    .join("\n")
    .trim();
}

export function parseLabPanelDoctorComments(
  notes?: string | null,
): Partial<Record<LabPanelSlug, LabPanelDoctorComment>> {
  const result: Partial<Record<LabPanelSlug, LabPanelDoctorComment>> = {};
  if (!notes) return result;

  for (const line of notes.split("\n")) {
    const match = line.trim().match(PANEL_DOCTOR_COMMENT_RE);
    if (!match) continue;
    const label = match[1];
    const slug = Object.entries(LAB_PANEL_LABELS).find(([, l]) => l === label)?.[0] as
      | LabPanelSlug
      | undefined;
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
  slug: LabPanelSlug,
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
  const line = `Labo panel avis médecin (${LAB_PANEL_LABELS[slug]}) : ${JSON.stringify(payload)}`;
  return cleaned ? `${cleaned}\n${line}` : line;
}

export function countLabPanelDoctorComments(notes?: string | null) {
  return Object.keys(parseLabPanelDoctorComments(notes)).length;
}
