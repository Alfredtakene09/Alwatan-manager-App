<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  Search,
  ShoppingCart,
  Package,
  Minus,
  Plus,
  Trash2,
  RefreshCw,
  Maximize2,
  Minimize2,
  UserRound,
  FileText,
  PillBottle,
  ClipboardList,
  RotateCcw,
  Lock,
} from '@lucide/vue'
import api from '@/api/client'
import { CLINIC } from '@/lib/clinic'
import { formatFcfa, fullName } from '@/lib/roles'
import { buildPharmacyTicketItemsTableHtml, buildThermalTicketHeadHtml, cancelPrintWindow, openPrintDocument, reservePrintWindow, thermalIsRtl, thermalLocaleMetaRow, thermalThanksHtml, thermalTicketDirAttrs, thermalTicketRootClass } from '@/lib/print-document'
import { formatReceiptDateTimeFr } from '@/i18n/locale-format'
import PharmacyProductSuggest from '@/components/pharmacie/PharmacyProductSuggest.vue'
import { useAppI18n } from '@/i18n/useAppI18n'
import { translateTemplate } from '@/lib/dashboard-i18n'
import { usePharmacyDayClosure } from '@/composables/usePharmacyDayClosure'
import UiInput from '@/components/ui/UiInput.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiFormModal from '@/components/ui/UiFormModal.vue'
import PharmacySaleReturnModal, {
  type PharmacySaleForReturn,
} from '@/components/pharmacie/PharmacySaleReturnModal.vue'

export type CashierProduct = {
  id: string
  name: string
  sku: string
  barcode?: string | null
  dosage?: string | null
  quantity: number
  unitPriceFcfa: number
  sachetsPerBox?: number
  sachetPriceFcfa?: number | null
  sellBySachet?: boolean
}

export type CashierPatient = {
  id: string
  code: string
  firstName: string
  lastName: string
}

type BuyerType = 'patient' | 'external'

type CartLine = {
  productId: string
  quantity: number
  sellByDetail: boolean
}

type PrescriptionPrintLine = {
  name: string
  quantity: number
  unitPrice: number
  lineTotal: number
}

type CheckoutAdjustmentMode = 'none' | 'reduction' | 'free'
type CheckoutAdjustment = {
  reductionFcfa: number
  isFree: boolean
  hasReduction: boolean
  responsible?: string
}

type PendingOrdonnanceLine = {
  productId?: string | null
  name: string
  productName: string
  dosage?: string | null
  quantity: number
  instructions?: string
  unitPriceFcfa: number
  stock: number
  lineTotalFcfa: number
  available: boolean
  isFreeText?: boolean
}

type PendingOrdonnance = {
  consultationId: string
  visitId: string
  prescribedAt: string
  patient: CashierPatient & { phone?: string | null; gender?: string | null }
  doctor: { id: string; firstName: string; lastName: string } | null
  lines: PendingOrdonnanceLine[]
  estimatedTotalFcfa: number
  allAvailable: boolean
  hasCatalogLines?: boolean
  hasFreeTextLines?: boolean
}

const props = defineProps<{
  products: CashierProduct[]
  patients: CashierPatient[]
  loading?: boolean
}>()

const emit = defineEmits<{
  changed: []
  refresh: []
}>()

const { uiText } = useAppI18n()

const rootRef = ref<HTMLElement | null>(null)
const searchRef = ref<{ focus: () => void } | null>(null)
const isFullscreen = ref(true)
const catalogSearch = ref('')
const buyerType = ref<BuyerType>('external')
const patientId = ref('')
const linkedVisitId = ref<string | null>(null)
const linkedPatient = ref<CashierPatient | null>(null)
const externalClientName = ref('')
const externalClientPhone = ref('')
const notes = ref('')
const cart = ref<CartLine[]>([])
const selectedCartIndex = ref<number | null>(null)
const highlightedProductId = ref<string | null>(null)
const message = ref('')
const messageType = ref<'success' | 'error'>('success')
const submitting = ref(false)
const REDUCTION_PERCENT_OPTIONS = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50] as const

const adjustmentMode = ref<CheckoutAdjustmentMode>('none')
const reductionPercent = ref<string>('5')
const coveredByName = ref('')

const ordonnancesModalOpen = ref(false)
const ordonnancesLoading = ref(false)
const returnPickerOpen = ref(false)
const returnModalOpen = ref(false)
const returnSale = ref<PharmacySaleForReturn | null>(null)
const todayReturnableSales = ref<PharmacySaleForReturn[]>([])
const todaySalesLoading = ref(false)
const ordonnancesSearch = ref('')
const ordonnances = ref<PendingOrdonnance[]>([])
const ordonnancesError = ref('')
const confirmOrdonnance = ref<PendingOrdonnance | null>(null)
const confirmNameInput = ref('')
const detailChoiceProduct = ref<CashierProduct | null>(null)
const { closingSales, closePharmacySales } = usePharmacyDayClosure()
const pendingOrdonnancesCount = ref(0)

const patientsForSelect = computed(() => {
  const list = [...props.patients]
  if (linkedPatient.value && !list.some((p) => p.id === linkedPatient.value!.id)) {
    list.unshift(linkedPatient.value)
  }
  return list
})

const productsById = computed(() => new Map(props.products.map((p) => [p.id, p])))

const filteredCatalog = computed(() => {
  const q = catalogSearch.value.trim().toLowerCase()
  const list = [...props.products].sort((a, b) => a.name.localeCompare(b.name, 'fr'))
  if (!q) return list
  return list.filter(
    (p) =>
      p.name.toLowerCase().includes(q) ||
      p.sku.toLowerCase().includes(q) ||
      (p.barcode?.toLowerCase().includes(q) ?? false) ||
      (p.dosage?.toLowerCase().includes(q) ?? false),
  )
})

const cartRows = computed(() =>
  cart.value.map((line, index) => {
    const product = productsById.value.get(line.productId)!
    const unitPrice = lineUnitPrice(product, line.sellByDetail)
    const lineTotal = unitPrice * line.quantity
    const baseName = product.dosage ? `${product.name} — ${product.dosage}` : product.name
    return {
      index,
      productId: line.productId,
      sellByDetail: line.sellByDetail,
      name: line.sellByDetail ? `${baseName} (${uiText('détail')})` : baseName,
      quantity: line.quantity,
      unitPrice,
      lineTotal,
      unitPriceLabel: formatFcfa(unitPrice),
      lineTotalLabel: formatFcfa(lineTotal),
      stockUnits: stockUnitsForLine(product, line),
    }
  }),
)

const cartTotalFcfa = computed(() => cartRows.value.reduce((sum, row) => sum + row.lineTotal, 0))
const cartArticlesCount = computed(() => cart.value.reduce((sum, line) => sum + line.quantity, 0))

const selectedReductionPercent = computed(() => {
  const pct = Number.parseInt(reductionPercent.value || '0', 10)
  return Number.isFinite(pct) ? pct : 0
})

const selectedReductionFcfa = computed(() =>
  Math.round((cartTotalFcfa.value * selectedReductionPercent.value) / 100),
)

const cartNetFcfa = computed(() => {
  if (adjustmentMode.value !== 'reduction') return cartTotalFcfa.value
  return Math.max(0, cartTotalFcfa.value - selectedReductionFcfa.value)
})

const reductionPercentLabel = computed(() => {
  if (cartTotalFcfa.value <= 0 || selectedReductionPercent.value <= 0) return uiText('Réduction (%)')
  return translateTemplate('Réduction (%) — −{amount}', {
    amount: formatFcfa(selectedReductionFcfa.value),
  })
})

const selectedCartRow = computed(() =>
  selectedCartIndex.value == null ? null : cartRows.value[selectedCartIndex.value] ?? null,
)

function sachetsPerBox(product: CashierProduct) {
  return Math.max(1, Math.round(Number(product.sachetsPerBox) || 1))
}

function canSellByDetail(product: CashierProduct) {
  return Boolean(product.sellBySachet && (product.sachetPriceFcfa ?? 0) > 0)
}

function lineUnitPrice(product: CashierProduct, sellByDetail: boolean) {
  if (sellByDetail && canSellByDetail(product)) return product.sachetPriceFcfa!
  return product.unitPriceFcfa
}

function stockUnitsForLine(product: CashierProduct, line: Pick<CartLine, 'quantity' | 'sellByDetail'>) {
  if (line.sellByDetail) return line.quantity
  if (canSellByDetail(product) && sachetsPerBox(product) > 1) {
    return line.quantity * sachetsPerBox(product)
  }
  return line.quantity
}

