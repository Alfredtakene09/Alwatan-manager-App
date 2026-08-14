<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Plus, RefreshCw, Stethoscope, Syringe, Eye, Pencil } from '@lucide/vue'
import api from '@/api/client'
import { confirmAppModal, showDuplicateModalFromError } from '@/lib/api-modal-helper'
import { formatFcfa, fullName } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth'
import { clinicPercentFromSplits, validateInterventionPercents } from '@/lib/intervention-splits'
import { OPERATION_KIND_CONFIG } from '@/lib/exam-catalog-kinds'
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
import '@/assets/simple-table.css'

type DoctorOption = {
  id: string
  firstName: string
  lastName: string
}

type ClinicServiceOption = {
  id: string
  name: string
  active?: boolean
}

type InterventionItem = {
  id: string
  code: string
  label: string
  category: 'MAJEURE_A' | 'MOYENNE_B' | 'PETITE_C'
  totalCostFcfa: number
  surgeonPercent: number
  anesthesiologistPercent: number
  clinicPercent: number
  surgeonId?: string | null
  surgeonName?: string | null
  anesthesiologistId?: string | null
  anesthesiologistName?: string | null
  clinicServiceId?: string | null
  surgeon?: DoctorOption | null
  anesthesiologist?: DoctorOption | null
  clinicService?: { id: string; name: string } | null
  authorizedSurgeons?: DoctorOption[]
  surgeonIds?: string[]
  active: boolean
}

const config = OPERATION_KIND_CONFIG
const addButtonLabel = 'Ajout'
const { uiText, localeCode } = useAppI18n()
const items = ref<InterventionItem[]>([])
const doctors = ref<DoctorOption[]>([])
const clinicServices = ref<ClinicServiceOption[]>([])
const loading = ref(false)
const saving = ref(false)
const message = ref('')
const messageType = ref<'success' | 'error'>('success')
const showAddModal = ref(false)
const editingId = ref<string | null>(null)
const viewModalOpen = ref(false)
const viewingItem = ref<InterventionItem | null>(null)
const searchQuery = ref('')
const serviceFilterId = ref('')
const medecinRole = ref<'surgeon' | 'anesthesiologist'>('surgeon')
const surgeonInputMode = ref<'select' | 'custom'>('select')
const assistantInputMode = ref<'select' | 'custom'>('select')

const newItem = ref({
  label: '',
  category: 'MAJEURE_A' as InterventionItem['category'],
  totalCostFcfa: '',
  clinicServiceId: '',
  surgeonId: '',
  surgeonName: '',
  withAnesthesiologist: false,
  anesthesiologistId: '',
  anesthesiologistName: '',
  surgeonPercent: '',
  anesthesiologistPercent: '',
  surgeonIds: [] as string[],
})

const operationCountLabel = computed(() =>
  translateTemplate('{n} opération(s)', { n: filteredItems.value.length }),
)

const itemsById = computed(() => new Map(items.value.map((item) => [item.id, item])))

const filteredItems = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  const serviceId = serviceFilterId.value.trim()
  return items.value.filter((item) => {
    const itemServiceId = item.clinicServiceId ?? item.clinicService?.id ?? ''
    if (serviceId && itemServiceId !== serviceId) return false
    if (!q) return true
    const service = item.clinicService?.name ?? ''
    const surgeon =
      item.surgeon
        ? fullName(item.surgeon.firstName, item.surgeon.lastName)
        : (item.surgeonName ?? '')
    return (
      item.label.toLowerCase().includes(q) ||
      service.toLowerCase().includes(q) ||
      surgeon.toLowerCase().includes(q)
    )
  })
})

