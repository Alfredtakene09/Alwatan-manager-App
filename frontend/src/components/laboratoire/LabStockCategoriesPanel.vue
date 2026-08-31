<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import axios from 'axios'
import { Tags, Plus, RefreshCw, Save } from '@lucide/vue'
import api from '@/api/client'
import PageTableSection from '@/components/ui/PageTableSection.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiFormModal from '@/components/ui/UiFormModal.vue'
import StCatalogActions from '@/components/ui/StCatalogActions.vue'
import { confirmAppModal } from '@/lib/api-modal-helper'
import { useAppI18n } from '@/i18n/useAppI18n'
import { translateTemplate } from '@/lib/dashboard-i18n'

export type LabStockCategoryRecord = {
  id: string
  name: string
  sortOrder: number
  active: boolean
  itemsCount: number
}

const emit = defineEmits<{ changed: [] }>()

const { uiText, localeCode } = useAppI18n()

const items = ref<LabStockCategoryRecord[]>([])
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

const tableRows = computed(() => {
  void localeCode.value
  return items.value.map((item) => ({
    id: item.id,
    name: uiText(item.name),
    sortOrder: item.sortOrder,
    itemsLabel: translateTemplate('{n} article(s)', { n: item.itemsCount }),
    statusLabel: item.active ? uiText('Active') : uiText('Inactive'),
    statusVariant: item.active ? 'success' : 'danger',
    toggleLabel: item.active ? uiText('Désactiver') : uiText('Activer'),
    isActive: item.active,
    canDelete: true,
  }))
})

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
    const { data } = await api.get<LabStockCategoryRecord[]>('/lab-stock/categories')
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
      await api.put(`/lab-stock/categories/${editingId.value}`, payload)
      message.value = 'Catégorie modifiée.'
    } else {
      await api.post('/lab-stock/categories', payload)
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
    await api.put(`/lab-stock/categories/${id}`, { active: !item.active })
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
  const confirmed = await confirmAppModal({
    type: 'DELETE',
    title: 'Supprimer la catégorie',
    message: translateTemplate('Supprimer la catégorie « {name} » ?', { name: item.name }),
    confirmLabel: 'Supprimer',
  })
  if (!confirmed) return
  try {
    const { data } = await api.delete<{ message?: string }>(`/lab-stock/categories/${id}`)
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
      <UiButton variant="primary" size="sm" :icon="Plus" ui-action="table.create" @click="openCreateModal">
        Nouvelle catégorie
      </UiButton>
    </template>

    <UiAlert v-if="message && !modalOpen" :type="messageType" :message="message" class="panel-alert" />

    <p v-if="!loading && !items.length" class="empty">
      {{ uiText('Aucune catégorie — créez-en une pour classer vos articles.') }}
    </p>
    <div v-else class="simple-table-shell" :class="{ 'simple-table-shell--fill': true }">
      <div v-if="loading" class="simple-table-overlay" role="status" aria-live="polite">
        <span class="simple-table-spinner" aria-hidden="true" />
        Chargement des catégories…
      </div>
      <div class="simple-table-scroll">
        <div class="simple-table-wrap">
          <table class="simple-table">
            <thead>
              <tr>
                <th class="simple-table__num">#</th>
                <th>Catégorie</th>
                <th>Art.</th>
                <th>État</th>
                <th class="simple-table__actions-head">Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, index) in tableRows" :key="row.id">
                <td class="simple-table__num">{{ index + 1 }}</td>
                <td><span class="st-name">{{ row.name }}</span></td>
                <td>{{ row.itemsLabel }}</td>
                <td>
                  <span class="st-badge" :class="`st-badge--${row.statusVariant}`">{{ row.statusLabel }}</span>
                </td>
                <td class="simple-table__actions">
                  <StCatalogActions
                    :id="row.id"
                    :toggle-label="row.toggleLabel"
                    :is-active="row.isActive"
                    :can-delete="row.canDelete"
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
    title-id="lab-stock-category-modal-title"
    :title="isEditing ? 'Modifier la catégorie' : 'Nouvelle catégorie'"
    subtitle="Nom affiché dans le catalogue laboratoire"
    :icon="Tags"
    @close="closeModal"
  >
    <UiAlert v-if="message && modalOpen" :type="messageType" :message="message" />
    <div class="form-grid">
      <UiInput v-model="formName" label="Nom" placeholder="Ex. Réactifs biochimie" required />
      <UiInput v-model="formSortOrder" label="Ordre" type="number" min="0" />
    </div>
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
  margin: 1.5rem 0;
  color: var(--text-muted, #64748b);
}
.form-grid {
  display: grid;
  gap: 1rem;
}
</style>
