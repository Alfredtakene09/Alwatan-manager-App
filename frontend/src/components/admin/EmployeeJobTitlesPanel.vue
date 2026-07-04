<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import axios from 'axios'
import { Briefcase, Plus, RefreshCw, Save } from '@lucide/vue'
import api from '@/api/client'
import {
  EMPLOYEE_JOB_TITLES,
  fetchEmployeeJobTitles,
  invalidateEmployeeJobTitleCache,
  syncEmployeeJobTitles,
  type EmployeeJobTitleRecord,
} from '@/lib/employee-job-titles'
import { catalogRowActionsHtml, statusBadge } from '@/lib/datatable-defaults'
import { confirmAppModal } from '@/lib/api-modal-helper'
import UiCard from '@/components/ui/UiCard.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiFormModal from '@/components/ui/UiFormModal.vue'
import UiDataTable from '@/components/ui/UiDataTable.vue'

const props = withDefaults(
  defineProps<{
    apiBase?: string
    tableKey?: string
  }>(),
  {
    apiBase: '/admin',
    tableKey: 'admin-job-titles',
  },
)

const emit = defineEmits<{
  changed: []
}>()

const items = ref<EmployeeJobTitleRecord[]>([])
const loading = ref(false)
const saving = ref(false)
const message = ref('')
const messageType = ref<'success' | 'error'>('success')
const modalOpen = ref(false)
const editingId = ref<string | null>(null)
const formLabel = ref('')

const itemsById = computed(() => new Map(items.value.map((item) => [item.id, item])))
const isEditing = computed(() => editingId.value !== null)

const jobTitleModalSubtitle = computed(() => {
  if (isEditing.value && editingId.value) {
    const count = itemsById.value.get(editingId.value)?.employeeCount ?? 0
    if (count > 0) {
      return `${count} employé(s) lié(s) — le libellé sera mis à jour sur leurs fiches.`
    }
  }
  return 'Ex. Infirmière, Comptable, Médecin généraliste…'
})

const tableRows = computed(() =>
  items.value.map((item) => ({
    id: item.id,
    label: item.label,
    sortOrder: item.sortOrder,
    employeeCount: item.employeeCount ?? 0,
    employeesLabel:
      (item.employeeCount ?? 0) === 0
        ? 'Aucun'
        : `${item.employeeCount} employé${(item.employeeCount ?? 0) > 1 ? 's' : ''}`,
    statusLabel: item.active ? 'Actif' : 'Inactif',
    statusVariant: item.active ? 'success' : 'danger',
    toggleLabel: item.active ? 'Désactiver' : 'Activer',
    isActive: item.active,
    canDelete: (item.employeeCount ?? 0) === 0 && !item.id.startsWith('fallback-'),
  })),
)

const columns = [
  {
    data: 'label',
    title: 'Poste / fonction',
    responsivePriority: 1,
    render: (label: string) => `<span class="dt-name">${label}</span>`,
  },
  { data: 'sortOrder', title: 'Ordre', responsivePriority: 4 },
  {
    data: 'employeesLabel',
    title: 'Employés liés',
    responsivePriority: 2,
    render: (label: string, _t: string, row: { employeeCount: number }) =>
      row.employeeCount > 0 ? statusBadge(label, 'info') : `<span class="dt-muted">${label}</span>`,
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
    items.value = await fetchEmployeeJobTitles(false, props.apiBase)
    if (items.value.length === 0) {
      items.value = await syncEmployeeJobTitles(props.apiBase)
      message.value = `${items.value.length} poste(s) importé(s) depuis la liste du formulaire employé.`
      messageType.value = 'success'
      invalidateEmployeeJobTitleCache()
      emit('changed')
    }
  } catch {
    items.value = EMPLOYEE_JOB_TITLES.map((label, index) => ({
      id: `fallback-${index}`,
      label,
      active: true,
      sortOrder: index,
      employeeCount: 0,
    }))
    message.value =
      'Catalogue API indisponible — affichage de la liste du combobox. Réessayez après reconnexion.'
    messageType.value = 'error'
  } finally {
    loading.value = false
  }
}

function resetForm() {
  formLabel.value = ''
}

function openCreateModal() {
  editingId.value = null
  resetForm()
  modalOpen.value = true
  message.value = ''
}

function openEditModal(id: string) {
  const item = itemsById.value.get(id)
  if (!item || item.id.startsWith('fallback-')) return
  editingId.value = id
  formLabel.value = item.label
  modalOpen.value = true
  message.value = ''
}

function closeModal() {
  modalOpen.value = false
  editingId.value = null
  resetForm()
}

