export const HOSPITALISATION_PRESCRIPTION_LABEL = 'Hospitalisation'

export type ExamKindSlug = 'examen' | 'radio' | 'echo' | 'odonto' | 'operation' | 'hospitalisation'

export type CatalogExam = {
  id: string
  code: string
  label: string
  category: string
  priceFcfa: number
}

export type ExamsByKind = Record<ExamKindSlug, string[]>

export type ExamCommentsByKind = Record<ExamKindSlug, string>

export type GroupedExamCatalog = Record<ExamKindSlug, CatalogExam[]>

export const EXAM_KIND_LABELS: Record<ExamKindSlug, string> = {
  examen: 'Laboratoire',
  radio: 'Radio',
  echo: 'Écho',
  odonto: 'Odonto',
  operation: 'Opération',
  hospitalisation: 'Hospitalisation',
}

export const EXAM_KIND_ORDER: ExamKindSlug[] = [
  'examen',
  'radio',
  'echo',
  'odonto',
  'operation',
  'hospitalisation',
]

/** Types facturables via l'encaissement examens (réception / comptabilité). */
export const LAB_BILLABLE_EXAM_KINDS: ExamKindSlug[] = ['examen', 'radio', 'echo', 'odonto']

/** Commentaires par type affichés sur la facture et saisissables à la prescription. */
export const INVOICE_EXAM_COMMENT_KINDS: ExamKindSlug[] = ['radio', 'echo', 'odonto']

export function filterInvoiceExamComments(comments: ExamCommentsByKind): ExamCommentsByKind {
  const filtered = emptyExamCommentsByKind()
  for (const kind of INVOICE_EXAM_COMMENT_KINDS) {
    filtered[kind] = comments[kind]?.trim() ?? ''
  }
  return filtered
}

export function emptyExamsByKind(): ExamsByKind {
  return {
    examen: [],
    radio: [],
    echo: [],
    odonto: [],
    operation: [],
    hospitalisation: [],
  }
}

export function emptyExamCommentsByKind(): ExamCommentsByKind {
  return {
    examen: '',
    radio: '',
    echo: '',
    odonto: '',
    operation: '',
    hospitalisation: '',
  }
}

export function flattenExamsByKind(examsByKind: ExamsByKind): string[] {
  return EXAM_KIND_ORDER.flatMap((kind) => examsByKind[kind])
}

export function countExamsByKind(examsByKind: ExamsByKind): number {
  return flattenExamsByKind(examsByKind).length
}

export function groupExamsByCategory(exams: CatalogExam[]): Map<string, CatalogExam[]> {
  const map = new Map<string, CatalogExam[]>()
  for (const exam of exams) {
    const list = map.get(exam.category) ?? []
    list.push(exam)
    map.set(exam.category, list)
  }
  return map
}
