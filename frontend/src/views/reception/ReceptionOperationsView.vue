<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  Scissors,
  RefreshCw,
  CalendarDays,
  CalendarRange,
  Calendar,
  CircleDollarSign,
  CheckCircle2,
  Clock,
  Search,
  Banknote,
  Layers,
  Pencil,
  Printer,
  Trash2,
  X,
  Plus,
} from '@lucide/vue'
import { isAxiosError } from 'axios'
import api from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { useAppI18n } from '@/i18n/useAppI18n'
import { translateTemplate } from '@/lib/dashboard-i18n'
import { confirmAppModal, showApiErrorModal, showDuplicateModalFromError } from '@/lib/api-modal-helper'
import { emptyExamReductionsByKind, examsByKindFromLines } from '@/lib/exam-billing'
import { type LabExamPendingItem } from '@/lib/lab-exam-pending'
import { printLabExamPaymentReceipts, type ExamKindInvoiceMeta } from '@/lib/lab-exam-invoice'
import { cancelPrintWindow, reservePrintWindow } from '@/lib/print-document'
import UiInput from '@/components/ui/UiInput.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import { formatFcfa, fullName } from '@/lib/roles'
import { parsePatientAge, splitPatientFullName } from '@/lib/patient-name'
import type { PatientAgeUnit } from '@/lib/patient-age'
import {
  emptyExamsByKind,
  getExamCatalogSync,
  loadExamCatalog,
  type CatalogExam,
  type ExamsByKind,
} from '@/lib/exam-catalog'
import MultiExamPrescriptionPicker, {
  type OperationAssistantPayload,
} from '@/components/MultiExamPrescriptionPicker.vue'
import ReceptionPatientIdentityFields from '@/components/reception/ReceptionPatientIdentityFields.vue'
import { type SurgeryCaseRow, type SurgeryUserRef } from '@/lib/surgery-case'
import { formatAssistantLabel, surgeryCompletedAtIso } from '@/lib/surgery-shares'
import {
  currentMonthKey,
  formatPeriodLabel,
  matchesDateFilter,
  todayDateKey,
  yesterdayDateKey,
  type DateFilterMode,
} from '@/lib/date-filters'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiFormModal from '@/components/ui/UiFormModal.vue'
import UiStatCard from '@/components/ui/UiStatCard.vue'
import ExportButtons from '@/components/ui/ExportButtons.vue'
import { exportTableExcel, exportTablePdf, exportTableWord, type ExportColumn } from '@/lib/table-export'
import '@/assets/simple-table.css'

type PaymentFilter = 'all' | 'paid' | 'partial' | 'unpaid'
type PaymentState = Exclude<PaymentFilter, 'all'>
type SourceFilter = 'all' | OperationSource
type OperationSource = 'bloc' | 'other'
type PeriodMode = DateFilterMode | 'all'

type OperationPayment = {
  id: string
  amountFcfa: number
  paidAt: string
  recordedByName: string
}

type OtherOperationInvoice = {
  id: string
  invoiceNumber?: string
  status: string
  amountFcfa: number
  paidAmountFcfa: number
  paidAt?: string | null
  createdAt: string
  issuedBy?: SurgeryUserRef | null
  payments?: { id: string; amountFcfa: number; paidAt: string; recordedBy?: SurgeryUserRef | null }[]
  interventionLabel: string
  doctor?: SurgeryUserRef | null
  assistantName?: string | null
  visit: {
    id: string
    createdBy?: SurgeryUserRef | null
    patient: { code: string; firstName: string; lastName: string }
    consultation?: { id: string } | null
  }
}

type OperationRow = {
  id: string
  recordId: string
  source: OperationSource
  visitId: string
  consultationId: string | null
  patientName: string
  patientCode: string
  intervention: string
  interventionTypeId: string
  surgeonId: string
  surgeonName: string
  doctor: { firstName: string; lastName: string } | null
  invoiceNumber: string
  payments: OperationPayment[]
  assistantName: string
  completed: boolean
  timestamp: number
  dateLabel: string
  timeLabel: string
  billedFcfa: number
  paidFcfa: number
  remainingFcfa: number
  paymentState: PaymentState
  registeredById: string
  registeredBy: string
  collectedBy: string
}

type ReceptionistSummary = {
  id: string
  name: string
  count: number
  billedFcfa: number
  paidFcfa: number
  remainingFcfa: number
}

const DATE_MODES: { id: PeriodMode; label: string; icon: typeof CalendarDays }[] = [
  { id: 'all', label: 'Tout', icon: Layers },
  { id: 'day', label: 'Jour', icon: CalendarDays },
  { id: 'month', label: 'Mois', icon: Calendar },
  { id: 'custom', label: 'Personnaliser', icon: CalendarRange },
]

const PAYMENT_FILTERS: { id: PaymentFilter; label: string }[] = [
  { id: 'all', label: 'Tous' },
  { id: 'paid', label: 'Payé' },
  { id: 'partial', label: 'Partiel' },
  { id: 'unpaid', label: 'Non payé' },
]

const SOURCE_FILTERS: { id: SourceFilter; label: string }[] = [
  { id: 'all', label: 'Toutes' },
  { id: 'bloc', label: 'Bloc opératoire' },
  { id: 'other', label: 'Autres chirurgies' },
]

const SOURCE_LABELS: Record<OperationSource, string> = {
  bloc: 'Bloc opératoire',
  other: 'Autre chirurgie',
}

const PAYMENT_LABELS: Record<PaymentState, string> = {
  paid: 'Payé',
  partial: 'Paiement partiel',
  unpaid: 'Pas encore payé',
}

const PAYMENT_VARIANTS: Record<PaymentState, 'success' | 'warning' | 'danger'> = {
  paid: 'success',
  partial: 'warning',
  unpaid: 'danger',
}

const auth = useAuthStore()
const { uiText, clinicServiceText } = useAppI18n()
const canSeeAllReceptionists = computed(() => auth.user?.role !== 'RECEPTIONNISTE')
/** Correction montant / date : administrateur et gestionnaire uniquement. */
const canEditOperations = computed(
  () => auth.user?.role === 'ADMIN' || auth.user?.role === 'GESTIONNAIRE',
)

const surgeries = ref<SurgeryCaseRow[]>([])
const otherOperations = ref<OtherOperationInvoice[]>([])
const loading = ref(false)
const errorMessage = ref('')
const message = ref('')
const messageType = ref<'success' | 'error'>('success')
const actionId = ref<string | null>(null)
const payTarget = ref<{ row: OperationRow; item: LabExamPendingItem } | null>(null)
const payAmount = ref('')
const submittingPayment = ref(false)
const receiptRow = ref<OperationRow | null>(null)
const searchQuery = ref('')
const paymentFilter = ref<PaymentFilter>('all')
const receptionistFilter = ref('')
const doctorFilter = ref('')
const sourceFilter = ref<SourceFilter>('all')

const showRegisterModal = ref(false)
const registeringOperation = ref(false)
const patientForm = ref({
  fullName: '',
  age: '',
  ageUnit: 'YEARS' as PatientAgeUnit,
  phone: '',
  gender: 'F',
})
const registerExams = ref<ExamsByKind>(emptyExamsByKind())
const operationAmountFcfa = ref<number | null>(null)
const operationAssistant = ref<OperationAssistantPayload | null>(null)
const operationServiceId = ref('')
const selectedDoctorId = ref('')