function cartStockUnitsFor(productId: string) {
  const product = productsById.value.get(productId)
  if (!product) return 0
  return cart.value
    .filter((line) => line.productId === productId)
    .reduce((sum, line) => sum + stockUnitsForLine(product, line), 0)
}

function cartQuantityFor(productId: string) {
  return cartStockUnitsFor(productId)
}

function remainingStock(product: CashierProduct) {
  return Math.max(0, product.quantity - cartStockUnitsFor(product.id))
}

function selectCartLine(index: number) {
  selectedCartIndex.value = index
}

function findCartLine(productId: string, sellByDetail: boolean) {
  return cart.value.find((line) => line.productId === productId && line.sellByDetail === sellByDetail)
}

function closeDetailChoice() {
  detailChoiceProduct.value = null
}

function requestAddToCart(productId: string) {
  const product = productsById.value.get(productId)
  if (!product || product.quantity <= 0) return
  if (remainingStock(product) <= 0) {
    message.value = translateTemplate('Stock insuffisant pour {name}.', { name: product.name })
    messageType.value = 'error'
    return
  }
  if (canSellByDetail(product)) {
    detailChoiceProduct.value = product
    return
  }
  addToCart(productId, false)
}

function confirmDetailChoice(sellByDetail: boolean) {
  const product = detailChoiceProduct.value
  if (!product) return
  detailChoiceProduct.value = null
  addToCart(product.id, sellByDetail)
}

function addToCart(productId: string, sellByDetail = false) {
  const product = productsById.value.get(productId)
  if (!product || product.quantity <= 0) return

  const useDetail = sellByDetail && canSellByDetail(product)
  const unitsNeeded = useDetail
    ? 1
    : canSellByDetail(product) && sachetsPerBox(product) > 1
      ? sachetsPerBox(product)
      : 1

  if (remainingStock(product) < unitsNeeded) {
    message.value = translateTemplate('Stock insuffisant pour {name}.', { name: product.name })
    messageType.value = 'error'
    return
  }

  highlightedProductId.value = productId
  const existing = findCartLine(productId, useDetail)
  if (existing) {
    existing.quantity += 1
    selectedCartIndex.value = cart.value.indexOf(existing)
  } else {
    cart.value.push({ productId, quantity: 1, sellByDetail: useDetail })
    selectedCartIndex.value = cart.value.length - 1
  }
  message.value = ''
}

function changeCartQuantity(index: number, delta: number) {
  const line = cart.value[index]
  if (!line) return
  const product = productsById.value.get(line.productId)
  if (!product) return

  const next = line.quantity + delta
  if (next <= 0) {
    removeFromCart(index)
    return
  }
  const nextUnits = stockUnitsForLine(product, { quantity: next, sellByDetail: line.sellByDetail })
  const otherUnits = cart.value
    .filter((row, i) => i !== index && row.productId === line.productId)
    .reduce((sum, row) => sum + stockUnitsForLine(product, row), 0)
  if (otherUnits + nextUnits > product.quantity) {
    message.value = translateTemplate('Stock maximum : {qty} pour {name}.', {
      qty: product.quantity,
      name: product.name,
    })
    messageType.value = 'error'
    return
  }
  line.quantity = next
  selectedCartIndex.value = index
  message.value = ''
}

function removeFromCart(index: number) {
  cart.value.splice(index, 1)
  if (selectedCartIndex.value === index) {
    selectedCartIndex.value = cart.value.length ? Math.min(index, cart.value.length - 1) : null
  } else if (selectedCartIndex.value != null && selectedCartIndex.value > index) {
    selectedCartIndex.value -= 1
  }
}

function clearCart() {
  cart.value = []
  selectedCartIndex.value = null
  highlightedProductId.value = null
}

function tryAddFromSearch() {
  const raw = catalogSearch.value.trim()
  if (!raw) return

  const exact = props.products.find(
    (p) =>
      p.barcode?.toLowerCase() === raw.toLowerCase() ||
      p.sku.toLowerCase() === raw.toLowerCase(),
  )
  if (exact) {
    requestAddToCart(exact.id)
    catalogSearch.value = ''
    void nextTick(() => searchRef.value?.focus())
    return
  }

  if (filteredCatalog.value.length === 1) {
    requestAddToCart(filteredCatalog.value[0].id)
    catalogSearch.value = ''
    void nextTick(() => searchRef.value?.focus())
  }
}

function onSearchKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter') {
    event.preventDefault()
    tryAddFromSearch()
  }
}

function saleSuccessMessage(data: {
  invoice?: { invoiceNumber: string } | null
  total: number
  billingDeferred?: boolean
}) {
  if (data.invoice) {
    return buyerType.value === 'external'
      ? translateTemplate('Vente enregistrée — facture {invoice} ({total})', {
          invoice: data.invoice.invoiceNumber,
          total: formatFcfa(data.total),
        })
      : translateTemplate('Ordonnance enregistrée — facture {invoice} ({total})', {
          invoice: data.invoice.invoiceNumber,
          total: formatFcfa(data.total),
        })
  }
  if (data.billingDeferred) {
    return translateTemplate('Ordonnance enregistrée — facturation différée ({total})', {
      total: formatFcfa(data.total),
    })
  }
  return 'Ordonnance enregistrée — prise en charge gratuite'
}

function buildPharmacyBrowserTicketHtml(data: {
  items: PrescriptionPrintLine[]
  notes?: string
  invoiceNumber: string
  total: number
  date: string
  isExternal?: boolean
  grossTotal?: number
  reductionFcfa?: number
  reductionPercent?: number
  coveredByName?: string | null
  isFree?: boolean
  paymentModeLabel: string
  reductionLabel: string
}) {
  const clinic = CLINIC
  const grossTotal = data.grossTotal ?? data.total
  const reductionFcfa = data.reductionFcfa ?? 0
  const coveredByBlock =
    data.coveredByName && (data.isFree || reductionFcfa > 0)
      ? thermalLocaleMetaRow('Par', data.coveredByName)
      : ''
  const internalBlock = !data.isExternal ? thermalLocaleMetaRow('Type', uiText('Interne')) : ''
  const itemsTable = buildPharmacyTicketItemsTableHtml({
    lines: data.items.map((item) => ({
      name: item.name,
      quantity: item.quantity,
      unitPriceFcfa: item.unitPrice,
      lineTotalFcfa: item.lineTotal,
    })),
    totalFcfa: data.total,
    grossTotalFcfa: grossTotal,
    reductionFcfa,
    reductionLabel: data.reductionLabel,
  })

  return `
<div class="${thermalTicketRootClass('thermal-receipt--pharmacy')}"${thermalTicketDirAttrs()}>
  ${buildThermalTicketHeadHtml({
    title: uiText('Reçu pharmacie'),
    number: data.invoiceNumber,
    contact: `${clinic.city} · ${clinic.phones}`,
    logo: clinic.logo,
    rtl: thermalIsRtl(),
  })}
  <hr class="thermal-receipt__rule" />

  <div class="thermal-receipt__fields">
    ${thermalLocaleMetaRow('Date', data.date)}
    ${internalBlock}
    ${thermalLocaleMetaRow('Paiement', data.paymentModeLabel)}
    ${coveredByBlock}
  </div>

  <hr class="thermal-receipt__rule" />
  ${itemsTable}
  ${
    data.notes
      ? `<p class="thermal-receipt__note" dir="ltr">${escapeReceiptText(data.notes)}</p>`
      : ''
  }
  <hr class="thermal-receipt__rule" />
  ${thermalThanksHtml()}
</div>
`
}

async function printReceipt(
  data: {
    items: PrescriptionPrintLine[]
    notes?: string
    invoiceNumber: string
    total: number
    date: string
    isExternal?: boolean
    grossTotal?: number
    reductionFcfa?: number
    reductionPercent?: number
    coveredByName?: string | null
    isFree?: boolean
  },
) {
  const reductionFcfa = data.reductionFcfa ?? 0
  const reductionPercent = data.reductionPercent
  let paymentModeLabel = 'Payé'
  if (data.isFree) paymentModeLabel = 'Gratuit'
  else if (reductionFcfa > 0) {
    paymentModeLabel = reductionPercent ? `Réduc. ${reductionPercent}%` : 'Réduction'
  }
  const reductionLabel = reductionPercent ? `Réduc. ${reductionPercent}%` : 'Réduction'

  // Impression via navigateur + pilote Windows (POS-80)
  openPrintDocument(
    `Ticket ${data.invoiceNumber}`,
    buildPharmacyBrowserTicketHtml({ ...data, paymentModeLabel, reductionLabel }),
    { pageSize: '80mm', autoPrint: true, thermalTight: true },
  )
  return { ok: true as const, mode: 'browser' as const }
}

