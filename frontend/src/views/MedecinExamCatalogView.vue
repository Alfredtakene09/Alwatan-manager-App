<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ListChecks, Plus, RefreshCw, Save, Stethoscope } from '@lucide/vue'
import api from '@/api/client'
import { confirmAppModal, showDuplicateModalFromError } from '@/lib/api-modal-helper'
import { formatFcfa } from '@/lib/roles'
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
import StCatalogActions from '@/components/ui/StCatalogActions.vue'
import MedecinOperationTypesPanel from '@/components/medecin/MedecinOperationTypesPanel.vue'
import '@/assets/simple-table.css'

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

type TabId = 'exams' | 'operations'

const route = useRoute()
const router = useRouter()
const { uiText, examNameText, localeCode } = useAppI18n()

function tabFromQuery(): TabId {
  return route.query.tab === 'operations' ? 'operations' : 'exams'
}

const activeTab = ref<TabId>(tabFromQuery())
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
  activeTab.value === 'operations'
    ? translateTemplate('Types d’opérations du service {service}', {
        service: serviceName.value,
      })
    : translateTemplate('Gérez les examens et tarifs de {service}', {
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
    label: examNameText(item.label),
    code: item.code,
    category: examNameText(item.category || '—'),
    price: formatFcfa(item.priceFcfa),
    priceSort: item.priceFcfa,
    statusLabel: item.active ? uiText('Actif') : uiText('Inactif'),
    statusVariant: item.active ? 'success' : 'danger',
    toggleLabel: item.active ? uiText('Désactiver') : uiText('Activer'),
    isActive: item.active,
  }))
})

function selectTab(tab: TabId) {
  activeTab.value = tab
}

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
  } catch (error) {
    const shown = await showDuplicateModalFromError(error)
    if (!shown) {
      message.value = 'Mise à jour impossible.'
      messageType.value = 'error'
    }
  } finally {
    saving.value = false
  }
}

async function toggleActive(id: string) {
  const item = itemsById.value.get(id)
  if (!item) return
  saving.value = true
  resetMessages()
  try {
    await api.put(`/consultation/exam-nomenclature/${id}`, { active: !item.active })
    message.value = item.active ? 'Élément désactivé.' : 'Élément réactivé.'
    messageType.value = 'success'
    invalidateExamCatalogCache()
    await loadItems()
  } catch {
    message.value = 'Mise à jour impossible.'
    messageType.value = 'error'
  } finally {
    saving.value = false
  }
}

async function deleteItem(id: string) {
  const item = itemsById.value.get(id)
  if (!item) return
  const ok = await confirmAppModal({
    type: 'DELETE',
    title: uiText("Supprimer l'élément"),
    message: translateTemplate('Supprimer « {name} » ?', { name: item.label }),
    confirmLabel: uiText('Supprimer'),
  })
  if (!ok) return
  saving.value = true
  resetMessages()
  try {
    await api.delete(`/consultation/exam-nomenclature/${id}`)
    message.value = 'Élément supprimé.'
    messageType.value = 'success'
    invalidateExamCatalogCache()
    await loadItems()
  } catch {
    message.value = 'Suppression impossible.'
    messageType.value = 'error'
  } finally {
    saving.value = false
  }
}

function onTableAction({ action, id }: { action: string; id: string }) {
  if (action === 'edit') openEditModal(id)
  if (action === 'toggle') void toggleActive(id)
  if (action === 'delete') void deleteItem(id)
}

onMounted(async () => {
  try {
    await loadServiceInfo()
  } catch {
    // handled in loadItems
  }
  if (activeTab.value === 'exams') await loadItems()
})

watch(activeTab, (tab) => {
  const query = tab === 'exams' ? {} : { tab }
  router.replace({ query })
  if (tab === 'exams' && items.value.length === 0) void loadItems()
})

watch(
  () => route.query.tab,
  () => {
    activeTab.value = tabFromQuery()
  },
)

watch(categoryOptions, (options) => {
  if (selectedCategory.value && !options.includes(selectedCategory.value)) {
    selectedCategory.value = ''
  }
})
</script>