const canRegisterOperation = computed(() => {
  const { firstName, lastName } = splitPatientFullName(patientForm.value.fullName)
  const age = parsePatientAge(patientForm.value.age, patientForm.value.ageUnit)
  const hasOperation = (registerExams.value.operation?.length ?? 0) > 0
  const price = operationAmountFcfa.value ?? 0
  return (
    firstName.length >= 2 &&
    lastName.length >= 2 &&
    age !== null &&
    hasOperation &&
    !!selectedDoctorId.value &&
    price > 0
  )
})

function resetRegisterForm() {
  patientForm.value = { fullName: '', age: '', ageUnit: 'YEARS', phone: '', gender: 'F' }
  registerExams.value = emptyExamsByKind()
  operationAmountFcfa.value = null
  operationAssistant.value = null
  operationServiceId.value = ''
  selectedDoctorId.value = ''
}

function openRegisterModal() {
  resetRegisterForm()
  showRegisterModal.value = true
}

function closeRegisterModal() {
  if (registeringOperation.value) return
  showRegisterModal.value = false
}

async function submitRegisterOperation() {
  if (registeringOperation.value || !canRegisterOperation.value) return
  const { firstName, lastName } = splitPatientFullName(patientForm.value.fullName)
  const age = parsePatientAge(patientForm.value.age, patientForm.value.ageUnit)
  const price = Math.max(0, Math.round(operationAmountFcfa.value ?? 0))
  const operationLabel = registerExams.value.operation?.find(Boolean)
  registeringOperation.value = true
  message.value = ''
  try {
    const { data } = await api.post<{
      visit?: { id: string } | null
      doctor?: { firstName: string; lastName: string } | null
    }>('/visits/external-lab-order', {
      firstName,
      lastName,
      age: age ?? undefined,
      ageUnit: patientForm.value.ageUnit,
      phone: patientForm.value.phone.trim() || undefined,
      gender: patientForm.value.gender,
      service: operationLabel,
      examsByKind: registerExams.value,
      reductionFcfa: 0,
      operationAmountFcfa: price,
      amountFcfa: price,
      doctorId: selectedDoctorId.value,
      deferCollection: true,
      ...(operationAssistant.value ? { operationAssistant: operationAssistant.value } : {}),
      ...(operationServiceId.value ? { operationServiceId: operationServiceId.value } : {}),
    })
    const doctor = data.doctor ?? null
    const visitId = data.visit?.id
    showRegisterModal.value = false
    resetRegisterForm()
    await load()
    const row = visitId ? findOperationRow(visitId) : null
    if (row && row.remainingFcfa > 0 && row.consultationId) {
      message.value = uiText('Patient enregistré. Encaissez l’opération puis imprimez le reçu.')
      messageType.value = 'success'
      await openEncaisser(row, doctor)
      return
    }
    message.value = uiText('Opération enregistrée.')
    messageType.value = 'success'
  } catch (error: unknown) {
    const shown = await showDuplicateModalFromError(error)
    if (shown) return
    const apiMessage =
      error && typeof error === 'object' && 'response' in error
        ? (error as { response?: { data?: { error?: string } } }).response?.data?.error
        : undefined
    message.value = apiMessage ?? uiText("Erreur lors de l'enregistrement.")
    messageType.value = 'error'
  } finally {
    registeringOperation.value = false
  }
}

const editRow = ref<OperationRow | null>(null)
const editAmount = ref('')
const editDate = ref('')
const editInterventionId = ref('')
const openedInterventionId = ref('')
const operationCatalog = ref<CatalogExam[]>([])
const savingEdit = ref(false)

const dateFilterMode = ref<PeriodMode>('all')
const filterDay = ref(todayDateKey())
const filterMonth = ref(currentMonthKey())
const filterFrom = ref('')
const filterTo = ref('')

function userName(user?: SurgeryUserRef | null) {
  return user ? fullName(user.firstName, user.lastName) : ''
}

function mapPayments(
  invoice?: { payments?: { id: string; amountFcfa: number; paidAt: string; recordedBy?: SurgeryUserRef | null }[] } | null,
): OperationPayment[] {
  return (invoice?.payments ?? []).map((payment) => ({
    id: payment.id,
    amountFcfa: payment.amountFcfa,
    paidAt: payment.paidAt,
    recordedByName: userName(payment.recordedBy),
  }))
}

function paymentInfo(
  billedFcfa: number,
  invoice?: Pick<OtherOperationInvoice, 'status' | 'paidAmountFcfa' | 'issuedBy' | 'payments'> | null,
) {
  const paidFcfa = invoice?.paidAmountFcfa ?? 0
  const outstandingFcfa = Math.max(0, billedFcfa - paidFcfa)
  const isPaid = invoice?.status === 'PAID' || (billedFcfa > 0 && outstandingFcfa === 0)
  const paymentState: PaymentState = isPaid ? 'paid' : paidFcfa > 0 ? 'partial' : 'unpaid'
  // Facture soldée : plus rien à encaisser, même si le montant réglé est saisi ailleurs.
  const remainingFcfa = isPaid ? 0 : outstandingFcfa

  const paymentCollectors = (invoice?.payments ?? []).map((p) => userName(p.recordedBy)).filter(Boolean)
  const collectors = [
    ...new Set(paymentCollectors.length ? paymentCollectors : [userName(invoice?.issuedBy)].filter(Boolean)),
  ]
  return { billedFcfa, paidFcfa, remainingFcfa, paymentState, collectedBy: collectors.join(', ') }
}

function otherOperationDateIso(op: OtherOperationInvoice) {
  return op.paidAt ?? op.createdAt
}

function toOtherRow(op: OtherOperationInvoice): OperationRow {
  const date = new Date(otherOperationDateIso(op))
  const doctor = userName(op.doctor)
  return {
    id: `other-${op.id}`,
    recordId: op.id,
    source: 'other',
    visitId: op.visit.id,
    consultationId: op.visit.consultation?.id ?? null,
    patientName: fullName(op.visit.patient.firstName, op.visit.patient.lastName),
    patientCode: op.visit.patient.code,
    intervention: op.interventionLabel,
    interventionTypeId: '',
    surgeonId: op.doctor?.id ?? '',
    surgeonName: doctor ? `Dr ${doctor.replace(/^dr\.?\s+/i, '')}` : '—',
    doctor: op.doctor ? { firstName: op.doctor.firstName, lastName: op.doctor.lastName } : null,
    invoiceNumber: op.invoiceNumber ?? '',
    payments: mapPayments(op),
    assistantName: op.assistantName?.trim() || '—',
    completed: false,
    timestamp: date.getTime(),
    dateLabel: date.toLocaleDateString('fr-FR'),
    timeLabel: date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
    ...paymentInfo(op.amountFcfa, op),
    registeredById: op.visit.createdBy?.id ?? '',
    registeredBy: userName(op.visit.createdBy) || '—',
  }
}

function toRow(surgery: SurgeryCaseRow): OperationRow {
  const date = new Date(surgeryCompletedAtIso(surgery))

  return {
    id: surgery.id,
    recordId: surgery.id,
    source: 'bloc',
    visitId: surgery.visit.id,
    consultationId: surgery.visit.consultation?.id ?? null,
    patientName: fullName(surgery.visit.patient.firstName, surgery.visit.patient.lastName),
    patientCode: surgery.visit.patient.code,
    intervention: surgery.interventionType.label,
    interventionTypeId: surgery.interventionType.id,
    surgeonId: surgery.surgeon.id,
    surgeonName: `Dr ${fullName(surgery.surgeon.firstName, surgery.surgeon.lastName).replace(/^dr\.?\s+/i, '')}`,
    doctor: { firstName: surgery.surgeon.firstName, lastName: surgery.surgeon.lastName },
    invoiceNumber: surgery.invoice?.invoiceNumber ?? '',
    payments: mapPayments(surgery.invoice),
    assistantName: formatAssistantLabel(surgery) || '—',
    completed: surgery.status === 'COMPLETED',
    timestamp: date.getTime(),
    dateLabel: date.toLocaleDateString('fr-FR'),
    timeLabel: date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
    ...paymentInfo(surgery.invoice?.amountFcfa ?? surgery.totalCostFcfa, surgery.invoice),
    registeredById: surgery.visit.createdBy?.id ?? '',
    registeredBy: userName(surgery.visit.createdBy) || '—',
  }
}