function resetBuyerFields() {
  notes.value = ''
  patientId.value = ''
  linkedVisitId.value = null
  linkedPatient.value = null
  externalClientName.value = ''
  externalClientPhone.value = ''
  adjustmentMode.value = 'none'
  reductionPercent.value = '5'
  coveredByName.value = ''
}

function normalizeConfirmName(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** Résumé compact posologie médecin → notes vente + ticket thermique. */
function summarizeOrdonnancePosology(lines: PendingOrdonnanceLine[]): string {
  const parts: string[] = []
  for (const line of lines) {
    const instructions = (line.instructions ?? '').trim()
    if (!instructions) continue
    const dosage = (line.dosage ?? '').trim()
    const label = dosage ? `${line.productName} ${dosage}` : line.productName
    parts.push(`${label}: ${instructions}`)
  }
  if (!parts.length) return ''
  return `${uiText('Posologie')} — ${parts.join(' · ')}`
}

function escapeReceiptText(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '<br />')
}

async function loadPendingOrdonnances(search = ordonnancesSearch.value) {
  ordonnancesLoading.value = true
  ordonnancesError.value = ''
  try {
    const { data } = await api.get<{ rows: PendingOrdonnance[]; count: number }>(
      '/pharmacie/ordonnances-pending',
      { params: search.trim() ? { q: search.trim() } : undefined },
    )
    ordonnances.value = data.rows
    pendingOrdonnancesCount.value = data.count
  } catch {
    ordonnances.value = []
    ordonnancesError.value = 'Impossible de charger les ordonnances médecin.'
  } finally {
    ordonnancesLoading.value = false
  }
}

async function openOrdonnancesModal() {
  ordonnancesModalOpen.value = true
  confirmOrdonnance.value = null
  confirmNameInput.value = ''
  ordonnancesSearch.value = ''
  await loadPendingOrdonnances('')
}

function closeOrdonnancesModal() {
  ordonnancesModalOpen.value = false
  confirmOrdonnance.value = null
  confirmNameInput.value = ''
}

function startConfirmOrdonnance(row: PendingOrdonnance) {
  confirmOrdonnance.value = row
  confirmNameInput.value = ''
}

function cancelConfirmOrdonnance() {
  confirmOrdonnance.value = null
  confirmNameInput.value = ''
}

function applyOrdonnanceToCart() {
  const row = confirmOrdonnance.value
  if (!row) return

  const expected = normalizeConfirmName(fullName(row.patient.firstName, row.patient.lastName))
  const typed = normalizeConfirmName(confirmNameInput.value)
  if (!typed || typed !== expected) {
    message.value = 'Le nom saisi ne correspond pas au patient de l’ordonnance. Vérifiez l’identité.'
    messageType.value = 'error'
    return
  }

  const catalogLines = row.lines.filter((line) => !line.isFreeText && line.productId)
  const freeTextLines = row.lines.filter((line) => line.isFreeText || !line.productId)

  if (!catalogLines.length) {
    message.value =
      'Cette ordonnance ne contient que des médicaments hors stock pharmacie — impression médecin uniquement, rien à encaisser.'
    messageType.value = 'error'
    return
  }

  const unavailable = catalogLines.filter((line) => !line.available)
  if (unavailable.length) {
    message.value = translateTemplate('Stock insuffisant pour : {list}.', {
      list: unavailable.map((l) => l.productName).join(', '),
    })
    messageType.value = 'error'
    return
  }

  clearCart()
  for (const line of catalogLines) {
    const product = productsById.value.get(line.productId!)
    if (!product || product.quantity < line.quantity) {
      message.value = translateTemplate('Stock insuffisant pour {name}.', { name: line.productName })
      messageType.value = 'error'
      return
    }
    cart.value.push({ productId: line.productId!, quantity: line.quantity, sellByDetail: false })
  }

  buyerType.value = 'patient'
  patientId.value = row.patient.id
  linkedVisitId.value = row.visitId
  linkedPatient.value = {
    id: row.patient.id,
    code: row.patient.code,
    firstName: row.patient.firstName,
    lastName: row.patient.lastName,
  }
  const freeNote = freeTextLines.length
    ? ` — ${uiText('Hors stock')}: ${freeTextLines.map((l) => l.productName).join(', ')}`
    : ''
  const posologyNote = summarizeOrdonnancePosology(row.lines)
  notes.value = [
    translateTemplate('Ordonnance médecin — visite {code}', {
      code: row.patient.code,
    }) + freeNote,
    posologyNote,
  ]
    .filter(Boolean)
    .join('\n')
  selectedCartIndex.value = cart.value.length ? 0 : null
  message.value = freeTextLines.length
    ? translateTemplate(
        'Ordonnance de {name} chargée (produits en stock). Médicaments hors pharmacie déjà sur l’ordonnance imprimée.',
        { name: fullName(row.patient.firstName, row.patient.lastName) },
      )
    : translateTemplate(
        'Ordonnance de {name} chargée — confirmez l’encaissement.',
        { name: fullName(row.patient.firstName, row.patient.lastName) },
      )
  messageType.value = 'success'
  closeOrdonnancesModal()
}

function doctorLabel(doctor: PendingOrdonnance['doctor']) {
  if (!doctor) return '—'
  return fullName(doctor.firstName, doctor.lastName)
}

function formatOrdonnanceDate(value: string) {
  try {
    return new Date(value).toLocaleString('fr-FR')
  } catch {
    return value
  }
}

function resolveCheckoutAdjustment(): CheckoutAdjustment | null {
  const percent = selectedReductionPercent.value
  const isFree = adjustmentMode.value === 'free'
  const hasReduction = adjustmentMode.value === 'reduction'
  const responsible = coveredByName.value.trim()
  const allowedPercent = (REDUCTION_PERCENT_OPTIONS as readonly number[]).includes(percent)
  const reductionFcfa = hasReduction && allowedPercent ? selectedReductionFcfa.value : 0

  if (hasReduction && !allowedPercent) {
    message.value = 'Choisissez un pourcentage de réduction valide (5 % à 50 %).'
    messageType.value = 'error'
    return null
  }
  if (hasReduction && reductionFcfa <= 0) {
    message.value = 'Le panier est trop faible pour appliquer cette réduction.'
    messageType.value = 'error'
    return null
  }
  return {
    reductionFcfa: hasReduction ? reductionFcfa : 0,
    isFree,
    hasReduction,
    responsible: isFree || hasReduction ? responsible : undefined,
  }
}

function validateBuyerSelection() {
  if (buyerType.value === 'patient' && !patientId.value) {
    message.value = 'Sélectionnez un patient.'
    messageType.value = 'error'
    return false
  }
  return true
}

async function loadTodayReturnableSales() {
  todaySalesLoading.value = true
  try {
    const today = new Date().toISOString().slice(0, 10)
    const { data } = await api.get<PharmacySaleForReturn[]>('/pharmacie/sales', {
      params: { from: today, to: today },
    })
    todayReturnableSales.value = data.filter((sale) =>
      sale.lines.some(
        (line) => (line.quantityReturnable ?? line.quantity - (line.quantityReturned ?? 0)) > 0,
      ),
    )
  } catch {
    todayReturnableSales.value = []
  } finally {
    todaySalesLoading.value = false
  }
}

function openReturnPicker() {
  void loadTodayReturnableSales()
  returnPickerOpen.value = true
}

function saleReturnableAmount(sale: PharmacySaleForReturn) {
  return sale.lines.reduce((sum, line) => {
    const qty = line.quantityReturnable ?? Math.max(0, line.quantity - (line.quantityReturned ?? 0))
    return sum + Math.max(0, qty) * line.unitPriceFcfa
  }, 0)
}

const todayReturnableTotalFcfa = computed(() =>
  todayReturnableSales.value.reduce((sum, sale) => sum + saleReturnableAmount(sale), 0),
)

function pickSaleForReturn(sale: PharmacySaleForReturn) {
  returnSale.value = sale
  returnModalOpen.value = true
}

