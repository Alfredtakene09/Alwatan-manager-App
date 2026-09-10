<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import axios from 'axios'
import { Eye, Package, Pencil, Plus, RefreshCw, Save, Search } from '@lucide/vue'
import api from '@/api/client'
import { formatFcfa } from '@/lib/roles'
import {
  DEFAULT_LOGISTICS_UNIT,
  logisticsUnitOptions,
  resolvePackagingMode,
} from '@/lib/logistics-units'
import {
  formatPackagingConfig,
  formatPackagingStock,
  hasMultiPackaging,
  packagingToUnits,
  unitsToPackaging,
} from '@/lib/logistics-packaging'
import { exportTableExcel, exportTablePdf, exportTableWord, type ExportColumn } from '@/lib/table-export'
import type { LogisticsCategoryRecord } from '@/components/logistique/LogisticsCategoriesPanel.vue'
import type { LogisticsSupplierRecord } from '@/components/logistique/LogisticsSuppliersPanel.vue'
import PageTableSection from '@/components/ui/PageTableSection.vue'
import ExportButtons from '@/components/ui/ExportButtons.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiFormModal from '@/components/ui/UiFormModal.vue'
import StCatalogActions from '@/components/ui/StCatalogActions.vue'
import { confirmAppModal } from '@/lib/api-modal-helper'
import '@/assets/simple-table.css'

