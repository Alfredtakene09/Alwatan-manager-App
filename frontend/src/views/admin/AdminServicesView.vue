<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import axios from 'axios'
import { Building2, Plus, Save, RefreshCw, Pencil, Trash2 } from '@lucide/vue'
import api from '@/api/client'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiFormModal from '@/components/ui/UiFormModal.vue'
import { confirmAppModal } from '@/lib/api-modal-helper'
import { useAuthStore } from '@/stores/auth'

type ClinicService = {
  id: string
  name: string
  active: boolean
  sortOrder: number
}

const auth = useAuthStore()
const apiBase = computed(() => (auth.user?.role === 'GESTIONNAIRE' ? '/gestionnaire' : '/admin'))

const rows = ref<ClinicService[]>([])
const loading = ref(false)
const saving = ref(false)
const modalOpen = ref(false)
const editingId = ref<string | null>(null)
const message = ref('')
const messageType = ref<'success' | 'error'>('success')

const form = ref({
  name: '',
  active: true,
  sortOrder: 0,
})

const sortedRows = computed(() =>
  [...rows.value].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'fr')),
)

function resetForm() {
  form.value = { name: '', active: true, sortOrder: 0 }
}

async function loadServices() {
  loading.value = true
  try {
    const { data } = await api.get<ClinicService[]>(`${apiBase.value}/services`)
    rows.value = Array.isArray(data) ? data : []
  } finally {
    loading.value = false
  }
}

function openCreateModal() {
  editingId.value = null
  resetForm()
  modalOpen.value = true
}

function openEditModal(row: ClinicService) {
  editingId.value = row.id
  form.value = {
    name: row.name,
    active: row.active,
    sortOrder: row.sortOrder,
  }
  modalOpen.value = true
}

function closeModal() {
  modalOpen.value = false
  editingId.value = null
  resetForm()
}

function apiErrorMessage(error: unknown, fallback: string) {
  if (axios.isAxiosError(error) && typeof error.response?.data?.error === 'string') {
    return error.response.data.error
  }
  return fallback
}

async function saveService() {
  const name = form.value.name.trim()
  if (name.length < 2) {
    message.value = 'Le nom du service doit contenir au moins 2 caractères.'
    messageType.value = 'error'
    return
  }

  saving.value = true
  message.value = ''
  try {
    if (editingId.value) {
      await api.put(`${apiBase.value}/services/${editingId.value}`, {
        name,
        active: form.value.active,
        sortOrder: Number(form.value.sortOrder) || 0,
      })
      message.value = 'Service mis à jour.'
    } else {
      await api.post(`${apiBase.value}/services`, {
        name,
        active: form.value.active,
        sortOrder: Number(form.value.sortOrder) || 0,
      })
      message.value = 'Service créé.'
    }
    messageType.value = 'success'
    closeModal()
    await loadServices()
  } catch (error: unknown) {
    message.value = apiErrorMessage(error, 'Impossible d’enregistrer ce service.')
    messageType.value = 'error'
  } finally {
    saving.value = false
  }
}

async function deleteService(row: ClinicService) {
  const confirmed = await confirmAppModal({
    type: 'DELETE',
    title: 'Supprimer le service',
    message: `Supprimer définitivement « ${row.name} » ?`,
    confirmLabel: 'Supprimer',
  })
  if (!confirmed) return

  try {
    await api.delete(`${apiBase.value}/services/${row.id}`)
    message.value = 'Service supprimé.'
    messageType.value = 'success'
    await loadServices()
  } catch (error: unknown) {
    message.value = apiErrorMessage(error, 'Suppression impossible.')
    messageType.value = 'error'
  }
}

onMounted(loadServices)
</script>

<template>
  <div>
    <UiPageHeader
      title="Services"
      subtitle="Créer et gérer la liste des services de la clinique"
      :icon="Building2"
    />

    <UiAlert v-if="message" :type="messageType" :message="message" />

    <UiCard title="Référentiel des services" :icon="Building2" icon-variant="violet">
      <template #actions>
        <UiButton variant="ghost" size="sm" :icon="RefreshCw" :disabled="loading" @click="loadServices">
          Actualiser
        </UiButton>
        <UiButton variant="primary" size="sm" :icon="Plus" @click="openCreateModal">
          Nouveau service
        </UiButton>
      </template>

      <p v-if="!loading && !sortedRows.length" class="empty">Aucun service configuré.</p>
      <div v-else class="services-list">
        <article v-for="row in sortedRows" :key="row.id" class="service-item">
          <div>
            <strong>{{ row.name }}</strong>
            <p>Ordre: {{ row.sortOrder }} · {{ row.active ? 'Actif' : 'Inactif' }}</p>
          </div>
          <div class="service-actions">
            <UiButton variant="ghost" size="sm" :icon="Pencil" @click="openEditModal(row)">Modifier</UiButton>
            <UiButton variant="danger" size="sm" :icon="Trash2" @click="deleteService(row)">Supprimer</UiButton>
          </div>
        </article>
      </div>
    </UiCard>

    <UiFormModal
      v-if="modalOpen"
      title-id="service-modal-title"
      :title="editingId ? 'Modifier le service' : 'Nouveau service'"
      :icon="Building2"
      @close="closeModal"
    >
      <UiAlert v-if="message && modalOpen" :type="messageType" :message="message" />
      <section class="form-panel">
        <UiInput v-model="form.name" label="Nom du service" required placeholder="Ex: Laboratoire" />
        <div class="form-grid-2">
          <UiInput v-model="form.sortOrder" label="Ordre d'affichage" type="number" min="0" />
          <UiSelect
            :model-value="form.active ? 'true' : 'false'"
            label="Statut"
            @update:model-value="form.active = $event === 'true'"
          >
            <option value="true">Actif</option>
            <option value="false">Inactif</option>
          </UiSelect>
        </div>
      </section>
      <template #footer>
        <UiButton variant="ghost" @click="closeModal">Annuler</UiButton>
        <UiButton variant="primary" :icon="Save" :disabled="saving" @click="saveService">
          {{ saving ? 'Enregistrement…' : 'Enregistrer' }}
        </UiButton>
      </template>
    </UiFormModal>
  </div>
</template>

<style scoped>
.empty {
  text-align: center;
  color: var(--text-light);
  padding: 1.5rem 1rem;
}

.services-list {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.service-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 0.7rem 0.8rem;
}

.service-item p {
  margin: 0.2rem 0 0;
  font-size: 0.8rem;
  color: var(--text-muted);
}

.service-actions {
  display: flex;
  gap: 0.4rem;
  flex-wrap: wrap;
}

.form-grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
}

@media (max-width: 720px) {
  .service-item {
    flex-direction: column;
    align-items: stretch;
  }

  .form-grid-2 {
    grid-template-columns: 1fr;
  }
}
</style>
