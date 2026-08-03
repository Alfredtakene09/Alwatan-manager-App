<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Plus, RefreshCw, Save, Stethoscope } from '@lucide/vue'
import api from '@/api/client'
import { confirmAppModal, showDuplicateModalFromError } from '@/lib/api-modal-helper'
import { formatFcfa } from '@/lib/roles'
import { statusBadge, catalogRowActionsHtml } from '@/lib/datatable-defaults'
import { clinicPercentFromSplits, validateInterventionPercents } from '@/lib/intervention-splits'
import { invalidateExamCatalogCache } from '@/lib/exam-catalog'
import { useAppI18n } from '@/i18n/useAppI18n'
import { translateTemplate } from '@/lib/dashboard-i18n'
import UiCard from '@/components/ui/UiCard.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiFormModal from '@/components/ui/UiFormModal.vue'
import UiDataTable from '@/components/ui/UiDataTable.vue'

type Category = 'MAJEURE_A' | 'MOYENNE_B' | 'PETITE_C'

type InterventionItem = {
  id: string
  code: string
  label: string
  category: Category
  totalCostFcfa: number
  surgeonPercent: number
  anesthesiologistPercent: number
  clinicPercent: number
  anesthesiologistId?: string | null
  anesthesiologistName?: string | null
  anesthesiologist?: { id: string; firstName: string; lastName: string } | null
  clinicService?: { id: string; name: string } | null
  active: boolean
}

type DoctorOption = {
  id: string
  firstName: string
  lastName: string
}

type ServiceInfo = {
  clinicServiceId: string
  clinicServiceName: string
}

const CATEGORY_OPTIONS: { value: Category; label: string }[] = [
  { value: 'MAJEURE_A', label: 'Majeure (A)' },
  { value: 'MOYENNE_B', label: 'Moyenne (B)' },
  { value: 'PETITE_C', label: 'Petite (C)' },
]

const props = defineProps<{
  serviceInfo: ServiceInfo | null
}>()

const { uiText, localeCode } = useAppI18n()

const items = ref<InterventionItem[]>([])
const doctors = ref<DoctorOption[]>([])
const loading = ref(false)
const saving = ref(false)
const message = ref('')
const messageType = ref<'success' | 'error'>('success')
const showAddModal = ref(false)
const editingId = ref<string | null>(null)
const searchQuery = ref('')

type AssistantInputMode = 'select' | 'custom'

const emptyForm = () => ({
  label: '',
  category: 'MOYENNE_B' as Category,
  totalCostFcfa: '',
  surgeonPercent: '70',
  withAssistant: false,
  anesthesiologistPercent: '10',
  anesthesiologistId: '',
  anesthesiologistName: '',
  assistantInputMode: 'select' as AssistantInputMode,
})

const newItem = ref(emptyForm())
const editForm = ref(emptyForm())

const serviceName = computed(() => props.serviceInfo?.clinicServiceName || uiText('Mon service'))
const itemsById = computed(() => new Map(items.value.map((item) => [item.id, item])))

function doctorLabel(doctor: DoctorOption) {
  return `Dr ${doctor.firstName} ${doctor.lastName}`.trim()
}

function assistantDisplay(item: InterventionItem) {
  if (item.anesthesiologistPercent <= 0) return uiText('Sans assistant')
  if (item.anesthesiologist) {
    return doctorLabel(item.anesthesiologist)
  }
  return item.anesthesiologistName?.trim() || uiText('Assistant chirurgie')
}

const filteredItems = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  return items.value
    .filter((item) => {
      if (!q) return true
      return [item.label, item.code, categoryLabel(item.category)].join(' ').toLowerCase().includes(q)
    })
    .slice()
    .sort((a, b) => a.label.localeCompare(b.label, 'fr', { sensitivity: 'base' }))
})

const operationCountLabel = computed(() =>
  translateTemplate('{n} opération(s)', { n: filteredItems.value.length }),
)