export type LogisticsItemRecord = {
  id: string
  name: string
  sku: string
  reference: string | null
  unit: string
  unitsPerPackage: number
  packagesPerCarton: number
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
const formUnitsPerPackage = ref('1')
const formPackagesPerCarton = ref('1')
const formCategoryId = ref('')
const formSupplierId = ref('')
const formCartons = ref('0')
const formPackages = ref('0')
const formUnits = ref('0')
const formUnitCost = ref('')
const formMinStock = ref('5')
const formExpiryDate = ref('')
const formNoExpiry = ref(true)
const searchQuery = ref('')
const filterCategoryId = ref('')

const itemsById = computed(() => new Map(items.value.map((item) => [item.id, item])))
const viewingItem = computed(() => (viewingId.value ? itemsById.value.get(viewingId.value) ?? null : null))
const viewingBreakdown = computed(() => {
  const item = viewingItem.value
  if (!item) return null
  const packaging = {
    unitsPerPackage: item.unitsPerPackage ?? 1,
    packagesPerCarton: item.packagesPerCarton ?? 1,
  }
  const mode = resolvePackagingMode(item.unit)
  const upp = Math.max(1, packaging.unitsPerPackage)
  const parts =
    mode === 'paquet'
      ? {
          cartons: 0,
          packages: Math.floor(item.quantity / upp),
          units: item.quantity % upp,
          totalUnits: item.quantity,
        }
      : unitsToPackaging(item.quantity, packaging)

  let stockLabel: string
  if (mode === 'unité') {
    stockLabel = `${item.quantity} unité${item.quantity > 1 ? 's' : ''}`
  } else if (mode === 'paquet') {
    const chunks: string[] = []
    if (parts.packages > 0) chunks.push(`${parts.packages} paquet${parts.packages > 1 ? 's' : ''}`)
    if (parts.units > 0) chunks.push(`${parts.units} unité${parts.units > 1 ? 's' : ''}`)
    stockLabel = chunks.length ? chunks.join(' + ') : '0 unité'
  } else {
    stockLabel = formatPackagingStock(item.quantity, packaging, { unitLabel: 'unité' })
  }

  return {
    packaging,
    multi: hasMultiPackaging(packaging),
    parts,
    configLabel: formatPackagingConfig(packaging),
    stockLabel,
    mode,
  }
})
const isEditing = computed(() => editingId.value !== null)
const activeSuppliers = computed(() => suppliers.value.filter((s) => s.active))
const activeCategories = computed(() => categories.value.filter((c) => c.active !== false))

const unitOptions = computed(() => logisticsUnitOptions(formUnit.value))
const packagingMode = computed(() => resolvePackagingMode(formUnit.value))
const showPackageFields = computed(() => packagingMode.value === 'paquet' || packagingMode.value === 'carton')
const showCartonFields = computed(() => packagingMode.value === 'carton')
const quantityUnitsLabel = computed(() => {
  if (packagingMode.value === 'paquet' || packagingMode.value === 'carton' || formUnit.value === 'unité') {
    return "Nombre d'unités"
  }
  return `Quantité (${formUnit.value})`
})

const formPackaging = computed(() => {
  if (packagingMode.value === 'unité') {
    return { unitsPerPackage: 1, packagesPerCarton: 1 }
  }
  if (packagingMode.value === 'paquet') {
    return {
      unitsPerPackage: Math.max(1, Math.trunc(Number(formUnitsPerPackage.value) || 1)),
      packagesPerCarton: 1,
    }
  }
  return {
    unitsPerPackage: Math.max(1, Math.trunc(Number(formUnitsPerPackage.value) || 1)),
    packagesPerCarton: Math.max(1, Math.trunc(Number(formPackagesPerCarton.value) || 1)),
  }
})

const formTotalUnits = computed(() =>
  packagingToUnits(
    {
      cartons: showCartonFields.value ? Number(formCartons.value) || 0 : 0,
      packages: showPackageFields.value ? Number(formPackages.value) || 0 : 0,
      // En mode paquet/carton, les unités = total auto (pas une saisie en plus)
      units: showPackageFields.value ? 0 : Number(formUnits.value) || 0,
    },
    formPackaging.value,
  ),
)

watch(
  [
    formCartons,
    formPackages,
    formUnitsPerPackage,
    formPackagesPerCarton,
    showPackageFields,
    showCartonFields,
  ],
  () => {
    if (!showPackageFields.value) return
    formUnits.value = String(formTotalUnits.value)
  },
)

watch(packagingMode, (mode, previous) => {
  if (!modalOpen.value || mode === previous) return
  if (mode === 'unité') {
    formUnitsPerPackage.value = '1'
    formPackagesPerCarton.value = '1'
    formCartons.value = '0'
    formPackages.value = '0'
  } else if (mode === 'paquet') {
    formPackagesPerCarton.value = '1'
    formCartons.value = '0'
    if (Number(formUnitsPerPackage.value) < 2) formUnitsPerPackage.value = '10'
  } else if (mode === 'carton') {
    if (Number(formUnitsPerPackage.value) < 2) formUnitsPerPackage.value = '10'
    if (Number(formPackagesPerCarton.value) < 2) formPackagesPerCarton.value = '10'
  }
})

const tableRows = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  const categoryId = filterCategoryId.value
  return items.value
    .filter((item) => {
      if (categoryId) {
        const itemCategoryId = item.categoryId ?? item.category?.id ?? ''
        if (itemCategoryId !== categoryId) return false
      }
      if (!q) return true
      const haystack = [
        item.name,
        item.sku,
        item.reference,
        item.unit,
        item.category?.name,
        item.supplier?.name,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return haystack.includes(q)
    })
    .map((item) => {
    const packaging = {
      unitsPerPackage: item.unitsPerPackage ?? 1,
      packagesPerCarton: item.packagesPerCarton ?? 1,
    }
    const mode = resolvePackagingMode(item.unit)
    const upp = Math.max(1, packaging.unitsPerPackage)
    let cartonsLabel = '—'
    let packagesLabel = '—'
    let unitsLabel = String(item.quantity)

    if (mode === 'paquet') {
      packagesLabel = String(Math.floor(item.quantity / upp))
      unitsLabel = String(item.quantity)
    } else if (mode === 'carton') {
      const parts = unitsToPackaging(item.quantity, packaging)
      cartonsLabel = String(parts.cartons)
      packagesLabel = String(parts.packages)
      unitsLabel = String(item.quantity)
    }

    return {
      id: item.id,
      name: item.name,
      category: item.category?.name ?? '—',
      quantity: item.quantity,
      cartonsLabel,
      packagesLabel,
      unitsLabel,
      stockVariant: item.quantity <= item.minStock ? 'danger' : 'success',
      statusLabel: item.active ? 'Actif' : 'Inactif',
      statusVariant: item.active ? 'success' : 'danger',
      toggleLabel: item.active ? 'Désactiver' : 'Activer',
      isActive: item.active,
      canDelete: true,
    }
  })
})

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
  formUnitsPerPackage.value = '1'
  formPackagesPerCarton.value = '1'
  formCategoryId.value = activeCategories.value[0]?.id ?? ''
  formSupplierId.value = ''
  formCartons.value = '0'
  formPackages.value = '0'
  formUnits.value = '0'
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
  const mode = resolvePackagingMode(item.unit)
  const upp = Math.max(1, item.unitsPerPackage ?? 1)
  const ppc = Math.max(1, item.packagesPerCarton ?? 1)
  formName.value = item.name
  formUnit.value = item.unit
  formUnitsPerPackage.value = String(upp)
  formPackagesPerCarton.value = String(ppc)
  formCategoryId.value = item.categoryId ?? item.category?.id ?? ''
  formSupplierId.value = item.supplierId ?? ''
  if (mode === 'unité') {
    formCartons.value = '0'
    formPackages.value = '0'
    formUnits.value = String(item.quantity)
  } else if (mode === 'paquet') {
    formCartons.value = '0'
    formPackages.value = String(Math.floor(item.quantity / upp))
    formUnits.value = String(Math.floor(item.quantity / upp) * upp)
  } else {
    const parts = unitsToPackaging(item.quantity, {
      unitsPerPackage: upp,
      packagesPerCarton: ppc,
    })
    formCartons.value = String(parts.cartons)
    formPackages.value = String(parts.packages)
    formUnits.value = String(
      packagingToUnits(
        { cartons: parts.cartons, packages: parts.packages, units: 0 },
        { unitsPerPackage: upp, packagesPerCarton: ppc },
      ),
    )
  }
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
    message.value = 'Prix unitaire invalide.'
    messageType.value = 'error'
    return
  }
  if (showPackageFields.value && formPackaging.value.unitsPerPackage < 1) {
    message.value = 'Indiquez combien de pièces contient un paquet.'
    messageType.value = 'error'
    return
  }
  if (showCartonFields.value && formPackaging.value.packagesPerCarton < 1) {
    message.value = 'Indiquez combien de paquets contient un carton.'
    messageType.value = 'error'
    return
  }

  saving.value = true
  message.value = ''
  const payload = {
    name,
    unit: formUnit.value.trim() || DEFAULT_LOGISTICS_UNIT,
    unitsPerPackage: formPackaging.value.unitsPerPackage,
    packagesPerCarton: formPackaging.value.packagesPerCarton,
    categoryId: formCategoryId.value || null,
    supplierId: formSupplierId.value || null,
    unitCostFcfa,
    minStock: Number(formMinStock.value) || 5,
    expiryDate: formNoExpiry.value ? null : formExpiryDate.value || null,
    noExpiry: formNoExpiry.value,
    cartons: showCartonFields.value ? Math.max(0, Math.trunc(Number(formCartons.value) || 0)) : 0,
    packages: showPackageFields.value ? Math.max(0, Math.trunc(Number(formPackages.value) || 0)) : 0,
    units: showPackageFields.value ? 0 : Math.max(0, Math.trunc(Number(formUnits.value) || 0)),
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
  const confirmed = await confirmAppModal({
    type: 'DELETE',
    title: "Supprimer l'article",
    message: `Supprimer l'article « ${item.name} » ?`,
    confirmLabel: 'Supprimer',
  })
  if (!confirmed) return
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

type ItemExportRow = (typeof tableRows.value)[number]

const itemExportColumns: ExportColumn<ItemExportRow>[] = [
  { header: 'Article', value: (r) => r.name },
  { header: 'Catégorie', value: (r) => r.category },
  { header: 'Cartons', value: (r) => r.cartonsLabel },
  { header: 'Paquets', value: (r) => r.packagesLabel },
  { header: 'Unités', value: (r) => r.unitsLabel },
  { header: 'Statut', value: (r) => r.statusLabel },
]

function exportPdf() {
  exportTablePdf('Articles logistique', itemExportColumns, tableRows.value)
}

function exportExcel() {
  exportTableExcel('Articles logistique', itemExportColumns, tableRows.value)
}

function exportWord() {
  void exportTableWord('Articles logistique', itemExportColumns, tableRows.value)
}

defineExpose({ reload: loadItems })
</script>

<template>
  <PageTableSection embedded>
    <template #toolbar>
      <div class="items-filters">
        <label class="items-search">
          <Search :size="16" class="items-search__icon" aria-hidden="true" />
          <input
            v-model="searchQuery"
            type="search"
            class="items-search__input"
            placeholder="Rechercher un article (nom, code…)"
            aria-label="Rechercher un article"
          />
        </label>
        <select v-model="filterCategoryId" class="items-category" aria-label="Filtrer par catégorie">
          <option value="">Toutes les catégories</option>
          <option v-for="category in categories" :key="category.id" :value="category.id">
            {{ category.name }}
          </option>
        </select>
      </div>
      <ExportButtons :disabled="loading || !tableRows.length" @pdf="exportPdf" @excel="exportExcel" @word="exportWord" />
      <UiButton variant="ghost" size="sm" :icon="RefreshCw" :disabled="loading || saving" @click="loadItems">
        Actualiser
      </UiButton>
      <UiButton variant="primary" size="sm" :icon="Plus" ui-action="table.create" @click="openCreateModal">
        Nouvel article
      </UiButton>
    </template>

    <UiAlert v-if="message && !modalOpen && !viewModalOpen" :type="messageType" :message="message" class="panel-alert" />

    <div class="simple-table-shell simple-table-shell--fill">
      <div v-if="loading" class="simple-table-overlay" role="status" aria-live="polite">
        <span class="simple-table-spinner" aria-hidden="true" />
        Chargement des articles…
      </div>
      <div class="simple-table-scroll">
        <p v-if="!loading && !items.length" class="simple-table__empty">Aucun article enregistré</p>
        <p v-else-if="!loading && items.length && !tableRows.length" class="simple-table__empty">
          Aucun article ne correspond aux critères de recherche
        </p>
        <div v-else class="simple-table-wrap">
          <table class="simple-table">
            <thead>
              <tr>
                <th class="simple-table__num">#</th>
                <th>Article</th>
                <th>Ctn</th>
                <th>Pqt</th>
                <th>Unité</th>
                <th>État</th>
                <th class="simple-table__actions-head"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, index) in tableRows" :key="row.id">
                <td class="simple-table__num">{{ index + 1 }}</td>
                <td><span class="st-name">{{ row.name }}</span></td>
                <td><span class="st-muted">{{ row.cartonsLabel }}</span></td>
                <td><span class="st-muted">{{ row.packagesLabel }}</span></td>
                <td>
                  <span class="st-badge" :class="`st-badge--${row.stockVariant}`">{{ row.unitsLabel }}</span>
                </td>
                <td>
                  <span class="st-badge" :class="`st-badge--${row.statusVariant}`">{{ row.statusLabel }}</span>
                </td>
                <td class="simple-table__actions">
                  <StCatalogActions
                    :id="row.id"
                    :is-active="row.isActive"
                    :can-delete="row.canDelete"
                    :show-view="true"
                    :show-toggle="false"
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
      <div v-if="viewingBreakdown?.mode !== 'unité'" class="item-detail__row">
        <dt>Emballage</dt>
        <dd>{{ viewingBreakdown?.configLabel }}</dd>
      </div>
      <div v-if="viewingBreakdown?.mode === 'carton'" class="item-detail__row">
        <dt>Cartons</dt>
        <dd>{{ viewingBreakdown.parts.cartons }}</dd>
      </div>
      <div v-if="viewingBreakdown?.mode === 'paquet' || viewingBreakdown?.mode === 'carton'" class="item-detail__row">
        <dt>Paquets</dt>
        <dd>{{ viewingBreakdown.parts.packages }}</dd>
      </div>
      <div class="item-detail__row">
        <dt>Quantité</dt>
        <dd>
          <strong>{{ viewingItem.quantity }} {{ viewingItem.unit }}</strong>
          <span v-if="viewingBreakdown?.mode !== 'unité'" class="item-detail__muted">
            — {{ viewingBreakdown?.stockLabel }}
          </span>
        </dd>
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

      <div class="form-block">
        <div class="item-form__row" :class="showCartonFields ? 'item-form__row--3' : showPackageFields ? 'item-form__row--2' : ''">
          <UiSelect v-model="formUnit" label="Conditionnement" required>
            <option v-for="unit in unitOptions" :key="unit.value" :value="unit.value">
              {{ unit.label }}
            </option>
          </UiSelect>
          <UiInput
            v-if="showPackageFields"
            v-model="formUnitsPerPackage"
            label="Pièces par paquet"
            type="number"
            min="1"
            required
          />
          <UiInput
            v-if="showCartonFields"
            v-model="formPackagesPerCarton"
            label="Paquets par carton"
            type="number"
            min="1"
            required
          />
        </div>
        <p v-if="showCartonFields" class="stock-line">
          1 carton =
          <strong>{{ formPackaging.packagesPerCarton * formPackaging.unitsPerPackage }}</strong>
          unités
        </p>
        <p v-else-if="showPackageFields" class="stock-line">
          1 paquet =
          <strong>{{ formPackaging.unitsPerPackage }}</strong>
          unités
        </p>
      </div>

      <div class="form-block">
        <p class="form-block__title">Quantité en stock</p>
        <div
          class="item-form__row"
          :class="showCartonFields ? 'item-form__row--3' : showPackageFields ? 'item-form__row--2' : ''"
        >
          <UiInput
            v-if="showCartonFields"
            v-model="formCartons"
            label="Nombre de cartons"
            type="number"
            min="0"
          />
          <UiInput
            v-if="showPackageFields"
            v-model="formPackages"
            label="Nombre de paquets"
            type="number"
            min="0"
          />
          <UiInput
            v-model="formUnits"
            :label="quantityUnitsLabel"
            type="number"
            min="0"
            :readonly="showPackageFields"
          />
        </div>
        <p v-if="showPackageFields" class="stock-line">
          Total =
          <strong>{{ formTotalUnits }}</strong>
          unité{{ formTotalUnits > 1 ? 's' : '' }}
          <span class="stock-line__hint">(calculé automatiquement)</span>
        </p>
      </div>

      <div class="item-form__row item-form__row--3">
        <div class="amount-field">
          <span class="amount-field__label">Prix par unité</span>
          <div class="amount-field__wrap">
            <input v-model="formUnitCost" class="amount-field__input" type="number" min="0" placeholder="0" />
            <span class="amount-field__suffix">FCFA</span>
          </div>
        </div>
        <UiInput v-model="formMinStock" label="Seuil d'alerte (unités)" type="number" min="0" />
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

