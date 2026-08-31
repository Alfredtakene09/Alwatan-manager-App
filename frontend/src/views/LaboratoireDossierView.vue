<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, CheckCircle2, FlaskConical, Printer, Save } from '@lucide/vue'
import api from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { fullName } from '@/lib/roles'
import {
  formatLabPrescribedExamsPreview,
  formatLabPrescribedExamsSummary,
  parsePrescribedExamsByKind,
} from '@/lib/lab-notes'
import { patientCategoryLabel, type PatientCategory } from '@/lib/patient-category'
import {
  emptyPanelValues,
  getLabFormPanel,
  labFieldCommentKey,
  type LabFormField,
  type LabFormPanel,
  type LabPanelSlug,
} from '@/lib/lab-form-panels'
import { useLabPanelsStore } from '@/stores/lab-panels'
import { filterPanelsForPrescribedExams } from '@/lib/lab-prescribed-panels'
import {
  buildPrescribedByLabel,
  printLabPanelResult,
  printLabVisitPanelResults,
  resolveLabReceptionist,
} from '@/lib/lab-panel-print'
import { panelFormHasValues } from '@/lib/lab-visit-search'
import { confirmAppModal } from '@/lib/api-modal-helper'
import { emitLabAlertsRefresh } from '@/stores/lab-alerts'
import { useAppI18n } from '@/i18n/useAppI18n'
import { formatAppDate } from '@/i18n/locale-format'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiInput from '@/components/ui/UiInput.vue'
import type { LabsWaitingVisitRow } from '@/components/ui/LabsWaitingDataTable.vue'

type PrescribedPanelDto = {
  slug: string
  label: string
  examLabel: string
}

type DossierResponse = {
  visit: LabsWaitingVisitRow
  panelResults: Partial<Record<LabPanelSlug, Record<string, string>>>
  completed?: boolean
  prescribedPanels?: PrescribedPanelDto[]
}

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const labPanels = useLabPanelsStore()
const { uiText, examNameText, dateTimeText, numberText, roleLabel, localeCode } = useAppI18n()

const visit = ref<LabsWaitingVisitRow | null>(null)
const panelResults = ref<DossierResponse['panelResults']>({})
const apiPrescribedPanels = ref<PrescribedPanelDto[]>([])
const dossierCompleted = ref(false)
const activePanel = ref<LabPanelSlug | null>(null)
const formValues = reactive<Record<string, string>>({})
const loading = ref(false)
const saving = ref(false)
const message = ref('')
const messageType = ref<'success' | 'error'>('success')
/** Brouillons locaux pour changer d’examen sans perdre la saisie avant l’enregistrement final. */
const draftResults = reactive<Partial<Record<LabPanelSlug, Record<string, string>>>>({})

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