function categoryLabel(category: Category) {
  return CATEGORY_OPTIONS.find((opt) => opt.value === category)?.label ?? category
}

const tableRows = computed(() => {
  localeCode.value
  return filteredItems.value.map((item) => ({
    id: item.id,
    label: uiText(item.label),
    code: item.code,
    category: uiText(categoryLabel(item.category)),
    price: formatFcfa(item.totalCostFcfa),
    priceSort: item.totalCostFcfa,
    splits: `${item.surgeonPercent}% / ${item.anesthesiologistPercent}% / ${item.clinicPercent}%`,
    assistant: assistantDisplay(item),
    statusLabel: item.active ? uiText('Actif') : uiText('Inactif'),
    statusVariant: item.active ? 'success' : 'danger',
    toggleLabel: item.active ? uiText('Désactiver') : uiText('Activer'),
    isActive: item.active,
  }))
})

const columns = [
  { data: 'label', title: 'Libellé', render: (v: string) => `<span class="dt-name">${v}</span>` },
  { data: 'code', title: 'Code' },
  { data: 'category', title: 'Catégorie' },
  {
    data: 'priceSort',
    title: 'Coût total',
    render: (_d: number, _t: string, row: { price: string }) =>
      `<span class="dt-amount">${row.price}</span>`,
  },
  { data: 'splits', title: 'Chirurgien / Assist. / Clinique' },
  { data: 'assistant', title: 'Assistant' },
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
    className: 'dt-actions-col dt-actions-col--catalog',
    render: (_d: unknown, _t: string, row: { id: string; toggleLabel: string }) =>
      catalogRowActionsHtml(row),
  },
]

function resetMessages() {
  message.value = ''
}

async function loadDoctors() {
  try {
    const { data } = await api.get<DoctorOption[]>('/consultation/operation-types/doctors')
    doctors.value = Array.isArray(data) ? data : []
  } catch {
    doctors.value = []
  }
}

async function loadItems() {
  loading.value = true
  resetMessages()
  try {
    const { data } = await api.get<InterventionItem[]>('/consultation/operation-types')
    items.value = Array.isArray(data) ? data : []
  } catch (error: unknown) {
    const err = error as { response?: { data?: { error?: string } } }
    message.value =
      err.response?.data?.error || uiText('Impossible de charger les types d’opération.')
    messageType.value = 'error'
    items.value = []
  } finally {
    loading.value = false
  }
}

function openAddModal() {
  newItem.value = emptyForm()
  showAddModal.value = true
}

function closeAddModal() {
  showAddModal.value = false
  newItem.value = emptyForm()
}

function openEditModal(id: string) {
  const item = itemsById.value.get(id)
  if (!item) return
  editingId.value = id
  const hasAssistant = item.anesthesiologistPercent > 0
  const fromList = Boolean(item.anesthesiologistId)
  editForm.value = {
    label: item.label,
    category: item.category,
    totalCostFcfa: String(item.totalCostFcfa),
    surgeonPercent: String(item.surgeonPercent),
    withAssistant: hasAssistant,
    anesthesiologistPercent: String(item.anesthesiologistPercent || 10),
    anesthesiologistId: item.anesthesiologistId ?? '',
    anesthesiologistName: item.anesthesiologistName ?? '',
    assistantInputMode: fromList || !item.anesthesiologistName ? 'select' : 'custom',
  }
}

function closeEditModal() {
  editingId.value = null
  editForm.value = emptyForm()
}

function onAssistantModeChange(
  form: ReturnType<typeof emptyForm>,
  mode: AssistantInputMode,
) {
  form.assistantInputMode = mode
  if (mode === 'select') form.anesthesiologistName = ''
  else form.anesthesiologistId = ''
}

