<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, CheckCircle2, FlaskConical, Printer, Save } from '@lucide/vue'
import api from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { fullName, ROLE_LABELS } from '@/lib/roles'
import { formatLabPrescribedExamsPreview, formatLabPrescribedExamsSummary } from '@/lib/lab-notes'
import { patientCategoryLabel, type PatientCategory } from '@/lib/patient-category'
import {
  emptyPanelValues,
  getLabFormPanel,
  LAB_FORM_PANELS,
  type LabPanelSlug,
} from '@/lib/lab-form-panels'
import { buildPrescribedByLabel, printLabPanelResult } from '@/lib/lab-panel-print'
import { fetchAndPrintLabVisitResults } from '@/lib/lab-visit-print'
import { panelFormHasValues } from '@/lib/lab-visit-search'
import { confirmAppModal } from '@/lib/api-modal-helper'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import type { LabsWaitingVisitRow } from '@/components/ui/LabsWaitingDataTable.vue'

type DossierResponse = {
  visit: LabsWaitingVisitRow
  panelResults: Partial<Record<LabPanelSlug, Record<string, string>>>
  completed?: boolean
}

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const visit = ref<LabsWaitingVisitRow | null>(null)
const panelResults = ref<DossierResponse['panelResults']>({})
const dossierCompleted = ref(false)
const selectedPanelSlug = ref('')
const activePanel = ref<LabPanelSlug | null>(null)
const formValues = reactive<Record<string, string>>({})
const loading = ref(false)
const saving = ref(false)
const completing = ref(false)
const printingAll = ref(false)
const message = ref('')
const messageType = ref<'success' | 'error'>('success')

const visitId = computed(() => String(route.params.visitId ?? ''))
const isEditMode = computed(() => route.query.from === 'termines' && route.query.edit === '1')
const isAddMode = computed(() => route.query.from === 'termines' && route.query.add === '1')
const isConsultMode = computed(
  () => route.query.from === 'termines' && !isEditMode.value && !isAddMode.value,
)
const backRouteName = computed(() => {
  if (route.query.from === 'termines') return 'laboratoire-termines'
  return 'laboratoire'
})
const activePanelConfig = computed(() => (activePanel.value ? getLabFormPanel(activePanel.value) : null))

const patientLabel = computed(() => {
  if (!visit.value) return ''
  return fullName(visit.value.patient.firstName, visit.value.patient.lastName)
})

const prescribedExamsPreview = computed(() =>
  formatLabPrescribedExamsPreview(visit.value?.consultation?.clinicalNotes),
)

const prescribedExamsFull = computed(() =>
  formatLabPrescribedExamsSummary(visit.value?.consultation?.clinicalNotes),
)

const doctorLabel = computed(() =>
  buildPrescribedByLabel(visit.value?.consultation?.doctor ?? visit.value?.assignedDoctor ?? null),
)

const validatorLabel = computed(() => {
  if (!auth.user) return 'Laboratoire'
  return `${fullName(auth.user.firstName, auth.user.lastName)} — ${ROLE_LABELS[auth.user.role]}`
})

function isPanelFilled(slug: LabPanelSlug) {
  const values = panelResults.value[slug]
  return !!values && panelFormHasValues(values)
}

const savedPanelCount = computed(
  () => LAB_FORM_PANELS.filter((panel) => isPanelFilled(panel.slug)).length,
)

const selectablePanels = computed(() => {
  if (isConsultMode.value || isEditMode.value) {
    return LAB_FORM_PANELS.filter((panel) => isPanelFilled(panel.slug))
  }
  return LAB_FORM_PANELS.filter((panel) => !isPanelFilled(panel.slug))
})

const isActivePanelReadOnly = computed(() => {
  if (isEditMode.value || isAddMode.value) return false
  if (isConsultMode.value) return true
  if (!activePanel.value) return true
  return isPanelFilled(activePanel.value)
})

function panelOptionLabel(slug: LabPanelSlug) {
  return getLabFormPanel(slug)?.label ?? slug
}

function isLabPanelSlug(value: string): value is LabPanelSlug {
  return LAB_FORM_PANELS.some((panel) => panel.slug === value)
}

function showMessage(text: string, type: 'success' | 'error' = 'success') {
  message.value = text
  messageType.value = type
}