const filterServices = computed(() => {
  const counts = new Map<string, { id: string; name: string; count: number }>()
  for (const item of items.value) {
    const id = item.clinicServiceId ?? item.clinicService?.id
    const name = item.clinicService?.name?.trim()
    if (!id || !name) continue
    const existing = counts.get(id)
    if (existing) {
      existing.count += 1
    } else {
      counts.set(id, { id, name, count: 1 })
    }
  }
  return [...counts.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr'))
})

const selectedServiceCount = computed(() => filteredItems.value.length)

const serviceFilterCountLabel = computed(() => {
  if (!serviceFilterId.value) {
    return translateTemplate('{n} opération(s) · tous services', { n: selectedServiceCount.value })
  }
  const service = filterServices.value.find((item) => item.id === serviceFilterId.value)
  const name = service?.name ?? 'Service'
  return translateTemplate('{n} opération(s) — {service}', {
    n: selectedServiceCount.value,
    service: name,
  })
})

const surgeonPercentValue = computed(() => Number(newItem.value.surgeonPercent) || 0)
const anesthesiologistPercentValue = computed(() =>
  newItem.value.withAnesthesiologist ? Number(newItem.value.anesthesiologistPercent) || 0 : 0,
)
const clinicPercentPreview = computed(() =>
  clinicPercentFromSplits(surgeonPercentValue.value, anesthesiologistPercentValue.value),
)

const splitPreviewValid = computed(() => {
  if (!newItem.value.surgeonPercent) return true
  return validateInterventionPercents(surgeonPercentValue.value, anesthesiologistPercentValue.value) === null
})

const tableRows = computed(() => {
  localeCode.value
  return filteredItems.value.map((item) => ({
    id: item.id,
    label: item.label,
    service: item.clinicService?.name || '—',
    cost: formatFcfa(item.totalCostFcfa),
    costSort: item.totalCostFcfa,
    surgeonPercent: `${item.surgeonPercent}%`,
    anesthesiologistPercent:
      item.anesthesiologistPercent > 0 ? `${item.anesthesiologistPercent}%` : '—',
    clinicPercent: `${item.clinicPercent}%`,
    medecins: [
      item.surgeon
        ? `Chir. Dr ${fullName(item.surgeon.firstName, item.surgeon.lastName)}`
        : item.surgeonName
          ? `Chir. ${item.surgeonName}`
          : null,
      item.anesthesiologist
        ? `Ass. chir. Dr ${fullName(item.anesthesiologist.firstName, item.anesthesiologist.lastName)}`
        : item.anesthesiologistName
          ? `Ass. chir. ${item.anesthesiologistName}`
          : null,
    ]
      .filter(Boolean)
      .join(' · ') || '—',
    statusLabel: item.active ? uiText('Actif') : uiText('Inactif'),
    statusVariant: item.active ? 'success' : 'danger',
    toggleLabel: item.active ? uiText('Désactiver') : uiText('Activer'),
    isActive: item.active,
  }))
})

const viewingSurgeonLabel = computed(() => {
  const item = viewingItem.value
  if (!item) return '—'
  if (item.surgeon) return `Dr ${fullName(item.surgeon.firstName, item.surgeon.lastName)}`
  if (item.surgeonName) return item.surgeonName
  return '—'
})

const viewingAnesthesiologistLabel = computed(() => {
  const item = viewingItem.value
  if (!item) return '—'
  if (item.anesthesiologist) {
    return `Dr ${fullName(item.anesthesiologist.firstName, item.anesthesiologist.lastName)}`
  }
  if (item.anesthesiologistName) return item.anesthesiologistName
  return '—'
})

const viewingServiceLabel = computed(() => {
  const item = viewingItem.value
  if (!item) return '—'
  return item.clinicService?.name || '—'
})

const isEditing = computed(() => Boolean(editingId.value))
const formModalTitle = computed(() =>
  isEditing.value ? uiText("Modifier l'opération") : uiText(addButtonLabel),
)
const formModalSubtitle = computed(() =>
  isEditing.value
    ? uiText('Mettre à jour les tarifs, médecins et répartitions')
    : uiText('Nouvelle opération avec répartition des honoraires'),
)

function resetNewItemForm() {
  newItem.value = {
    label: '',
    category: 'MAJEURE_A',
    totalCostFcfa: '',
    clinicServiceId: '',
    surgeonId: '',
    surgeonName: '',
    withAnesthesiologist: false,
    anesthesiologistId: '',
    anesthesiologistName: '',
    surgeonPercent: '',
    anesthesiologistPercent: '',
    surgeonIds: [],
  }
  medecinRole.value = 'surgeon'
  surgeonInputMode.value = 'select'
  assistantInputMode.value = 'select'
}

function toggleAuthorizedSurgeon(doctorId: string) {
  const set = new Set(newItem.value.surgeonIds)
  if (set.has(doctorId)) set.delete(doctorId)
  else set.add(doctorId)
  newItem.value.surgeonIds = [...set]
}

function onPrimarySurgeonChange() {
  const id = newItem.value.surgeonId
  if (!id) return
  if (!newItem.value.surgeonIds.includes(id)) {
    newItem.value.surgeonIds = [...newItem.value.surgeonIds, id]
  }
}

function onSurgeonInputModeChange(mode: 'select' | 'custom') {
  surgeonInputMode.value = mode
  if (mode === 'select') {
    newItem.value.surgeonName = ''
  } else {
    newItem.value.surgeonId = ''
  }
}

function onAssistantInputModeChange(mode: 'select' | 'custom') {
  assistantInputMode.value = mode
  if (mode === 'select') {
    newItem.value.anesthesiologistName = ''
  } else {
    newItem.value.anesthesiologistId = ''
  }
}

function openAddModal() {
  editingId.value = null
  message.value = ''
  resetNewItemForm()
  showAddModal.value = true
}

function closeAddModal() {
  showAddModal.value = false
  editingId.value = null
  resetNewItemForm()
}

function openEditModal(id: string) {
  const item = itemsById.value.get(id)
  if (!item) return

  editingId.value = id
  message.value = ''
  const hasAssistant = item.anesthesiologistPercent > 0
  const surgeonFromList = Boolean(item.surgeonId)
  const assistantFromList = Boolean(item.anesthesiologistId)

  newItem.value = {
    label: item.label,
    category: item.category,
    totalCostFcfa: String(item.totalCostFcfa),
    clinicServiceId: item.clinicServiceId ?? item.clinicService?.id ?? '',
    surgeonId: item.surgeonId ?? '',
    surgeonName: item.surgeonName ?? '',
    withAnesthesiologist: hasAssistant,
    anesthesiologistId: item.anesthesiologistId ?? '',
    anesthesiologistName: item.anesthesiologistName ?? '',
    surgeonPercent: String(item.surgeonPercent),
    anesthesiologistPercent: hasAssistant ? String(item.anesthesiologistPercent) : '',
    surgeonIds: item.surgeonIds?.length
      ? [...item.surgeonIds]
      : (item.authorizedSurgeons ?? []).map((d) => d.id),
  }
  surgeonInputMode.value = surgeonFromList ? 'select' : 'custom'
  assistantInputMode.value = assistantFromList ? 'select' : 'custom'
  medecinRole.value = 'surgeon'
  showAddModal.value = true
}

function onWithAnesthesiologistChange(enabled: boolean) {
  newItem.value.withAnesthesiologist = enabled
  if (!enabled) {
    newItem.value.anesthesiologistId = ''
    newItem.value.anesthesiologistName = ''
    newItem.value.anesthesiologistPercent = ''
    assistantInputMode.value = 'select'
    medecinRole.value = 'surgeon'
  }
}

async function loadDoctors() {
  try {
    const { data } = await api.get<DoctorOption[]>('/comptabilite/exam-types/operations/doctors')
    doctors.value = data
  } catch {
    doctors.value = []
  }
}

async function loadClinicServices() {
  const auth = useAuthStore()
  const preferred =
    auth.user?.role === 'GESTIONNAIRE' ? '/gestionnaire/services' : '/admin/services'
  const fallback = preferred.startsWith('/gestionnaire') ? '/admin/services' : '/gestionnaire/services'
  try {
    const { data } = await api.get<ClinicServiceOption[]>(preferred)
    clinicServices.value = Array.isArray(data) ? data.filter((s) => s.active !== false) : []
  } catch {
    try {
      const { data } = await api.get<ClinicServiceOption[]>(fallback)
      clinicServices.value = Array.isArray(data) ? data.filter((s) => s.active !== false) : []
    } catch {
      clinicServices.value = []
    }
  }
}

async function loadItems() {
  loading.value = true
  try {
    const { data } = await api.get<InterventionItem[] | { items?: InterventionItem[] }>(
      '/comptabilite/exam-types/operations',
    )
    const list = Array.isArray(data)
      ? data
      : Array.isArray((data as { items?: InterventionItem[] })?.items)
        ? (data as { items: InterventionItem[] }).items
        : null
    if (list) {
      items.value = list
      if (
        serviceFilterId.value &&
        !list.some(
          (item) => (item.clinicServiceId ?? item.clinicService?.id ?? '') === serviceFilterId.value,
        )
      ) {
        serviceFilterId.value = ''
      }
    } else {
      message.value = 'Réponse invalide du serveur (liste des opérations).'
      messageType.value = 'error'
    }
  } catch {
    message.value = 'Impossible de charger les opérations.'
    messageType.value = 'error'
  } finally {
    loading.value = false
  }
}

async function refreshItems() {
  searchQuery.value = ''
  serviceFilterId.value = ''
  await loadItems()
}

function buildOperationPayload() {
  const surgeonPercent = Number(newItem.value.surgeonPercent)
  const anesthesiologistPercent = newItem.value.withAnesthesiologist
    ? Number(newItem.value.anesthesiologistPercent)
    : 0

  const hasSurgeon =
    surgeonInputMode.value === 'select'
      ? Boolean(newItem.value.surgeonId)
      : Boolean(newItem.value.surgeonName.trim())

  if (
    !newItem.value.label.trim() ||
    !newItem.value.totalCostFcfa ||
    !newItem.value.clinicServiceId.trim() ||
    !newItem.value.surgeonPercent ||
    !hasSurgeon
  ) {
    return {
      error:
        surgeonInputMode.value === 'select'
          ? 'Libellé, service, coût, médecin chirurgien (liste) et % chirurgien sont obligatoires.'
          : 'Libellé, service, coût, nom du chirurgien (saisie libre) et % chirurgien sont obligatoires.',
    }
  }

  if (newItem.value.withAnesthesiologist) {
    const hasAssistant =
      assistantInputMode.value === 'select'
        ? Boolean(newItem.value.anesthesiologistId)
        : Boolean(newItem.value.anesthesiologistName.trim())

    if (!hasAssistant || !newItem.value.anesthesiologistPercent) {
      return {
        error:
          assistantInputMode.value === 'select'
            ? 'Sélectionnez un assistant chirurgie (liste) et son pourcentage.'
            : 'Saisissez le nom de l\'assistant chirurgie et son pourcentage.',
      }
    }
  }

  const percentError = validateInterventionPercents(surgeonPercent, anesthesiologistPercent)
  if (percentError) {
    return { error: percentError }
  }

  return {
    payload: {
      label: newItem.value.label.trim(),
      category: newItem.value.category || 'MOYENNE_B',
      totalCostFcfa: Number(newItem.value.totalCostFcfa),
      clinicServiceId: newItem.value.clinicServiceId.trim() || null,
      surgeonId: surgeonInputMode.value === 'select' ? newItem.value.surgeonId : null,
      surgeonName: surgeonInputMode.value === 'custom' ? newItem.value.surgeonName.trim() : null,
      anesthesiologistId:
        newItem.value.withAnesthesiologist && assistantInputMode.value === 'select'
          ? newItem.value.anesthesiologistId
          : null,
      anesthesiologistName:
        newItem.value.withAnesthesiologist && assistantInputMode.value === 'custom'
          ? newItem.value.anesthesiologistName.trim()
          : null,
      surgeonPercent,
      anesthesiologistPercent,
      surgeonIds:
        surgeonInputMode.value === 'select'
          ? [
              ...new Set([
                ...newItem.value.surgeonIds,
                ...(newItem.value.surgeonId ? [newItem.value.surgeonId] : []),
              ]),
            ]
          : newItem.value.surgeonIds,
    },
  }
}

async function saveItem() {
  const built = buildOperationPayload()
  if ('error' in built && built.error) {
    message.value = built.error
    messageType.value = 'error'
    return
  }
  if (!('payload' in built) || !built.payload) return

  const editing = editingId.value
  saving.value = true
  message.value = ''
  try {
    if (editing) {
      const { data } = await api.put<InterventionItem>(
        `/comptabilite/exam-types/operations/${editing}`,
        built.payload,
      )
      items.value = items.value.map((item) => (item.id === data.id ? data : item))
      message.value = 'Opération mise à jour.'
    } else {
      const { data } = await api.post<InterventionItem>(
        '/comptabilite/exam-types/operations',
        built.payload,
      )
      items.value = [data, ...items.value.filter((item) => item.id !== data.id)]
      message.value = 'Opération ajoutée à la nomenclature.'
    }
    messageType.value = 'success'
    invalidateExamCatalogCache()
    closeAddModal()
    searchQuery.value = ''
    await loadItems()
  } catch (error: unknown) {
    const shown = await showDuplicateModalFromError(error)
    if (shown) return

    const apiMessage =
      error && typeof error === 'object' && 'response' in error
        ? (error as { response?: { data?: { error?: string } } }).response?.data?.error
        : undefined
      message.value =
        apiMessage ??
        (editing
          ? 'Mise à jour impossible. Vérifiez le libellé et les montants.'
          : 'Ajout impossible. Vérifiez le libellé et les montants.')
    messageType.value = 'error'
  } finally {
    saving.value = false
  }
}

async function toggleItem(id: string) {
  const item = itemsById.value.get(id)
  if (!item) return
  message.value = ''
  try {
    await api.put(`/comptabilite/exam-types/operations/${id}`, { active: !item.active })
    message.value = item.active ? 'Opération désactivée.' : 'Opération réactivée.'
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
    title: "Supprimer l'opération",
    message: translateTemplate(
      "Supprimer définitivement l'opération « {name} » ? Cette action est irréversible.",
      { name: item.label },
    ),
    confirmLabel: 'Supprimer',
  })
  if (!confirmed) return

  message.value = ''
  try {
    await api.delete(`/comptabilite/exam-types/operations/${id}`)
    message.value = 'Opération supprimée.'
    messageType.value = 'success'
    invalidateExamCatalogCache()
    await loadItems()
  } catch (error: unknown) {
    const apiMessage =
      error && typeof error === 'object' && 'response' in error
        ? (error as { response?: { data?: { error?: string } } }).response?.data?.error
        : undefined
    message.value =
      apiMessage ?? 'Suppression impossible. L\'opération a peut-être déjà été utilisée.'
    messageType.value = 'error'
  }
}