function inPeriod(isoDate: string) {
  if (dateFilterMode.value === 'all') return true
  return matchesDateFilter(
    isoDate,
    dateFilterMode.value,
    filterDay.value,
    filterMonth.value,
    filterFrom.value,
    filterTo.value,
  )
}

const periodRows = computed(() => {
  const rows: OperationRow[] = []
  if (sourceFilter.value !== 'other') {
    rows.push(...surgeries.value.filter((s) => inPeriod(surgeryCompletedAtIso(s))).map(toRow))
  }
  if (sourceFilter.value !== 'bloc') {
    rows.push(...otherOperations.value.filter((op) => inPeriod(otherOperationDateIso(op))).map(toOtherRow))
  }
  return rows.sort((a, b) => b.timestamp - a.timestamp)
})

const receptionistSummaries = computed((): ReceptionistSummary[] => {
  const map = new Map<string, ReceptionistSummary>()
  for (const row of periodRows.value) {
    const current = map.get(row.registeredById) ?? {
      id: row.registeredById,
      name: row.registeredBy,
      count: 0,
      billedFcfa: 0,
      paidFcfa: 0,
      remainingFcfa: 0,
    }
    current.count += 1
    current.billedFcfa += row.billedFcfa
    current.paidFcfa += row.paidFcfa
    current.remainingFcfa += row.remainingFcfa
    map.set(row.registeredById, current)
  }
  return [...map.values()].sort((a, b) => b.billedFcfa - a.billedFcfa)
})

const doctorOptions = computed(() => {
  const map = new Map<string, string>()
  for (const row of periodRows.value) {
    if (!row.surgeonId) continue
    map.set(row.surgeonId, row.surgeonName)
  }
  return [...map.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
})

const receptionistRows = computed(() =>
  receptionistFilter.value
    ? periodRows.value.filter((row) => row.registeredById === receptionistFilter.value)
    : periodRows.value,
)

const scopedRows = computed(() =>
  doctorFilter.value
    ? receptionistRows.value.filter((row) => row.surgeonId === doctorFilter.value)
    : receptionistRows.value,
)

const displayedRows = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  return scopedRows.value.filter((row) => {
    if (paymentFilter.value !== 'all' && row.paymentState !== paymentFilter.value) return false
    if (!q) return true
    return (
      row.patientName.toLowerCase().includes(q) ||
      row.patientCode.toLowerCase().includes(q) ||
      row.intervention.toLowerCase().includes(q) ||
      clinicServiceText(row.intervention).toLowerCase().includes(q) ||
      row.surgeonName.toLowerCase().includes(q) ||
      row.assistantName.toLowerCase().includes(q) ||
      row.registeredBy.toLowerCase().includes(q) ||
      row.collectedBy.toLowerCase().includes(q)
    )
  })
})

const stats = computed(() => {
  const rows = scopedRows.value
  return {
    count: rows.length,
    billedFcfa: rows.reduce((sum, row) => sum + row.billedFcfa, 0),
    paidCount: rows.filter((row) => row.paymentState === 'paid').length,
    paidFcfa: rows.reduce((sum, row) => sum + row.paidFcfa, 0),
    unpaidCount: rows.filter((row) => row.paymentState !== 'paid').length,
    remainingFcfa: rows.reduce((sum, row) => sum + row.remainingFcfa, 0),
  }
})

const periodLabel = computed(() =>
  dateFilterMode.value === 'all'
    ? uiText('Toutes les dates')
    : formatPeriodLabel(
        dateFilterMode.value,
        filterDay.value,
        filterMonth.value,
        filterFrom.value,
        filterTo.value,
      ),
)

async function load() {
  loading.value = true
  errorMessage.value = ''
  try {
    const [blocRes, otherRes] = await Promise.all([
      api.get<SurgeryCaseRow[]>('/surgeries', { params: { scope: 'all' } }),
      api.get<OtherOperationInvoice[]>('/surgeries/other-operations'),
      loadExamCatalog().catch(() => null),
    ])
    surgeries.value = blocRes.data
    otherOperations.value = otherRes.data
    operationCatalog.value = [...getExamCatalogSync().operation].sort((a, b) =>
      a.label.localeCompare(b.label, 'fr'),
    )
  } catch (error) {
    const apiMessage = isAxiosError(error)
      ? (error.response?.data as { error?: string } | undefined)?.error
      : undefined
    errorMessage.value = apiMessage ?? 'Impossible de charger les opérations.'
    surgeries.value = []
    otherOperations.value = []
  } finally {
    loading.value = false
  }
}

function apiErrorText(error: unknown) {
  return isAxiosError(error)
    ? (error.response?.data as { error?: string } | undefined)?.error
    : undefined
}

function findOperationRow(visitId: string) {
  const surgery = surgeries.value.find((item) => item.visit.id === visitId)
  if (surgery) return toRow(surgery)
  const other = otherOperations.value.find((item) => item.visit.id === visitId)
  if (other) return toOtherRow(other)
  return null
}

function operationPaymentItem(
  row: OperationRow,
  doctor?: { firstName: string; lastName: string } | null,
): LabExamPendingItem | null {
  if (!row.consultationId) return null
  const { firstName, lastName } = splitPatientFullName(row.patientName)
  const examLines = [
    { label: row.intervention, unitPriceFcfa: row.billedFcfa, kind: 'operation' as const },
  ]
  return {
    id: row.consultationId,
    visitId: row.visitId,
    updatedAt: new Date().toISOString(),
    examLines,
    examsByKind: examsByKindFromLines(examLines),
    grossFcfa: row.billedFcfa,
    unpaidKinds: ['operation'],
    visit: {
      patient: {
        code: row.patientCode,
        firstName,
        lastName,
      },
    },
    doctor: doctor ?? null,
  }
}

async function openEncaisser(
  row: OperationRow,
  doctor?: { firstName: string; lastName: string } | null,
) {
  actionId.value = row.id
  message.value = ''
  try {
    const { data } = await api.get<{ labExamsPending?: LabExamPendingItem[] }>('/comptabilite')
    const pending = data.labExamsPending ?? []
    const item =
      pending.find((p) => p.visitId === row.visitId) ??
      (row.consultationId ? pending.find((p) => p.id === row.consultationId) : undefined) ??
      operationPaymentItem(row, doctor)
    if (!item || row.remainingFcfa <= 0) {
      message.value = 'Aucun solde à encaisser pour cette opération.'
      messageType.value = 'error'
      return
    }
    payTarget.value = { row, item }
    payAmount.value = String(row.remainingFcfa)
  } catch (error) {
    const shown = await showApiErrorModal(error, 'Impossible d’ouvrir l’encaissement.')
    if (!shown) {
      message.value = apiErrorText(error) ?? 'Impossible d’ouvrir l’encaissement.'
      messageType.value = 'error'
    }
  } finally {
    actionId.value = null
  }
}

