<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import axios from 'axios'
import { Eye, Package, Pencil, Plus, RefreshCw, Save } from '@lucide/vue'
import api from '@/api/client'
import { formatFcfa } from '@/lib/roles'
import { DEFAULT_LOGISTICS_UNIT, logisticsUnitOptions } from '@/lib/logistics-units'
import { statusBadge, catalogRowActionsHtml } from '@/lib/datatable-defaults'
import type { LogisticsCategoryRecord } from '@/components/logistique/LogisticsCategoriesPanel.vue'
import type { LogisticsSupplierRecord } from '@/components/logistique/LogisticsSuppliersPanel.vue'
import PageTableSection from '@/components/ui/PageTableSection.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiFormModal from '@/components/ui/UiFormModal.vue'
import UiDataTable from '@/components/ui/UiDataTable.vue'

export type LogisticsItemRecord = {
  id: string
  name: string
  sku: string
  reference: string | null
  unit: string
  categoryId: string | null
  category?: { id: string; name: string } | null
  supplierId: string | null
  supplier: { id: string; name: string } | null
  quantity: number
  unitCostFcfa: number
  minStock: number
  expiryDate: string | null
  noExpiry: boolean
  active: boolean
}

const emit = defineEmits<{ changed: [] }>()

const items = ref<LogisticsItemRecord[]>([])
const categories = ref<LogisticsCategoryRecord[]>([])
const suppliers = ref<LogisticsSupplierRecord[]>([])
const loading = ref(false)
const saving = ref(false)
const message = ref('')
const messageType = ref<'success' | 'error'>('success')
const modalOpen = ref(false)
const viewModalOpen = ref(false)
const viewingId = ref<string | null>(null)
const editingId = ref<string | null>(null)

const formName = ref('')
const formUnit = ref(DEFAULT_LOGISTICS_UNIT)
const formCategoryId = ref('')
const formSupplierId = ref('')
const formQuantity = ref('0')
const formUnitCost = ref('')
const formMinStock = ref('5')
const formExpiryDate = ref('')
const formNoExpiry = ref(true)

const itemsById = computed(() => new Map(items.value.map((item) => [item.id, item])))
const viewingItem = computed(() => (viewingId.value ? itemsById.value.get(viewingId.value) ?? null : null))
const isEditing = computed(() => editingId.value !== null)
const activeSuppliers = computed(() => suppliers.value.filter((s) => s.active))
const activeCategories = computed(() => categories.value.filter((c) => c.active !== false))
const unitOptions = computed(() => logisticsUnitOptions(formUnit.value))

const tableRows = computed(() =>
  items.value.map((item) => ({
    id: item.id,
    name: item.name,
    category: item.category?.name ?? '—',
    cost: formatFcfa(item.unitCostFcfa),
    costSort: item.unitCostFcfa,
    quantity: item.quantity,
    minStock: item.minStock,
    stockLabel: `${item.quantity} ${item.unit}`,
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
    title: 'Article',
    responsivePriority: 1,
    render: (name: string) => `<span class="dt-name">${name}</span>`,
  },
  { data: 'category', title: 'Catégorie', responsivePriority: 3 },
  {
    data: 'costSort',
    title: 'Coût unitaire',
    responsivePriority: 3,
    render: (_d: number, _t: string, row: { cost: string }) => `<span class="dt-amount">${row.cost}</span>`,
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
    ) => catalogRowActionsHtml({ ...row, showView: true, showToggle: false }),
  },
]

function apiErrorMessage(error: unknown, fallback: string) {
  if (axios.isAxiosError(error) && typeof error.response?.data?.error === 'string') {
    return error.response.data.error
  }
  return fallback
}

async function loadReferenceData() {
  const [categoriesRes, suppliersRes] = await Promise.all([
    api.get<LogisticsCategoryRecord[]>('/logistique/categories'),
    api.get<LogisticsSupplierRecord[]>('/logistique/suppliers'),
  ])
  categories.value = categoriesRes.data
  suppliers.value = suppliersRes.data
}

async function loadItems() {
  loading.value = true
  message.value = ''
  try {
    await loadReferenceData()
    const { data } = await api.get<LogisticsItemRecord[]>('/logistique/items')
    items.value = data
  } catch {
    message.value = 'Impossible de charger les articles.'
    messageType.value = 'error'
    items.value = []
  } finally {
    loading.value = false
  }
}

function resetForm() {
  formName.value = ''
  formUnit.value = DEFAULT_LOGISTICS_UNIT
  formCategoryId.value = activeCategories.value[0]?.id ?? ''
  formSupplierId.value = ''
  formQuantity.value = '0'
  formUnitCost.value = ''
  formMinStock.value = '5'
  formExpiryDate.value = ''
  formNoExpiry.value = true
}

function formatDate(value: string | null) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('fr-FR')
}

function openViewModal(id: string) {
  if (!itemsById.value.has(id)) return
  viewingId.value = id
  viewModalOpen.value = true
  message.value = ''
}

