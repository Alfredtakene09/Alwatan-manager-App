<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, CheckCircle2, FlaskConical, Printer, Save } from '@lucide/vue'
import api from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { fullName } from '@/lib/roles'
import { formatLabPrescribedExamsPreview, formatLabPrescribedExamsSummary } from '@/lib/lab-notes'
import { patientCategoryLabel, type PatientCategory } from '@/lib/patient-category'
import {
  emptyPanelValues,
  getLabFormPanel,
  labFieldCommentKey,
  type LabFormField,
  type LabPanelSlug,
} from '@/lib/lab-form-panels'
import { useLabPanelsStore } from '@/stores/lab-panels'
import { buildPrescribedByLabel, printLabPanelResult, resolveLabReceptionist } from '@/lib/lab-panel-print'
import { panelFormHasValues } from '@/lib/lab-visit-search'
import { confirmAppModal } from '@/lib/api-modal-helper'
import { useAppI18n } from '@/i18n/useAppI18n'
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
const labPanels = useLabPanelsStore()
const { uiText, dateTimeText, numberText, roleLabel, localeCode } = useAppI18n()

const visit = ref<LabsWaitingVisitRow | null>(null)
const panelResults = ref<DossierResponse['panelResults']>({})
const dossierCompleted = ref(false)
const selectedPanelSlug = ref('')
const activePanel = ref<LabPanelSlug | null>(null)
const panelSearchQuery = ref('')
const formValues = reactive<Record<string, string>>({})
const loading = ref(false)
const saving = ref(false)
const completing = ref(false)
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
  buildPrescribedByLabel(
    visit.value?.consultation?.doctor ?? visit.value?.assignedDoctor ?? null,
    resolveLabReceptionist(visit.value),
  ),
)

const validatorLabel = computed(() => {
  if (!auth.user) return uiText('Laboratoire')
  return `${fullName(auth.user.firstName, auth.user.lastName)} — ${roleLabel(auth.user.role)}`
})

function isPanelFilled(slug: LabPanelSlug) {
  const values = panelResults.value[slug]
  return !!values && panelFormHasValues(values)
}

const savedPanelCount = computed(
  () => labPanels.panels.filter((panel) => isPanelFilled(panel.slug)).length,
)

const entryPanels = computed(() => labPanels.entryPanels)

function normalizeSearchText(value: string) {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()
}

/** Tous les formulaires actifs — saisie, consultation et modification. */
const listedPanels = computed(() => {
  void localeCode.value
  return entryPanels.value.slice().sort((a, b) =>
    uiText(a.label).localeCompare(uiText(b.label), localeCode.value, { sensitivity: 'base' }),
  )
})

/** Filtre rapide selon la langue affichée (libellé traduit). */
const selectablePanels = computed(() => {
  void localeCode.value
  const q = normalizeSearchText(panelSearchQuery.value)
  if (!q) return listedPanels.value
  return listedPanels.value.filter((panel) => {
    const label = normalizeSearchText(uiText(panel.label))
    const raw = normalizeSearchText(panel.label)
    const slug = normalizeSearchText(panel.slug)
    return label.includes(q) || raw.includes(q) || slug.includes(q)
  })
})

const isActivePanelReadOnly = computed(() => {
  if (isEditMode.value || isAddMode.value) return false
  if (isConsultMode.value) return true
  if (!activePanel.value) return true
  return isPanelFilled(activePanel.value)
})

function panelOptionLabel(slug: LabPanelSlug) {
  void localeCode.value
  const base = uiText(getLabFormPanel(slug)?.label ?? slug)
  if (isPanelFilled(slug)) {
    return `${base} (${uiText('Enregistré')})`
  }
  return base
}

function labFieldDisplayLabel(field: LabFormField) {
  const label = uiText(field.label)
  return field.reference ? `${label} (${field.reference})` : label
}

function labFieldPlaceholder(field: LabFormField) {
  return field.unit
    ? uiText('Résultat {unit}').replace('{unit}', field.unit)
    : uiText('Résultat')
}

