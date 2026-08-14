<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { Search, PillBottle, Plus, Minus, Trash2, Package, Printer, PenLine } from '@lucide/vue'
import api from '@/api/client'
import { formatFcfa } from '@/lib/roles'
import type { PharmacyOrdonnanceLine } from '@/lib/lab-notes'
import { isPharmacyCatalogLine } from '@/lib/lab-notes'
import { printPharmacyOrdonnance } from '@/lib/pharmacy-ordonnance-print'
import { translateTemplate } from '@/lib/dashboard-i18n'
import { useAppI18n } from '@/i18n/useAppI18n'
import UiInput from '@/components/ui/UiInput.vue'
import UiButton from '@/components/ui/UiButton.vue'

export type PharmacyCatalogProduct = {
  id: string
  name: string
  sku: string
  barcode?: string | null
  dosage?: string | null
  pharmaceuticalForm?: string | null
  quantity: number
  unitPriceFcfa: number
}

type LineWithKey = PharmacyOrdonnanceLine & { _key: string }

const props = withDefaults(
  defineProps<{
    modelValue: PharmacyOrdonnanceLine[]
    patient?: {
      code: string
      firstName: string
      lastName: string
      age?: number | null
      gender?: string | null
    } | null
    doctorName?: string | null
    /**
     * all = catalogue + hors stock (défaut)
     * catalog = stock clinique uniquement
     * external = médicaments hors pharmacie uniquement
     */
    mode?: 'all' | 'catalog' | 'external'
  }>(),
  {
    mode: 'all',
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: PharmacyOrdonnanceLine[]]
}>()

const { uiText, localeCode } = useAppI18n()

const loading = ref(false)
const loadError = ref('')
const products = ref<PharmacyCatalogProduct[]>([])
const search = ref('')
const freeName = ref('')
const freeDosage = ref('')
const freeQuantity = ref(1)
const freeInstructions = ref('')
const freeError = ref('')

let keySeq = 0
function nextKey() {
  keySeq += 1
  return `line-${Date.now()}-${keySeq}`
}

const lineKeys = ref<string[]>([])

watch(
  () => props.modelValue,
  (value) => {
    if (lineKeys.value.length === value.length) return
    while (lineKeys.value.length < value.length) lineKeys.value.push(nextKey())
    if (lineKeys.value.length > value.length) {
      lineKeys.value = lineKeys.value.slice(0, value.length)
    }
  },
  { immediate: true, deep: true },
)

const lines = computed({
  get: (): LineWithKey[] =>
    props.modelValue.map((line, index) => ({
      ...line,
      _key: lineKeys.value[index] ?? `fallback-${index}`,
    })),
  set: (value: LineWithKey[]) => {
    lineKeys.value = value.map((line) => line._key)
    emit(
      'update:modelValue',
      value.map(({ _key: _ignored, ...line }) => line),
    )
  },
})

const showCatalog = computed(() => props.mode === 'all' || props.mode === 'catalog')
const showExternal = computed(() => props.mode === 'all' || props.mode === 'external')

const visibleLines = computed(() => {
  if (props.mode === 'catalog') return lines.value.filter((line) => isPharmacyCatalogLine(line))
  if (props.mode === 'external') return lines.value.filter((line) => !isPharmacyCatalogLine(line))
  return lines.value
})

const headTitle = computed(() => {
  void localeCode.value
  if (props.mode === 'external') return uiText('Prescription hors pharmacie')
  return uiText('Ordonnance pharmacie')
})

const headHint = computed(() => {
  void localeCode.value
  if (props.mode === 'external') {
    return uiText('Saisissez le médicament à se procurer en officine — imprimé sur l’ordonnance, sans débit stock.')
  }
  if (props.mode === 'catalog') {
    return uiText('Produits du catalogue clinique — sans débit automatique.')
  }
  return uiText(
    'Catalogue clinique ou saisie libre si le produit n’est pas en stock — sans débit automatique.',
  )
})

const cartTitle = computed(() => {
  void localeCode.value
  if (props.mode === 'external') return uiText('Médicaments hors pharmacie')
  if (props.mode === 'catalog') return uiText('Médicaments en stock')
  return uiText('Médicaments sélectionnés')
})

const filteredProducts = computed(() => {
  const q = search.value.trim().toLowerCase()
  const selected = new Set(
    lines.value.filter((line) => isPharmacyCatalogLine(line)).map((line) => line.productId!),
  )
  const list = products.value
    .filter((product) => !selected.has(product.id))
    .slice()
    .sort((a, b) => {
      const aInStock = a.quantity > 0 ? 0 : 1
      const bInStock = b.quantity > 0 ? 0 : 1
      if (aInStock !== bInStock) return aInStock - bInStock
      return a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' })
    })
  if (!q) return list
  return list.filter(
    (product) =>
      product.name.toLowerCase().includes(q) ||
      product.sku.toLowerCase().includes(q) ||
      (product.barcode?.toLowerCase().includes(q) ?? false) ||
      (product.dosage?.toLowerCase().includes(q) ?? false) ||
      (product.pharmaceuticalForm?.toLowerCase().includes(q) ?? false),
  )
})

