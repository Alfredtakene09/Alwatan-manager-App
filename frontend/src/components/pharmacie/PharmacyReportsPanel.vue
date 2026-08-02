<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { BarChart3, RefreshCw } from '@lucide/vue'
import api from '@/api/client'
import { formatFcfa } from '@/lib/roles'
import {
  buildClinicPrintHeader,
  openPrintDocument,
} from '@/lib/print-document'
import {
  escapeHtml,
  exportBasename,
  exportWorkbook,
  rowsToHtmlTable,
  type ExportColumn,
} from '@/lib/table-export'
import UiCard from '@/components/ui/UiCard.vue'
import UiButton from '@/components/ui/UiButton.vue'
import ExportButtons from '@/components/ui/ExportButtons.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import DashboardBarChart, { type BarChartDay } from '@/components/dashboard/DashboardBarChart.vue'
import DashboardPendingBars from '@/components/dashboard/DashboardPendingBars.vue'
import { useAppI18n } from '@/i18n/useAppI18n'
import { translateTemplate } from '@/lib/dashboard-i18n'

type PharmacyReport = {
  from: string
  to: string
  prescriptionsCount: number
  totalUnitsSold: number
  totalRevenueFcfa: number
  salesByDay: Array<{ date: string; dayLabel: string; totalFcfa: number }>
  topProducts: Array<{ name: string; quantity: number; revenueFcfa: number }>
  salesByCategory: Array<{ name: string; quantity: number; revenueFcfa: number }>
}

const report = ref<PharmacyReport | null>(null)
const loading = ref(false)
const message = ref('')
const period = ref<'7d' | '30d' | 'month'>('7d')

const { uiText, localeCode } = useAppI18n()

const salesChart = computed((): BarChartDay[] => {
  void localeCode.value
  if (!report.value) return []
  return report.value.salesByDay.map((day) => ({
    date: day.date,
    dayLabel: day.dayLabel,
    total: day.totalFcfa,
    segments: [
      {
        key: 'sales',
        value: day.totalFcfa,
        colorClass: 'bar-chart__bar--a',
        title: translateTemplate('Ventes : {amount}', { amount: formatFcfa(day.totalFcfa) }),
      },
    ],
  }))
})

const topProductBars = computed(() => {
  if (!report.value) return []
  return report.value.topProducts.map((row) => ({
    label: row.name,
    count: row.revenueFcfa,
    amount: row.revenueFcfa,
    color: '#0d9488',
  }))
})

const categoryBars = computed(() => {
  if (!report.value) return []
  return report.value.salesByCategory.map((row) => ({
    label: row.name,
    count: row.revenueFcfa,
    amount: row.revenueFcfa,
    color: '#7c3aed',
  }))
})

async function loadReport() {
  loading.value = true
  message.value = ''
  try {
    const { data } = await api.get<PharmacyReport>('/pharmacie/reports', { params: { period: period.value } })
    report.value = data
  } catch {
    message.value = 'Impossible de charger le rapport.'
    report.value = null
  } finally {
    loading.value = false
  }
}

const periodLabel = computed(() => {
  void localeCode.value
  if (period.value === '7d') return uiText('7 derniers jours')
  if (period.value === '30d') return uiText('30 derniers jours')
  return uiText('Mois en cours')
})

const salesLegend = computed(() => {
  void localeCode.value
  return [{ key: 'sales', label: uiText('Ventes'), colorClass: 'legend-dot--a' }]
})

const kpiRows = computed(() => {
  void localeCode.value
  if (!report.value) return []
  return [
    { label: uiText('Ordonnances'), value: report.value.prescriptionsCount },
    { label: uiText('Unités vendues'), value: report.value.totalUnitsSold },
    { label: uiText("Chiffre d'affaires"), value: formatFcfa(report.value.totalRevenueFcfa) },
    { label: uiText('Période'), value: `${report.value.from} → ${report.value.to}` },
  ]
})

const kpiColumns = computed<ExportColumn<(typeof kpiRows.value)[number]>[]>(() => {
  void localeCode.value
  return [
    { header: uiText('Indicateur'), value: (r) => r.label },
    { header: uiText('Valeur'), value: (r) => r.value },
  ]
})

const topProductColumns = computed<ExportColumn<PharmacyReport['topProducts'][number]>[]>(() => {
  void localeCode.value
  return [
    { header: uiText('Produit'), value: (r) => r.name },
    { header: uiText('Quantité'), value: (r) => r.quantity },
    { header: uiText('CA'), value: (r) => formatFcfa(r.revenueFcfa) },
  ]
})

const categoryColumns = computed<ExportColumn<PharmacyReport['salesByCategory'][number]>[]>(() => {
  void localeCode.value
  return [
    { header: uiText('Catégorie'), value: (r) => r.name },
    { header: uiText('Quantité'), value: (r) => r.quantity },
    { header: uiText('CA'), value: (r) => formatFcfa(r.revenueFcfa) },
  ]
})

