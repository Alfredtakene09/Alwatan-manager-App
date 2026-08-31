<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import axios from 'axios'
import { Package, Plus, RefreshCw, Save } from '@lucide/vue'
import api from '@/api/client'
import { formatFcfa } from '@/lib/roles'
import { exportTableExcel, exportTablePdf, type ExportColumn } from '@/lib/table-export'
import type { LabStockCategoryRecord } from '@/components/laboratoire/LabStockCategoriesPanel.vue'
import PageTableSection from '@/components/ui/PageTableSection.vue'
import ExportButtons from '@/components/ui/ExportButtons.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiFormModal from '@/components/ui/UiFormModal.vue'
import StCatalogActions from '@/components/ui/StCatalogActions.vue'
import { confirmAppModal } from '@/lib/api-modal-helper'
import { useAppI18n } from '@/i18n/useAppI18n'
import { translateTemplate } from '@/lib/dashboard-i18n'

export type LabStockItemRecord = {
  id: string
  name: string
  sku: string
  reference: string | null
  unit: string
  categoryId: string | null
  category?: { id: string; name: string } | null
  quantity: number
  unitCostFcfa: number
  minStock: number
  expiryDate: string | null
  noExpiry: boolean
  active: boolean
}

const UNIT_OPTIONS = ['unité', 'flacon', 'tube', 'boîte', 'kit', 'ml', 'l']

const emit = defineEmits<{ changed: [] }>()

const { uiText, numberText, localeCode } = useAppI18n()

const items = ref<LabStockItemRecord[]>([])
const categories = ref<LabStockCategoryRecord[]>([])
const loading = ref(false)
const saving = ref(false)
const message = ref('')
const messageType = ref<'success' | 'error'>('success')
const modalOpen = ref(false)
const editingId = ref<string | null>(null)

const formName = ref('')
const formReference = ref('')
const formUnit = ref('unité')
const formCategoryId = ref('')
const formQuantity = ref('0')
const formUnitCost = ref('')
const formMinStock = ref('5')
const formExpiryDate = ref('')
const formNoExpiry = ref(true)

const itemsById = computed(() => new Map(items.value.map((item) => [item.id, item])))
const isEditing = computed(() => editingId.value !== null)
const activeCategories = computed(() => categories.value.filter((c) => c.active !== false))

const tableRows = computed(() => {
  void localeCode.value
  return items.value.map((item) => ({
    id: item.id,
    name: item.name,
    sku: item.sku,
    category: uiText(item.category?.name ?? '—'),
    unit: uiText(item.unit),
    cost: formatFcfa(item.unitCostFcfa),
    costSort: item.unitCostFcfa,
    quantity: item.quantity,
    minStock: item.minStock,
    stockLabel: `${numberText(item.quantity)} ${uiText(item.unit)}`,
    stockVariant: item.quantity <= item.minStock ? 'danger' : 'success',
    statusLabel: item.active ? uiText('Actif') : uiText('Inactif'),
    statusVariant: item.active ? 'success' : 'danger',
    toggleLabel: item.active ? uiText('Désactiver') : uiText('Activer'),
    isActive: item.active,
    canDelete: true,
  }))
})

function apiErrorMessage(error: unknown, fallback: string) {
  if (axios.isAxiosError(error) && typeof error.response?.data?.error === 'string') {
    return error.response.data.error
  }
  return fallback
}

async function loadCategories() {
  try {
    const { data } = await api.get<LabStockCategoryRecord[]>('/lab-stock/categories')
    categories.value = data
  } catch {
    categories.value = []
  }
}

