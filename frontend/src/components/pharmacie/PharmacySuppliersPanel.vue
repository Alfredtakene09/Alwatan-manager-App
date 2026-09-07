<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import axios from 'axios'
import { Building2, Plus, RefreshCw, Save } from '@lucide/vue'
import api from '@/api/client'
import { canWritePharmacyCatalog } from '@/lib/roles'
import PageTableSection from '@/components/ui/PageTableSection.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiTextarea from '@/components/ui/UiTextarea.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiFormModal from '@/components/ui/UiFormModal.vue'
import StCatalogActions from '@/components/ui/StCatalogActions.vue'
import { confirmAppModal } from '@/lib/api-modal-helper'
import { useAuthStore } from '@/stores/auth'
import { useAppI18n } from '@/i18n/useAppI18n'
import { translateTemplate } from '@/lib/dashboard-i18n'

export type PharmacySupplierRecord = {
  id: string
  name: string
  contactName: string | null
  phone: string | null
  email: string | null
  address: string | null
  active: boolean
}

const emit = defineEmits<{ changed: [] }>()

const { uiText, localeCode } = useAppI18n()
const auth = useAuthStore()
const canManageCatalog = computed(() => canWritePharmacyCatalog(auth.user))

const items = ref<PharmacySupplierRecord[]>([])
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

const tableRows = computed(() => {
  void localeCode.value
  return items.value.map((item) => ({
    id: item.id,
    name: item.name,
    contact: item.contactName?.trim() || '—',
    phone: item.phone?.trim() || '—',
    email: item.email?.trim() || '—',
    statusLabel: item.active ? uiText('Actif') : uiText('Inactif'),
    statusVariant: item.active ? 'success' : 'danger',
    toggleLabel: item.active ? uiText('Désactiver') : uiText('Activer'),
    isActive: item.active,
    canDelete: canManageCatalog.value,
    showEdit: canManageCatalog.value,
    showToggle: canManageCatalog.value,
  }))
})

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
    const { data } = await api.get<PharmacySupplierRecord[]>('/pharmacie/suppliers')
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
  if (!canManageCatalog.value) return
  editingId.value = null
  resetForm()
  modalOpen.value = true
  message.value = ''
}

function openEditModal(id: string) {
  if (!canManageCatalog.value) return
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
  if (!canManageCatalog.value) return
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
      await api.put(`/pharmacie/suppliers/${editingId.value}`, payload)
      message.value = 'Fournisseur modifié.'
    } else {
      await api.post('/pharmacie/suppliers', payload)
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
  if (!canManageCatalog.value) return
  const item = itemsById.value.get(id)
  if (!item) return
  try {
    await api.put(`/pharmacie/suppliers/${id}`, { active: !item.active })
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
  if (!canManageCatalog.value) return
  const item = itemsById.value.get(id)
  if (!item) return
  const confirmed = await confirmAppModal({
    type: 'DELETE',
    title: 'Supprimer le fournisseur',
    message: translateTemplate('Supprimer le fournisseur « {name} » ?', { name: item.name }),
    confirmLabel: 'Supprimer',
  })
  if (!confirmed) return
  try {
    const { data } = await api.delete<{ message?: string }>(`/pharmacie/suppliers/${id}`)
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
        {{ uiText('Actualiser') }}
      </UiButton>
      <UiButton
        v-if="canManageCatalog"
        variant="primary"
        size="sm"
        :icon="Plus"
        @click="openCreateModal"
      >
        {{ uiText('Nouveau fournisseur') }}
      </UiButton>
    </template>

    <UiAlert v-if="message && !modalOpen" :type="messageType" :message="message" class="panel-alert" />

    <p v-if="!loading && !items.length" class="empty">{{ uiText('Aucun fournisseur enregistré') }}</p>
    <div v-else class="simple-table-shell" :class="{ 'simple-table-shell--fill': true }">
      <div v-if="loading" class="simple-table-overlay" role="status" aria-live="polite">
        <span class="simple-table-spinner" aria-hidden="true" />
        Chargement des fournisseurs…
      </div>
      <div class="simple-table-scroll">
        <div class="simple-table-wrap">
          <table class="simple-table">
            <thead>
              <tr>
                <th class="simple-table__num">#</th>
                <th>Fournisseur</th>
                <th>Contact</th>
                <th>Téléphone</th>
                <th>E-mail</th>
                <th>Statut</th>
                <th v-if="canManageCatalog" class="simple-table__actions-head">Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, index) in tableRows" :key="row.id">
                <td class="simple-table__num">{{ index + 1 }}</td>
                <td><span class="st-name">{{ row.name }}</span></td>
                <td>{{ row.contact }}</td>
                <td>{{ row.phone }}</td>
                <td>{{ row.email }}</td>
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
    title-id="pharmacy-supplier-modal-title"
    :title="isEditing ? 'Modifier le fournisseur' : 'Nouveau fournisseur'"
    subtitle="Coordonnées du partenaire d'approvisionnement"
    :icon="Building2"
    @close="closeModal"
  >
    <UiAlert v-if="message && modalOpen" :type="messageType" :message="message" />
    <section class="form-panel">
      <UiInput v-model="formName" label="Raison sociale" placeholder="Ex. Pharma Distribution N'Djamena" required />
      <UiInput v-model="formContactName" label="Personne contact" placeholder="Nom du responsable" />
      <div class="form-grid">
        <UiInput v-model="formPhone" label="Téléphone" placeholder="+235 …" />
        <UiInput v-model="formEmail" label="E-mail" type="email" placeholder="contact@…" />
      </div>
      <UiTextarea v-model="formAddress" :label="uiText('Adresse')" :rows="2" :placeholder="uiText('Adresse complète…')" />
    </section>
    <template #footer>
      <UiButton variant="ghost" @click="closeModal">{{ uiText('Annuler') }}</UiButton>
      <UiButton variant="primary" :icon="Save" :disabled="saving" @click="saveItem">
        {{ saving ? uiText('Enregistrement…') : uiText('Enregistrer') }}
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