const catalogListHint = computed(() => {
  void localeCode.value
  const n = filteredProducts.value.length
  if (search.value.trim()) {
    return n === 1
      ? translateTemplate('{n} produit trouvé', { n })
      : translateTemplate('{n} produits trouvés', { n })
  }
  return n === 1
    ? translateTemplate('{n} produit du catalogue', { n })
    : translateTemplate('{n} produits du catalogue', { n })
})

function productStockLabel(product: PharmacyCatalogProduct) {
  if (product.quantity > 0) {
    return translateTemplate('{n} en stock', { n: product.quantity })
  }
  return uiText('Hors stock')
}

async function loadProducts() {
  loading.value = true
  loadError.value = ''
  try {
    const { data } = await api.get<PharmacyCatalogProduct[]>('/consultations/pharmacy-products')
    products.value = Array.isArray(data) ? data : []
  } catch {
    loadError.value = uiText('Impossible de charger le catalogue pharmacie.')
    products.value = []
  } finally {
    loading.value = false
  }
}

function addProduct(product: PharmacyCatalogProduct) {
  if (lines.value.some((line) => line.productId === product.id)) return
  const key = nextKey()
  lineKeys.value = [...lineKeys.value, key]
  emit('update:modelValue', [
    ...props.modelValue,
    {
      productId: product.id,
      name: product.name,
      dosage: product.dosage ?? null,
      quantity: 1,
      instructions: '',
    },
  ])
  search.value = ''
}

function addFreeTextMedication() {
  freeError.value = ''
  const name = freeName.value.trim()
  if (name.length < 2) {
    freeError.value = uiText('Indiquez le nom du médicament (hors catalogue).')
    return
  }
  const quantity = Math.max(1, Math.min(999, Math.floor(Number(freeQuantity.value) || 1)))
  const key = nextKey()
  lineKeys.value = [...lineKeys.value, key]
  emit('update:modelValue', [
    ...props.modelValue,
    {
      productId: null,
      name,
      dosage: freeDosage.value.trim() || null,
      quantity,
      instructions: freeInstructions.value.trim() || undefined,
    },
  ])
  freeName.value = ''
  freeDosage.value = ''
  freeQuantity.value = 1
  freeInstructions.value = ''
}

function updateLine(key: string, patch: Partial<PharmacyOrdonnanceLine>) {
  const next = lines.value.map((line) =>
    line._key === key
      ? {
          ...line,
          ...patch,
          quantity:
            patch.quantity != null
              ? Math.max(1, Math.min(999, Math.floor(patch.quantity) || 1))
              : line.quantity,
        }
      : line,
  )
  lines.value = next
}

function removeLine(key: string) {
  lines.value = lines.value.filter((line) => line._key !== key)
}

function printCurrentOrdonnance() {
  if (!props.patient || !props.modelValue.length) return
  printPharmacyOrdonnance({
    patient: props.patient,
    doctorName: props.doctorName,
    lines: props.modelValue,
  })
}

onMounted(() => {
  if (showCatalog.value) void loadProducts()
})

watch(
  () => props.modelValue.length,
  () => {
    if (!showCatalog.value) return
    if (!products.value.length && !loading.value) void loadProducts()
  },
)
</script>

