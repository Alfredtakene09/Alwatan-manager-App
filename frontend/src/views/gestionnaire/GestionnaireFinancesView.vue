<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { TrendingUp, Wallet } from '@lucide/vue'
import api from '@/api/client'
import { formatFcfa } from '@/lib/roles'
import type { BreakdownItem, FinancialKpis, MonthlyTrendPoint, TrendFilter } from '@/lib/admin-dashboard'
import { filterTrend } from '@/lib/admin-dashboard'
import {
  buildClinicPrintHeader,
  openPrintDocument,
} from '@/lib/print-document'
import {
  exportBasename,
  exportWorkbook,
  rowsToHtmlTable,
  type ExportColumn,
} from '@/lib/table-export'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiStatCard from '@/components/ui/UiStatCard.vue'
import ExportButtons from '@/components/ui/ExportButtons.vue'
import DashboardLineChart from '@/components/dashboard/DashboardLineChart.vue'
import DashboardDonutChart from '@/components/dashboard/DashboardDonutChart.vue'
import { Banknote, TrendingDown, Users } from '@lucide/vue'
import '@/assets/gestionnaire-page.css'

type FinancesResponse = {
  financialKpis: FinancialKpis
  monthlyTrend: MonthlyTrendPoint[]
  revenueBreakdown: BreakdownItem[]
  expenseBreakdown: BreakdownItem[]
}

const data = ref<FinancesResponse | null>(null)
const loading = ref(false)
const trendFilter = ref<TrendFilter>('year')

const REVENUE_COLORS: Record<string, string> = {
  consultations: '#2563eb',
  examens: '#0d9488',
  operations: '#d97706',
  hospitalisation: '#7c3aed',
  autres: '#64748b',
}

async function loadFinances() {
  loading.value = true
  try {
    const { data: response } = await api.get<FinancesResponse>('/gestionnaire/finances')
    data.value = response
  } finally {
    loading.value = false
  }
}

const filteredTrend = computed(() => {
  if (!data.value) return []
  return filterTrend(data.value.monthlyTrend, trendFilter.value)
})

const lineChartLabels = computed(() => filteredTrend.value.map((row) => row.label))
const lineChartSeries = computed(() => {
  const points = filteredTrend.value
  return [
    {
      key: 'revenue',
      label: 'Recettes',
      color: '#16a34a',
      values: points.map((row) => row.revenueFcfa),
    },
    {
      key: 'expenses',
      label: 'Dépenses',
      color: '#e11d48',
      values: points.map((row) => row.expensesFcfa),
    },
    {
      key: 'net',
      label: 'Bénéfice net',
      color: '#2563eb',
      values: points.map((row) => row.netFcfa),
    },
  ]
})

const revenueDonut = computed(() =>
  (data.value?.revenueBreakdown ?? []).map((row) => ({
    ...row,
    percent: row.percent ?? 0,
    color: REVENUE_COLORS[row.key] ?? '#64748b',
  })),
)

const EXPENSE_COLORS: Record<string, string> = {
  salaires: '#7c3aed',
  fournitures: '#2563eb',
  equipements: '#d97706',
  maintenance: '#0d9488',
  autres: '#64748b',
}

const expenseDonut = computed(() =>
  (data.value?.expenseBreakdown ?? []).map((row) => ({
    ...row,
    percent: row.percent ?? 0,
    color: EXPENSE_COLORS[row.key] ?? '#64748b',
  })),
)

const k = computed(() => data.value?.financialKpis)

const kpiRows = computed(() => {
  if (!k.value) return []
  return [
    { label: 'Recettes', value: formatFcfa(k.value.revenueMonthFcfa) },
    { label: 'Dépenses', value: formatFcfa(k.value.expensesMonthFcfa) },
    { label: 'Bénéfice net', value: formatFcfa(k.value.netMonthFcfa) },
    { label: 'Masse salariale', value: formatFcfa(k.value.payrollMonthFcfa) },
  ]
})

const kpiColumns: ExportColumn<(typeof kpiRows.value)[number]>[] = [
  { header: 'Indicateur', value: (r) => r.label },
  { header: 'Valeur', value: (r) => r.value },
]

const trendColumns: ExportColumn<MonthlyTrendPoint>[] = [
  { header: 'Période', value: (r) => r.label },
  { header: 'Recettes', value: (r) => formatFcfa(r.revenueFcfa) },
  { header: 'Dépenses', value: (r) => formatFcfa(r.expensesFcfa) },
  { header: 'Bénéfice net', value: (r) => formatFcfa(r.netFcfa) },
]

const breakdownColumns: ExportColumn<BreakdownItem>[] = [
  { header: 'Libellé', value: (r) => r.label },
  { header: 'Montant', value: (r) => formatFcfa(r.amountFcfa) },
  { header: 'Part', value: (r) => (r.percent != null ? `${r.percent} %` : '—') },
]