function closeViewModal() {
  viewModalOpen.value = false
  viewingId.value = null
}

function editFromViewModal() {
  const id = viewingId.value
  if (!id) return
  closeViewModal()
  openEditModal(id)
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
  formUnit.value = item.unit
  formCategoryId.value = item.categoryId ?? item.category?.id ?? ''
  formSupplierId.value = item.supplierId ?? ''
  formQuantity.value = String(item.quantity)
  formUnitCost.value = String(item.unitCostFcfa)
  formMinStock.value = String(item.minStock)
  formExpiryDate.value = item.expiryDate?.slice(0, 10) ?? ''
  formNoExpiry.value = item.noExpiry
  modalOpen.value = true
  message.value = ''
}

function closeModal() {
  modalOpen.value = false
  editingId.value = null
  resetForm()
}

async function saveItem() {
  const name = formName.value.trim()
  const unitCostFcfa = Number(formUnitCost.value)
  if (name.length < 2) {
    message.value = 'Le nom de l\'article est requis.'
    messageType.value = 'error'
    return
  }
  if (!Number.isFinite(unitCostFcfa) || unitCostFcfa < 0) {
    message.value = 'Coût unitaire invalide.'
    messageType.value = 'error'
    return
  }

  saving.value = true
  message.value = ''
  const payload = {
    name,
    unit: formUnit.value.trim() || DEFAULT_LOGISTICS_UNIT,
    categoryId: formCategoryId.value || null,
    supplierId: formSupplierId.value || null,
    unitCostFcfa,
    minStock: Number(formMinStock.value) || 5,
    expiryDate: formNoExpiry.value ? null : formExpiryDate.value || null,
    noExpiry: formNoExpiry.value,
    ...(!isEditing.value ? { quantity: Number(formQuantity.value) || 0 } : {}),
  }

  try {
    if (isEditing.value && editingId.value) {
      await api.put(`/logistique/items/${editingId.value}`, payload)
      message.value = 'Article modifié.'
    } else {
      await api.post('/logistique/items', payload)
      message.value = 'Article ajouté.'
    }
    messageType.value = 'success'
    emit('changed')
    closeModal()
    await loadItems()
  } catch (error) {
    message.value = apiErrorMessage(error, 'Enregistrement impossible.')
    messageType.value = 'error'
  } finally {
    saving.value = false
  }
}

async function deleteItem(id: string) {
  const item = itemsById.value.get(id)
  if (!item) return
  if (!window.confirm(`Supprimer l'article « ${item.name} » ?`)) return
  try {
    const { data } = await api.delete<{ message?: string }>(`/logistique/items/${id}`)
    message.value = data.message ?? 'Article supprimé.'
    messageType.value = 'success'
    emit('changed')
    await loadItems()
  } catch (error) {
    message.value = apiErrorMessage(error, 'Suppression impossible.')
    messageType.value = 'error'
  }
}

function onTableAction({ action, id }: { action: string; id: string }) {
  if (action === 'view') openViewModal(id)
  if (action === 'edit') openEditModal(id)
  if (action === 'delete') deleteItem(id)
}

onMounted(loadItems)

defineExpose({ reload: loadItems })
</script>

