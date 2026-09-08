import { buildExternalPatientThermalReceiptHtml, buildLabExamThermalReceiptHtml, openPrintDocument } from '@/lib/print-document'
import { fullName } from '@/lib/roles'
import { normalizePatientAgeUnit } from '@/lib/patient-age'
import type { ExamKindSlug } from '@/lib/exam-catalog/types'
import {
  buildExamSheetsFromBlocks,
  emptyExamReductionsByKind,
  emptyExamsByKindBlocks,
  examsByKindFromLines,
  type ExamReductionsByKind,
} from '@/lib/exam-billing'
import {
  normalizeLabExamPendingItem,
  activeExamKindsFromBlocks,
  resolveSingleExamInvoiceDocTitle,
  type LabExamLine,
  type LabExamPendingItem,
} from '@/lib/lab-exam-pending'
import { parsePrescribedExamsByKind, parsePrescribedExamCommentsByKind } from '@/lib/lab-notes'
import { INVOICE_EXAM_COMMENT_KINDS } from '@/lib/exam-catalog/types'
import { getLabExamPriceFcfa } from '@/lib/lab-exams'

export { resolveLabExamInvoiceDocTitle, EXAM_INVOICE_DOC_TITLES } from '@/lib/lab-exam-pending'

export type LabQueuePrintVisit = {
  id: string
  updatedAt: string
  patient: LabExamPendingItem['visit']['patient'] & {
    category?: string | null
    ongName?: string | null
  }
  assignedDoctor?: { firstName: string; lastName: string } | null
  invoices?: Array<{
    invoiceNumber: string
    amountFcfa: number
    createdAt: string
  }>
  consultation?: {
    id?: string
    clinicalNotes?: string | null
    labSentToLabAt?: string | null
    labExamReductionFcfa?: number
    doctor?: { firstName: string; lastName: string } | null
  } | null
}

function examLinesFromClinicalNotes(notes?: string | null): LabExamLine[] {
  if (!notes) return []
  const byKind = parsePrescribedExamsByKind(notes)
  return byKind.examen.map((label) => ({
    label,
    unitPriceFcfa: getLabExamPriceFcfa(label),
    kind: 'examen' as const,
  }))
}

function buildPrintMetaFromVisit(visit: LabQueuePrintVisit) {
  const examsByKind = normalizeLabExamPendingItem({
    id: visit.consultation?.id ?? visit.id,
    updatedAt: visit.consultation?.labSentToLabAt ?? visit.updatedAt,
    examLines: examLinesFromClinicalNotes(visit.consultation?.clinicalNotes),
    examsByKind: emptyExamsByKindBlocks(),
    grossFcfa: 0,
    visit: { patient: visit.patient },
    doctor: visit.consultation?.doctor ?? visit.assignedDoctor ?? null,
  }).examsByKind

  const sheets = buildExamSheetsFromBlocks(examsByKind, emptyExamReductionsByKind(), {
    billableOnly: true,
  })
  const labInvoices = [...(visit.invoices ?? [])].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  )

  const reductionsByKind = emptyExamReductionsByKind()
  const invoicesByKind: LabExamPendingItem['invoicesByKind'] = {}

  sheets.forEach((sheet, index) => {
    const invoice = labInvoices[index]
    const reductionFcfa = invoice
      ? Math.max(0, sheet.grossFcfa - invoice.amountFcfa)
      : 0
    reductionsByKind[sheet.kind] = reductionFcfa
    if (invoice) {
      invoicesByKind[sheet.kind] = {
        invoiceNumber: invoice.invoiceNumber,
        grossFcfa: sheet.grossFcfa,
        reductionFcfa,
        netFcfa: invoice.amountFcfa,
      }
    }
  })

  if (!labInvoices.length) {
    let remaining = visit.consultation?.labExamReductionFcfa ?? 0
    for (const sheet of sheets) {
      if (remaining <= 0) break
      const share = Math.min(sheet.grossFcfa, remaining)
      reductionsByKind[sheet.kind] = share
      remaining -= share
    }
  }

  return { reductionsByKind, invoicesByKind, hasPaidInvoices: labInvoices.length > 0 }
}

export function buildLabPrintItemFromVisit(visit: LabQueuePrintVisit): LabExamPendingItem | null {
  const examLines = examLinesFromClinicalNotes(visit.consultation?.clinicalNotes)
  if (!examLines.length) return null

  const { reductionsByKind, invoicesByKind } = buildPrintMetaFromVisit(visit)

  return normalizeLabExamPendingItem({
    id: visit.consultation?.id ?? visit.id,
    updatedAt: visit.consultation?.labSentToLabAt ?? visit.updatedAt,
    examLines,
    examsByKind: examsByKindFromLines(examLines),
    grossFcfa: 0,
    paidAt: visit.consultation?.labSentToLabAt ?? null,
    labExamReductionFcfa: visit.consultation?.labExamReductionFcfa ?? 0,
    invoicesByKind,
    reductionsByKind,
    visit: { patient: visit.patient },
    doctor: visit.consultation?.doctor ?? visit.assignedDoctor ?? null,
  })
}

