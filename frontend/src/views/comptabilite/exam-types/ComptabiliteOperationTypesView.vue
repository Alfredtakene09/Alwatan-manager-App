<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Plus, RefreshCw, Stethoscope, Syringe, Eye, Pencil } from '@lucide/vue'
import api from '@/api/client'
import { confirmAppModal, showDuplicateModalFromError } from '@/lib/api-modal-helper'
import { formatFcfa, fullName } from '@/lib/roles'
import { statusBadge, catalogRowActionsHtml } from '@/lib/datatable-defaults'
import { clinicPercentFromSplits, validateInterventionPercents } from '@/lib/intervention-splits'
import { OPERATION_KIND_CONFIG } from '@/lib/exam-catalog-kinds'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiFormModal from '@/components/ui/UiFormModal.vue'
import UiDataTable from '@/components/ui/UiDataTable.vue'

type DoctorOption = {
  id: string
  firstName: string
  lastName: string
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
  surgeon?: DoctorOption | null
  anesthesiologist?: DoctorOption | null
  active: boolean
}

const config = OPERATION_KIND_CONFIG
const addButtonLabel = 'Ajout'
const items = ref<InterventionItem[]>([])
const doctors = ref<DoctorOption[]>([])
const loading = ref(false)
const saving = ref(false)
const message = ref('')
const messageType = ref<'success' | 'error'>('success')
const showAddModal = ref(false)
const editingId = ref<string | null>(null)
const viewModalOpen = ref(false)
const viewingItem = ref<InterventionItem | null>(null)
const medecinRole = ref<'surgeon' | 'anesthesiologist'>('surgeon')
const surgeonInputMode = ref<'select' | 'custom'>('select')
const assistantInputMode = ref<'select' | 'custom'>('select')

const newItem = ref({
  code: '',
  label: '',
  category: 'MAJEURE_A',
  totalCostFcfa: '',
  surgeonId: '',
  surgeonName: '',
  withAnesthesiologist: false,
  anesthesiologistId: '',
  anesthesiologistName: '',
  surgeonPercent: '',
  anesthesiologistPercent: '',
})

const CATEGORY_LABELS: Record<string, string> = {
  MAJEURE_A: 'Majeure (A)',
  MOYENNE_B: 'Moyenne (B)',
  PETITE_C: 'Petite (C)',
}

const itemsById = computed(() => new Map(items.value.map((item) => [item.id, item])))

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

const tableRows = computed(() =>
  items.value.map((item) => ({
    id: item.id,
    label: item.label,
    code: item.code,
    category: CATEGORY_LABELS[item.category] ?? item.category,
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
    statusLabel: item.active ? 'Actif' : 'Inactif',
    statusVariant: item.active ? 'success' : 'danger',
    toggleLabel: item.active ? 'Désactiver' : 'Activer',
    isActive: item.active,
  })),
)

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

const columns = [
  {
    data: 'label',
    title: 'Libellé',
    render: (v: string, _t: string, row: { medecins: string }) =>
      `<span class="dt-name">${v}</span><span class="dt-muted">${row.medecins}</span>`,
  },
  { data: 'code', title: 'Code' },
  { data: 'category', title: 'Catégorie' },
  {
    data: 'costSort',
    title: 'Coût',
    render: (_d: number, _t: string, row: { cost: string }) => `<span class="dt-amount">${row.cost}</span>`,
  },
  { data: 'surgeonPercent', title: '% Chirurgien' },
  { data: 'anesthesiologistPercent', title: '% Assistant chirurgie' },
  { data: 'clinicPercent', title: '% Clinique' },
  {
    data: 'statusLabel',
    title: 'Statut',
    render: (label: string, _t: string, row: { statusVariant: string }) =>
      statusBadge(label, row.statusVariant as 'success' | 'danger'),
  },
  {
    data: null,
    title: 'Actions',
    orderable: false,
    responsivePriority: 1,
    className: 'dt-actions-col dt-actions-col--catalog all',
    render: (_d: unknown, _t: string, row: { id: string; toggleLabel: string; isActive: boolean }) =>
      catalogRowActionsHtml({ ...row, showEdit: true, showView: true, canDelete: true }),
  },
]

const isEditing = computed(() => Boolean(editingId.value))
const formModalTitle = computed(() => (isEditing.value ? 'Modifier l\'opération' : addButtonLabel))
const formModalSubtitle = computed(() =>
  isEditing.value
    ? 'Mettre à jour les tarifs, médecins et répartitions'
    : 'Nouvelle opération avec répartition des honoraires',
)

