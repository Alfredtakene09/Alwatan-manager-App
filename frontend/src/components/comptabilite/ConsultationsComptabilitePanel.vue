<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { Component } from 'vue'
import {
  Wallet,
  RefreshCw,
  CircleDollarSign,
  Percent,
  CalendarRange,
  CalendarDays,
  Calendar,
  Printer,
  Banknote,
} from '@lucide/vue'
import api from '@/api/client'
import { formatFcfa, fullName } from '@/lib/roles'
import { computeConsultationAmounts } from '@/lib/consultation-amounts'
import { sortByCreatedAtNewestFirst } from '@/lib/patient-sort'
import { buildConsultationReceiptHtml, openPrintDocument } from '@/lib/print-document'
import { translateTemplate } from '@/lib/dashboard-i18n'
import { useAuthStore } from '@/stores/auth'
import {
  currentMonthKey,
  formatPeriodLabel,
  matchesDateFilter,
  todayDateKey,
  yesterdayDateKey,
  type DateFilterMode,
} from '@/lib/date-filters'
import { showApiErrorModal, showSuccessModal } from '@/lib/api-modal-helper'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import UiStatCard from '@/components/ui/UiStatCard.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiFormModal from '@/components/ui/UiFormModal.vue'
import UiInput from '@/components/ui/UiInput.vue'
import '@/assets/simple-table.css'

const props = withDefaults(
  defineProps<{
    title: string
    subtitle: string
    icon?: Component
    tableKey?: string
    cardTitle?: string
  }>(),
  {
    icon: () => Wallet,
    tableKey: 'consultations-comptabilite',
    cardTitle: 'Montants de consultation',
  },
)

type ConsultationRow = {
  visitId: string
  patient: { code: string; firstName: string; lastName: string; service?: string | null }
  doctor: { firstName: string; lastName: string } | null
  consultationFeeFcfa: number
  reductionFcfa: number
  totalFcfa: number
  invoiceId: string | null
  invoiceNumber: string | null
  invoiceStatus: string | null
  visitStatus: string
  createdAt: string
}

const DATE_MODES: { id: DateFilterMode; label: string; icon: typeof CalendarDays }[] = [
  { id: 'day', label: 'Jour', icon: CalendarDays },
  { id: 'month', label: 'Mois', icon: Calendar },
  { id: 'custom', label: 'Personnaliser', icon: CalendarRange },
]

const rows = ref<ConsultationRow[]>([])
const loading = ref(false)
const payingId = ref<string | null>(null)
const payModalRow = ref<ConsultationRow | null>(null)
const payReductionFcfa = ref(0)
const statusFilter = ref<'ALL' | 'PENDING' | 'PAID'>('PENDING')
const dateFilterMode = ref<DateFilterMode>('day')
const filterDay = ref(todayDateKey())
const filterMonth = ref(currentMonthKey())
const filterFrom = ref('')
const filterTo = ref('')
const auth = useAuthStore()

function collectorName() {
  return auth.user ? fullName(auth.user.firstName, auth.user.lastName) : undefined
}

function printConsultationReceipt(row: ConsultationRow, overrides?: { reductionFcfa?: number; netFcfa?: number }) {
  const fee = Math.max(0, row.consultationFeeFcfa || row.totalFcfa + (row.reductionFcfa || 0))
  const reduction = Math.max(0, overrides?.reductionFcfa ?? row.reductionFcfa ?? 0)
  const net = Math.max(0, overrides?.netFcfa ?? row.totalFcfa ?? fee - reduction)
  const doctorName = row.doctor
    ? `Dr ${fullName(row.doctor.firstName, row.doctor.lastName)}`
    : '—'
  openPrintDocument(
    translateTemplate('Reçu {code}', { code: row.patient.code }),
    buildConsultationReceiptHtml({
      patientCode: row.patient.code,
      patientName: fullName(row.patient.firstName, row.patient.lastName),
      doctorName,
      amount: fee,
      reduction,
      total: net,
      invoiceNumber: row.invoiceNumber ?? undefined,
      date: new Date().toLocaleString('fr-FR'),
      processedBy: collectorName(),
    }),
    { pageSize: '80mm', autoPrint: true },
  )
}

const payModalAmounts = computed(() => {
  const row = payModalRow.value
  if (!row) return null
  const fee = Math.max(0, row.consultationFeeFcfa || row.totalFcfa + (row.reductionFcfa || 0))
  const reduction = Math.min(fee, Math.max(0, Math.floor(Number(payReductionFcfa.value) || 0)))
  return {
    fee,
    reduction,
    net: Math.max(0, fee - reduction),
  }
})

