<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ListChecks, Plus, RefreshCw, Save } from '@lucide/vue'
import api from '@/api/client'
import { confirmAppModal, showDuplicateModalFromError } from '@/lib/api-modal-helper'
import { formatFcfa } from '@/lib/roles'
import { statusBadge, catalogRowActionsHtml } from '@/lib/datatable-defaults'
import { invalidateExamCatalogCache } from '@/lib/exam-catalog'
import { useAppI18n } from '@/i18n/useAppI18n'
import { translateTemplate } from '@/lib/dashboard-i18n'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiFormModal from '@/components/ui/UiFormModal.vue'
import UiDataTable from '@/components/ui/UiDataTable.vue'

type CatalogItem = {
  id: string
  kind?: string
  code: string
  label: string
  category?: string | null
  priceFcfa: number
  active: boolean
  sortOrder: number
  clinicServiceId?: string | null
  clinicService?: { id: string; name: string } | null
}

type DoctorServiceInfo = {
  clinicServiceId: string
  clinicServiceName: string
  suggestedKind: string
}

const { uiText, localeCode } = useAppI18n()

const serviceInfo = ref<DoctorServiceInfo | null>(null)
const items = ref<CatalogItem[]>([])
const loading = ref(false)
const saving = ref(false)
const message = ref('')
const messageType = ref<'success' | 'error'>('success')
const editingId = ref<string | null>(null)
const showAddModal = ref(false)
const searchQuery = ref('')
const selectedCategory = ref('')

const newItem = ref({ code: '', label: '', category: '', priceFcfa: '' })
const editForm = ref({ code: '', label: '', category: '', priceFcfa: '' })

const itemsById = computed(() => new Map(items.value.map((item) => [item.id, item])))
const serviceName = computed(() => serviceInfo.value?.clinicServiceName || uiText('Mon service'))
const pageTitle = computed(() =>
  translateTemplate('Nomenclature — {label}', { label: serviceName.value }),
)
const pageSubtitle = computed(() =>
  translateTemplate('Gérez les examens et tarifs de {service}', {
    service: serviceName.value,
  }),
)
const addButtonLabel = computed(() =>
  translateTemplate('Ajout {label}', { label: serviceName.value }),
)
const categoryOptions = computed(() => {
  const set = new Set<string>()
  for (const item of items.value) {
    const category = item.category?.trim()
    if (category) set.add(category)
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'fr'))
})
const filteredItems = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  const category = selectedCategory.value.trim()
  return items.value
    .filter((item) => {
      if (category && (item.category?.trim() || '') !== category) return false
      if (!query) return true
      const haystack = [item.label, item.code, item.category ?? ''].join(' ').toLowerCase()
      return haystack.includes(query)
    })
    .slice()
    .sort((a, b) => a.label.localeCompare(b.label, 'fr', { sensitivity: 'base' }))
})
const elementCountLabel = computed(() =>
  translateTemplate('{n} élément(s)', { n: filteredItems.value.length }),
)

const tableRows = computed(() => {
  localeCode.value
  return filteredItems.value.map((item) => ({
    id: item.id,
    label: item.label,
    code: item.code,
    category: item.category || '—',
    price: formatFcfa(item.priceFcfa),
    priceSort: item.priceFcfa,
    statusLabel: item.active ? uiText('Actif') : uiText('Inactif'),
    statusVariant: item.active ? 'success' : 'danger',
    toggleLabel: item.active ? uiText('Désactiver') : uiText('Activer'),
    isActive: item.active,
  }))
})

const columns = [
  { data: 'label', title: 'Libellé', render: (v: string) => `<span class="dt-name">${v}</span>` },
  { data: 'code', title: 'Code' },
  { data: 'category', title: 'Catégorie' },
  {
    data: 'priceSort',
    title: 'Tarif',
    render: (_d: number, _t: string, row: { price: string }) =>
      `<span class="dt-amount">${row.price}</span>`,
  },
  {
    data: 'statusLabel',
    title: 'Statut',
    render: (label: string, _t: string, row: { statusVariant: string }) =>
      statusBadge(label, row.statusVariant as 'success' | 'danger'),
  },
  {
    data: null,
    title: 'Actions',
    orderable: false,
    className: 'dt-actions-col dt-actions-col--catalog',
    render: (_d: unknown, _t: string, row: { id: string; toggleLabel: string }) =>
      catalogRowActionsHtml(row),
  },
]

function resetMessages() {
  message.value = ''
}

async function loadServiceInfo() {
  const { data } = await api.get<DoctorServiceInfo>('/consultation/exam-nomenclature/me')
  serviceInfo.value = data
}

