<script setup lang="ts">
import { computed, ref } from 'vue'
import { FileText, Plus, Save, Trash2 } from '@lucide/vue'
import api from '@/api/client'
import { formatFcfa } from '@/lib/roles'
import UiFormModal from '@/components/ui/UiFormModal.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import PharmacyProductSuggest, { type SuggestProduct } from '@/components/pharmacie/PharmacyProductSuggest.vue'
import type { PharmacyProductRecord } from '@/components/pharmacie/PharmacyProductsPanel.vue'
import { showApiErrorModal, showSuccessModal } from '@/lib/api-modal-helper'
import { useAppI18n } from '@/i18n/useAppI18n'
import { translateTemplate } from '@/lib/dashboard-i18n'
import { useAuthStore } from '@/stores/auth'

type Option = { id: string; name: string; active?: boolean }

type PurchaseLine = {
  key: number
  name: string
  productId: string | null
  dosage: string
  quantity: string
  purchasePrice: string
  salePrice: string
  expiryDate: string
  noExpiry: boolean
}

const props = defineProps<{
  products: PharmacyProductRecord[]
  suppliers: Option[]
}>()

const emit = defineEmits<{ close: []; saved: [] }>()

const { uiText } = useAppI18n()

const auth = useAuthStore()
const payerName = computed(() =>
  auth.user ? `${auth.user.firstName} ${auth.user.lastName}`.trim() || auth.user.username : '',
)