const filteredRows = computed(() =>
  rows.value.filter((row) => {
    if (!matchesDateFilter(
      row.createdAt,
      dateFilterMode.value,
      filterDay.value,
      filterMonth.value,
      filterFrom.value,
      filterTo.value,
    )) {
      return false
    }
    if (statusFilter.value === 'PENDING') {
      return row.invoiceStatus === 'PENDING' || row.invoiceStatus === 'PARTIALLY_PAID'
    }
    if (statusFilter.value === 'PAID') {
      return row.invoiceStatus === 'PAID'
    }
    return true
  }),
)

const periodLabel = computed(() =>
  formatPeriodLabel(
    dateFilterMode.value,
    filterDay.value,
    filterMonth.value,
    filterFrom.value,
    filterTo.value,
  ),
)

const stats = computed(() => {
  const data = filteredRows.value
  const withReduction = data.filter((r) => r.reductionFcfa > 0)
  const pending = data.filter(
    (r) => r.invoiceStatus === 'PENDING' || r.invoiceStatus === 'PARTIALLY_PAID',
  )
  return {
    count: data.length,
    totalNet: data.reduce((sum, r) => sum + r.totalFcfa, 0),
    totalReduction: data.reduce((sum, r) => sum + r.reductionFcfa, 0),
    reductionCount: withReduction.length,
    pendingCount: pending.length,
    pendingFcfa: pending.reduce((sum, r) => sum + r.totalFcfa, 0),
  }
})

const tableData = computed(() =>
  sortByCreatedAtNewestFirst(filteredRows.value).map((row) => {
    const amounts = computeConsultationAmounts(
      row.consultationFeeFcfa,
      row.reductionFcfa,
      row.totalFcfa,
    )
    const payable =
      Boolean(row.invoiceId) &&
      (row.invoiceStatus === 'PENDING' || row.invoiceStatus === 'PARTIALLY_PAID')
    const paid = row.invoiceStatus === 'PAID' || row.invoiceStatus === 'PARTIALLY_PAID'
    return {
      id: row.invoiceId ?? row.visitId,
      invoiceId: row.invoiceId,
      visitId: row.visitId,
      invoiceNumber: row.invoiceNumber ?? '—',
      invoiceStatus: row.invoiceStatus,
      payable,
      paid,
      patientName: fullName(row.patient.firstName, row.patient.lastName),
      patientCode: row.patient.code,
      patientService: row.patient.service?.trim() || '—',
      doctorName: row.doctor ? `Dr ${fullName(row.doctor.firstName, row.doctor.lastName)}` : '—',
      fee: formatFcfa(amounts.consultationFeeFcfa),
      feeSort: amounts.consultationFeeFcfa,
      reduction: amounts.reductionFcfa > 0 ? formatFcfa(amounts.reductionFcfa) : '—',
      reductionSort: amounts.reductionFcfa,
      total: formatFcfa(amounts.totalFcfa),
      totalSort: amounts.totalFcfa,
      date: new Date(row.createdAt).toLocaleDateString('fr-FR'),
      dateSort: new Date(row.createdAt).getTime(),
      statusLabel:
        row.invoiceStatus === 'PAID'
          ? 'Payée'
          : row.invoiceStatus === 'PARTIALLY_PAID'
            ? 'Partielle'
            : row.invoiceStatus === 'PENDING'
              ? 'À encaisser'
              : '—',
    }
  }),
)

function setToday() {
  filterDay.value = todayDateKey()
}

function setYesterday() {
  filterDay.value = yesterdayDateKey()
}

function resetCustomRange() {
  filterFrom.value = ''
  filterTo.value = ''
}

async function load() {
  loading.value = true
  try {
    const { data } = await api.get('/visits/consultations-comptabilite')
    rows.value = data
  } finally {
    loading.value = false
  }
}

function reprintConsultation(visitId: string) {
  const row = rows.value.find((r) => r.visitId === visitId)
  if (!row) return
  printConsultationReceipt(row)
}

function openPayModal(invoiceId: string) {
  const row = rows.value.find((r) => r.invoiceId === invoiceId)
  if (!row?.invoiceId) return
  if (row.invoiceStatus === 'PARTIALLY_PAID') {
    void collectConsultation(row.invoiceId)
    return
  }
  payModalRow.value = row
  payReductionFcfa.value = Math.max(0, row.reductionFcfa || 0)
}

function closePayModal() {
  if (payingId.value) return
  payModalRow.value = null
  payReductionFcfa.value = 0
}

