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
} from '@lucide/vue'
import { isAxiosError } from 'axios'
import api from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { showApiErrorModal } from '@/lib/api-modal-helper'
import { EXAM_KIND_LABELS, type ExamKindSlug } from '@/lib/exam-catalog/types'
import { remainingPayableExamKinds } from '@/lib/exam-billing'
import { normalizeLabExamPendingItem } from '@/lib/lab-exam-pending'
import { printLabExamPaymentReceipts } from '@/lib/lab-exam-invoice'
import { cancelPrintWindow, reservePrintWindow } from '@/lib/print-document'
import LabExamPaymentModal, {
  type LabExamPaymentConfirmPayload,
  type LabExamPaymentItem,
} from '@/components/comptabilite/LabExamPaymentModal.vue'
import { formatFcfa, fullName } from '@/lib/roles'
import { type SurgeryCaseRow, type SurgeryUserRef } from '@/lib/surgery-case'
import { surgeryCompletedAtIso } from '@/lib/surgery-shares'
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
import UiStatCard from '@/components/ui/UiStatCard.vue'
import ExportButtons from '@/components/ui/ExportButtons.vue'
import { exportTableExcel, exportTablePdf, exportTableWord, type ExportColumn } from '@/lib/table-export'
import '@/assets/simple-table.css'

type PaymentFilter = 'all' | 'paid' | 'partial' | 'unpaid'
type PaymentState = Exclude<PaymentFilter, 'all'>
type SourceFilter = 'all' | OperationSource
type OperationSource = 'bloc' | 'other'
type PeriodMode = DateFilterMode | 'all'

type OtherOperationInvoice = {
  id: string
  status: string
  amountFcfa: number
  paidAmountFcfa: number
  paidAt?: string | null
  createdAt: string
  issuedBy?: SurgeryUserRef | null
  payments?: { id: string; amountFcfa: number; paidAt: string; recordedBy?: SurgeryUserRef | null }[]
  interventionLabel: string
  doctor?: SurgeryUserRef | null
  visit: {
    id: string
    createdBy?: SurgeryUserRef | null
    patient: { code: string; firstName: string; lastName: string }
    consultation?: { id: string } | null
  }
}

type OperationRow = {
  id: string
  source: OperationSource
  visitId: string
  consultationId: string | null
  patientName: string
  patientCode: string
  intervention: string
  surgeonName: string
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
const canSeeAllReceptionists = computed(() => auth.user?.role !== 'RECEPTIONNISTE')

const surgeries = ref<SurgeryCaseRow[]>([])
const otherOperations = ref<OtherOperationInvoice[]>([])
const loading = ref(false)
const errorMessage = ref('')
const message = ref('')
const messageType = ref<'success' | 'error'>('success')
const actionId = ref<string | null>(null)
const paymentItem = ref<LabExamPaymentItem | null>(null)
const submittingPayment = ref(false)
const submittingKind = ref<ExamKindSlug | null>(null)
const searchQuery = ref('')
const paymentFilter = ref<PaymentFilter>('all')
const receptionistFilter = ref('')
const sourceFilter = ref<SourceFilter>('all')

const dateFilterMode = ref<PeriodMode>('all')
const filterDay = ref(todayDateKey())
const filterMonth = ref(currentMonthKey())
const filterFrom = ref('')
const filterTo = ref('')

function userName(user?: SurgeryUserRef | null) {
  return user ? fullName(user.firstName, user.lastName) : ''
}

function paymentInfo(
  billedFcfa: number,
  invoice?: Pick<OtherOperationInvoice, 'status' | 'paidAmountFcfa' | 'issuedBy' | 'payments'> | null,
) {
  const paidFcfa = invoice?.paidAmountFcfa ?? 0
  const remainingFcfa = Math.max(0, billedFcfa - paidFcfa)
  const paymentState: PaymentState =
    invoice?.status === 'PAID' || (billedFcfa > 0 && remainingFcfa === 0)
      ? 'paid'
      : paidFcfa > 0
        ? 'partial'
        : 'unpaid'

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
    source: 'other',
    visitId: op.visit.id,
    consultationId: op.visit.consultation?.id ?? null,
    patientName: fullName(op.visit.patient.firstName, op.visit.patient.lastName),
    patientCode: op.visit.patient.code,
    intervention: op.interventionLabel,
    surgeonName: doctor ? `Dr ${doctor}` : '—',
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
    source: 'bloc',
    visitId: surgery.visit.id,
    consultationId: surgery.visit.consultation?.id ?? null,
    patientName: fullName(surgery.visit.patient.firstName, surgery.visit.patient.lastName),
    patientCode: surgery.visit.patient.code,
    intervention: surgery.interventionType.label,
    surgeonName: `Dr ${fullName(surgery.surgeon.firstName, surgery.surgeon.lastName)}`,
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

const receptionistRows = computed(() =>
  receptionistFilter.value
    ? periodRows.value.filter((row) => row.registeredById === receptionistFilter.value)
    : periodRows.value,
)

const displayedRows = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  return receptionistRows.value.filter((row) => {
    if (paymentFilter.value !== 'all' && row.paymentState !== paymentFilter.value) return false
    if (!q) return true
    return (
      row.patientName.toLowerCase().includes(q) ||
      row.patientCode.toLowerCase().includes(q) ||
      row.intervention.toLowerCase().includes(q) ||
      row.surgeonName.toLowerCase().includes(q) ||
      row.registeredBy.toLowerCase().includes(q) ||
      row.collectedBy.toLowerCase().includes(q)
    )
  })
})

