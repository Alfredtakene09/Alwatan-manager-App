import { EXAM_KIND_ORDER, LAB_BILLABLE_EXAM_KINDS, type ExamKindSlug } from '@/lib/exam-catalog/types'
import type { LabExamLine } from '@/lib/lab-exam-pending'

export type ExamKindBlock = {
  lines: LabExamLine[]
  grossFcfa: number
}

export type ExamsByKindBlocks = Record<ExamKindSlug, ExamKindBlock>

export type ExamReductionsByKind = Record<ExamKindSlug, number>

export type ExamKindPaymentSheet = {
  kind: ExamKindSlug
  lines: LabExamLine[]
  grossFcfa: number
  reductionFcfa: number
  netFcfa: number
}

/** Types exclus de la modale d'encaissement (gérés ailleurs dans l'UI). */
export const PAYMENT_MODAL_EXCLUDED_KINDS: ExamKindSlug[] = ['hospitalisation']

export function isPaymentModalExcludedKind(kind: ExamKindSlug): boolean {
  return PAYMENT_MODAL_EXCLUDED_KINDS.includes(kind)
}

export function remainingPayableExamKinds(kinds: ExamKindSlug[]): ExamKindSlug[] {
  return kinds.filter((kind) => !isPaymentModalExcludedKind(kind))
}

export function emptyExamReductionsByKind(): ExamReductionsByKind {
  return {
    examen: 0,
    radio: 0,
    echo: 0,
    odonto: 0,
    operation: 0,
    hospitalisation: 0,
  }
}

export { LAB_BILLABLE_EXAM_KINDS }

export function buildExamSheetsFromBlocks(
  examsByKind: ExamsByKindBlocks,
  reductions: ExamReductionsByKind,
  options?: { billableOnly?: boolean },
): ExamKindPaymentSheet[] {
  const kinds = options?.billableOnly ? LAB_BILLABLE_EXAM_KINDS : EXAM_KIND_ORDER
  return kinds.flatMap((kind) => {
    const block = examsByKind[kind]
    if (!block?.lines.length) return []
    const grossFcfa = block.grossFcfa
    const reductionFcfa = Math.min(Math.max(0, Number(reductions[kind]) || 0), grossFcfa)
    return [
      {
        kind,
        lines: block.lines,
        grossFcfa,
        reductionFcfa,
        netFcfa: Math.max(0, grossFcfa - reductionFcfa),
      },
    ]
  })
}

/** Toutes les sections (y compris types sans examen) — pour la modale d'encaissement. */
export function buildAllExamKindCards(
  examsByKind: ExamsByKindBlocks,
  reductions: ExamReductionsByKind,
): ExamKindPaymentSheet[] {
  return EXAM_KIND_ORDER.map((kind) => {
    const block = examsByKind[kind] ?? { lines: [], grossFcfa: 0 }
    const grossFcfa = block.grossFcfa
    const reductionFcfa = Math.min(Math.max(0, Number(reductions[kind]) || 0), grossFcfa)
    return {
      kind,
      lines: block.lines,
      grossFcfa,
      reductionFcfa,
      netFcfa: Math.max(0, grossFcfa - reductionFcfa),
    }
  })
}

export function countPrescribedExams(examsByKind: ExamsByKindBlocks): number {
  return EXAM_KIND_ORDER.reduce((sum, kind) => sum + (examsByKind[kind]?.lines.length ?? 0), 0)
}

export function countActiveExamKinds(examsByKind: ExamsByKindBlocks): number {
  return EXAM_KIND_ORDER.filter((kind) => (examsByKind[kind]?.lines.length ?? 0) > 0).length
}

export function sumActiveExamReductions(
  examsByKind: ExamsByKindBlocks,
  reductions: ExamReductionsByKind,
): number {
  return buildExamSheetsFromBlocks(examsByKind, reductions).reduce(
    (sum, sheet) => sum + sheet.reductionFcfa,
    0,
  )
}

export function computeExamGrossFromBlocks(examsByKind: ExamsByKindBlocks): number {
  return EXAM_KIND_ORDER.reduce((sum, kind) => sum + (examsByKind[kind]?.grossFcfa ?? 0), 0)
}

export function computeExamNetFromBlocks(
  examsByKind: ExamsByKindBlocks,
  reductions: ExamReductionsByKind,
): number {
  return buildExamSheetsFromBlocks(examsByKind, reductions).reduce((sum, sheet) => sum + sheet.netFcfa, 0)
}

export function examsByKindFromLines(examLines: LabExamLine[]): ExamsByKindBlocks {
  const blocks = {} as ExamsByKindBlocks
  for (const kind of EXAM_KIND_ORDER) {
    blocks[kind] = { lines: [], grossFcfa: 0 }
  }
  for (const line of examLines) {
    const kind = line.kind ?? 'examen'
    blocks[kind].lines.push(line)
    blocks[kind].grossFcfa += line.unitPriceFcfa
  }
  return blocks
}