function exportPdf() {
  if (!report.value) return
  const body = `${buildClinicPrintHeader(uiText('Rapport des ventes pharmacie'))}
<div class="row"><span>${uiText('Période')}</span><strong>${escapeHtml(periodLabel.value)}</strong></div>
${rowsToHtmlTable(kpiColumns.value, kpiRows.value, { captionRows: [{ label: uiText('Synthèse'), value: 'KPI' }] })}
<h3>${uiText('Top produits')}</h3>
${rowsToHtmlTable(topProductColumns.value, report.value.topProducts)}
<h3>${uiText('Ventes par catégorie')}</h3>
${rowsToHtmlTable(categoryColumns.value, report.value.salesByCategory)}`
  openPrintDocument(uiText('Rapport des ventes pharmacie'), body, { pageSize: 'A4', autoPrint: true })
}

function exportExcel() {
  if (!report.value) return
  exportWorkbook(exportBasename('rapport-ventes-pharmacie'), [
    { name: 'KPI', columns: kpiColumns.value, rows: kpiRows.value },
    { name: uiText('Top produits'), columns: topProductColumns.value, rows: report.value.topProducts },
    { name: uiText('Catégories'), columns: categoryColumns.value, rows: report.value.salesByCategory },
  ])
}

onMounted(loadReport)
</script>

<template>
  <div class="reports-layout">
    <UiCard
      title="Rapport des ventes"
      description="Chiffre d'affaires, volumes et classements"
      :icon="BarChart3"
      icon-variant="green"
    >
      <template #actions>
        <UiSelect v-model="period" label="Période" class="period-select" @change="loadReport">
          <option value="7d">{{ uiText('7 derniers jours') }}</option>
          <option value="30d">{{ uiText('30 derniers jours') }}</option>
          <option value="month">{{ uiText('Mois en cours') }}</option>
        </UiSelect>
        <ExportButtons :disabled="loading || !report" @pdf="exportPdf" @excel="exportExcel" />
        <UiButton variant="ghost" size="sm" :icon="RefreshCw" :disabled="loading" @click="loadReport">
          {{ uiText('Actualiser') }}
        </UiButton>
      </template>

      <UiAlert v-if="message" type="error" :message="message" />

      <div v-if="report" class="report-kpis">
        <div class="kpi">
          <span>{{ uiText('Ordonnances') }}</span>
          <strong>{{ report.prescriptionsCount }}</strong>
        </div>
        <div class="kpi">
          <span>{{ uiText('Unités vendues') }}</span>
          <strong>{{ report.totalUnitsSold }}</strong>
        </div>
        <div class="kpi kpi--accent">
          <span>{{ uiText("Chiffre d'affaires") }}</span>
          <strong>{{ formatFcfa(report.totalRevenueFcfa) }}</strong>
        </div>
      </div>
    </UiCard>

    <div class="charts-grid">
      <UiCard title="Ventes par jour" description="Encaissements sur la période" :icon="BarChart3" icon-variant="teal">
        <DashboardBarChart
          :days="salesChart"
          :loading="loading"
          :format-total="formatFcfa"
          :legend="salesLegend"
        />
      </UiCard>

      <UiCard title="Top produits" description="Classement par chiffre d'affaires" :icon="BarChart3" icon-variant="amber">
        <div v-if="!topProductBars.length" class="chart-empty">{{ uiText('Aucune vente sur la période') }}</div>
        <DashboardPendingBars v-else :items="topProductBars" />
      </UiCard>

      <UiCard title="Ventes par catégorie" description="Répartition du CA" :icon="BarChart3" icon-variant="violet">
        <div v-if="!categoryBars.length" class="chart-empty">{{ uiText('Aucune vente sur la période') }}</div>
        <DashboardPendingBars v-else :items="categoryBars" />
      </UiCard>
    </div>
  </div>
</template>

<style scoped>
@import '@/styles/dashboard-charts.css';

.reports-layout {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.period-select {
  min-width: 11rem;
}

.report-kpis {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.75rem;
  margin-top: 0.5rem;
}

.kpi {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.85rem 1rem;
  border-radius: var(--radius-sm);
  background: var(--surface-muted, #f8faf5);
  border: 1px solid var(--border);
  font-size: 0.8125rem;
  color: var(--text-muted);
}

.kpi strong {
  font-size: 1.15rem;
  color: var(--primary-800);
}

.kpi--accent strong {
  color: var(--action);
}

.charts-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
}

.charts-grid > :first-child {
  grid-column: 1 / -1;
}

.chart-empty {
  padding: 2rem 1rem;
  text-align: center;
  color: var(--text-muted);
  font-size: 0.875rem;
}

@media (max-width: 900px) {
  .report-kpis,
  .charts-grid {
    grid-template-columns: 1fr;
  }

  .charts-grid > :first-child {
    grid-column: auto;
  }
}
</style>
