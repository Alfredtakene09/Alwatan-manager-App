<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { Component } from 'vue'
import { Wallet, RefreshCw, CircleDollarSign, Percent, CalendarRange, CalendarDays, Calendar } from '@lucide/vue'
import api from '@/api/client'
import { formatFcfa, fullName } from '@/lib/roles'
import { computeConsultationAmounts } from '@/lib/consultation-amounts'
import { sortByCreatedAtNewestFirst } from '@/lib/patient-sort'
import {
  currentMonthKey,
  formatPeriodLabel,
  matchesDateFilter,
  todayDateKey,
  yesterdayDateKey,
  type DateFilterMode,
} from '@/lib/date-filters'
import { DT_ICONS } from '@/lib/datatable-defaults'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import UiStatCard from '@/components/ui/UiStatCard.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiDataTable from '@/components/ui/UiDataTable.vue'

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
  patient: { code: string; firstName: string; lastName: string }
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
const dateFilterMode = ref<DateFilterMode>('day')
const filterDay = ref(todayDateKey())
const filterMonth = ref(currentMonthKey())
const filterFrom = ref('')
const filterTo = ref('')

const filteredRows = computed(() =>
  rows.value.filter((row) =>
    matchesDateFilter(
      row.createdAt,
      dateFilterMode.value,
      filterDay.value,
      filterMonth.value,
      filterFrom.value,
      filterTo.value,
    ),
  ),
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
  return {
    count: data.length,
    totalNet: data.reduce((sum, r) => sum + r.totalFcfa, 0),
    totalReduction: data.reduce((sum, r) => sum + r.reductionFcfa, 0),
    reductionCount: withReduction.length,
  }
})

const tableData = computed(() =>
  sortByCreatedAtNewestFirst(filteredRows.value).map((row) => {
    const amounts = computeConsultationAmounts(
      row.consultationFeeFcfa,
      row.reductionFcfa,
      row.totalFcfa,
    )
    return {
      id: row.invoiceId ?? row.visitId,
      invoiceId: row.invoiceId,
      invoiceNumber: row.invoiceNumber ?? '—',
      patientName: fullName(row.patient.firstName, row.patient.lastName),
      patientCode: row.patient.code,
      doctorName: row.doctor ? `Dr ${fullName(row.doctor.firstName, row.doctor.lastName)}` : '—',
      fee: formatFcfa(amounts.consultationFeeFcfa),
      feeSort: amounts.consultationFeeFcfa,
      reduction: amounts.reductionFcfa > 0 ? formatFcfa(amounts.reductionFcfa) : '—',
      reductionSort: amounts.reductionFcfa,
      total: formatFcfa(amounts.totalFcfa),
      totalSort: amounts.totalFcfa,
      date: new Date(row.createdAt).toLocaleDateString('fr-FR'),
      dateSort: new Date(row.createdAt).getTime(),
    }
  }),
)

const columns = [
  {
    data: 'invoiceNumber',
    title: 'N° Facture',
    responsivePriority: 1,
    render: (n: string) => `<strong class="dt-name">${n}</strong>`,
  },
  {
    data: 'patientName',
    title: 'Patient',
    responsivePriority: 2,
    render: (name: string, _t: string, row: { patientCode: string }) =>
      `<span class="dt-name">${name}</span><span class="dt-sub">${row.patientCode}</span>`,
  },
  { data: 'doctorName', title: 'Médecin', responsivePriority: 5 },
  {
    data: 'feeSort',
    title: 'Montant',
    responsivePriority: 3,
    render: (_d: number, _t: string, row: { fee: string }) =>
      `<span class="dt-amount">${row.fee}</span>`,
  },
  {
    data: 'reductionSort',
    title: 'Réduction',
    responsivePriority: 6,
    render: (_d: number, _t: string, row: { reduction: string }) => row.reduction,
  },
  {
    data: 'totalSort',
    title: 'Net',
    responsivePriority: 3,
    render: (_d: number, _t: string, row: { total: string }) =>
      `<strong class="dt-amount">${row.total}</strong>`,
  },
  {
    data: 'dateSort',
    title: 'Date',
    responsivePriority: 6,
    render: (_d: number, _t: string, row: { date: string }) =>
      `<span class="dt-date">${row.date}</span>`,
  },
  {
    data: null,
    title: '',
    orderable: false,
    className: 'dt-actions-col',
    responsivePriority: 1,
    render: (_d: unknown, _t: string, row: { invoiceId: string | null; id: string }) =>
      row.invoiceId
        ? `<div class="dt-row-actions" data-id="${row.invoiceId}">
            <button type="button" class="dt-btn dt-btn--text" data-action="pdf" title="Imprimer" aria-label="PDF">
              ${DT_ICONS.download} PDF
            </button>
          </div>`
        : '',
  },
]

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

function downloadPdf(id: string) {
  window.open(`/api/factures/${id}/pdf`, '_blank')
}

function onAction({ action, id }: { action: string; id: string }) {
  if (action === 'pdf') downloadPdf(id)
}

onMounted(load)
</script>

<template>
  <div class="page-with-table">
    <section class="page-with-table__head">
      <UiPageHeader :title="title" :subtitle="subtitle" :icon="icon" />

      <div class="stats-grid">
        <UiStatCard mini label="Montant net" :value="formatFcfa(stats.totalNet)" :icon="CircleDollarSign" variant="teal" />
        <UiStatCard mini label="Réduction" :value="formatFcfa(stats.totalReduction)" :icon="Percent" variant="amber" />
      </div>

      <div class="filter-bar" role="region" aria-label="Filtrer par date">
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
      <UiCard :title="cardTitle" class="ui-card--table-panel" :icon="icon" icon-variant="teal">
        <template #actions>
          <UiButton variant="ghost" size="sm" :icon="RefreshCw" :disabled="loading" @click="load">
            Actualiser
          </UiButton>
        </template>
        <UiDataTable
          :table-key="tableKey"
          fill
          compact
          :data="tableData"
          :columns="columns"
          :loading="loading"
          @action="onAction"
        />
      </UiCard>
    </section>
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
