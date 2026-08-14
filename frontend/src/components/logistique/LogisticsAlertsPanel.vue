<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RefreshCw } from '@lucide/vue'
import api from '@/api/client'
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
import UiButton from '@/components/ui/UiButton.vue'
import ExportButtons from '@/components/ui/ExportButtons.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import '@/assets/simple-table.css'

type StockAlertItem = {
  itemId: string
  name: string
  sku: string
  unit: string
  quantity: number
  minStock: number
  categoryName: string | null
  level: 'out' | 'critical' | 'low'
}

type ExpiryAlertItem = {
  itemId: string
  name: string
  sku: string
  expiryDate: string
  daysLeft: number
  level: 'expired' | 'soon'
}

type AlertsResponse = {
  count: number
  outOfStock: number
  critical: number
  low: number
  expirySoon: number
  expired: number
  stockItems: StockAlertItem[]
  expiryItems: ExpiryAlertItem[]
}

const data = ref<AlertsResponse | null>(null)
const loading = ref(false)
const message = ref('')

const stockLevelLabel: Record<StockAlertItem['level'], string> = {
  out: 'Rupture',
  critical: 'Critique',
  low: 'Bas',
}

const expiryLevelLabel: Record<ExpiryAlertItem['level'], string> = {
  expired: 'Expiré',
  soon: 'Expire bientôt',
}

const stockRows = computed(() =>
  (data.value?.stockItems ?? []).map((item) => ({
    id: item.itemId,
    name: item.name,
    sku: item.sku,
    category: item.categoryName ?? '—',
    stockLabel: `${item.quantity} ${item.unit} / min ${item.minStock}`,
    levelLabel: stockLevelLabel[item.level],
    levelVariant: item.level === 'low' ? 'warning' : 'danger',
  })),
)

const expiryRows = computed(() =>
  (data.value?.expiryItems ?? []).map((item) => ({
    id: item.itemId,
    name: item.name,
    sku: item.sku,
    expiryDate: new Date(`${item.expiryDate}T12:00:00`).toLocaleDateString('fr-FR'),
    daysLabel: item.daysLeft < 0 ? `Expiré depuis ${Math.abs(item.daysLeft)} j` : `${item.daysLeft} jour(s)`,
    levelLabel: expiryLevelLabel[item.level],
    levelVariant: item.level === 'expired' ? 'danger' : 'warning',
  })),
)

async function loadAlerts() {
  loading.value = true
  message.value = ''
  try {
    const { data: response } = await api.get<AlertsResponse>('/logistique/alerts')
    data.value = response
  } catch {
    message.value = 'Impossible de charger les alertes.'
    data.value = null
  } finally {
    loading.value = false
  }
}

type StockExportRow = (typeof stockRows.value)[number]
type ExpiryExportRow = (typeof expiryRows.value)[number]

const stockExportColumns: ExportColumn<StockExportRow>[] = [
  { header: 'Article', value: (r) => r.name },
  { header: 'Stock', value: (r) => r.stockLabel },
  { header: 'Alerte', value: (r) => r.levelLabel },
]

const expiryExportColumns: ExportColumn<ExpiryExportRow>[] = [
  { header: 'Article', value: (r) => r.name },
  { header: 'Expiration', value: (r) => r.expiryDate },
  { header: 'Délai', value: (r) => r.daysLabel },
  { header: 'Alerte', value: (r) => r.levelLabel },
]

const hasAlertRows = computed(() => stockRows.value.length > 0 || expiryRows.value.length > 0)

function exportPdf() {
  if (!hasAlertRows.value) return
  const body = `${buildClinicPrintHeader('Alertes logistique')}
<h3>Alertes stock</h3>
${rowsToHtmlTable(stockExportColumns, stockRows.value)}
<h3>Alertes péremption</h3>
${rowsToHtmlTable(expiryExportColumns, expiryRows.value)}`
  openPrintDocument('Alertes logistique', body, { pageSize: 'A4', autoPrint: true })
}

