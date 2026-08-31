<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { Plus, RefreshCw, Save } from '@lucide/vue'
import api from '@/api/client'
import { confirmAppModal, showDuplicateModalFromError } from '@/lib/api-modal-helper'
import { formatFcfa } from '@/lib/roles'
import {
  EXAM_CATALOG_KIND_CONFIG,
  EXAM_CATALOG_ADD_LABELS,
  EXAM_CATALOG_FORM_PLACEHOLDERS,
  EXAM_CATALOG_KIND_SLUGS,
  examCatalogKindRoute,
  type ExamCatalogKindSlug,
} from '@/lib/exam-catalog-kinds'
import { invalidateExamCatalogCache } from '@/lib/exam-catalog'
import { suggestExamCatalogKindSlugFromServiceName } from '@/lib/exam-catalog-service-kind'
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
  labPanelId?: string | null
  labPanel?: {
    id: string
    slug: string
    label: string
    active: boolean
    _count?: { fields: number }
  } | null
}

type ClinicServiceOption = { id: string; name: string; active?: boolean }
type ServiceTabOption = { id: string; name: string; examCount: number }

const props = defineProps<{
  kind: ExamCatalogKindSlug
}>()

const { uiText, examNameText, localeCode } = useAppI18n()

const config = computed(() => EXAM_CATALOG_KIND_CONFIG[props.kind])
const formPlaceholders = computed(() => EXAM_CATALOG_FORM_PLACEHOLDERS[props.kind])
const items = ref<CatalogItem[]>([])
const clinicServices = ref<ClinicServiceOption[]>([])
const activeServiceTabId = ref<string>('all')
const selectedServiceToAdd = ref<string>('')
const serviceTabIds = ref<string[]>([])
const serviceTabExamCounts = ref<Record<string, number>>({})
const searchQuery = ref('')
const selectedCategory = ref('')
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
  clinicServiceId: '',
})

const editForm = ref({
  code: '',
  label: '',
  category: '',
  priceFcfa: '',
  clinicServiceId: '',
})

const itemsById = computed(() => new Map(items.value.map((item) => [item.id, item])))

const dynamicServiceTabs = computed<ServiceTabOption[]>(() => {
  if (!serviceTabIds.value.length) return []
  const serviceById = new Map(clinicServices.value.map((service) => [service.id, service]))
  return serviceTabIds.value
    .map((id) => {
      const service = serviceById.get(id)
      if (!service) return null
      return {
        id: service.id,
        name: service.name,
        examCount: serviceTabExamCounts.value[id] ?? 0,
      }
    })
    .filter((tab): tab is ServiceTabOption => Boolean(tab))
})
const activeServiceTabName = computed(() => {
  if (activeServiceTabId.value === 'all') return uiText('Tous les services')
  const service = clinicServices.value.find((item) => item.id === activeServiceTabId.value)
  return service?.name ?? uiText('Service inconnu')
})
const isServiceContext = computed(() => activeServiceTabId.value !== 'all')
const contextLabel = computed(() =>
  isServiceContext.value ? activeServiceTabName.value : uiText(config.value.label),
)
const pageTitle = computed(() => contextLabel.value)
const pageSubtitle = computed(() =>
  isServiceContext.value
    ? translateTemplate('Nomenclature et tarifs — {service}', {
        service: activeServiceTabName.value,
      })
    : uiText(config.value.subtitle),
)
const addButtonLabel = computed(() =>
  isServiceContext.value
    ? translateTemplate('Ajout {label}', { label: activeServiceTabName.value })
    : EXAM_CATALOG_ADD_LABELS[props.kind],
)
const catalogCardTitle = computed(() =>
  translateTemplate('Nomenclature — {label}', { label: contextLabel.value }),
)
const addModalSubtitle = computed(() =>
  translateTemplate('Ajouter un élément à la nomenclature {kind}', {
    kind: contextLabel.value,
  }),
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
      const haystack = [item.label, item.code, item.category ?? '', item.clinicService?.name ?? '']
        .join(' ')
        .toLowerCase()
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
    service: uiText(item.clinicService?.name || 'Tous les services'),
    formLabel: (() => {
      if (props.kind !== 'examen') return '—'
      if (!item.labPanelId) return uiText('À créer')
      const fieldCount = item.labPanel?._count?.fields ?? 0
      if (fieldCount <= 0) return uiText('Formulaire à compléter au labo')
      return examNameText(item.labPanel?.label || 'Lié')
    })(),
    formLinked: Boolean(item.labPanelId),
    formNeedsLabFields:
      props.kind === 'examen' &&
      Boolean(item.labPanelId) &&
      (item.labPanel?._count?.fields ?? 0) <= 0,
    price: formatFcfa(item.priceFcfa),
    priceSort: item.priceFcfa,
    statusLabel: item.active ? uiText('Actif') : uiText('Inactif'),
    statusVariant: item.active ? 'success' : 'danger',
    toggleLabel: item.active ? uiText('Désactiver') : uiText('Activer'),
    isActive: item.active,
  }))
})

