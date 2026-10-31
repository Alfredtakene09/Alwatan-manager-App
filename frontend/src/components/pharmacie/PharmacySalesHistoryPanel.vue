<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import axios from 'axios'
import { Printer, Eye, Pencil, Save, Trash2, RotateCcw, Wallet } from '@lucide/vue'
import api from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { formatFcfa, fullName, ROLE_LABELS, type AppUserRole } from '@/lib/roles'
import { CLINIC } from '@/lib/clinic'
import { formatPatientTableDate } from '@/lib/patient-datatable-columns'
import { exportTablePdf, type ExportColumn } from '@/lib/table-export'
import { buildPharmacyTicketItemsTableHtml, buildThermalTicketHeadHtml, openPrintDocument, reservePrintWindow, thermalIsRtl, thermalLocaleMetaRow, thermalThanksHtml, thermalTicketDirAttrs, thermalTicketRootClass } from '@/lib/print-document'
import { formatReceiptDateTimeFr } from '@/i18n/locale-format'
import { useAppI18n } from '@/i18n/useAppI18n'
import { translateTemplate } from '@/lib/dashboard-i18n'
import { confirmAppModal } from '@/lib/api-modal-helper'
import PageTableSection from '@/components/ui/PageTableSection.vue'
import ExportButtons from '@/components/ui/ExportButtons.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
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
  netTotalFcfa?: number
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

function saleRemainingFcfa(item: SaleRecord) {
  const refunded = item.returnedNetFcfa ?? item.returnedGrossFcfa ?? 0
  return Math.max(0, (item.netTotalFcfa ?? item.totalFcfa) - refunded)
}

function lineRemainingFcfa(line: SaleLine) {
  const remainingQty = line.quantityReturnable ?? Math.max(0, line.quantity - (line.quantityReturned ?? 0))
  return line.unitPriceFcfa * remainingQty
}

function saleBuyerLabel(item: SaleRecord) {
  if (item.externalClient) {
    const name =
      item.externalClient.firstName === item.externalClient.lastName
        ? item.externalClient.firstName
        : fullName(item.externalClient.firstName, item.externalClient.lastName)
    return `${item.externalClient.code} — ${name} ${uiText('(externe)')}`
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
const filterPharmacistId = ref('')
const appliedFrom = ref('')
const appliedTo = ref('')
const appliedPharmacistId = ref('')

type PharmacistOption = { id: string; firstName: string; lastName: string; role?: AppUserRole }
const pharmacists = ref<PharmacistOption[]>([])
const expandedId = ref<string | null>(null)
const editId = ref<string | null>(null)
const editingLines = ref<EditableSaleLine[]>([])
const pendingDeleteLineIds = ref<string[]>([])
const savingEdit = ref(false)
const deletingLineId = ref<string | null>(null)
const returnModalOpen = ref(false)
const returnSale = ref<PharmacySaleForReturn | null>(null)

const auth = useAuthStore()
const canDeleteSaleLine = computed(() => auth.user?.role === 'ADMIN')
/** Un pharmacien ne voit que ses propres ventes : pas de choix du vendeur. */
const canFilterPharmacist = computed(() => Boolean(auth.user && auth.user.role !== 'PHARMACIEN'))
const { uiText, localeCode } = useAppI18n()

function pharmacistOptionLabel(row: PharmacistOption) {
  const name = fullName(row.firstName, row.lastName)
  return row.role && row.role !== 'PHARMACIEN' ? `${name} · ${uiText(ROLE_LABELS[row.role] ?? row.role)}` : name
}

async function loadPharmacists() {
  if (!canFilterPharmacist.value) return
  try {
    const { data } = await api.get<PharmacistOption[]>('/pharmacie/pharmacists')
    pharmacists.value = data
  } catch {
    pharmacists.value = []
  }
}

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
    total: formatFcfa(saleRemainingFcfa(item)),
    totalSort: saleRemainingFcfa(item),
    invoice: item.invoiceNumber ?? '—',
  }))
})

