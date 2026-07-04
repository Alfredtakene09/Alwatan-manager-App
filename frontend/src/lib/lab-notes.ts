export const EXAMS_PRESCRIBED_PREFIX = 'Examens prescrits'
export const EXAMS_PAID_PREFIX = 'Examens payés'
export const EXAM_COMMENT_PREFIX = 'Commentaire'
export const LAB_RESULTS_PREFIX = 'Résultats laboratoire'
export const HOSPITALISATION_DAYS_PREFIX = 'Durée hospitalisation prévue'

export const EXAM_KIND_SECTION_LABELS = {
  examen: 'Laboratoire',
  radio: 'Radio',
  echo: 'Écho',
  odonto: 'Odonto',
  operation: 'Opération',
  hospitalisation: 'Hospitalisation',
} as const

export type ExamKindSlug = keyof typeof EXAM_KIND_SECTION_LABELS

const EXAM_KIND_ORDER: ExamKindSlug[] = [
  'examen',
  'radio',
  'echo',
  'odonto',
  'operation',
  'hospitalisation',
]

function parseHospitalisationDaysLine(line: string): number | null {
  const trimmed = line.trim()
  const prefix = `${HOSPITALISATION_DAYS_PREFIX} : `
  if (!trimmed.startsWith(prefix)) return null
  const days = Number.parseInt(trimmed.slice(prefix.length).trim(), 10)
  if (!Number.isFinite(days) || days < 1) return null
  return days
}

export function parsePrescribedHospitalisationDays(notes?: string | null): number | null {
  if (!notes) return null
  for (const line of notes.split('\n')) {
    const days = parseHospitalisationDaysLine(line)
    if (days) return days
  }
  return null
}

export function mergeHospitalisationDaysInNotes(notes: string, days: number): string {
  const normalizedDays = Math.max(1, Math.floor(days))
  const line = `${HOSPITALISATION_DAYS_PREFIX} : ${normalizedDays}`
  const kept = notes
    .split('\n')
    .filter((entry) => !parseHospitalisationDaysLine(entry))
    .join('\n')
    .trim()
  return kept ? `${kept}\n${line}` : line
}

function parseExamCommentLine(line: string): { kind: ExamKindSlug; comment: string } | null {
  const trimmed = line.trim()
  for (const kind of EXAM_KIND_ORDER) {
    const prefix = `${EXAM_COMMENT_PREFIX} (${EXAM_KIND_SECTION_LABELS[kind]}) : `
    if (trimmed.startsWith(prefix)) {
      return { kind, comment: trimmed.slice(prefix.length).trim() }
    }
  }
  return null
}

function parseExamLine(line: string): { kind: ExamKindSlug; exams: string[] } | null {
  const trimmed = line.trim()
  for (const kind of EXAM_KIND_ORDER) {
    const prefix = `${EXAMS_PRESCRIBED_PREFIX} (${EXAM_KIND_SECTION_LABELS[kind]}) : `
    if (trimmed.startsWith(prefix)) {
      return {
        kind,
        exams: trimmed
          .slice(prefix.length)
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
      }
    }
  }

  const legacyPrefix = `${EXAMS_PRESCRIBED_PREFIX} : `
  if (trimmed.startsWith(legacyPrefix)) {
    return {
      kind: 'examen',
      exams: trimmed
        .slice(legacyPrefix.length)
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    }
  }

  return null
}

export function parsePrescribedExamsByKind(notes?: string | null): Record<ExamKindSlug, string[]> {
  const result: Record<ExamKindSlug, string[]> = {
    examen: [],
    radio: [],
    echo: [],
    odonto: [],
    operation: [],
    hospitalisation: [],
  }
  if (!notes) return result

  for (const line of notes.split('\n')) {
    const parsed = parseExamLine(line)
    if (!parsed) continue
    result[parsed.kind] = [...result[parsed.kind], ...parsed.exams]
  }

  return result
}

export function parsePrescribedExamCommentsByKind(notes?: string | null): Record<ExamKindSlug, string> {
  const result: Record<ExamKindSlug, string> = {
    examen: '',
    radio: '',
    echo: '',
    odonto: '',
    operation: '',
    hospitalisation: '',
  }
  if (!notes) return result

  for (const line of notes.split('\n')) {
    const parsed = parseExamCommentLine(line)
    if (!parsed?.comment) continue
    result[parsed.kind] = parsed.comment
  }

  return result
}

export function parsePrescribedExamsList(notes?: string | null): string[] {
  const byKind = parsePrescribedExamsByKind(notes)
  return EXAM_KIND_ORDER.flatMap((kind) => byKind[kind])
}

export function parsePrescribedExams(notes?: string | null): string {
  const list = parsePrescribedExamsList(notes)
  if (!list.length) return '—'
  return list.join(', ')
}

export function formatPrescribedExamsSummary(notes?: string | null): string {
  const byKind = parsePrescribedExamsByKind(notes)
  const parts = EXAM_KIND_ORDER.flatMap((kind) => {
    const exams = byKind[kind]
    if (!exams.length) return []
    return [`${EXAM_KIND_SECTION_LABELS[kind]}: ${exams.join(', ')}`]
  })
  if (!parts.length) return '—'
  return parts.join(' · ')
}

/** Aperçu court pour tableaux : quelques examens max puis « … ». */
export function formatPrescribedExamsPreview(notes?: string | null, maxVisible = 2): string {
  const exams = parsePrescribedExamsList(notes)
  if (!exams.length) return '—'
  if (exams.length <= maxVisible) return exams.join(', ')
  return `${exams.slice(0, maxVisible).join(', ')}…`
}

export function countPrescribedExams(notes?: string | null): number {
  return parsePrescribedExamsList(notes).length
}

