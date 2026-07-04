import { parsePrescribedExamsByKind } from '@/lib/lab-notes'
import {
  flattenExamsByKind,
  getExamPriceFcfa,
  getCatalogForKind,
  loadExamCatalog,
  LAB_EXAM_CATALOG,
  EXAM_KIND_ORDER,
  type CatalogExam,
  type ExamKindSlug,
  type ExamsByKind,
  groupExamsByCategory,
} from '@/lib/exam-catalog'
import { RADIO_EXAM_CATALOG } from '@/lib/exam-catalog/radio'
import { ECHO_EXAM_CATALOG } from '@/lib/exam-catalog/echo'
import { ODONTO_EXAM_CATALOG } from '@/lib/exam-catalog/odonto'

export type { CatalogExam as LabExam, ExamKindSlug, ExamsByKind }
export {
  LAB_EXAM_CATALOG,
  flattenExamsByKind,
  getCatalogForKind,
  loadExamCatalog,
  groupExamsByCategory,
}

/** @deprecated Utiliser getExamPriceFcfa depuis @/lib/exam-catalog */
export function getLabExamPriceFcfa(label: string): number {
  return getExamPriceFcfa(label)
}

export function buildLabExamLinesFromNotes(notes?: string | null) {
  const byKind = parsePrescribedExamsByKind(notes)
  return EXAM_KIND_ORDER.flatMap((kind) =>
    byKind[kind].map((label) => ({
      kind,
      label,
      unitPriceFcfa: getExamPriceFcfa(label),
    })),
  )
}

export function computeGrossFcfaFromExamsByKind(examsByKind: ExamsByKind): number {
  return flattenExamsByKind(examsByKind).reduce((sum, label) => sum + getExamPriceFcfa(label), 0)
}

// Compatibilité : ancien catalogue plat (tous types confondus)
export const LAB_EXAM_CATALOG_LEGACY: CatalogExam[] = [
  ...LAB_EXAM_CATALOG,
  ...RADIO_EXAM_CATALOG,
  ...ECHO_EXAM_CATALOG,
  ...ODONTO_EXAM_CATALOG,
]
