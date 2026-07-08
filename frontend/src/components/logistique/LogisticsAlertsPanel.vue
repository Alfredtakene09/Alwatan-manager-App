<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RefreshCw } from '@lucide/vue'
import api from '@/api/client'
import { statusBadge } from '@/lib/datatable-defaults'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiDataTable from '@/components/ui/UiDataTable.vue'

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

const stockColumns = [
  {
    data: 'name',
    title: 'Article',
    responsivePriority: 1,
    render: (name: string) => `<span class="dt-name">${name}</span>`,
  },
  { data: 'sku', title: 'SKU', responsivePriority: 3 },
  { data: 'category', title: 'Catégorie', responsivePriority: 3 },
  {
    data: 'stockLabel',
    title: 'Stock',
    responsivePriority: 2,
    render: (label: string, _t: string, row: { levelVariant: string }) =>
      statusBadge(label, row.levelVariant as 'danger' | 'warning'),
  },
  {
    data: 'levelLabel',
    title: 'Alerte',
    responsivePriority: 2,
    render: (label: string, _t: string, row: { levelVariant: string }) =>
      statusBadge(label, row.levelVariant as 'danger' | 'warning'),
  },
]

const expiryColumns = [
  {
    data: 'name',
    title: 'Article',
    responsivePriority: 1,
    render: (name: string) => `<span class="dt-name">${name}</span>`,
  },
  { data: 'sku', title: 'SKU', responsivePriority: 3 },
  { data: 'expiryDate', title: 'Expiration', responsivePriority: 2 },
  { data: 'daysLabel', title: 'Délai', responsivePriority: 2 },
  {
    data: 'levelLabel',
    title: 'Alerte',
    responsivePriority: 2,
    render: (label: string, _t: string, row: { levelVariant: string }) =>
      statusBadge(label, row.levelVariant as 'danger' | 'warning'),
  },
]

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

onMounted(loadAlerts)

defineExpose({ reload: loadAlerts })
</script>

<template>
  <div class="alerts-layout">
    <div class="page-table-section">
      <div class="page-table-toolbar">
        <strong class="panel-table-title">Alertes stock</strong>
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

      <p v-if="!loading && !stockRows.length" class="empty">Aucune alerte stock.</p>
      <UiDataTable
        v-else
        fill
        table-key="logistics-alerts-stock"
        compact
        :data="stockRows"
        :columns="stockColumns"
        :loading="loading"
        loading-label="Chargement…"
      />
    </div>

    <div class="page-table-section">
      <div class="page-table-toolbar">
        <strong class="panel-table-title">Alertes péremption</strong>
      </div>

      <p v-if="!loading && !expiryRows.length" class="empty">Aucune alerte de péremption.</p>
      <UiDataTable
        v-else
        fill
        table-key="logistics-alerts-expiry"
        compact
        :data="expiryRows"
        :columns="expiryColumns"
        :loading="loading"
        loading-label="Chargement…"
      />
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

.empty {
  text-align: center;
  color: var(--text-light);
  padding: 2rem 1rem;
  font-size: 0.875rem;
}
</style>