function resetNewItemForm() {
  newItem.value = {
    code: '',
    label: '',
    category: 'MAJEURE_A',
    totalCostFcfa: '',
    surgeonId: '',
    surgeonName: '',
    withAnesthesiologist: false,
    anesthesiologistId: '',
    anesthesiologistName: '',
    surgeonPercent: '',
    anesthesiologistPercent: '',
  }
  medecinRole.value = 'surgeon'
  surgeonInputMode.value = 'select'
  assistantInputMode.value = 'select'
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
  const hasAssistant = item.anesthesiologistPercent > 0
  const surgeonFromList = Boolean(item.surgeonId)
  const assistantFromList = Boolean(item.anesthesiologistId)

  newItem.value = {
    code: item.code,
    label: item.label,
    category: item.category,
    totalCostFcfa: String(item.totalCostFcfa),
    surgeonId: item.surgeonId ?? '',
    surgeonName: item.surgeonName ?? '',
    withAnesthesiologist: hasAssistant,
    anesthesiologistId: item.anesthesiologistId ?? '',
    anesthesiologistName: item.anesthesiologistName ?? '',
    surgeonPercent: String(item.surgeonPercent),
    anesthesiologistPercent: hasAssistant ? String(item.anesthesiologistPercent) : '',
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

async function loadItems() {
  loading.value = true
  message.value = ''
  try {
    const { data } = await api.get<InterventionItem[]>('/comptabilite/exam-types/operations')
    items.value = data
  } catch {
    message.value = 'Impossible de charger les opérations.'
    messageType.value = 'error'
  } finally {
    loading.value = false
  }
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
    !newItem.value.code.trim() ||
    !newItem.value.label.trim() ||
    !newItem.value.totalCostFcfa ||
    !newItem.value.surgeonPercent ||
    !hasSurgeon
  ) {
    return {
      error:
        surgeonInputMode.value === 'select'
          ? 'Code, libellé, coût, médecin chirurgien (liste) et % chirurgien sont obligatoires.'
          : 'Code, libellé, coût, nom du chirurgien (saisie libre) et % chirurgien sont obligatoires.',
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
      code: newItem.value.code.trim(),
      label: newItem.value.label.trim(),
      category: newItem.value.category,
      totalCostFcfa: Number(newItem.value.totalCostFcfa),
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
      await api.put(`/comptabilite/exam-types/operations/${editing}`, built.payload)
      message.value = 'Opération mise à jour.'
    } else {
      await api.post('/comptabilite/exam-types/operations', built.payload)
      message.value = 'Opération ajoutée à la nomenclature.'
    }
    messageType.value = 'success'
    closeAddModal()
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
        ? 'Mise à jour impossible. Vérifiez le code et les montants.'
        : 'Ajout impossible. Vérifiez le code et les montants.')
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
    title: 'Supprimer l\'opération',
    message: `Supprimer définitivement l'opération « ${item.label} » ? Cette action est irréversible.`,
    confirmLabel: 'Supprimer',
  })
  if (!confirmed) return

  message.value = ''
  try {
    await api.delete(`/comptabilite/exam-types/operations/${id}`)
    message.value = 'Opération supprimée.'
    messageType.value = 'success'
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
  await Promise.all([loadDoctors(), loadItems()])
})
</script>

<template>
  <div>
    <UiPageHeader :title="config.title" :subtitle="config.subtitle" :icon="config.icon" />

    <UiAlert v-if="message && !showAddModal && !viewModalOpen" :type="messageType" :message="message" />

    <UiCard
      title="Nomenclature chirurgicale"
      description="Tarifs, médecins et répartition chirurgien / assistant chirurgie / clinique"
      :icon="config.icon"
      :icon-variant="config.iconVariant"
      class="section"
    >
      <template #actions>
        <UiButton variant="primary" size="sm" :icon="Plus" @click="openAddModal">
          {{ addButtonLabel }}
        </UiButton>
        <UiButton variant="ghost" size="sm" :icon="RefreshCw" :disabled="loading" @click="loadItems">
          Actualiser
        </UiButton>
        <span class="list-count">{{ items.length }} opération(s)</span>
      </template>

      <div class="table-panel-scroll">
        <UiDataTable
          table-key="exam-catalog-operations"
          compact
          :data="tableRows"
          :columns="columns"
          :loading="loading"
          loading-label="Chargement des opérations…"
          @action="onTableAction"
        />
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
          <dt>Code</dt>
          <dd>{{ viewingItem.code }}</dd>
        </div>
        <div class="operation-detail__row">
          <dt>Libellé</dt>
          <dd>{{ viewingItem.label }}</dd>
        </div>
        <div class="operation-detail__row">
          <dt>Catégorie</dt>
          <dd>{{ CATEGORY_LABELS[viewingItem.category] ?? viewingItem.category }}</dd>
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
          <dd>{{ viewingItem.active ? 'Actif' : 'Inactif' }}</dd>
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
      <section class="form-panel">
        <div class="form-grid-2">
          <UiInput v-model="newItem.code" label="Code" placeholder="CHIR-D" />
          <UiInput v-model="newItem.label" label="Libellé" placeholder="Chirurgie moyenne" />
          <UiSelect v-model="newItem.category" label="Catégorie">
            <option value="MAJEURE_A">Majeure (A)</option>
            <option value="MOYENNE_B">Moyenne (B)</option>
            <option value="PETITE_C">Petite (C)</option>
          </UiSelect>
          <UiInput v-model="newItem.totalCostFcfa" label="Coût (FCFA)" type="number" min="1" />
        </div>
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

.list-count {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-muted);
  white-space: nowrap;
}

.table-panel-scroll {
  overflow: auto;
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
</style>
