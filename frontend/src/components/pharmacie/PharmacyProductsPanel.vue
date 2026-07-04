<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import axios from 'axios'
import { Package, Plus, RefreshCw, Save } from '@lucide/vue'
import api from '@/api/client'
import { formatFcfa } from '@/lib/roles'
import { PHARMACEUTICAL_FORMS, defaultExpiryDateInput } from '@/lib/pharmacy-product-forms'
import { statusBadge, catalogRowActionsHtml } from '@/lib/datatable-defaults'
import type { PharmacySupplierRecord } from '@/components/pharmacie/PharmacySuppliersPanel.vue'
import PageTableSection from '@/components/ui/PageTableSection.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiFormModal from '@/components/ui/UiFormModal.vue'
import UiDataTable from '@/components/ui/UiDataTable.vue'

export type PharmacyCategoryOption = { id: string; name: string; active?: boolean }

export type PharmacyProductRecord = {
  id: string
  name: string
  sku: string
  barcode: string | null
  dosage: string | null
  pharmaceuticalForm: string | null
  categoryId: string | null
  category?: PharmacyCategoryOption | null
  supplierId: string | null
  supplier: { id: string; name: string } | null
  expiryDate: string | null
  noExpiry: boolean
  quantity: number
  unitPriceFcfa: number
  minStock: number
  sachetsPerBox: number
  sachetPriceFcfa: number | null
  sellBySachet: boolean
  active: boolean
}

const emit = defineEmits<{ changed: [] }>()

const items = ref<PharmacyProductRecord[]>([])
const categories = ref<PharmacyCategoryOption[]>([])
const suppliers = ref<PharmacySupplierRecord[]>([])
const loading = ref(false)
const saving = ref(false)
const message = ref('')
const messageType = ref<'success' | 'error'>('success')
const modalOpen = ref(false)
const editingId = ref<string | null>(null)

const formName = ref('')
const formDosage = ref('')
const formBarcode = ref('')
const formPharmaceuticalForm = ref('')
const formCategoryId = ref('')
const formSupplierId = ref('')
const formExpiryDate = ref(defaultExpiryDateInput())
const formNoExpiry = ref(false)
const formQuantity = ref('0')
const formUnitPrice = ref('')
const formMinStock = ref('10')
const formSachetsPerBox = ref('1')
const formSachetPrice = ref('')
const formSellBySachet = ref(false)

const itemsById = computed(() => new Map(items.value.map((item) => [item.id, item])))
const isEditing = computed(() => editingId.value !== null)
const activeSuppliers = computed(() => suppliers.value.filter((s) => s.active))
const activeCategories = computed(() => categories.value.filter((c) => c.active !== false))

const tableRows = computed(() =>
  items.value.map((item) => ({
    id: item.id,
    name: item.dosage ? `${item.name} — ${item.dosage}` : item.name,
    barcode: item.barcode || item.sku,
    form: item.pharmaceuticalForm || '—',
    category: item.category?.name ?? '—',
    price: formatFcfa(item.unitPriceFcfa),
    priceSort: item.unitPriceFcfa,
    quantity: item.quantity,
    minStock: item.minStock,
    stockLabel: `${item.quantity} en stock`,
    stockVariant: item.quantity <= item.minStock ? 'danger' : 'success',
    statusLabel: item.active ? 'Actif' : 'Inactif',
    statusVariant: item.active ? 'success' : 'danger',
    toggleLabel: item.active ? 'Désactiver' : 'Activer',
    isActive: item.active,
    canDelete: true,
  })),
)

const columns = [
  {
    data: 'name',
    title: 'Médicament',
    responsivePriority: 1,
    render: (name: string) => `<span class="dt-name">${name}</span>`,
  },
  { data: 'barcode', title: 'Code-barres', responsivePriority: 2 },
  { data: 'category', title: 'Catégorie', responsivePriority: 3 },
  { data: 'form', title: 'Forme', responsivePriority: 3 },
  {
    data: 'priceSort',
    title: 'Prix vente',
    responsivePriority: 3,
    render: (_d: number, _t: string, row: { price: string }) => `<span class="dt-amount">${row.price}</span>`,
  },
  { data: 'minStock', title: 'Seuil', responsivePriority: 4 },
  {
    data: 'quantity',
    title: 'Disponible',
    responsivePriority: 3,
    render: (_d: number, _t: string, row: { stockLabel: string; stockVariant: string }) =>
      statusBadge(row.stockLabel, row.stockVariant as 'success' | 'danger'),
  },
  {
    data: 'statusLabel',
    title: 'Statut',
    responsivePriority: 4,
    render: (label: string, _t: string, row: { statusVariant: string }) =>
      statusBadge(label, row.statusVariant as 'success' | 'danger'),
  },
  {
    data: null,
    title: 'Actions',
    orderable: false,
    className: 'dt-actions-col dt-actions-col--catalog all',
    responsivePriority: 1,
    render: (
      _d: unknown,
      _t: string,
      row: { id: string; toggleLabel: string; isActive: boolean; canDelete: boolean },
    ) => catalogRowActionsHtml(row),
  },
]