async function collectConsultation(invoiceId: string, reductionFcfa?: number) {
  if (payingId.value) return
  payingId.value = invoiceId
  try {
    const payload: {
      action: string
      invoiceId: string
      reductionFcfa?: number
    } = {
      action: 'pay_consultation',
      invoiceId,
    }
    if (reductionFcfa != null) {
      payload.reductionFcfa = Math.max(0, Math.floor(reductionFcfa))
    }
    const { data } = await api.post<{
      amountFcfa: number
      reductionFcfa?: number
      invoiceNumber?: string
    }>('/comptabilite', payload)
    const sourceRow = rows.value.find((r) => r.invoiceId === invoiceId)
    if (sourceRow) {
      printConsultationReceipt(sourceRow, {
        reductionFcfa: data.reductionFcfa ?? sourceRow.reductionFcfa,
        netFcfa: data.amountFcfa,
      })
    }
    const reductionNote =
      data.reductionFcfa && data.reductionFcfa > 0
        ? ` (réduction ${formatFcfa(data.reductionFcfa)})`
        : ''
    await showSuccessModal(
      'Consultation encaissée',
      `Montant : ${formatFcfa(data.amountFcfa)}${reductionNote}${data.invoiceNumber ? ` — ${data.invoiceNumber}` : ''}`,
    )
    payModalRow.value = null
    payReductionFcfa.value = 0
    await load()
  } catch (error) {
    await showApiErrorModal(error, "Impossible d'encaisser cette consultation.")
  } finally {
    payingId.value = null
  }
}

async function confirmPayModal() {
  const row = payModalRow.value
  const amounts = payModalAmounts.value
  if (!row?.invoiceId || !amounts || amounts.net <= 0) return
  await collectConsultation(row.invoiceId, amounts.reduction)
}

onMounted(load)
</script>

