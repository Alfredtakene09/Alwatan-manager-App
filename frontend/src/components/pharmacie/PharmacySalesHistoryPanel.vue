<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RefreshCw, Printer, Eye, Pencil, Save, Trash2, RotateCcw } from '@lucide/vue'
import api from '@/api/client'
import { formatFcfa, fullName } from '@/lib/roles'
import { CLINIC } from '@/lib/clinic'
import { formatPatientTableDate } from '@/lib/patient-datatable-columns'
import { exportTableExcel, exportTablePdf, type ExportColumn } from '@/lib/table-export'
import { buildPharmacyTicketItemsTableHtml, buildThermalTicketHeadHtml, openPrintDocument, thermalMetaRow } from '@/lib/print-document'
import { translateUi } from '@/i18n/translate'
import { useAppI18n } from '@/i18n/useAppI18n'
import { translateTemplate } from '@/lib/dashboard-i18n'
import PageTableSection from '@/components/ui/PageTableSection.vue'
import ExportButtons from '@/components/ui/ExportButtons.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiFormModal from '@/components/ui/UiFormModal.vue'
import PharmacySaleReturnModal, {
  type PharmacySaleForReturn,
} from '@/components/pharmacie/PharmacySaleReturnModal.vue'

type SaleLine = {
  id: string
  productId?: string
  productName: string
  sku: string
  categoryName: string | null
  quantity: number
  quantityReturned?: number
  quantityReturnable?: number
  unitPriceFcfa: number
  lineTotalFcfa: number
}

type EditableSaleLine = SaleLine & { quantityDraft: number }

type SaleRecord = {
  id: string
  createdAt: string
  notes: string | null
  buyerType?: 'patient' | 'external'
  patient: { code: string; firstName: string; lastName: string } | null
  externalClient: { code: string; firstName: string; lastName: string } | null
  pharmacist: { firstName: string; lastName: string }
  totalFcfa: number
  returnedGrossFcfa?: number
  returnedNetFcfa?: number
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

const items = ref<SaleRecord[]>([])
const loading = ref(false)
const message = ref('')
const messageType = ref<'success' | 'error'>('error')
const filterFrom = ref('')
const filterTo = ref('')
const expandedId = ref<string | null>(null)
const editId = ref<string | null>(null)
const editingLines = ref<EditableSaleLine[]>([])
const pendingDeleteLineIds = ref<string[]>([])
const savingEdit = ref(false)
const returnModalOpen = ref(false)
const returnSale = ref<PharmacySaleForReturn | null>(null)

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
const editSale = computed(() => items.value.find((item) => item.id === editId.value) ?? null)
const editSaleLabel = computed(() => (editSale.value ? saleBuyerLabel(editSale.value) : '—'))

const editTotalFcfa = computed(() =>
  editingLines.value.reduce(
    (sum, line) => sum + line.unitPriceFcfa * Math.max(1, Math.floor(line.quantityDraft) || 1),
    0,
  ),
)

const editHasChanges = computed(
  () =>
    pendingDeleteLineIds.value.length > 0 ||
    editingLines.value.some((line) => line.quantityDraft !== line.quantity),
)

function isTodaySale(createdAt: string) {
  return new Date(createdAt).toDateString() === new Date().toDateString()
}

function canReturnSale(sale: SaleRecord) {
  return (
    isTodaySale(sale.createdAt) &&
    sale.lines.some((line) => (line.quantityReturnable ?? line.quantity - (line.quantityReturned ?? 0)) > 0)
  )
}

function openReturnModal(sale: SaleRecord) {
  returnSale.value = sale
  returnModalOpen.value = true
}

async function onReturnSuccess(saleId: string) {
  await loadItems()
  expandedId.value = saleId
}

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
    message.value = uiText("Impossible de charger l'historique des ventes.")
    messageType.value = 'error'
    items.value = []
  } finally {
    loading.value = false
  }
}