async function onReturnSuccess(sale: PharmacySaleForReturn) {
  returnSale.value = sale
  await loadTodayReturnableSales()
  const fresh = todayReturnableSales.value.find((item) => item.id === sale.id)
  if (fresh) returnSale.value = fresh
  emit('refresh')
}

async function submitSale() {
  if (submitting.value) return
  const externalName = externalClientName.value.trim()

  if (!validateBuyerSelection()) return
  if (!cart.value.length) {
    message.value = 'Le panier est vide.'
    messageType.value = 'error'
    return
  }
  const adjustment = resolveCheckoutAdjustment()
  if (!adjustment) return

  const printItems: PrescriptionPrintLine[] = cartRows.value.map((row) => ({
    name: row.name,
    quantity: row.quantity,
    unitPrice: row.unitPrice,
    lineTotal: row.lineTotal,
  }))

  // Réserver synchrone au clic (repli navigateur) ; fermée si l'agent ESC/POS réussit.
  if (printItems.length) reservePrintWindow('80mm')
  submitting.value = true
  message.value = ''
  let ticketToPrint: Parameters<typeof printReceipt>[0] | null = null

  try {
    const { data } = await api.post('/pharmacie', {
      ...(buyerType.value === 'patient'
        ? {
            patientId: patientId.value,
            notes: notes.value,
            ...(linkedVisitId.value ? { visitId: linkedVisitId.value } : {}),
          }
        : {
            ...(externalName ? { externalClientName: externalName } : {}),
            ...(externalClientPhone.value.trim()
              ? { externalClientPhone: externalClientPhone.value.trim() }
              : {}),
          }),
      reductionFcfa: adjustment.reductionFcfa,
      isFree: adjustment.isFree,
      coveredByName: adjustment.responsible,
      items: cart.value.map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
        sellByDetail: line.sellByDetail,
      })),
    })

    message.value = saleSuccessMessage(data)
    messageType.value = 'success'

    if (printItems.length) {
      const isExternal = buyerType.value === 'external'
      const invoiceNumber =
        data.invoice?.invoiceNumber
        ?? (data.isFree
          ? 'GRATUIT'
          : data.billingDeferred
            ? 'DIFFÉRÉ'
            : data.prescription?.id
              ? `RX-${String(data.prescription.id).slice(-6).toUpperCase()}`
              : 'TICKET')
      ticketToPrint = {
        items: printItems,
        notes: isExternal ? undefined : notes.value.trim(),
        invoiceNumber,
        total: data.total,
        grossTotal: data.grossTotal,
        reductionFcfa: data.reductionFcfa,
        reductionPercent: adjustment.hasReduction ? selectedReductionPercent.value : undefined,
        coveredByName: data.coveredByName,
        isFree: data.isFree,
        date: formatReceiptDateTimeFr(new Date()),
        isExternal,
      }
    } else {
      cancelPrintWindow()
    }

    clearCart()
    resetBuyerFields()
    emit('changed')
    void loadPendingOrdonnances('')
    void loadTodayReturnableSales()
    void nextTick(() => searchRef.value?.focus())
  } catch (error: unknown) {
    cancelPrintWindow()
    ticketToPrint = null
    const apiMessage =
      error && typeof error === 'object' && 'response' in error
        ? (error as { response?: { data?: { error?: string } } }).response?.data?.error
        : undefined
    message.value = apiMessage ?? 'Stock insuffisant ou erreur de saisie.'
    messageType.value = 'error'
  } finally {
    submitting.value = false
  }

  if (ticketToPrint) {
    const ticket = ticketToPrint
    window.setTimeout(() => {
      void printReceipt(ticket)
    }, 50)
  }
}

async function enterNativeFullscreen() {
  const el = rootRef.value
  if (!el || document.fullscreenElement || !isFullscreen.value) return
  try {
    await el.requestFullscreen()
    if (!isFullscreen.value) {
      await exitNativeFullscreen()
    }
  } catch {
    /* Le navigateur exige souvent un geste : le mode CSS couvre déjà l’écran. */
  }
}

async function exitNativeFullscreen() {
  if (!document.fullscreenElement) return
  try {
    await document.exitFullscreen()
  } catch {
    /* ignore */
  }
}

async function toggleFullscreen() {
  if (isFullscreen.value) {
    isFullscreen.value = false
    await exitNativeFullscreen()
    return
  }
  isFullscreen.value = true
  await enterNativeFullscreen()
}

function onFullscreenChange() {
  if (document.fullscreenElement) {
    isFullscreen.value = true
    return
  }
  isFullscreen.value = false
}

onMounted(() => {
  document.addEventListener('fullscreenchange', onFullscreenChange)
  searchRef.value?.focus()
  void nextTick().then(() => {
    void enterNativeFullscreen()
  })
  void loadPendingOrdonnances('').then(() => {
    /* compteur badge uniquement */
  })
  void loadTodayReturnableSales()
})

onUnmounted(() => {
  document.removeEventListener('fullscreenchange', onFullscreenChange)
  void exitNativeFullscreen()
})

watch(
  () => props.products,
  () => {
    cart.value = cart.value.filter((line) => {
      const product = productsById.value.get(line.productId)
      return product && line.quantity <= product.quantity
    })
    if (selectedCartIndex.value != null && selectedCartIndex.value >= cart.value.length) {
      selectedCartIndex.value = cart.value.length ? cart.value.length - 1 : null
    }
  },
)
</script>