function closeEncaisser() {
  if (submittingPayment.value) return
  payTarget.value = null
  payAmount.value = ''
}

function dateInputValue(timestamp: number) {
  const date = new Date(timestamp)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function matchOperationCatalogId(row: OperationRow) {
  if (
    row.interventionTypeId &&
    operationCatalog.value.some((item) => item.id === row.interventionTypeId)
  ) {
    return row.interventionTypeId
  }
  const label = row.intervention.trim().toLowerCase()
  return operationCatalog.value.find((item) => item.label.trim().toLowerCase() === label)?.id ?? ''
}

const editKeepsCustomName = computed(() => {
  const row = editRow.value
  if (!row) return false
  const label = row.intervention.trim().toLowerCase()
  return !operationCatalog.value.some(
    (item) => item.id === row.interventionTypeId || item.label.trim().toLowerCase() === label,
  )
})

function openEdit(row: OperationRow) {
  const matchedId = matchOperationCatalogId(row)
  editRow.value = row
  editAmount.value = String(row.billedFcfa)
  editDate.value = dateInputValue(row.timestamp)
  editInterventionId.value = matchedId
  openedInterventionId.value = matchedId
  message.value = ''
}

function onEditIntervention(id: string) {
  editInterventionId.value = id
  const row = editRow.value
  if (!row) return
  if (id === openedInterventionId.value) {
    editAmount.value = String(row.billedFcfa)
    return
  }
  const chosen = operationCatalog.value.find((item) => item.id === id)
  if (chosen) editAmount.value = String(chosen.priceFcfa)
}

function closeEdit() {
  editRow.value = null
  savingEdit.value = false
}

const editAmountFcfa = computed(() => Math.max(0, Math.round(Number(editAmount.value) || 0)))
const canSaveEdit = computed(
  () => Boolean(editRow.value && editDate.value) && editAmount.value.trim() !== '',
)

async function submitEdit() {
  const row = editRow.value
  if (!row || !canSaveEdit.value || savingEdit.value) return

  savingEdit.value = true
  try {
    const path =
      row.source === 'bloc'
        ? `/surgeries/${row.id}/billing`
        : `/surgeries/other-operations/${row.id.replace(/^other-/, '')}/billing`
    const chosen = operationCatalog.value.find((item) => item.id === editInterventionId.value)
    const nameChanged =
      !!chosen &&
      (chosen.id !== row.interventionTypeId ||
        chosen.label.trim().toLowerCase() !== row.intervention.trim().toLowerCase())
    await api.patch(path, {
      amountFcfa: editAmountFcfa.value,
      operationDate: editDate.value,
      ...(nameChanged && chosen ? { interventionTypeId: chosen.id } : {}),
    })
    closeEdit()
    message.value = 'Opération modifiée.'
    messageType.value = 'success'
    await load()
  } catch (error) {
    const shown = await showApiErrorModal(error, 'Impossible de modifier l’opération.')
    if (!shown) {
      message.value = apiErrorText(error) ?? 'Impossible de modifier l’opération.'
      messageType.value = 'error'
    }
    savingEdit.value = false
  }
}

const parsedPayAmount = computed(() => {
  const raw = payAmount.value.replace(/\s/g, '').replace(',', '.')
  const value = Math.round(Number(raw))
  return Number.isFinite(value) ? value : 0
})

const payAmountError = computed(() => {
  const target = payTarget.value
  if (!target) return ''
  if (parsedPayAmount.value <= 0) return uiText('Saisissez un montant supérieur à 0.')
  if (parsedPayAmount.value > target.row.remainingFcfa) {
    return translateTemplate('Le montant ne peut pas dépasser le reste ({amount}).', {
      amount: formatFcfa(target.row.remainingFcfa),
    })
  }
  return ''
})

const remainingAfterPayment = computed(() =>
  payTarget.value ? Math.max(0, payTarget.value.row.remainingFcfa - parsedPayAmount.value) : 0,
)

async function confirmEncaisser() {
  const target = payTarget.value
  if (!target || payAmountError.value || submittingPayment.value) return
  const amountFcfa = parsedPayAmount.value
  const reductionsByKind = emptyExamReductionsByKind()
  submittingPayment.value = true
  message.value = ''
  reservePrintWindow('80mm')
  try {
    const { data: res } = await api.post('/comptabilite', {
      action: 'pay_lab_exams',
      consultationId: target.item.id,
      kinds: ['operation'],
      reductionsByKind,
      reductionFcfa: 0,
      installmentAmountFcfa: amountFcfa,
      installmentsByKind: { operation: amountFcfa },
    })
    const operationInvoice = res.invoicesByKind?.operation
    const remaining = operationInvoice?.remainingFcfa ?? remainingAfterPayment.value
    const invoicesByKind = {
      operation: {
        invoiceNumber: operationInvoice?.invoiceNumber,
        grossFcfa: operationInvoice?.grossFcfa ?? target.row.billedFcfa,
        reductionFcfa: operationInvoice?.reductionFcfa ?? 0,
        netFcfa: operationInvoice?.netFcfa ?? target.row.billedFcfa,
        paidFcfa: operationInvoice?.paidFcfa ?? target.row.paidFcfa + amountFcfa,
        remainingFcfa: remaining,
        isFullyPaid: remaining <= 0,
        installmentFcfa: amountFcfa,
      } satisfies ExamKindInvoiceMeta,
    }
    const printed = printLabExamPaymentReceipts(
      target.item,
      { kinds: ['operation'], reductionsByKind },
      invoicesByKind,
    )
    if (!printed) cancelPrintWindow()
    message.value =
      remaining > 0
        ? translateTemplate('{amount} encaissé — reste à payer : {rest}.', {
            amount: formatFcfa(amountFcfa),
            rest: formatFcfa(remaining),
          })
        : translateTemplate('{amount} encaissé — opération soldée.', { amount: formatFcfa(amountFcfa) })
    messageType.value = 'success'
    submittingPayment.value = false
    closeEncaisser()
    await load()
  } catch (error) {
    cancelPrintWindow()
    const shown = await showApiErrorModal(error, 'Erreur lors de l’encaissement.')
    if (!shown) {
      message.value = apiErrorText(error) ?? 'Erreur lors de l’encaissement.'
      messageType.value = 'error'
    }
  } finally {
    submittingPayment.value = false
  }
}

function receiptPayments(row: OperationRow): OperationPayment[] {
  if (row.payments.length) return row.payments
  if (row.paidFcfa <= 0) return []
  return [
    {
      id: `paid-${row.id}`,
      amountFcfa: row.paidFcfa,
      paidAt: new Date(row.timestamp).toISOString(),
      recordedByName: row.collectedBy,
    },
  ]
}

function printOperationPaymentReceipt(row: OperationRow, payment: OperationPayment) {
  const item = operationPaymentItem(row, row.doctor)
  if (!item) {
    message.value = uiText('Impossible d’imprimer ce reçu.')
    messageType.value = 'error'
    return
  }
  const payments = receiptPayments(row)
  const index = Math.max(0, payments.findIndex((entry) => entry.id === payment.id))
  const paidThrough = payments.slice(0, index + 1).reduce((sum, entry) => sum + entry.amountFcfa, 0)
  const remaining = Math.max(0, row.billedFcfa - paidThrough)
  item.updatedAt = payment.paidAt
  item.paidAt = payment.paidAt
  item.cashierName = payment.recordedByName || null
  reservePrintWindow('80mm')
  const printed = printLabExamPaymentReceipts(
    item,
    { kinds: ['operation'], reductionsByKind: emptyExamReductionsByKind() },
    {
      operation: {
        invoiceNumber: row.invoiceNumber || undefined,
        grossFcfa: row.billedFcfa,
        reductionFcfa: 0,
        netFcfa: row.billedFcfa,
        paidFcfa: paidThrough,
        remainingFcfa: remaining,
        isFullyPaid: remaining <= 0,
        installmentFcfa: payment.amountFcfa,
      },
    },
  )
  if (!printed) {
    cancelPrintWindow()
    message.value = uiText("Impossible d'imprimer le reçu.")
    messageType.value = 'error'
  }
}

const listedReceipts = computed(() =>
  receiptRow.value ? receiptPayments(receiptRow.value) : [],
)

function reprintReceipts(row: OperationRow) {
  const payments = receiptPayments(row)
  if (!payments.length) {
    message.value = uiText('Aucun reçu à réimprimer pour cette opération.')
    messageType.value = 'error'
    return
  }
  if (payments.length === 1) {
    printOperationPaymentReceipt(row, payments[0]!)
    return
  }
  receiptRow.value = row
}

function printListedReceipt(payment: OperationPayment) {
  const row = receiptRow.value
  if (!row) return
  printOperationPaymentReceipt(row, payment)
}

function formatReceiptWhen(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function canDelete(row: OperationRow) {
  return row.paidFcfa === 0 && !row.completed
}

async function deleteRow(row: OperationRow) {
  const confirmed = await confirmAppModal({
    title: uiText('Supprimer l’opération'),
    message: translateTemplate('Supprimer « {intervention} » pour {patient} ? Cette action est définitive.', {
      intervention: clinicServiceText(row.intervention),
      patient: row.patientName,
    }),
    confirmLabel: uiText('Supprimer'),
  })
  if (!confirmed) return
  actionId.value = row.id
  message.value = ''
  try {
    const url =
      row.source === 'bloc'
        ? `/surgeries/${row.recordId}`
        : `/surgeries/other-operations/${row.recordId}`
    await api.delete(url)
    message.value = translateTemplate('Opération « {intervention} » supprimée.', {
      intervention: clinicServiceText(row.intervention),
    })
    messageType.value = 'success'
    await load()
  } catch (error) {
    const shown = await showApiErrorModal(error, uiText('Impossible de supprimer l’opération.'))
    if (!shown) {
      message.value = apiErrorText(error) ?? uiText('Impossible de supprimer l’opération.')
      messageType.value = 'error'
    }
  } finally {
    actionId.value = null
  }
}

function resetCustomRange() {
  filterFrom.value = ''
  filterTo.value = ''
}

const exportColumns: ExportColumn<OperationRow>[] = [
  { header: uiText('Date'), value: (r) => `${r.dateLabel} ${r.timeLabel}` },
  { header: uiText('Patient'), value: (r) => r.patientName },
  { header: uiText('Code'), value: (r) => r.patientCode },
  { header: uiText('Type'), value: (r) => uiText(SOURCE_LABELS[r.source]) },
  { header: uiText('Intervention'), value: (r) => clinicServiceText(r.intervention) },
  { header: uiText('Médecin'), value: (r) => r.surgeonName },
  { header: uiText('Assistant'), value: (r) => r.assistantName },
  {
    header: uiText('Opération'),
    value: (r) => (r.source === 'other' ? '—' : r.completed ? uiText('Effectuée') : uiText('En attente')),
  },
  { header: uiText('Montant'), value: (r) => formatFcfa(r.billedFcfa) },
  { header: uiText('Payé'), value: (r) => formatFcfa(r.paidFcfa) },
  { header: uiText('Reste'), value: (r) => formatFcfa(r.remainingFcfa) },
  { header: uiText('Statut'), value: (r) => uiText(PAYMENT_LABELS[r.paymentState]) },
  { header: uiText('Enregistré par'), value: (r) => r.registeredBy },
  { header: uiText('Encaissé par'), value: (r) => r.collectedBy || '—' },
]

function exportShared() {
  const receptionist = receptionistSummaries.value.find((r) => r.id === receptionistFilter.value)
  const doctor = doctorOptions.value.find((item) => item.id === doctorFilter.value)
  return {
    captionRows: [
      { label: uiText('Période'), value: periodLabel.value },
      ...(receptionist ? [{ label: uiText('Réceptionniste'), value: receptionist.name }] : []),
      ...(doctor ? [{ label: uiText('Médecin'), value: doctor.name }] : []),
    ],
    totalsRows: [
      { label: uiText('Nombre d’opérations'), value: String(displayedRows.value.length) },
      {
        label: uiText('Reste à payer'),
        value: formatFcfa(displayedRows.value.reduce((sum, r) => sum + r.remainingFcfa, 0)),
      },
    ],
  }
}

const EXPORT_TITLE = 'Opérations (bloc et autres chirurgies)'

function exportPdf() {
  exportTablePdf(uiText(EXPORT_TITLE), exportColumns, displayedRows.value, exportShared())
}

function exportExcel() {
  exportTableExcel(uiText(EXPORT_TITLE), exportColumns, displayedRows.value, exportShared())
}

function exportWord() {
  void exportTableWord(uiText(EXPORT_TITLE), exportColumns, displayedRows.value, exportShared())
}

onMounted(load)
</script>

<template>
  <div class="page-with-table reception-ops-page">
    <section class="page-with-table__head">
      <UiPageHeader
        title="Opérations"
        subtitle="Toutes les opérations du bloc opératoire et autres chirurgies, utilisateur ayant enregistré et état du paiement patient"
        :icon="Scissors"
      >
        <template #actions>
          <UiButton variant="primary" :icon="Plus" @click="openRegisterModal">
            {{ uiText('Enregistrer une opération') }}
          </UiButton>
        </template>
      </UiPageHeader>
      <UiAlert v-if="errorMessage" type="error" :message="errorMessage" />
      <UiAlert v-if="message && !payTarget" :type="messageType" :message="message" />

      <div class="stats-grid">
        <UiStatCard mini label="Opérations" :value="String(stats.count)" :icon="Scissors" variant="teal" />
        <UiStatCard
          mini
          label="Montant total"
          :value="formatFcfa(stats.billedFcfa)"
          :icon="CircleDollarSign"
          variant="blue"
        />
        <UiStatCard
          mini
          :label="translateTemplate('Payées ({n})', { n: stats.paidCount })"
          :value="formatFcfa(stats.paidFcfa)"
          :icon="CheckCircle2"
          variant="green"
        />
        <UiStatCard
          mini
          :label="translateTemplate('Non soldées ({n})', { n: stats.unpaidCount })"
          :value="formatFcfa(stats.remainingFcfa)"
          :icon="Clock"
          variant="violet"
        />
      </div>

      <div class="filter-bar" role="region" :aria-label="uiText('Filtres')">
        <div class="filter-bar__row">
          <div class="filter-bar__modes" role="tablist" :aria-label="uiText('Période')">
            <button
              v-for="mode in DATE_MODES"
              :key="mode.id"
              type="button"
              role="tab"
              class="filter-bar__mode"
              :class="{ 'filter-bar__mode--active': dateFilterMode === mode.id }"
              :aria-selected="dateFilterMode === mode.id"
              @click="dateFilterMode = mode.id"
            >
              <component :is="mode.icon" :size="15" />
              {{ uiText(mode.label) }}
            </button>
          </div>

          <div class="filter-bar__controls">
            <template v-if="dateFilterMode === 'day'">
              <label class="filter-bar__field">
                <span class="filter-bar__field-label">{{ uiText('Date') }}</span>
                <input v-model="filterDay" type="date" class="filter-bar__input" />
              </label>
              <div class="filter-bar__quick">
                <button type="button" class="filter-bar__chip" @click="filterDay = todayDateKey()">
                  {{ uiText("Aujourd'hui") }}
                </button>
                <button type="button" class="filter-bar__chip" @click="filterDay = yesterdayDateKey()">
                  {{ uiText('Hier') }}
                </button>
              </div>
            </template>

            <template v-else-if="dateFilterMode === 'month'">
              <label class="filter-bar__field">
                <span class="filter-bar__field-label">{{ uiText('Mois') }}</span>
                <input v-model="filterMonth" type="month" class="filter-bar__input" />
              </label>
            </template>

            <template v-else-if="dateFilterMode === 'custom'">
              <label class="filter-bar__field">
                <span class="filter-bar__field-label">{{ uiText('Du') }}</span>
                <input v-model="filterFrom" type="date" class="filter-bar__input" />
              </label>
              <span class="filter-bar__sep" aria-hidden="true">→</span>
              <label class="filter-bar__field">
                <span class="filter-bar__field-label">{{ uiText('Au') }}</span>
                <input v-model="filterTo" type="date" class="filter-bar__input" />
              </label>
              <button type="button" class="filter-bar__chip filter-bar__chip--muted" @click="resetCustomRange">
                {{ uiText('Effacer') }}
              </button>
            </template>

            <label v-if="canSeeAllReceptionists" class="filter-bar__field">
              <span class="filter-bar__field-label">{{ uiText('Réceptionniste') }}</span>
              <select v-model="receptionistFilter" class="filter-bar__input">
                <option value="">{{ uiText('Tous les réceptionnistes') }}</option>
                <option v-for="r in receptionistSummaries" :key="r.id" :value="r.id">{{ r.name }}</option>
              </select>
            </label>

            <label class="filter-bar__field">
              <span class="filter-bar__field-label">{{ uiText('Type') }}</span>
              <select v-model="sourceFilter" class="filter-bar__input">
                <option v-for="f in SOURCE_FILTERS" :key="f.id" :value="f.id">{{ uiText(f.label) }}</option>
              </select>
            </label>

            <label class="filter-bar__field">
              <span class="filter-bar__field-label">{{ uiText('Paiement') }}</span>
              <select v-model="paymentFilter" class="filter-bar__input">
                <option v-for="f in PAYMENT_FILTERS" :key="f.id" :value="f.id">{{ uiText(f.label) }}</option>
              </select>
            </label>
          </div>
        </div>

        <div class="filter-bar__footer">
          <CalendarRange :size="15" class="filter-bar__footer-icon" />
          <span class="filter-bar__period">{{ periodLabel }}</span>
          <span aria-hidden="true">·</span>
          <span class="filter-bar__count">{{
            translateTemplate('{n} opération(s) affichée(s)', { n: displayedRows.length })
          }}</span>
        </div>
      </div>
    </section>

    <section class="page-with-table__body">
      <UiCard
        direct
        title="Opérations"
        description="Qui a enregistré l’opération et si le patient a payé"
        class="ui-card--table-panel"
        :icon="Scissors"
        icon-variant="green"
      >
        <template #actions>
          <div class="table-search">
            <Search :size="16" class="table-search__icon" />
            <input
              v-model="searchQuery"
              type="search"
              class="table-search__input"
              :placeholder="uiText('Patient, intervention, utilisateur…')"
              :aria-label="uiText('Rechercher une opération')"
            />
          </div>
          <ExportButtons
            :disabled="loading || !displayedRows.length"
            @pdf="exportPdf"
            @excel="exportExcel"
            @word="exportWord"
          />
          <UiButton variant="ghost" size="sm" :icon="RefreshCw" :disabled="loading" @click="load">
            Actualiser
          </UiButton>
        </template>

        <div class="simple-table-shell simple-table-shell--fill">
          <div v-if="loading" class="simple-table-overlay" role="status" aria-live="polite">
            <span class="simple-table-spinner" aria-hidden="true" />
            {{ uiText('Chargement des opérations…') }}
          </div>

          <div class="simple-table-scroll">
            <p v-if="!loading && !displayedRows.length" class="simple-table__empty">
              {{
                uiText(
                  (surgeries.length || otherOperations.length) && !periodRows.length
                    ? 'Aucune opération sur cette période — élargissez le filtre.'
                    : 'Aucune opération trouvée',
                )
              }}
            </p>
            <div v-else class="simple-table-wrap">
              <table class="simple-table">
                <thead>
                  <tr>
                    <th class="simple-table__num">#</th>
                    <th>{{ uiText('Date') }}</th>
                    <th>{{ uiText('Patient') }}</th>
                    <th>{{ uiText('Intervention') }}</th>
                    <th class="ops-doctor-col">
                      <select
                        v-model="doctorFilter"
                        class="ops-doctor-filter"
                        :aria-label="uiText('Filtrer par médecin')"
                      >
                        <option value="">{{ uiText('Tous les médecins') }}</option>
                        <option v-for="doctor in doctorOptions" :key="doctor.id" :value="doctor.id">
                          {{ doctor.name }}
                        </option>
                      </select>
                    </th>
                    <th>{{ uiText('Assistant') }}</th>
                    <th>{{ uiText('Enregistrement') }}</th>
                    <th>{{ uiText('Montant') }}</th>
                    <th>{{ uiText('Payé') }}</th>
                    <th>{{ uiText('Reste') }}</th>
                    <th>{{ uiText('Paiement') }}</th>
                    <th class="simple-table__actions-head">{{ uiText('Actions') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(row, index) in displayedRows" :key="row.id">
                    <td class="simple-table__num">{{ index + 1 }}</td>
                    <td>
                      <span class="st-date">{{ row.dateLabel }}</span>
                      <span class="st-sub">{{ row.timeLabel }}</span>
                      <template v-if="row.source === 'bloc'">
                        <span v-if="row.completed" class="st-badge st-badge--success">{{ uiText('Effectuée') }}</span>
                        <span v-else class="st-badge st-badge--info">{{ uiText("En attente d'opération") }}</span>
                      </template>
                    </td>
                    <td>
                      <span class="st-name">{{ row.patientName }}</span>
                      <span class="st-sub">{{ row.patientCode }}</span>
                    </td>
                    <td>
                      <span class="st-name">{{ clinicServiceText(row.intervention) }}</span>
                      <span
                        class="st-badge"
                        :class="row.source === 'bloc' ? 'st-badge--info' : 'st-badge--warning'"
                      >
                        {{ uiText(SOURCE_LABELS[row.source]) }}
                      </span>
                    </td>
                    <td>
                      <span class="st-name">{{ row.surgeonName }}</span>
                    </td>
                    <td>
                      <span class="st-name">{{ row.assistantName }}</span>
                    </td>
                    <td>
                      <span class="st-name">{{ row.registeredBy }}</span>
                      <span class="st-sub">{{ uiText('Enregistré par') }}</span>
                      <span v-if="row.collectedBy" class="st-sub">{{
                        translateTemplate('Encaissé par {name}', { name: row.collectedBy })
                      }}</span>
                    </td>
                    <td>
                      <span class="st-amount">{{ formatFcfa(row.billedFcfa) }}</span>
                    </td>
                    <td>
                      <span class="st-amount">{{ formatFcfa(row.paidFcfa) }}</span>
                    </td>
                    <td>
                      <span
                        class="st-amount"
                        :class="{ 'st-amount--due': row.remainingFcfa > 0 }"
                      >{{ formatFcfa(row.remainingFcfa) }}</span>
                    </td>
                    <td>
                      <span class="st-badge" :class="`st-badge--${PAYMENT_VARIANTS[row.paymentState]}`">
                        {{ uiText(PAYMENT_LABELS[row.paymentState]) }}
                      </span>
                    </td>
                    <td class="simple-table__actions">
                      <div class="ops-actions">
                        <button
                          v-if="row.remainingFcfa > 0"
                          type="button"
                          class="st-btn st-btn--pay st-btn--labeled"
                          :disabled="!!actionId || submittingPayment"
                          @click="openEncaisser(row)"
                        >
                          <Banknote :size="15" />
                          {{ uiText(actionId === row.id ? 'Ouverture…' : 'Encaisser') }}
                        </button>
                        <button
                          v-if="row.paidFcfa > 0"
                          type="button"
                          class="st-btn st-btn--print st-btn--labeled"
                          :title="uiText('Réimprimer le reçu')"
                          :disabled="!!actionId || submittingPayment"
                          @click="reprintReceipts(row)"
                        >
                          <Printer :size="15" />
                          {{ uiText('Reçu') }}
                        </button>
                        <button
                          v-if="canEditOperations"
                          type="button"
                          class="st-btn st-btn--edit"
                          :title="uiText('Modifier le montant et la date')"
                          :aria-label="uiText('Modifier le montant et la date')"
                          @click="openEdit(row)"
                        >
                          <Pencil :size="15" />
                        </button>
                        <button
                          v-if="canDelete(row)"
                          type="button"
                          class="st-btn st-btn--delete"
                          :title="uiText('Supprimer')"
                          :aria-label="uiText('Supprimer')"
                          :disabled="!!actionId || submittingPayment"
                          @click="deleteRow(row)"
                        >
                          <Trash2 :size="15" />
                        </button>
                        <span
                          v-if="row.remainingFcfa <= 0 && row.paidFcfa <= 0 && !canDelete(row) && !canEditOperations"
                          class="st-muted"
                        >—</span>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </UiCard>
    </section>

    <UiFormModal
      v-if="showRegisterModal"
      title="Enregistrer une opération"
      subtitle="Même saisie qu’un patient externe : service, prix, médecin obligatoire et assistant."
      :icon="Scissors"
      size="wide"
      @close="closeRegisterModal"
    >
      <UiAlert
        v-if="message && messageType === 'error'"
        type="error"
        :message="message"
      />
      <form id="register-operation-form" class="register-op-form" @submit.prevent="submitRegisterOperation">
        <ReceptionPatientIdentityFields
          v-model:full-name="patientForm.fullName"
          v-model:age="patientForm.age"
          v-model:age-unit="patientForm.ageUnit"
          v-model:phone="patientForm.phone"
          v-model:gender="patientForm.gender"
        />
        <MultiExamPrescriptionPicker
          v-model="registerExams"
          v-model:operation-amount-fcfa="operationAmountFcfa"
          v-model:operation-doctor-id="selectedDoctorId"
          v-model:operation-assistant="operationAssistant"
          v-model:operation-service-id="operationServiceId"
          :kinds="['operation']"
          :show-comments="false"
          :show-consultation="false"
        />
      </form>
      <template #footer>
        <UiButton variant="ghost" type="button" @click="closeRegisterModal">
          {{ uiText('Annuler') }}
        </UiButton>
        <UiButton
          variant="primary"
          type="submit"
          form="register-operation-form"
          :disabled="!canRegisterOperation || registeringOperation"
        >
          {{ uiText(registeringOperation ? 'Enregistrement…' : 'Enregistrer') }}
        </UiButton>
      </template>
    </UiFormModal>

    <UiFormModal
      v-if="editRow"
      title="Modifier l'opération"
      :subtitle="`${editRow.patientName} — ${clinicServiceText(editRow.intervention)}`"
      :icon="Pencil"
      @close="closeEdit"
    >
      <UiSelect
        :model-value="editInterventionId"
        label="Opération"
        :disabled="!operationCatalog.length"
        @update:model-value="onEditIntervention"
      >
        <option v-if="editKeepsCustomName" value="">{{ clinicServiceText(editRow.intervention) }}</option>
        <option v-for="item in operationCatalog" :key="item.id" :value="item.id">
          {{ clinicServiceText(item.label) }}
        </option>
      </UiSelect>
      <UiInput v-model="editAmount" label="Montant (FCFA)" type="number" required />
      <UiInput v-model="editDate" label="Date de l'opération" type="date" required />
      <p v-if="editRow.paidFcfa > 0" class="edit-hint">
        {{
          translateTemplate('Déjà encaissé : {paid}', { paid: formatFcfa(editRow.paidFcfa) })
        }}
      </p>

      <template #footer>
        <UiButton variant="ghost" @click="closeEdit">{{ uiText('Annuler') }}</UiButton>
        <UiButton
          variant="primary"
          :disabled="!canSaveEdit || savingEdit"
          @click="submitEdit"
        >
          {{ uiText(savingEdit ? 'Enregistrement…' : 'Enregistrer') }}
        </UiButton>
      </template>
    </UiFormModal>

    <Teleport to="body">
      <div v-if="payTarget" class="ops-pay-overlay" @click.self="closeEncaisser">
        <form
          class="ops-pay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ops-pay-title"
          @submit.prevent="confirmEncaisser"
        >
          <header class="ops-pay__head">
            <div>
              <p id="ops-pay-title" class="ops-pay__title">{{ uiText('Encaisser l’opération') }}</p>
              <p class="ops-pay__subtitle">
                {{ payTarget.row.patientName }} · {{ payTarget.row.patientCode }}
              </p>
            </div>
            <button
              type="button"
              class="ops-pay__close"
              :aria-label="uiText('Fermer')"
              :disabled="submittingPayment"
              @click="closeEncaisser"
            >
              <X :size="18" />
            </button>
          </header>

          <p class="ops-pay__intervention">
            <Scissors :size="14" />
            <span>{{ clinicServiceText(payTarget.row.intervention) }}</span>
            <span class="ops-pay__muted">{{ payTarget.row.surgeonName }}</span>
          </p>

          <dl class="ops-pay__amounts">
            <div>
              <dt>{{ uiText('Montant total') }}</dt>
              <dd>{{ formatFcfa(payTarget.row.billedFcfa) }}</dd>
            </div>
            <div>
              <dt>{{ uiText('Déjà payé') }}</dt>
              <dd>{{ formatFcfa(payTarget.row.paidFcfa) }}</dd>
            </div>
            <div class="ops-pay__amounts-due">
              <dt>{{ uiText('Reste à payer') }}</dt>
              <dd>{{ formatFcfa(payTarget.row.remainingFcfa) }}</dd>
            </div>
          </dl>

          <UiInput
            v-model="payAmount"
            :label="uiText('Montant à encaisser (FCFA)')"
            type="number"
            min="1"
            :max="payTarget.row.remainingFcfa"
            :disabled="submittingPayment"
          />
          <div class="ops-pay__quick">
            <button
              type="button"
              class="filter-bar__chip"
              :disabled="submittingPayment"
              @click="payAmount = String(payTarget.row.remainingFcfa)"
            >
              {{ uiText('Tout le reste') }}
            </button>
            <button
              type="button"
              class="filter-bar__chip"
              :disabled="submittingPayment"
              @click="payAmount = String(Math.max(1, Math.floor(payTarget.row.remainingFcfa / 2)))"
            >
              {{ uiText('Moitié') }}
            </button>
          </div>

          <p v-if="payAmountError" class="ops-pay__error">{{ payAmountError }}</p>
          <p v-else class="ops-pay__after">
            {{
              remainingAfterPayment > 0
                ? translateTemplate('Reste après ce paiement : {amount}. Le reçu imprimera ce versement.', {
                    amount: formatFcfa(remainingAfterPayment),
                  })
                : translateTemplate('L’opération sera entièrement soldée. Le reçu imprimera {amount}.', {
                    amount: formatFcfa(parsedPayAmount),
                  })
            }}
          </p>

          <footer class="ops-pay__foot">
            <UiButton variant="ghost" type="button" :disabled="submittingPayment" @click="closeEncaisser">
              {{ uiText('Annuler') }}
            </UiButton>
            <UiButton
              variant="success"
              type="submit"
              :icon="Banknote"
              :disabled="submittingPayment || !!payAmountError"
            >
              {{
                submittingPayment
                  ? uiText('Validation…')
                  : translateTemplate('Encaisser {amount}', { amount: formatFcfa(parsedPayAmount) })
              }}
            </UiButton>
          </footer>
        </form>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="receiptRow" class="ops-pay-overlay" @click.self="receiptRow = null">
        <div class="ops-pay" role="dialog" aria-modal="true" aria-labelledby="ops-receipt-title">
          <header class="ops-pay__head">
            <div>
              <p id="ops-receipt-title" class="ops-pay__title">{{ uiText('Anciens reçus') }}</p>
              <p class="ops-pay__subtitle">
                {{ receiptRow.patientName }} · {{ receiptRow.intervention }}
              </p>
            </div>
            <button
              type="button"
              class="ops-pay__close"
              :aria-label="uiText('Fermer')"
              @click="receiptRow = null"
            >
              <X :size="18" />
            </button>
          </header>
          <ul class="ops-receipts">
            <li v-for="payment in listedReceipts" :key="payment.id">
              <div>
                <strong>{{ formatFcfa(payment.amountFcfa) }}</strong>
                <span>{{ formatReceiptWhen(payment.paidAt) }}</span>
                <span v-if="payment.recordedByName">{{ payment.recordedByName }}</span>
              </div>
              <button
                type="button"
                class="st-btn st-btn--print st-btn--labeled"
                @click="printListedReceipt(payment)"
              >
                <Printer :size="15" />
                {{ uiText('Imprimer') }}
              </button>
            </li>
          </ul>
          <footer class="ops-pay__foot">
            <UiButton variant="ghost" type="button" @click="receiptRow = null">
              {{ uiText('Fermer') }}
            </UiButton>
          </footer>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.register-op-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.edit-hint {
  margin: 0.15rem 0 0;
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-muted);
}

.filter-bar {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0.45rem 0.65rem;
  box-shadow: var(--shadow-sm);
  margin-top: 0.35rem;
}

.filter-bar__row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 0.85rem 1.25rem;
}

.filter-bar__modes {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  padding: 0.2rem;
  background: #f1f5f9;
  border-radius: 10px;
  border: 1px solid var(--border);
}

.filter-bar__mode {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.42rem 0.75rem;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-muted);
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;
}

.filter-bar__mode--active {
  background: #fff;
  color: var(--primary-800);
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08);
}