async function loadItems() {
  loading.value = true
  resetMessages()
  try {
    if (!serviceInfo.value) await loadServiceInfo()
    const { data } = await api.get<CatalogItem[]>('/consultation/exam-nomenclature')
    items.value = Array.isArray(data) ? data : []
  } catch (error: unknown) {
    const err = error as { response?: { data?: { error?: string } } }
    message.value =
      err.response?.data?.error || 'Impossible de charger votre nomenclature.'
    messageType.value = 'error'
    items.value = []
  } finally {
    loading.value = false
  }
}

function resetNewItemForm() {
  newItem.value = { code: '', label: '', category: '', priceFcfa: '' }
}

function openAddModal() {
  resetNewItemForm()
  showAddModal.value = true
}

function closeAddModal() {
  showAddModal.value = false
  resetNewItemForm()
}

async function addItem() {
  if (!newItem.value.label.trim() || !newItem.value.priceFcfa) {
    message.value = 'Libellé et tarif sont obligatoires.'
    messageType.value = 'error'
    return
  }
  saving.value = true
  resetMessages()
  try {
    await api.post('/consultation/exam-nomenclature', {
      code: newItem.value.code.trim() || undefined,
      label: newItem.value.label.trim(),
      category: newItem.value.category.trim() || undefined,
      priceFcfa: Number(newItem.value.priceFcfa),
    })
    message.value = 'Élément ajouté à votre nomenclature.'
    messageType.value = 'success'
    invalidateExamCatalogCache()
    closeAddModal()
    await loadItems()
  } catch (error) {
    const shown = await showDuplicateModalFromError(error)
    if (!shown) {
      message.value = 'Ajout impossible. Vérifiez le code (unique) et les tarifs.'
      messageType.value = 'error'
    }
  } finally {
    saving.value = false
  }
}

function openEditModal(id: string) {
  const item = itemsById.value.get(id)
  if (!item) return
  editingId.value = id
  editForm.value = {
    code: item.code,
    label: item.label,
    category: item.category ?? '',
    priceFcfa: String(item.priceFcfa),
  }
}

function closeEditModal() {
  editingId.value = null
}

async function saveEdit() {
  if (!editingId.value) return
  if (!editForm.value.label.trim() || !editForm.value.priceFcfa) {
    message.value = 'Libellé et tarif sont obligatoires.'
    messageType.value = 'error'
    return
  }
  saving.value = true
  resetMessages()
  try {
    await api.put(`/consultation/exam-nomenclature/${editingId.value}`, {
      code: editForm.value.code.trim() || undefined,
      label: editForm.value.label.trim(),
      category: editForm.value.category.trim() || undefined,
      priceFcfa: Number(editForm.value.priceFcfa),
    })
    message.value = 'Élément mis à jour.'
    messageType.value = 'success'
    invalidateExamCatalogCache()
    closeEditModal()
    await loadItems()
  } catch {
    message.value = 'Mise à jour impossible.'
    messageType.value = 'error'
  } finally {
    saving.value = false
  }
}

async function toggleItem(id: string) {
  const item = itemsById.value.get(id)
  if (!item) return
  resetMessages()
  try {
    await api.put(`/consultation/exam-nomenclature/${id}`, { active: !item.active })
    message.value = item.active ? 'Élément désactivé.' : 'Élément réactivé.'
    messageType.value = 'success'
    invalidateExamCatalogCache()
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
    title: "Supprimer l'élément",
    message: translateTemplate(
      'Supprimer définitivement « {name} » ? Cette action est irréversible.',
      { name: item.label },
    ),
    confirmLabel: 'Supprimer',
  })
  if (!confirmed) return

  resetMessages()
  try {
    await api.delete(`/consultation/exam-nomenclature/${id}`)
    message.value = 'Élément supprimé.'
    messageType.value = 'success'
    invalidateExamCatalogCache()
    if (editingId.value === id) closeEditModal()
    await loadItems()
  } catch {
    message.value = 'Suppression impossible.'
    messageType.value = 'error'
  }
}

function onTableAction({ action, id }: { action: string; id: string }) {
  if (action === 'toggle') toggleItem(id)
  if (action === 'edit') openEditModal(id)
  if (action === 'delete') deleteItem(id)
}

onMounted(async () => {
  try {
    await loadServiceInfo()
  } catch {
    // handled in loadItems
  }
  await loadItems()
})

watch(categoryOptions, (options) => {
  if (selectedCategory.value && !options.includes(selectedCategory.value)) {
    selectedCategory.value = ''
  }
})
</script>

