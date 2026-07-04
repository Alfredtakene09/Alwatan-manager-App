<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import axios from 'axios'
import { ListOrdered, Plus, RefreshCw, Save } from '@lucide/vue'
import api from '@/api/client'
import { statusBadge, catalogRowActionsHtml } from '@/lib/datatable-defaults'
import { confirmAppModal } from '@/lib/api-modal-helper'
import UiCard from '@/components/ui/UiCard.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiTextarea from '@/components/ui/UiTextarea.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiFormModal from '@/components/ui/UiFormModal.vue'
import UiDataTable from '@/components/ui/UiDataTable.vue'

export type ExpenseIndiceRecord = {
  id: string
  name: string
  description: string | null
  active: boolean
  sortOrder: number
}

const emit = defineEmits<{
  changed: []
}>()

const items = ref<ExpenseIndiceRecord[]>([])
const loading = ref(false)
const saving = ref(false)
const message = ref('')
const messageType = ref<'success' | 'error'>('success')
const modalOpen = ref(false)
const editingId = ref<string | null>(null)
const formName = ref('')
const formDescription = ref('')

const itemsById = computed(() => new Map(items.value.map((item) => [item.id, item])))
const isEditing = computed(() => editingId.value !== null)

const indiceModalSubtitle = computed(() =>
  isEditing.value
    ? 'Modifiez le nom ou la description proposés dans le formulaire de dépense.'
    : 'Ex. Entretien, Transport, Maintenance…',
)

const tableRows = computed(() =>
  items.value.map((item) => ({
    id: item.id,
    name: item.name,
    description: item.description?.trim() || '—',
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
    title: 'Nom',
    responsivePriority: 1,
    render: (name: string) => `<span class="dt-name">${name}</span>`,
  },
  {
    data: 'description',
    title: 'Description',
    responsivePriority: 2,
    render: (description: string) =>
      description === '—'
        ? `<span class="dt-muted">${description}</span>`
        : `<span>${description}</span>`,
  },
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
  return fallback
}

async function loadItems() {
  loading.value = true
  message.value = ''
  try {
    const { data } = await api.get<ExpenseIndiceRecord[]>('/cash-desk/expense-indices')
    items.value = data
  } catch {
    message.value = 'Impossible de charger les indices.'
    messageType.value = 'error'
    items.value = []
  } finally {
    loading.value = false
  }
}

function resetForm() {
  formName.value = ''
  formDescription.value = ''
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
  formDescription.value = item.description ?? ''
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
    message.value = 'Le nom doit contenir au moins 2 caractères.'
    messageType.value = 'error'
    return
  }

  const description = formDescription.value.trim()

  saving.value = true
  message.value = ''
  try {
    if (isEditing.value && editingId.value) {
      await api.put(`/cash-desk/expense-indices/${editingId.value}`, {
        name,
        description: description || undefined,
      })
      message.value = 'Indice modifié.'
    } else {
      await api.post('/cash-desk/expense-indices', {
        name,
        description: description || undefined,
      })
      message.value = 'Indice ajouté.'
    }
    messageType.value = 'success'
    emit('changed')
    closeModal()
    await loadItems()
  } catch (error) {
    message.value = apiErrorMessage(
      error,
      isEditing.value
        ? 'Modification impossible — nom invalide ou déjà utilisé.'
        : 'Ajout impossible — cet indice existe peut-être déjà.',
    )
    messageType.value = 'error'
  } finally {
    saving.value = false
  }
}

async function toggleItem(id: string) {
  const item = itemsById.value.get(id)
  if (!item) return
  try {
    await api.put(`/cash-desk/expense-indices/${id}`, { active: !item.active })
    message.value = item.active ? 'Indice désactivé.' : 'Indice réactivé.'
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
    title: 'Supprimer l\'indice',
    message: `Supprimer définitivement l'indice « ${item.name} » ? Cette action est irréversible.`,
    confirmLabel: 'Supprimer',
  })
  if (!confirmed) return

  try {
    const { data } = await api.delete<{ message?: string }>(`/cash-desk/expense-indices/${id}`)
    message.value = data.message ?? 'Indice supprimé.'
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
</script>

<template>
  <UiCard
    title="Indices de dépense"
    description="Motifs prédéfinis proposés dans le formulaire de saisie des dépenses"
    class="ui-card--table-panel"
    :icon="ListOrdered"
    icon-variant="teal"
  >
    <template #actions>
      <UiButton variant="ghost" size="sm" :icon="RefreshCw" :disabled="loading || saving" @click="loadItems">
        Actualiser
      </UiButton>
      <UiButton variant="primary" size="sm" :icon="Plus" @click="openCreateModal">
        Nouvel indice
      </UiButton>
    </template>

    <UiAlert v-if="message && !modalOpen" :type="messageType" :message="message" class="panel-alert" />

    <p v-if="!loading && !items.length" class="empty">Aucun indice enregistré</p>
    <UiDataTable
      v-else
      fill
      table-key="expense-indices"
      compact
      :data="tableRows"
      :columns="columns"
      :loading="loading"
      loading-label="Chargement des indices…"
      @action="onTableAction"
    />
  </UiCard>

  <UiFormModal
    v-if="modalOpen"
    title-id="expense-indice-modal-title"
    :title="isEditing ? 'Modifier l\'indice' : 'Nouvel indice de dépense'"
    :subtitle="indiceModalSubtitle"
    :icon="ListOrdered"
    @close="closeModal"
  >
    <UiAlert v-if="message && modalOpen" :type="messageType" :message="message" />
    <section class="form-panel">
      <UiInput v-model="formName" label="Nom" placeholder="Ex. Entretien" required />
      <UiTextarea
        v-model="formDescription"
        label="Description"
        placeholder="Détail du motif de dépense…"
        rows="3"
      />
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