async function loadItems() {
  loading.value = true
  message.value = ''
  try {
    const { data } = await api.get<LabStockItemRecord[]>('/lab-stock/items')
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
  formReference.value = ''
  formUnit.value = 'unité'
  formCategoryId.value = ''
  formQuantity.value = '0'
  formUnitCost.value = ''
  formMinStock.value = '5'
  formExpiryDate.value = ''
  formNoExpiry.value = true
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
  formReference.value = item.reference ?? ''
  formUnit.value = item.unit
  formCategoryId.value = item.categoryId ?? ''
  formQuantity.value = String(item.quantity)
  formUnitCost.value = item.unitCostFcfa ? String(item.unitCostFcfa) : ''
  formMinStock.value = String(item.minStock)
  formExpiryDate.value = item.expiryDate ? item.expiryDate.slice(0, 10) : ''
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
  if (name.length < 2) {
    message.value = 'Nom requis (2 caractères minimum).'
    messageType.value = 'error'
    return
  }

  const unitCostFcfa = Math.max(0, Math.trunc(Number(formUnitCost.value) || 0))
  const minStock = Math.max(0, Math.trunc(Number(formMinStock.value) || 0))
  const quantity = Math.max(0, Math.trunc(Number(formQuantity.value) || 0))

  saving.value = true
  message.value = ''

  const payload = {
    name,
    reference: formReference.value.trim() || undefined,
    unit: formUnit.value.trim() || 'unité',
    categoryId: formCategoryId.value || null,
    unitCostFcfa,
    minStock,
    quantity,
    noExpiry: formNoExpiry.value,
    expiryDate: formNoExpiry.value ? null : formExpiryDate.value || null,
  }

  try {
    if (isEditing.value && editingId.value) {
      await api.put(`/lab-stock/items/${editingId.value}`, payload)
      message.value = 'Article modifié.'
    } else {
      await api.post('/lab-stock/items', payload)
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

async function toggleItem(id: string) {
  const item = itemsById.value.get(id)
  if (!item) return
  try {
    await api.put(`/lab-stock/items/${id}`, { active: !item.active })
    message.value = item.active ? 'Article désactivé.' : 'Article réactivé.'
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
  const confirmed = await confirmAppModal({
    type: 'DELETE',
    title: 'Supprimer l\'article',
    message: translateTemplate('Supprimer « {name} » ?', { name: item.name }),
    confirmLabel: 'Supprimer',
  })
  if (!confirmed) return
  try {
    const { data } = await api.delete<{ message?: string }>(`/lab-stock/items/${id}`)
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
  if (action === 'edit') openEditModal(id)
  if (action === 'toggle') toggleItem(id)
  if (action === 'delete') deleteItem(id)
}

type ExportRow = (typeof tableRows.value)[number]
const exportColumns = computed<ExportColumn<ExportRow>[]>(() => {
  void localeCode.value
  return [
    { header: uiText('Article'), value: (r) => r.name },
    { header: uiText('SKU'), value: (r) => r.sku },
    { header: uiText('Catégorie'), value: (r) => r.category },
    { header: uiText('Unité'), value: (r) => r.unit },
    { header: uiText('Coût'), value: (r) => r.cost },
    { header: uiText('Seuil'), value: (r) => r.minStock },
    { header: uiText('Stock'), value: (r) => r.quantity },
    { header: uiText('État'), value: (r) => r.statusLabel },
  ]
})

function exportPdf() {
  exportTablePdf(uiText('Stock laboratoire'), exportColumns.value, tableRows.value)
}

function exportExcel() {
  exportTableExcel(uiText('Stock laboratoire'), exportColumns.value, tableRows.value)
}

onMounted(async () => {
  await Promise.all([loadItems(), loadCategories()])
})

defineExpose({ reload: loadItems })
</script>

<template>
  <PageTableSection embedded>
    <template #toolbar>
      <ExportButtons :disabled="loading || !tableRows.length" @pdf="exportPdf" @excel="exportExcel" />
      <UiButton variant="ghost" size="sm" :icon="RefreshCw" :disabled="loading || saving" @click="loadItems">
        Actualiser
      </UiButton>
      <UiButton variant="primary" size="sm" :icon="Plus" ui-action="table.create" @click="openCreateModal">
        Nouvel article
      </UiButton>
    </template>

    <UiAlert v-if="message && !modalOpen" :type="messageType" :message="message" class="panel-alert" />

    <p v-if="!loading && !items.length" class="empty">
      {{ uiText('Aucun article — ajoutez réactifs et consommables du laboratoire.') }}
    </p>
    <div v-else class="simple-table-shell" :class="{ 'simple-table-shell--fill': true }">
      <div v-if="loading" class="simple-table-overlay" role="status" aria-live="polite">
        <span class="simple-table-spinner" aria-hidden="true" />
        Chargement du stock…
      </div>
      <div class="simple-table-scroll">
        <div class="simple-table-wrap">
          <table class="simple-table">
            <thead>
              <tr>
                <th class="simple-table__num">#</th>
                <th>Article</th>
                <th>Catégorie</th>
                <th>Unité</th>
                <th>Coût unit.</th>
                <th>Seuil</th>
                <th>Stock</th>
                <th>État</th>
                <th class="simple-table__actions-head">Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, index) in tableRows" :key="row.id">
                <td class="simple-table__num">{{ index + 1 }}</td>
                <td><span class="st-name">{{ row.name }}</span></td>
                <td>{{ row.category }}</td>
                <td>{{ row.unit }}</td>
                <td><span class="st-amount">{{ row.cost }}</span></td>
                <td>{{ row.minStock }}</td>
                <td>
                  <span class="st-badge" :class="`st-badge--${row.stockVariant}`">{{ row.stockLabel }}</span>
                </td>
                <td>
                  <span class="st-badge" :class="`st-badge--${row.statusVariant}`">{{ row.statusLabel }}</span>
                </td>
                <td class="simple-table__actions">
                  <StCatalogActions
                    :id="row.id"
                    :toggle-label="row.toggleLabel"
                    :is-active="row.isActive"
                    :can-delete="row.canDelete"
                    @action="onTableAction"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </PageTableSection>

  <UiFormModal
    v-if="modalOpen"
    title-id="lab-stock-item-modal-title"
    :title="isEditing ? 'Modifier l\'article' : 'Nouvel article'"
    subtitle="Réactifs et consommables du laboratoire"
    :icon="Package"
    size="large"
    @close="closeModal"
  >
    <UiAlert v-if="message && modalOpen" :type="messageType" :message="message" />

    <section class="item-form">
      <div class="item-form__row item-form__row--2">
        <UiInput v-model="formName" label="Nom" placeholder="Ex. Réactif glucose" required />
        <UiInput v-model="formReference" label="Référence" placeholder="Optionnel" />
      </div>

      <div class="item-form__row item-form__row--2">
        <UiSelect v-model="formUnit" label="Unité">
          <option v-for="unit in UNIT_OPTIONS" :key="unit" :value="unit">{{ uiText(unit) }}</option>
        </UiSelect>
        <UiSelect v-model="formCategoryId" label="Catégorie">
          <option value="">{{ uiText('Sans catégorie') }}</option>
          <option v-for="category in activeCategories" :key="category.id" :value="category.id">
            {{ uiText(category.name) }}
          </option>
        </UiSelect>
      </div>

      <div class="item-form__row item-form__row--3">
        <UiInput
          v-model="formQuantity"
          label="Quantité en stock"
          type="number"
          min="0"
        />
        <UiInput v-model="formUnitCost" label="Coût unitaire (FCFA)" type="number" min="0" />
        <UiInput v-model="formMinStock" label="Seuil d'alerte" type="number" min="0" />
      </div>

      <div class="expiry-field">
        <UiInput
          v-model="formExpiryDate"
          label="Date d'expiration"
          type="date"
          :disabled="formNoExpiry"
        />
        <label class="checkbox-field">
          <input v-model="formNoExpiry" type="checkbox" />
          <span>{{ uiText('Aucune expiration') }}</span>
        </label>
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
  margin: 1.5rem 0;
  color: var(--text-muted, #64748b);
}
.item-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.item-form__row {
  display: grid;
  gap: 1rem;
}
.item-form__row--2 {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.item-form__row--3 {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
.expiry-field {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 1rem;
}
.checkbox-field {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.875rem;
  padding-bottom: 0.35rem;
}
@media (max-width: 720px) {
  .item-form__row--2,
  .item-form__row--3 {
    grid-template-columns: 1fr;
  }
}
</style>