function exportExcel() {
  if (!hasAlertRows.value) return
  exportWorkbook(exportBasename('alertes-logistique'), [
    { name: 'Stock', columns: stockExportColumns, rows: stockRows.value },
    { name: 'Péremption', columns: expiryExportColumns, rows: expiryRows.value },
  ])
}

onMounted(loadAlerts)

defineExpose({ reload: loadAlerts })
</script>

<template>
  <div class="alerts-layout">
    <div class="page-table-section">
      <div class="page-table-toolbar">
        <strong class="panel-table-title">Alertes stock</strong>
        <ExportButtons :disabled="loading || !hasAlertRows" @pdf="exportPdf" @excel="exportExcel" />
        <UiButton variant="ghost" size="sm" :icon="RefreshCw" :disabled="loading" @click="loadAlerts">
          Actualiser
        </UiButton>
      </div>

      <UiAlert v-if="message" type="error" :message="message" class="panel-alert" />

      <div v-if="data" class="alert-summary">
        <div class="summary-chip summary-chip--danger">{{ data.outOfStock }} rupture(s)</div>
        <div class="summary-chip summary-chip--warning">{{ data.critical }} critique(s)</div>
        <div class="summary-chip">{{ data.low }} stock bas</div>
        <div class="summary-chip summary-chip--warning">{{ data.expirySoon }} expiration proche</div>
        <div class="summary-chip summary-chip--danger">{{ data.expired }} expiré(s)</div>
      </div>

      <div class="simple-table-shell simple-table-shell--fill">
        <div v-if="loading" class="simple-table-overlay" role="status" aria-live="polite">
          <span class="simple-table-spinner" aria-hidden="true" />
          Chargement…
        </div>
        <div class="simple-table-scroll">
          <p v-if="!loading && !stockRows.length" class="simple-table__empty">Aucune alerte stock.</p>
          <div v-else class="simple-table-wrap">
            <table class="simple-table">
              <thead>
                <tr>
                  <th class="simple-table__num">#</th>
                  <th>Article</th>
                  <th>Stock</th>
                  <th>Alerte</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, index) in stockRows" :key="row.id">
                  <td class="simple-table__num">{{ index + 1 }}</td>
                  <td><span class="st-name">{{ row.name }}</span></td>
                  <td>
                    <span class="st-badge" :class="`st-badge--${row.levelVariant}`">{{ row.stockLabel }}</span>
                  </td>
                  <td>
                    <span class="st-badge" :class="`st-badge--${row.levelVariant}`">{{ row.levelLabel }}</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>

    <div class="page-table-section">
      <div class="page-table-toolbar">
        <strong class="panel-table-title">Alertes péremption</strong>
      </div>

      <div class="simple-table-shell simple-table-shell--fill">
        <div v-if="loading" class="simple-table-overlay" role="status" aria-live="polite">
          <span class="simple-table-spinner" aria-hidden="true" />
          Chargement…
        </div>
        <div class="simple-table-scroll">
          <p v-if="!loading && !expiryRows.length" class="simple-table__empty">Aucune alerte de péremption.</p>
          <div v-else class="simple-table-wrap">
            <table class="simple-table">
              <thead>
                <tr>
                  <th class="simple-table__num">#</th>
                  <th>Article</th>
                  <th>Exp.</th>
                  <th>Délai</th>
                  <th>Alerte</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, index) in expiryRows" :key="row.id">
                  <td class="simple-table__num">{{ index + 1 }}</td>
                  <td><span class="st-name">{{ row.name }}</span></td>
                  <td><span class="st-date">{{ row.expiryDate }}</span></td>
                  <td><span class="st-muted">{{ row.daysLabel }}</span></td>
                  <td>
                    <span class="st-badge" :class="`st-badge--${row.levelVariant}`">{{ row.levelLabel }}</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.alerts-layout {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.panel-alert {
  margin-bottom: 1rem;
}

.alert-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.summary-chip {
  padding: 0.35rem 0.65rem;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 700;
  background: var(--surface-muted);
  color: var(--text-muted);
}

.summary-chip--danger {
  background: #fef2f2;
  color: #b91c1c;
}

.summary-chip--warning {
  background: #fffbeb;
  color: #b45309;
}
</style>
