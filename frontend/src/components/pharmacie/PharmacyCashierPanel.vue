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
} from '@lucide/vue'
import api from '@/api/client'
import { CLINIC } from '@/lib/clinic'
import { formatFcfa, fullName } from '@/lib/roles'
import { buildPharmacyTicketItemsTableHtml, buildThermalTicketHeadHtml, openPrintDocument, thermalMetaRow } from '@/lib/print-document'
import { useAppI18n } from '@/i18n/useAppI18n'
import { translateTemplate } from '@/lib/dashboard-i18n'
import UiSelect from '@/components/ui/UiSelect.vue'
import UiTextarea from '@/components/ui/UiTextarea.vue'
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
const searchRef = ref<HTMLInputElement | null>(null)
const isFullscreen = ref(false)
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

const checkoutModalOpen = ref(false)
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
    const lineTotal = product.unitPriceFcfa * line.quantity
    return {
      index,
      productId: line.productId,
      name: product.dosage ? `${product.name} — ${product.dosage}` : product.name,
      quantity: line.quantity,
      unitPrice: product.unitPriceFcfa,
      lineTotal,
      unitPriceLabel: formatFcfa(product.unitPriceFcfa),
      lineTotalLabel: formatFcfa(lineTotal),
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

const reductionPercentLabel = computed(() => {
  if (cartTotalFcfa.value <= 0 || selectedReductionPercent.value <= 0) return uiText('Réduction (%)')
  return translateTemplate('Réduction (%) — −{amount}', {
    amount: formatFcfa(selectedReductionFcfa.value),
  })
})

const selectedCartRow = computed(() =>
  selectedCartIndex.value == null ? null : cartRows.value[selectedCartIndex.value] ?? null,
)

function cartQuantityFor(productId: string) {
  return cart.value.find((line) => line.productId === productId)?.quantity ?? 0
}

function remainingStock(product: CashierProduct) {
  return Math.max(0, product.quantity - cartQuantityFor(product.id))
}

function productDisplayName(product: CashierProduct) {
  return product.dosage ? `${product.name} — ${product.dosage}` : product.name
}

function selectCartLine(index: number) {
  selectedCartIndex.value = index
}

function addToCart(productId: string) {
  const product = productsById.value.get(productId)
  if (!product || product.quantity <= 0) return

  const current = cartQuantityFor(productId)
  if (current >= product.quantity) {
    message.value = translateTemplate('Stock insuffisant pour {name}.', { name: product.name })
    messageType.value = 'error'
    return
  }

  highlightedProductId.value = productId
  const existing = cart.value.find((line) => line.productId === productId)
  if (existing) {
    existing.quantity += 1
  } else {
    cart.value.push({ productId, quantity: 1 })
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
  if (next > product.quantity) {
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
    addToCart(exact.id)
    catalogSearch.value = ''
    void nextTick(() => searchRef.value?.focus())
    return
  }

  if (filteredCatalog.value.length === 1) {
    addToCart(filteredCatalog.value[0].id)
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

function printReceipt(data: {
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
}) {
  const clinic = CLINIC
  const grossTotal = data.grossTotal ?? data.total
  const reductionFcfa = data.reductionFcfa ?? 0
  const reductionPercent = data.reductionPercent
  let paymentModeLabel = 'Payé'
  if (data.isFree) paymentModeLabel = 'Gratuit'
  else if (reductionFcfa > 0) {
    paymentModeLabel = reductionPercent ? `Réduc. ${reductionPercent}%` : 'Réduction'
  }
  const coveredByBlock =
    data.coveredByName && (data.isFree || reductionFcfa > 0)
      ? thermalMetaRow('Par', data.coveredByName, '')
      : ''
  const internalBlock = !data.isExternal ? thermalMetaRow('Type', 'Interne', '') : ''
  const reductionLabel = reductionPercent ? `Réduc. ${reductionPercent}%` : 'Réduction'
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
    reductionLabel,
  })

  openPrintDocument(
    `Ticket ${data.invoiceNumber}`,
    `
<div class="thermal-receipt thermal-receipt--ticket thermal-receipt--pharmacy">
  ${buildThermalTicketHeadHtml({
    title: 'Clinique Alwatan Pharmacie',
    number: data.invoiceNumber,
    contact: `${clinic.city} · ${clinic.phones}`,
    logo: clinic.logo,
  })}
  <hr class="thermal-receipt__rule" />

  <div class="thermal-receipt__fields">
    ${thermalMetaRow('Date', data.date, '')}
    ${internalBlock}
    ${thermalMetaRow('Paiement', paymentModeLabel, '')}
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
  <p class="thermal-receipt__thanks">Merci</p>
</div>
`,
    { pageSize: '80mm', autoPrint: true, thermalTight: true },
  )
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
    cart.value.push({ productId: line.productId!, quantity: line.quantity })
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
  checkoutModalOpen.value = true
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

  if ((isFree || hasReduction) && responsible.length < 2) {
    message.value = 'Indiquez le nom de la personne responsable.'
    messageType.value = 'error'
    return null
  }
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

function pickSaleForReturn(sale: PharmacySaleForReturn) {
  returnSale.value = sale
  returnPickerOpen.value = false
  returnModalOpen.value = true
}

async function onReturnSuccess() {
  await loadTodayReturnableSales()
  emit('refresh')
}

async function submitSale() {
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

  submitting.value = true
  message.value = ''

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
      items: cart.value.map((line) => ({ productId: line.productId, quantity: line.quantity })),
    })

    message.value = saleSuccessMessage(data)
    messageType.value = 'success'

    if (printItems.length && data.invoice) {
      const isExternal = buyerType.value === 'external'
      printReceipt({
        items: printItems,
        notes: isExternal ? undefined : notes.value.trim(),
        invoiceNumber: data.invoice.invoiceNumber,
        total: data.total,
        grossTotal: data.grossTotal,
        reductionFcfa: data.reductionFcfa,
        reductionPercent: adjustment.hasReduction ? selectedReductionPercent.value : undefined,
        coveredByName: data.coveredByName,
        isFree: data.isFree,
        date: new Date().toLocaleString('fr-FR'),
        isExternal,
      })
    }

    clearCart()
    checkoutModalOpen.value = false
    resetBuyerFields()
    emit('changed')
    void loadPendingOrdonnances('')
    void loadTodayReturnableSales()
    void nextTick(() => searchRef.value?.focus())
  } catch (error: unknown) {
    const apiMessage =
      error && typeof error === 'object' && 'response' in error
        ? (error as { response?: { data?: { error?: string } } }).response?.data?.error
        : undefined
    message.value = apiMessage ?? 'Stock insuffisant ou erreur de saisie.'
    messageType.value = 'error'
  } finally {
    submitting.value = false
  }
}