.items-filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  flex: 1 1 18rem;
  min-width: 12rem;
  margin-right: auto;
}

.items-search {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  flex: 1 1 12rem;
  min-width: 10rem;
  max-width: 28rem;
  padding: 0.35rem 0.7rem;
  border: 1px solid rgba(27, 79, 156, 0.18);
  border-radius: 10px;
  background: #fff;
}

.items-search__icon {
  flex-shrink: 0;
  color: #1b4f9c;
  opacity: 0.75;
}

.items-search__input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  background: transparent;
  font-family: inherit;
  font-size: 0.875rem;
  color: var(--text);
}

.items-search__input::placeholder {
  color: var(--text-light);
}

.items-category {
  flex: 0 1 14rem;
  min-width: 10rem;
  max-width: 18rem;
  padding: 0.4rem 0.65rem;
  border: 1px solid rgba(27, 79, 156, 0.18);
  border-radius: 10px;
  background: #fff;
  font-family: inherit;
  font-size: 0.875rem;
  color: var(--text);
  cursor: pointer;
}

.items-category:focus {
  outline: 2px solid rgba(27, 79, 156, 0.35);
  outline-offset: 1px;
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

.item-detail__muted {
  margin-left: 0.35rem;
  font-size: 0.8125rem;
  color: var(--text-light);
}

.form-block {
  margin: 0.25rem 0 0.85rem;
  padding: 0.85rem 1rem;
  border: 1px solid rgba(27, 79, 156, 0.14);
  border-radius: 12px;
  background: #f7fafd;
}

.form-block__title {
  margin: 0 0 0.65rem;
  font-size: 0.8125rem;
  font-weight: 700;
  color: #1b4f9c;
}

.stock-line {
  margin: 0.35rem 0 0;
  font-size: 0.8125rem;
  color: var(--text-muted);
}

.stock-line strong {
  color: #1b4f9c;
  font-size: 0.9375rem;
}

.stock-line__hint {
  margin-left: 0.35rem;
  font-size: 0.75rem;
  opacity: 0.9;
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
