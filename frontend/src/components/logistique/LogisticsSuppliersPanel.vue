<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import axios from 'axios'
import { Building2, Plus, RefreshCw, Save } from '@lucide/vue'
import api from '@/api/client'
import { statusBadge, catalogRowActionsHtml } from '@/lib/datatable-defaults'
import PageTableSection from '@/components/ui/PageTableSection.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiTextarea from '@/components/ui/UiTextarea.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiFormModal from '@/components/ui/UiFormModal.vue'
import UiDataTable from '@/components/ui/UiDataTable.vue'

export type LogisticsSupplierRecord = {
  id: string
  name: string
  contactName: string | null
  phone: string | null
  email: string | null
  address: string | null
  active: boolean
}

const emit = defineEmits<{ changed: [] }>()

const items = ref<LogisticsSupplierRecord[]>([])
const loading = ref(false)
const saving = ref(false)
const message = ref('')
const messageType = ref<'success' | 'error'>('success')
const modalOpen = ref(false)
const editingId = ref<string | null>(null)
const formName = ref('')
const formContactName = ref('')
const formPhone = ref('')
const formEmail = ref('')
const formAddress = ref('')

const itemsById = computed(() => new Map(items.value.map((item) => [item.id, item])))
const isEditing = computed(() => editingId.value !== null)

const tableRows = computed(() =>
  items.value.map((item) => ({
    id: item.id,
    name: item.name,
    contact: item.contactName?.trim() || '—',
    phone: item.phone?.trim() || '—',
    email: item.email?.trim() || '—',
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
    title: 'Fournisseur',
    responsivePriority: 1,
    render: (name: string) => `<span class="dt-name">${name}</span>`,
  },
  { data: 'contact', title: 'Contact', responsivePriority: 2 },
  { data: 'phone', title: 'Téléphone', responsivePriority: 3 },
  { data: 'email', title: 'E-mail', responsivePriority: 4 },
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
    const { data } = await api.get<LogisticsSupplierRecord[]>('/logistique/suppliers')
    items.value = data
  } catch {
    message.value = 'Impossible de charger les fournisseurs.'
    messageType.value = 'error'
    items.value = []
  } finally {
    loading.value = false
  }
}

function resetForm() {
  formName.value = ''
  formContactName.value = ''
  formPhone.value = ''
  formEmail.value = ''
  formAddress.value = ''
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
  formContactName.value = item.contactName ?? ''
  formPhone.value = item.phone ?? ''
  formEmail.value = item.email ?? ''
  formAddress.value = item.address ?? ''
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

  saving.value = true
  message.value = ''
  const payload = {
    name,
    contactName: formContactName.value.trim() || undefined,
    phone: formPhone.value.trim() || undefined,
    email: formEmail.value.trim() || undefined,
    address: formAddress.value.trim() || undefined,
  }

  try {
    if (isEditing.value && editingId.value) {
      await api.put(`/logistique/suppliers/${editingId.value}`, payload)
      message.value = 'Fournisseur modifié.'
    } else {
      await api.post('/logistique/suppliers', payload)
      message.value = 'Fournisseur ajouté.'
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
    await api.put(`/logistique/suppliers/${id}`, { active: !item.active })
    message.value = item.active ? 'Fournisseur désactivé.' : 'Fournisseur réactivé.'
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
  if (!window.confirm(`Supprimer le fournisseur « ${item.name} » ?`)) return
  try {
    const { data } = await api.delete<{ message?: string }>(`/logistique/suppliers/${id}`)
    message.value = data.message ?? 'Fournisseur supprimé.'
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
        Nouveau fournisseur
      </UiButton>
    </template>

    <UiAlert v-if="message && !modalOpen" :type="messageType" :message="message" class="panel-alert" />

    <p v-if="!loading && !items.length" class="empty">Aucun fournisseur enregistré</p>
    <UiDataTable
      v-else
      fill
      table-key="logistics-suppliers"
      compact
      :data="tableRows"
      :columns="columns"
      :loading="loading"
      loading-label="Chargement des fournisseurs…"
      @action="onTableAction"
    />
  </PageTableSection>

  <UiFormModal
    v-if="modalOpen"
    title-id="logistics-supplier-modal-title"
    :title="isEditing ? 'Modifier le fournisseur' : 'Nouveau fournisseur'"
    subtitle="Coordonnées du partenaire d'approvisionnement"
    :icon="Building2"
    @close="closeModal"
  >
    <UiAlert v-if="message && modalOpen" :type="messageType" :message="message" />
    <section class="form-panel">
      <UiInput v-model="formName" label="Raison sociale" placeholder="Ex. Fournitures Générales" required />
      <UiInput v-model="formContactName" label="Personne contact" placeholder="Nom du responsable" />
      <div class="form-grid">
        <UiInput v-model="formPhone" label="Téléphone" placeholder="+235 …" />
        <UiInput v-model="formEmail" label="E-mail" type="email" placeholder="contact@…" />
      </div>
      <UiTextarea v-model="formAddress" label="Adresse" :rows="2" placeholder="Adresse complète…" />
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

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
}

@media (max-width: 640px) {
  .form-grid {
    grid-template-columns: 1fr;
  }
}
</style>