<template>
  <div ref="rootRef" class="cashier" :class="{ 'cashier--fullscreen': isFullscreen }">
    <header class="cashier__head">
      <div class="cashier__title-wrap">
        <div class="cashier__title-icon" aria-hidden="true">
          <ShoppingCart :size="22" />
        </div>
        <div>
          <h2 class="cashier__title">{{ uiText('Caisse') }}</h2>
          <p class="cashier__subtitle">{{ uiText('Vente au comptoir et dispensation') }}</p>
        </div>
      </div>
      <div class="cashier__head-actions">
        <UiButton variant="secondary" size="sm" :icon="RotateCcw" @click="openReturnPicker">
          {{ uiText('Retour produit') }}
        </UiButton>
        <UiButton variant="secondary" size="sm" :icon="ClipboardList" @click="openOrdonnancesModal">
          {{ uiText('Ordonnance') }}
          <span v-if="pendingOrdonnancesCount > 0" class="cashier__badge">{{ pendingOrdonnancesCount }}</span>
        </UiButton>
        <UiButton
          variant="secondary"
          size="sm"
          :icon="Lock"
          :disabled="closingSales"
          @click="closePharmacySales"
        >
          {{ uiText('Clôturer les ventes') }}
        </UiButton>
        <UiButton variant="ghost" size="sm" :icon="isFullscreen ? Minimize2 : Maximize2" @click="toggleFullscreen">
          {{ isFullscreen ? uiText('Quitter plein écran') : uiText('Plein écran') }}
        </UiButton>
      </div>
    </header>

    <UiAlert v-if="message" :type="messageType" :message="message" class="cashier__alert" />

    <div class="cashier__grid">
      <section class="cashier-panel cashier-panel--catalog">
        <header class="cashier-panel__head cashier-panel__head--green">
          <Package :size="18" />
          <div>
            <h3>{{ uiText('Catalogue') }}</h3>
            <p>{{ translateTemplate('{n} médicament(s)', { n: filteredCatalog.length }) }}</p>
          </div>
        </header>

        <div class="catalog-search">
          <PharmacyProductSuggest
            ref="searchRef"
            v-model="catalogSearch"
            variant="catalog"
            :items="products"
            :pick-on-enter="false"
            :suggestions-enabled="false"
            placeholder="Rechercher ou scanner un code-barres…"
            aria-label="Rechercher dans le catalogue"
            @keydown="onSearchKeydown"
          />
        </div>
        <p class="catalog-hint">{{ uiText('Saisie : filtre la grille · Lecteur USB : scan + Entrée ajoute au panier') }}</p>

        <div class="catalog-grid-wrap">
          <p v-if="!filteredCatalog.length" class="catalog-empty">{{ uiText('Aucun produit trouvé') }}</p>
          <div v-else class="catalog-grid">
            <button
              v-for="product in filteredCatalog"
              :key="product.id"
              type="button"
              class="catalog-card"
              :class="{
                'catalog-card--active': highlightedProductId === product.id,
                'catalog-card--in-cart': cartQuantityFor(product.id) > 0,
                'catalog-card--out': remainingStock(product) <= 0,
              }"
              :disabled="remainingStock(product) <= 0"
              @click="requestAddToCart(product.id)"
            >
              <span v-if="cartQuantityFor(product.id) > 0" class="catalog-card__qty">
                {{ cartQuantityFor(product.id) }}
              </span>
              <span class="catalog-card__icon" aria-hidden="true">
                <PillBottle :size="24" />
              </span>
              <strong class="catalog-card__name">{{ product.name }}</strong>
              <span v-if="product.dosage" class="catalog-card__dosage">{{ product.dosage }}</span>
              <span v-if="canSellByDetail(product)" class="catalog-card__detail-badge">{{ uiText('Détail') }}</span>
              <span class="catalog-card__meta">
                <span
                  class="catalog-card__stock"
                  :class="{ 'catalog-card__stock--low': remainingStock(product) <= 5 }"
                >
                  {{ product.quantity <= 0 ? uiText('Rupture') : remainingStock(product) }}
                </span>
                <span v-if="canSellByDetail(product)" class="catalog-card__prices">
                  <span class="catalog-card__price catalog-card__price--box">
                    <small>{{ uiText('Boîte') }}</small>
                    {{ formatFcfa(product.unitPriceFcfa) }}
                  </span>
                  <span class="catalog-card__price catalog-card__price--detail">
                    <small>{{ uiText('Détail') }}</small>
                    {{ formatFcfa(product.sachetPriceFcfa ?? 0) }}
                  </span>
                </span>
                <span v-else class="catalog-card__price">{{ formatFcfa(product.unitPriceFcfa) }}</span>
              </span>
            </button>
          </div>
        </div>
      </section>

      <section class="cashier-panel cashier-panel--cart">
        <header class="cashier-panel__head cashier-panel__head--blue">
          <ShoppingCart :size="22" />
          <div>
            <h3>{{ uiText('Panier') }}</h3>
            <p>{{ translateTemplate('{n} article(s)', { n: cartArticlesCount }) }}</p>
          </div>
        </header>

        <div class="cart-table-wrap">
          <table class="cart-table">
            <thead>
              <tr>
                <th>#</th>
                <th>{{ uiText('Article') }}</th>
                <th>{{ uiText('Qté') }}</th>
                <th>{{ uiText('Prix unit.') }}</th>
                <th>{{ uiText('Total') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!cartRows.length">
                <td colspan="5" class="cart-empty">{{ uiText('Panier vide — cliquez un produit du catalogue') }}</td>
              </tr>
              <tr
                v-for="row in cartRows"
                :key="`${row.productId}-${row.sellByDetail ? 'd' : 'b'}`"
                class="cart-row"
                :class="{ 'cart-row--active': selectedCartIndex === row.index }"
                @click="selectCartLine(row.index)"
              >
                <td>{{ row.index + 1 }}</td>
                <td>{{ row.name }}</td>
                <td>{{ row.quantity }}</td>
                <td>{{ row.unitPriceLabel }}</td>
                <td>{{ row.lineTotalLabel }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <footer class="cart-panel__footer">
          <div class="cart-checkout">
            <div class="buyer-type buyer-type--inline">
              <label class="buyer-type__option" :class="{ 'buyer-type__option--locked': Boolean(linkedVisitId) }">
                <input v-model="buyerType" type="radio" value="external" :disabled="Boolean(linkedVisitId)" />
                <UserRound :size="13" />
                <span>{{ uiText('Client externe') }}</span>
              </label>
              <label class="buyer-type__option" :class="{ 'buyer-type__option--locked': Boolean(linkedVisitId) }">
                <input v-model="buyerType" type="radio" value="patient" :disabled="Boolean(linkedVisitId)" />
                <FileText :size="13" />
                <span>{{ uiText('Patient clinique') }}</span>
              </label>
            </div>

            <template v-if="buyerType === 'external'">
              <input
                v-model="externalClientName"
                class="cart-inline-field"
                type="text"
                autocomplete="off"
                :placeholder="uiText('Nom du client (optionnel)')"
                :aria-label="uiText('Nom du client (optionnel)')"
              />
              <input
                v-model="externalClientPhone"
                class="cart-inline-field cart-inline-field--phone"
                type="text"
                autocomplete="off"
                :placeholder="uiText('Téléphone (optionnel)')"
                :aria-label="uiText('Téléphone (optionnel)')"
              />
            </template>
            <p v-else-if="linkedVisitId && linkedPatient" class="cart-linked-patient">
              {{ fullName(linkedPatient.firstName, linkedPatient.lastName) }}
              <span>{{ linkedPatient.code }}</span>
            </p>
            <template v-else>
              <select v-model="patientId" class="cart-inline-field" :aria-label="uiText('Patient')">
                <option value="">{{ uiText('Sélectionner un patient') }}</option>
                <option v-for="p in patientsForSelect" :key="p.id" :value="p.id">
                  {{ p.code }} — {{ fullName(p.firstName, p.lastName) }}
                </option>
              </select>
              <input
                v-model="notes"
                class="cart-inline-field"
                type="text"
                autocomplete="off"
                :placeholder="uiText('Notes ordonnance')"
                :aria-label="uiText('Notes ordonnance')"
              />
            </template>

            <select v-model="adjustmentMode" class="cart-inline-field" :aria-label="uiText('Mode de règlement')">
              <option value="none">{{ uiText('Paiement normal') }}</option>
              <option value="reduction">{{ uiText('Réduction') }}</option>
              <option value="free">{{ uiText('Prise en charge gratuite') }}</option>
            </select>
            <select
              v-if="adjustmentMode === 'reduction'"
              v-model="reductionPercent"
              class="cart-inline-field cart-inline-field--short"
              :aria-label="reductionPercentLabel"
            >
              <option v-for="pct in REDUCTION_PERCENT_OPTIONS" :key="pct" :value="String(pct)">
                {{ pct }} %
              </option>
            </select>
            <input
              v-if="adjustmentMode === 'free'"
              v-model="coveredByName"
              class="cart-inline-field"
              type="text"
              autocomplete="off"
              :placeholder="uiText('Nom de la personne responsable')"
              :aria-label="uiText('Nom de la personne responsable')"
            />
          </div>

          <div class="cart-summary">
            <div v-if="selectedCartRow" class="cart-controls">
              <UiButton
                type="button"
                size="sm"
                variant="secondary"
                :icon="Minus"
                @click="changeCartQuantity(selectedCartRow.index, -1)"
              />
              <UiButton
                type="button"
                size="sm"
                variant="secondary"
                :icon="Plus"
                @click="changeCartQuantity(selectedCartRow.index, 1)"
              />
              <UiButton
                type="button"
                size="sm"
                variant="danger"
                :icon="Trash2"
                @click="removeFromCart(selectedCartRow.index)"
              >
                {{ uiText('Retirer') }}
              </UiButton>
            </div>

            <div class="cart-total">
              <span class="cart-total__label">
                {{ adjustmentMode === 'reduction' ? uiText('Net à payer') : uiText('Total à payer') }}
              </span>
              <strong class="cart-total__value">{{ formatFcfa(cartNetFcfa) }}</strong>
              <span class="cart-total__meta">
                {{ translateTemplate('{n} article(s)', { n: cartArticlesCount }) }}
                <template v-if="adjustmentMode === 'reduction' && cartTotalFcfa > 0">
                  · −{{ selectedReductionPercent }} %
                </template>
              </span>
            </div>

            <div class="cart-actions">
              <UiButton type="button" size="sm" variant="secondary" :disabled="!cart.length || submitting" @click="clearCart">
                {{ uiText('Vider le panier') }}
              </UiButton>
              <UiButton
                type="button"
                size="sm"
                variant="primary"
                :icon="PillBottle"
                :disabled="!cart.length || submitting"
                @click="submitSale"
              >
                {{
                  submitting
                    ? uiText('Validation…')
                    : buyerType === 'external'
                      ? uiText('Valider la vente')
                      : uiText('Valider la dispensation')
                }}
              </UiButton>
            </div>
          </div>
        </footer>
      </section>
    </div>

    <UiFormModal
      v-if="ordonnancesModalOpen"
      title="Ordonnances médecin"
      subtitle="Recherchez le patient par nom, puis confirmez son identité avant d’encaisser."
      size="wide"
      @close="closeOrdonnancesModal"
    >
      <div v-if="!confirmOrdonnance" class="ord-search">
        <UiInput
          v-model="ordonnancesSearch"
          label="Rechercher un patient"
          placeholder="Nom, prénom, code ou téléphone…"
          @keydown.enter.prevent="loadPendingOrdonnances()"
        />
        <UiButton type="button" variant="secondary" :icon="Search" :disabled="ordonnancesLoading" @click="loadPendingOrdonnances()">
          {{ uiText('Chercher') }}
        </UiButton>
      </div>

      <UiAlert v-if="ordonnancesError" type="error" :message="ordonnancesError" />

      <template v-if="confirmOrdonnance">
        <div class="ord-confirm">
          <p class="ord-confirm__lead">
            {{ uiText('Confirmez le nom du patient présent à la pharmacie :') }}
          </p>
          <p class="ord-confirm__name">
            {{ fullName(confirmOrdonnance.patient.firstName, confirmOrdonnance.patient.lastName) }}
            <span class="ord-confirm__code">{{ confirmOrdonnance.patient.code }}</span>
          </p>
          <p class="ord-confirm__meta">
            {{ uiText('Médecin :') }} {{ doctorLabel(confirmOrdonnance.doctor) }} ·
            {{ formatOrdonnanceDate(confirmOrdonnance.prescribedAt) }} ·
            {{ formatFcfa(confirmOrdonnance.estimatedTotalFcfa) }}
          </p>
          <ul class="ord-confirm__lines">
            <li v-for="(line, idx) in confirmOrdonnance.lines" :key="`${line.productId ?? 'free'}-${idx}`">
              {{ line.quantity }}× {{ line.productName }}
              <span v-if="line.dosage"> — {{ line.dosage }}</span>
              <span v-if="line.isFreeText" class="ord-confirm__stock-warn">{{ uiText(' (hors pharmacie)') }}</span>
              <span v-else-if="!line.available" class="ord-confirm__stock-warn">{{ uiText(' (stock insuffisant)') }}</span>
              <div v-if="line.instructions?.trim()" class="ord-confirm__posology">
                {{ uiText('Posologie') }} : {{ line.instructions.trim() }}
              </div>
            </li>
          </ul>
          <UiInput
            v-model="confirmNameInput"
            label="Saisir le nom complet pour confirmer"
            :placeholder="fullName(confirmOrdonnance.patient.firstName, confirmOrdonnance.patient.lastName)"
            @keydown.enter.prevent="applyOrdonnanceToCart"
          />
        </div>
      </template>

      <div v-else class="ord-list-wrap">
        <p v-if="ordonnancesLoading" class="ord-empty">{{ uiText('Chargement…') }}</p>
        <p v-else-if="!ordonnances.length" class="ord-empty">{{ uiText('Aucune ordonnance en attente.') }}</p>
        <table v-else class="ord-table">
          <thead>
            <tr>
              <th>{{ uiText('Patient') }}</th>
              <th>{{ uiText('Médecin') }}</th>
              <th>{{ uiText('Médicaments') }}</th>
              <th>{{ uiText('Total') }}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in ordonnances" :key="row.visitId">
              <td>
                <strong>{{ fullName(row.patient.firstName, row.patient.lastName) }}</strong>
                <div class="ord-table__sub">{{ row.patient.code }}</div>
              </td>
              <td>{{ doctorLabel(row.doctor) }}</td>
              <td>
                <div class="ord-table__meds">
                  <span v-for="(line, idx) in row.lines" :key="`${line.productId ?? 'free'}-${idx}`">
                    {{ line.quantity }}× {{ line.productName }}
                    <em v-if="line.isFreeText">{{ uiText(' (hors stock)') }}</em>
                  </span>
                </div>
              </td>
              <td>
                {{ formatFcfa(row.estimatedTotalFcfa) }}
                <div v-if="row.hasFreeTextLines && !row.hasCatalogLines" class="ord-table__warn">{{ uiText('Impression seule') }}</div>
                <div v-else-if="!row.allAvailable" class="ord-table__warn">{{ uiText('Stock partiel') }}</div>
              </td>
              <td>
                <UiButton
                  type="button"
                  size="sm"
                  variant="primary"
                  :disabled="!row.hasCatalogLines"
                  @click="startConfirmOrdonnance(row)"
                >
                  {{ uiText('Encaisser') }}
                </UiButton>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <template #footer>
        <template v-if="confirmOrdonnance">
          <UiButton type="button" variant="secondary" @click="cancelConfirmOrdonnance">{{ uiText('Retour') }}</UiButton>
          <UiButton type="button" variant="primary" :icon="PillBottle" @click="applyOrdonnanceToCart">
            {{ uiText('Confirmer et encaisser') }}
          </UiButton>
        </template>
        <template v-else>
          <UiButton type="button" variant="secondary" @click="closeOrdonnancesModal">{{ uiText('Fermer') }}</UiButton>
          <UiButton type="button" variant="ghost" :icon="RefreshCw" :disabled="ordonnancesLoading" @click="loadPendingOrdonnances()">
            {{ uiText('Actualiser') }}
          </UiButton>
        </template>
      </template>
    </UiFormModal>

    <UiFormModal
      :open="returnPickerOpen"
      :title="uiText('Retours du jour')"
      :subtitle="uiText('Sélectionnez la vente concernée')"
      size="large"
      @close="returnPickerOpen = false"
    >
      <p v-if="todaySalesLoading" class="text-muted">{{ uiText('Chargement…') }}</p>
      <p v-else-if="!todayReturnableSales.length" class="text-muted">
        {{ uiText('Aucune vente du jour avec articles retournables.') }}
      </p>
      <template v-else>
        <p class="return-picker__total">
          <span>{{ uiText('Montant total des produits') }}</span>
          <strong dir="ltr">{{ formatFcfa(todayReturnableTotalFcfa) }}</strong>
        </p>
        <ul class="return-picker">
          <li v-for="sale in todayReturnableSales" :key="sale.id">
            <button type="button" class="return-picker__btn" @click="pickSaleForReturn(sale)">
              <strong>{{ sale.invoiceNumber ?? sale.id.slice(0, 8) }}</strong>
              <span>{{ new Date(sale.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) }}</span>
              <span>{{ sale.lines.length }} {{ uiText('ligne(s)') }}</span>
              <span dir="ltr">{{ formatFcfa(saleReturnableAmount(sale)) }}</span>
            </button>
          </li>
        </ul>
      </template>
      <template #footer>
        <UiButton variant="ghost" @click="returnPickerOpen = false">{{ uiText('Fermer') }}</UiButton>
      </template>
    </UiFormModal>

    <UiFormModal
      :open="Boolean(detailChoiceProduct)"
      :title="uiText('Mode de vente')"
      :subtitle="
        detailChoiceProduct
          ? detailChoiceProduct.dosage
            ? `${detailChoiceProduct.name} — ${detailChoiceProduct.dosage}`
            : detailChoiceProduct.name
          : ''
      "
      size="wide"
      :body-scroll="false"
      @close="closeDetailChoice"
    >
      <p class="detail-choice__intro">
        {{ uiText('Ce produit autorise la vente au détail. Choisissez le mode pour cette ligne.') }}
      </p>
      <div v-if="detailChoiceProduct" class="detail-choice">
        <button type="button" class="detail-choice__btn detail-choice__btn--detail" @click="confirmDetailChoice(true)">
          <strong>{{ uiText('Vente au détail') }}</strong>
          <span>{{ formatFcfa(detailChoiceProduct.sachetPriceFcfa ?? 0) }}</span>
          <small>{{ uiText('1 unité détail') }}</small>
        </button>
        <button type="button" class="detail-choice__btn detail-choice__btn--box" @click="confirmDetailChoice(false)">
          <strong>{{ uiText('Vente boîte') }}</strong>
          <span>{{ formatFcfa(detailChoiceProduct.unitPriceFcfa) }}</span>
          <small>
            {{
              sachetsPerBox(detailChoiceProduct) > 1
                ? translateTemplate('{n} unités / boîte', { n: sachetsPerBox(detailChoiceProduct) })
                : uiText('Prix boîte / unité complète')
            }}
          </small>
        </button>
      </div>
      <template #footer>
        <UiButton variant="ghost" @click="closeDetailChoice">{{ uiText('Annuler') }}</UiButton>
      </template>
    </UiFormModal>

    <PharmacySaleReturnModal
      v-model:open="returnModalOpen"
      :sale="returnSale"
      @success="onReturnSuccess"
    />
  </div>
</template>

<style scoped>
.cashier {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  flex: 1;
  min-height: 0;
  height: 100%;
}

.cashier--fullscreen {
  position: fixed;
  inset: 0;
  z-index: 250;
  width: 100%;
  height: 100%;
  height: 100dvh;
  background: #f8faf6;
  padding: 1rem;
  padding-top: max(1rem, env(safe-area-inset-top, 0px));
  padding-bottom: max(1rem, env(safe-area-inset-bottom, 0px));
  overflow: auto;
}

.cashier__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
  flex-shrink: 0;
}

.cashier__title-wrap {
  display: flex;
  align-items: center;
  gap: 0.85rem;
}

.cashier__title-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2.75rem;
  height: 2.75rem;
  border-radius: 12px;
  background: linear-gradient(135deg, #dcfce7, #bbf7d0);
  color: #15803d;
}

.cashier__title {
  margin: 0;
  font-size: 1.35rem;
  font-weight: 800;
  color: var(--text);
}

.cashier__subtitle {
  margin: 0.15rem 0 0;
  font-size: 0.8125rem;
  color: var(--text-muted);
}

.cashier__head-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.cashier__badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.25rem;
  height: 1.25rem;
  padding: 0 0.35rem;
  margin-left: 0.35rem;
  border-radius: 999px;
  background: #dc2626;
  color: #fff;
  font-size: 0.7rem;
  font-weight: 800;
  line-height: 1;
}

.cashier__alert {
  margin: 0;
}

.checkout-ordonnance-hint {
  margin: 0.35rem 0 0;
  font-size: 0.8125rem;
  color: #15803d;
  font-weight: 600;
}

.checkout-linked-patient {
  padding: 0.85rem 1rem;
  border-radius: 12px;
  background: #f0fdf4;
  border: 1px solid rgba(22, 163, 74, 0.22);
}

.checkout-linked-patient__name {
  margin: 0;
  font-size: 1rem;
  font-weight: 800;
  color: var(--text);
}

.checkout-linked-patient__code {
  margin-inline-start: 0.45rem;
  font-size: 0.8125rem;
  font-weight: 700;
  color: var(--text-muted);
}

.buyer-type__option--locked {
  opacity: 0.72;
  cursor: default;
}

.ord-search {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.75rem;
  align-items: end;
  margin-bottom: 1rem;
}

.ord-list-wrap {
  max-height: min(50vh, 28rem);
  overflow: auto;
}

.ord-empty {
  margin: 1rem 0;
  text-align: center;
  color: var(--text-muted);
  font-size: 0.875rem;
}

.ord-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8125rem;
}