<template>
  <div
    class="ordo-picker"
    :class="{
      'ordo-picker--catalog': mode === 'catalog',
      'ordo-picker--external': mode === 'external',
    }"
  >
    <div class="ordo-picker__head">
      <component :is="mode === 'external' ? PenLine : PillBottle" :size="16" />
      <div>
        <h4>{{ headTitle }}</h4>
        <p>{{ headHint }}</p>
      </div>
    </div>

    <template v-if="showCatalog">
      <UiInput
        v-model="search"
        :icon="Search"
        :label="uiText('Rechercher un produit')"
        :placeholder="uiText('Nom, dosage, code-barres…')"
      />

      <p v-if="loading" class="ordo-picker__hint">{{ uiText('Chargement du catalogue…') }}</p>
      <p v-else-if="loadError" class="ordo-picker__error">{{ loadError }}</p>
      <template v-else>
        <p v-if="filteredProducts.length" class="ordo-picker__hint">{{ catalogListHint }}</p>
        <div class="ordo-picker__catalog">
          <button
            v-for="(product, index) in filteredProducts"
            :key="product.id"
            type="button"
            class="ordo-picker__product"
            :class="{ 'ordo-picker__product--oos': product.quantity <= 0 }"
            @click="addProduct(product)"
          >
            <span class="ordo-picker__num">{{ index + 1 }}</span>
            <Package :size="14" />
            <span class="ordo-picker__product-main">
              <strong>{{ product.name }}</strong>
              <small>
                {{ product.dosage || product.pharmaceuticalForm || product.sku }}
                · {{ formatFcfa(product.unitPriceFcfa) }}
                · {{ productStockLabel(product) }}
              </small>
            </span>
            <Plus :size="15" />
          </button>
          <p v-if="!filteredProducts.length" class="ordo-picker__hint">
            {{ uiText('Aucun produit trouvé dans le catalogue.') }}
          </p>
        </div>
      </template>
    </template>

    <div v-if="showExternal" class="ordo-picker__free">
      <div v-if="mode === 'all'" class="ordo-picker__free-head">
        <PenLine :size="14" />
        <strong>{{ uiText('Médicament hors pharmacie') }}</strong>
      </div>
      <p v-if="mode === 'all'" class="ordo-picker__hint">
        {{ uiText('Saisissez le nom pour l’imprimer sur l’ordonnance (à se procurer en officine).') }}
      </p>
      <div class="ordo-picker__free-grid">
        <UiInput v-model="freeName" :label="uiText('Nom du médicament')" :placeholder="uiText('Ex. Amoxicilline 500 mg')" />
        <UiInput v-model="freeDosage" :label="uiText('Dosage / forme')" :placeholder="uiText('Optionnel')" />
        <label class="ordo-picker__qty-field">
          <span>{{ uiText('Quantité') }}</span>
          <input v-model.number="freeQuantity" type="number" min="1" max="999" />
        </label>
        <UiInput
          v-model="freeInstructions"
          :label="uiText('Posologie')"
          :placeholder="uiText('Ex. 1 cp × 3 / jour')"
        />
      </div>
      <p v-if="freeError" class="ordo-picker__error">{{ freeError }}</p>
      <UiButton type="button" variant="secondary" size="sm" :icon="Plus" @click="addFreeTextMedication">
        {{ uiText('Ajouter à l’ordonnance') }}
      </UiButton>
    </div>

    <div v-if="visibleLines.length" class="ordo-picker__cart">
      <div class="ordo-picker__cart-head">
        <h5>{{ cartTitle }} ({{ visibleLines.length }})</h5>
        <UiButton
          v-if="patient && modelValue.length"
          type="button"
          variant="ghost"
          size="sm"
          :icon="Printer"
          @click="printCurrentOrdonnance"
        >
          {{ uiText('Imprimer') }}
        </UiButton>
      </div>
      <article
        v-for="(line, index) in visibleLines"
        :key="line._key"
        class="ordo-picker__line"
        :class="{ 'ordo-picker__line--free': !isPharmacyCatalogLine(line) }"
      >
        <div class="ordo-picker__line-top">
          <span class="ordo-picker__num">{{ index + 1 }}</span>
          <div>
            <strong>{{ line.name }}</strong>
            <small v-if="line.dosage">{{ line.dosage }}</small>
            <span v-if="!isPharmacyCatalogLine(line)" class="ordo-picker__badge">
              {{ uiText('Hors stock') }}
            </span>
          </div>
          <button type="button" class="ordo-picker__remove" @click="removeLine(line._key)">
            <Trash2 :size="14" />
          </button>
        </div>
        <div class="ordo-picker__line-controls">
          <div class="ordo-picker__qty">
            <button type="button" @click="updateLine(line._key, { quantity: line.quantity - 1 })">
              <Minus :size="13" />
            </button>
            <input
              :value="line.quantity"
              type="number"
              min="1"
              max="999"
              @change="
                updateLine(line._key, {
                  quantity: Number(($event.target as HTMLInputElement).value),
                })
              "
            />
            <button type="button" @click="updateLine(line._key, { quantity: line.quantity + 1 })">
              <Plus :size="13" />
            </button>
          </div>
          <input
            class="ordo-picker__instructions"
            :value="line.instructions ?? ''"
            type="text"
            :placeholder="uiText('Posologie / instructions…')"
            @input="
              updateLine(line._key, {
                instructions: ($event.target as HTMLInputElement).value,
              })
            "
          />
        </div>
      </article>
    </div>
  </div>
</template>