function printSale(sale: SaleRecord) {
  const invoiceNumber = sale.invoiceNumber ?? sale.id.slice(0, 8).toUpperCase()
  const date = new Date(sale.createdAt).toLocaleString('fr-FR')
  const isInternal = sale.buyerType === 'patient' || Boolean(sale.patient)
  const internalBlock = isInternal ? thermalMetaRow('Type', 'Interne', '') : ''
  const itemsTable = buildPharmacyTicketItemsTableHtml({
    lines: sale.lines.map((line) => ({
      name: line.productName,
      quantity: line.quantity,
      unitPriceFcfa: line.unitPriceFcfa,
      lineTotalFcfa: line.lineTotalFcfa,
    })),
    totalFcfa: sale.totalFcfa,
  })

  openPrintDocument(
    `Ticket ${invoiceNumber}`,
    `
<div class="thermal-receipt thermal-receipt--ticket thermal-receipt--pharmacy">
  ${buildThermalTicketHeadHtml({
    title: 'Clinique Alwatan Pharmacie',
    number: invoiceNumber,
    contact: `${CLINIC.city} · ${CLINIC.phones}`,
    logo: CLINIC.logo,
  })}
  <hr class="thermal-receipt__rule" />

  <div class="thermal-receipt__fields">
    ${thermalMetaRow('Date', date, '')}
    ${internalBlock}
  </div>

  <hr class="thermal-receipt__rule" />
  ${itemsTable}
  ${
    sale.notes
      ? `<p class="thermal-receipt__note" dir="ltr">${escapeReceiptText(sale.notes)}</p>`
      : ''
  }
  <hr class="thermal-receipt__rule" />
  <p class="thermal-receipt__thanks">Merci</p>
</div>
`,
    { pageSize: '80mm', autoPrint: true, thermalTight: true },
  )
}

function onTableAction({ action, id }: { action: string; id: string }) {
  if (action === 'view') {
    expandedId.value = id
    return
  }
  if (action === 'edit') {
    openEditModal(id)
    return
  }
  if (action === 'print') {
    const sale = items.value.find((item) => item.id === id)
    if (sale) printSale(sale)
  }
}

function openEditModal(id: string) {
  const sale = items.value.find((item) => item.id === id)
  if (!sale) return
  editId.value = id
  editingLines.value = sale.lines.map((line) => ({
    ...line,
    quantityDraft: line.quantity,
  }))
  pendingDeleteLineIds.value = []
  message.value = ''
}

function closeEditModal() {
  editId.value = null
  editingLines.value = []
  pendingDeleteLineIds.value = []
}

function removeEditLine(lineId: string) {
  const index = editingLines.value.findIndex((line) => line.id === lineId)
  if (index < 0) return
  if (!pendingDeleteLineIds.value.includes(lineId)) {
    pendingDeleteLineIds.value = [...pendingDeleteLineIds.value, lineId]
  }
  editingLines.value = editingLines.value.filter((line) => line.id !== lineId)
}

function lineDraftTotal(line: EditableSaleLine) {
  const qty = Math.max(1, Math.floor(line.quantityDraft) || 1)
  return line.unitPriceFcfa * qty
}

async function saveEdit() {
  if (!editId.value || !editHasChanges.value) return
  if (!editingLines.value.length && !pendingDeleteLineIds.value.length) {
    message.value = uiText('Ajoutez au moins une ligne ou annulez la modification.')
    messageType.value = 'error'
    return
  }
  for (const line of editingLines.value) {
    const qty = Math.floor(line.quantityDraft)
    if (!Number.isFinite(qty) || qty < 1 || qty > 999) {
      message.value = uiText('Quantité invalide — saisissez un nombre entre 1 et 999.')
      messageType.value = 'error'
      return
    }
  }

  savingEdit.value = true
  message.value = ''
  try {
    const { data } = await api.patch<SaleRecord | { deleted: true; id: string }>(
      `/pharmacie/sales/${editId.value}`,
      {
        lines: editingLines.value.map((line) => ({
          id: line.id,
          quantity: Math.floor(line.quantityDraft),
        })),
        deleteLineIds: pendingDeleteLineIds.value,
      },
    )
    if ('deleted' in data && data.deleted) {
      items.value = items.value.filter((item) => item.id !== data.id)
      message.value = uiText('Vente supprimée — toutes les lignes ont été retirées.')
    } else {
      const sale = data as SaleRecord
      const index = items.value.findIndex((item) => item.id === sale.id)
      if (index >= 0) items.value[index] = sale
      message.value = uiText('Vente mise à jour.')
    }
    messageType.value = 'success'
    closeEditModal()
  } catch (error: unknown) {
    const apiMessage =
      error && typeof error === 'object' && 'response' in error
        ? (error as { response?: { data?: { error?: string } } }).response?.data?.error
        : undefined
    message.value = apiMessage ?? uiText('Impossible de modifier cette vente.')
    messageType.value = 'error'
  } finally {
    savingEdit.value = false
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
    message.value = uiText('Aucune vente à exporter.')
    messageType.value = 'error'
    return
  }
  exportTablePdf(uiText('Historique des ventes pharmacie'), exportColumns.value, tableRows.value, {
    captionRows: exportCaption(),
  })
}