.ord-table th,
.ord-table td {
  padding: 0.65rem 0.5rem;
  border-bottom: 1px solid var(--border, #e2e8f0);
  text-align: left;
  vertical-align: top;
}

.ord-table th {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}

.ord-table__sub {
  color: var(--text-muted);
  font-size: 0.75rem;
  margin-top: 0.15rem;
}

.ord-table__meds {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.ord-table__warn {
  margin-top: 0.2rem;
  color: #b45309;
  font-size: 0.7rem;
  font-weight: 700;
}

.ord-confirm__lead {
  margin: 0 0 0.5rem;
  color: var(--text-muted);
  font-size: 0.875rem;
}

.ord-confirm__name {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 800;
  color: var(--text);
}

.ord-confirm__code {
  margin-left: 0.5rem;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-muted);
}

.ord-confirm__meta {
  margin: 0.35rem 0 0.75rem;
  font-size: 0.8125rem;
  color: var(--text-muted);
}

.ord-confirm__lines {
  margin: 0 0 1rem;
  padding-left: 1.1rem;
  font-size: 0.875rem;
}

.ord-confirm__stock-warn {
  color: #b45309;
  font-weight: 700;
}

.ord-confirm__posology {
  margin-top: 0.2rem;
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-muted);
}

.buyer-type {
  display: flex;
  flex-wrap: wrap;
  gap: 0.65rem;
  margin: 0;
}