<template>
  <PageTableSection embedded>
    <template #toolbar>
      <UiButton variant="ghost" size="sm" :icon="RefreshCw" :disabled="loading || saving" @click="loadItems">
        Actualiser
      </UiButton>
      <UiButton variant="primary" size="sm" :icon="Plus" @click="openCreateModal">
        Nouvel article
      </UiButton>
    </template>

    <UiAlert v-if="message && !modalOpen && !viewModalOpen" :type="messageType" :message="message" class="panel-alert" />

    <UiDataTable
      fill
      table-key="logistics-items"
      compact
      :data="tableRows"
      :columns="columns"
      :loading="loading"
      loading-label="Chargement des articles…"
      @action="onTableAction"
    />
    <p v-if="!loading && !items.length" class="empty">Aucun article enregistré</p>
  </PageTableSection>

  <UiFormModal
    v-if="viewModalOpen && viewingItem"
    title-id="logistics-item-view-title"
    title="Détail de l'article"
    :subtitle="viewingItem.name"
    :icon="Eye"
    @close="closeViewModal"
  >
    <dl class="item-detail">
      <div class="item-detail__row">
        <dt>Nom</dt>
        <dd>{{ viewingItem.name }}</dd>
      </div>
      <div class="item-detail__row">
        <dt>Code interne</dt>
        <dd>{{ viewingItem.sku }}</dd>
      </div>
      <div class="item-detail__row">
        <dt>Catégorie</dt>
        <dd>{{ viewingItem.category?.name ?? '—' }}</dd>
      </div>
      <div class="item-detail__row">
        <dt>Fournisseur</dt>
        <dd>{{ viewingItem.supplier?.name ?? '—' }}</dd>
      </div>
      <div class="item-detail__row">
        <dt>Conditionnement</dt>
        <dd>{{ viewingItem.unit }}</dd>
      </div>
      <div class="item-detail__row">
        <dt>Stock disponible</dt>
        <dd>{{ viewingItem.quantity }} {{ viewingItem.unit }}</dd>
      </div>
      <div class="item-detail__row">
        <dt>Seuil d'alerte</dt>
        <dd>{{ viewingItem.minStock }}</dd>
      </div>
      <div class="item-detail__row">
        <dt>Coût unitaire</dt>
        <dd class="item-detail__amount">{{ formatFcfa(viewingItem.unitCostFcfa) }}</dd>
      </div>
      <div class="item-detail__row">
        <dt>Expiration</dt>
        <dd>{{ viewingItem.noExpiry ? 'Aucune' : formatDate(viewingItem.expiryDate) }}</dd>
      </div>
      <div class="item-detail__row">
        <dt>Statut</dt>
        <dd>{{ viewingItem.active ? 'Actif' : 'Inactif' }}</dd>
      </div>
    </dl>

    <template #footer>
      <UiButton variant="ghost" @click="closeViewModal">Fermer</UiButton>
      <UiButton variant="primary" :icon="Pencil" @click="editFromViewModal">
        Modifier
      </UiButton>
    </template>
  </UiFormModal>

  <UiFormModal
    v-if="modalOpen"
    title-id="logistics-item-modal-title"
    :title="isEditing ? 'Modifier l\'article' : 'Ajout d\'un article'"
    size="large"
    :icon="Package"
    @close="closeModal"
  >
    <UiAlert v-if="message && modalOpen" :type="messageType" :message="message" />

    <section class="item-form">
      <div class="item-form__row">
        <UiInput v-model="formName" label="Nom de l'article" placeholder="Ex. Gants nitrile" required />
      </div>

      <div class="item-form__row item-form__row--2">
        <UiSelect v-model="formCategoryId" label="Catégorie">
          <option value="">Sans catégorie</option>
          <option v-for="category in activeCategories" :key="category.id" :value="category.id">
            {{ category.name }}
          </option>
        </UiSelect>
        <UiSelect v-model="formSupplierId" label="Fournisseur">
          <option value="">Sélectionner un fournisseur</option>
          <option v-for="s in activeSuppliers" :key="s.id" :value="s.id">{{ s.name }}</option>
        </UiSelect>
      </div>

      <div class="item-form__row item-form__row--3">
        <UiSelect v-model="formUnit" label="Conditionnement" required>
          <option v-for="unit in unitOptions" :key="unit.value" :value="unit.value">
            {{ unit.label }}
          </option>
        </UiSelect>
        <UiInput
          v-if="!isEditing"
          v-model="formQuantity"
          label="Quantité initiale"
          type="number"
          min="0"
        />
        <UiInput v-model="formMinStock" label="Seuil d'alerte" type="number" min="0" />
      </div>

      <div class="item-form__row item-form__row--2">
        <div class="amount-field">
          <span class="amount-field__label">Coût unitaire</span>
          <div class="amount-field__wrap">
            <input v-model="formUnitCost" class="amount-field__input" type="number" min="0" placeholder="0" />
            <span class="amount-field__suffix">FCFA</span>
          </div>
        </div>
        <div class="expiry-field">
          <UiInput v-model="formExpiryDate" label="Date d'expiration" type="date" :disabled="formNoExpiry" />
          <label class="checkbox-field">
            <input v-model="formNoExpiry" type="checkbox" />
            <span>Aucune</span>
          </label>
        </div>
      </div>
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
  padding: 1rem;
  font-size: 0.875rem;
}

.item-detail {
  display: grid;
  gap: 0.65rem;
  margin: 0;
}

.item-detail__row {
  display: grid;
  grid-template-columns: minmax(8rem, 34%) 1fr;
  gap: 0.75rem;
  padding: 0.55rem 0;
  border-bottom: 1px solid var(--border);
}

.item-detail__row:last-child {
  border-bottom: none;
}

.item-detail__row dt {
  margin: 0;
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-light);
}

.item-detail__row dd {
  margin: 0;
  font-size: 0.875rem;
  color: var(--text);
}

.item-detail__amount {
  font-weight: 700;
  color: #1b4f9c;
}

.item-form {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.item-form__row {
  display: grid;
  gap: 0.75rem;
}

.item-form__row--2 {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.item-form__row--3 {
  grid-template-columns: repeat(3, minmax(0, 1fr));
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
  background: #e8f1fb;
  color: #1b4f9c;
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

.checkbox-field input {
  width: 1rem;
  height: 1rem;
  accent-color: var(--accent-500);
}

@media (max-width: 768px) {
  .item-form__row--2,
  .item-form__row--3 {
    grid-template-columns: 1fr;
  }

  .expiry-field {
    grid-template-columns: 1fr;
  }
}
</style>