function buildPayload(form: ReturnType<typeof emptyForm>) {
  const surgeonPercent = Number(form.surgeonPercent)
  const anesthesiologistPercent = form.withAssistant ? Number(form.anesthesiologistPercent) : 0
  const percentError = validateInterventionPercents(surgeonPercent, anesthesiologistPercent)
  if (percentError) return { error: percentError }

  if (!form.label.trim() || !form.totalCostFcfa) {
    return { error: uiText('Libellé et coût total sont obligatoires.') }
  }
  if (form.withAssistant) {
    const hasDoctor = form.assistantInputMode === 'select' && form.anesthesiologistId
    const hasName = form.assistantInputMode === 'custom' && form.anesthesiologistName.trim().length >= 2
    if (!hasDoctor && !hasName) {
      return {
        error: uiText("Liez un médecin ou saisissez le nom de l'assistant chirurgie (2 caractères min.)."),
      }
    }
  }

  return {
    payload: {
      label: form.label.trim(),
      category: form.category,
      totalCostFcfa: Number(form.totalCostFcfa),
      surgeonPercent,
      anesthesiologistPercent,
      anesthesiologistId: form.withAssistant && form.assistantInputMode === 'select'
        ? form.anesthesiologistId || null
        : null,
      anesthesiologistName:
        form.withAssistant && form.assistantInputMode === 'custom'
          ? form.anesthesiologistName.trim()
          : null,
    },
  }
}

async function addItem() {
  const built = buildPayload(newItem.value)
  if ('error' in built && built.error) {
    message.value = built.error
    messageType.value = 'error'
    return
  }
  saving.value = true
  resetMessages()
  try {
    await api.post('/consultation/operation-types', built.payload)
    message.value = uiText('Opération ajoutée à votre nomenclature.')
    messageType.value = 'success'
    invalidateExamCatalogCache()
    closeAddModal()
    await loadItems()
  } catch (error) {
    const shown = await showDuplicateModalFromError(error)
    if (!shown) {
      const err = error as { response?: { data?: { error?: string } } }
      message.value = err.response?.data?.error || uiText('Ajout impossible.')
      messageType.value = 'error'
    }
  } finally {
    saving.value = false
  }
}

