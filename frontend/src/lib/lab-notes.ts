import {
  splitPrescribedExamList,
  formatGroupedPrescribedSummary,
  countGroupedPrescribedPanels,
  summarizePrescribedExamFieldNames,
} from '@/lib/lab-prescribed-panels'
import { translateUi } from '@/i18n/translate'

export const EXAMS_PRESCRIBED_PREFIX = 'Examens prescrits'
export const EXAMS_PAID_PREFIX = 'Examens payés'
export const EXAM_COMMENT_PREFIX = 'Commentaire'
export const LAB_RESULTS_PREFIX = 'Résultats laboratoire'
export const LAB_RESULTS_COMPLETION_MARKER = `${LAB_RESULTS_PREFIX} — validé le `
export const HOSPITALISATION_DAYS_PREFIX = 'Durée hospitalisation prévue'

export const EXAM_KIND_SECTION_LABELS = {
  specialty: 'Spécialité',
  examen: 'Laboratoire',
  radio: 'Radio',
  echo: 'Écho',
  odonto: 'Odonto',
  operation: 'Opération',
  hospitalisation: 'Hospitalisation',
} as const

export type ExamKindSlug = keyof typeof EXAM_KIND_SECTION_LABELS

const EXAM_KIND_ORDER: ExamKindSlug[] = [
  'specialty',
  'examen',
  'radio',
  'echo',
  'odonto',
  'operation',
  'hospitalisation',
]

const LAB_QUEUE_EXAM_KINDS: ExamKindSlug[] = ['examen', 'radio', 'echo', 'odonto']

/** Acte clinique de nomenclature (ex. Ophtalmologie) — pas d'envoi labo. */
export const CLINICAL_CONSULTATION_EXAM_LABEL = 'Consultation'

export const PHARMACY_ORDONNANCE_PREFIX = 'Ordonnance pharmacie'

export type PharmacyOrdonnanceLine = {
  /** Absent / vide = médicament saisi librement (hors catalogue pharmacie). */
  productId?: string | null
  name: string
  dosage?: string | null
  quantity: number
  instructions?: string
}

export function isPharmacyCatalogLine(line: PharmacyOrdonnanceLine): boolean {
  return Boolean(line.productId?.trim())
}

export function isClinicalConsultationExamLabel(label: string | null | undefined): boolean {
  return String(label ?? '').trim().toLowerCase() === CLINICAL_CONSULTATION_EXAM_LABEL.toLowerCase()
}

export function hasClinicalConsultationSelected(
  examsByKind?: Partial<Record<ExamKindSlug, string[]>> | null,
): boolean {
  if (!examsByKind) return false
  return Object.values(examsByKind).some((labels) =>
    (labels ?? []).some((label) => isClinicalConsultationExamLabel(label)),
  )
}

/** Labels facturables à la file examens (hors acte « Consultation », déjà payé à la réception). */
export function filterCashierBillableExamLabels(labels: string[] | null | undefined): string[] {
  return (labels ?? []).filter((label) => !isClinicalConsultationExamLabel(label))
}

export function kindHasCashierBillableExams(labels: string[] | null | undefined): boolean {
  return filterCashierBillableExamLabels(labels).length > 0
}

export function prescriptionRequiresLabWork(
  examsByKind?: Partial<Record<ExamKindSlug, string[]>> | null,
): boolean {
  if (!examsByKind) return false
  for (const kind of LAB_QUEUE_EXAM_KINDS) {
    if (kindHasCashierBillableExams(examsByKind[kind])) return true
  }
  return false
}

export function isDirectClinicalConsultationPrescription(
  examsByKind?: Partial<Record<ExamKindSlug, string[]>> | null,
): boolean {
  if (!examsByKind) return false
  if (!hasClinicalConsultationSelected(examsByKind)) return false
  if (prescriptionRequiresLabWork(examsByKind)) return false
  for (const kind of ['specialty', 'examen', 'radio', 'echo', 'odonto', 'operation'] as ExamKindSlug[]) {
    if (kindHasCashierBillableExams(examsByKind[kind])) return false
  }
  if ((examsByKind.hospitalisation?.length ?? 0) > 0) return false
  if ((examsByKind.operation?.length ?? 0) > 0) return false
  return true
}

function parsePharmacyOrdonnanceLine(line: string): PharmacyOrdonnanceLine[] | null {
  const trimmed = line.trim()
  const prefix = `${PHARMACY_ORDONNANCE_PREFIX} : `
  if (!trimmed.startsWith(prefix)) return null
  const raw = trimmed.slice(prefix.length).trim()
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return null
    const lines: PharmacyOrdonnanceLine[] = []
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue
      const row = item as Record<string, unknown>
      const productId = String(row.productId ?? '').trim()
      const name = String(row.name ?? '').trim()
      const quantity = Number(row.quantity)
      if (!name || !Number.isFinite(quantity) || quantity < 1) continue
      lines.push({
        productId: productId || null,
        name,
        dosage: typeof row.dosage === 'string' ? row.dosage : null,
        quantity: Math.floor(quantity),
        instructions: typeof row.instructions === 'string' ? row.instructions.trim() : undefined,
      })
    }
    return lines
  } catch {
    return null
  }
}