function loadFormValues(slug: LabPanelSlug) {
  const panel = getLabFormPanel(slug)
  if (!panel) return
  const defaults = emptyPanelValues(panel)
  const saved = panelResults.value[slug] ?? {}
  Object.keys(formValues).forEach((key) => delete formValues[key])
  Object.assign(formValues, { ...defaults, ...saved })
}

function selectPanel(slug: LabPanelSlug | null) {
  activePanel.value = slug
  if (slug) loadFormValues(slug)
}

async function loadDossier() {
  loading.value = true
  message.value = ''
  try {
    const { data } = await api.get<DossierResponse>(`/laboratoire/visits/${visitId.value}`)
    visit.value = data.visit
    panelResults.value = data.panelResults
    dossierCompleted.value = !!data.completed
    if (activePanel.value) {
      selectedPanelSlug.value = activePanel.value
      loadFormValues(activePanel.value)
    }
  } catch {
    visit.value = null
    showMessage('Dossier laboratoire introuvable.', 'error')
  } finally {
    loading.value = false
  }
}

async function savePanel() {
  if (!activePanel.value || isActivePanelReadOnly.value) return
  if (!panelFormHasValues(formValues)) {
    showMessage('Remplissez au moins un résultat avant d\'enregistrer.', 'error')
    return
  }
  saving.value = true
  try {
    const { data } = await api.put<{ panelResults: DossierResponse['panelResults']; completed?: boolean }>(
      `/laboratoire/visits/${visitId.value}/panels/${activePanel.value}`,
      { values: { ...formValues } },
    )
    panelResults.value = data.panelResults
    dossierCompleted.value = !!data.completed
    if (isEditMode.value) {
      printPanel()
      showMessage('Formulaire modifié et envoyé à l\'impression.')
    } else {
      printPanel()
      const hasRemaining = LAB_FORM_PANELS.some((panel) => !isPanelFilled(panel.slug))
      showMessage(
        hasRemaining
          ? isAddMode.value
            ? 'Formulaire ajouté. Sélectionnez un autre type non saisi ou retournez à la liste.'
            : 'Formulaire enregistré. Sélectionnez le prochain type à compléter.'
          : 'Tous les formulaires sont enregistrés.',
      )
      selectedPanelSlug.value = ''
      activePanel.value = null
      if (isAddMode.value && !hasRemaining) {
        setTimeout(() => router.push({ name: 'laboratoire-termines' }), 1200)
      }
    }
  } catch {
    showMessage('Erreur lors de l\'enregistrement.', 'error')
  } finally {
    saving.value = false
  }
}

function goBack() {
  router.push({ name: backRouteName.value })
}

async function completeDossier() {
  if (!savedPanelCount.value || dossierCompleted.value) return
  const ok = await confirmAppModal({
    title: 'Clôturer le dossier',
    message:
      'Valider et transmettre les résultats au médecin ? Le dossier passera dans Examens terminés.',
    confirmLabel: 'Clôturer',
    variant: 'primary',
  })
  if (!ok) return

  completing.value = true
  try {
    await api.post(`/laboratoire/visits/${visitId.value}/complete`)
    dossierCompleted.value = true
    showMessage('Dossier clôturé — résultats transmis au médecin.')
    setTimeout(() => router.push({ name: 'laboratoire-termines' }), 1200)
  } catch {
    showMessage('Impossible de clôturer le dossier.', 'error')
  } finally {
    completing.value = false
  }
}

async function printAllDossier() {
  if (!visit.value || !savedPanelCount.value) return
  printingAll.value = true
  const result = await fetchAndPrintLabVisitResults(visit.value, auth.user, 'laboratoire')
  if (!result.ok) showMessage(result.error, 'error')
  printingAll.value = false
}

function printPanel() {
  if (!activePanel.value || !visit.value) return
  printLabPanelResult(activePanel.value, { ...formValues }, {
    patientName: patientLabel.value,
    patientCode: visit.value.patient.code,
    prescribedBy: doctorLabel.value,
    validatedBy: validatorLabel.value,
  })
}

watch(selectedPanelSlug, (slug) => {
  if (slug && isLabPanelSlug(slug)) {
    selectPanel(slug)
    return
  }
  selectPanel(null)
})

watch(selectablePanels, (panels) => {
  if (activePanel.value && !panels.some((panel) => panel.slug === activePanel.value)) {
    selectedPanelSlug.value = ''
    activePanel.value = null
  }
})

watch(
  () => [route.params.visitId, route.query.edit, route.query.add, route.query.from],
  () => {
    selectedPanelSlug.value = ''
    activePanel.value = null
    loadDossier()
  },
)