/** Somme des ventes nettes affichées, retours déduits. */
const salesTotals = computed(() => {
  let amountFcfa = 0
  let units = 0
  for (const item of items.value) {
    amountFcfa += saleRemainingFcfa(item)
    for (const line of item.lines) {
      units += line.quantityReturnable ?? Math.max(0, line.quantity - (line.quantityReturned ?? 0))
    }
  }
  return { amountFcfa, units, salesCount: items.value.length }
})

function formatSalesPeriodDate(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString(localeCode.value, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

const salesAppliedPeriod = computed(() => {
  void localeCode.value
  if (!appliedFrom.value && !appliedTo.value) return uiText('Toutes les dates')
  const from = appliedFrom.value ? formatSalesPeriodDate(appliedFrom.value) : '…'
  const to = appliedTo.value ? formatSalesPeriodDate(appliedTo.value) : '…'
  return translateTemplate('Période : {period}', { period: `${from} – ${to}` })
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

async function onReturnSuccess(sale: PharmacySaleForReturn) {
  await loadItems()
  const fresh = items.value.find((item) => item.id === sale.id)
  returnSale.value = fresh ?? sale
  expandedId.value = sale.id
}

let loadRequest = 0

async function loadItems() {
  if (filterFrom.value && filterTo.value && filterFrom.value > filterTo.value) {
    message.value = uiText('La date de début doit précéder la date de fin.')
    messageType.value = 'error'
    return
  }
  const request = ++loadRequest
  const requestedFrom = filterFrom.value
  const requestedTo = filterTo.value
  const requestedPharmacistId = filterPharmacistId.value
  loading.value = true
  message.value = ''
  try {
    const params: Record<string, string> = {}
    if (requestedFrom) params.from = requestedFrom
    if (requestedTo) params.to = requestedTo
    if (canFilterPharmacist.value && requestedPharmacistId) params.pharmacistId = requestedPharmacistId
    const { data } = await api.get<SaleRecord[]>('/pharmacie/sales', { params })
    if (request !== loadRequest) return
    items.value = data
    appliedFrom.value = requestedFrom
    appliedTo.value = requestedTo
    appliedPharmacistId.value = requestedPharmacistId
  } catch (error: unknown) {
    if (request !== loadRequest) return
    const responseMessage = axios.isAxiosError(error)
      ? error.response?.data?.detail ?? error.response?.data?.error ?? error.response?.data?.message
      : null
    message.value =
      typeof responseMessage === 'string'
        ? responseMessage
        : uiText("Impossible de charger l'historique des ventes.")
    messageType.value = 'error'
    items.value = []
    appliedFrom.value = requestedFrom
    appliedTo.value = requestedTo
    appliedPharmacistId.value = requestedPharmacistId
  } finally {
    if (request === loadRequest) loading.value = false
  }
}

watch([filterFrom, filterTo, filterPharmacistId], () => {
  void loadItems()
})

async function printSale(sale: SaleRecord) {
  const invoiceNumber = sale.invoiceNumber ?? sale.id.slice(0, 8).toUpperCase()
  const date = formatReceiptDateTimeFr(sale.createdAt)
  const isInternal = sale.buyerType === 'patient' || Boolean(sale.patient)

  reservePrintWindow('80mm')

  const internalBlock = isInternal ? thermalLocaleMetaRow('Type', uiText('Interne')) : ''
  const itemsTable = buildPharmacyTicketItemsTableHtml({
    lines: sale.lines
      .map((line) => {
        const quantity = line.quantityReturnable ?? Math.max(0, line.quantity - (line.quantityReturned ?? 0))
        return {
          name: line.productName,
          quantity,
          unitPriceFcfa: line.unitPriceFcfa,
          lineTotalFcfa: line.unitPriceFcfa * quantity,
        }
      })
      .filter((line) => line.quantity > 0),
    totalFcfa: saleRemainingFcfa(sale),
  })

  openPrintDocument(
    `Ticket ${invoiceNumber}`,
    `
<div class="${thermalTicketRootClass('thermal-receipt--pharmacy')}"${thermalTicketDirAttrs()}>
  ${buildThermalTicketHeadHtml({
    title: uiText('Reçu pharmacie'),
    number: invoiceNumber,
    contact: `${CLINIC.city} · ${CLINIC.phones}`,
    logo: CLINIC.logo,
    rtl: thermalIsRtl(),
  })}
  <hr class="thermal-receipt__rule" />

  <div class="thermal-receipt__fields">
    ${thermalLocaleMetaRow('Date', date)}
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
  ${thermalThanksHtml()}
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

async function deleteSaleLine(saleId: string, line: SaleLine) {
  const confirmed = await confirmAppModal({
    type: 'DELETE',
    title: uiText('Supprimer cette ligne'),
    message: translateTemplate(
      'Retirer {product} ({qty}) ? La quantité revient en stock et {amount} est retiré du total.',
      {
        product: line.productName,
        qty: line.quantity,
        amount: formatFcfa(line.lineTotalFcfa),
      },
    ),
    confirmLabel: uiText('Supprimer'),
    cancelLabel: uiText('Annuler'),
  })
  if (!confirmed) return

  deletingLineId.value = line.id
  message.value = ''
  try {
    const { data } = await api.patch<SaleRecord | { deleted: true; id: string }>(
      `/pharmacie/sales/${saleId}`,
      { lines: [], deleteLineIds: [line.id] },
    )
    if ('deleted' in data && data.deleted) {
      items.value = items.value.filter((item) => item.id !== data.id)
      expandedId.value = null
      message.value = uiText('Vente supprimée — toutes les lignes ont été retirées.')
    } else {
      const sale = data as SaleRecord
      const index = items.value.findIndex((item) => item.id === sale.id)
      if (index >= 0) items.value[index] = sale
      message.value = uiText('Ligne supprimée — stock et total mis à jour.')
    }
    messageType.value = 'success'
  } catch (error: unknown) {
    const apiMessage =
      error && typeof error === 'object' && 'response' in error
        ? (error as { response?: { data?: { error?: string } } }).response?.data?.error
        : undefined
    message.value = apiMessage ?? uiText('Impossible de supprimer cette ligne.')
    messageType.value = 'error'
  } finally {
    deletingLineId.value = null
  }
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
    { header: uiText('Total net'), value: (r) => r.total },
    { header: uiText('Facture'), value: (r) => r.invoice },
  ]
})

function exportCaption() {
  const pharmacist = pharmacists.value.find((row) => row.id === appliedPharmacistId.value)
  return [
    { label: uiText('Période'), value: salesAppliedPeriod.value },
    {
      label: uiText('Pharmacien'),
      value: pharmacist ? pharmacistOptionLabel(pharmacist) : uiText('Tous les pharmaciens'),
    },
    { label: uiText('Nombre de ventes'), value: String(salesTotals.value.salesCount) },
    { label: uiText('Total cumulé'), value: formatFcfa(salesTotals.value.amountFcfa) },
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

onMounted(() => {
  void loadPharmacists()
  void loadItems()
})

defineExpose({ reload: loadItems })
</script>

<template>
  <PageTableSection embedded>
    <template #toolbar>
      <div class="sales-toolbar">
        <div class="sales-toolbar__filters">
          <UiSelect
            v-if="canFilterPharmacist"
            v-model="filterPharmacistId"
            label="Pharmacien"
            class="filter-field filter-field--pharmacist"
          >
            <option value="">{{ uiText('Tous les pharmaciens') }}</option>
            <option v-for="p in pharmacists" :key="p.id" :value="p.id">{{ pharmacistOptionLabel(p) }}</option>
          </UiSelect>
          <UiInput v-model="filterFrom" label="Du" type="date" class="filter-field" />
          <UiInput v-model="filterTo" label="Au" type="date" class="filter-field" />
        </div>
        <div class="sales-toolbar__end">
          <div
            class="sales-total-card"
            role="status"
            :title="
              translateTemplate('{sales} vente(s) · {units} produit(s)', {
                sales: salesTotals.salesCount,
                units: salesTotals.units,
              })
            "
          >
            <Wallet :size="16" class="sales-total-card__icon" aria-hidden="true" />
            <div class="sales-total-card__body">
              <span class="sales-total-card__label">{{ uiText('Total net') }}</span>
              <strong class="sales-total-card__value">{{ formatFcfa(salesTotals.amountFcfa) }}</strong>
              <small class="sales-total-card__period" :title="salesAppliedPeriod">
                {{ salesAppliedPeriod }}
              </small>
            </div>
            <small class="sales-total-card__hint">
              {{
                translateTemplate('{sales} vente(s) · {units} produit(s)', {
                  sales: salesTotals.salesCount,
                  units: salesTotals.units,
                })
              }}
            </small>
          </div>
          <ExportButtons
            :show-excel="false"
            :show-word="false"
            :disabled="loading || !items.length"
            @pdf="exportPdf"
          />
        </div>
      </div>
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
            <th v-if="canDeleteSaleLine" class="detail-table__actions-head">{{ uiText('Actions') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="line in expandedSale.lines" :key="line.id">
            <td>{{ line.productName }} <span class="sku">{{ line.sku }}</span></td>
            <td>{{ line.categoryName ?? '—' }}</td>
            <td>
              {{ line.quantityReturnable ?? line.quantity }}
              <span v-if="line.quantityReturned" class="sku">
                {{ translateTemplate('({n} retourné(s))', { n: line.quantityReturned }) }}
              </span>
            </td>
            <td>{{ formatFcfa(line.unitPriceFcfa) }}</td>
            <td>{{ formatFcfa(lineRemainingFcfa(line)) }}</td>
            <td v-if="canDeleteSaleLine" class="detail-table__actions">
              <button
                type="button"
                class="st-btn st-btn--delete"
                :disabled="deletingLineId === line.id"
                :title="uiText('Supprimer cette ligne')"
                :aria-label="uiText('Supprimer cette ligne')"
                @click="deleteSaleLine(expandedSale.id, line)"
              >
                <Trash2 :size="15" />
              </button>
            </td>
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
      {{
        canDeleteSaleLine
          ? uiText('Corrigez les quantités ou supprimez des lignes — le stock est ajusté automatiquement.')
          : uiText('Corrigez les quantités — le stock est ajusté automatiquement.')
      }}
    </p>
    <table class="detail-table detail-table--edit">
      <thead>
        <tr>
          <th>{{ uiText('Produit') }}</th>
          <th>{{ uiText('Qté') }}</th>
          <th>{{ uiText('Prix unit.') }}</th>
          <th>{{ uiText('Total') }}</th>
          <th v-if="canDeleteSaleLine" class="detail-table__actions-head">{{ uiText('Actions') }}</th>
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
          <td v-if="canDeleteSaleLine" class="detail-table__actions">
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

.filter-field--pharmacist {
  min-width: 13rem;
}

.sales-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 0.75rem;
  width: 100%;
}

.sales-toolbar__filters,
.sales-toolbar__end {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 0.6rem;
}

/* Champs alignés sur la même ligne de base : pas de marge sous les libellés de formulaire. */
.sales-toolbar__filters :deep(.ui-field) {
  margin-bottom: 0;
}

.sales-total-card {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  min-height: var(--app-control-height, 2.4rem);
  padding: 0.3rem 0.75rem;
  border: 1px solid #86efac;
  border-radius: var(--radius-sm);
  background: #f0fdf4;
}

.sales-total-card__icon {
  flex: none;
  color: #15803d;
}

.sales-total-card__body {
  display: flex;
  flex-direction: column;
  line-height: 1.15;
}

.sales-total-card__label {
  font-size: 0.6875rem;
  font-weight: 650;
  color: var(--text-muted);
}

.sales-total-card__value {
  font-size: 0.95rem;
  color: #15803d;
  font-variant-numeric: tabular-nums;
}

.sales-total-card__period {
  max-width: 13rem;
  overflow: hidden;
  color: var(--text-muted);
  font-size: 0.625rem;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sales-total-card__hint {
  padding-left: 0.55rem;
  border-left: 1px solid #bbf7d0;
  font-size: 0.6875rem;
  color: var(--text-muted);
  white-space: nowrap;
}

@media (max-width: 700px) {
  .sales-total-card__hint {
    display: none;
  }
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