function isLabPanelSlug(value: string): value is LabPanelSlug {
  return labPanels.panels.some((panel) => panel.slug === value)
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
    await labPanels.fetchPanels()
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
    showMessage(uiText('Dossier laboratoire introuvable.'), 'error')
  } finally {
    loading.value = false
  }
}

async function savePanel() {
  if (!activePanel.value || isActivePanelReadOnly.value) return
  if (!panelFormHasValues(formValues)) {
    showMessage(uiText("Remplissez au moins un résultat avant d'enregistrer."), 'error')
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
      showMessage(uiText("Formulaire modifié et envoyé à l'impression."))
    } else {
      printPanel()
      const hasRemaining = entryPanels.value.some((panel) => !isPanelFilled(panel.slug))
      showMessage(
        hasRemaining
          ? isAddMode.value
            ? uiText('Formulaire ajouté. Sélectionnez un autre type non saisi ou retournez à la liste.')
            : uiText('Formulaire enregistré. Sélectionnez le prochain type à compléter.')
          : uiText('Tous les formulaires sont enregistrés.'),
      )
      selectedPanelSlug.value = ''
      activePanel.value = null
      if (isAddMode.value && !hasRemaining) {
        setTimeout(() => router.push({ name: 'laboratoire-termines' }), 1200)
      }
    }
  } catch {
    showMessage(uiText("Erreur lors de l'enregistrement."), 'error')
  } finally {
    saving.value = false
  }
}

function goBack() {
  router.push({ name: backRouteName.value })
}

