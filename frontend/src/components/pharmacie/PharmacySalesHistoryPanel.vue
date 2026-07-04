<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { FileDown, RefreshCw } from '@lucide/vue'
import api from '@/api/client'
import { formatFcfa, fullName } from '@/lib/roles'
import { formatPatientTableDate } from '@/lib/patient-datatable-columns'
import { buildClinicPrintHeader, openPrintDocument } from '@/lib/print-document'
import PageTableSection from '@/components/ui/PageTableSection.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiDataTable from '@/components/ui/UiDataTable.vue'
import UiFormModal from '@/components/ui/UiFormModal.vue'

type SaleLine = {
  id: string
  productName: string
  sku: string
  categoryName: string | null
  quantity: number
  unitPriceFcfa: number
  lineTotalFcfa: number
}

type SaleRecord = {
  id: string
  createdAt: string
  notes: string | null
  buyerType?: 'patient' | 'external'
  patient: { code: string; firstName: string; lastName: string } | null
  externalClient: { code: string; firstName: string; lastName: string } | null
  pharmacist: { firstName: string; lastName: string }
  totalFcfa: number
  invoiceNumber: string | null
  lines: SaleLine[]
}

function saleBuyerLabel(item: SaleRecord) {
  if (item.externalClient) {
    const name =
      item.externalClient.firstName === item.externalClient.lastName
        ? item.externalClient.firstName
        : fullName(item.externalClient.firstName, item.externalClient.lastName)
    return `${item.externalClient.code} — ${name} (externe)`
  }
  if (item.patient) {
    return `${item.patient.code} — ${fullName(item.patient.firstName, item.patient.lastName)}`
  }
  return '—'
}

const items = ref<SaleRecord[]>([])
const loading = ref(false)
const message = ref('')
const filterFrom = ref('')
const filterTo = ref('')
const expandedId = ref<string | null>(null)

const tableRows = computed(() =>
  items.value.map((item) => ({
    id: item.id,
    date: formatPatientTableDate(item.createdAt),
    dateSort: new Date(item.createdAt).getTime(),
    patient: saleBuyerLabel(item),
    pharmacist: fullName(item.pharmacist.firstName, item.pharmacist.lastName),
    linesCount: item.lines.length,
    linesLabel: `${item.lines.length} ligne(s)`,
    total: formatFcfa(item.totalFcfa),
    totalSort: item.totalFcfa,
    invoice: item.invoiceNumber ?? '—',
  })),
)

const columns = [
  { data: 'dateSort', title: 'Date', responsivePriority: 1, render: (_d: number, _t: string, row: { date: string }) => row.date },
  { data: 'patient', title: 'Acheteur', responsivePriority: 1 },
  { data: 'pharmacist', title: 'Pharmacien', responsivePriority: 3 },
  { data: 'linesLabel', title: 'Lignes', responsivePriority: 4 },
  {
    data: 'totalSort',
    title: 'Total',
    responsivePriority: 2,
    render: (_d: number, _t: string, row: { total: string }) => `<span class="dt-amount">${row.total}</span>`,
  },
  { data: 'invoice', title: 'Facture', responsivePriority: 4 },
  {
    data: null,
    title: '',
    orderable: false,
    className: 'dt-actions-col all',
    responsivePriority: 1,
    render: (_d: unknown, _t: string, row: { id: string }) =>
      `<button type="button" class="dt-action-btn" data-action="view" data-id="${row.id}">Détail</button>`,
  },
]

const expandedSale = computed(() => items.value.find((item) => item.id === expandedId.value) ?? null)
const expandedSaleLabel = computed(() => (expandedSale.value ? saleBuyerLabel(expandedSale.value) : '—'))

async function loadItems() {
  loading.value = true
  message.value = ''
  try {
    const params: Record<string, string> = {}
    if (filterFrom.value) params.from = filterFrom.value
    if (filterTo.value) params.to = filterTo.value
    const { data } = await api.get<SaleRecord[]>('/pharmacie/sales', { params })
    items.value = data
  } catch {
    message.value = 'Impossible de charger l\'historique des ventes.'
    items.value = []
  } finally {
    loading.value = false
  }
}

function onTableAction({ action, id }: { action: string; id: string }) {
  if (action === 'view') {
    expandedId.value = id
  }
}

