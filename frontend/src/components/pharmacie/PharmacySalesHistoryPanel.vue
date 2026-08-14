<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RefreshCw, Printer, Eye } from '@lucide/vue'
import api from '@/api/client'
import { formatFcfa, fullName } from '@/lib/roles'
import { CLINIC } from '@/lib/clinic'
import { formatPatientTableDate } from '@/lib/patient-datatable-columns'
import { exportTableExcel, exportTablePdf, type ExportColumn } from '@/lib/table-export'
import { buildThermalTicketHeadHtml, openPrintDocument, thermalMetaRow } from '@/lib/print-document'
import { translateUi } from '@/i18n/translate'
import { useAppI18n } from '@/i18n/useAppI18n'
import { translateTemplate } from '@/lib/dashboard-i18n'
import PageTableSection from '@/components/ui/PageTableSection.vue'
import ExportButtons from '@/components/ui/ExportButtons.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiInput from '@/components/ui/UiInput.vue'
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

function escapeReceiptText(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '<br />')
}

function saleBuyerLabel(item: SaleRecord) {
  if (item.externalClient) {
    const name =
      item.externalClient.firstName === item.externalClient.lastName
        ? item.externalClient.firstName
        : fullName(item.externalClient.firstName, item.externalClient.lastName)
    return `${item.externalClient.code} — ${name} ${translateUi('(externe)')}`
  }
  if (item.patient) {
    return `${item.patient.code} — ${fullName(item.patient.firstName, item.patient.lastName)}`
  }
  return '—'
}

function saleBuyerName(item: SaleRecord) {
  if (item.externalClient) {
    return item.externalClient.firstName === item.externalClient.lastName
      ? item.externalClient.firstName
      : fullName(item.externalClient.firstName, item.externalClient.lastName)
  }
  if (item.patient) {
    return fullName(item.patient.firstName, item.patient.lastName)
  }
  return '—'
}

const items = ref<SaleRecord[]>([])
const loading = ref(false)
const message = ref('')
const filterFrom = ref('')
const filterTo = ref('')
const expandedId = ref<string | null>(null)

const { uiText, localeCode } = useAppI18n()

const tableRows = computed(() => {
  void localeCode.value
  return items.value.map((item) => ({
    id: item.id,
    date: formatPatientTableDate(item.createdAt),
    dateSort: new Date(item.createdAt).getTime(),
    patient: saleBuyerLabel(item),
    pharmacist: fullName(item.pharmacist.firstName, item.pharmacist.lastName),
    linesCount: item.lines.length,
    linesLabel: translateTemplate('{n} ligne(s)', { n: item.lines.length }),
    total: formatFcfa(item.totalFcfa),
    totalSort: item.totalFcfa,
    invoice: item.invoiceNumber ?? '—',
  }))
})

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

function printSale(sale: SaleRecord) {
  const buyerLabel = saleBuyerName(sale)
  const invoiceNumber = sale.invoiceNumber ?? sale.id.slice(0, 8).toUpperCase()
  const date = new Date(sale.createdAt).toLocaleString('fr-FR')
  const thermalRows = sale.lines
    .map((line) =>
      thermalMetaRow(`${line.productName} x${line.quantity}`, formatFcfa(line.lineTotalFcfa), ''),
    )
    .join('')

  openPrintDocument(
    `Ticket ${invoiceNumber}`,
    `
<div class="thermal-receipt thermal-receipt--ticket">
  ${buildThermalTicketHeadHtml({
    title: 'Clinique Alwatan Pharmacie',
    number: invoiceNumber,
    contact: `${CLINIC.city} · ${CLINIC.phones}`,
    logo: CLINIC.logo,
  })}
  <hr class="thermal-receipt__rule" />

  <div class="thermal-receipt__fields">
    ${thermalMetaRow('Date', date, '')}
    ${thermalMetaRow('Client', buyerLabel, '')}
  </div>

  <hr class="thermal-receipt__rule" />
  <div class="thermal-receipt__lines">
    ${thermalRows}
  </div>
  <div class="thermal-receipt__fields">
    ${thermalMetaRow('TOTAL', formatFcfa(sale.totalFcfa), '')}
  </div>
  ${
    sale.notes
      ? `<p class="thermal-receipt__note" dir="ltr">${escapeReceiptText(sale.notes)}</p>`
      : ''
  }
  <hr class="thermal-receipt__rule" />
  <p class="thermal-receipt__thanks">Merci</p>
</div>
`,
    { pageSize: '80mm', autoPrint: true },
  )
}

function onTableAction({ action, id }: { action: string; id: string }) {
  if (action === 'view') {
    expandedId.value = id
    return
  }
  if (action === 'print') {
    const sale = items.value.find((item) => item.id === id)
    if (sale) printSale(sale)
  }
}

type ExportSaleRow = (typeof tableRows.value)[number]

const exportColumns = computed<ExportColumn<ExportSaleRow>[]>(() => {
  void localeCode.value
  return [
    { header: uiText('Date'), value: (r) => r.date },
    { header: uiText('Acheteur'), value: (r) => r.patient },
    { header: uiText('Pharmacien'), value: (r) => r.pharmacist },
    { header: uiText('Lignes'), value: (r) => r.linesCount },
    { header: uiText('Total'), value: (r) => r.total },
    { header: uiText('Facture'), value: (r) => r.invoice },
  ]
})