<template>
  <div class="page-with-table">
    <section class="page-with-table__head">
      <UiPageHeader :title="pageTitle" :subtitle="pageSubtitle" :icon="ListChecks" />
      <div class="page-tabs" role="tablist" :aria-label="uiText('Sections nomenclature')">
        <button
          type="button"
          class="page-tab"
          role="tab"
          :aria-selected="activeTab === 'exams'"
          :class="{ 'page-tab--active': activeTab === 'exams' }"
          @click="selectTab('exams')"
        >
          <ListChecks :size="14" />
          {{ uiText('Examens') }}
        </button>
        <button
          type="button"
          class="page-tab"
          role="tab"
          :aria-selected="activeTab === 'operations'"
          :class="{ 'page-tab--active': activeTab === 'operations' }"
          @click="selectTab('operations')"
        >
          <Stethoscope :size="14" />
          {{ uiText('Types d’opérations') }}
        </button>
      </div>
    </section>

    <template v-if="activeTab === 'exams'">
      <UiAlert v-if="message" :type="messageType" :message="message" />

      <UiCard
        :title="pageTitle"
        :description="uiText('Tarifs utilisés pour vos prescriptions et la facturation')"
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
            {{ uiText('Actualiser') }}
          </UiButton>
          <span class="list-count">{{ elementCountLabel }}</span>
        </template>

        <div class="catalog-filters">
          <UiInput
            v-model="searchQuery"
            :label="uiText('Rechercher')"
            :placeholder="uiText('Libellé, code, catégorie…')"
          />
          <UiSelect
            :key="`medecin-category-filter-${serviceInfo?.clinicServiceId || 'none'}`"
            v-model="selectedCategory"
            :label="uiText('Catégorie')"
          >
            <option value="">{{ uiText('Toutes les catégories') }}</option>
            <option v-for="category in categoryOptions" :key="category" :value="category">
              {{ uiText(category) }}
            </option>
          </UiSelect>
        </div>

        <div class="table-panel-scroll">
          <div class="simple-table-shell">
            <div
              v-if="loading"
              class="simple-table-overlay" role="status"
              aria-live="polite"
            >
              <span class="simple-table-spinner" aria-hidden="true" />
              {{ uiText('Chargement de votre nomenclature…') }}
            </div>
            <div class="simple-table-scroll">
              <div class="simple-table-wrap">
                <table class="simple-table">
                  <thead>
                    <tr>
                      <th class="simple-table__num">#</th>
                      <th>{{ uiText('Libellé') }}</th>
                      <th>{{ uiText('Code') }}</th>
                      <th>{{ uiText('Catégorie') }}</th>
                      <th>{{ uiText('Tarif') }}</th>
                      <th>{{ uiText('Statut') }}</th>
                      <th class="simple-table__actions-head">{{ uiText('Actions') }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(row, index) in tableRows" :key="row.id">
                      <td class="simple-table__num">{{ index + 1 }}</td>
                      <td><span class="st-name">{{ row.label }}</span></td>
                      <td>{{ row.code }}</td>
                      <td>{{ row.category }}</td>
                      <td><span class="st-amount">{{ row.price }}</span></td>
                      <td>
                        <span class="st-badge" :class="`st-badge--${row.statusVariant}`">{{ row.statusLabel }}</span>
                      </td>
                      <td class="simple-table__actions">
                        <StCatalogActions
                          :id="row.id"
                          :is-active="row.isActive"
                          :toggle-label="row.toggleLabel"
                          @action="onTableAction"
                        />
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
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
            {{ uiText('Service') }}: <strong>{{ uiText(serviceName) }}</strong>
          </p>
          <div class="form-grid-2">
            <UiInput
              v-model="newItem.code"
              :label="uiText('Code (optionnel)')"
              :placeholder="uiText('ex: consultation')"
            />
            <UiInput
              v-model="newItem.label"
              :label="uiText('Libellé')"
              :placeholder="uiText(`Libellé de l'examen`)"
            />
            <UiInput
              v-model="newItem.category"
              :label="uiText('Catégorie (optionnel)')"
              :placeholder="uiText('Optionnel')"
            />
            <UiInput
              v-model="newItem.priceFcfa"
              :label="uiText('Tarif (FCFA)')"
              type="number"
              min="1"
            />
          </div>
        </section>
        <template #footer>
          <UiButton variant="ghost" @click="closeAddModal">{{ uiText('Annuler') }}</UiButton>
          <UiButton variant="primary" :icon="Plus" :disabled="saving" @click="addItem">
            {{ uiText('Enregistrer') }}
          </UiButton>
        </template>
      </UiFormModal>

      <UiFormModal
        v-if="editingId"
        title-id="medecin-edit-catalog-title"
        :title="uiText(`Modifier l'élément`)"
        :subtitle="uiText('Mettre à jour le libellé, la catégorie ou le tarif')"
        :icon="ListChecks"
        @close="closeEditModal"
      >
        <section class="form-panel">
          <div class="form-grid-2">
            <UiInput v-model="editForm.code" :label="uiText('Code (optionnel)')" />
            <UiInput v-model="editForm.label" :label="uiText('Libellé')" />
            <UiInput v-model="editForm.category" :label="uiText('Catégorie (optionnel)')" />
            <UiInput
              v-model="editForm.priceFcfa"
              :label="uiText('Tarif (FCFA)')"
              type="number"
              min="1"
            />
          </div>
        </section>
        <template #footer>
          <UiButton variant="ghost" @click="closeEditModal">{{ uiText('Annuler') }}</UiButton>
          <UiButton variant="primary" :icon="Save" :disabled="saving" @click="saveEdit">
            {{ uiText('Enregistrer') }}
          </UiButton>
        </template>
      </UiFormModal>
    </template>

    <MedecinOperationTypesPanel
      v-else
      :service-info="
        serviceInfo
          ? {
              clinicServiceId: serviceInfo.clinicServiceId,
              clinicServiceName: serviceInfo.clinicServiceName,
            }
          : null
      "
    />
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

.form-grid-2 {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
}

@media (max-width: 720px) {
  .form-grid-2 {
    grid-template-columns: 1fr;
  }
}
</style>