<template>
  <div class="page-with-table">
    <section class="page-with-table__head">
      <UiPageHeader :title="title" :subtitle="subtitle" :icon="icon" />

      <div class="stats-grid">
        <UiStatCard mini label="Montant net" :value="formatFcfa(stats.totalNet)" :icon="CircleDollarSign" variant="teal" />
        <UiStatCard mini label="À encaisser" :value="formatFcfa(stats.pendingFcfa)" :icon="Banknote" variant="amber" />
        <UiStatCard mini label="Réduction" :value="formatFcfa(stats.totalReduction)" :icon="Percent" variant="blue" />
      </div>

      <div class="filter-bar" role="region" aria-label="Filtrer par date">
        <div class="filter-bar__row">
          <div class="filter-bar__modes" role="tablist" aria-label="Statut">
            <button
              type="button"
              role="tab"
              class="filter-bar__mode"
              :class="{ 'filter-bar__mode--active': statusFilter === 'PENDING' }"
              :aria-selected="statusFilter === 'PENDING'"
              @click="statusFilter = 'PENDING'"
            >
              À encaisser
            </button>
            <button
              type="button"
              role="tab"
              class="filter-bar__mode"
              :class="{ 'filter-bar__mode--active': statusFilter === 'PAID' }"
              :aria-selected="statusFilter === 'PAID'"
              @click="statusFilter = 'PAID'"
            >
              Payées
            </button>
            <button
              type="button"
              role="tab"
              class="filter-bar__mode"
              :class="{ 'filter-bar__mode--active': statusFilter === 'ALL' }"
              :aria-selected="statusFilter === 'ALL'"
              @click="statusFilter = 'ALL'"
            >
              Toutes
            </button>
          </div>
        </div>
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
                <button type="button" class="filter-bar__chip" @click="setToday">Aujourd'hui</button>
                <button type="button" class="filter-bar__chip" @click="setYesterday">Hier</button>
              </div>
            </template>

            <template v-else-if="dateFilterMode === 'month'">
              <label class="filter-bar__field">
                <span class="filter-bar__field-label">Mois</span>
                <input v-model="filterMonth" type="month" class="filter-bar__input" />
              </label>
            </template>

            <template v-else>
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
          </div>
        </div>

        <div class="filter-bar__footer">
          <CalendarRange :size="15" class="filter-bar__footer-icon" />
          <span class="filter-bar__period">{{ periodLabel }}</span>
          <span class="filter-bar__dot" aria-hidden="true">·</span>
          <span class="filter-bar__count">{{ stats.count }} résultat(s)</span>
        </div>
      </div>
    </section>

    <section class="page-with-table__body">
      <UiCard direct :title="cardTitle" class="ui-card--table-panel" :icon="icon" icon-variant="teal">
        <template #actions>
          <UiButton variant="ghost" size="sm" :icon="RefreshCw" :disabled="loading" @click="load">
            Actualiser
          </UiButton>
        </template>
        <div class="simple-table-shell simple-table-shell--fill">
          <div
            v-if="loading"
            class="simple-table-overlay"
            role="status"
            aria-live="polite"
          >
            <span class="simple-table-spinner" aria-hidden="true" />
            Chargement…
          </div>
          <div class="simple-table-scroll">
            <div class="simple-table-wrap">
              <table class="simple-table">
                <thead>
                  <tr>
                    <th class="simple-table__num">#</th>
                    <th>N° Facture</th>
                    <th>Patient</th>
                    <th>Médecin</th>
                    <th>Montant</th>
                    <th>Réduction</th>
                    <th>Net</th>
                    <th>Statut</th>
                    <th>Date</th>
                    <th class="simple-table__actions-head">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(row, index) in tableData" :key="row.id">
                    <td class="simple-table__num">{{ index + 1 }}</td>
                    <td><strong class="st-name">{{ row.invoiceNumber }}</strong></td>
                    <td>
                      <span class="st-name">{{ row.patientName }}</span>
                      <span class="st-sub">{{ row.patientCode }}</span>
                      <span class="st-sub">{{ row.patientService }}</span>
                    </td>
                    <td>{{ row.doctorName }}</td>
                    <td><span class="st-amount">{{ row.fee }}</span></td>
                    <td>{{ row.reduction }}</td>
                    <td><strong class="st-amount">{{ row.total }}</strong></td>
                    <td>{{ row.statusLabel }}</td>
                    <td><span class="st-date">{{ row.date }}</span></td>
                    <td class="simple-table__actions">
                      <div v-if="row.invoiceId" class="st-actions">
                        <button
                          v-if="row.payable"
                          type="button"
                          class="st-btn st-btn--text"
                          title="Encaisser"
                          :disabled="payingId === row.invoiceId"
                          @click="openPayModal(row.invoiceId!)"
                        >
                          <Banknote :size="15" />
                          {{ payingId === row.invoiceId ? '…' : 'Encaisser' }}
                        </button>
                        <button
                          v-if="row.paid"
                          type="button"
                          class="st-btn st-btn--text"
                          title="Imprimer le reçu"
                          aria-label="Imprimer le reçu"
                          @click="reprintConsultation(row.visitId)"
                        >
                          <Printer :size="15" />
                          Reçu
                        </button>
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
      v-if="payModalRow"
      title="Encaisser la consultation"
      :subtitle="`${fullName(payModalRow.patient.firstName, payModalRow.patient.lastName)} — ${payModalRow.invoiceNumber ?? ''}`"
      :icon="Banknote"
      @close="closePayModal"
    >
      <div v-if="payModalAmounts" class="pay-modal">
        <div class="pay-modal__summary">
          <div class="pay-modal__line">
            <span>Prix consultation</span>
            <strong>{{ formatFcfa(payModalAmounts.fee) }}</strong>
          </div>
          <div class="pay-modal__line pay-modal__line--net">
            <span>Net à encaisser</span>
            <strong>{{ formatFcfa(payModalAmounts.net) }}</strong>
          </div>
        </div>
        <UiInput
          v-model="payReductionFcfa"
          label="Réduction (FCFA)"
          type="number"
          placeholder="0"
        />
        <p class="pay-modal__hint">
          Le gestionnaire peut appliquer une réduction avant l’encaissement.
        </p>
      </div>
      <template #footer>
        <UiButton variant="ghost" :disabled="Boolean(payingId)" @click="closePayModal">
          Annuler
        </UiButton>
        <UiButton
          variant="primary"
          :icon="Banknote"
          :disabled="Boolean(payingId) || !payModalAmounts || payModalAmounts.net <= 0"
          @click="confirmPayModal"
        >
          {{ payingId ? 'Encaissement…' : 'Confirmer l’encaissement' }}
        </UiButton>
      </template>
    </UiFormModal>
  </div>
</template>

<style scoped>
.pay-modal {
  display: grid;
  gap: 0.85rem;
}

.pay-modal__summary {
  display: grid;
  gap: 0.45rem;
  padding: 0.75rem 0.85rem;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: #f8fafc;
}

.pay-modal__line {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  font-size: 0.875rem;
  color: var(--text-muted);
}

.pay-modal__line strong {
  color: var(--text);
  font-variant-numeric: tabular-nums;
}

.pay-modal__line--net {
  padding-top: 0.35rem;
  border-top: 1px dashed var(--border);
  color: var(--text);
  font-weight: 600;
}

.pay-modal__line--net strong {
  color: var(--primary, #0f766e);
  font-size: 1rem;
}

.pay-modal__hint {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--text-muted);
}

.filter-bar {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0.45rem 0.65rem;
  box-shadow: var(--shadow-sm);
  margin-top: 0.35rem;
  margin-bottom: 1.25rem;
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

</style>
