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
} from '@lucide/vue'
import api from '@/api/client'
import { CLINIC } from '@/lib/clinic'
import { formatFcfa, fullName } from '@/lib/roles'
import { openPrintDocument } from '@/lib/print-document'
import UiSelect from '@/components/ui/UiSelect.vue'
import UiTextarea from '@/components/ui/UiTextarea.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiFormModal from '@/components/ui/UiFormModal.vue'

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

const props = defineProps<{
  products: CashierProduct[]
  patients: CashierPatient[]
  loading?: boolean
}>()

const emit = defineEmits<{
  changed: []
  refresh: []
}>()

const rootRef = ref<HTMLElement | null>(null)
const searchRef = ref<HTMLInputElement | null>(null)
const isFullscreen = ref(false)
const catalogSearch = ref('')
const buyerType = ref<BuyerType>('external')
const patientId = ref('')
const externalClientName = ref('')
const externalClientPhone = ref('')
const notes = ref('')
const cart = ref<CartLine[]>([])
const selectedCartIndex = ref<number | null>(null)
const highlightedProductId = ref<string | null>(null)
const message = ref('')
const messageType = ref<'success' | 'error'>('success')
const submitting = ref(false)
const checkoutModalOpen = ref(false)
const adjustmentMode = ref<CheckoutAdjustmentMode>('none')
const reductionFcfaInput = ref('')
const coveredByName = ref('')

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
    message.value = `Stock insuffisant pour ${product.name}.`
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
    message.value = `Stock maximum : ${product.quantity} pour ${product.name}.`
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
      ? `Vente enregistrée — facture ${data.invoice.invoiceNumber} (${formatFcfa(data.total)})`
      : `Ordonnance enregistrée — facture ${data.invoice.invoiceNumber} (${formatFcfa(data.total)})`
  }
  if (data.billingDeferred) {
    return `Ordonnance enregistrée — facturation différée (${formatFcfa(data.total)})`
  }
  return 'Ordonnance enregistrée — prise en charge gratuite'
}

function printReceipt(data: {
  buyerLabel: string
  buyerCode: string
  items: PrescriptionPrintLine[]
  notes?: string
  invoiceNumber: string
  total: number
  date: string
  isExternal?: boolean
  grossTotal?: number
  reductionFcfa?: number
  coveredByName?: string | null
  isFree?: boolean
}) {
  const clinic = CLINIC
  const thermalRows = data.items
    .map(
      (item) => `
    <tr>
      <td>${item.name}</td>
      <td>${item.quantity}</td>
      <td>${formatFcfa(item.lineTotal)}</td>
    </tr>`,
    )
    .join('')

  const grossTotal = data.grossTotal ?? data.total
  const reductionFcfa = data.reductionFcfa ?? 0
  let paymentModeLabel = 'Paiement normal'
  if (data.isFree) paymentModeLabel = 'Prise en charge gratuite'
  else if (reductionFcfa > 0) paymentModeLabel = 'Réduction accordée'
  const coveredByBlock =
    data.coveredByName && (data.isFree || reductionFcfa > 0)
      ? `<div class="thermal-receipt__row thermal-receipt__row--stack"><span>Responsable</span><strong>${data.coveredByName}</strong></div>`
      : ''

  openPrintDocument(
    `${data.isExternal ? 'Vente' : 'Ordonnance'} ${data.buyerCode}`,
    `
<div class="thermal-receipt">
  <header class="thermal-receipt__head">
    <img src="${clinic.logo}" alt="${clinic.nameFr}" class="thermal-receipt__logo" />
    <p class="thermal-receipt__name-ar" dir="rtl">${clinic.nameAr}</p>
    <p class="thermal-receipt__name">${clinic.nameFr}</p>
    <p class="thermal-receipt__contact">${clinic.fullAddress}</p>
    <p class="thermal-receipt__contact">${clinic.phones}</p>
  </header>

  <hr class="thermal-receipt__rule" />
  <h1 class="thermal-receipt__title">${data.isExternal ? 'Vente pharmacie' : 'Ordonnance pharmacie'}</h1>
  <p class="thermal-receipt__subtitle">${data.invoiceNumber}</p>
  <hr class="thermal-receipt__rule" />

  <div class="thermal-receipt__fields">
    <div class="thermal-receipt__row"><span>Date</span><strong>${data.date}</strong></div>
    <div class="thermal-receipt__row thermal-receipt__row--stack"><span>Acheteur</span><strong>${data.buyerLabel}</strong></div>
    <div class="thermal-receipt__row"><span>Référence</span><strong>${data.buyerCode}</strong></div>
    <div class="thermal-receipt__row"><span>Règlement</span><strong>${paymentModeLabel}</strong></div>
    ${coveredByBlock}
  </div>

  <hr class="thermal-receipt__rule" />
  <table>
    <thead><tr><th>Produit</th><th>Qté</th><th>Total</th></tr></thead>
    <tbody>${thermalRows}</tbody>
  </table>
  <div class="thermal-receipt__fields">
    <div class="thermal-receipt__row"><span>Sous-total</span><strong>${formatFcfa(grossTotal)}</strong></div>
    ${reductionFcfa > 0 ? `<div class="thermal-receipt__row"><span>Réduction</span><strong>- ${formatFcfa(reductionFcfa)}</strong></div>` : ''}
    <div class="thermal-receipt__row"><span>Total payé</span><strong>${formatFcfa(data.total)}</strong></div>
  </div>
  ${data.notes ? `<p class="thermal-receipt__note"><strong>Notes:</strong> ${data.notes}</p>` : ''}
  <hr class="thermal-receipt__rule" />
  <p class="thermal-receipt__thanks">Merci de votre confiance</p>
</div>
`,
    { pageSize: '80mm', autoPrint: true },
  )
}