.buyer-type--inline {
  flex: 0 0 auto;
}

.buyer-type__option {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.8125rem;
  font-weight: 700;
  color: var(--text);
  cursor: pointer;
}

.buyer-type__option input {
  accent-color: var(--accent-500);
}

.external-client-row {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
  gap: 0.75rem;
}

.cashier__grid {
  display: grid;
  grid-template-columns: minmax(0, 1.3fr) minmax(24rem, 1fr);
  gap: 0.75rem;
  min-height: 0;
  flex: 1;
  overflow: hidden;
}

.cashier-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: #fff;
  overflow: hidden;
}

.cashier-panel__head {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.85rem 1rem;
  color: #fff;
  flex-shrink: 0;
}

.cashier-panel__head h3 {
  margin: 0;
  font-size: 1rem;
  font-weight: 800;
}

.cashier-panel__head p {
  margin: 0.1rem 0 0;
  font-size: 0.75rem;
  opacity: 0.92;
}

.cashier-panel__head--green {
  background: linear-gradient(90deg, #16a34a, #22c55e);
}

.cashier-panel__head--blue {
  background: linear-gradient(90deg, #2563eb, #3b82f6);
}

.cashier-panel--cart .cashier-panel__head h3 {
  font-size: 1.25rem;
}

.cashier-panel--cart .cashier-panel__head p {
  font-size: 1rem;
}

.catalog-search {
  position: relative;
  margin: 0.85rem 1rem 0.35rem;
  flex-shrink: 0;
}

.catalog-search__icon {
  position: absolute;
  left: 0.85rem;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-muted);
}

.catalog-search__input {
  width: 100%;
  padding: 0.7rem 0.9rem 0.7rem 2.35rem;
  border: 1.5px solid var(--border);
  border-radius: 10px;
  font: inherit;
  font-size: 0.875rem;
  color: var(--text);
  background: var(--ui-input-bg, #fff);
}

.catalog-search__input:focus {
  outline: none;
  border-color: var(--accent-500);
  box-shadow: 0 0 0 3px var(--focus-ring);
}

.catalog-hint {
  margin: 0 1rem 0.65rem;
  font-size: 0.72rem;
  color: var(--text-muted);
  flex-shrink: 0;
}

.catalog-grid-wrap {
  flex: 1;
  min-height: 0;
  overflow: auto;
  border-top: 1px solid var(--border);
}

.catalog-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 0.45rem;
  padding: 0.5rem;
  align-content: start;
}

.catalog-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0.2rem;
  min-height: 6.2rem;
  padding: 0.45rem 0.4rem 0.4rem;
  border: 1px solid #86efac;
  border-radius: 10px;
  background: linear-gradient(180deg, #dcfce7 0%, #bbf7d0 100%);
  color: inherit;
  text-align: left;
  cursor: pointer;
  transition: background 0.12s ease, border-color 0.12s ease, box-shadow 0.12s ease;
}

.catalog-card:hover:not(:disabled) {
  background: linear-gradient(180deg, #bbf7d0 0%, #86efac 100%);
  border-color: #22c55e;
  box-shadow: 0 4px 12px rgba(22, 163, 74, 0.16);
}

.catalog-card:focus-visible {
  outline: 2px solid var(--accent-500);
  outline-offset: 2px;
}

.catalog-card--active,
.catalog-card--in-cart {
  background: linear-gradient(180deg, #86efac 0%, #4ade80 100%);
  border-color: #16a34a;
}

.catalog-card--out {
  opacity: 0.5;
  cursor: not-allowed;
}

.catalog-card__qty {
  position: absolute;
  top: 0.25rem;
  right: 0.25rem;
  min-width: 1.1rem;
  height: 1.1rem;
  padding: 0 0.25rem;
  border-radius: 999px;
  background: #16a34a;
  color: #fff;
  font-size: 0.62rem;
  font-weight: 800;
  line-height: 1.1rem;
  text-align: center;
}

.catalog-card__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.3rem;
  height: 1.3rem;
  flex-shrink: 0;
  border-radius: 6px;
  background: #166534;
  color: #fff;
}

.catalog-card__icon :deep(svg) {
  width: 0.85rem;
  height: 0.85rem;
}

.catalog-card__name {
  font-size: 0.78rem;
  font-weight: 800;
  line-height: 1.2;
  color: #14532d;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  overflow-wrap: anywhere;
}

.catalog-card__dosage {
  font-size: 0.66rem;
  font-weight: 600;
  color: var(--text-muted);
}

.catalog-card__detail-badge {
  display: inline-flex;
  align-self: flex-start;
  padding: 0.05rem 0.3rem;
  border-radius: 999px;
  background: #ecfdf5;
  color: #047857;
  border: 1px solid #a7f3d0;
  font-size: 0.56rem;
  font-weight: 800;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}

.catalog-card__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.1rem 0.3rem;
  margin-top: auto;
  padding-top: 0.3rem;
}

.catalog-card__stock {
  font-size: 0.68rem;
  font-weight: 700;
  color: #166534;
}

.catalog-card__stock--low {
  color: #b45309;
}

.catalog-card__price {
  margin-inline-start: auto;
  font-size: 0.74rem;
  font-weight: 800;
  color: #1d4ed8;
  white-space: nowrap;
}

.catalog-card__prices {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.1rem;
  min-width: 0;
  margin-inline-start: auto;
}

.catalog-card__prices .catalog-card__price {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  line-height: 1.15;
  font-size: 0.72rem;
}

.catalog-card__prices .catalog-card__price small {
  font-size: 0.55rem;
  font-weight: 700;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.catalog-card__price--box {
  color: #1d4ed8;
}

.catalog-card__price--detail {
  color: #047857;
}

.cart-table-wrap {
  flex: 1;
  min-height: 8rem;
  overflow: auto;
  border-top: 1px solid var(--border);
}

.cart-panel__footer {
  position: sticky;
  bottom: 0;
  z-index: 2;
  flex-shrink: 0;
  border-top: 1px solid var(--border);
  background: #fff;
}

.cart-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 1.1rem;
}

.cart-table th {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 0.7rem 0.75rem;
  text-align: left;
  background: #f8fafc;
  color: var(--text-muted);
  font-size: 0.95rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  border-bottom: 1px solid var(--border);
}

.cart-table td {
  padding: 0.75rem;
  border-bottom: 1px solid #eef2f7;
  vertical-align: middle;
}

.catalog-empty,
.cart-empty {
  text-align: center;
  color: var(--text-muted);
  padding: 2rem 1rem !important;
}

.cart-row {
  cursor: pointer;
}

.cart-row:hover {
  background: #eff6ff;
}

.cart-row--active {
  background: #dbeafe;
}

.cart-checkout {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem 0.45rem;
  padding: 0.35rem 0.55rem 0;
  flex-shrink: 0;
}

.cart-inline-field {
  height: 1.7rem;
  min-width: 0;
  max-width: 11rem;
  padding: 0 0.45rem;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: #fff;
  color: var(--text);
  font-family: inherit;
  font-size: 0.75rem;
}

.cart-inline-field--phone,
.cart-inline-field--short {
  max-width: 7.5rem;
}

.cart-linked-patient {
  margin: 0;
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--text);
}