export function printLabQueueVisit(visit: LabQueuePrintVisit) {
  const item = buildLabPrintItemFromVisit(visit)
  if (!item) return

  const { reductionsByKind, invoicesByKind, hasPaidInvoices } = buildPrintMetaFromVisit(visit)
  printAllPendingLabExamInvoices(
    item,
    reductionsByKind,
    hasPaidInvoices ? 'Payé' : 'Transféré',
    invoicesByKind,
  )
}

export function printExternalPatientReceipt(
  item: LabExamPendingItem,
  options?: {
    status?: string
    invoiceNumber?: string | null
    grossFcfa?: number
    reductionFcfa?: number
    totalFcfa?: number
  },
) {
  const normalized = normalizeLabExamPendingItem(item)
  if (!normalized.examLines.length) return false
  const grossFcfa = options?.grossFcfa ?? normalized.grossFcfa
  const reductionFcfa = Math.max(
    0,
    options?.reductionFcfa ?? normalized.labExamReductionFcfa ?? 0,
  )
  const totalFcfa =
    options?.totalFcfa ?? Math.max(0, grossFcfa - reductionFcfa)
  openPrintDocument(
    `Reçu examens — ${normalized.visit.patient.code}`,
    buildExternalPatientThermalReceiptHtml({
      ...buildPatientContext(normalized),
      examLines: normalized.examLines.map((line) => ({
        label: line.label,
        amountFcfa: line.unitPriceFcfa,
        kind: line.kind,
      })),
      grossFcfa,
      reductionFcfa,
      totalFcfa,
      status: options?.status,
      invoiceNumber: options?.invoiceNumber?.trim() || undefined,
    }),
    { pageSize: '80mm' },
  )
  return true
}

export type ExamKindInvoiceMeta = {
  invoiceNumber?: string
  grossFcfa?: number
  reductionFcfa?: number
  netFcfa?: number
  paidFcfa?: number
  remainingFcfa?: number
  isFullyPaid?: boolean
}

function buildPatientContext(item: LabExamPendingItem) {
  const patient = item.visit.patient
  return {
    patientCode: patient.code,
    patientName: fullName(patient.firstName, patient.lastName),
    prescribedBy: item.doctor
      ? `Dr ${fullName(item.doctor.firstName, item.doctor.lastName)}`
      : 'Patient externe — enregistré à la réception',
    date: item.paidAt ?? item.updatedAt,
    phone: patient.phone ?? undefined,
    age: patient.age ?? undefined,
    ageUnit: normalizePatientAgeUnit(patient.ageUnit),
    gender: patient.gender ?? undefined,
    processedBy: item.cashierName ?? undefined,
  }
}

function resolveReceiptPaymentMeta(meta?: ExamKindInvoiceMeta) {
  const paidFcfa = meta?.paidFcfa
  const remainingFcfa = meta?.remainingFcfa
  const isPartial =
    meta?.isFullyPaid === false ||
    (remainingFcfa != null && remainingFcfa > 0) ||
    (paidFcfa != null && meta?.netFcfa != null && paidFcfa < meta.netFcfa)
  return {
    paidFcfa,
    remainingFcfa,
    status: isPartial ? 'Payé partiellement' : 'Payé',
  }
}

function buildKindInvoiceSection(
  item: LabExamPendingItem,
  kind: ExamKindSlug,
  reductionFcfa = 0,
  status = 'En attente',
  invoiceMeta?: ExamKindInvoiceMeta | string,
): string | null {
  const normalized = normalizeLabExamPendingItem(item)
  const block = normalized.examsByKind[kind]
  if (!block?.lines.length) return null

  const meta = typeof invoiceMeta === 'string' ? { invoiceNumber: invoiceMeta } : invoiceMeta
  const grossFcfa = meta?.grossFcfa ?? block.grossFcfa
  const reduction = Math.min(
    Math.max(0, Number(meta?.reductionFcfa ?? reductionFcfa) || 0),
    grossFcfa,
  )
  const totalFcfa = Math.max(0, meta?.netFcfa ?? grossFcfa - reduction)
  const kindComment =
    INVOICE_EXAM_COMMENT_KINDS.includes(kind) && normalized.clinicalNotes
      ? parsePrescribedExamCommentsByKind(normalized.clinicalNotes)[kind]?.trim() ?? ''
      : ''

  return buildLabExamThermalReceiptHtml({
    ...buildPatientContext(normalized),
    docTitle: resolveSingleExamInvoiceDocTitle(kind),
    examLines: block.lines.map((line) => ({
      label: line.label,
      amountFcfa: line.unitPriceFcfa,
      kind,
    })),
    grossFcfa,
    reductionFcfa: reduction,
    totalFcfa,
    paidFcfa: meta?.paidFcfa,
    remainingFcfa: meta?.remainingFcfa,
    status,
    invoiceNumber: meta?.invoiceNumber,
    kindComment: kindComment || undefined,
  })
}