.filter-bar__controls {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 0.65rem 0.85rem;
  flex: 1;
  min-width: min(100%, 14rem);
}

.filter-bar__field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.filter-bar__field-label {
  font-size: 0.6875rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-light);
}

.filter-bar__input {
  height: 2.25rem;
  padding: 0 0.65rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
  font-size: 0.875rem;
  min-width: 10.5rem;
}

.ops-doctor-col {
  min-width: 11rem;
}

.ops-doctor-filter {
  width: 100%;
  max-width: 14rem;
  height: 1.85rem;
  padding: 0 0.4rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: #fff;
  color: var(--text);
  font-size: 0.78rem;
  font-weight: 600;
  text-transform: none;
  letter-spacing: normal;
}

.filter-bar__quick {
  display: flex;
  gap: 0.4rem;
}

.filter-bar__chip {
  height: 2.25rem;
  padding: 0 0.75rem;
  border: 1px solid var(--primary-200);
  border-radius: 8px;
  background: var(--primary-50);
  color: var(--primary-800);
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
}

.filter-bar__chip--muted {
  background: #f8fafc;
  border-color: var(--border);
  color: var(--text-muted);
}

.filter-bar__sep {
  color: var(--text-light);
}

.filter-bar__footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
  margin-top: 0.75rem;
  padding-top: 0.7rem;
  border-top: 1px dashed var(--border);
  font-size: 0.8125rem;
}