<style scoped>
.ordo-picker {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 0.85rem 1rem;
  border: 1px solid var(--primary-200);
  border-radius: var(--radius-sm);
  background: linear-gradient(180deg, #fff8f8, #fff);
}

.ordo-picker--catalog {
  border-color: #bbf7d0;
  background: linear-gradient(180deg, #f0fdf4, #fff);
}

.ordo-picker--external {
  border-color: #fde68a;
  background: linear-gradient(180deg, #fffbeb, #fff);
}

.ordo-picker__head {
  display: flex;
  gap: 0.55rem;
  align-items: flex-start;
  color: var(--primary-800);
}

.ordo-picker__head h4 {
  margin: 0;
  font-size: 0.875rem;
}

.ordo-picker__head p {
  margin: 0.15rem 0 0;
  font-size: 0.75rem;
  color: var(--text-muted);
}

.ordo-picker__hint,
.ordo-picker__error {
  margin: 0;
  font-size: 0.8125rem;
}

.ordo-picker__error {
  color: var(--danger, #b91c1c);
}

.ordo-picker__catalog {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  max-height: 22rem;
  overflow: auto;
  padding-right: 0.15rem;
}

.ordo-picker__product {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.45rem 0.55rem;
  border: 1px solid var(--primary-100);
  border-radius: 8px;
  background: #fff;
  color: var(--text);
  text-align: left;
  cursor: pointer;
  font: inherit;
}

.ordo-picker__product:hover {
  border-color: var(--primary-300);
  background: var(--primary-50);
}

.ordo-picker__product--oos {
  opacity: 0.72;
}

.ordo-picker__num {
  min-width: 1.55rem;
  height: 1.55rem;
  padding: 0 0.2rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  background: var(--primary-100, #dcfce7);
  color: var(--primary-800, #166534);
  font-size: 0.6875rem;
  font-weight: 800;
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}

.ordo-picker--external .ordo-picker__num,
.ordo-picker__line--free .ordo-picker__num {
  background: #fde68a;
  color: #92400e;
}

.ordo-picker__product-main {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  flex: 1;
  min-width: 0;
}

.ordo-picker__product-main strong {
  font-size: 0.8125rem;
}

.ordo-picker__product-main small {
  font-size: 0.7rem;
  color: var(--text-muted);
}

.ordo-picker__free {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  padding: 0.7rem 0.75rem;
  border: 1px dashed #fdba74;
  border-radius: 10px;
  background: #fff7ed;
}

.ordo-picker__free-head {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  color: #9a3412;
  font-size: 0.8125rem;
}

.ordo-picker__free-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.55rem;
}

.ordo-picker__qty-field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--text-muted);
}

.ordo-picker__qty-field input {
  border: 1px solid var(--primary-100);
  border-radius: 6px;
  padding: 0.45rem 0.55rem;
  font: inherit;
  font-size: 0.875rem;
  color: var(--text);
  background: #fff;
}

.ordo-picker__cart-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.45rem;
}

.ordo-picker__cart h5 {
  margin: 0;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-light);
}

.ordo-picker__line {
  padding: 0.55rem 0.65rem;
  border: 1px solid var(--primary-100);
  border-radius: 8px;
  background: #fff;
  margin-bottom: 0.4rem;
}

.ordo-picker__line--free {
  border-color: #fdba74;
  background: #fffbeb;
}

.ordo-picker__line-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.4rem;
}

.ordo-picker__line-top > div {
  flex: 1;
  min-width: 0;
}

.ordo-picker__line-top strong {
  display: inline;
  font-size: 0.8125rem;
}

.ordo-picker__line-top small {
  display: block;
  color: var(--text-muted);
  font-size: 0.7rem;
}

.ordo-picker__badge {
  display: inline-block;
  margin-left: 0.35rem;
  padding: 0.1rem 0.4rem;
  border-radius: 999px;
  background: #fed7aa;
  color: #9a3412;
  font-size: 0.65rem;
  font-weight: 800;
  text-transform: uppercase;
}

.ordo-picker__remove {
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  padding: 0.15rem;
}

.ordo-picker__line-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}

.ordo-picker__qty {
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--primary-200);
  border-radius: 999px;
  overflow: hidden;
}

.ordo-picker__qty button {
  border: none;
  background: var(--primary-50);
  color: var(--primary-800);
  width: 1.7rem;
  height: 1.7rem;
  cursor: pointer;
}

.ordo-picker__qty input {
  width: 2.4rem;
  border: none;
  text-align: center;
  font: inherit;
  font-size: 0.8125rem;
}

.ordo-picker__instructions {
  flex: 1;
  min-width: 10rem;
  border: 1px solid var(--primary-100);
  border-radius: 6px;
  padding: 0.35rem 0.55rem;
  font: inherit;
  font-size: 0.8125rem;
}

@media (max-width: 640px) {
  .ordo-picker__free-grid {
    grid-template-columns: 1fr;
  }
}
</style>