function exportPdf() {
  if (!items.value.length) {
    message.value = "Aucune vente à exporter."
    return
  }

  const rows = items.value
    .map((item, index) => {
      const buyer = saleBuyerLabel(item)
      const pharmacist = fullName(item.pharmacist.firstName, item.pharmacist.lastName)
      const invoice = item.invoiceNumber ?? '—'
      const total = formatFcfa(item.totalFcfa)
      return `
        <tr>
          <td>${index + 1}</td>
          <td>${formatPatientTableDate(item.createdAt)}</td>
          <td>${buyer}</td>
          <td>${pharmacist}</td>
          <td>${item.lines.length}</td>
          <td>${total}</td>
          <td>${invoice}</td>
        </tr>`
    })
    .join('')

  const fromLabel = filterFrom.value || 'début'
  const toLabel = filterTo.value || 'aujourd’hui'
  const totalGlobal = formatFcfa(items.value.reduce((sum, item) => sum + item.totalFcfa, 0))
  const body = `
${buildClinicPrintHeader('Historique des ventes pharmacie')}
<div class="row"><span>Période</span><strong>${fromLabel} → ${toLabel}</strong></div>
<div class="row"><span>Nombre de ventes</span><strong>${items.value.length}</strong></div>
<table>
  <thead>
    <tr>
      <th>#</th>
      <th>Date</th>
      <th>Acheteur</th>
      <th>Pharmacien</th>
      <th>Lignes</th>
      <th>Total</th>
      <th>Facture</th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
</table>
<div class="row total"><span>Total cumulé</span><strong>${totalGlobal}</strong></div>
`
  openPrintDocument('Historique ventes pharmacie', body, { pageSize: 'A4', autoPrint: true })
}

onMounted(loadItems)

defineExpose({ reload: loadItems })
</script>

<template>
  <PageTableSection embedded>
    <template #toolbar>
      <UiButton variant="secondary" size="sm" :icon="FileDown" :disabled="loading || !items.length" @click="exportPdf">
        Exporter PDF
      </UiButton>
      <UiInput v-model="filterFrom" label="Du" type="date" class="filter-field" />
      <UiInput v-model="filterTo" label="Au" type="date" class="filter-field" />
      <UiButton variant="ghost" size="sm" :icon="RefreshCw" :disabled="loading" @click="loadItems">
        Filtrer
      </UiButton>
    </template>

    <UiAlert v-if="message" type="error" :message="message" class="panel-alert" />

    <p v-if="!loading && !items.length" class="empty">Aucune vente enregistrée pour cette période.</p>
    <UiDataTable
      v-else
      fill
      table-key="pharmacy-sales-history"
      compact
      :data="tableRows"
      :columns="columns"
      :loading="loading"
      loading-label="Chargement des ventes…"
      @action="onTableAction"
    />
  </PageTableSection>

  <UiFormModal
      v-if="expandedSale"
      title="Détail de la vente"
      :subtitle="expandedSaleLabel"
      size="large"
      @close="expandedId = null"
    >
      <div class="sale-detail sale-detail--modal">
        <p class="sale-meta">
          <strong>Date :</strong> {{ formatPatientTableDate(expandedSale.createdAt) }} ·
          <strong>Pharmacien :</strong>
          {{ fullName(expandedSale.pharmacist.firstName, expandedSale.pharmacist.lastName) }} ·
          <strong>Facture :</strong> {{ expandedSale.invoiceNumber ?? '—' }}
        </p>
        <p v-if="expandedSale.notes" class="sale-notes">{{ expandedSale.notes }}</p>
        <table class="detail-table">
          <thead>
            <tr>
              <th>Produit</th>
              <th>Catégorie</th>
              <th>Qté</th>
              <th>Prix unit.</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="line in expandedSale.lines" :key="line.id">
              <td>{{ line.productName }} <span class="sku">{{ line.sku }}</span></td>
              <td>{{ line.categoryName ?? '—' }}</td>
              <td>{{ line.quantity }}</td>
              <td>{{ formatFcfa(line.unitPriceFcfa) }}</td>
              <td>{{ formatFcfa(line.lineTotalFcfa) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </UiFormModal>
</template>

<style scoped>
.panel-alert {
  margin-bottom: 1rem;
}

.filter-field {
  min-width: 9rem;
}

.empty {
  text-align: center;
  color: var(--text-light);
  padding: 2rem 1rem;
  font-size: 0.875rem;
}

.sale-detail {
  padding: 1rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--surface-muted, #f8faf5);
}

.sale-detail--modal {
  margin-top: 0;
}

.sale-detail h3 {
  margin: 0 0 0.75rem;
  font-size: 0.9375rem;
}

.sale-notes {
  margin: 0 0 0.75rem;
  font-size: 0.8125rem;
  color: var(--text-muted);
}

.sale-meta {
  margin: 0 0 0.75rem;
  font-size: 0.8125rem;
  color: var(--text);
}

.detail-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8125rem;
}

.detail-table th,
.detail-table td {
  padding: 0.45rem 0.5rem;
  text-align: left;
  border-bottom: 1px solid var(--border);
}

.sku {
  color: var(--text-muted);
  font-size: 0.75rem;
}
</style>