/** Résumé des examens laboratoire uniquement (sans radio, écho, odonto…). */
export function formatLabPrescribedExamsSummary(notes?: string | null): string {
  const exams = parsePrescribedExamsByKind(notes).examen
  if (!exams.length) return '—'
  return exams.join(', ')
}

/** Aperçu court pour tableaux : 2 examens max puis « … ». */
export function formatLabPrescribedExamsPreview(notes?: string | null, maxVisible = 2): string {
  const exams = parsePrescribedExamsByKind(notes).examen
  if (!exams.length) return '—'
  if (exams.length <= maxVisible) return exams.join(', ')
  return `${exams.slice(0, maxVisible).join(', ')}…`
}

export function countLabPrescribedExams(notes?: string | null): number {
  return parsePrescribedExamsByKind(notes).examen.length
}

export function hasLabResults(notes?: string | null): boolean {
  return !!notes?.includes(LAB_RESULTS_PREFIX)
}

export function parseLabResultsCompletedAt(notes?: string | null): Date | null {
  if (!notes) return null
  const marker = `${LAB_RESULTS_PREFIX} — validé le `
  let latest: Date | null = null
  for (const line of notes.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.includes(marker)) continue
    const parsed = new Date(trimmed.slice(trimmed.indexOf(marker) + marker.length).trim())
    if (Number.isNaN(parsed.getTime())) continue
    if (!latest || parsed > latest) latest = parsed
  }
  return latest
}

const PANEL_RECEIVED_RE = /^Labo panel reçu \(([^)]+)\) : (.+)$/

const LAB_PANEL_LABELS: Record<string, string> = {
  coagulation: 'Coagulation Test',
  diabetic: 'Diabetic Test',
  fertility: 'Fertility Hormones',
  lipid: 'Lipid Profile',
  liver: 'Liver Function',
  renal: 'Renal function',
  routine: 'Routine Investigation',
  screening: 'Screening Test',
  semen: 'Semen Analysis',
  thyroid: 'Thyroids Hormones Test',
  torch: 'TORCH IgG Combo Rapid Test',
}

export function parseLabPanelReceivedAt(
  notes?: string | null,
): Partial<Record<string, Date>> {
  const result: Partial<Record<string, Date>> = {}
  if (!notes) return result

  for (const line of notes.split('\n')) {
    const match = line.trim().match(PANEL_RECEIVED_RE)
    if (!match) continue
    const label = match[1]
    const slug = Object.entries(LAB_PANEL_LABELS).find(([, l]) => l === label)?.[0]
    if (!slug) continue
    const parsed = new Date(match[2].trim())
    if (Number.isNaN(parsed.getTime())) continue
    result[slug] = parsed
  }

  return result
}

export function parseLatestLabResultAt(notes?: string | null): Date | null {
  let latest = parseLabResultsCompletedAt(notes)
  for (const line of (notes ?? '').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('Labo panel reçu (')) continue
    const colon = trimmed.lastIndexOf(' : ')
    if (colon < 0) continue
    const parsed = new Date(trimmed.slice(colon + 3).trim())
    if (Number.isNaN(parsed.getTime())) continue
    if (!latest || parsed > latest) latest = parsed
  }
  return latest
}

export function mergeExamsByKind(
  existing: Record<ExamKindSlug, string[]>,
  additional: Partial<Record<ExamKindSlug, string[]>>,
): Record<ExamKindSlug, string[]> {
  const result = { ...existing }
  for (const kind of EXAM_KIND_ORDER) {
    const added = additional[kind]?.filter(Boolean) ?? []
    if (!added.length) continue
    result[kind] = [...new Set([...(result[kind] ?? []), ...added])]
  }
  return result
}

export function countNewExamsInAppend(
  existingNotes: string | null | undefined,
  additional: Partial<Record<ExamKindSlug, string[]>>,
) {
  const existing = parsePrescribedExamsByKind(existingNotes)
  let count = 0
  for (const kind of EXAM_KIND_ORDER) {
    const known = new Set(existing[kind] ?? [])
    for (const exam of additional[kind] ?? []) {
      if (exam && !known.has(exam)) count += 1
    }
  }
  return count
}

function parsePaidKindLine(line: string): { kind: ExamKindSlug; paidAt: Date } | null {
  const trimmed = line.trim()
  for (const kind of EXAM_KIND_ORDER) {
    const prefix = `${EXAMS_PAID_PREFIX} (${EXAM_KIND_SECTION_LABELS[kind]}) : `
    if (!trimmed.startsWith(prefix)) continue
    const parsed = new Date(trimmed.slice(prefix.length).trim())
    if (Number.isNaN(parsed.getTime())) return null
    return { kind, paidAt: parsed }
  }
  return null
}

export function parsePaidExamKindsByKind(notes?: string | null): Partial<Record<ExamKindSlug, Date>> {
  const result: Partial<Record<ExamKindSlug, Date>> = {}
  if (!notes) return result
  for (const line of notes.split('\n')) {
    const parsed = parsePaidKindLine(line)
    if (parsed) result[parsed.kind] = parsed.paidAt
  }
  return result
}

export function isExamKindPaid(notes: string | null | undefined, kind: ExamKindSlug): boolean {
  return !!parsePaidExamKindsByKind(notes)[kind]
}

export function getUnpaidPrescribedExamKinds(notes?: string | null): ExamKindSlug[] {
  const prescribed = parsePrescribedExamsByKind(notes)
  const paid = parsePaidExamKindsByKind(notes)
  return EXAM_KIND_ORDER.filter((kind) => (prescribed[kind]?.length ?? 0) > 0 && !paid[kind])
}

export { EXAM_KIND_ORDER }
