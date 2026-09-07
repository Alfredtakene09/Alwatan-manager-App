<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import axios from 'axios'
import { Package, Plus, RefreshCw, Save, Search } from '@lucide/vue'
import api from '@/api/client'
import { canAccessModule, formatFcfa } from '@/lib/roles'
import { defaultExpiryDateInput, PHARMACEUTICAL_FORMS } from '@/lib/pharmacy-product-forms'
import { exportTableExcel, exportTablePdf, type ExportColumn } from '@/lib/table-export'
import type { PharmacySupplierRecord } from '@/components/pharmacie/PharmacySuppliersPanel.vue'
import type { PharmacyFormRecord } from '@/components/pharmacie/PharmacyFormsPanel.vue'
import PageTableSection from '@/components/ui/PageTableSection.vue'
import ExportButtons from '@/components/ui/ExportButtons.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiFormModal from '@/components/ui/UiFormModal.vue'
import StCatalogActions from '@/components/ui/StCatalogActions.vue'
import { confirmAppModal, showApiErrorModal, showSuccessModal } from '@/lib/api-modal-helper'
import { useAuthStore } from '@/stores/auth'
import { useAppI18n } from '@/i18n/useAppI18n'
import { translateTemplate } from '@/lib/dashboard-i18n'

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
  purchasePriceFcfa: number | null
  minStock: number
  sachetsPerBox: number
  sachetPriceFcfa: number | null
  sellBySachet: boolean
  active: boolean
}

const emit = defineEmits<{ changed: [] }>()

const { uiText, localeCode } = useAppI18n()
const auth = useAuthStore()
const canManageCatalog = computed(() =>
  auth.user ? canAccessModule(auth.user.role, 'pharmacie') : false,
)
const formFeedback = ref('')
const formFeedbackType = ref<'error' | 'success' | 'info'>('error')

const items = ref<PharmacyProductRecord[]>([])
const categories = ref<PharmacyCategoryOption[]>([])
const forms = ref<PharmacyFormRecord[]>([])
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
const formPurchasePrice = ref('')
const formMinStock = ref('10')
const formSachetsPerBox = ref('1')
const formSachetPrice = ref('')
const formSellBySachet = ref(false)

const filterQuery = ref('')
const filterForm = ref('')
const filterCategoryId = ref('')
const appliedQuery = ref('')
const appliedForm = ref('')
const appliedCategoryId = ref('')

const itemsById = computed(() => new Map(items.value.map((item) => [item.id, item])))
const isEditing = computed(() => editingId.value !== null)
const activeSuppliers = computed(() => suppliers.value.filter((s) => s.active))
const activeCategories = computed(() => categories.value.filter((c) => c.active !== false))
const filterFormOptions = computed(() => forms.value.filter((f) => f.active))
const activeForms = computed(() => {
  const active = forms.value.filter((f) => f.active)
  const selected = asTrimmedText(formPharmaceuticalForm.value)
  if (selected && !active.some((f) => f.name === selected)) {
    const orphan = forms.value.find((f) => f.name === selected)
    if (orphan) return [...active, orphan]
    return [...active, { id: `legacy-${selected}`, name: selected, sortOrder: 999, active: false, productsCount: 0 }]
  }
  return active
})

