<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RefreshCw } from '@lucide/vue'
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
import UiButton from '@/components/ui/UiButton.vue'
import ExportButtons from '@/components/ui/ExportButtons.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiDataTable from '@/components/ui/UiDataTable.vue'

type ReportData = {
  period: string
  itemsCount: number
  stockValueFcfa: number
  movementsCount: number
  entriesQty: number
  exitsQty: number
  entriesValueFcfa: number
  byCategory: Array<{ name: string; itemsCount: number; stockValueFcfa: number }>
  topExits: Array<{ name: string; quantity: number }>
}

const period = ref('30d')
const data = ref<ReportData | null>(null)
const loading = ref(false)
const message = ref('')

const categoryRows = computed(() =>
  (data.value?.byCategory ?? []).map((row, index) => ({
    id: `cat-${index}`,
    name: row.name,
    itemsCount: row.itemsCount,
    stockValue: formatFcfa(row.stockValueFcfa),
    stockValueSort: row.stockValueFcfa,
  })),
)

const topExitRows = computed(() =>
  (data.value?.topExits ?? []).map((row, index) => ({
    id: `exit-${index}`,
    name: row.name,
    quantity: row.quantity,
  })),
)

const categoryColumns = [
  {
    data: 'name',
    title: 'Catégorie',
    responsivePriority: 1,
    render: (name: string) => `<span class="dt-name">${name}</span>`,
  },
  { data: 'itemsCount', title: 'Art.', responsivePriority: 2 },
  {
    data: 'stockValueSort',
    title: 'Valeur',
    responsivePriority: 1,
    render: (_d: number, _t: string, row: { stockValue: string }) => `<span class="dt-amount">${row.stockValue}</span>`,
  },
]

const topExitColumns = [
  {
    data: 'name',
    title: 'Article',
    responsivePriority: 1,
    render: (name: string) => `<span class="dt-name">${name}</span>`,
  },
  { data: 'quantity', title: 'Sorties', responsivePriority: 1 },
]

async function loadReport() {
  loading.value = true
  message.value = ''
  try {
    const { data: response } = await api.get<ReportData>('/logistique/reports', { params: { period: period.value } })
    data.value = response
  } catch {
    message.value = 'Impossible de charger le rapport.'
    data.value = null
  } finally {
    loading.value = false
  }
}

const periodLabel = computed(() => {
  if (period.value === '7d') return '7 derniers jours'
  if (period.value === '90d') return '90 derniers jours'
  return '30 derniers jours'
})

const kpiRows = computed(() => {
  if (!data.value) return []
  return [
    { label: 'Articles actifs', value: data.value.itemsCount },
    { label: 'Valeur du stock', value: formatFcfa(data.value.stockValueFcfa) },
    { label: 'Entrées (qté)', value: data.value.entriesQty },
    { label: 'Sorties (qté)', value: data.value.exitsQty },
    { label: 'Valeur entrées', value: formatFcfa(data.value.entriesValueFcfa) },
    { label: 'Mouvements', value: data.value.movementsCount },
  ]
})

const kpiExportColumns: ExportColumn<(typeof kpiRows.value)[number]>[] = [
  { header: 'Indicateur', value: (r) => r.label },
  { header: 'Valeur', value: (r) => r.value },
]

const categoryExportColumns: ExportColumn<(typeof categoryRows.value)[number]>[] = [
  { header: 'Catégorie', value: (r) => r.name },
  { header: 'Articles', value: (r) => r.itemsCount },
  { header: 'Valeur', value: (r) => r.stockValue },
]

const topExitExportColumns: ExportColumn<(typeof topExitRows.value)[number]>[] = [
  { header: 'Article', value: (r) => r.name },
  { header: 'Sorties', value: (r) => r.quantity },
]

function exportPdf() {
  if (!data.value) return
  const body = `${buildClinicPrintHeader('Rapport logistique')}
<div class="row"><span>Période</span><strong>${escapeHtml(periodLabel.value)}</strong></div>
${rowsToHtmlTable(kpiExportColumns, kpiRows.value)}
<h3>Valeur par catégorie</h3>
${rowsToHtmlTable(categoryExportColumns, categoryRows.value)}
<h3>Top sorties</h3>
${rowsToHtmlTable(topExitExportColumns, topExitRows.value)}`
  openPrintDocument('Rapport logistique', body, { pageSize: 'A4', autoPrint: true })
}

function exportExcel() {
  if (!data.value) return
  exportWorkbook(exportBasename('rapport-logistique'), [
    { name: 'KPI', columns: kpiExportColumns, rows: kpiRows.value },
    { name: 'Catégories', columns: categoryExportColumns, rows: categoryRows.value },
    { name: 'Top sorties', columns: topExitExportColumns, rows: topExitRows.value },
  ])
}

onMounted(loadReport)

defineExpose({ reload: loadReport })
</script>

<template>
  <div class="reports-layout">
    <div class="reports-toolbar">
      <select v-model="period" class="filter-select" @change="loadReport">
        <option value="7d">7 derniers jours</option>
        <option value="30d">30 derniers jours</option>
        <option value="90d">90 derniers jours</option>
      </select>
      <ExportButtons :disabled="loading || !data" @pdf="exportPdf" @excel="exportExcel" />
      <UiButton variant="ghost" size="sm" :icon="RefreshCw" :disabled="loading" @click="loadReport">
        Actualiser
      </UiButton>
    </div>

    <UiAlert v-if="message" type="error" :message="message" />

    <div v-if="data" class="summary-grid">
      <UiCard title="Articles actifs" :description="String(data.itemsCount)" />
      <UiCard title="Valeur du stock" :description="formatFcfa(data.stockValueFcfa)" />
      <UiCard title="Entrées (qté)" :description="String(data.entriesQty)" />
      <UiCard title="Sorties (qté)" :description="String(data.exitsQty)" />
      <UiCard title="Valeur entrées" :description="formatFcfa(data.entriesValueFcfa)" />
      <UiCard title="Mouvements" :description="String(data.movementsCount)" />
    </div>

    <div class="tables-grid">
      <div class="page-table-section">
        <div class="page-table-toolbar">
          <strong class="panel-table-title">Valeur par catégorie</strong>
        </div>
        <p v-if="!loading && !categoryRows.length" class="empty">Aucune donnée.</p>
        <UiDataTable
          v-else
          fill
          table-key="logistics-reports-categories"
          compact
          :data="categoryRows"
          :columns="categoryColumns"
          :loading="loading"
        />
      </div>

      <div class="page-table-section">
        <div class="page-table-toolbar">
          <strong class="panel-table-title">Top sorties</strong>
        </div>
        <p v-if="!loading && !topExitRows.length" class="empty">Aucune sortie sur la période.</p>
        <UiDataTable
          v-else
          fill
          table-key="logistics-reports-exits"
          compact
          :data="topExitRows"
          :columns="topExitColumns"
          :loading="loading"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.reports-layout {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.reports-toolbar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.filter-select {
  min-width: 180px;
  padding: 0.4rem 0.6rem;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: #fff;
  font-family: inherit;
  font-size: 0.8125rem;
  color: var(--text);
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.75rem;
}

.tables-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
}

.empty {
  text-align: center;
  color: var(--text-light);
  padding: 2rem 1rem;
  font-size: 0.875rem;
}

@media (max-width: 960px) {
  .summary-grid,
  .tables-grid {
    grid-template-columns: 1fr;
  }
}
</style>