const prescribedExamLabels = computed(() =>
  parsePrescribedExamsByKind(visit.value?.consultation?.clinicalNotes).examen,
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

const entryPanels = computed(() => labPanels.entryPanels)

/** Formulaires liés aux examens prescrits par le médecin. */
const prescribedPanels = computed((): LabFormPanel[] => {
  void localeCode.value
  if (apiPrescribedPanels.value.length) {
    const bySlug = new Map(entryPanels.value.map((panel) => [panel.slug, panel]))
    const fromApi = apiPrescribedPanels.value
      .map((item) => bySlug.get(item.slug))
      .filter((panel): panel is LabFormPanel => Boolean(panel))
    if (fromApi.length) return fromApi
  }

  return filterPanelsForPrescribedExams(
    entryPanels.value.map((panel) => ({
      ...panel,
      matchLabels: labPanels.matchLabelsFor(panel.slug),
    })),
    prescribedExamLabels.value,
  )
})

/**
 * Liste proposée à la saisie :
 * - saisie : uniquement examens prescrits
 * - modification / consultation : formulaires déjà enregistrés
 * - mode ajouter : formulaires non encore saisis (exception)
 */
const listedPanels = computed(() => {
  void localeCode.value
  if (isAddMode.value) {
    return entryPanels.value
      .filter((panel) => !isPanelFilled(panel.slug))
      .slice()
      .sort((a, b) =>
        examNameText(a.label).localeCompare(examNameText(b.label), localeCode.value, { sensitivity: 'base' }),
      )
  }

  const base = prescribedPanels.value.length ? prescribedPanels.value : []

  if (isEditMode.value || isConsultMode.value) {
    const filled = base.filter((panel) => isPanelFilled(panel.slug))
    if (filled.length) return filled
    return entryPanels.value.filter((panel) => isPanelFilled(panel.slug))
  }

  return base.slice().sort((a, b) => {
    const filledA = isPanelFilled(a.slug) ? 1 : 0
    const filledB = isPanelFilled(b.slug) ? 1 : 0
    if (filledA !== filledB) return filledA - filledB
    return examNameText(a.label).localeCompare(examNameText(b.label), localeCode.value, { sensitivity: 'base' })
  })
})

const savedPanelCount = computed(
  () => listedPanels.value.filter((panel) => isPanelFilled(panel.slug)).length,
)

const isEntryFlow = computed(
  () => !isEditMode.value && !isAddMode.value && !isConsultMode.value && !dossierCompleted.value,
)

const showPanelSwitcher = computed(() => listedPanels.value.length > 1)

const formsCardDescription = computed(() => {
  if (isEditMode.value) {
    return uiText('Corrigez les résultats des examens prescrits déjà enregistrés')
  }
  if (isConsultMode.value) {
    return uiText('Consultation en lecture seule des examens prescrits')
  }
  if (isAddMode.value) {
    return uiText('Ajoutez un formulaire supplémentaire non encore saisi')
  }
  if (!listedPanels.value.length) {
    return uiText('Aucun formulaire lié aux examens prescrits — vérifiez les formulaires laboratoire.')
  }
  if (listedPanels.value.length === 1) {
    return uiText('Formulaire de l’examen prescrit — saisissez puis enregistrez, imprimez et clôturez')
  }
  return uiText(
    '{n} examens prescrits — saisissez chaque onglet puis enregistrez, imprimez et clôturez en une fois',
  ).replace('{n}', numberText(listedPanels.value.length))
})

const isActivePanelReadOnly = computed(() => {
  if (isEditMode.value || isAddMode.value) return false
  if (isConsultMode.value || dossierCompleted.value) return true
  if (!activePanel.value) return true
  // Flux principal : éditable jusqu'à la clôture (même si déjà enregistré partiellement)
  return false
})

const canFinalize = computed(() => {
  if (isConsultMode.value || dossierCompleted.value) return false
  if (activePanel.value && !isActivePanelReadOnly.value && panelFormHasValues(formValues)) return true
  if (Object.values(draftResults).some((values) => values && panelFormHasValues(values))) return true
  return savedPanelCount.value > 0
})

function panelOptionLabel(slug: LabPanelSlug) {
  void localeCode.value
  const apiItem = apiPrescribedPanels.value.find((item) => item.slug === slug)
  const base = examNameText(apiItem?.examLabel || getLabFormPanel(slug)?.label || slug)
  if (isPanelFilled(slug)) {
    return `${base} (${uiText('Enregistré')})`
  }
  return base
}

function labFieldDisplayLabel(field: LabFormField) {
  const label = examNameText(field.label)
  return field.reference ? `${label} (${field.reference})` : label
}

function labFieldPlaceholder(field: LabFormField) {
  return field.unit
    ? uiText('Résultat {unit}').replace('{unit}', field.unit)
    : uiText('Résultat')
}

function showMessage(text: string, type: 'success' | 'error' = 'success') {
  message.value = text
  messageType.value = type
}

function clearDrafts() {
  Object.keys(draftResults).forEach((key) => delete draftResults[key as LabPanelSlug])
}

function stashActiveDraft() {
  if (!activePanel.value || isActivePanelReadOnly.value) return
  draftResults[activePanel.value] = { ...formValues }
}

function mergedPanelValues(slug: LabPanelSlug): Record<string, string> {
  return {
    ...(panelResults.value[slug] ?? {}),
    ...(draftResults[slug] ?? {}),
  }
}

function collectPanelsToSave(): Array<{ slug: LabPanelSlug; values: Record<string, string> }> {
  stashActiveDraft()
  const slugs = new Set<LabPanelSlug>()
  for (const panel of listedPanels.value) slugs.add(panel.slug)
  if (activePanel.value) slugs.add(activePanel.value)
  for (const key of Object.keys(draftResults)) slugs.add(key as LabPanelSlug)
  for (const key of Object.keys(panelResults.value)) {
    if (panelFormHasValues(panelResults.value[key as LabPanelSlug] ?? {})) {
      slugs.add(key as LabPanelSlug)
    }
  }

  return [...slugs]
    .map((slug) => ({ slug, values: mergedPanelValues(slug) }))
    .filter((item) => panelFormHasValues(item.values))
}

function printContext() {
  return {
    patientName: patientLabel.value,
    patientCode: visit.value!.patient.code,
    prescribedBy: doctorLabel.value,
    validatedBy: validatorLabel.value,
    date: formatAppDate(new Date()),
  }
}

function printAllPanels(
  results: DossierResponse['panelResults'],
  preferSlugs?: LabPanelSlug[],
) {
  if (!visit.value) return false
  return printLabVisitPanelResults(results, printContext(), { preferSlugs })
}

function loadFormValues(slug: LabPanelSlug) {
  const panel = getLabFormPanel(slug)
  if (!panel) return
  const defaults = emptyPanelValues(panel)
  const saved = panelResults.value[slug] ?? {}
  const draft = draftResults[slug] ?? {}
  Object.keys(formValues).forEach((key) => delete formValues[key])
  Object.assign(formValues, { ...defaults, ...saved, ...draft })
}

function selectPanel(slug: LabPanelSlug | null) {
  stashActiveDraft()
  activePanel.value = slug
  if (slug) loadFormValues(slug)
}

function pickDefaultPanel(panels: LabFormPanel[]) {
  if (!panels.length) {
    selectPanel(null)
    return
  }
  const firstOpen = panels.find((panel) => !isPanelFilled(panel.slug))
  selectPanel((firstOpen ?? panels[0]).slug)
}

async function loadDossier() {
  loading.value = true
  message.value = ''
  clearDrafts()
  try {
    await labPanels.fetchPanels()
    const { data } = await api.get<DossierResponse>(`/laboratoire/visits/${visitId.value}`)
    visit.value = data.visit
    panelResults.value = data.panelResults
    dossierCompleted.value = !!data.completed
    apiPrescribedPanels.value = Array.isArray(data.prescribedPanels) ? data.prescribedPanels : []
  } catch {
    visit.value = null
    apiPrescribedPanels.value = []
    showMessage(uiText('Dossier laboratoire introuvable.'), 'error')
  } finally {
    loading.value = false
  }
}

async function persistPanels(
  panels: Array<{ slug: LabPanelSlug; values: Record<string, string> }>,
) {
  let latest = panelResults.value
  let completed = dossierCompleted.value
  for (const panel of panels) {
    const { data } = await api.put<{
      panelResults: DossierResponse['panelResults']
      completed?: boolean
    }>(`/laboratoire/visits/${visitId.value}/panels/${panel.slug}`, {
      values: panel.values,
    })
    latest = data.panelResults
    completed = !!data.completed
  }
  panelResults.value = latest
  dossierCompleted.value = completed
  clearDrafts()
  return latest
}

/** Enregistre tous les examens saisis, imprime 1 page / examen, puis clôture. */
async function savePrintAndComplete() {
  if (!visit.value || isConsultMode.value) return

  const panels = collectPanelsToSave()
  if (!panels.length) {
    showMessage(uiText("Remplissez au moins un résultat avant d'enregistrer."), 'error')
    return
  }

  const missingCount = listedPanels.value.filter(
    (panel) => !panels.some((item) => item.slug === panel.slug),
  ).length

  const ok = await confirmAppModal({
    title: uiText('Enregistrer, imprimer et clôturer'),
    message:
      missingCount > 0
        ? uiText(
            'Certains examens prescrits sont encore vides. Enregistrer, imprimer les résultats saisis (une page par examen) et clôturer le dossier ?',
          )
        : uiText(
            'Enregistrer tous les résultats, imprimer un fichier (une page par examen) et transmettre au médecin ?',
          ),
    confirmLabel: uiText('Enregistrer, imprimer et clôturer'),
    type: 'CONFIRM',
  })
  if (!ok) return

  saving.value = true
  try {
    const latest = await persistPanels(panels)
    printAllPanels(
      latest,
      panels.map((panel) => panel.slug),
    )
    if (!dossierCompleted.value) {
      await api.post(`/laboratoire/visits/${visitId.value}/complete`)
      dossierCompleted.value = true
    }
    emitLabAlertsRefresh()
    showMessage(uiText('Dossier enregistré, imprimé et clôturé — résultats transmis au médecin.'))
    setTimeout(() => router.push({ name: 'laboratoire-termines' }), 1200)
  } catch (error: unknown) {
    const apiMessage =
      error &&
      typeof error === 'object' &&
      'response' in error &&
      (error as { response?: { data?: { error?: unknown } } }).response?.data?.error
    showMessage(
      uiText(
        typeof apiMessage === 'string'
          ? apiMessage
          : "Erreur lors de l'enregistrement, de l'impression ou de la clôture.",
      ),
      'error',
    )
  } finally {
    saving.value = false
  }
}

async function savePanel() {
  if (!activePanel.value || isActivePanelReadOnly.value) return
  if (!panelFormHasValues(formValues)) {
    showMessage(uiText("Remplissez au moins un résultat avant d'enregistrer."), 'error')
    return
  }

  // Flux principal : un seul bouton enregistre + imprime tout + clôture
  if (isEntryFlow.value) {
    await savePrintAndComplete()
    return
  }

  saving.value = true
  try {
    const panels =
      isEditMode.value
        ? collectPanelsToSave()
        : [{ slug: activePanel.value, values: { ...formValues } }]

    const latest = await persistPanels(panels)
    if (isEditMode.value) {
      printAllPanels(
        latest,
        panels.map((panel) => panel.slug),
      )
      showMessage(uiText('Formulaires modifiés et envoyés à l’impression (une page par examen).'))
    } else {
      printAllPanels(
        latest,
        panels.map((panel) => panel.slug),
      )
      const remaining = listedPanels.value.filter((panel) => !isPanelFilled(panel.slug))
      showMessage(
        remaining.length
          ? uiText('Formulaire ajouté. Passez au suivant ou retournez à la liste.')
          : uiText('Tous les examens prescrits sont enregistrés.'),
      )
      pickDefaultPanel(listedPanels.value)
      if (isAddMode.value && !remaining.length) {
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

function printPanel() {
  if (!activePanel.value || !visit.value) return
  printLabPanelResult(activePanel.value, { ...formValues }, printContext())
}

function printAllSaved() {
  if (!visit.value) return
  const merged: DossierResponse['panelResults'] = { ...panelResults.value }
  stashActiveDraft()
  for (const [slug, values] of Object.entries(draftResults)) {
    if (values && panelFormHasValues(values)) {
      merged[slug as LabPanelSlug] = values
    }
  }
  if (!Object.keys(merged).some((slug) => panelFormHasValues(merged[slug as LabPanelSlug] ?? {}))) {
    showMessage(uiText('Aucun formulaire enregistré pour ce dossier.'), 'error')
    return
  }
  printAllPanels(merged)
}

watch(listedPanels, (panels) => {
  if (!panels.length) {
    selectPanel(null)
    return
  }
  if (activePanel.value && panels.some((panel) => panel.slug === activePanel.value)) {
    loadFormValues(activePanel.value)
    return
  }
  pickDefaultPanel(panels)
})

watch(
  () => [route.params.visitId, route.query.edit, route.query.add, route.query.from],
  async () => {
    activePanel.value = null
    await loadDossier()
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
          v-if="savedPanelCount && (isConsultMode || dossierCompleted) && !isEditMode && !isAddMode"
          variant="outline"
          size="sm"
          :icon="Printer"
          ui-action="export.print"
          @click="printAllSaved"
        >
          {{ uiText('Imprimer tout le dossier') }}
        </UiButton>
        <UiButton variant="ghost" size="sm" :icon="ArrowLeft" @click="goBack">
          {{ uiText('Retour') }}
        </UiButton>
      </template>
    </UiPageHeader>

    <UiAlert v-if="message" :type="messageType" :message="message" />
    <UiAlert
      v-if="isEditMode && !loading"
      type="info"
      :message="uiText('Mode modification — corrigez les valeurs des examens prescrits puis enregistrez.')"
    />
    <UiAlert
      v-else-if="isAddMode && !loading"
      type="info"
      :message="uiText('Ajoutez un formulaire supplémentaire non encore saisi.')"
    />
    <UiAlert
      v-else-if="isConsultMode && !loading"
      type="info"
      :message="uiText('Consultation en lecture seule — utilisez Modifier depuis Examens terminés pour corriger.')"
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
                : uiText('Résultats — examens prescrits')
        "
        :description="formsCardDescription"
        icon-variant="teal"
        :icon="FlaskConical"
      >
        <p v-if="!listedPanels.length" class="hint">
          {{
            prescribedExamLabels.length
              ? uiText(
                  'Aucun formulaire trouvé pour ces examens. Vérifiez que chaque examen a un formulaire laboratoire lié.',
                )
              : uiText('Aucun examen laboratoire prescrit pour cette visite.')
          }}
        </p>

        <div v-else-if="showPanelSwitcher" class="panel-tabs" role="tablist">
          <button
            v-for="(panel, index) in listedPanels"
            :key="panel.slug"
            type="button"
            role="tab"
            class="panel-tabs__btn"
            :class="{
              'panel-tabs__btn--active': activePanel === panel.slug,
              'panel-tabs__btn--done': isPanelFilled(panel.slug),
            }"
            :aria-selected="activePanel === panel.slug"
            @click="selectPanel(panel.slug)"
          >
            <span class="panel-tabs__num">{{ numberText(index + 1) }}</span>
            <span class="panel-tabs__label">{{ panelOptionLabel(panel.slug) }}</span>
          </button>
        </div>

        <p v-else-if="listedPanels.length === 1" class="single-panel-title">
          <span class="panel-tabs__num">1</span>
          {{ panelOptionLabel(listedPanels[0].slug) }}
        </p>

        <template v-if="activePanelConfig">
          <div v-if="showPanelSwitcher" class="form-divider" />

          <p v-if="!activePanelConfig.sections.some((s) => s.fields.length)" class="saved-hint">
            {{
              uiText(
                'Ce formulaire n’a pas encore de champs — complétez-le dans Formulaires laboratoire.',
              )
            }}
          </p>

          <div
            v-for="section in activePanelConfig.sections"
            :key="section.title ?? 'main'"
            class="form-section"
          >
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
              v-if="isActivePanelReadOnly && !isEntryFlow"
              variant="outline"
              :icon="Printer"
              ui-action="export.print"
              :disabled="!activePanel"
              @click="isConsultMode || dossierCompleted ? printAllSaved() : printPanel()"
            >
              {{
                isConsultMode || dossierCompleted
                  ? uiText('Imprimer tout le dossier')
                  : uiText('Imprimer')
              }}
            </UiButton>
            <UiButton
              v-if="isEntryFlow"
              variant="primary"
              :icon="CheckCircle2"
              :disabled="saving || !canFinalize"
              @click="savePrintAndComplete"
            >
              {{
                saving
                  ? uiText('Enregistrement…')
                  : uiText('Enregistrer, imprimer et clôturer')
              }}
            </UiButton>
            <UiButton
              v-else-if="!isActivePanelReadOnly"
              variant="primary"
              :icon="Save"
              :disabled="saving || !activePanel"
              @click="savePanel"
            >
              {{
                saving
                  ? uiText('Enregistrement…')
                  : isEditMode
                    ? uiText('Enregistrer et imprimer')
                    : uiText('Ajouter et imprimer')
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

.panel-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.panel-tabs__btn {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  max-width: 100%;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: #fff;
  color: var(--text);
  font-family: var(--font);
  font-size: 0.8125rem;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s, color 0.15s;
}

.panel-tabs__btn--active {
  border-color: var(--primary-400, #60a5fa);
  background: var(--primary-50, #eff6ff);
  color: var(--primary-800, #1e40af);
}

.panel-tabs__btn--done:not(.panel-tabs__btn--active) {
  border-color: rgba(15, 118, 110, 0.35);
  background: rgba(240, 253, 250, 0.85);
}

.panel-tabs__num,
.single-panel-title .panel-tabs__num {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.45rem;
  height: 1.45rem;
  border-radius: 6px;
  background: var(--primary-50, #eff6ff);
  color: var(--primary-700, #1d4ed8);
  font-size: 0.6875rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.panel-tabs__btn--active .panel-tabs__num {
  background: var(--primary-600, #2563eb);
  color: #fff;
}

.panel-tabs__label {
  min-width: 0;
  overflow-wrap: anywhere;
}

.single-panel-title {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0;
  font-size: 0.9375rem;
  font-weight: 700;
  color: var(--text);
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