function apiErrorMessage(error: unknown, fallback: string) {
  if (axios.isAxiosError(error) && typeof error.response?.data?.error === 'string') {
    return error.response.data.error
  }
  if (axios.isAxiosError(error) && typeof error.response?.data?.message === 'string') {
    return error.response.data.message
  }
  return fallback
}

function formatExpiryForInput(value: string | null) {
  if (!value) return defaultExpiryDateInput()
  return value.slice(0, 10)
}

async function loadSuppliers() {
  try {
    const { data } = await api.get<PharmacySupplierRecord[]>('/pharmacie/suppliers')
    suppliers.value = data
  } catch {
    suppliers.value = []
  }
}

async function loadCategories() {
  try {
    const { data } = await api.get<PharmacyCategoryOption[]>('/pharmacie/categories')
    categories.value = data.filter((row) => row.id)
  } catch {
    categories.value = []
  }
}

async function loadItems() {
  loading.value = true
  message.value = ''
  try {
    await loadCategories()
    const { data } = await api.get<PharmacyProductRecord[]>('/pharmacie/products')
    items.value = data
  } catch {
    message.value = 'Impossible de charger les produits.'
    messageType.value = 'error'
    items.value = []
  } finally {
    loading.value = false
  }
}

function resetForm() {
  formName.value = ''
  formDosage.value = ''
  formBarcode.value = ''
  formPharmaceuticalForm.value = ''
  formCategoryId.value = activeCategories.value[0]?.id ?? ''
  formSupplierId.value = ''
  formExpiryDate.value = defaultExpiryDateInput()
  formNoExpiry.value = false
  formQuantity.value = '0'
  formUnitPrice.value = ''
  formMinStock.value = '10'
  formSachetsPerBox.value = '1'
  formSachetPrice.value = ''
  formSellBySachet.value = false
}

function openCreateModal() {
  editingId.value = null
  resetForm()
  modalOpen.value = true
  message.value = ''
}

function openEditModal(id: string) {
  const item = itemsById.value.get(id)
  if (!item) return
  editingId.value = id
  formName.value = item.name
  formDosage.value = item.dosage ?? ''
  formBarcode.value = item.barcode ?? ''
  formPharmaceuticalForm.value = item.pharmaceuticalForm ?? ''
  formCategoryId.value = item.categoryId ?? item.category?.id ?? ''
  formSupplierId.value = item.supplierId ?? ''
  formExpiryDate.value = formatExpiryForInput(item.expiryDate)
  formNoExpiry.value = item.noExpiry
  formQuantity.value = String(item.quantity)
  formUnitPrice.value = String(item.unitPriceFcfa)
  formMinStock.value = String(item.minStock)
  formSachetsPerBox.value = String(item.sachetsPerBox)
  formSachetPrice.value = item.sachetPriceFcfa ? String(item.sachetPriceFcfa) : ''
  formSellBySachet.value = item.sellBySachet
  modalOpen.value = true
  message.value = ''
}

function closeModal() {
  modalOpen.value = false
  editingId.value = null
  resetForm()
}

function buildPayload() {
  const unitPriceFcfa = Number(formUnitPrice.value)
  const sachetPrice = Number(formSachetPrice.value)
  return {
    name: formName.value.trim(),
    barcode: formBarcode.value.trim() || undefined,
    dosage: formDosage.value.trim() || undefined,
    pharmaceuticalForm: formPharmaceuticalForm.value || undefined,
    categoryId: formCategoryId.value || null,
    supplierId: formSupplierId.value || undefined,
    expiryDate: formNoExpiry.value ? null : formExpiryDate.value,
    noExpiry: formNoExpiry.value,
    unitPriceFcfa,
    minStock: Number(formMinStock.value) || 10,
    sachetsPerBox: Number(formSachetsPerBox.value) || 1,
    sachetPriceFcfa: Number.isFinite(sachetPrice) && sachetPrice > 0 ? sachetPrice : null,
    sellBySachet: formSellBySachet.value,
    ...(!isEditing.value ? { quantity: Number(formQuantity.value) || 0 } : {}),
  }
}