function exportCaption() {
  const fromLabel = filterFrom.value || uiText('début')
  const toLabel = filterTo.value || uiText("aujourd’hui")
  const totalGlobal = formatFcfa(items.value.reduce((sum, item) => sum + item.totalFcfa, 0))
  return [
    { label: uiText('Période'), value: `${fromLabel} → ${toLabel}` },
    { label: uiText('Nombre de ventes'), value: String(items.value.length) },
    { label: uiText('Total cumulé'), value: totalGlobal },
  ]
}

function exportPdf() {
  if (!tableRows.value.length) {
    message.value = 'Aucune vente à exporter.'
    return
  }
  exportTablePdf(uiText('Historique des ventes pharmacie'), exportColumns.value, tableRows.value, {
    captionRows: exportCaption(),
  })
}

function exportExcel() {
  if (!tableRows.value.length) {
    message.value = 'Aucune vente à exporter.'
    return
  }
  exportTableExcel(uiText('Historique des ventes pharmacie'), exportColumns.value, tableRows.value)
}

onMounted(loadItems)

defineExpose({ reload: loadItems })
</script>

<template>
  <PageTableSection embedded>
    <template #toolbar>
      <ExportButtons :disabled="loading || !items.length" @pdf="exportPdf" @excel="exportExcel" />
      <UiInput v-model="filterFrom" label="Du" type="date" class="filter-field" />
      <UiInput v-model="filterTo" label="Au" type="date" class="filter-field" />
      <UiButton variant="ghost" size="sm" :icon="RefreshCw" :disabled="loading" @click="loadItems">
        {{ uiText('Filtrer') }}
      </UiButton>
    </template>

    <UiAlert v-if="message" type="error" :message="message" class="panel-alert" />

    <p v-if="!loading && !items.length" class="empty">{{ uiText('Aucune vente enregistrée pour cette période.') }}</p>
    <div v-else class="simple-table-shell" :class="{ 'simple-table-shell--fill': true }">
      <div v-if="loading" class="simple-table-overlay" role="status" aria-live="polite">
        <span class="simple-table-spinner" aria-hidden="true" />
        Chargement des ventes…
      </div>
      <div class="simple-table-scroll">
        <div class="simple-table-wrap">
          <table class="simple-table">
            <thead>
              <tr>
                <th class="simple-table__num">#</th>
                <th>{{ uiText('Date') }}</th>
                <th>{{ uiText('Acheteur') }}</th>
                <th>{{ uiText('Pharmacien') }}</th>
                <th>{{ uiText('Lignes') }}</th>
                <th>{{ uiText('Total') }}</th>
                <th>{{ uiText('Facture') }}</th>
                <th class="simple-table__actions-head">{{ uiText('Actions') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, index) in tableRows" :key="row.id">
                <td class="simple-table__num">{{ index + 1 }}</td>
                <td><span class="st-date">{{ row.date }}</span></td>
                <td><span class="st-name">{{ row.patient }}</span></td>
                <td>{{ row.pharmacist }}</td>
                <td>{{ row.linesLabel }}</td>
                <td><span class="st-amount">{{ row.total }}</span></td>
                <td>{{ row.invoice }}</td>
                <td class="simple-table__actions">
                  <div class="st-actions">
                    <button
                      type="button"
                      class="st-btn st-btn--accent"
                      :title="uiText('Imprimer')"
                      :aria-label="uiText('Imprimer')"
                      @click="onTableAction({ action: 'print', id: row.id })"
                    >
                      <Printer :size="15" />
                    </button>
                    <button
                      type="button"
                      class="st-btn st-btn--soft"
                      :title="uiText('Détail')"
                      :aria-label="uiText('Détail')"
                      @click="onTableAction({ action: 'view', id: row.id })"
                    >
                      <Eye :size="15" />
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
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
        <strong>{{ uiText('Date :') }}</strong> {{ formatPatientTableDate(expandedSale.createdAt) }} ·
        <strong>{{ uiText('Pharmacien :') }}</strong>
        {{ fullName(expandedSale.pharmacist.firstName, expandedSale.pharmacist.lastName) }} ·
        <strong>{{ uiText('Facture :') }}</strong> {{ expandedSale.invoiceNumber ?? '—' }}
      </p>
      <p v-if="expandedSale.notes" class="sale-notes">{{ expandedSale.notes }}</p>
      <table class="detail-table">
        <thead>
          <tr>
            <th>{{ uiText('Produit') }}</th>
            <th>{{ uiText('Catégorie') }}</th>
            <th>{{ uiText('Qté') }}</th>
            <th>{{ uiText('Prix unit.') }}</th>
            <th>{{ uiText('Total') }}</th>
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
    <template #footer>
      <UiButton variant="ghost" @click="expandedId = null">{{ uiText('Fermer') }}</UiButton>
      <UiButton variant="primary" :icon="Printer" @click="printSale(expandedSale)">
        {{ uiText('Imprimer') }}
      </UiButton>
    </template>
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
