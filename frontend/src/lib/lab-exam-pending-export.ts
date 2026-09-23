import { formatFcfa, fullName } from '@/lib/roles'
import { examLinesSectionOrNameList, type LabExamPendingItem } from '@/lib/lab-exam-pending'
import { translateUi } from '@/i18n/translate'
import type { ExportColumn } from '@/lib/table-export-html'

export type LabExamListExportRow = {
  code: string
  patientName: string
  patientPhone: string
  doctorName: string
  exams: string
  amount: string
  remaining: string
  date: string
  time: string
}

function doctorLabel(item: LabExamPendingItem): string {
  if (!item.doctor) return translateUi('Patient externe — Réception')
  return `Dr ${fullName(item.doctor.firstName, item.doctor.lastName)}`
}

function amountFields(item: LabExamPendingItem, mode: 'pending' | 'paid') {
  const netFcfa = item.grossFcfa - (item.labExamReductionFcfa ?? 0)
  const collectedFromPartials = Object.values(item.partialPaymentsByKind ?? {}).reduce(
    (sum, row) => sum + Math.max(0, row?.paidFcfa ?? 0),
    0,
  )
  const remainingFromPartials = Object.values(item.partialPaymentsByKind ?? {}).reduce(
    (sum, row) => sum + Math.max(0, row?.remainingFcfa ?? 0),
    0,
  )
  const collectedFromInvoices = Object.values(item.invoicesByKind ?? {}).reduce((sum, inv) => {
    if (!inv) return sum
    if (inv.paidFcfa != null) return sum + Math.max(0, inv.paidFcfa)
    return sum + Math.max(0, inv.netFcfa)
  }, 0)
  const remainingFromInvoices = Object.values(item.invoicesByKind ?? {}).reduce(
    (sum, inv) => sum + Math.max(0, inv?.remainingFcfa ?? 0),
    0,
  )
  const collectedFcfa =
    item.collectedFcfa != null
      ? item.collectedFcfa
      : Math.max(collectedFromInvoices, collectedFromPartials)
  const remainingFromPayments =
    item.remainingFcfa != null
      ? item.remainingFcfa
      : Math.max(remainingFromInvoices, remainingFromPartials)

  if (mode === 'paid') {
    return {
      amount: formatFcfa(collectedFcfa > 0 ? collectedFcfa : netFcfa),
      remaining: remainingFromPayments > 0 ? formatFcfa(remainingFromPayments) : '',
    }
  }

  const unpaidKinds = item.unpaidKinds ?? []
  const partials = item.partialPaymentsByKind ?? {}
  let pendingDueFcfa = item.grossFcfa
  if (unpaidKinds.length) {
    pendingDueFcfa = unpaidKinds.reduce((sum, kind) => {
      const partial = partials[kind]
      if (partial) return sum + Math.max(0, partial.remainingFcfa)
      return sum + Math.max(0, item.examsByKind?.[kind]?.grossFcfa ?? 0)
    }, 0)
  } else if (remainingFromPayments > 0) {
    pendingDueFcfa = remainingFromPayments
  }

  return {
    amount: formatFcfa(pendingDueFcfa),
    remaining: collectedFcfa > 0 && pendingDueFcfa > 0 ? formatFcfa(pendingDueFcfa) : '',
  }
}

export function toLabExamListExportRows(
  items: LabExamPendingItem[],
  mode: 'pending' | 'paid',
  dateLocale = 'fr-FR',
): LabExamListExportRow[] {
  return items.map((item) => {
    const prescribedAt = new Date(item.createdAt ?? item.updatedAt)
    const exams = examLinesSectionOrNameList(item.examLines ?? [])
    const amounts = amountFields(item, mode)
    return {
      code: item.visit.patient.code,
      patientName: fullName(item.visit.patient.firstName, item.visit.patient.lastName),
      patientPhone: item.visit.patient.phone || '',
      doctorName: doctorLabel(item),
      exams: exams.length ? exams.join(', ') : '—',
      amount: amounts.amount,
      remaining: amounts.remaining,
      date: prescribedAt.toLocaleDateString(dateLocale),
      time: prescribedAt.toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit' }),
    }
  })
}

export function labExamListExportColumns(
  mode: 'pending' | 'paid',
): ExportColumn<LabExamListExportRow>[] {
  const cols: ExportColumn<LabExamListExportRow>[] = [
    { header: translateUi('Matricule'), value: (r) => r.code },
    { header: translateUi('Patient'), value: (r) => r.patientName },
    { header: translateUi('Téléphone'), value: (r) => r.patientPhone || '—' },
    { header: translateUi('Médecin'), value: (r) => r.doctorName },
    { header: translateUi('Examens'), value: (r) => r.exams },
    {
      header: translateUi(mode === 'paid' ? 'Net payé' : 'Montant'),
      value: (r) => r.amount,
    },
    { header: translateUi('Prescrit le'), value: (r) => r.date },
    { header: translateUi('Heure'), value: (r) => r.time },
  ]
  if (mode === 'paid') {
    cols.push({ header: translateUi('Reste'), value: (r) => r.remaining || '—' })
  }
  return cols
}