export function printPendingLabExamInvoices(item: LabExamPendingItem) {
  const normalized = normalizeLabExamPendingItem(item)
  const kinds =
    normalized.unpaidKinds?.length
      ? normalized.unpaidKinds
      : activeExamKindsFromBlocks(normalized.examsByKind)
  if (!kinds.length) return

  printAllPendingLabExamInvoices(
    normalized,
    normalized.reductionsByKind ?? emptyExamReductionsByKind(),
    'En attente',
    normalized.invoicesByKind,
    kinds,
  )
}

export function printLabExamKindInvoice(
  item: LabExamPendingItem,
  kind: ExamKindSlug,
  reductionFcfa = 0,
  status = 'En attente',
  invoiceMeta?: ExamKindInvoiceMeta | string,
) {
  const section = buildKindInvoiceSection(item, kind, reductionFcfa, status, invoiceMeta)
  if (!section) return

  openPrintDocument(
    resolveSingleExamInvoiceDocTitle(kind),
    section,
    { pageSize: '80mm' },
  )
}

export function printAllPendingLabExamInvoices(
  item: LabExamPendingItem,
  reductions: ExamReductionsByKind = emptyExamReductionsByKind(),
  status = 'En attente',
  invoicesByKind?: Partial<Record<ExamKindSlug, ExamKindInvoiceMeta>>,
  kinds?: ExamKindSlug[],
) {
  const normalized = normalizeLabExamPendingItem(item)
  let sheets = buildExamSheetsFromBlocks(normalized.examsByKind, reductions)
  if (kinds?.length) {
    const allowed = new Set(kinds)
    sheets = sheets.filter((sheet) => allowed.has(sheet.kind))
  }
  // Cause racine bug impression : sheets vide si examsByKind ne contient que des impayés filtrés.
  if (!sheets.length) return false

  const sections = sheets
    .map((sheet) => {
      const meta = invoicesByKind?.[sheet.kind]
      const html = buildKindInvoiceSection(
        normalized,
        sheet.kind,
        sheet.reductionFcfa,
        status,
        meta,
      )
      return html ? `<div class="print-invoice-page">${html}</div>` : null
    })
    .filter(Boolean)
    .join('')

  if (!sections) return false

  openPrintDocument(
    `Factures examens — ${normalized.visit.patient.code}`,
    sections,
    { pageSize: '80mm' },
  )
  return true
}

export function printLabExamPaymentReceipts(
  item: LabExamPendingItem,
  payload: {
    kinds: ExamKindSlug[]
    reductionsByKind: ExamReductionsByKind
  },
  invoicesByKind?: Partial<Record<ExamKindSlug, ExamKindInvoiceMeta>>,
) {
  const normalized = normalizeLabExamPendingItem(item)
  if (payload.kinds.length > 1) {
    const paidReductions = emptyExamReductionsByKind()
    for (const kind of payload.kinds) {
      paidReductions[kind] = payload.reductionsByKind[kind] ?? 0
    }
    const sections = payload.kinds
      .map((kind) => {
        const meta = invoicesByKind?.[kind]
        const payment = resolveReceiptPaymentMeta(meta)
        return buildKindInvoiceSection(
          normalized,
          kind,
          payload.reductionsByKind[kind] ?? 0,
          payment.status,
          meta,
        )
      })
      .filter(Boolean)
      .map((html) => `<div class="print-invoice-page">${html}</div>`)
      .join('')
    if (!sections) return
    openPrintDocument(
      `Factures examens — ${normalized.visit.patient.code}`,
      sections,
      { pageSize: '80mm' },
    )
    return
  }

  const kind = payload.kinds[0]
  if (!kind) return
  const meta = invoicesByKind?.[kind]
  const payment = resolveReceiptPaymentMeta(meta)
  printLabExamKindInvoice(
    normalized,
    kind,
    payload.reductionsByKind[kind] ?? 0,
    payment.status,
    meta,
  )
}

/** @deprecated */
export function printSingleLabExamInvoice(
  item: LabExamPendingItem,
  line: { label: string; unitPriceFcfa: number; kind?: ExamKindSlug },
  reductionFcfa = 0,
  status = 'En attente',
) {
  printLabExamKindInvoice(item, line.kind ?? 'examen', reductionFcfa, status)
}

/** @deprecated */
export function printPendingLabExamInvoice(item: LabExamPendingItem, _reductionFcfa = 0, status = 'En attente') {
  printAllPendingLabExamInvoices(item, emptyExamReductionsByKind(), status)
}