async function saveItem() {
  const name = formName.value.trim()
  const unitPriceFcfa = Number(formUnitPrice.value)

  if (name.length < 2) {
    message.value = 'Le nom du médicament est requis.'
    messageType.value = 'error'
    return
  }
  if (!Number.isFinite(unitPriceFcfa) || unitPriceFcfa <= 0) {
    message.value = 'Prix de vente invalide.'
    messageType.value = 'error'
    return
  }

  saving.value = true
  message.value = ''
  const payload = buildPayload()

  try {
    if (isEditing.value && editingId.value) {
      await api.put(`/pharmacie/products/${editingId.value}`, payload)
      message.value = 'Produit modifié.'
    } else {
      await api.post('/pharmacie/products', payload)
      message.value = 'Produit ajouté.'
    }
    messageType.value = 'success'
    emit('changed')
    closeModal()
    await loadItems()
  } catch (error) {
    message.value = apiErrorMessage(error, 'Enregistrement impossible — code-barres peut-être déjà utilisé.')
    messageType.value = 'error'
  } finally {
    saving.value = false
  }
}

async function toggleItem(id: string) {
  const item = itemsById.value.get(id)
  if (!item) return
  try {
    await api.put(`/pharmacie/products/${id}`, { active: !item.active })
    message.value = item.active ? 'Produit désactivé.' : 'Produit réactivé.'
    messageType.value = 'success'
    emit('changed')
    await loadItems()
  } catch {
    message.value = 'Action impossible.'
    messageType.value = 'error'
  }
}

async function deleteItem(id: string) {
  const item = itemsById.value.get(id)
  if (!item) return
  if (!globalThis.confirm(`Supprimer le produit « ${item.name} » ?`)) return
  try {
    const { data } = await api.delete<{ message?: string }>(`/pharmacie/products/${id}`)
    message.value = data.message ?? 'Produit supprimé.'
    messageType.value = 'success'
    emit('changed')
    await loadItems()
  } catch (error) {
    message.value = apiErrorMessage(error, 'Suppression impossible.')
    messageType.value = 'error'
  }
}

function onTableAction({ action, id }: { action: string; id: string }) {
  if (action === 'edit') openEditModal(id)
  if (action === 'toggle') toggleItem(id)
  if (action === 'delete') deleteItem(id)
}

onMounted(async () => {
  await Promise.all([loadItems(), loadSuppliers()])
})

defineExpose({ reload: loadItems })
</script>

<template>
  <PageTableSection embedded>
    <template #toolbar>
      <UiButton variant="ghost" size="sm" :icon="RefreshCw" :disabled="loading || saving" @click="loadItems">
        Actualiser
      </UiButton>
      <UiButton variant="primary" size="sm" :icon="Plus" @click="openCreateModal">
        Nouveau produit
      </UiButton>
    </template>

    <UiAlert v-if="message && !modalOpen" :type="messageType" :message="message" class="panel-alert" />

    <p v-if="!loading && !items.length" class="empty">Aucun produit enregistré</p>
    <UiDataTable
      v-else
      fill
      table-key="pharmacy-products"
      compact
      :data="tableRows"
      :columns="columns"
      :loading="loading"
      loading-label="Chargement des produits…"
      @action="onTableAction"
    />
  </PageTableSection>

  <UiFormModal
    v-if="modalOpen"
    title-id="pharmacy-product-modal-title"
    :title="isEditing ? 'Modifier le produit' : 'Ajout d\'un produit'"
    size="large"
    :icon="Package"
    @close="closeModal"
  >
    <UiAlert v-if="message && modalOpen" :type="messageType" :message="message" />

    <section class="product-form">
      <div class="product-form__row product-form__row--name">
        <UiInput v-model="formName" label="Nom du médicament" placeholder="Ex. Paracétamol" required />
        <UiInput v-model="formDosage" label="Dosage" placeholder="Ex. 500 mg" />
      </div>

      <div class="product-form__row product-form__row--2">
        <UiInput v-model="formBarcode" label="Code-barres" placeholder="Scan ou saisie manuelle" />
        <UiSelect v-model="formCategoryId" label="Catégorie">
          <option value="">Sans catégorie</option>
          <option v-for="category in activeCategories" :key="category.id" :value="category.id">
            {{ category.name }}
          </option>
        </UiSelect>
      </div>

      <div class="product-form__row product-form__row--2">
        <UiSelect v-model="formPharmaceuticalForm" label="Forme">
          <option value="">Sélectionner une forme</option>
          <option v-for="form in PHARMACEUTICAL_FORMS" :key="form" :value="form">{{ form }}</option>
        </UiSelect>
        <UiSelect v-model="formSupplierId" label="Fournisseur">
          <option value="">Sélectionner un fournisseur</option>
          <option v-for="s in activeSuppliers" :key="s.id" :value="s.id">{{ s.name }}</option>
        </UiSelect>
      </div>

      <div class="product-form__row product-form__row--supplier">
        <div class="expiry-field expiry-field--full">
          <UiInput
            v-model="formExpiryDate"
            label="Date d'expiration"
            type="date"
            :disabled="formNoExpiry"
          />
          <label class="checkbox-field">
            <input v-model="formNoExpiry" type="checkbox" />
            <span>Aucune</span>
          </label>
        </div>
      </div>

      <div class="product-form__row product-form__row--3">
        <UiInput
          v-if="!isEditing"
          v-model="formQuantity"
          label="Quantité initiale"
          type="number"
          min="0"
        />
        <div class="amount-field">
          <span class="amount-field__label">Prix de vente <span class="req">*</span></span>
          <div class="amount-field__wrap">
            <input
              v-model="formUnitPrice"
              class="amount-field__input"
              type="number"
              min="1"
              required
              placeholder="0"
            />
            <span class="amount-field__suffix">FCFA</span>
          </div>
        </div>
        <UiInput v-model="formMinStock" label="Seuil d'alerte" type="number" min="0" />
      </div>

      <div class="product-form__section">Configuration des sachets</div>

      <div class="product-form__row product-form__row--2">
        <UiInput v-model="formSachetsPerBox" label="Sachets par boîte" type="number" min="1" />
        <div class="amount-field">
          <span class="amount-field__label">Prix par sachet</span>
          <div class="amount-field__wrap">
            <input
              v-model="formSachetPrice"
              class="amount-field__input"
              type="number"
              min="1"
              placeholder="0"
            />
            <span class="amount-field__suffix">FCFA</span>
          </div>
        </div>
      </div>

      <label class="checkbox-field checkbox-field--block">
        <input v-model="formSellBySachet" type="checkbox" />
        <span>Vente par sachet</span>
      </label>
    </section>

    <template #footer>
      <UiButton variant="ghost" @click="closeModal">Annuler</UiButton>
      <UiButton variant="primary" :icon="Save" :disabled="saving" @click="saveItem">
        {{ saving ? 'Enregistrement…' : 'Enregistrer' }}
      </UiButton>
    </template>
  </UiFormModal>
