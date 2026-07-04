import type { ExamKindSlug } from '@/lib/exam-catalog/types'
import { EXAM_KIND_LABELS, EXAM_KIND_ORDER } from '@/lib/exam-catalog/types'
import { inferExamKindFromLabel } from '@/lib/exam-catalog/infer-kind'
import type { PatientAgeUnit } from '@/lib/patient-age'
import type { ExamReductionsByKind, ExamsByKindBlocks } from '@/lib/exam-billing'
import { examsByKindFromLines } from '@/lib/exam-billing'

export type LabExamLine = {
  label: string
  unitPriceFcfa: number
  kind?: ExamKindSlug
}

export type LabExamPendingItem = {
  id: string
  visitId?: string
  updatedAt: string
  examLines: LabExamLine[]
  examsByKind: ExamsByKindBlocks
  grossFcfa: number
  examsSummary?: string
  paidAt?: string | null
  labExamReductionFcfa?: number
  invoicesByKind?: Partial<
    Record<
      ExamKindSlug,
      { invoiceNumber: string; grossFcfa: number; reductionFcfa: number; netFcfa: number }
    >
  >
  reductionsByKind?: ExamReductionsByKind
  paidKinds?: ExamKindSlug[]
  unpaidKinds?: ExamKindSlug[]
  allExamsByKind?: ExamsByKindBlocks
  cashierName?: string | null
  clinicalNotes?: string | null
  visit: {
    patient: {
      code: string
      firstName: string
      lastName: string
      phone?: string | null
      age?: number | null
      ageUnit?: PatientAgeUnit | null
      gender?: string | null
    }
  }
  doctor: { firstName: string; lastName: string } | null
}

export function normalizeLabExamLines(lines: LabExamLine[]): LabExamLine[] {
  return lines.map((line) => ({
    ...line,
    kind: line.kind ?? inferExamKindFromLabel(line.label),
  }))
}

export function activeExamKindsFromBlocks(examsByKind: ExamsByKindBlocks): ExamKindSlug[] {
  return EXAM_KIND_ORDER.filter((kind) => (examsByKind[kind]?.lines.length ?? 0) > 0)
}

export function activeExamKinds(lines: LabExamLine[]): ExamKindSlug[] {
  return activeExamKindsFromBlocks(examsByKindFromLines(normalizeLabExamLines(lines)))
}

export const EXAM_INVOICE_DOC_TITLES: Record<ExamKindSlug, string> = {
  examen: 'Facture — Examens laboratoire',
  radio: 'Facture — Radiologie',
  echo: 'Facture — Échographie',
  odonto: 'Facture — Odontologie',
  operation: 'Facture — Opération',
  hospitalisation: 'Facture — Hospitalisation',
}

export const EXAM_KIND_REDUCTION_LABELS: Record<ExamKindSlug, string> = {
  examen: 'Réduction Laboratoire (FCFA)',
  radio: 'Réduction Radio (FCFA)',
  echo: 'Réduction Écho (FCFA)',
  odonto: 'Réduction Odonto (FCFA)',
  operation: 'Réduction Opération (FCFA)',
  hospitalisation: 'Réduction Hospitalisation (FCFA)',
}

export function resolveLabExamInvoiceDocTitle(examLines: LabExamLine[]): string {
  const kinds = activeExamKinds(examLines)
  if (kinds.length === 1) return EXAM_INVOICE_DOC_TITLES[kinds[0]]
  return 'Facture — Examens médicaux'
}

export function resolveSingleExamInvoiceDocTitle(kind?: ExamKindSlug): string {
  return EXAM_INVOICE_DOC_TITLES[kind ?? 'examen']
}

export function initLabExamReductionsByKind(): Record<ExamKindSlug, number> {
  return {
    examen: 0,
    radio: 0,
    echo: 0,
    odonto: 0,
    operation: 0,
    hospitalisation: 0,
  }
}

export function formatExamLinesSummary(lines: LabExamLine[]): string {
  const normalized = normalizeLabExamLines(lines)
  const blocks = examsByKindFromLines(normalized)
  const parts = EXAM_KIND_ORDER.flatMap((kind) => {
    const blockLines = blocks[kind]?.lines ?? []
    if (!blockLines.length) return []
    return [`${EXAM_KIND_LABELS[kind]}: ${blockLines.map((line) => line.label).join(', ')}`]
  })
  if (!parts.length) return '—'
  return parts.join(' · ')
}

function truncateExamText(text: string, maxLength: number): string {
  const trimmed = text.trim()
  if (trimmed.length <= maxLength) return trimmed
  return `${trimmed.slice(0, Math.max(1, maxLength - 1)).trim()}…`
}

export function formatExamLinesSummaryShort(
  lines: LabExamLine[],
  options?: { maxLabelChars?: number; maxTotalChars?: number },
): { short: string; full: string; examCount: number } {
  const maxLabelChars = options?.maxLabelChars ?? 16
  const maxTotalChars = options?.maxTotalChars ?? 58
  const full = formatExamLinesSummary(lines)
  const normalized = normalizeLabExamLines(lines)
  const blocks = examsByKindFromLines(normalized)
  const examCount = normalized.length

  const parts = EXAM_KIND_ORDER.flatMap((kind) => {
    const blockLines = blocks[kind]?.lines ?? []
    if (!blockLines.length) return []
    const labels = blockLines.map((line) => truncateExamText(line.label, maxLabelChars))
    return [`${EXAM_KIND_LABELS[kind]}: ${labels.join(', ')}`]
  })

  if (!parts.length) {
    return { short: '—', full, examCount: 0 }
  }

  let short = parts.join(' · ')
  if (short.length > maxTotalChars) {
    short = truncateExamText(short, maxTotalChars)
  }

  return { short, full, examCount }
}

export function normalizeLabExamPendingItem(item: LabExamPendingItem): LabExamPendingItem {
  const examLines = normalizeLabExamLines(item.examLines)
  const examsByKind =
    item.examsByKind && Object.keys(item.examsByKind).length
      ? normalizeExamsByKindBlocks(item.examsByKind)
      : examsByKindFromLines(examLines)
  const grossFcfa = EXAM_KIND_ORDER.reduce((sum, kind) => sum + examsByKind[kind].grossFcfa, 0)
  return {
    ...item,
    examLines,
    examsByKind,
    grossFcfa,
  }
}

function normalizeExamsByKindBlocks(blocks: ExamsByKindBlocks): ExamsByKindBlocks {
  const normalized = {} as ExamsByKindBlocks
  for (const kind of EXAM_KIND_ORDER) {
    const lines = normalizeLabExamLines(blocks[kind]?.lines ?? [])
    normalized[kind] = {
      lines,
      grossFcfa: lines.reduce((sum, line) => sum + line.unitPriceFcfa, 0),
    }
  }
  return normalized
}