<template>
  <div>
    <UiPageHeader :title="pageTitle" :subtitle="pageSubtitle" :icon="ListChecks" />

    <UiAlert v-if="message" :type="messageType" :message="message" />

    <UiCard
      :title="pageTitle"
      description="Tarifs utilisés pour vos prescriptions et la facturation"
      :icon="ListChecks"
      icon-variant="teal"
      class="section"
    >
      <template #actions>
        <UiButton
          variant="primary"
          size="sm"
          :icon="Plus"
          :disabled="!serviceInfo"
          @click="openAddModal"
        >
          {{ uiText(addButtonLabel) }}
        </UiButton>
        <UiButton variant="ghost" size="sm" :icon="RefreshCw" :disabled="loading" @click="loadItems">
          Actualiser
        </UiButton>
        <span class="list-count">{{ elementCountLabel }}</span>
      </template>

      <div class="catalog-filters">
        <UiInput
          v-model="searchQuery"
          label="Rechercher"
          placeholder="Libellé, code, catégorie…"
        />
        <UiSelect
          :key="`medecin-category-filter-${serviceInfo?.clinicServiceId || 'none'}`"
          v-model="selectedCategory"
          label="Catégorie"
        >
          <option value="">{{ uiText('Toutes les catégories') }}</option>
          <option v-for="category in categoryOptions" :key="category" :value="category">
            {{ category }}
          </option>
        </UiSelect>
      </div>

      <div class="table-panel-scroll">
        <UiDataTable
          :table-key="`medecin-exam-nomenclature-${searchQuery}-${selectedCategory}`"
          compact
          :data="tableRows"
          :columns="columns"
          :loading="loading"
          loading-label="Chargement de votre nomenclature…"
          @action="onTableAction"
        />
      </div>
    </UiCard>

    <UiFormModal
      v-if="showAddModal"
      title-id="medecin-add-catalog-title"
      :title="uiText(addButtonLabel)"
      :subtitle="translateTemplate('Ajouter un examen pour {service}', { service: serviceName })"
      :icon="ListChecks"
      @close="closeAddModal"
    >
      <section class="form-panel">
        <p class="form-panel__hint">
          {{ uiText('Service') }}: <strong>{{ serviceName }}</strong>
        </p>
        <div class="form-grid-2">
          <UiInput v-model="newItem.code" label="Code (optionnel)" placeholder="ex: consultation" />
          <UiInput v-model="newItem.label" label="Libellé" placeholder="Libellé de l'examen" />
          <UiInput v-model="newItem.category" label="Catégorie (optionnel)" placeholder="Optionnel" />
          <UiInput v-model="newItem.priceFcfa" label="Tarif (FCFA)" type="number" min="1" />
        </div>
      </section>
      <template #footer>
        <UiButton variant="ghost" @click="closeAddModal">Annuler</UiButton>
        <UiButton variant="primary" :icon="Plus" :disabled="saving" @click="addItem">
          Enregistrer
        </UiButton>
      </template>
    </UiFormModal>

    <UiFormModal
      v-if="editingId"
      title-id="medecin-edit-catalog-title"
      title="Modifier l'élément"
      subtitle="Mettre à jour le libellé, la catégorie ou le tarif"
      :icon="ListChecks"
      @close="closeEditModal"
    >
      <section class="form-panel">
        <div class="form-grid-2">
          <UiInput v-model="editForm.code" label="Code (optionnel)" />
          <UiInput v-model="editForm.label" label="Libellé" />
          <UiInput v-model="editForm.category" label="Catégorie (optionnel)" />
          <UiInput v-model="editForm.priceFcfa" label="Tarif (FCFA)" type="number" min="1" />
        </div>
      </section>
      <template #footer>
        <UiButton variant="ghost" @click="closeEditModal">Annuler</UiButton>
        <UiButton variant="primary" :icon="Save" :disabled="saving" @click="saveEdit">
          Enregistrer
        </UiButton>
      </template>
    </UiFormModal>
  </div>
</template>

<style scoped>
.section {
  margin-top: 1rem;
}

.list-count {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-muted);
  white-space: nowrap;
}

.table-panel-scroll {
  overflow: auto;
}

.catalog-filters {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
  gap: 0.75rem;
  margin-bottom: 0.85rem;
}

@media (max-width: 720px) {
  .catalog-filters {
    grid-template-columns: 1fr;
  }
}

.form-panel__hint {
  margin: 0 0 0.85rem;
  font-size: 0.8125rem;
  color: var(--text-muted);
}
</style>