onMounted(loadDossier)
</script>

<template>
  <div class="lab-dossier">
    <UiPageHeader
      :title="patientLabel || 'Dossier laboratoire'"
      :subtitle="visit ? `${visit.patient.code} — ${prescribedExamsPreview}` : 'Chargement…'"
      :icon="FlaskConical"
    >
      <template #actions>
        <UiButton
          v-if="savedPanelCount && !isConsultMode && !dossierCompleted"
          variant="primary"
          size="sm"
          :icon="CheckCircle2"
          :disabled="completing"
          @click="completeDossier"
        >
          {{ completing ? 'Clôture…' : 'Clôturer le dossier' }}
        </UiButton>
        <UiButton
          v-if="savedPanelCount"
          variant="outline"
          size="sm"
          :icon="Printer"
          :disabled="printingAll"
          @click="printAllDossier"
        >
          {{ printingAll ? 'Impression…' : 'Imprimer tout le dossier' }}
        </UiButton>
        <UiButton variant="ghost" size="sm" :icon="ArrowLeft" @click="goBack">
          Retour
        </UiButton>
      </template>
    </UiPageHeader>

    <UiAlert v-if="message" :type="messageType" :message="message" />
    <UiAlert
      v-if="isEditMode && !loading"
      type="info"
      message="Mode modification — sélectionnez un formulaire enregistré, corrigez les valeurs puis enregistrez."
    />
    <UiAlert
      v-else-if="isAddMode && !loading && selectablePanels.length"
      type="info"
      message="Ajout de formulaire — seuls les types non encore saisis sont proposés."
    />
    <UiAlert
      v-else-if="isAddMode && !loading && !selectablePanels.length"
      type="warning"
      message="Tous les types de formulaire sont déjà saisis pour ce dossier."
    />
    <UiAlert
      v-else-if="isConsultMode && !loading"
      type="info"
      message="Consultation en lecture seule — utilisez Modifier depuis Examens terminés pour corriger un formulaire."
    />
    <UiAlert
      v-else-if="dossierCompleted && !loading && !isEditMode && !isAddMode && !isConsultMode && !selectablePanels.length"
      type="success"
      message="Tous les formulaires sont enregistrés. Le dossier est dans Examens terminés."
    />

    <p v-if="loading" class="hint">Chargement du dossier…</p>

    <template v-else-if="visit">
      <UiCard title="Informations patient" icon-variant="blue">
        <dl class="info-grid">
          <div>
            <dt>Matricule</dt>
            <dd>{{ visit.patient.code }}</dd>
          </div>
          <div>
            <dt>Catégorie</dt>
            <dd>{{ patientCategoryLabel((visit.patient.category ?? 'STANDARD') as PatientCategory) }}</dd>
          </div>
          <div>
            <dt>Médecin / Prescripteur</dt>
            <dd>{{ doctorLabel }}</dd>
          </div>
          <div>
            <dt>Examens laboratoire</dt>
            <dd :title="prescribedExamsFull">{{ prescribedExamsPreview }}</dd>
          </div>
          <div v-if="visit.consultation?.labSentToLabAt">
            <dt>Transféré le</dt>
            <dd>{{ new Date(visit.consultation.labSentToLabAt).toLocaleString('fr-FR') }}</dd>
          </div>
        </dl>
      </UiCard>

      <UiCard
        :title="
          isEditMode
            ? 'Modifier les formulaires'
            : isAddMode
              ? 'Ajouter un formulaire'
              : isConsultMode
                ? 'Consulter les formulaires'
                : 'Formulaires de résultats'
        "
        :description="
          isEditMode
            ? 'Sélectionnez un formulaire déjà enregistré pour corriger les résultats'
            : isAddMode
              ? 'Choisissez un type non saisi, remplissez les résultats puis enregistrez'
              : isConsultMode
                ? 'Sélectionnez un formulaire enregistré pour le consulter ou l\'imprimer'
                : 'Enregistrez le formulaire pour l\'imprimer — les types déjà remplis disparaissent de la liste'
        "
        icon-variant="teal"
        :icon="FlaskConical"
      >
        <UiSelect
          v-model="selectedPanelSlug"
          label="Type de formulaire"
          :required="false"
        >
          <option value="">
            {{
              selectablePanels.length
                ? '— Choisir un formulaire —'
                : isEditMode
                  ? '— Aucun formulaire enregistré —'
                  : isAddMode
                    ? '— Tous les types sont déjà saisis —'
                    : '— Tous les formulaires sont enregistrés —'
            }}
          </option>
          <option v-for="panel in selectablePanels" :key="panel.slug" :value="panel.slug">
            {{ panelOptionLabel(panel.slug) }}
          </option>
        </UiSelect>

        <p v-if="savedPanelCount && (isAddMode || (!isEditMode && !isConsultMode))" class="saved-hint">
          {{ savedPanelCount }} formulaire(s) déjà enregistré(s) — non proposés dans la liste.
        </p>
        <p
          v-else-if="!selectablePanels.length && !isEditMode && !isConsultMode && savedPanelCount"
          class="saved-hint saved-hint--completed"
        >
          Tous les types de formulaire disponibles ont été enregistrés.
        </p>

        <template v-if="activePanelConfig">
          <div class="form-divider" />

          <div v-for="section in activePanelConfig.sections" :key="section.title ?? 'main'" class="form-section">
            <h3 v-if="section.title" class="form-section__title">{{ section.title }}</h3>
            <div class="form-grid" :class="{ 'form-grid--routine': activePanel === 'routine' }">
              <template v-for="field in section.fields" :key="field.key">
                <UiInput
                  v-if="field.type !== 'textarea'"
                  v-model="formValues[field.key]"
                  :label="field.reference ? `${field.label} (${field.reference})` : field.label"
                  :placeholder="field.unit ? `Résultat ${field.unit}` : 'Résultat'"
                  :disabled="isActivePanelReadOnly"
                />
                <label v-else class="textarea-field">
                  <span class="textarea-field__label">{{ field.label }}</span>
                  <textarea v-model="formValues[field.key]" rows="3" :disabled="isActivePanelReadOnly" />
                </label>
              </template>
            </div>
          </div>

          <div class="form-actions">
            <UiButton
              v-if="isActivePanelReadOnly"
              variant="outline"
              :icon="Printer"
              :disabled="!activePanel"
              @click="printPanel"
            >
              Imprimer
            </UiButton>
            <UiButton
              v-else
              variant="primary"
              :icon="Save"
              :disabled="saving || !activePanel"
              @click="savePanel"
            >
              {{
                saving
                  ? 'Enregistrement…'
                  : isEditMode
                    ? 'Enregistrer les modifications'
                    : isAddMode
                      ? 'Ajouter et imprimer'
                      : 'Enregistrer et imprimer'
              }}
            </UiButton>
          </div>
        </template>
      </UiCard>
    </template>
  </div>