function todayIso() {
  const now = new Date()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${m}-${d}`
}

const supplierId = ref('')
const invoiceNumber = ref('')
const businessDate = ref('')
const comment = ref('')
const lines = ref<PurchaseLine[]>([])
const saving = ref(false)
const error = ref('')
let nextKey = 1

const productsById = computed(() => new Map(props.products.map((p) => [p.id, p])))
const activeSuppliers = computed(() => props.suppliers.filter((s) => s.active !== false))

function toInt(value: string) {
  const n = Math.round(Number(value))
  return Number.isFinite(n) && n > 0 ? n : 0
}

function lineTotal(line: PurchaseLine) {
  return toInt(line.quantity) * toInt(line.purchasePrice)
}

const totalFcfa = computed(() => lines.value.reduce((sum, line) => sum + lineTotal(line), 0))


function emptyLine(): PurchaseLine {
  return {
    key: nextKey++,
    name: '',
    productId: null,
    dosage: '',
    quantity: '1',
    purchasePrice: '',
    salePrice: '',
    expiryDate: '',
    noExpiry: false,
  }
}

function addLine() {
  lines.value.push(emptyLine())
}

function removeLine(key: number) {
  lines.value = lines.value.filter((line) => line.key !== key)
  if (!lines.value.length) addLine()
}

function onNameInput(line: PurchaseLine, value: string) {
  line.name = value
  // Le nom modifié à la main ne désigne plus le produit choisi.
  if (line.productId) {
    const product = productsById.value.get(line.productId)
    if (!product || product.name !== value) line.productId = null
  }
}

function onPick(line: PurchaseLine, item: SuggestProduct) {
  const product = productsById.value.get(item.id)
  if (!product) return
  line.productId = product.id
  line.name = product.name
  line.dosage = product.dosage ?? ''
  line.purchasePrice = product.purchasePriceFcfa ? String(product.purchasePriceFcfa) : ''
  line.salePrice = String(product.unitPriceFcfa)
  line.noExpiry = product.noExpiry
  line.expiryDate = product.expiryDate ? product.expiryDate.slice(0, 10) : ''
}

function productLabel(line: PurchaseLine) {
  if (!line.productId) return ''
  const product = productsById.value.get(line.productId)
  return product ? translateTemplate('En stock : {qty}', { qty: product.quantity }) : ''
}

function validate(): string {
  if (!supplierId.value) return uiText('Choisissez le fournisseur.')
  if (!invoiceNumber.value.trim()) return uiText('Indiquez le numéro de la facture.')
  if (!businessDate.value) return uiText('Indiquez la date de la facture.')
  const filled = lines.value.filter((line) => line.name.trim())
  if (!filled.length) return uiText('Ajoutez au moins un produit.')
  for (const line of filled) {
    if (!toInt(line.quantity)) return translateTemplate('Quantité invalide pour « {name} ».', { name: line.name })
    if (!toInt(line.purchasePrice)) {
      return translateTemplate("Prix d'achat manquant pour « {name} ».", { name: line.name })
    }
    if (!line.productId && !toInt(line.salePrice)) {
      return translateTemplate('Prix de vente requis pour le nouveau produit « {name} ».', { name: line.name })
    }
  }
  return ''
}

async function save() {
  error.value = validate()
  if (error.value) return
  saving.value = true
  try {
    const payloadLines = lines.value
      .filter((line) => line.name.trim())
      .map((line) => ({
        productId: line.productId,
        newProduct: line.productId
          ? null
          : { name: line.name.trim(), dosage: line.dosage.trim() || null },
        quantity: toInt(line.quantity),
        purchasePriceFcfa: toInt(line.purchasePrice),
        unitPriceFcfa: toInt(line.salePrice) || null,
        expiryDate: line.noExpiry ? null : line.expiryDate || null,
        noExpiry: line.noExpiry,
      }))
    const { data } = await api.post<{ totalFcfa: number; linesCount: number }>('/pharmacie/purchases', {
      supplierId: supplierId.value,
      invoiceNumber: invoiceNumber.value.trim(),
      businessDate: businessDate.value,
      comment: comment.value.trim() || undefined,
      lines: payloadLines,
    })
    emit('saved')
    emit('close')
    await showSuccessModal(
      uiText('Facture enregistrée'),
      translateTemplate(
        '{count} produit(s) ajouté(s) au stock. {amount} déduits de votre caisse — sortie enregistrée en comptabilité.',
        {
          count: data.linesCount,
          amount: formatFcfa(data.totalFcfa),
        },
      ),
    )
  } catch (err) {
    await showApiErrorModal(err, uiText("Impossible d'enregistrer la facture."))
  } finally {
    saving.value = false
  }
}

addLine()
businessDate.value = todayIso()
</script>

<template>
  <UiFormModal
    title-id="pharmacy-purchase-modal-title"
    :title="uiText('Ajout de produits par facture')"
    :subtitle="uiText('Le stock est augmenté et le total est sorti de votre caisse.')"
    size="xlarge"
    :icon="FileText"
    @close="emit('close')"
  >
    <UiAlert v-if="error" type="error" :message="error" />

    <form id="pharmacy-purchase-form" class="purchase-form" novalidate @submit.prevent="save">
      <div class="purchase-form__head">
        <UiSelect v-model="supplierId" label="Fournisseur" required>
          <option value="">{{ uiText('Sélectionner un fournisseur') }}</option>
          <option v-for="s in activeSuppliers" :key="s.id" :value="s.id">{{ s.name }}</option>
        </UiSelect>
        <UiInput v-model="invoiceNumber" label="N° de facture" placeholder="Ex. FA-2026-0142" required />
        <UiInput v-model="businessDate" label="Date de la facture" type="date" required />
      </div>

      <div class="purchase-lines" :aria-label="uiText('Lignes de la facture')">
        <div v-for="(line, index) in lines" :key="line.key" class="purchase-line">
          <label class="purchase-field purchase-field--product">
            <span class="purchase-field__label">{{ uiText('Produit') }} {{ index + 1 }}</span>
            <PharmacyProductSuggest
              :model-value="line.name"
              variant="field"
              :aria-label="uiText('Produit')"
              :placeholder="uiText('Rechercher ou saisir un nouveau')"
              :items="products"
              @update:model-value="onNameInput(line, $event)"
              @pick="onPick(line, $event)"
            />
            <span v-if="line.productId" class="purchase-line__tag">{{ productLabel(line) }}</span>
            <span v-else-if="line.name.trim()" class="purchase-line__tag purchase-line__tag--new">
              {{ uiText('Nouveau produit') }}
            </span>
          </label>
          <label class="purchase-field purchase-field--dosage">
            <span class="purchase-field__label">{{ uiText('Dosage') }}</span>
            <input
              v-model="line.dosage"
              class="purchase-line__input"
              :placeholder="uiText('500 mg')"
              :disabled="!!line.productId"
            />
          </label>
          <label class="purchase-field purchase-field--qty">
            <span class="purchase-field__label">{{ uiText('Qté') }}</span>
            <input v-model="line.quantity" class="purchase-line__input" type="number" min="1" />
          </label>
          <label class="purchase-field purchase-field--purchase">
            <span class="purchase-field__label">{{ uiText("Prix d'achat unit.") }}</span>
            <input v-model="line.purchasePrice" class="purchase-line__input" type="number" min="1" placeholder="FCFA" />
          </label>
          <button
            type="button"
            class="purchase-line__remove"
            :aria-label="uiText('Retirer la ligne')"
            @click="removeLine(line.key)"
          >
            <Trash2 :size="15" />
          </button>
          <label class="purchase-field purchase-field--sale">
            <span class="purchase-field__label">{{ uiText('Prix de vente') }}</span>
            <input v-model="line.salePrice" class="purchase-line__input" type="number" min="1" placeholder="FCFA" />
          </label>
          <div class="purchase-field purchase-field--expiry">
            <span class="purchase-field__label">{{ uiText('Expiration') }}</span>
            <div class="purchase-line__expiry">
              <input
                v-model="line.expiryDate"
                class="purchase-line__input"
                type="date"
                :disabled="line.noExpiry"
                :aria-label="uiText(`Date d'expiration`)"
              />
              <label class="purchase-line__noexp">
                <input v-model="line.noExpiry" type="checkbox" />
                <span>{{ uiText('Aucune') }}</span>
              </label>
            </div>
          </div>
          <div class="purchase-field purchase-field--total">
            <span class="purchase-field__label">{{ uiText('Total ligne') }}</span>
            <span class="purchase-line__total">{{ formatFcfa(lineTotal(line)) }}</span>
          </div>
        </div>
      </div>

      <UiButton variant="ghost" size="sm" type="button" :icon="Plus" @click="addLine">
        {{ uiText('Ajouter une ligne') }}
      </UiButton>

      <UiInput v-model="comment" label="Commentaire (optionnel)" placeholder="Ex. livraison partielle" />
    </form>

    <template #footer>
      <div class="purchase-form__sum">
        <span>{{ uiText('Total facture (sortie de caisse)') }}</span>
        <strong>{{ formatFcfa(totalFcfa) }}</strong>
        <small v-if="payerName">{{ translateTemplate('Caisse de {name}', { name: payerName }) }}</small>
      </div>
      <UiButton variant="ghost" type="button" @click="emit('close')">{{ uiText('Annuler') }}</UiButton>
      <UiButton
        variant="primary"
        type="submit"
        form="pharmacy-purchase-form"
        :icon="Save"
        :loading="saving"
        :disabled="saving"
      >
        {{ saving ? uiText('Enregistrement…') : uiText('Enregistrer la facture') }}
      </UiButton>
    </template>
  </UiFormModal>
</template>

<style scoped>
.purchase-form {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.purchase-form__head {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.6rem;
}

.purchase-lines {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

/* Deux rangées par produit : identification puis prix / expiration. */
.purchase-line {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 1fr) minmax(0, 0.7fr) minmax(0, 1fr) 2rem;
  grid-template-areas:
    'product dosage qty purchase remove'
    'sale expiry expiry total total';
  gap: 0.45rem 0.6rem;
  align-items: start;
  padding: 0.6rem 0.7rem;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: #f8fafc;
}

.purchase-field {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 0;
}

.purchase-field__label {
  font-size: 0.6875rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  color: var(--text-muted);
}

.purchase-field--product { grid-area: product; }
.purchase-field--dosage { grid-area: dosage; }
.purchase-field--qty { grid-area: qty; }
.purchase-field--purchase { grid-area: purchase; }
.purchase-field--sale { grid-area: sale; }
.purchase-field--expiry { grid-area: expiry; }
.purchase-field--total { grid-area: total; text-align: right; }

.purchase-line__tag {
  font-size: 0.6875rem;
  color: var(--text-muted);
}

.purchase-line__tag--new {
  color: #b45309;
  font-weight: 600;
}

.purchase-line__input {
  width: 100%;
  min-width: 0;
  padding: 0.45rem 0.5rem;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: #fff;
  font-family: inherit;
  font-size: 0.8125rem;
}

.purchase-line__input:disabled {
  background: #f1f5f9;
  color: var(--text-muted);
}

.purchase-line__expiry {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.purchase-line__expiry .purchase-line__input {
  flex: 1;
}

.purchase-line__noexp {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.75rem;
  color: var(--text-muted);
  white-space: nowrap;
}

.purchase-line__total {
  font-weight: 700;
  font-size: 0.9375rem;
  font-variant-numeric: tabular-nums;
  padding-top: 0.35rem;
}

.purchase-line__remove {
  grid-area: remove;
  align-self: end;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2.1rem;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: #be123c;
  cursor: pointer;
}

.purchase-line__remove:hover {
  background: #fff1f2;
  border-color: #fecdd3;
}

.purchase-form__sum {
  display: flex;
  flex-direction: column;
  margin-right: auto;
  line-height: 1.2;
}

.purchase-form__sum span {
  font-size: 0.6875rem;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--text-muted);
}

.purchase-form__sum small {
  font-size: 0.75rem;
  color: var(--text-muted);
}

.purchase-form__sum strong {
  font-size: 1.05rem;
  color: #be123c;
  font-variant-numeric: tabular-nums;
}

@media (max-width: 900px) {
  .purchase-form__head {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .purchase-line {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    grid-template-areas:
      'product product'
      'dosage qty'
      'purchase sale'
      'expiry expiry'
      'total remove';
  }

  .purchase-field--total {
    text-align: left;
  }

  .purchase-line__remove {
    justify-self: end;
  }
}

@media (max-width: 520px) {
  .purchase-form__head {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