export function parsePharmacyOrdonnanceLines(notes?: string | null): PharmacyOrdonnanceLine[] {
  if (!notes) return []
  for (const line of notes.split('\n')) {
    const parsed = parsePharmacyOrdonnanceLine(line)
    if (parsed) return parsed
  }
  return []
}

export function mergePharmacyOrdonnanceInNotes(
  notes: string | null | undefined,
  lines: PharmacyOrdonnanceLine[],
): string {
  const kept = (notes ?? '')
    .split('\n')
    .filter((line) => !parsePharmacyOrdonnanceLine(line))
    .join('\n')
    .trim()
  if (!lines.length) return kept
  const payload = lines.map((line) => ({
    ...(line.productId?.trim() ? { productId: line.productId.trim() } : { productId: null }),
    name: line.name,
    dosage: line.dosage ?? null,
    quantity: line.quantity,
    ...(line.instructions?.trim() ? { instructions: line.instructions.trim() } : {}),
  }))
  const ordonnanceLine = `${PHARMACY_ORDONNANCE_PREFIX} : ${JSON.stringify(payload)}`
  return kept ? `${kept}\n${ordonnanceLine}` : ordonnanceLine
}

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
        exams: splitPrescribedExamList(trimmed.slice(prefix.length)),
      }
    }
  }

  const legacyPrefix = `${EXAMS_PRESCRIBED_PREFIX} : `
  if (trimmed.startsWith(legacyPrefix)) {
    return {
      kind: 'examen',
      exams: splitPrescribedExamList(trimmed.slice(legacyPrefix.length)),
    }
  }

  return null
}

export function parsePrescribedExamsByKind(notes?: string | null): Record<ExamKindSlug, string[]> {
  const result: Record<ExamKindSlug, string[]> = {
    specialty: [],
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
    specialty: '',
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
  return formatGroupedPrescribedSummary(parsePrescribedExamsList(notes))
}

export function formatPrescribedExamsSummary(notes?: string | null): string {
  const byKind = parsePrescribedExamsByKind(notes)
  const parts = EXAM_KIND_ORDER.flatMap((kind) => {
    const exams = byKind[kind]
    if (!exams.length) return []
    const details = summarizePrescribedExamFieldNames(exams)
    if (details === '—') return []
    return [`${translateUi(EXAM_KIND_SECTION_LABELS[kind])}: ${details}`]
  })
  if (!parts.length) return '—'
  return parts.join(' · ')
}

/** Aperçu court pour tableaux : noms de champs (max N visibles). */
export function formatPrescribedExamsPreview(notes?: string | null, maxVisible = 2): string {
  const summary = summarizePrescribedExamFieldNames(parsePrescribedExamsList(notes))
  if (summary === '—') return '—'
  const fields = summary.split(', ').filter(Boolean)
  if (fields.length <= maxVisible) return summary
  return `${fields.slice(0, maxVisible).join(', ')}…`
}

export function countPrescribedExams(notes?: string | null): number {
  return countGroupedPrescribedPanels(parsePrescribedExamsList(notes))
}

/** Résumé détaillé laboratoire : noms des champs cochés. */
export function formatLabPrescribedExamsSummary(notes?: string | null): string {
  return summarizePrescribedExamFieldNames(parsePrescribedExamsByKind(notes).examen)
}

/** Aperçu court laboratoire : noms de champs (max N visibles). */
export function formatLabPrescribedExamsPreview(notes?: string | null, maxVisible = 2): string {
  const summary = summarizePrescribedExamFieldNames(parsePrescribedExamsByKind(notes).examen)
  if (summary === '—') return '—'
  const fields = summary.split(', ').filter(Boolean)
  if (fields.length <= maxVisible) return summary
  return `${fields.slice(0, maxVisible).join(', ')}…`
}

export function countLabPrescribedExams(notes?: string | null): number {
  return countGroupedPrescribedPanels(parsePrescribedExamsByKind(notes).examen)
}

export function hasLabResults(notes?: string | null): boolean {
  return !!notes?.includes(LAB_RESULTS_COMPLETION_MARKER)
}

export function parseLabResultsCompletedAt(notes?: string | null): Date | null {
  if (!notes) return null
  const marker = LAB_RESULTS_COMPLETION_MARKER
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
  routine: 'Routine Investigation',
  biochemie: 'Biochimie',
  electrolytes: 'ABG + Electrolytes',
  coagulation: 'Coagulation Test',
  diabetic: 'Diabetic Test',
  fertility: 'Fertility Hormones',
  lipid: 'Lipid Profile',
  liver: 'LFT',
  renal: 'Renal function',
  screening: 'Screening Test',
  semen: 'Semen Analysis',
  thyroid: 'Thyroid Hormones Test',
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