</template>

<style scoped>
.lab-dossier {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.hint {
  margin: 0;
  color: var(--text-muted);
}

.info-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem 1rem;
  margin: 0;
}

.info-grid dt {
  margin: 0 0 0.15rem;
  font-size: 0.75rem;
  color: var(--text-muted);
}

.info-grid dd {
  margin: 0;
  font-size: 0.875rem;
}

.saved-hint {
  margin: -0.35rem 0 0;
  font-size: 0.8125rem;
  color: #0f766e;
}

.saved-hint--completed {
  color: var(--text-muted);
}

.form-divider {
  margin: 1.25rem 0 1rem;
  border-top: 1px solid var(--border);
}

.form-section + .form-section {
  margin-top: 1.25rem;
  padding-top: 1.25rem;
  border-top: 1px solid var(--border);
}

.form-section__title {
  margin: 0 0 0.75rem;
  font-size: 0.875rem;
  color: var(--primary-700);
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.85rem;
}

.form-grid--routine {
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.65rem 0.75rem;
}

.form-grid--routine :deep(.ui-field__label) {
  font-size: 0.75rem;
  line-height: 1.25;
}

.form-grid--routine :deep(.ui-field__input) {
  padding: 0.5rem 0.6rem;
  font-size: 0.8125rem;
}

.textarea-field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  grid-column: 1 / -1;
}

.textarea-field__label {
  font-size: 0.8125rem;
  font-weight: 600;
}

.textarea-field textarea {
  width: 100%;
  padding: 0.65rem 0.75rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font: inherit;
  resize: vertical;
}

.textarea-field textarea:disabled {
  background: #f8fafc;
  color: var(--text-muted);
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 1.25rem;
}

@media (max-width: 1200px) {
  .form-grid--routine {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 900px) {
  .form-grid--routine {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 768px) {
  .info-grid,
  .form-grid,
  .form-grid--routine {
    grid-template-columns: 1fr;
  }
}
</style>