function openViewModal(id: string) {
  viewingItem.value = itemsById.value.get(id) ?? null
  if (!viewingItem.value) return
  viewModalOpen.value = true
}

function closeViewModal() {
  viewModalOpen.value = false
  viewingItem.value = null
}

function editFromViewModal() {
  const id = viewingItem.value?.id
  if (!id) return
  closeViewModal()
  openEditModal(id)
}

function onTableAction({ action, id }: { action: string; id: string }) {
  if (action === 'view') openViewModal(id)
  if (action === 'edit') openEditModal(id)
  if (action === 'toggle') toggleItem(id)
  if (action === 'delete') deleteItem(id)
}

onMounted(async () => {
  await Promise.all([loadDoctors(), loadClinicServices(), loadItems()])
})
</script>

<template>
  <div>
    <UiPageHeader :title="config.title" :subtitle="config.subtitle" :icon="config.icon" />

    <UiAlert v-if="message && !showAddModal && !viewModalOpen" :type="messageType" :message="message" />

      <UiCard
      title="Types opérations"
      description="Tarifs, service, médecins et répartition — gestion des types d’opération"
      :icon="config.icon"
      :icon-variant="config.iconVariant"
      class="section"
    >
      <template #actions>
        <UiButton variant="primary" size="sm" :icon="Plus" @click="openAddModal">
          {{ uiText(addButtonLabel) }}
        </UiButton>
        <UiButton variant="ghost" size="sm" :icon="RefreshCw" :disabled="loading" @click="refreshItems">
          Actualiser
        </UiButton>
        <span class="list-count">{{ operationCountLabel }}</span>
      </template>

      <div class="catalog-filters">
        <div class="catalog-filters__service">
          <UiSelect v-model="serviceFilterId" label="Service">
            <option value="">Tous les services ({{ items.length }})</option>
            <option v-for="service in filterServices" :key="service.id" :value="service.id">
              {{ service.name }} ({{ service.count }})
            </option>
          </UiSelect>
          <span class="catalog-filters__count" :title="serviceFilterCountLabel">
            {{ selectedServiceCount }}
          </span>
        </div>
        <UiInput
          v-model="searchQuery"
          label="Rechercher"
          placeholder="Libellé ou chirurgien…"
        />
      </div>

      <div class="table-panel-scroll">
        <div class="simple-table-shell simple-table-shell--static">
          <div
            v-if="loading"
            class="simple-table-overlay" role="status"
            aria-live="polite"
          >
            <span class="simple-table-spinner" aria-hidden="true" />
            Chargement des opérations…
          </div>
          <div class="simple-table-scroll">
            <div class="simple-table-wrap">
              <table class="simple-table">
                <thead>
                  <tr>
                    <th class="simple-table__num">#</th>
                    <th>Libellé</th>
                    <th>Service</th>
                    <th>Coût</th>
                    <th>% Chir.</th>
                    <th>% Ass.</th>
                    <th>% Clin.</th>
                    <th>Statut</th>
                    <th class="simple-table__actions-head">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(row, index) in tableRows" :key="row.id">
                    <td class="simple-table__num">{{ index + 1 }}</td>
                    <td>
                      <span class="st-name">{{ row.label }}</span>
                      <span class="st-muted">{{ row.medecins }}</span>
                    </td>
                    <td>{{ row.service }}</td>
                    <td><span class="st-amount">{{ row.cost }}</span></td>
                    <td>{{ row.surgeonPercent }}</td>
                    <td>{{ row.anesthesiologistPercent }}</td>
                    <td>{{ row.clinicPercent }}</td>
                    <td>
                      <span class="st-badge" :class="`st-badge--${row.statusVariant}`">{{ row.statusLabel }}</span>
                    </td>
                    <td class="simple-table__actions">
                      <StCatalogActions
                        :id="row.id"
                        :is-active="row.isActive"
                        :toggle-label="row.toggleLabel"
                        :show-view="true"
                        :can-delete="true"
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
      v-if="viewModalOpen && viewingItem"
      title-id="operation-view-title"
      title="Détail de l'opération"
      :subtitle="viewingItem.label"
      :icon="Eye"
      @close="closeViewModal"
    >
      <dl class="operation-detail">
        <div class="operation-detail__row">
          <dt>Libellé</dt>
          <dd>{{ viewingItem.label }}</dd>
        </div>
        <div class="operation-detail__row">
          <dt>Service</dt>
          <dd>{{ viewingServiceLabel }}</dd>
        </div>
        <div class="operation-detail__row">
          <dt>Coût total</dt>
          <dd class="operation-detail__amount">{{ formatFcfa(viewingItem.totalCostFcfa) }}</dd>
        </div>
        <div class="operation-detail__row">
          <dt>Chirurgien</dt>
          <dd>{{ viewingSurgeonLabel }}</dd>
        </div>
        <div class="operation-detail__row">
          <dt>Assistant chirurgie</dt>
          <dd>{{ viewingAnesthesiologistLabel }}</dd>
        </div>
        <div class="operation-detail__row">
          <dt>% Chirurgien</dt>
          <dd>{{ viewingItem.surgeonPercent }}%</dd>
        </div>
        <div class="operation-detail__row">
          <dt>% Assistant chirurgie</dt>
          <dd>{{ viewingItem.anesthesiologistPercent > 0 ? `${viewingItem.anesthesiologistPercent}%` : '—' }}</dd>
        </div>
        <div class="operation-detail__row">
          <dt>% Clinique</dt>
          <dd>{{ viewingItem.clinicPercent }}%</dd>
        </div>
        <div class="operation-detail__row">
          <dt>Statut</dt>
          <dd>{{ viewingItem.active ? uiText('Actif') : uiText('Inactif') }}</dd>
        </div>
      </dl>
      <template #footer>
        <UiButton variant="ghost" @click="closeViewModal">Fermer</UiButton>
        <UiButton variant="primary" :icon="Pencil" @click="editFromViewModal">
          Modifier
        </UiButton>
      </template>
    </UiFormModal>

    <UiFormModal
      v-if="showAddModal"
      title-id="operation-form-title"
      :title="formModalTitle"
      :subtitle="formModalSubtitle"
      :icon="isEditing ? Pencil : config.icon"
      size="wide"
      @close="closeAddModal"
    >
      <UiAlert v-if="message && showAddModal" :type="messageType" :message="message" />
      <section class="form-panel">
        <div class="form-grid-2">
          <UiInput v-model="newItem.label" label="Libellé" placeholder="Chirurgie moyenne" />
          <UiSelect v-model="newItem.clinicServiceId" label="Service" required>
            <option value="">— Sélectionner un service —</option>
            <option v-for="service in clinicServices" :key="service.id" :value="service.id">
              {{ service.name }}
            </option>
          </UiSelect>
          <UiInput v-model="newItem.totalCostFcfa" label="Coût (FCFA)" type="number" min="1" />
        </div>
        <p v-if="clinicServices.length === 0" class="form-panel__hint form-panel__hint--warn">
          Aucun service disponible. Créez d’abord un service dans Paramètres → Services.
        </p>
      </section>

      <section class="form-panel form-panel--accent medecin-section">
              <p class="section-label">Médecins</p>
              <div class="role-tabs" role="tablist" aria-label="Rôle du médecin">
                <button
                  type="button"
                  class="role-tab"
                  :class="{ 'role-tab--active': medecinRole === 'surgeon' }"
                  @click="medecinRole = 'surgeon'"
                >
                  <Stethoscope :size="15" />
                  Chirurgien
                </button>
                <button
                  type="button"
                  class="role-tab"
                  :class="{ 'role-tab--active': medecinRole === 'anesthesiologist' }"
                  @click="medecinRole = 'anesthesiologist'; newItem.withAnesthesiologist = true"
                >
                  <Syringe :size="15" />
                  Assistant chirurgie
                </button>
              </div>

              <div v-if="medecinRole === 'surgeon'" class="surgeon-fields">
                <div class="surgeon-mode" role="tablist" aria-label="Mode de saisie chirurgien">
                  <button
                    type="button"
                    class="surgeon-mode__btn"
                    :class="{ 'surgeon-mode__btn--active': surgeonInputMode === 'select' }"
                    @click="onSurgeonInputModeChange('select')"
                  >
                    Médecin enregistré
                  </button>
                  <button
                    type="button"
                    class="surgeon-mode__btn"
                    :class="{ 'surgeon-mode__btn--active': surgeonInputMode === 'custom' }"
                    @click="onSurgeonInputModeChange('custom')"
                  >
                    Autre (saisie libre)
                  </button>
                </div>
                <div class="form-grid">
                  <UiSelect
                    v-if="surgeonInputMode === 'select'"
                    v-model="newItem.surgeonId"
                    label="Médecin chirurgien"
                    @update:model-value="onPrimarySurgeonChange"
                  >
                    <option value="">— Sélectionner —</option>
                    <option v-for="doctor in doctors" :key="doctor.id" :value="doctor.id">
                      Dr {{ fullName(doctor.firstName, doctor.lastName) }}
                    </option>
                  </UiSelect>
                  <UiInput
                    v-else
                    v-model="newItem.surgeonName"
                    label="Médecin chirurgien"
                    placeholder="Ex. Dr Martin Dupont"
                  />
                  <UiInput
                    v-model="newItem.surgeonPercent"
                    label="% Chirurgien"
                    type="number"
                    min="1"
                    max="99"
                  />
                </div>
                <fieldset v-if="surgeonInputMode === 'select'" class="surgeons-fieldset">
                  <legend>Chirurgiens autorisés</legend>
                  <p class="hint">
                    Cochez les médecins qui pourront utiliser cette opération (en plus du chirurgien principal).
                  </p>
                  <label
                    v-for="doctor in doctors"
                    :key="`auth-${doctor.id}`"
                    class="surgeon-check"
                  >
                    <input
                      type="checkbox"
                      :checked="newItem.surgeonIds.includes(doctor.id)"
                      @change="toggleAuthorizedSurgeon(doctor.id)"
                    />
                    Dr {{ fullName(doctor.firstName, doctor.lastName) }}
                  </label>
                </fieldset>
              </div>

              <div v-else class="assistant-fields">
                <label class="checkbox-row">
                  <input
                    type="checkbox"
                    :checked="newItem.withAnesthesiologist"
                    @change="onWithAnesthesiologistChange(($event.target as HTMLInputElement).checked)"
                  />
                  <span>Inclure un assistant chirurgie pour cette opération</span>
                </label>
                <template v-if="newItem.withAnesthesiologist">
                  <div class="surgeon-mode" role="tablist" aria-label="Mode de saisie assistant chirurgie">
                    <button
                      type="button"
                      class="surgeon-mode__btn"
                      :class="{ 'surgeon-mode__btn--active': assistantInputMode === 'select' }"
                      @click="onAssistantInputModeChange('select')"
                    >
                      Médecin enregistré
                    </button>
                    <button
                      type="button"
                      class="surgeon-mode__btn"
                      :class="{ 'surgeon-mode__btn--active': assistantInputMode === 'custom' }"
                      @click="onAssistantInputModeChange('custom')"
                    >
                      Autre (saisie libre)
                    </button>
                  </div>
                  <div class="form-grid">
                    <UiSelect
                      v-if="assistantInputMode === 'select'"
                      v-model="newItem.anesthesiologistId"
                      label="Assistant chirurgie"
                    >
                      <option value="">— Sélectionner —</option>
                      <option
                        v-for="doctor in doctors"
                        :key="`assistant-${doctor.id}`"
                        :value="doctor.id"
                      >
                        Dr {{ fullName(doctor.firstName, doctor.lastName) }}
                      </option>
                    </UiSelect>
                    <UiInput
                      v-else
                      v-model="newItem.anesthesiologistName"
                      label="Assistant chirurgie"
                      placeholder="Ex. Dr Amadou Ba"
                    />
                    <UiInput
                      v-model="newItem.anesthesiologistPercent"
                      label="% Assistant chirurgie"
                      type="number"
                      min="1"
                      max="99"
                    />
                  </div>
                </template>
              </div>
      </section>

      <div class="split-summary" :class="{ 'split-summary--invalid': !splitPreviewValid }">
        <div>
          <span>% Chirurgien</span>
          <strong>{{ surgeonPercentValue || 0 }}%</strong>
        </div>
        <div>
          <span>% Assistant chirurgie</span>
          <strong>{{ anesthesiologistPercentValue }}%</strong>
        </div>
        <div>
          <span>% Clinique</span>
          <strong>{{ clinicPercentPreview }}%</strong>
        </div>
      </div>

      <template #footer>
        <UiButton variant="ghost" @click="closeAddModal">Annuler</UiButton>
        <UiButton
          variant="primary"
          :icon="isEditing ? Pencil : Plus"
          :disabled="saving || !splitPreviewValid"
          @click="saveItem"
        >
          {{ isEditing ? 'Enregistrer les modifications' : 'Enregistrer' }}
        </UiButton>
      </template>
    </UiFormModal>
  </div>