function exportPdf() {
  if (!data.value || !k.value) return
  const body = `${buildClinicPrintHeader('Finances clinique')}
${rowsToHtmlTable(kpiColumns, kpiRows.value)}
<h3>Évolution mensuelle</h3>
${rowsToHtmlTable(trendColumns, filteredTrend.value)}
<h3>Répartition des recettes</h3>
${rowsToHtmlTable(breakdownColumns, data.value.revenueBreakdown)}
<h3>Répartition des dépenses</h3>
${rowsToHtmlTable(breakdownColumns, data.value.expenseBreakdown)}`
  openPrintDocument('Finances clinique', body, { pageSize: 'A4', autoPrint: true })
}

function exportExcel() {
  if (!data.value || !k.value) return
  exportWorkbook(exportBasename('finances-clinique'), [
    { name: 'KPI', columns: kpiColumns, rows: kpiRows.value },
    { name: 'Tendance', columns: trendColumns, rows: filteredTrend.value },
    { name: 'Recettes', columns: breakdownColumns, rows: data.value.revenueBreakdown },
    { name: 'Dépenses', columns: breakdownColumns, rows: data.value.expenseBreakdown },
  ])
}

onMounted(loadFinances)
</script>

<template>
  <div class="gestionnaire-page">
    <div class="finances-head">
      <UiPageHeader
        title="Finances"
        subtitle="Recettes, dépenses et tendances"
        :icon="TrendingUp"
      />
      <ExportButtons :disabled="loading || !k" @pdf="exportPdf" @excel="exportExcel" />
    </div>

    <div v-if="loading" class="chart-empty">Chargement…</div>
    <template v-else-if="k">
      <div class="stats-grid kpi-grid">
        <UiStatCard mini label="Recettes" :value="formatFcfa(k.revenueMonthFcfa)" :icon="Banknote" variant="green" />
        <UiStatCard mini label="Dépenses" :value="formatFcfa(k.expensesMonthFcfa)" :icon="TrendingDown" variant="rose" />
        <UiStatCard mini label="Bénéfice net" :value="formatFcfa(k.netMonthFcfa)" :icon="TrendingUp" variant="blue" />
        <UiStatCard mini label="Masse salariale" :value="formatFcfa(k.payrollMonthFcfa)" :icon="Users" variant="amber" />
      </div>

      <section class="charts-grid">
        <UiCard
          title="Évolution mensuelle"
          description="Recettes, dépenses et bénéfice net"
          :icon="TrendingUp"
          icon-variant="amber"
        >
          <div class="filters">
            <button
              type="button"
              class="filter-btn"
              :class="{ 'filter-btn--active': trendFilter === 'month' }"
              @click="trendFilter = 'month'"
            >
              Mois
            </button>
            <button
              type="button"
              class="filter-btn"
              :class="{ 'filter-btn--active': trendFilter === 'quarter' }"
              @click="trendFilter = 'quarter'"
            >
              Trimestre
            </button>
            <button
              type="button"
              class="filter-btn"
              :class="{ 'filter-btn--active': trendFilter === 'year' }"
              @click="trendFilter = 'year'"
            >
              Année
            </button>
          </div>
          <DashboardLineChart
            :labels="lineChartLabels"
            :series="lineChartSeries"
            :format-value="formatFcfa"
            :loading="loading"
          />
        </UiCard>

        <UiCard
          title="Répartition des recettes"
          description="Sources de revenus du mois"
          :icon="Wallet"
          icon-variant="amber"
        >
          <DashboardDonutChart
            :slices="revenueDonut"
            :format-value="formatFcfa"
            empty-label="Aucune recette ce mois"
          />
        </UiCard>

        <UiCard
          title="Répartition des dépenses"
          description="Charges du mois en cours"
          :icon="Wallet"
          icon-variant="rose"
        >
          <DashboardDonutChart
            :slices="expenseDonut"
            :format-value="formatFcfa"
            empty-label="Aucune dépense ce mois"
          />
        </UiCard>
      </section>
    </template>
  </div>
</template>

<style scoped>
.finances-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}

.charts-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.5rem;
}

.charts-grid > :first-child {
  grid-column: 1 / -1;
}

.filter-btn {
  border: 1px solid rgba(180, 83, 9, 0.2);
  background: #fff;
  color: #92400e;
  border-radius: 999px;
  padding: 0.3rem 0.65rem;
  font-size: 0.75rem;
  cursor: pointer;
}

.filter-btn--active {
  background: linear-gradient(135deg, #f59e0b, #d97706);
  border-color: transparent;
  color: #fff;
}

@media (max-width: 960px) {
  .charts-grid {
    grid-template-columns: 1fr;
  }
}
</style>
