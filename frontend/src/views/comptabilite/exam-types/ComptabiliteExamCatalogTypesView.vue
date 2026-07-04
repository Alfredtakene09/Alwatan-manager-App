<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { Plus, RefreshCw, Save } from '@lucide/vue'
import api from '@/api/client'
import { confirmAppModal, showDuplicateModalFromError } from '@/lib/api-modal-helper'
import { formatFcfa } from '@/lib/roles'
import { statusBadge, catalogRowActionsHtml } from '@/lib/datatable-defaults'
import {
  EXAM_CATALOG_KIND_CONFIG,
  EXAM_CATALOG_ADD_LABELS,
  EXAM_CATALOG_FORM_PLACEHOLDERS,
  type ExamCatalogKindSlug,
} from '@/lib/exam-catalog-kinds'
import ExamCatalogKindTabs from '@/components/comptabilite/ExamCatalogKindTabs.vue'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiFormModal from '@/components/ui/UiFormModal.vue'
import UiDataTable from '@/components/ui/UiDataTable.vue'

type CatalogItem = {
  id: string
  code: string
  label: string
  category?: string | null
  priceFcfa: number
  active: boolean
  sortOrder: number
}

const props = defineProps<{
  kind: ExamCatalogKindSlug
}>()

const config = computed(() => EXAM_CATALOG_KIND_CONFIG[props.kind])
const addButtonLabel = computed(() => EXAM_CATALOG_ADD_LABELS[props.kind])
const formPlaceholders = computed(() => EXAM_CATALOG_FORM_PLACEHOLDERS[props.kind])
const items = ref<CatalogItem[]>([])
const loading = ref(false)
const saving = ref(false)
const message = ref('')
const messageType = ref<'success' | 'error'>('success')
const editingId = ref<string | null>(null)
const showAddModal = ref(false)

const newItem = ref({
  code: '',
  label: '',
  category: '',
  priceFcfa: '',
})

const editForm = ref({
  code: '',
  label: '',
  category: '',
  priceFcfa: '',
})

const itemsById = computed(() => new Map(items.value.map((item) => [item.id, item])))

const tableRows = computed(() =>
  items.value.map((item) => ({
    id: item.id,
    label: item.label,
    code: item.code,
    category: item.category || '—',
    price: formatFcfa(item.priceFcfa),
    priceSort: item.priceFcfa,
    statusLabel: item.active ? 'Actif' : 'Inactif',
    statusVariant: item.active ? 'success' : 'danger',
    toggleLabel: item.active ? 'Désactiver' : 'Activer',
    isActive: item.active,
  })),
)

const columns = [
  { data: 'label', title: 'Libellé', render: (v: string) => `<span class="dt-name">${v}</span>` },
  { data: 'code', title: 'Code' },
  { data: 'category', title: 'Catégorie' },
  {
    data: 'priceSort',
    title: 'Tarif',
    render: (_d: number, _t: string, row: { price: string }) => `<span class="dt-amount">${row.price}</span>`,
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

async function loadItems() {
  loading.value = true
  resetMessages()
  try {
    const { data } = await api.get<CatalogItem[]>(`/comptabilite/exam-types/catalog/${props.kind}`)
    items.value = data
  } catch {
    message.value = 'Impossible de charger la nomenclature.'
    messageType.value = 'error'
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
  if (!newItem.value.code.trim() || !newItem.value.label.trim() || !newItem.value.priceFcfa) {
    message.value = 'Code, libellé et tarif sont obligatoires.'
    messageType.value = 'error'
    return
  }

  saving.value = true
  resetMessages()
  try {
    await api.post(`/comptabilite/exam-types/catalog/${props.kind}`, {
      code: newItem.value.code.trim(),
      label: newItem.value.label.trim(),
      category: newItem.value.category.trim() || undefined,
      priceFcfa: Number(newItem.value.priceFcfa),
    })
    message.value = 'Élément ajouté à la nomenclature.'
    messageType.value = 'success'
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
  saving.value = true
  resetMessages()
  try {
    await api.put(`/comptabilite/exam-types/catalog/${props.kind}/${editingId.value}`, {
      code: editForm.value.code.trim(),
      label: editForm.value.label.trim(),
      category: editForm.value.category.trim() || undefined,
      priceFcfa: Number(editForm.value.priceFcfa),
    })
    message.value = 'Élément mis à jour.'
    messageType.value = 'success'
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
    await api.put(`/comptabilite/exam-types/catalog/${props.kind}/${id}`, { active: !item.active })
    message.value = item.active ? 'Élément désactivé.' : 'Élément réactivé.'
    messageType.value = 'success'
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
    title: 'Supprimer l\'élément',
    message: `Supprimer définitivement « ${item.label} » ? Cette action est irréversible.`,
    confirmLabel: 'Supprimer',
  })
  if (!confirmed) return

  resetMessages()
  try {
    await api.delete(`/comptabilite/exam-types/catalog/${props.kind}/${id}`)
    message.value = 'Élément supprimé.'
    messageType.value = 'success'
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

watch(
  () => props.kind,
  () => {
    closeEditModal()
    closeAddModal()
    loadItems()
  },
)

onMounted(loadItems)
</script>

<template>
  <div>
    <UiPageHeader :title="config.title" :subtitle="config.subtitle" :icon="config.icon" />

    <ExamCatalogKindTabs :active-kind="kind" />

    <UiAlert v-if="message" :type="messageType" :message="message" />

    <UiCard
      :title="`Nomenclature — ${config.label}`"
      description="Tarifs utilisés pour la facturation des examens"
      :icon="config.icon"
      :icon-variant="config.iconVariant"
      class="section"
    >
      <template #actions>
        <UiButton variant="primary" size="sm" :icon="Plus" @click="openAddModal">
          {{ addButtonLabel }}
        </UiButton>
        <UiButton variant="ghost" size="sm" :icon="RefreshCw" :disabled="loading" @click="loadItems">
          Actualiser
        </UiButton>
        <span class="list-count">{{ items.length }} élément(s)</span>
      </template>

      <div class="table-panel-scroll">
        <UiDataTable
          :table-key="`exam-catalog-${kind}`"
          compact
          :data="tableRows"
          :columns="columns"
          :loading="loading"
          loading-label="Chargement de la nomenclature…"
          @action="onTableAction"
        />
      </div>
    </UiCard>

    <UiFormModal
      v-if="showAddModal"
      title-id="add-catalog-title"
      :title="addButtonLabel"
      :subtitle="`Ajouter un élément à la nomenclature ${config.label.toLowerCase()}`"
      :icon="config.icon"
      @close="closeAddModal"
    >
      <section class="form-panel">
        <div class="form-grid-2">
          <UiInput v-model="newItem.code" label="Code" :placeholder="formPlaceholders.code" />
          <UiInput v-model="newItem.label" label="Libellé" :placeholder="formPlaceholders.label" />
          <UiInput v-model="newItem.category" label="Catégorie" :placeholder="formPlaceholders.category" />
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
      title-id="edit-catalog-title"
      title="Modifier l'élément"
      subtitle="Mettre à jour le libellé, la catégorie ou le tarif"
      :icon="config.icon"
      @close="closeEditModal"
    >
      <section class="form-panel">
        <div class="form-grid-2">
          <UiInput v-model="editForm.code" label="Code" />
          <UiInput v-model="editForm.label" label="Libellé" />
          <UiInput v-model="editForm.category" label="Catégorie" />
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
</style>