</template>

<style scoped>
.section {
  margin-top: 1rem;
}

.form-panel__hint {
  margin: 0.35rem 0 0;
  font-size: 0.8125rem;
  color: var(--text-muted);
}

.form-panel__hint--warn {
  color: #b45309;
}

.list-count {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-muted);
  white-space: nowrap;
}

.table-panel-scroll {
  overflow: auto;
  max-height: min(70dvh, 720px);
}

.table-panel-scroll :deep(.simple-table-shell),
.table-panel-scroll :deep(.simple-table-scroll) {
  display: block;
  flex: none;
  height: auto;
  max-height: none;
  min-height: unset;
  overflow: visible;
}

.catalog-filters {
  display: grid;
  grid-template-columns: minmax(14rem, 1.1fr) minmax(14rem, 1.4fr);
  gap: 0.75rem;
  margin-bottom: 0.85rem;
  align-items: end;
}

.catalog-filters__service {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.55rem;
  align-items: end;
}

.catalog-filters__count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 2.5rem;
  height: 2.45rem;
  margin-bottom: 1rem;
  padding: 0 0.65rem;
  border-radius: 999px;
  background: var(--primary-50, #eff6ff);
  border: 1px solid var(--primary-100, #dbeafe);
  color: var(--primary-800, #1e3a5f);
  font-size: 0.875rem;
  font-weight: 700;
  line-height: 1;
}

@media (max-width: 720px) {
  .catalog-filters {
    grid-template-columns: 1fr;
  }
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
  gap: 0.75rem;
}

.medecin-section {
  margin-top: 0;
  padding-top: 0;
  border-top: none;
}

.section-label {
  margin: 0 0 0.65rem;
  font-size: 0.8125rem;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.role-tabs {
  display: inline-flex;
  gap: 0.35rem;
  margin-bottom: 0.85rem;
  padding: 0.2rem;
  border-radius: 10px;
  background: var(--surface-muted, #f1f5f9);
}

.role-tab {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.45rem 0.75rem;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-muted);
  font-family: inherit;
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.role-tab--active {
  background: #fff;
  color: var(--primary-800);
  box-shadow: 0 1px 4px rgba(15, 23, 42, 0.08);
}

.surgeon-fields {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.assistant-fields {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.surgeon-mode {
  display: inline-flex;
  gap: 0.35rem;
  padding: 0.2rem;
  border-radius: 10px;
  background: var(--surface-muted, #f1f5f9);
}

.surgeon-mode__btn {
  padding: 0.4rem 0.7rem;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-muted);
  font-family: inherit;
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.surgeon-mode__btn--active {
  background: #fff;
  color: var(--primary-800);
  box-shadow: 0 1px 4px rgba(15, 23, 42, 0.08);
}

.checkbox-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  grid-column: 1 / -1;
  font-size: 0.875rem;
  color: var(--text);
  cursor: pointer;
}

.split-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.65rem;
  margin-top: 1rem;
  padding: 0.85rem;
  border-radius: 10px;
  background: var(--primary-50);
  border: 1px solid var(--primary-100);
}

.split-summary--invalid {
  background: #fef2f2;
  border-color: #fecaca;
}

.split-summary div {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  font-size: 0.8125rem;
}

.split-summary span {
  color: var(--text-muted);
}

.split-summary strong {
  font-size: 1rem;
  color: var(--primary-900);
}

.operation-detail {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin: 0;
}

.operation-detail__row {
  display: grid;
  grid-template-columns: 10rem 1fr;
  gap: 0.5rem 1rem;
  align-items: baseline;
}

.operation-detail__row dt {
  margin: 0;
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}

.operation-detail__row dd {
  margin: 0;
  font-size: 0.9375rem;
  color: var(--text);
}

.operation-detail__amount {
  font-weight: 700;
  color: var(--primary-800);
}

.surgeons-fieldset {
  margin: 0.75rem 0 0;
  padding: 0.75rem 0.85rem;
  border: 1px solid rgba(15, 40, 80, 0.12);
  border-radius: 10px;
}

.surgeons-fieldset legend {
  padding: 0 0.35rem;
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}

.surgeons-fieldset .hint {
  margin: 0 0 0.4rem;
  font-size: 0.8125rem;
  color: var(--text-muted);
}

.surgeon-check {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  margin-top: 0.35rem;
  font-size: 0.875rem;
  cursor: pointer;
}
</style>