function resetBuyerFields() {
  notes.value = ''
  patientId.value = ''
  externalClientName.value = ''
  externalClientPhone.value = ''
  adjustmentMode.value = 'none'
  reductionFcfaInput.value = ''
  coveredByName.value = ''
}

function resolveCheckoutAdjustment(): CheckoutAdjustment | null {
  const reductionFcfaRaw = Number.parseInt(reductionFcfaInput.value || '0', 10)
  const reductionFcfa = Number.isFinite(reductionFcfaRaw) ? Math.max(0, reductionFcfaRaw) : 0
  const isFree = adjustmentMode.value === 'free'
  const hasReduction = adjustmentMode.value === 'reduction'
  const responsible = coveredByName.value.trim()

  if ((isFree || hasReduction) && responsible.length < 2) {
    message.value = 'Indiquez le nom de la personne responsable.'
    messageType.value = 'error'
    return null
  }
  if (hasReduction && reductionFcfa <= 0) {
    message.value = 'Indiquez un montant de réduction valide.'
    messageType.value = 'error'
    return null
  }
  if (hasReduction && reductionFcfa > cartTotalFcfa.value) {
    message.value = 'La réduction ne peut pas dépasser le total du panier.'
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

function validateBuyerSelection(externalName: string) {
  if (buyerType.value === 'patient' && !patientId.value) {
    message.value = 'Sélectionnez un patient.'
    messageType.value = 'error'
    return false
  }
  if (buyerType.value === 'external' && externalName.length < 2) {
    message.value = 'Indiquez le nom du client externe.'
    messageType.value = 'error'
    return false
  }
  return true
}

async function submitSale() {
  const selectedPatient = props.patients.find((p) => p.id === patientId.value)
  const externalName = externalClientName.value.trim()

  if (!validateBuyerSelection(externalName)) return
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
        ? { patientId: patientId.value, notes: notes.value }
        : {
            externalClientName: externalName,
            externalClientPhone: externalClientPhone.value.trim() || undefined,
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
        buyerLabel: isExternal
          ? externalName
          : fullName(selectedPatient!.firstName, selectedPatient!.lastName),
        buyerCode: isExternal
          ? data.externalClient?.code ?? '—'
          : selectedPatient!.code,
        items: printItems,
        notes: isExternal ? undefined : notes.value.trim(),
        invoiceNumber: data.invoice.invoiceNumber,
        total: data.total,
        grossTotal: data.grossTotal,
        reductionFcfa: data.reductionFcfa,
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
    void nextTick(() => searchRef.value?.focus())
  } catch {
    message.value = 'Stock insuffisant ou erreur de saisie.'
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
          <h2 class="cashier__title">Caisse</h2>
          <p class="cashier__subtitle">Vente au comptoir et dispensation</p>
        </div>
      </div>
      <div class="cashier__head-actions">
        <UiButton variant="ghost" size="sm" :icon="isFullscreen ? Minimize2 : Maximize2" @click="toggleFullscreen">
          {{ isFullscreen ? 'Quitter plein écran' : 'Plein écran' }}
        </UiButton>
        <UiButton variant="ghost" size="sm" :icon="RefreshCw" :disabled="loading" @click="emit('refresh')">
          Actualiser
        </UiButton>
      </div>
    </header>

    <UiAlert v-if="message" :type="messageType" :message="message" class="cashier__alert" />

    <div class="cashier__grid">
      <section class="cashier-panel cashier-panel--catalog">
        <header class="cashier-panel__head cashier-panel__head--green">
          <Package :size="18" />
          <div>
            <h3>Catalogue</h3>
            <p>{{ filteredCatalog.length }} médicament(s)</p>
          </div>
        </header>

        <div class="catalog-search">
          <Search :size="16" class="catalog-search__icon" aria-hidden="true" />
          <input
            ref="searchRef"
            v-model="catalogSearch"
            type="search"
            class="catalog-search__input"
            placeholder="Rechercher ou scanner un code-barres…"
            aria-label="Rechercher dans le catalogue"
            @keydown="onSearchKeydown"
          />
        </div>
        <p class="catalog-hint">Saisie : filtre la liste · Lecteur USB : scan + Entrée ajoute au panier</p>

        <div class="catalog-table-wrap">
          <table class="catalog-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Code</th>
                <th>Nom</th>
                <th>Stock</th>
                <th>Prix</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!filteredCatalog.length">
                <td colspan="5" class="catalog-empty">Aucun produit trouvé</td>
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
            <h3>Panier</h3>
            <p>{{ cartArticlesCount }} article(s)</p>
          </div>
        </header>

        <div class="cart-table-wrap">
          <table class="cart-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Article</th>
                <th>Qté</th>
                <th>Prix unit.</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!cartRows.length">
                <td colspan="5" class="cart-empty">Panier vide — cliquez un produit du catalogue</td>
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
              Retirer
            </UiButton>
          </div>

          <div class="cart-total">
            <span class="cart-total__label">Total à payer</span>
            <strong class="cart-total__value">{{ formatFcfa(cartTotalFcfa) }}</strong>
            <span class="cart-total__meta">{{ cartArticlesCount }} article(s)</span>
          </div>

          <div class="cart-actions">
            <UiButton type="button" variant="secondary" :disabled="!cart.length || submitting" @click="clearCart">
              Vider le panier
            </UiButton>
            <UiButton
              type="button"
              variant="primary"
              :icon="PillBottle"
              :disabled="!cart.length || submitting"
              @click="openCheckoutModal"
            >
              {{ submitting ? 'Validation…' : buyerType === 'external' ? 'Valider la vente' : 'Valider la dispensation' }}
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
        <label class="buyer-type__option">
          <input v-model="buyerType" type="radio" value="external" />
          <UserRound :size="14" />
          <span>Client externe</span>
        </label>
        <label class="buyer-type__option">
          <input v-model="buyerType" type="radio" value="patient" />
          <FileText :size="14" />
          <span>Patient clinique</span>
        </label>
      </div>

      <template v-if="buyerType === 'external'">
        <div class="checkout-form-grid">
          <UiInput v-model="externalClientName" label="Nom du client" placeholder="Ex. Mahamat Ali" />
          <UiInput v-model="externalClientPhone" label="Téléphone" placeholder="Optionnel" />
        </div>
      </template>
      <template v-else>
        <div class="checkout-form-grid">
          <UiSelect v-model="patientId" label="Patient">
            <option value="">Sélectionner un patient</option>
            <option v-for="p in patients" :key="p.id" :value="p.id">
              {{ p.code }} — {{ fullName(p.firstName, p.lastName) }}
            </option>
          </UiSelect>
          <UiTextarea v-model="notes" label="Notes ordonnance" :rows="3" />
        </div>
      </template>

      <div class="checkout-form-grid">
        <UiSelect v-model="adjustmentMode" label="Mode de règlement">
          <option value="none">Paiement normal</option>
          <option value="reduction">Réduction</option>
          <option value="free">Prise en charge gratuite</option>
        </UiSelect>
        <UiInput
          v-if="adjustmentMode === 'reduction'"
          v-model="reductionFcfaInput"
          type="number"
          min="0"
          step="1"
          label="Montant réduction (FCFA)"
          placeholder="Ex. 5000"
        />
        <UiInput
          v-if="adjustmentMode !== 'none'"
          v-model="coveredByName"
          label="Nom de la personne responsable"
          placeholder="Ex. Dr Mahamat / ONG Al Watan"
        />
      </div>

      <template #footer>
        <UiButton type="button" variant="secondary" :disabled="submitting" @click="checkoutModalOpen = false">
          Annuler
        </UiButton>
        <UiButton type="button" variant="primary" :icon="PillBottle" :disabled="submitting" @click="submitSale">
          {{ submitting ? 'Validation…' : buyerType === 'external' ? 'Valider la vente' : 'Valider la dispensation' }}
        </UiButton>
      </template>
    </UiFormModal>
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
  background: #f8faf6;
  padding: 1rem;
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

.cashier__alert {
  margin: 0;
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
</style>