const stats = computed(() => {
  const rows = receptionistRows.value
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
    ? 'Toutes les dates'
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
    ])
    surgeries.value = blocRes.data
    otherOperations.value = otherRes.data
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

async function openEncaisser(row: OperationRow) {
  actionId.value = row.id
  message.value = ''
  try {
    const { data } = await api.get<{ labExamsPending?: LabExamPaymentItem[] }>('/comptabilite')
    const pending = data.labExamsPending ?? []
    const item =
      pending.find((p) => p.visitId === row.visitId) ??
      (row.consultationId ? pending.find((p) => p.id === row.consultationId) : undefined) ??
      null
    if (!item) {
      message.value = 'Aucun solde à encaisser pour cette opération.'
      messageType.value = 'error'
      return
    }
    paymentItem.value = item
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
  paymentItem.value = null
  submittingKind.value = null
}

async function confirmEncaisser(payload: LabExamPaymentConfirmPayload) {
  const paidItem = paymentItem.value
  const normalizedPaid = paidItem ? normalizeLabExamPendingItem(paidItem) : null
  const payingAll = payload.kinds.length > 1
  submittingPayment.value = true
  submittingKind.value = payingAll ? null : (payload.kinds[0] ?? null)
  message.value = ''
  if (normalizedPaid) reservePrintWindow('80mm')
  try {
    const { data: res } = await api.post('/comptabilite', {
      action: 'pay_lab_exams',
      consultationId: payload.consultationId,
      kinds: payload.kinds,
      reductionsByKind: payload.reductionsByKind,
      reductionFcfa: payload.reductionFcfa,
      installmentAmountFcfa: payload.installmentAmountFcfa,
      installmentsByKind: payload.installmentsByKind,
    })
    const shouldClose =
      res.allKindsPaid ||
      remainingPayableExamKinds((res.remainingUnpaidKinds ?? []) as ExamKindSlug[]).length === 0
    if (shouldClose) closeEncaisser()
    if (normalizedPaid) {
      const printed = printLabExamPaymentReceipts(
        normalizedPaid,
        { kinds: payload.kinds, reductionsByKind: payload.reductionsByKind },
        res.invoicesByKind,
      )
      if (!printed) cancelPrintWindow()
    }
    const kindLabel = payingAll
      ? 'Tous les examens'
      : payload.kinds[0]
        ? EXAM_KIND_LABELS[payload.kinds[0]]
        : 'Opération'
    const installmentNote =
      Array.isArray(res.installmentKinds) && res.installmentKinds.length > 0
        ? ' Tranche enregistrée — solde restant à payer.'
        : ''
    message.value = `${kindLabel} encaissé.${installmentNote}`
    messageType.value = 'success'
    await load()
    if (!shouldClose) submittingKind.value = null
  } catch (error) {
    cancelPrintWindow()
    const shown = await showApiErrorModal(error, 'Erreur lors de l’encaissement.')
    if (!shown) {
      message.value = apiErrorText(error) ?? 'Erreur lors de l’encaissement.'
      messageType.value = 'error'
    }
    submittingKind.value = null
  } finally {
    submittingPayment.value = false
  }
}

function resetCustomRange() {
  filterFrom.value = ''
  filterTo.value = ''
}

const exportColumns: ExportColumn<OperationRow>[] = [
  { header: 'Date', value: (r) => `${r.dateLabel} ${r.timeLabel}` },
  { header: 'Patient', value: (r) => r.patientName },
  { header: 'Code', value: (r) => r.patientCode },
  { header: 'Type', value: (r) => SOURCE_LABELS[r.source] },
  { header: 'Intervention', value: (r) => r.intervention },
  { header: 'Chirurgien', value: (r) => r.surgeonName },
  {
    header: 'Opération',
    value: (r) => (r.source === 'other' ? '—' : r.completed ? 'Effectuée' : 'En attente'),
  },
  { header: 'Montant', value: (r) => formatFcfa(r.billedFcfa) },
  { header: 'Payé', value: (r) => formatFcfa(r.paidFcfa) },
  { header: 'Reste', value: (r) => formatFcfa(r.remainingFcfa) },
  { header: 'Statut', value: (r) => PAYMENT_LABELS[r.paymentState] },
  { header: 'Enregistré par', value: (r) => r.registeredBy },
  { header: 'Encaissé par', value: (r) => r.collectedBy || '—' },
]

function exportShared() {
  const receptionist = receptionistSummaries.value.find((r) => r.id === receptionistFilter.value)
  return {
    captionRows: [
      { label: 'Période', value: periodLabel.value },
      ...(receptionist ? [{ label: 'Réceptionniste', value: receptionist.name }] : []),
    ],
    totalsRows: [
      { label: 'Nombre d’opérations', value: String(displayedRows.value.length) },
      {
        label: 'Reste à payer',
        value: formatFcfa(displayedRows.value.reduce((sum, r) => sum + r.remainingFcfa, 0)),
      },
    ],
  }
}

const EXPORT_TITLE = 'Opérations (bloc et autres chirurgies)'

function exportPdf() {
  exportTablePdf(EXPORT_TITLE, exportColumns, displayedRows.value, exportShared())
}

function exportExcel() {
  exportTableExcel(EXPORT_TITLE, exportColumns, displayedRows.value, exportShared())
}

function exportWord() {
  void exportTableWord(EXPORT_TITLE, exportColumns, displayedRows.value, exportShared())
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
      />
      <UiAlert v-if="errorMessage" type="error" :message="errorMessage" />
      <UiAlert v-if="message && !paymentItem" :type="messageType" :message="message" />

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
          :label="`Payées (${stats.paidCount})`"
          :value="formatFcfa(stats.paidFcfa)"
          :icon="CheckCircle2"
          variant="green"
        />
        <UiStatCard
          mini
          :label="`Non soldées (${stats.unpaidCount})`"
          :value="formatFcfa(stats.remainingFcfa)"
          :icon="Clock"
          variant="violet"
        />
      </div>

      <div class="filter-bar" role="region" aria-label="Filtres">
        <div class="filter-bar__row">
          <div class="filter-bar__modes" role="tablist" aria-label="Période">
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
              {{ mode.label }}
            </button>
          </div>

          <div class="filter-bar__controls">
            <template v-if="dateFilterMode === 'day'">
              <label class="filter-bar__field">
                <span class="filter-bar__field-label">Date</span>
                <input v-model="filterDay" type="date" class="filter-bar__input" />
              </label>
              <div class="filter-bar__quick">
                <button type="button" class="filter-bar__chip" @click="filterDay = todayDateKey()">Aujourd'hui</button>
                <button type="button" class="filter-bar__chip" @click="filterDay = yesterdayDateKey()">Hier</button>
              </div>
            </template>

            <template v-else-if="dateFilterMode === 'month'">
              <label class="filter-bar__field">
                <span class="filter-bar__field-label">Mois</span>
                <input v-model="filterMonth" type="month" class="filter-bar__input" />
              </label>
            </template>

            <template v-else-if="dateFilterMode === 'custom'">
              <label class="filter-bar__field">
                <span class="filter-bar__field-label">Du</span>
                <input v-model="filterFrom" type="date" class="filter-bar__input" />
              </label>
              <span class="filter-bar__sep" aria-hidden="true">→</span>
              <label class="filter-bar__field">
                <span class="filter-bar__field-label">Au</span>
                <input v-model="filterTo" type="date" class="filter-bar__input" />
              </label>
              <button type="button" class="filter-bar__chip filter-bar__chip--muted" @click="resetCustomRange">
                Effacer
              </button>
            </template>

            <label v-if="canSeeAllReceptionists" class="filter-bar__field">
              <span class="filter-bar__field-label">Réceptionniste</span>
              <select v-model="receptionistFilter" class="filter-bar__input">
                <option value="">Tous les réceptionnistes</option>
                <option v-for="r in receptionistSummaries" :key="r.id" :value="r.id">{{ r.name }}</option>
              </select>
            </label>

            <label class="filter-bar__field">
              <span class="filter-bar__field-label">Type</span>
              <select v-model="sourceFilter" class="filter-bar__input">
                <option v-for="f in SOURCE_FILTERS" :key="f.id" :value="f.id">{{ f.label }}</option>
              </select>
            </label>

            <label class="filter-bar__field">
              <span class="filter-bar__field-label">Paiement</span>
              <select v-model="paymentFilter" class="filter-bar__input">
                <option v-for="f in PAYMENT_FILTERS" :key="f.id" :value="f.id">{{ f.label }}</option>
              </select>
            </label>
          </div>
        </div>

        <div class="filter-bar__footer">
          <CalendarRange :size="15" class="filter-bar__footer-icon" />
          <span class="filter-bar__period">{{ periodLabel }}</span>
          <span aria-hidden="true">·</span>
          <span class="filter-bar__count">{{ displayedRows.length }} opération(s) affichée(s)</span>
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
              placeholder="Patient, intervention, utilisateur…"
              aria-label="Rechercher une opération"
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
            Chargement des opérations…
          </div>

          <div class="simple-table-scroll">
            <p v-if="!loading && !displayedRows.length" class="simple-table__empty">
              {{
                (surgeries.length || otherOperations.length) && !periodRows.length
                  ? 'Aucune opération sur cette période — élargissez le filtre.'
                  : 'Aucune opération trouvée'
              }}
            </p>
            <div v-else class="simple-table-wrap">
              <table class="simple-table">
                <thead>
                  <tr>
                    <th class="simple-table__num">#</th>
                    <th>Date</th>
                    <th>Patient</th>
                    <th>Intervention</th>
                    <th>Montant</th>
                    <th>Paiement</th>
                    <th>Enregistré par</th>
                    <th class="simple-table__actions-head">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(row, index) in displayedRows" :key="row.id">
                    <td class="simple-table__num">{{ index + 1 }}</td>
                    <td>
                      <span class="st-date">{{ row.dateLabel }}</span>
                      <span class="st-sub">{{ row.timeLabel }}</span>
                      <template v-if="row.source === 'bloc'">
                        <span v-if="row.completed" class="st-badge st-badge--success">Effectuée</span>
                        <span v-else class="st-badge st-badge--info">En attente d'opération</span>
                      </template>
                    </td>
                    <td>
                      <span class="st-name">{{ row.patientName }}</span>
                      <span class="st-sub">{{ row.patientCode }}</span>
                    </td>
                    <td>
                      <span class="st-name">{{ row.intervention }}</span>
                      <span class="st-sub">{{ row.surgeonName }}</span>
                      <span
                        class="st-badge"
                        :class="row.source === 'bloc' ? 'st-badge--info' : 'st-badge--warning'"
                      >
                        {{ SOURCE_LABELS[row.source] }}
                      </span>
                    </td>
                    <td>
                      <span class="st-amount">{{ formatFcfa(row.billedFcfa) }}</span>
                      <span v-if="row.paidFcfa > 0 && row.remainingFcfa > 0" class="st-sub">
                        Payé {{ formatFcfa(row.paidFcfa) }} · Reste {{ formatFcfa(row.remainingFcfa) }}
                      </span>
                    </td>
                    <td>
                      <span class="st-badge" :class="`st-badge--${PAYMENT_VARIANTS[row.paymentState]}`">
                        {{ PAYMENT_LABELS[row.paymentState] }}
                      </span>
                    </td>
                    <td>
                      <span class="st-name">{{ row.registeredBy }}</span>
                      <span v-if="row.collectedBy" class="st-sub">Encaissé par {{ row.collectedBy }}</span>
                    </td>
                    <td class="simple-table__actions">
                      <button
                        v-if="row.remainingFcfa > 0"
                        type="button"
                        class="st-btn st-btn--pay st-btn--labeled"
                        :disabled="!!actionId || submittingPayment"
                        @click="openEncaisser(row)"
                      >
                        <Banknote :size="15" />
                        {{ actionId === row.id ? 'Ouverture…' : 'Encaisser' }}
                      </button>
                      <span v-else class="st-muted">—</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </UiCard>
    </section>

    <LabExamPaymentModal
      :item="paymentItem"
      :submitting="submittingPayment"
      :submitting-kind="submittingKind"
      @close="closeEncaisser"
      @confirm="confirmEncaisser"
    />
  </div>
</template>

<style scoped>
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
</style>