.filter-bar__footer-icon {
  color: var(--primary-600);
}

.filter-bar__period {
  font-weight: 600;
}

.filter-bar__count {
  color: var(--text-muted);
}

.table-search {
  position: relative;
  min-width: min(100%, 14rem);
}

.table-search__icon {
  position: absolute;
  left: 0.65rem;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-muted);
  pointer-events: none;
}

.table-search__input {
  width: 100%;
  height: 2.1rem;
  padding: 0 0.75rem 0 2.1rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
  font-size: 0.875rem;
}

.reception-ops-page.page-with-table {
  height: auto;
  overflow: visible;
}

.reception-ops-page .page-with-table__head {
  max-height: none;
  overflow: visible;
}

.reception-ops-page .page-with-table__body {
  flex: none;
  min-height: auto;
  overflow: visible;
}

.reception-ops-page .ui-card--table-panel {
  min-height: min(60dvh, 560px);
}

.st-date,
.st-name,
.st-sub,
.st-amount {
  display: block;
}

.st-amount--due {
  color: #b91c1c;
  font-weight: 700;
}

.ops-actions {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}

.st-btn--print {
  color: #0f766e;
}

.ops-receipts {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.ops-receipts li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.55rem 0.65rem;
  border: 1px solid var(--border);
  border-radius: 8px;
}

