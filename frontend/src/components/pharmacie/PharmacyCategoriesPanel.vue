<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import axios from 'axios'
import { Tags, Plus, RefreshCw, Save } from '@lucide/vue'
import api from '@/api/client'
import { statusBadge, catalogRowActionsHtml } from '@/lib/datatable-defaults'
import PageTableSection from '@/components/ui/PageTableSection.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiFormModal from '@/components/ui/UiFormModal.vue'
import UiDataTable from '@/components/ui/UiDataTable.vue'

export type PharmacyCategoryRecord = {
  id: string
  name: string
  sortOrder: number
  active: boolean
  productsCount: number
}

const emit = defineEmits<{ changed: [] }>()

const items = ref<PharmacyCategoryRecord[]>([])
const loading = ref(false)
const saving = ref(false)
const message = ref('')
const messageType = ref<'success' | 'error'>('success')
const modalOpen = ref(false)
const editingId = ref<string | null>(null)
const formName = ref('')
const formSortOrder = ref('0')

const itemsById = computed(() => new Map(items.value.map((item) => [item.id, item])))
const isEditing = computed(() => editingId.value !== null)

const tableRows = computed(() =>
  items.value.map((item) => ({
    id: item.id,
    name: item.name,
    sortOrder: item.sortOrder,
    productsCount: item.productsCount,
    productsLabel: `${item.productsCount} produit(s)`,
    statusLabel: item.active ? 'Active' : 'Inactive',
    statusVariant: item.active ? 'success' : 'danger',
    toggleLabel: item.active ? 'Désactiver' : 'Activer',
    isActive: item.active,
    canDelete: true,
  })),
)

const columns = [
  {
    data: 'name',
    title: 'Catégorie',
    responsivePriority: 1,
    render: (name: string) => `<span class="dt-name">${name}</span>`,
  },
  { data: 'sortOrder', title: 'Ordre', responsivePriority: 3 },
  { data: 'productsLabel', title: 'Produits', responsivePriority: 2 },
  {
    data: 'statusLabel',
    title: 'Statut',
    responsivePriority: 3,
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

async function loadItems() {
  loading.value = true
  message.value = ''
  try {
    const { data } = await api.get<PharmacyCategoryRecord[]>('/pharmacie/categories')
    items.value = data
  } catch {
    message.value = 'Impossible de charger les catégories.'
    messageType.value = 'error'
    items.value = []
  } finally {
    loading.value = false
  }
}

function resetForm() {
  formName.value = ''
  formSortOrder.value = '0'
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
  formSortOrder.value = String(item.sortOrder)
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
  const sortOrder = Number(formSortOrder.value)
  if (name.length < 2) {
    message.value = 'Nom requis (2 caractères minimum).'
    messageType.value = 'error'
    return
  }

  saving.value = true
  message.value = ''
  const payload = { name, sortOrder: Number.isFinite(sortOrder) ? sortOrder : 0 }

  try {
    if (isEditing.value && editingId.value) {
      await api.put(`/pharmacie/categories/${editingId.value}`, payload)
      message.value = 'Catégorie modifiée.'
    } else {
      await api.post('/pharmacie/categories', payload)
      message.value = 'Catégorie ajoutée.'
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
    await api.put(`/pharmacie/categories/${id}`, { active: !item.active })
    message.value = item.active ? 'Catégorie désactivée.' : 'Catégorie réactivée.'
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
  if (!window.confirm(`Supprimer la catégorie « ${item.name} » ?`)) return
  try {
    const { data } = await api.delete<{ message?: string }>(`/pharmacie/categories/${id}`)
    message.value = data.message ?? 'Catégorie supprimée.'
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
        Nouvelle catégorie
      </UiButton>
    </template>

    <UiAlert v-if="message && !modalOpen" :type="messageType" :message="message" class="panel-alert" />

    <p v-if="!loading && !items.length" class="empty">Aucune catégorie — créez-en une pour classer vos produits.</p>
    <UiDataTable
      v-else
      fill
      table-key="pharmacy-categories"
      compact
      :data="tableRows"
      :columns="columns"
      :loading="loading"
      loading-label="Chargement des catégories…"
      @action="onTableAction"
    />
  </PageTableSection>

  <UiFormModal
    v-if="modalOpen"
    title-id="pharmacy-category-modal-title"
    :title="isEditing ? 'Modifier la catégorie' : 'Nouvelle catégorie'"
    subtitle="Nom affiché dans le catalogue et les rapports"
    :icon="Tags"
    @close="closeModal"
  >
    <UiAlert v-if="message && modalOpen" :type="messageType" :message="message" />
    <section class="form-panel">
      <UiInput v-model="formName" label="Nom" placeholder="Ex. Médicaments" required />
      <UiInput v-model="formSortOrder" label="Ordre d'affichage" type="number" min="0" />
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
</style>