async function completeDossier() {
  if (dossierCompleted.value) return
  if (!savedPanelCount.value) {
    showMessage(
      uiText('Aucun résultat saisi — saisissez au moins un formulaire avant de clôturer.'),
      'error',
    )
    return
  }
  const ok = await confirmAppModal({
    title: 'Clôturer le dossier',
    message:
      'Valider et transmettre les résultats au médecin ? Le dossier passera dans Examens terminés.',
    confirmLabel: 'Clôturer',
    type: 'CONFIRM',
  })
  if (!ok) return

  completing.value = true
  try {
    await api.post(`/laboratoire/visits/${visitId.value}/complete`)
    dossierCompleted.value = true
    showMessage(uiText('Dossier clôturé — résultats transmis au médecin.'))
    setTimeout(() => router.push({ name: 'laboratoire-termines' }), 1200)
  } catch (error: unknown) {
    const apiMessage =
      error &&
      typeof error === 'object' &&
      'response' in error &&
      (error as { response?: { data?: { error?: unknown } } }).response?.data?.error
    showMessage(
      uiText(typeof apiMessage === 'string' ? apiMessage : 'Impossible de clôturer le dossier.'),
      'error',
    )
  } finally {
    completing.value = false
  }
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

watch(listedPanels, (panels) => {
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
    panelSearchQuery.value = ''
    loadDossier()
  },
)

onMounted(async () => {
  await labPanels.fetchPanels(true)
  await loadDossier()
})
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
        <UiButton variant="ghost" size="sm" :icon="ArrowLeft" @click="goBack">
          Retour
        </UiButton>
      </template>
    </UiPageHeader>

    <UiAlert v-if="message" :type="messageType" :message="message" />
    <UiAlert
      v-if="isEditMode && !loading"
      type="info"
      :message="uiText('Mode modification — sélectionnez un formulaire enregistré, corrigez les valeurs puis enregistrez.')"
    />
    <UiAlert
      v-else-if="isAddMode && !loading"
      type="info"
      :message="uiText('Ajoutez un formulaire supplémentaire — cherchez par nom puis sélectionnez-le.')"
    />
    <UiAlert
      v-else-if="isConsultMode && !loading"
      type="info"
      :message="uiText('Consultation en lecture seule — utilisez Modifier depuis Examens terminés pour corriger un formulaire.')"
    />
    <UiAlert
      v-else-if="dossierCompleted && !loading && !isEditMode && !isAddMode && !isConsultMode"
      type="success"
      :message="uiText('Dossier clôturé. Vous pouvez encore consulter ou imprimer les formulaires enregistrés.')"
    />

    <p v-if="loading" class="hint">{{ uiText('Chargement du dossier…') }}</p>

    <template v-else-if="visit">
      <UiCard title="Informations patient" icon-variant="blue" :padding="true">
        <div class="info-compact">
          <p class="info-compact__row">
            <span class="info-compact__item">
              <span class="info-compact__label">{{ uiText('Matricule') }}</span>
              <strong>{{ visit.patient.code }}</strong>
            </span>
            <span class="info-compact__sep" aria-hidden="true">·</span>
            <span class="info-compact__item">
              <span class="info-compact__label">{{ uiText('Catégorie') }}</span>
              <strong>{{
                uiText(patientCategoryLabel((visit.patient.category ?? 'STANDARD') as PatientCategory))
              }}</strong>
            </span>
            <span class="info-compact__sep" aria-hidden="true">·</span>
            <span class="info-compact__item">
              <span class="info-compact__label">{{ uiText('Prescripteur') }}</span>
              <strong>{{ doctorLabel }}</strong>
            </span>
            <template v-if="visit.consultation?.labSentToLabAt">
              <span class="info-compact__sep" aria-hidden="true">·</span>
              <span class="info-compact__item">
                <span class="info-compact__label">{{ uiText('Transféré le') }}</span>
                <strong>{{ dateTimeText(visit.consultation.labSentToLabAt) }}</strong>
              </span>
            </template>
          </p>
          <p class="info-compact__row info-compact__row--exams">
            <span class="info-compact__label">{{ uiText('Examens laboratoire') }}</span>
            <strong class="info-compact__exams-text" :title="prescribedExamsFull">{{
              prescribedExamsPreview
            }}</strong>
          </p>
        </div>
      </UiCard>

      <UiCard
        :title="
          isEditMode
            ? uiText('Modifier les formulaires')
            : isAddMode
              ? uiText('Ajouter un formulaire')
              : isConsultMode
                ? uiText('Consulter les formulaires')
                : uiText('Formulaires de résultats')
        "
        :description="
          isEditMode
            ? uiText('Sélectionnez un formulaire déjà enregistré pour corriger les résultats')
            : isConsultMode
              ? uiText('Sélectionnez un formulaire enregistré pour le consulter ou l\'imprimer')
              : uiText('Choisissez un formulaire dans la liste (tous sont proposés), ou filtrez par nom')
        "
        icon-variant="teal"
        :icon="FlaskConical"
      >
        <div class="panel-select">
          <UiInput
            v-model="panelSearchQuery"
            :label="uiText('Rechercher')"
            :placeholder="uiText('Rechercher un formulaire…')"
            :required="false"
          />
          <UiSelect
            v-model="selectedPanelSlug"
            :label="uiText('Type de formulaire')"
            :required="false"
          >
            <option value="">
              {{
                selectablePanels.length
                  ? uiText('— Choisir un formulaire —')
                  : panelSearchQuery.trim()
                    ? uiText('Aucun formulaire ne correspond à la recherche.')
                    : isEditMode || isConsultMode
                      ? uiText('— Aucun formulaire enregistré —')
                      : uiText('— Aucun formulaire disponible —')
              }}
            </option>
            <option v-for="panel in selectablePanels" :key="panel.slug" :value="panel.slug">
              {{ panelOptionLabel(panel.slug) }}
            </option>
          </UiSelect>
          <p v-if="listedPanels.length" class="panel-select__meta">
            {{
              uiText('{shown} / {total} formulaire(s)')
                .replace('{shown}', numberText(selectablePanels.length))
                .replace('{total}', numberText(listedPanels.length))
            }}
          </p>
        </div>

        <template v-if="activePanelConfig">
          <div class="form-divider" />

          <p v-if="!activePanelConfig.sections.some((s) => s.fields.length)" class="saved-hint">
            {{ uiText('Ce formulaire n’a pas encore de champs — complétez-le dans Formulaires laboratoire.') }}
          </p>

          <div v-for="section in activePanelConfig.sections" :key="section.title ?? 'main'" class="form-section">
            <h3 v-if="section.title" class="form-section__title">{{ uiText(section.title) }}</h3>
            <div
              class="form-grid"
              :class="section.fields.length > 4 ? 'form-grid--cols-4' : 'form-grid--cols-2'"
            >
              <template v-for="field in section.fields" :key="field.key">
                <div class="lab-field">
                  <UiInput
                    v-model="formValues[field.key]"
                    :label="labFieldDisplayLabel(field)"
                    :placeholder="labFieldPlaceholder(field)"
                    :disabled="isActivePanelReadOnly"
                  />
                  <label v-if="field.hasComment" class="field-comment">
                    <span class="field-comment__label">{{ uiText('Commentaire') }}</span>
                    <textarea
                      v-model="formValues[labFieldCommentKey(field.key)]"
                      rows="2"
                      :placeholder="uiText('Commentaire sur cette ligne…')"
                      :disabled="isActivePanelReadOnly"
                    />
                  </label>
                </div>
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
              {{ uiText('Imprimer') }}
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
                  ? uiText('Enregistrement…')
                  : isEditMode
                    ? uiText('Enregistrer les modifications')
                    : isAddMode
                      ? uiText('Ajouter et imprimer')
                      : uiText('Enregistrer et imprimer')
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

.info-compact {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.info-compact__row {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.35rem 0.5rem;
  margin: 0;
  font-size: 0.8125rem;
  line-height: 1.4;
}

.info-compact__row--exams {
  gap: 0.35rem 0.65rem;
}

.info-compact__item {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.35rem;
}

.info-compact__label {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-muted);
  white-space: nowrap;
}

.info-compact__sep {
  color: #cbd5e1;
  user-select: none;
}

.info-compact__row strong {
  font-weight: 600;
  color: var(--text);
}

.info-compact__row--exams strong,
.info-compact__exams-text {
  flex: 1;
  min-width: 0;
  color: var(--brand-red-700, #b71c1c);
  font-weight: 800;
}

.saved-hint {
  margin: -0.35rem 0 0;
  font-size: 0.8125rem;
  color: #0f766e;
}

.saved-hint--completed {
  color: var(--text-muted);
}

.panel-select {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.panel-select__meta {
  margin: -0.35rem 0 0;
  font-size: 0.8125rem;
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
  margin: 0 0 0.65rem;
  font-size: 0.8125rem;
  color: var(--primary-700);
}

.form-grid {
  display: grid;
  gap: 0.65rem;
}

.form-grid--cols-2 {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.form-grid--cols-4 {
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.5rem 0.65rem;
}

.form-grid--cols-4 :deep(.ui-field__label) {
  font-size: 0.7rem;
  line-height: 1.25;
}

.form-grid--cols-4 :deep(.ui-field__input) {
  padding: 0.4rem 0.55rem;
  font-size: 0.8125rem;
}

.lab-dossier :deep(.panel-select .ui-field__label),
.lab-dossier :deep(.form-section .ui-field__label) {
  font-size: 0.75rem;
}

.lab-dossier :deep(.form-section .ui-field__input) {
  font-size: 0.875rem;
  padding: 0.5rem 0.7rem;
  min-height: 2.35rem;
}

.lab-field {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.lab-field :deep(.ui-field) {
  margin-bottom: 0;
}

.field-comment {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  margin-top: 0.45rem;
}

.field-comment__label {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-muted);
}

.field-comment textarea {
  width: 100%;
  padding: 0.45rem 0.6rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font: inherit;
  font-size: 0.8125rem;
  resize: vertical;
}

.field-comment textarea:disabled {
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
  .form-grid--cols-4 {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 900px) {
  .form-grid--cols-4 {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 768px) {
  .form-grid--cols-2,
  .form-grid--cols-4 {
    grid-template-columns: 1fr;
  }

  .info-compact__sep {
    display: none;
  }

  .info-compact__row {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.25rem;
  }
}
</style>