.ops-receipts li div {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 0;
}

.ops-receipts li span {
  color: var(--text-muted);
  font-size: 0.78rem;
}

.ops-pay-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background: rgba(15, 23, 42, 0.45);
}

.ops-pay {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  width: min(100%, 26rem);
  padding: 1.1rem 1.2rem;
  border-radius: var(--radius);
  background: var(--bg-card);
  box-shadow: 0 20px 45px rgba(15, 23, 42, 0.25);
}

.ops-pay__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
}

.ops-pay__title {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 700;
}

.ops-pay__subtitle,
.ops-pay__muted {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--text-muted);
}

.ops-pay__close {
  display: inline-flex;
  padding: 0.3rem;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}

.ops-pay__intervention {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
  margin: 0;
  font-weight: 600;
}

.ops-pay__amounts {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.5rem;
  margin: 0;
}

.ops-pay__amounts div {
  padding: 0.5rem 0.6rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #f8fafc;
}

.ops-pay__amounts dt {
  font-size: 0.6875rem;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--text-light);
}

.ops-pay__amounts dd {
  margin: 0.2rem 0 0;
  font-weight: 700;
}

.ops-pay__amounts-due {
  border-color: #fecaca !important;
  background: #fef2f2 !important;
}

.ops-pay__amounts-due dd {
  color: #b91c1c;
}

.ops-pay__quick {
  display: flex;
  gap: 0.4rem;
  margin-top: -0.4rem;
}

.ops-pay__error,
.ops-pay__after {
  margin: 0;
  font-size: 0.8125rem;
}

.ops-pay__error {
  color: #b91c1c;
}

.ops-pay__after {
  color: var(--text-muted);
}

.ops-pay__foot {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}
</style>