async function saveItem() {
  const label = formLabel.value.trim()
  if (label.length < 2) {
    message.value = 'Le libellé doit contenir au moins 2 caractères.'
    messageType.value = 'error'
    return
  }

  saving.value = true
  message.value = ''
  try {
    if (isEditing.value && editingId.value) {
      const item = itemsById.value.get(editingId.value)
      await api.put(`${props.apiBase}/job-titles/${editingId.value}`, {
        label,
        sortOrder: item?.sortOrder,
      })
      const linked = item?.employeeCount ?? 0
      message.value =
        linked > 0
          ? `Poste modifié. ${linked} fiche${linked > 1 ? 's' : ''} employé${linked > 1 ? 's' : ''} mise${linked > 1 ? 's' : ''} à jour.`
          : 'Poste modifié.'
    } else {
      const nextSortOrder =
        items.value.reduce((max, item) => Math.max(max, item.sortOrder), -1) + 1
      await api.post(`${props.apiBase}/job-titles`, { label, sortOrder: nextSortOrder })
      message.value = 'Poste ajouté.'
    }
    messageType.value = 'success'
    invalidateEmployeeJobTitleCache()
    emit('changed')
    closeModal()
    await loadItems()
  } catch (error) {
    message.value = apiErrorMessage(
      error,
      isEditing.value
        ? 'Modification impossible — libellé invalide ou déjà utilisé.'
        : 'Ajout impossible — ce poste existe peut-être déjà.',
    )
    messageType.value = 'error'
  } finally {
    saving.value = false
  }
}

async function toggleItem(id: string) {
  const item = itemsById.value.get(id)
  if (!item || item.id.startsWith('fallback-')) return
  try {
    await api.put(`${props.apiBase}/job-titles/${id}`, { active: !item.active })
    message.value = item.active ? 'Poste désactivé.' : 'Poste réactivé.'
    messageType.value = 'success'
    invalidateEmployeeJobTitleCache()
    emit('changed')
    await loadItems()
  } catch {
    message.value = 'Action impossible.'
    messageType.value = 'error'
  }
}

async function deleteItem(id: string) {
  const item = itemsById.value.get(id)
  if (!item || item.id.startsWith('fallback-')) return

  const linked = item.employeeCount ?? 0
  if (linked > 0) {
    message.value = `Suppression impossible : ${linked} employé${linked > 1 ? 's utilisent' : ' utilise'} le poste « ${item.label} ». Modifiez d'abord leur fiche employé.`
    messageType.value = 'error'
    return
  }

  const confirmed = await confirmAppModal({
    type: 'DELETE',
    title: 'Supprimer le poste',
    message: `Supprimer définitivement le poste « ${item.label} » ? Cette action est irréversible. Le poste disparaîtra du formulaire d'ajout d'employé.`,
    confirmLabel: 'Supprimer',
  })
  if (!confirmed) return

  try {
    const { data } = await api.delete<{ ok: boolean; message?: string }>(`${props.apiBase}/job-titles/${id}`)
    message.value = data.message ?? 'Poste supprimé.'
    messageType.value = 'success'
    invalidateEmployeeJobTitleCache()
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
    title="Postes"
    class="ui-card--table-panel"
    :icon="Briefcase"
    icon-variant="teal"
  >
    <template #actions>
      <UiButton variant="ghost" size="sm" :icon="RefreshCw" :disabled="loading || saving" @click="loadItems">
        Actualiser
      </UiButton>
      <UiButton variant="primary" size="sm" :icon="Plus" @click="openCreateModal">
        Ajouter
      </UiButton>
    </template>

    <UiAlert v-if="message && !modalOpen" :type="messageType" :message="message" class="panel-alert" />

    <p v-if="!loading && !items.length" class="empty">Aucun poste enregistré</p>
    <UiDataTable
      v-else
      fill
      :table-key="tableKey"
      compact
      :data="tableRows"
      :columns="columns"
      :loading="loading"
      loading-label="Chargement…"
      @action="onTableAction"
    />
  </UiCard>

  <UiFormModal
    v-if="modalOpen"
    title-id="job-title-modal-title"
    :title="isEditing ? 'Modifier le poste / fonction' : 'Nouveau poste / fonction'"
    :subtitle="jobTitleModalSubtitle"
    :icon="Briefcase"
    @close="closeModal"
  >
    <UiAlert v-if="message && modalOpen" :type="messageType" :message="message" />
    <section class="form-panel">
      <UiInput v-model="formLabel" label="Libellé du poste" placeholder="Ex. Secrétaire médicale" required />
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
  margin-bottom: 0.4rem;
  flex-shrink: 0;
}

.empty {
  text-align: center;
  color: var(--text-light);
  padding: 1.25rem 0.75rem;
  font-size: 0.8125rem;
}
</style>