function resetListFilters() {
  searchQuery.value = ''
  selectedCategory.value = ''
}

function resetMessages() {
  message.value = ''
}

async function loadClinicServices() {
  try {
    const { data } = await api.get<ClinicServiceOption[]>('/admin/services')
    clinicServices.value = Array.isArray(data) ? data.filter((s) => s.active !== false) : []
  } catch {
    try {
      const { data } = await api.get<ClinicServiceOption[]>('/gestionnaire/services')
      clinicServices.value = Array.isArray(data) ? data.filter((s) => s.active !== false) : []
    } catch {
      clinicServices.value = []
    }
  }
}

async function loadItems() {
  loading.value = true
  resetMessages()
  try {
    if (activeServiceTabId.value !== 'all') {
      const { data } = await api.get<CatalogItem[]>(
        `/comptabilite/exam-types/catalog-by-service/${activeServiceTabId.value}`,
      )
      items.value = Array.isArray(data) ? data : []
    } else {
      const { data } = await api.get<CatalogItem[]>(`/comptabilite/exam-types/catalog/${props.kind}`)
      items.value = Array.isArray(data) ? data : []
    }
  } catch {
    message.value = 'Impossible de charger la nomenclature.'
    messageType.value = 'error'
  } finally {
    loading.value = false
  }
}

function kindSlugForItem(item: CatalogItem): ExamCatalogKindSlug {
  const raw = String(item.kind ?? '').toLowerCase()
  if (raw === 'examen' || raw === 'radio' || raw === 'echo' || raw === 'odonto') return raw
  return props.kind
}

function resetNewItemForm() {
  newItem.value = { code: '', label: '', category: '', priceFcfa: '', clinicServiceId: '' }
}

function openAddModal() {
  resetNewItemForm()
  if (activeServiceTabId.value !== 'all') {
    newItem.value.clinicServiceId = activeServiceTabId.value
  }
  showAddModal.value = true
}

function closeAddModal() {
  showAddModal.value = false
  resetNewItemForm()
}