const filteredItems = computed(() => {
  const q = appliedQuery.value.toLowerCase()
  return items.value.filter((item) => {
    if (appliedCategoryId.value && item.categoryId !== appliedCategoryId.value) return false
    if (appliedForm.value && (item.pharmaceuticalForm || '') !== appliedForm.value) return false
    if (q) {
      const hay = [
        item.name,
        item.dosage,
        item.sku,
        item.barcode,
        item.category?.name,
        item.pharmaceuticalForm,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
})

const tableRows = computed(() => {
  void localeCode.value
  return filteredItems.value.map((item) => {
    const purchase = item.purchasePriceFcfa
    const hasPurchase = purchase != null && purchase > 0
    const profitFcfa = hasPurchase ? item.unitPriceFcfa - purchase : null
    return {
      id: item.id,
      name: item.dosage ? `${item.name} — ${item.dosage}` : item.name,
      form: item.pharmaceuticalForm || '—',
      category: item.category?.name ?? '—',
      price: formatFcfa(item.unitPriceFcfa),
      priceSort: item.unitPriceFcfa,
      purchasePrice: hasPurchase ? formatFcfa(purchase) : '—',
      purchasePriceSort: hasPurchase ? purchase : -1,
      profit: profitFcfa != null ? formatFcfa(profitFcfa) : '—',
      profitSort: profitFcfa ?? Number.NEGATIVE_INFINITY,
      quantity: item.quantity,
      minStock: item.minStock,
      stockLabel: translateTemplate('{n} en stock', { n: item.quantity }),
      stockVariant: item.quantity <= item.minStock ? 'danger' : 'success',
      statusLabel: item.active ? uiText('Actif') : uiText('Inactif'),
      statusVariant: item.active ? 'success' : 'danger',
      toggleLabel: item.active ? uiText('Désactiver') : uiText('Activer'),
      isActive: item.active,
      canDelete: canManageCatalog.value,
      showEdit: canManageCatalog.value,
      showToggle: canManageCatalog.value,
    }
  })
})

function setFormFeedback(text: string, type: 'error' | 'success' | 'info' = 'error') {
  formFeedback.value = text
  formFeedbackType.value = type
  message.value = text
  messageType.value = type === 'success' ? 'success' : 'error'
}

function clearFormFeedback() {
  formFeedback.value = ''
}

function asTrimmedText(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

function applyFilters() {
  appliedQuery.value = filterQuery.value.trim()
  appliedForm.value = filterForm.value
  appliedCategoryId.value = filterCategoryId.value
}

function apiErrorMessage(error: unknown, fallback: string) {
  if (axios.isAxiosError(error)) {
    const code = String(error.response?.data?.code ?? '')
    if (code === 'SESSION_REPLACED') {
      return 'Session fermée — ce compte est ouvert sur un autre poste ou une autre adresse (127.0.0.1 vs 192.168…). Fermez les autres onglets, reconnectez-vous ici, puis réessayez.'
    }
    if (code === 'SESSION_IDLE') {
      return 'Session expirée (inactivité). Reconnectez-vous puis réessayez.'
    }
    if (typeof error.response?.data?.error === 'string') {
      return error.response.data.error
    }
    if (typeof error.response?.data?.message === 'string') {
      return error.response.data.message
    }
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

async function loadForms() {
  try {
    const { data } = await api.get<PharmacyFormRecord[]>('/pharmacie/forms')
    const rows = data.filter((row) => row.id && row.name)
    if (rows.length) {
      forms.value = rows
      return
    }
  } catch {
    /* repli ci-dessous */
  }
  forms.value = PHARMACEUTICAL_FORMS.map((name, index) => ({
    id: `default-${index}`,
    name,
    sortOrder: index,
    active: true,
    productsCount: 0,
  }))
}

async function loadCatalogLookups() {
  await Promise.all([loadCategories(), loadForms(), loadSuppliers()])
}

async function loadItems(options?: { clearMessage?: boolean }) {
  loading.value = true
  if (options?.clearMessage !== false) message.value = ''
  try {
    await Promise.all([loadCategories(), loadForms()])
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
  formPurchasePrice.value = ''
  formMinStock.value = '10'
  formSachetsPerBox.value = '1'
  formSachetPrice.value = ''
  formSellBySachet.value = false
}

async function openCreateModal() {
  if (!canManageCatalog.value) {
    void showApiErrorModal(null, "Accès refusé — module pharmacie requis.")
    return
  }
  editingId.value = null
  resetForm()
  clearFormFeedback()
  message.value = ''
  modalOpen.value = true
  void loadCatalogLookups()
}

async function openEditModal(id: string) {
  if (!canManageCatalog.value) return
  const item = itemsById.value.get(id)
  if (!item) return
  void loadCatalogLookups()
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
  formPurchasePrice.value = item.purchasePriceFcfa ? String(item.purchasePriceFcfa) : ''
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
  const unitPriceFcfa = Math.round(Number(formUnitPrice.value))
  const purchasePriceFcfa = Math.round(Number(formPurchasePrice.value))
  const sachetPrice = Math.round(Number(formSachetPrice.value))
  return {
    name: asTrimmedText(formName.value),
    barcode: asTrimmedText(formBarcode.value) || undefined,
    dosage: asTrimmedText(formDosage.value) || undefined,
    pharmaceuticalForm: formPharmaceuticalForm.value || undefined,
    categoryId: formCategoryId.value || null,
    supplierId: formSupplierId.value || undefined,
    expiryDate: formNoExpiry.value ? null : formExpiryDate.value,
    noExpiry: formNoExpiry.value,
    unitPriceFcfa,
    purchasePriceFcfa: Number.isFinite(purchasePriceFcfa) && purchasePriceFcfa > 0 ? purchasePriceFcfa : null,
    minStock: Math.round(Number(formMinStock.value)) || 10,
    sachetsPerBox: Math.round(Number(formSachetsPerBox.value)) || 1,
    sachetPriceFcfa: Number.isFinite(sachetPrice) && sachetPrice > 0 ? sachetPrice : null,
    sellBySachet: formSellBySachet.value,
    ...(!isEditing.value ? { quantity: Math.round(Number(formQuantity.value)) || 0 } : {}),
  }
}

async function saveItem() {
  const name = asTrimmedText(formName.value)
  const unitPriceFcfa = Math.round(Number(formUnitPrice.value))
  const purchasePriceFcfa = Math.round(Number(formPurchasePrice.value))
  const issues: string[] = []

  if (name.length < 2) issues.push('Le nom du médicament est requis (2 caractères minimum).')
  if (!Number.isFinite(unitPriceFcfa) || unitPriceFcfa <= 0) {
    issues.push('Indiquez un prix de vente en FCFA (nombre entier > 0).')
  }
  if (
    asTrimmedText(formPurchasePrice.value) &&
    (!Number.isFinite(purchasePriceFcfa) || purchasePriceFcfa <= 0)
  ) {
    issues.push("Le prix d'achat doit être un nombre entier positif.")
  }

  if (issues.length) {
    setFormFeedback(issues.join(' '), 'error')
    return
  }

  saving.value = true
  clearFormFeedback()
  const payload = buildPayload()
  const successText = isEditing.value ? 'Produit modifié.' : 'Produit ajouté.'

  try {
    if (isEditing.value && editingId.value) {
      await api.put(`/pharmacie/products/${editingId.value}`, payload)
    } else {
      await api.post('/pharmacie/products', payload)
    }
    emit('changed')
    message.value = successText
    messageType.value = 'success'
    closeModal()
    await loadItems({ clearMessage: false })
    void showSuccessModal('Catalogue pharmacie', successText)
  } catch (error) {
    const errorText = apiErrorMessage(error, 'Enregistrement impossible — vérifiez les données saisies.')
    setFormFeedback(errorText, 'error')
    void showApiErrorModal(error, errorText)
  } finally {
    saving.value = false
  }
}

async function toggleItem(id: string) {
  if (!canManageCatalog.value) return
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
  if (!canManageCatalog.value) return
  const item = itemsById.value.get(id)
  if (!item) return
  const confirmed = await confirmAppModal({
    type: 'DELETE',
    title: 'Supprimer le produit',
    message: translateTemplate('Supprimer le produit « {name} » ?', { name: item.name }),
    confirmLabel: 'Supprimer',
  })
  if (!confirmed) return
  try {
    const { data } = await api.delete<{ message?: string }>(`/pharmacie/products/${id}`)
    message.value = data.message ?? 'Produit supprimé.'
    messageType.value = 'success'
    emit('changed')
    await loadItems()
  } catch (error) {
    await showApiErrorModal(error, 'Suppression impossible.')
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

type ProductExportRow = (typeof tableRows.value)[number]

const productExportColumns = computed<ExportColumn<ProductExportRow>[]>(() => {
  void localeCode.value
  return [
    { header: uiText('Médicament'), value: (r) => r.name },
    { header: uiText('Catégorie'), value: (r) => r.category },
    { header: uiText('Forme'), value: (r) => r.form },
    { header: uiText('Prix vente'), value: (r) => r.price },
    { header: uiText("Prix d'achat"), value: (r) => r.purchasePrice },
    { header: uiText('Bénéfice'), value: (r) => r.profit },
    { header: uiText('Seuil'), value: (r) => r.minStock },
    { header: uiText('Disponible'), value: (r) => r.quantity },
    { header: uiText('Statut'), value: (r) => r.statusLabel },
  ]
})

function exportPdf() {
  exportTablePdf(uiText('Produits pharmacie'), productExportColumns.value, tableRows.value)
}

function exportExcel() {
  exportTableExcel(uiText('Produits pharmacie'), productExportColumns.value, tableRows.value)
}

defineExpose({ reload: loadItems })
</script>

<template>
  <PageTableSection embedded>
    <template #toolbar>
      <input
        v-model="filterQuery"
        class="filter-input"
        type="search"
        :placeholder="uiText('Rechercher un produit…')"
        :aria-label="uiText('Rechercher un produit')"
        @keydown.enter.prevent="applyFilters"
      />
      <select v-model="filterForm" class="filter-select" :aria-label="uiText('Filtrer par forme')">
        <option value="">{{ uiText('Toutes les formes') }}</option>
        <option v-for="form in filterFormOptions" :key="form.id" :value="form.name">{{ form.name }}</option>
      </select>
      <select v-model="filterCategoryId" class="filter-select" :aria-label="uiText('Filtrer par catégorie')">
        <option value="">{{ uiText('Toutes les catégories') }}</option>
        <option v-for="category in activeCategories" :key="category.id" :value="category.id">
          {{ category.name }}
        </option>
      </select>
      <UiButton variant="ghost" size="sm" :icon="Search" :disabled="loading" @click="applyFilters">
        {{ uiText('Rechercher') }}
      </UiButton>
      <ExportButtons :disabled="loading || !tableRows.length" @pdf="exportPdf" @excel="exportExcel" />
      <UiButton variant="ghost" size="sm" :icon="RefreshCw" :disabled="loading || saving" @click="loadItems">
        {{ uiText('Actualiser') }}
      </UiButton>
      <UiButton
        v-if="canManageCatalog"
        variant="primary"
        size="sm"
        :icon="Plus"
        @click="openCreateModal"
      >
        {{ uiText('Nouveau produit') }}
      </UiButton>
    </template>

    <UiAlert v-if="message && !modalOpen" :type="messageType" :message="message" class="panel-alert" />

    <p v-if="!loading && !items.length" class="empty">{{ uiText('Aucun produit enregistré') }}</p>
    <p v-else-if="!loading && !tableRows.length" class="empty">{{ uiText('Aucun produit ne correspond à la recherche.') }}</p>
    <div v-else class="simple-table-shell" :class="{ 'simple-table-shell--fill': true }">
      <div v-if="loading" class="simple-table-overlay" role="status" aria-live="polite">
        <span class="simple-table-spinner" aria-hidden="true" />
        Chargement des produits…
      </div>
      <div class="simple-table-scroll">
        <div class="simple-table-wrap">
          <table class="simple-table">
            <thead>
              <tr>
                <th class="simple-table__num">#</th>
                <th>Médicament</th>
                <th>Catégorie</th>
                <th>Forme</th>
                <th>Prix vente</th>
                <th>Prix d'achat</th>
                <th>Bénéfice</th>
                <th>Seuil</th>
                <th>Disponible</th>
                <th>Statut</th>
                <th v-if="canManageCatalog" class="simple-table__actions-head">Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, index) in tableRows" :key="row.id">
                <td class="simple-table__num">{{ index + 1 }}</td>
                <td><span class="st-name">{{ row.name }}</span></td>
                <td>{{ row.category }}</td>
                <td>{{ row.form }}</td>
                <td><span class="st-amount">{{ row.price }}</span></td>
                <td><span class="st-amount">{{ row.purchasePrice }}</span></td>
                <td><span class="st-amount">{{ row.profit }}</span></td>
                <td>{{ row.minStock }}</td>
                <td>
                  <span class="st-badge" :class="`st-badge--${row.stockVariant}`">{{ row.stockLabel }}</span>
                </td>
                <td>
                  <span class="st-badge" :class="`st-badge--${row.statusVariant}`">{{ row.statusLabel }}</span>
                </td>
                <td v-if="canManageCatalog" class="simple-table__actions">
                  <StCatalogActions
                    :id="row.id"
                    :toggle-label="row.toggleLabel"
                    :is-active="row.isActive"
                    :can-delete="row.canDelete"
                    :show-edit="row.showEdit"
                    :show-toggle="row.showToggle"
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
    title-id="pharmacy-product-modal-title"
    :title="isEditing ? 'Modifier le produit' : 'Ajout d\'un produit'"
    size="large"
    :icon="Package"
    @close="closeModal"
  >
    <UiAlert v-if="(message || formFeedback) && modalOpen" :type="formFeedback ? formFeedbackType === 'success' ? 'success' : 'error' : messageType" :message="formFeedback || message" />

    <form id="pharmacy-product-form" class="product-form" novalidate @submit.prevent="saveItem">
      <div class="product-form__row product-form__row--name">
        <UiInput v-model="formName" label="Nom du médicament" placeholder="Ex. Paracétamol" />
        <UiInput v-model="formDosage" label="Dosage" placeholder="Ex. 500 mg" />
      </div>

      <div class="product-form__row product-form__row--2">
        <UiInput v-model="formBarcode" label="Code-barres" placeholder="Scan ou saisie manuelle" />
        <UiSelect v-model="formCategoryId" label="Catégorie">
          <option value="">{{ uiText('Sans catégorie') }}</option>
          <option v-for="category in activeCategories" :key="category.id" :value="category.id">
            {{ category.name }}
          </option>
        </UiSelect>
      </div>

      <div class="product-form__row product-form__row--2">
        <UiSelect v-model="formPharmaceuticalForm" label="Forme">
          <option value="">{{ uiText('Sélectionner une forme') }}</option>
          <option v-for="form in activeForms" :key="form.id" :value="form.name">{{ form.name }}</option>
        </UiSelect>
        <UiSelect v-model="formSupplierId" label="Fournisseur">
          <option value="">{{ uiText('Sélectionner un fournisseur') }}</option>
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
            <span>{{ uiText('Aucune') }}</span>
          </label>
        </div>
        <div class="amount-field">
          <span class="amount-field__label">{{ uiText("Prix d'achat") }}</span>
          <div class="amount-field__wrap">
            <input
              v-model="formPurchasePrice"
              class="amount-field__input"
              type="number"
              min="1"
              placeholder="0"
            />
            <span class="amount-field__suffix">FCFA</span>
          </div>
        </div>
      </div>

      <div :class="['product-form__row', isEditing ? 'product-form__row--2' : 'product-form__row--3']">
        <UiInput
          v-if="!isEditing"
          v-model="formQuantity"
          label="Quantité initiale"
          type="number"
          min="0"
        />
        <div class="amount-field">
          <span class="amount-field__label">{{ uiText('Prix de vente') }} <span class="req">*</span></span>
          <div class="amount-field__wrap">
            <input
              v-model="formUnitPrice"
              class="amount-field__input"
              type="number"
              min="1"
              step="1"
              placeholder="0"
            />
            <span class="amount-field__suffix">FCFA</span>
          </div>
        </div>
        <UiInput v-model="formMinStock" label="Seuil d'alerte" type="number" min="0" />
      </div>

      <div class="product-form__section">{{ uiText('Configuration des sachets') }}</div>

      <div class="product-form__row product-form__row--2">
        <UiInput v-model="formSachetsPerBox" label="Sachets par boîte" type="number" min="1" />
        <div class="amount-field">
          <span class="amount-field__label">{{ uiText('Prix par sachet') }}</span>
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
        <span>{{ uiText('Vente par sachet') }}</span>
      </label>

      <div class="product-form__actions">
        <UiButton variant="ghost" type="button" @click="closeModal">{{ uiText('Annuler') }}</UiButton>
        <UiButton
          variant="primary"
          type="button"
          :icon="Save"
          :loading="saving"
          :disabled="saving"
          @click="saveItem"
        >
          {{ saving ? uiText('Enregistrement…') : uiText('Enregistrer') }}
        </UiButton>
      </div>
    </form>
  </UiFormModal>
</template>

<style scoped>
.panel-alert {
  margin-bottom: 1rem;
}

.filter-input,
.filter-select {
  min-width: 9rem;
  padding: 0.4rem 0.6rem;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: #fff;
  font-family: inherit;
  font-size: 0.8125rem;
  color: var(--text);
}

.filter-input {
  min-width: 12rem;
  flex: 1 1 12rem;
  max-width: 18rem;
}

.filter-select {
  min-width: 10rem;
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

.product-form-feedback {
  margin-bottom: 1rem;
  padding: 0.75rem 1rem;
  border-radius: 8px;
  font-size: 0.875rem;
  font-weight: 500;
  line-height: 1.4;
}

.product-form-feedback--error {
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #b91c1c;
}

.product-form-feedback--success {
  background: #f0fdf4;
  border: 1px solid #bbf7d0;
  color: #15803d;
}

.product-form__actions {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 0.65rem;
  margin-top: 0.75rem;
  padding-top: 1rem;
  border-top: 1px solid var(--border);
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

.product-form__row--4 {
  grid-template-columns: repeat(4, minmax(0, 1fr));
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
  .product-form__row--3,
  .product-form__row--4 {
    grid-template-columns: 1fr;
  }

  .expiry-field {
    grid-template-columns: 1fr;
  }
}
</style>