function exportExcel() {
  if (!tableRows.value.length) {
    message.value = uiText('Aucune vente à exporter.')
    messageType.value = 'error'
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

    <UiAlert v-if="message" :type="messageType" :message="message" class="panel-alert" />

    <p v-if="!loading && !items.length" class="empty">{{ uiText('Aucune vente enregistrée pour cette période.') }}</p>
    <div v-else class="simple-table-shell" :class="{ 'simple-table-shell--fill': true }">
      <div v-if="loading" class="simple-table-overlay" role="status" aria-live="polite">
        <span class="simple-table-spinner" aria-hidden="true" />
        {{ uiText('Chargement des ventes…') }}
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
                      class="st-btn st-btn--soft"
                      :title="uiText('Détail')"
                      :aria-label="uiText('Détail')"
                      @click="onTableAction({ action: 'view', id: row.id })"
                    >
                      <Eye :size="15" />
                    </button>
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
                      class="st-btn st-btn--edit"
                      :title="uiText('Modifier')"
                      :aria-label="uiText('Modifier')"
                      @click="onTableAction({ action: 'edit', id: row.id })"
                    >
                      <Pencil :size="15" />
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
      <UiButton
        v-if="canReturnSale(expandedSale)"
        variant="secondary"
        :icon="RotateCcw"
        @click="openReturnModal(expandedSale)"
      >
        {{ uiText('Retour') }}
      </UiButton>
      <UiButton variant="secondary" :icon="Pencil" @click="openEditModal(expandedSale.id); expandedId = null">
        {{ uiText('Modifier') }}
      </UiButton>
      <UiButton variant="primary" :icon="Printer" @click="printSale(expandedSale)">
        {{ uiText('Imprimer') }}
      </UiButton>
    </template>
  </UiFormModal>

  <UiFormModal
    v-if="editSale"
    title="Modifier la vente"
    :subtitle="editSaleLabel"
    size="large"
    @close="closeEditModal"
  >
    <p class="sale-meta">
      <strong>{{ uiText('Date :') }}</strong> {{ formatPatientTableDate(editSale.createdAt) }} ·
      <strong>{{ uiText('Pharmacien :') }}</strong>
      {{ fullName(editSale.pharmacist.firstName, editSale.pharmacist.lastName) }}
    </p>
    <p class="edit-hint">
      {{ uiText('Corrigez les quantités ou supprimez des lignes — le stock est ajusté automatiquement.') }}
    </p>
    <table class="detail-table detail-table--edit">
      <thead>
        <tr>
          <th>{{ uiText('Produit') }}</th>
          <th>{{ uiText('Qté') }}</th>
          <th>{{ uiText('Prix unit.') }}</th>
          <th>{{ uiText('Total') }}</th>
          <th class="detail-table__actions-head">{{ uiText('Actions') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="line in editingLines" :key="line.id">
          <td>{{ line.productName }} <span class="sku">{{ line.sku }}</span></td>
          <td>
            <input
              v-model.number="line.quantityDraft"
              type="number"
              min="1"
              max="999"
              class="qty-input"
              :aria-label="`${uiText('Quantité')} — ${line.productName}`"
            />
          </td>
          <td>{{ formatFcfa(line.unitPriceFcfa) }}</td>
          <td>{{ formatFcfa(lineDraftTotal(line)) }}</td>
          <td class="detail-table__actions">
            <button
              type="button"
              class="st-btn st-btn--delete"
              :title="uiText('Supprimer cette ligne')"
              :aria-label="uiText('Supprimer cette ligne')"
              @click="removeEditLine(line.id)"
            >
              <Trash2 :size="15" />
            </button>
          </td>
        </tr>
      </tbody>
    </table>
    <p class="edit-total">
      <strong>{{ uiText('Nouveau total :') }}</strong> {{ formatFcfa(editTotalFcfa) }}
    </p>
    <template #footer>
      <UiButton variant="ghost" @click="closeEditModal">{{ uiText('Annuler') }}</UiButton>
      <UiButton
        variant="primary"
        :icon="Save"
        :loading="savingEdit"
        :disabled="!editHasChanges"
        @click="saveEdit"
      >
        {{ uiText('Enregistrer') }}
      </UiButton>
    </template>
  </UiFormModal>

  <PharmacySaleReturnModal
    v-model:open="returnModalOpen"
    :sale="returnSale"
    @success="onReturnSuccess"
  />
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

.edit-hint {
  margin: 0 0 0.75rem;
  font-size: 0.8125rem;
  color: var(--text-muted);
}

.edit-total {
  margin: 0.85rem 0 0;
  font-size: 0.875rem;
  text-align: right;
}

.qty-input {
  width: 4.5rem;
  padding: 0.35rem 0.45rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 0.8125rem;
  text-align: center;
}

.detail-table--edit td {
  vertical-align: middle;
}

.detail-table__actions-head,
.detail-table__actions {
  width: 3rem;
  text-align: center;
}

.detail-table__actions .st-btn {
  margin: 0 auto;
}
</style>
