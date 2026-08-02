<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RefreshCw, Printer } from '@lucide/vue'
import api from '@/api/client'
import { formatFcfa, fullName } from '@/lib/roles'
import { CLINIC } from '@/lib/clinic'
import { formatPatientTableDate } from '@/lib/patient-datatable-columns'
import { exportTableExcel, exportTablePdf, type ExportColumn } from '@/lib/table-export'
import { openPrintDocument } from '@/lib/print-document'
import { translateUi } from '@/i18n/translate'
import { useAppI18n } from '@/i18n/useAppI18n'
import { translateTemplate } from '@/lib/dashboard-i18n'
import { DT_ICONS } from '@/lib/datatable-defaults'
import PageTableSection from '@/components/ui/PageTableSection.vue'
import ExportButtons from '@/components/ui/ExportButtons.vue'
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
    return `${item.externalClient.code} — ${name} ${translateUi('(externe)')}`
  }
  if (item.patient) {
    return `${item.patient.code} — ${fullName(item.patient.firstName, item.patient.lastName)}`
  }
  return '—'
}

function saleBuyerCode(item: SaleRecord) {
  return item.externalClient?.code ?? item.patient?.code ?? '—'
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

const columns = computed(() => {
  void localeCode.value
  return [
    {
      data: 'dateSort',
      title: uiText('Date'),
      responsivePriority: 1,
      render: (_d: number, _t: string, row: { date: string }) => row.date,
    },
    { data: 'patient', title: uiText('Acheteur'), responsivePriority: 1 },
    { data: 'pharmacist', title: uiText('Pharmacien'), responsivePriority: 3 },
    { data: 'linesLabel', title: uiText('Lignes'), responsivePriority: 4 },
    {
      data: 'totalSort',
      title: uiText('Total'),
      responsivePriority: 2,
      render: (_d: number, _t: string, row: { total: string }) =>
        `<span class="dt-amount">${row.total}</span>`,
    },
    { data: 'invoice', title: uiText('Facture'), responsivePriority: 4 },
    {
      data: null,
      title: uiText('Actions'),
      orderable: false,
      searchable: false,
      className: 'dt-actions-col dt-actions-col--catalog all',
      responsivePriority: 1,
      width: '6.5rem',
      render: (_d: unknown, _t: string, row: { id: string }) =>
        `<div class="dt-row-actions" data-id="${row.id}">
        <button type="button" class="dt-btn dt-btn--icon dt-btn--accent" data-action="print" data-id="${row.id}" title="${uiText('Imprimer')}" aria-label="${uiText('Imprimer')}">${DT_ICONS.print}</button>
        <button type="button" class="dt-btn dt-btn--icon dt-btn--icon-soft" data-action="view" data-id="${row.id}" title="${uiText('Détail')}" aria-label="${uiText('Détail')}">${DT_ICONS.view}</button>
      </div>`,
    },
  ]
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
  const t = translateUi
  const isExternal = Boolean(sale.externalClient) || sale.buyerType === 'external'
  const buyerLabel = saleBuyerName(sale)
  const buyerCode = saleBuyerCode(sale)
  const invoiceNumber = sale.invoiceNumber ?? sale.id.slice(0, 8).toUpperCase()
  const date = new Date(sale.createdAt).toLocaleString('fr-FR')
  const thermalRows = sale.lines
    .map(
      (line) => `
    <tr>
      <td>${line.productName}${line.sku ? ` (${line.sku})` : ''}</td>
      <td>${line.quantity}</td>
      <td>${formatFcfa(line.lineTotalFcfa)}</td>
    </tr>`,
    )
    .join('')

  openPrintDocument(
    `${t(isExternal ? 'Vente' : 'Ordonnance')} ${buyerCode}`,
    `
<div class="thermal-receipt">
  <header class="thermal-receipt__head">
    <img src="${CLINIC.logo}" alt="${CLINIC.nameFr}" class="thermal-receipt__logo" />
    <p class="thermal-receipt__name-ar" dir="rtl">${CLINIC.nameAr}</p>
    <p class="thermal-receipt__name">${CLINIC.nameFr}</p>
    <p class="thermal-receipt__contact">${CLINIC.fullAddress}</p>
    <p class="thermal-receipt__contact">${CLINIC.phones}</p>
  </header>

  <hr class="thermal-receipt__rule" />
  <h1 class="thermal-receipt__title">${isExternal ? t('Vente pharmacie') : t('Ordonnance pharmacie')}</h1>
  <p class="thermal-receipt__subtitle">${invoiceNumber}</p>
  <hr class="thermal-receipt__rule" />

  <div class="thermal-receipt__fields">
    <div class="thermal-receipt__row"><span>${t('Date')}</span><strong>${date}</strong></div>
    <div class="thermal-receipt__row thermal-receipt__row--stack"><span>${t('Acheteur')}</span><strong>${buyerLabel}</strong></div>
    <div class="thermal-receipt__row"><span>${t('Référence')}</span><strong>${buyerCode}</strong></div>
    <div class="thermal-receipt__row"><span>${t('Pharmacien')}</span><strong>${fullName(sale.pharmacist.firstName, sale.pharmacist.lastName)}</strong></div>
  </div>

  <hr class="thermal-receipt__rule" />
  <table>
    <thead><tr><th>${t('Produit')}</th><th>${t('Qté')}</th><th>${t('Total')}</th></tr></thead>
    <tbody>${thermalRows}</tbody>
  </table>
  <div class="thermal-receipt__fields">
    <div class="thermal-receipt__row"><span>${t('Total payé')}</span><strong>${formatFcfa(sale.totalFcfa)}</strong></div>
  </div>
  ${sale.notes ? `<p class="thermal-receipt__note"><strong>${t('Notes:')}</strong> ${sale.notes}</p>` : ''}
  <hr class="thermal-receipt__rule" />
  <p class="thermal-receipt__thanks">${t('Merci de votre confiance')}</p>
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
    <UiDataTable
      v-else
      fill
      table-key="pharmacy-sales-history-v3"
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
