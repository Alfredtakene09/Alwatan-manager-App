export const HOSPITALISATION_PRESCRIPTION_LABEL = 'Hospitalisation'



export type ExamKindSlug =

  | 'specialty'

  | 'examen'

  | 'radio'

  | 'echo'

  | 'odonto'

  | 'operation'

  | 'hospitalisation'



export type CatalogExam = {

  id: string

  code: string

  label: string

  category: string

  priceFcfa: number

  clinicServiceId?: string | null

  clinicServiceName?: string | null

}



export type ExamsByKind = Record<ExamKindSlug, string[]>



export type ExamCommentsByKind = Record<ExamKindSlug, string>



export type GroupedExamCatalog = Record<ExamKindSlug, CatalogExam[]>



export const EXAM_KIND_LABELS: Record<ExamKindSlug, string> = {

  specialty: 'Spécialité',

  examen: 'Laboratoire',

  radio: 'Radio',

  echo: 'Écho',

  odonto: 'Odonto',

  operation: 'Opération',

  hospitalisation: 'Hospitalisation',

}



export const EXAM_KIND_ORDER: ExamKindSlug[] = [

  'specialty',

  'examen',

  'radio',

  'echo',

  'odonto',

  'operation',

  'hospitalisation',

]



/** Types facturables via l'encaissement examens (réception / comptabilité). */
export const LAB_BILLABLE_EXAM_KINDS: ExamKindSlug[] = [
  'specialty',
  'examen',
  'radio',
  'echo',
  'odonto',
]

/** Types encaissables à la réception (inclut les opérations). */
export const CASHIER_PAYMENT_QUEUE_KINDS: ExamKindSlug[] = [
  ...LAB_BILLABLE_EXAM_KINDS,
  'operation',
]

/** Prescription directe patient externe (services + opération). */
export const EXTERNAL_PATIENT_EXAM_KINDS: ExamKindSlug[] = [...CASHIER_PAYMENT_QUEUE_KINDS]

export type SpecialtyServiceTab = {
  id: string
  name: string
}



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

    specialty: [],

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

    specialty: '',

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