</template>

<style scoped>
.panel-alert {
  margin-bottom: 1rem;
}

.empty {
  text-align: center;
  color: var(--text-light);
  padding: 2rem 1rem;
  font-size: 0.875rem;
}

.product-form {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.product-form__row {
  display: grid;
  gap: 0.75rem;
}

.product-form__row--name {
  grid-template-columns: 2fr 1fr;
}

.product-form__row--2 {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.product-form__row--supplier {
  grid-template-columns: 1fr 1fr;
  align-items: end;
}

.product-form__row--3 {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.product-form__section {
  margin: 0.75rem 0 0.35rem;
  padding: 0.55rem 0.85rem;
  border-radius: 8px;
  background: #e8f5e9;
  color: #1b5e20;
  font-size: 0.875rem;
  font-weight: 700;
}

.expiry-field--full {
  grid-column: 1 / -1;
}

.expiry-field {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 0.75rem;
  align-items: end;
}

.expiry-field :deep(.ui-field) {
  margin-bottom: 0;
}

.amount-field {
  display: block;
  margin-bottom: 1rem;
}

.amount-field__label {
  display: block;
  margin-bottom: 0.4rem;
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text);
}

.amount-field__label .req {
  color: var(--danger-500, #dc2626);
}

.amount-field__wrap {
  display: flex;
  align-items: stretch;
  border: 1.5px solid var(--border);
  border-radius: var(--radius-sm);
  overflow: hidden;
  background: var(--ui-input-bg);
}

.amount-field__input {
  flex: 1;
  min-width: 0;
  border: none;
  padding: 0.65rem 0.9rem;
  font-family: inherit;
  font-size: inherit;
  color: var(--text);
  background: transparent;
}

.amount-field__input:focus {
  outline: none;
}

.amount-field__wrap:focus-within {
  border-color: var(--accent-500);
  box-shadow: 0 0 0 3px var(--focus-ring);
  background: #fff;
}

.amount-field__suffix {
  display: flex;
  align-items: center;
  padding: 0 0.85rem;
  background: #e8f5e9;
  color: #2e7d32;
  font-size: 0.75rem;
  font-weight: 700;
  border-left: 1px solid var(--border);
  white-space: nowrap;
}

.checkbox-field {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  margin-bottom: 1rem;
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text);
  cursor: pointer;
  user-select: none;
}

.checkbox-field--block {
  margin-top: 0.25rem;
}

.checkbox-field input {
  width: 1rem;
  height: 1rem;
  accent-color: var(--accent-500);
}

@media (max-width: 768px) {
  .product-form__row--name,
  .product-form__row--2,
  .product-form__row--supplier,
  .product-form__row--3 {
    grid-template-columns: 1fr;
  }

  .expiry-field {
    grid-template-columns: 1fr;
  }
}
</style>