async function saveEdit() {
  if (!editingId.value) return
  const built = buildPayload(editForm.value)
  if ('error' in built && built.error) {
    message.value = built.error
    messageType.value = 'error'
    return
  }
  saving.value = true
  resetMessages()
  try {
    await api.put(`/consultation/operation-types/${editingId.value}`, built.payload)
    message.value = uiText('Opération mise à jour.')
    messageType.value = 'success'
    invalidateExamCatalogCache()
    closeEditModal()
    await loadItems()
  } catch (error) {
    const shown = await showDuplicateModalFromError(error)
    if (!shown) {
      const err = error as { response?: { data?: { error?: string } } }
      message.value = err.response?.data?.error || uiText('Mise à jour impossible.')
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
    await api.put(`/consultation/operation-types/${id}`, { active: !item.active })
    message.value = item.active
      ? uiText('Opération désactivée.')
      : uiText('Opération réactivée.')
    messageType.value = 'success'
    invalidateExamCatalogCache()
    await loadItems()
  } catch (error: unknown) {
    const err = error as { response?: { data?: { error?: string } } }
    message.value = err.response?.data?.error || uiText('Mise à jour impossible.')
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
    title: uiText("Supprimer l'opération"),
    message: translateTemplate('Supprimer « {name} » ?', { name: item.label }),
    confirmLabel: uiText('Supprimer'),
  })
  if (!ok) return
  saving.value = true
  resetMessages()
  try {
    await api.delete(`/consultation/operation-types/${id}`)
    message.value = uiText('Opération supprimée.')
    messageType.value = 'success'
    invalidateExamCatalogCache()
    await loadItems()
  } catch (error: unknown) {
    const err = error as { response?: { data?: { error?: string } } }
    message.value =
      err.response?.data?.error ||
      uiText('Suppression impossible. Désactivez plutôt si elle a déjà été utilisée.')
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

function clinicPercentPreview(form: ReturnType<typeof emptyForm>) {
  const surgeon = Number(form.surgeonPercent) || 0
  const assistant = form.withAssistant ? Number(form.anesthesiologistPercent) || 0 : 0
  return clinicPercentFromSplits(surgeon, assistant)
}

onMounted(() => {
  void Promise.all([loadItems(), loadDoctors()])
})
</script>

<template>
  <div>
    <UiAlert v-if="message" :type="messageType" :message="message" />

    <UiCard
      :title="uiText('Types d’opérations')"
      :description="
        translateTemplate('Opérations du service {service}', { service: serviceName })
      "
      :icon="Stethoscope"
      icon-variant="violet"
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
          {{ uiText('Ajouter une opération') }}
        </UiButton>
        <UiButton variant="ghost" size="sm" :icon="RefreshCw" :disabled="loading" @click="loadItems">
          {{ uiText('Actualiser') }}
        </UiButton>
        <span class="list-count">{{ operationCountLabel }}</span>
      </template>

      <div class="catalog-filters">
        <UiInput
          v-model="searchQuery"
          label="Rechercher"
          placeholder="Libellé, code, catégorie…"
        />
      </div>

      <div class="table-panel-scroll">
        <UiDataTable
          :table-key="`medecin-operation-types-${searchQuery}`"
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
      v-if="showAddModal"
      title-id="medecin-add-operation-title"
      :title="uiText('Ajouter une opération')"
      :subtitle="translateTemplate('Nouvelle opération — {service}', { service: serviceName })"
      :icon="Stethoscope"
      @close="closeAddModal"
    >
      <section class="form-panel">
        <p class="form-panel__hint">
          {{ uiText('Service') }}: <strong>{{ serviceName }}</strong>
          · {{ uiText('Chirurgien') }}: {{ uiText('vous (compte connecté)') }}
        </p>
        <div class="form-grid-2">
          <UiInput v-model="newItem.label" label="Libellé" placeholder="Ex. Appendicectomie" />
          <UiSelect v-model="newItem.category" label="Catégorie">
            <option v-for="opt in CATEGORY_OPTIONS" :key="opt.value" :value="opt.value">
              {{ uiText(opt.label) }}
            </option>
          </UiSelect>
          <UiInput v-model="newItem.totalCostFcfa" label="Coût total (FCFA)" type="number" min="1" />
          <UiInput v-model="newItem.surgeonPercent" label="% Chirurgien" type="number" min="1" max="99" />
        </div>
        <label class="assistant-toggle">
          <input v-model="newItem.withAssistant" type="checkbox" />
          {{ uiText('Avec assistant chirurgie') }}
        </label>
        <div v-if="newItem.withAssistant" class="assistant-block">
          <div class="assistant-mode" role="tablist">
            <button
              type="button"
              class="assistant-mode__btn"
              :class="{ 'assistant-mode__btn--active': newItem.assistantInputMode === 'select' }"
              @click="onAssistantModeChange(newItem, 'select')"
            >
              {{ uiText('Médecin enregistré') }}
            </button>
            <button
              type="button"
              class="assistant-mode__btn"
              :class="{ 'assistant-mode__btn--active': newItem.assistantInputMode === 'custom' }"
              @click="onAssistantModeChange(newItem, 'custom')"
            >
              {{ uiText('Autre (saisie libre)') }}
            </button>
          </div>
          <div class="form-grid-2">
            <UiSelect
              v-if="newItem.assistantInputMode === 'select'"
              v-model="newItem.anesthesiologistId"
              :label="uiText('Assistant chirurgie')"
            >
              <option value="">{{ uiText('— Sélectionner —') }}</option>
              <option v-for="doctor in doctors" :key="doctor.id" :value="doctor.id">
                {{ doctorLabel(doctor) }}
              </option>
            </UiSelect>
            <UiInput
              v-else
              v-model="newItem.anesthesiologistName"
              :label="uiText('Nom assistant chirurgie')"
              placeholder="Nom de l'assistant"
            />
            <UiInput
              v-model="newItem.anesthesiologistPercent"
              :label="uiText('% Assistant chirurgie')"
              type="number"
              min="1"
              max="99"
            />
          </div>
        </div>
        <p class="form-panel__hint">
          {{ uiText('Part clinique') }}:
          <strong>{{ clinicPercentPreview(newItem) }} %</strong>
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
      title-id="medecin-edit-operation-title"
      :title="uiText('Modifier l\'opération')"
      :subtitle="uiText('Mettre à jour le libellé, la catégorie, le coût ou les pourcentages')"
      :icon="Stethoscope"
      @close="closeEditModal"
    >
      <section class="form-panel">
        <div class="form-grid-2">
          <UiInput v-model="editForm.label" label="Libellé" />
          <UiSelect v-model="editForm.category" label="Catégorie">
            <option v-for="opt in CATEGORY_OPTIONS" :key="opt.value" :value="opt.value">
              {{ uiText(opt.label) }}
            </option>
          </UiSelect>
          <UiInput v-model="editForm.totalCostFcfa" label="Coût total (FCFA)" type="number" min="1" />
          <UiInput v-model="editForm.surgeonPercent" label="% Chirurgien" type="number" min="1" max="99" />
        </div>
        <label class="assistant-toggle">
          <input v-model="editForm.withAssistant" type="checkbox" />
          {{ uiText('Avec assistant chirurgie') }}
        </label>
        <div v-if="editForm.withAssistant" class="assistant-block">
          <div class="assistant-mode" role="tablist">
            <button
              type="button"
              class="assistant-mode__btn"
              :class="{ 'assistant-mode__btn--active': editForm.assistantInputMode === 'select' }"
              @click="onAssistantModeChange(editForm, 'select')"
            >
              {{ uiText('Médecin enregistré') }}
            </button>
            <button
              type="button"
              class="assistant-mode__btn"
              :class="{ 'assistant-mode__btn--active': editForm.assistantInputMode === 'custom' }"
              @click="onAssistantModeChange(editForm, 'custom')"
            >
              {{ uiText('Autre (saisie libre)') }}
            </button>
          </div>
          <div class="form-grid-2">
            <UiSelect
              v-if="editForm.assistantInputMode === 'select'"
              v-model="editForm.anesthesiologistId"
              :label="uiText('Assistant chirurgie')"
            >
              <option value="">{{ uiText('— Sélectionner —') }}</option>
              <option v-for="doctor in doctors" :key="doctor.id" :value="doctor.id">
                {{ doctorLabel(doctor) }}
              </option>
            </UiSelect>
            <UiInput
              v-else
              v-model="editForm.anesthesiologistName"
              :label="uiText('Nom assistant chirurgie')"
            />
            <UiInput
              v-model="editForm.anesthesiologistPercent"
              :label="uiText('% Assistant chirurgie')"
              type="number"
              min="1"
              max="99"
            />
          </div>
        </div>
        <p class="form-panel__hint">
          {{ uiText('Part clinique') }}:
          <strong>{{ clinicPercentPreview(editForm) }} %</strong>
        </p>
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
  margin-top: 0.25rem;
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
  grid-template-columns: minmax(0, 1fr);
  gap: 0.75rem;
  margin-bottom: 0.85rem;
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

.assistant-toggle {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  margin: 0.85rem 0;
  font-size: 0.875rem;
  font-weight: 600;
}

.assistant-block {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  margin-bottom: 0.35rem;
}

.assistant-mode {
  display: inline-flex;
  gap: 0.35rem;
  padding: 0.2rem;
  border-radius: 10px;
  background: rgba(15, 40, 80, 0.05);
}

.assistant-mode__btn {
  border: 0;
  background: transparent;
  border-radius: 8px;
  padding: 0.4rem 0.7rem;
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-muted);
  cursor: pointer;
}

.assistant-mode__btn--active {
  background: #fff;
  color: var(--text);
  box-shadow: 0 1px 3px rgba(15, 40, 80, 0.12);
}

@media (max-width: 720px) {
  .form-grid-2 {
    grid-template-columns: 1fr;
  }
}
</style>