function openCheckoutModal() {
  if (!cart.value.length) {
    message.value = 'Le panier est vide.'
    messageType.value = 'error'
    return
  }
  message.value = ''
  checkoutModalOpen.value = true
}

async function toggleFullscreen() {
  if (document.fullscreenElement) {
    await document.exitFullscreen()
  } else {
    await rootRef.value?.requestFullscreen()
  }
}

function onFullscreenChange() {
  isFullscreen.value = Boolean(document.fullscreenElement)
}

onMounted(() => {
  document.addEventListener('fullscreenchange', onFullscreenChange)
  searchRef.value?.focus()
  void loadPendingOrdonnances('').then(() => {
    /* compteur badge uniquement */
  })
  void loadTodayReturnableSales()
})

onUnmounted(() => {
  document.removeEventListener('fullscreenchange', onFullscreenChange)
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
          {{ uiText('Ordonnances médecin') }}
          <span v-if="pendingOrdonnancesCount > 0" class="cashier__badge">{{ pendingOrdonnancesCount }}</span>
        </UiButton>
        <UiButton variant="ghost" size="sm" :icon="isFullscreen ? Minimize2 : Maximize2" @click="toggleFullscreen">
          {{ isFullscreen ? uiText('Quitter plein écran') : uiText('Plein écran') }}
        </UiButton>
        <UiButton variant="ghost" size="sm" :icon="RefreshCw" :disabled="loading" @click="emit('refresh')">
          {{ uiText('Actualiser') }}
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
          <Search :size="16" class="catalog-search__icon" aria-hidden="true" />
          <input
            ref="searchRef"
            v-model="catalogSearch"
            type="search"
            class="catalog-search__input"
            :placeholder="uiText('Rechercher ou scanner un code-barres…')"
            :aria-label="uiText('Rechercher dans le catalogue')"
            @keydown="onSearchKeydown"
          />
        </div>
        <p class="catalog-hint">{{ uiText('Saisie : filtre la liste · Lecteur USB : scan + Entrée ajoute au panier') }}</p>

        <div class="catalog-table-wrap">
          <table class="catalog-table">
            <thead>
              <tr>
                <th>#</th>
                <th>{{ uiText('Code') }}</th>
                <th>{{ uiText('Nom') }}</th>
                <th>{{ uiText('Stock') }}</th>
                <th>{{ uiText('Prix') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!filteredCatalog.length">
                <td colspan="5" class="catalog-empty">{{ uiText('Aucun produit trouvé') }}</td>
              </tr>
              <tr
                v-for="(product, index) in filteredCatalog"
                :key="product.id"
                class="catalog-row"
                :class="{
                  'catalog-row--active': highlightedProductId === product.id,
                  'catalog-row--out': product.quantity <= 0,
                }"
                tabindex="0"
                @click="product.quantity > 0 && addToCart(product.id)"
                @keydown.enter.prevent="product.quantity > 0 && addToCart(product.id)"
              >
                <td>{{ index + 1 }}</td>
                <td>{{ product.sku }}</td>
                <td>{{ productDisplayName(product) }}</td>
                <td>{{ remainingStock(product) }}</td>
                <td>{{ formatFcfa(product.unitPriceFcfa) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="cashier-panel cashier-panel--cart">
        <header class="cashier-panel__head cashier-panel__head--blue">
          <ShoppingCart :size="18" />
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
                :key="row.productId"
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
          <div v-if="selectedCartRow" class="cart-controls">
            <UiButton
              type="button"
              variant="secondary"
              size="sm"
              :icon="Minus"
              @click="changeCartQuantity(selectedCartRow.index, -1)"
            />
            <UiButton
              type="button"
              variant="secondary"
              size="sm"
              :icon="Plus"
              @click="changeCartQuantity(selectedCartRow.index, 1)"
            />
            <UiButton
              type="button"
              variant="danger"
              size="sm"
              :icon="Trash2"
              @click="removeFromCart(selectedCartRow.index)"
            >
              {{ uiText('Retirer') }}
            </UiButton>
          </div>

          <div class="cart-total">
            <span class="cart-total__label">{{ uiText('Total à payer') }}</span>
            <strong class="cart-total__value">{{ formatFcfa(cartTotalFcfa) }}</strong>
            <span class="cart-total__meta">{{ translateTemplate('{n} article(s)', { n: cartArticlesCount }) }}</span>
          </div>

          <div class="cart-actions">
            <UiButton type="button" variant="secondary" :disabled="!cart.length || submitting" @click="clearCart">
              {{ uiText('Vider le panier') }}
            </UiButton>
            <UiButton
              type="button"
              variant="primary"
              :icon="PillBottle"
              :disabled="!cart.length || submitting"
              @click="openCheckoutModal"
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
        </footer>
      </section>
    </div>

    <UiFormModal
      v-if="checkoutModalOpen"
      title="Finaliser la vente"
      subtitle="Choisissez le type d'acheteur et complétez les informations avant validation."
      size="wide"
      @close="checkoutModalOpen = false"
    >
      <div class="buyer-type">
        <label class="buyer-type__option" :class="{ 'buyer-type__option--locked': Boolean(linkedVisitId) }">
          <input v-model="buyerType" type="radio" value="external" :disabled="Boolean(linkedVisitId)" />
          <UserRound :size="14" />
          <span>{{ uiText('Client externe') }}</span>
        </label>
        <label class="buyer-type__option" :class="{ 'buyer-type__option--locked': Boolean(linkedVisitId) }">
          <input v-model="buyerType" type="radio" value="patient" :disabled="Boolean(linkedVisitId)" />
          <FileText :size="14" />
          <span>{{ uiText('Patient clinique') }}</span>
        </label>
      </div>

      <template v-if="buyerType === 'external'">
        <div class="checkout-form-grid">
          <UiInput
            v-model="externalClientName"
            label="Nom du client (optionnel)"
            placeholder="Ex. Mahamat Ali"
          />
          <UiInput
            v-model="externalClientPhone"
            label="Téléphone (optionnel)"
            placeholder="Ex. 66 00 00 00"
          />
        </div>
      </template>
      <template v-else>
        <div v-if="linkedVisitId && linkedPatient" class="checkout-linked-patient">
          <p class="checkout-linked-patient__name">
            {{ fullName(linkedPatient.firstName, linkedPatient.lastName) }}
            <span class="checkout-linked-patient__code">{{ linkedPatient.code }}</span>
          </p>
          <p class="checkout-ordonnance-hint">
            {{ uiText('Ordonnance médecin — patient déjà identifié, aucune resélection nécessaire.') }}
          </p>
        </div>
        <div v-else class="checkout-form-grid">
          <UiSelect v-model="patientId" label="Patient">
            <option value="">{{ uiText('Sélectionner un patient') }}</option>
            <option v-for="p in patientsForSelect" :key="p.id" :value="p.id">
              {{ p.code }} — {{ fullName(p.firstName, p.lastName) }}
            </option>
          </UiSelect>
          <UiTextarea v-model="notes" :label="uiText('Notes ordonnance')" :rows="3" />
        </div>
      </template>

      <div class="checkout-form-grid">
        <UiSelect v-model="adjustmentMode" label="Mode de règlement">
          <option value="none">{{ uiText('Paiement normal') }}</option>
          <option value="reduction">{{ uiText('Réduction') }}</option>
          <option value="free">{{ uiText('Prise en charge gratuite') }}</option>
        </UiSelect>
        <UiSelect
          v-if="adjustmentMode === 'reduction'"
          v-model="reductionPercent"
          :label="reductionPercentLabel"
        >
          <option v-for="pct in REDUCTION_PERCENT_OPTIONS" :key="pct" :value="String(pct)">
            {{ pct }} %
          </option>
        </UiSelect>
        <UiInput
          v-if="adjustmentMode !== 'none'"
          v-model="coveredByName"
          label="Nom de la personne responsable"
          placeholder="Ex. Dr Mahamat / ONG Al Watan"
        />
      </div>

      <template #footer>
        <UiButton type="button" variant="secondary" :disabled="submitting" @click="checkoutModalOpen = false">
          {{ uiText('Annuler') }}
        </UiButton>
        <UiButton type="button" variant="primary" :icon="PillBottle" :disabled="submitting" @click="submitSale">
          {{
            submitting
              ? uiText('Validation…')
              : buyerType === 'external'
                ? uiText('Valider la vente')
                : uiText('Valider la dispensation')
          }}
        </UiButton>
      </template>
    </UiFormModal>

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
      <ul v-else class="return-picker">
        <li v-for="sale in todayReturnableSales" :key="sale.id">
          <button type="button" class="return-picker__btn" @click="pickSaleForReturn(sale)">
            <strong>{{ sale.invoiceNumber ?? sale.id.slice(0, 8) }}</strong>
            <span>{{ new Date(sale.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) }}</span>
            <span>{{ sale.lines.length }} {{ uiText('ligne(s)') }}</span>
          </button>
        </li>
      </ul>
      <template #footer>
        <UiButton variant="ghost" @click="returnPickerOpen = false">{{ uiText('Fermer') }}</UiButton>
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
  position: relative;
  background: #f8faf6;
  padding: 1rem;
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
  gap: 1rem;
  margin-bottom: 0.85rem;
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
  grid-template-columns: minmax(0, 1.3fr) minmax(360px, 1fr);
  gap: 1rem;
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

.catalog-table-wrap {
  flex: 1;
  min-height: 0;
  overflow: auto;
  border-top: 1px solid var(--border);
}

.cart-table-wrap {
  flex: 1;
  min-height: 14rem;
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

.catalog-table,
.cart-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8125rem;
}

.catalog-table th,
.cart-table th {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 0.55rem 0.65rem;
  text-align: left;
  background: #f8fafc;
  color: var(--text-muted);
  font-size: 0.72rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  border-bottom: 1px solid var(--border);
}

.catalog-table td,
.cart-table td {
  padding: 0.55rem 0.65rem;
  border-bottom: 1px solid #eef2f7;
  vertical-align: middle;
}

.catalog-row {
  cursor: pointer;
  transition: background 0.12s ease;
}

.catalog-row:hover {
  background: #f0fdf4;
}

.catalog-row--active {
  background: #dcfce7;
}

.catalog-row--out {
  opacity: 0.45;
  cursor: not-allowed;
}

.catalog-row--out:hover {
  background: transparent;
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

.cart-controls {
  display: flex;
  gap: 0.5rem;
  padding: 0.65rem 1rem 0;
  flex-wrap: wrap;
  flex-shrink: 0;
}

.cart-total {
  margin: 0.65rem 1rem 0;
  padding: 0.75rem 0.9rem;
  border-radius: 12px;
  background: linear-gradient(135deg, #ecfdf5, #d1fae5);
  border: 1px solid #86efac;
  text-align: center;
  flex-shrink: 0;
}

.cart-total__label {
  display: block;
  font-size: 0.78rem;
  font-weight: 700;
  color: #166534;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.cart-total__value {
  display: block;
  margin-top: 0.35rem;
  font-size: 1.45rem;
  line-height: 1.1;
  color: #14532d;
}

.cart-total__meta {
  display: block;
  margin-top: 0.35rem;
  font-size: 0.75rem;
  color: #166534;
}

.cart-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.65rem;
  padding: 0.65rem 1rem 0.85rem;
  flex-shrink: 0;
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

@media (max-width: 768px) {
  .checkout-form-grid,
  .checkout-adjustment {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 1100px) {
  .cashier__grid {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
    overflow: auto;
  }
}

@media (max-width: 768px) {
  .external-client-row {
    grid-template-columns: 1fr;
  }

  .cart-actions {
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