async function addItem() {
  if (!newItem.value.label.trim() || newItem.value.priceFcfa === '') {
    message.value = 'Libellé et tarif sont obligatoires (0 = à tarifer plus tard).'
    messageType.value = 'error'
    return
  }

  saving.value = true
  resetMessages()
  try {
    // Onglet service => lié à ce service.
    // Onglet Labo/Radio/Écho/Odonto => nomenclature globale du type (pas de service spécialisé).
    const serviceId = isServiceContext.value ? activeServiceTabId.value : null
    const serviceName = serviceId
      ? clinicServices.value.find((service) => service.id === serviceId)?.name
      : null
    const targetKind = serviceId
      ? suggestExamCatalogKindSlugFromServiceName(serviceName)
      : props.kind

    await api.post(`/comptabilite/exam-types/catalog/${targetKind}`, {
      code: newItem.value.code.trim() || undefined,
      label: newItem.value.label.trim(),
      category: newItem.value.category.trim() || undefined,
      priceFcfa: Number(newItem.value.priceFcfa),
      clinicServiceId: serviceId,
    })
    message.value = 'Élément ajouté à la nomenclature.'
    messageType.value = 'success'
    invalidateExamCatalogCache()
    closeAddModal()
    await Promise.all([loadServiceTabs(), loadItems()])
  } catch (error) {
    const shown = await showDuplicateModalFromError(error)
    if (!shown) {
      message.value = 'Ajout impossible. Vérifiez le code (unique), le service et les tarifs.'
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
    clinicServiceId:
      activeServiceTabId.value !== 'all'
        ? activeServiceTabId.value
        : (item.clinicServiceId ?? item.clinicService?.id ?? ''),
  }
}

function closeEditModal() {
  editingId.value = null
}

async function saveEdit() {
  if (!editingId.value) return
  if (!editForm.value.label.trim() || editForm.value.priceFcfa === '') {
    message.value = 'Libellé et tarif sont obligatoires (0 = à tarifer plus tard).'
    messageType.value = 'error'
    return
  }
  const current = itemsById.value.get(editingId.value)
  const kindSlug = current ? kindSlugForItem(current) : props.kind
  saving.value = true
  resetMessages()
  try {
    const serviceId = isServiceContext.value
      ? activeServiceTabId.value
      : editForm.value.clinicServiceId.trim() || null
    // Sur un onglet type (Labo/…), on ne rattache jamais à un service spécialisé.
    const resolvedServiceId = isServiceContext.value ? serviceId : null
    await api.put(`/comptabilite/exam-types/catalog/${kindSlug}/${editingId.value}`, {
      code: editForm.value.code.trim() || undefined,
      label: editForm.value.label.trim(),
      category: editForm.value.category.trim() || undefined,
      priceFcfa: Number(editForm.value.priceFcfa),
      clinicServiceId: resolvedServiceId,
    })
    message.value = 'Élément mis à jour.'
    messageType.value = 'success'
    invalidateExamCatalogCache()
    closeEditModal()
    await Promise.all([loadServiceTabs(), loadItems()])
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
    await api.put(`/comptabilite/exam-types/catalog/${kindSlugForItem(item)}/${id}`, {
      active: !item.active,
    })
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
    await api.delete(`/comptabilite/exam-types/catalog/${kindSlugForItem(item)}/${id}`)
    message.value = 'Élément supprimé.'
    messageType.value = 'success'
    invalidateExamCatalogCache()
    if (editingId.value === id) closeEditModal()
    await Promise.all([loadServiceTabs(), loadItems()])
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

async function loadServiceTabs() {
  try {
    const { data } = await api.get<
      Array<{
        clinicServiceId: string
        sortOrder: number
        examCount?: number
        clinicService: { id: string; name: string; active?: boolean }
      }>
    >(`/comptabilite/exam-types/service-tabs/${props.kind}`)
    serviceTabIds.value = Array.isArray(data)
      ? data
          .map((item) => item.clinicServiceId)
          .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      : []
    const counts: Record<string, number> = {}
    if (Array.isArray(data)) {
      for (const item of data) {
        counts[item.clinicServiceId] = Number(item.examCount ?? 0)
      }
    }
    serviceTabExamCounts.value = counts

    if (activeServiceTabId.value !== 'all' && !serviceTabIds.value.includes(activeServiceTabId.value)) {
      activeServiceTabId.value = 'all'
    }
  } catch {
    serviceTabIds.value = []
    serviceTabExamCounts.value = {}
    if (activeServiceTabId.value !== 'all') activeServiceTabId.value = 'all'
  }
}

function setActiveServiceTab(serviceId: string) {
  activeServiceTabId.value = serviceId
  resetListFilters()
  loadItems()
}

function onKindTabClick() {
  if (activeServiceTabId.value === 'all') return
  activeServiceTabId.value = 'all'
  selectedServiceToAdd.value = ''
  resetListFilters()
  loadItems()
}

async function addServiceTab() {
  const serviceId = selectedServiceToAdd.value.trim()
  if (!serviceId) return
  if (serviceTabIds.value.includes(serviceId)) {
    setActiveServiceTab(serviceId)
    return
  }
  try {
    await api.post(`/comptabilite/exam-types/service-tabs/${props.kind}`, {
      clinicServiceId: serviceId,
    })
    await loadServiceTabs()
    selectedServiceToAdd.value = ''
    setActiveServiceTab(serviceId)
  } catch {
    message.value = "Ajout de l'onglet service impossible."
    messageType.value = 'error'
  }
}

async function removeServiceTab(serviceId: string) {
  const examCount = serviceTabExamCounts.value[serviceId] ?? 0
  if (examCount > 0) {
    message.value =
      "Impossible de retirer cet onglet : supprimez d'abord tous ses examens."
    messageType.value = 'error'
    return
  }
  try {
    await api.delete(`/comptabilite/exam-types/service-tabs/${props.kind}/${serviceId}`)
    await loadServiceTabs()
    if (activeServiceTabId.value === serviceId) {
      activeServiceTabId.value = 'all'
      await loadItems()
    }
  } catch {
    message.value = "Suppression de l'onglet service impossible."
    messageType.value = 'error'
  }
}

watch(
  () => props.kind,
  async () => {
    closeEditModal()
    closeAddModal()
    // Les onglets service restent affichés, mais le filtre service
    // est désactivé pour laisser chaque type (Labo/Radio/…) montrer sa nomenclature.
    activeServiceTabId.value = 'all'
    selectedServiceToAdd.value = ''
    resetListFilters()
    await loadServiceTabs()
    await loadItems()
  },
)

watch(categoryOptions, (options) => {
  if (selectedCategory.value && !options.includes(selectedCategory.value)) {
    selectedCategory.value = ''
  }
})

watch(
  [activeServiceTabId, showAddModal],
  ([serviceTabId, isAddModalOpen]) => {
    if (!isAddModalOpen) return
    newItem.value.clinicServiceId = serviceTabId === 'all' ? '' : serviceTabId
  },
)

onMounted(async () => {
  await Promise.all([loadClinicServices(), loadServiceTabs(), loadItems()])
  const activeIds = new Set(clinicServices.value.map((service) => service.id))
  const filtered = serviceTabIds.value.filter((id) => activeIds.has(id))
  if (filtered.length !== serviceTabIds.value.length) {
    serviceTabIds.value = filtered
    if (activeServiceTabId.value !== 'all' && !activeIds.has(activeServiceTabId.value)) {
      activeServiceTabId.value = 'all'
      await loadItems()
    }
  }
})
</script>

<template>
  <div>
    <UiPageHeader :title="pageTitle" :subtitle="pageSubtitle" :icon="config.icon" />

    <nav class="exam-kind-tabs" :aria-label="uiText(`Types d'examen`)">
      <RouterLink
        v-for="slug in EXAM_CATALOG_KIND_SLUGS"
        :key="slug"
        :to="examCatalogKindRoute(slug)"
        class="exam-kind-tab"
        :class="{
          'exam-kind-tab--muted': isServiceContext,
          'exam-kind-tab--active': !isServiceContext && kind === slug,
        }"
        @click="onKindTabClick"
      >
        <component :is="EXAM_CATALOG_KIND_CONFIG[slug].icon" :size="16" />
        {{ uiText(EXAM_CATALOG_KIND_CONFIG[slug].label) }}
      </RouterLink>
      <div
        v-for="tab in dynamicServiceTabs"
        :key="tab.id"
        class="exam-kind-tab exam-kind-tab--service"
        :class="{
          'exam-kind-tab--active': activeServiceTabId === tab.id,
          'exam-kind-tab--service-removable': tab.examCount === 0,
        }"
      >
        <button type="button" class="exam-kind-tab__label" @click="setActiveServiceTab(tab.id)">
          {{ uiText(tab.name) }}
        </button>
        <button
          v-if="tab.examCount === 0"
          type="button"
          class="exam-kind-tab__remove"
          :aria-label="translateTemplate(`Retirer l'onglet {name}`, { name: tab.name })"
          @click="removeServiceTab(tab.id)"
        >
          ×
        </button>
      </div>
    </nav>

    <div class="service-tabs-toolbar">
      <UiSelect v-model="selectedServiceToAdd" :label="uiText('Ajouter un onglet service')">
        <option value="" disabled>{{ uiText('Sélectionner un service') }}</option>
        <option
          v-for="service in clinicServices.filter((s) => !serviceTabIds.includes(s.id))"
          :key="service.id"
          :value="service.id"
        >
          {{ uiText(service.name) }}
        </option>
      </UiSelect>
      <UiButton variant="ghost" size="sm" :disabled="!selectedServiceToAdd" @click="addServiceTab">
        {{ uiText('Ajouter onglet') }}
      </UiButton>
    </div>

    <UiAlert v-if="message" :type="messageType" :message="uiText(message)" />

    <UiCard
      :title="catalogCardTitle"
      :description="uiText('Tarifs utilisés pour la facturation des examens')"
      :icon="config.icon"
      :icon-variant="config.iconVariant"
      class="section"
    >
      <template #actions>
        <UiButton variant="primary" size="sm" :icon="Plus" ui-action="catalog.exam_types" @click="openAddModal">
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
          :key="`category-filter-${kind}-${activeServiceTabId}`"
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
            {{ uiText('Chargement de la nomenclature…') }}
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
                    <th>{{ uiText('Service') }}</th>
                    <th v-if="kind === 'examen'">{{ uiText('Formulaire résultats') }}</th>
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
                    <td>{{ row.service }}</td>
                    <td v-if="kind === 'examen'">
                      <span
                        class="st-badge"
                        :class="
                          row.formNeedsLabFields
                            ? 'st-badge--warning'
                            : row.formLinked
                              ? 'st-badge--success'
                              : 'st-badge--default'
                        "
                      >{{ row.formLabel }}</span>
                    </td>
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
      title-id="add-catalog-title"
      :title="uiText(addButtonLabel)"
      :subtitle="addModalSubtitle"
      :icon="config.icon"
      @close="closeAddModal"
    >
      <section class="form-panel">
        <p class="form-panel__hint">
          {{ uiText('Service actif') }}: <strong>{{ uiText(activeServiceTabName) }}</strong>
        </p>
        <div class="form-grid-2">
          <UiInput
            v-model="newItem.code"
            :label="uiText('Code (optionnel)')"
            :placeholder="formPlaceholders.code"
          />
          <UiInput
            v-model="newItem.label"
            :label="uiText('Libellé')"
            :placeholder="uiText(formPlaceholders.label)"
          />
          <UiInput
            v-model="newItem.category"
            :label="uiText('Catégorie (optionnel)')"
            :placeholder="uiText(formPlaceholders.category)"
          />
          <UiInput
            v-model="newItem.priceFcfa"
            :label="uiText('Tarif (FCFA)')"
            type="number"
            min="0"
          />
          <UiSelect
            v-if="isServiceContext"
            :key="`new-item-service-${activeServiceTabId}`"
            v-model="newItem.clinicServiceId"
            :label="uiText('Service')"
            disabled
          >
            <option v-for="service in clinicServices" :key="service.id" :value="service.id">
              {{ uiText(service.name) }}
            </option>
          </UiSelect>
        </div>
        <p class="form-panel__hint">
          <template v-if="isServiceContext">
            {{
              translateTemplate('Cet examen sera enregistré pour le service {service}.', {
                service: activeServiceTabName,
              })
            }}
          </template>
          <template v-else>
            {{
              translateTemplate(
                'Cet examen sera ajouté à la nomenclature {kind} (visible sur cet onglet).',
                { kind: uiText(config.label) },
              )
            }}
          </template>
        </p>
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
      title-id="edit-catalog-title"
      :title="uiText(`Modifier l'élément`)"
      :subtitle="uiText('Mettre à jour le libellé, la catégorie ou le tarif')"
      :icon="config.icon"
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
            min="0"
          />
          <UiSelect
            v-if="isServiceContext"
            v-model="editForm.clinicServiceId"
            :label="uiText('Service')"
            disabled
          >
            <option v-for="service in clinicServices" :key="service.id" :value="service.id">
              {{ uiText(service.name) }}
            </option>
          </UiSelect>
        </div>
      </section>
      <template #footer>
        <UiButton variant="ghost" @click="closeEditModal">{{ uiText('Annuler') }}</UiButton>
        <UiButton variant="primary" :icon="Save" :disabled="saving" @click="saveEdit">
          {{ uiText('Enregistrer') }}
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

.service-tabs-toolbar {
  margin-top: 0.75rem;
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
  align-items: end;
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

.exam-kind-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-top: 1rem;
  padding: 0.25rem;
  border-radius: 12px;
  background: var(--surface-muted, #eef2e6);
  border: 1px solid var(--border);
}

.exam-kind-tab {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.55rem 0.9rem;
  border-radius: 9px;
  border: 0;
  background: transparent;
  color: var(--text-muted);
  font-size: 0.8125rem;
  font-weight: 700;
  text-decoration: none;
  transition: background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
}

.exam-kind-tab:hover {
  color: var(--primary-800);
}

.exam-kind-tab.router-link-active:not(.exam-kind-tab--muted) {
  background: #fff;
  color: var(--primary-800);
  box-shadow: 0 1px 4px rgba(15, 23, 42, 0.08);
}

.exam-kind-tab--muted.router-link-active {
  background: transparent;
  color: var(--text-muted);
  box-shadow: none;
}

.exam-kind-tab--active {
  background: #fff;
  color: var(--primary-800);
  box-shadow: 0 1px 4px rgba(15, 23, 42, 0.08);
}

.exam-kind-tab--service {
  border: 1px solid var(--border);
  background: var(--surface-soft, #f7f8f4);
}

.exam-kind-tab--service-removable {
  padding: 0.2rem 0.3rem 0.2rem 0.65rem;
  gap: 0.35rem;
}

.exam-kind-tab__label {
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
  padding: 0;
}

.exam-kind-tab__remove {
  width: 1.35rem;
  height: 1.35rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: #fff;
  color: var(--text-muted);
  line-height: 1;
  font-size: 1rem;
  cursor: pointer;
}

.service-tabs-row {
  margin-top: 0.8rem;
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}

.service-tab {
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--border);
  background: var(--surface-soft, #f7f8f4);
  color: var(--text-muted);
  border-radius: 999px;
  font-size: 0.8125rem;
  font-weight: 700;
  padding: 0.4rem 0.75rem;
}

.service-tab--active {
  border-color: var(--primary-300);
  color: var(--primary-800);
  background: var(--primary-50, #eaf8f1);
}

.service-tab--removable {
  padding: 0.2rem 0.3rem 0.2rem 0.65rem;
  gap: 0.35rem;
}

.service-tab__label {
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
  padding: 0;
}

.service-tab__remove {
  width: 1.35rem;
  height: 1.35rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: #fff;
  color: var(--text-muted);
  line-height: 1;
  font-size: 1rem;
  cursor: pointer;
}
</style>