.cart-linked-patient span {
  margin-left: 0.35rem;
  font-weight: 600;
  color: var(--text-muted);
}

.cart-controls {
  display: flex;
  gap: 0.3rem;
  padding: 0;
  flex-wrap: nowrap;
  flex-shrink: 0;
}

/* Total + actions sur une seule ligne : pied de panier court, tableau plus haut. */
.cart-summary {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.4rem;
  padding: 0.35rem 0.55rem 0.4rem;
  flex-shrink: 0;
}

.cart-total {
  flex: 0 1 auto;
  min-width: 0;
  padding: 0.15rem 0.5rem;
  border-radius: 8px;
  background: linear-gradient(135deg, #ecfdf5, #d1fae5);
  border: 1px solid #86efac;
  text-align: start;
}

.cart-total__label {
  display: block;
  font-size: 0.6rem;
  font-weight: 700;
  color: #166534;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.cart-total__value {
  display: block;
  font-size: 1rem;
  line-height: 1.1;
  color: #14532d;
  white-space: nowrap;
}

.cart-total__meta {
  display: block;
  font-size: 0.62rem;
  color: #166534;
  white-space: nowrap;
}

.cart-actions {
  flex: 1 1 auto;
  min-width: max-content;
  display: flex;
  gap: 0.35rem;
}

.cart-controls :deep(.ui-btn) {
  font-size: 0.78rem;
}

.cart-actions :deep(.ui-btn) {
  width: auto;
  flex: 1 1 auto;
  font-size: 0.78rem;
  padding-inline: 0.55rem;
  white-space: nowrap;
}

.checkout-adjustment {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.7rem;
  margin-top: 0.75rem;
}

.checkout-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
}

@media (any-pointer: coarse) {
  .catalog-table td,
  .cart-table td {
    padding-top: 1rem;
    padding-bottom: 1rem;
  }

  .catalog-row,
  .cart-row,
  .return-picker__btn,
  .buyer-type__option {
    touch-action: manipulation;
  }
}

@media (max-width: 768px) {
  .checkout-form-grid,
  .checkout-adjustment {
    grid-template-columns: 1fr;
  }
}

/* Densité catalogue : 6 cartes par ligne sur PC, jamais moins de 4 sur tablette. */
@media (min-width: 1700px) {
  .catalog-grid {
    grid-template-columns: repeat(8, minmax(0, 1fr));
  }
}

@media (max-width: 1100px) {
  .cashier__grid {
    grid-template-columns: minmax(0, 1.25fr) minmax(20rem, 1fr);
    gap: 0.6rem;
  }

  .cart-table {
    font-size: 0.95rem;
  }

  .cart-table th {
    font-size: 0.78rem;
    padding: 0.5rem 0.5rem;
  }

  .cart-table td {
    padding: 0.5rem;
  }

  .cart-total__value {
    font-size: 0.95rem;
  }

  .cart-actions :deep(.ui-btn) {
    font-size: 0.75rem;
  }
}

@media (max-width: 1000px) {
  .catalog-grid {
    grid-template-columns: repeat(5, minmax(0, 1fr));
  }
}

@media (max-width: 880px) {
  .cashier__grid {
    grid-template-columns: minmax(0, 1.2fr) minmax(17rem, 1fr);
  }

  .cart-summary {
    flex-direction: column;
    align-items: stretch;
    gap: 0.45rem;
  }

  .cart-total {
    text-align: center;
  }

  .catalog-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

/* Écrans de portable peu hauts : on compresse le pied du panier, pas la mise en page. */
@media (max-height: 820px) {
  .cart-summary {
    padding: 0.45rem 0.7rem 0.55rem;
  }

  .cart-total {
    padding: 0.25rem 0.6rem;
  }

  .cart-total__value {
    font-size: 0.95rem;
  }

  .cart-checkout,
  .cart-summary {
    padding-top: 0.25rem;
    padding-bottom: 0.3rem;
  }
}

/* Empilement (panier sous le catalogue) réservé aux mobiles. */
@media (max-width: 620px) {
  .cashier__grid {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
    overflow: auto;
  }

  .catalog-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 620px) {
  .external-client-row {
    grid-template-columns: 1fr;
  }
}

.return-picker {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.detail-choice__intro {
  margin: 0 0 0.75rem;
  font-size: 0.875rem;
  color: var(--text-muted);
  line-height: 1.4;
}

.detail-choice {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
}

.detail-choice__btn {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.35rem;
  padding: 1rem 1.1rem;
  border-radius: 12px;
  border: 1.5px solid var(--border);
  background: #fff;
  text-align: start;
  cursor: pointer;
  font: inherit;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.detail-choice__btn:hover {
  border-color: var(--accent-500);
  box-shadow: 0 0 0 3px var(--focus-ring);
}

.detail-choice__btn strong {
  font-size: 0.95rem;
}

.detail-choice__btn span {
  font-size: 1.15rem;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}

.detail-choice__btn small {
  font-size: 0.75rem;
  color: var(--text-muted);
}

.detail-choice__btn--detail {
  background: #ecfdf5;
  border-color: #6ee7b7;
  color: #065f46;
}

.detail-choice__btn--box {
  background: #eff6ff;
  border-color: #93c5fd;
  color: #1e3a8a;
}

@media (max-width: 640px) {
  .detail-choice {
    grid-template-columns: 1fr;
  }
}

.return-picker__total {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  margin: 0 0 0.85rem;
  padding: 0.75rem 1rem;
  border-radius: 8px;
  background: var(--surface-muted, #f8faf5);
  font-size: 0.95rem;
}

.return-picker__btn {
  width: 100%;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1rem;
  align-items: center;
  justify-content: space-between;
  padding: 0.65rem 0.85rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface, #fff);
  cursor: pointer;
  text-align: left;
}

.return-picker__btn:hover {
  border-color: var(--primary, #0d9488);
}
</style>
