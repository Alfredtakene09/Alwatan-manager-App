<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, ClipboardList, FileText, FolderOpen, Printer, Save } from '@lucide/vue'
import api from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { fullName, ROLE_LABELS } from '@/lib/roles'
import { formatLabPrescribedExamsPreview, formatLabPrescribedExamsSummary } from '@/lib/lab-notes'
import { patientCategoryLabel, type PatientCategory } from '@/lib/patient-category'
import {
  getLabFormPanel,
  getFilledLabPanelSections,
  type LabPanelSlug,
} from '@/lib/lab-form-panels'
import { useLabPanelsStore } from '@/stores/lab-panels'
import { buildPrescribedByLabel, printLabPanelResult, resolveLabReceptionist } from '@/lib/lab-panel-print'
import { fetchAndPrintLabVisitResults } from '@/lib/lab-visit-print'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiTextarea from '@/components/ui/UiTextarea.vue'
import type { LabsResultsVisitRow } from '@/components/ui/LabsResultsDataTable.vue'
import { useSilentRefresh } from '@/composables/useSilentRefresh'
import { useAppI18n } from '@/i18n/useAppI18n'

type LabPanelDoctorComment = {
  comment: string
  doctorId: string
  updatedAt: string
}

type DossierResponse = {
  visit: LabsResultsVisitRow
  panelResults: Partial<Record<LabPanelSlug, Record<string, string>>>
  panelReceivedAt?: Partial<Record<LabPanelSlug, string>>
  panelDoctorComments?: Partial<Record<LabPanelSlug, LabPanelDoctorComment>>
  latestResultAt?: string | null
  completed?: boolean
}

type PanelFile = {
  slug: LabPanelSlug
  label: string
  dateLabel: string
  timeLabel: string
  sortKey: number
}

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const labPanels = useLabPanelsStore()
const { uiText, dateTimeText } = useAppI18n()

const visit = ref<LabsResultsVisitRow | null>(null)
const panelResults = ref<DossierResponse['panelResults']>({})
const panelReceivedAt = ref<DossierResponse['panelReceivedAt']>({})
const panelDoctorComments = ref<DossierResponse['panelDoctorComments']>({})
const commentDraft = ref('')
const savingComment = ref(false)
const activePanel = ref<LabPanelSlug | null>(null)
const loading = ref(false)
const printingAll = ref(false)
const message = ref('')
const messageType = ref<'success' | 'error'>('success')

const visitId = computed(() => String(route.params.visitId ?? ''))
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
  const approver = visit.value?.consultation?.labApprovedBy
  if (approver) {
    return `${fullName(approver.firstName, approver.lastName)} — Laboratoire`
  }
  if (!auth.user) return 'Laboratoire'
  return `${fullName(auth.user.firstName, auth.user.lastName)} — ${ROLE_LABELS[auth.user.role]}`
})

const resultsReceivedAt = computed(() => {
  const raw = visit.value?.consultation?.updatedAt ?? visit.value?.updatedAt
  return raw ? new Date(raw) : null
})

const panelFiles = computed<PanelFile[]>(() => {
  const fallback = resultsReceivedAt.value

  return labPanels.panels.filter((panel) => panelResults.value[panel.slug])
    .map((panel) => {
      const raw = panelReceivedAt.value?.[panel.slug]
      const receivedAt = raw ? new Date(raw) : fallback
      const dateLabel = receivedAt
        ? receivedAt.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
        : '—'
      const timeLabel = receivedAt
        ? receivedAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
        : '—'
      return {
        slug: panel.slug,
        label: panel.label,
        dateLabel,
        timeLabel,
        sortKey: receivedAt?.getTime() ?? 0,
      }
    })
    .sort((a, b) => b.sortKey - a.sortKey)
})

const activePanelFilledSections = computed(() => {
  if (!activePanelConfig.value || !activePanel.value) return []
  return getFilledLabPanelSections(activePanelConfig.value, panelResults.value[activePanel.value])
})

const activePanelSavedValues = computed(() =>
  activePanel.value ? (panelResults.value[activePanel.value] ?? {}) : {},
)

const doctorComment = computed(() => visit.value?.consultation?.doctorComment?.trim() ?? '')

const activePanelComment = computed(() => {
  if (!activePanel.value) return null
  return panelDoctorComments.value?.[activePanel.value] ?? null
})

const activePanelCommentSaved = computed(
  () => activePanelComment.value?.comment?.trim() ?? '',
)

const commentDraftDirty = computed(
  () => commentDraft.value.trim() !== activePanelCommentSaved.value,
)

function syncCommentDraft(slug: LabPanelSlug | null) {
  commentDraft.value = slug ? (panelDoctorComments.value?.[slug]?.comment ?? '') : ''
}

function selectPanel(slug: LabPanelSlug | null) {
  activePanel.value = slug
  syncCommentDraft(slug)
}

function panelHasDoctorComment(slug: LabPanelSlug) {
  return Boolean(panelDoctorComments.value?.[slug]?.comment?.trim())
}

function showMessage(text: string, type: 'success' | 'error' = 'success') {
  message.value = text
  messageType.value = type
}

async function loadDossier(opts?: { silent?: boolean }) {
  if (commentDraftDirty.value) return
  if (!opts?.silent) {
    loading.value = true
    message.value = ''
  }
  try {
    const { data } = await api.get<DossierResponse>(`/consultations/labs-resultats/${visitId.value}`)
    visit.value = data.visit
    panelResults.value = data.panelResults
    panelReceivedAt.value = data.panelReceivedAt ?? {}
    panelDoctorComments.value = data.panelDoctorComments ?? {}
    const firstPanel = labPanels.panels.find((panel) => data.panelResults[panel.slug])?.slug ?? null
    const nextPanel =
      activePanel.value && data.panelResults[activePanel.value] ? activePanel.value : firstPanel
    selectPanel(nextPanel)
  } catch {
    if (!opts?.silent) {
      visit.value = null
      selectPanel(null)
      showMessage(uiText('Résultats laboratoire introuvables.'), 'error')
    }
  } finally {
    if (!opts?.silent) loading.value = false
  }
}

async function savePanelComment() {
  if (!activePanel.value || !visitId.value) return
  savingComment.value = true
  try {
    const { data } = await api.patch<{
      panelDoctorComments: DossierResponse['panelDoctorComments']
    }>(`/consultations/labs-resultats/${visitId.value}/panels/${activePanel.value}/comment`, {
      comment: commentDraft.value,
    })
    panelDoctorComments.value = data.panelDoctorComments ?? {}
    syncCommentDraft(activePanel.value)
    showMessage(uiText('Avis enregistré pour ce formulaire.'))
  } catch {
    showMessage(uiText("Impossible d'enregistrer l'avis."), 'error')
  } finally {
    savingComment.value = false
  }
}

function printPanel() {
  if (!activePanel.value || !visit.value || !panelResults.value[activePanel.value]) return
  printLabPanelResult(activePanel.value, { ...activePanelSavedValues.value }, {
    patientName: patientLabel.value,
    patientCode: visit.value.patient.code,
    prescribedBy: doctorLabel.value,
    validatedBy: validatorLabel.value,
  })
}

async function printAllPanels() {
  if (!visit.value) return
  printingAll.value = true
  const result = await fetchAndPrintLabVisitResults(visit.value, auth.user, 'medecin')
  if (!result.ok) showMessage(result.error, 'error')
  printingAll.value = false
}

const { refresh: refreshDossier } = useSilentRefresh(
  ({ silent }) => loadDossier({ silent }),
  {
    intervalMs: 20_000,
    enabled: () => !commentDraftDirty.value,
    immediate: false,
  },
)

watch(
  () => route.params.visitId,
  () => {
    selectPanel(null)
    void refreshDossier()
  },
)

onMounted(async () => {
  try {
    await labPanels.fetchPanels()
  } catch {
    // Ne pas bloquer l'ouverture du dossier si les formulaires ne chargent pas
  }
  await loadDossier()
})
</script>

<template>
  <div class="lab-dossier">
    <UiPageHeader
      :title="patientLabel || uiText('Résultats laboratoire')"
      :subtitle="
        visit
          ? `${visit.patient.code} — ${prescribedExamsPreview}`
          : loading
            ? uiText('Chargement…')
            : message
              ? uiText('Dossier indisponible')
              : uiText('Chargement…')
      "
      :icon="ClipboardList"
    >
      <template #actions>
        <UiButton
          v-if="panelFiles.length"
          variant="outline"
          size="sm"
          :icon="Printer"
          ui-action="export.print"
          :disabled="printingAll"
          @click="printAllPanels"
        >
          {{ printingAll ? uiText('Impression…') : uiText('Imprimer tout le dossier') }}
        </UiButton>
        <UiButton
          v-if="visit?.patient?.id"
          variant="outline"
          size="sm"
          :icon="FolderOpen"
          @click="router.push({ name: 'dossier-patient', query: { patient: visit!.patient.id } })"
        >
          {{ uiText('Dossier patient') }}
        </UiButton>
        <UiButton
          variant="ghost"
          size="sm"
          :icon="ArrowLeft"
          @click="router.push({ name: 'medecin-labs-resultats' })"
        >
          {{ uiText('Retour') }}
        </UiButton>
      </template>
    </UiPageHeader>

    <UiAlert v-if="message" :type="messageType" :message="message" />

    <p v-if="loading" class="hint">{{ uiText('Chargement des résultats…') }}</p>

    <template v-else-if="visit">
      <UiCard title="Informations patient" icon-variant="blue" class="lab-dossier__card lab-dossier__card--info">
        <dl class="info-row">
          <div class="info-row__item">
            <dt>{{ uiText('Matricule') }}</dt>
            <dd>{{ visit.patient.code }}</dd>
          </div>
          <div class="info-row__item">
            <dt>{{ uiText('Catégorie') }}</dt>
            <dd>{{ patientCategoryLabel((visit.patient.category ?? 'STANDARD') as PatientCategory) }}</dd>
          </div>
          <div class="info-row__item">
            <dt>{{ uiText('Prescripteur') }}</dt>
            <dd>{{ doctorLabel }}</dd>
          </div>
          <div class="info-row__item info-row__item--exams">
            <dt>{{ uiText('Examens laboratoire') }}</dt>
            <dd class="prescribed-exams-text" :title="prescribedExamsFull">{{ prescribedExamsPreview }}</dd>
          </div>
          <div v-if="doctorComment" class="info-row__item info-row__item--full">
            <dt>{{ uiText('Commentaire à la prescription') }}</dt>
            <dd class="doctor-comment-preview">{{ doctorComment }}</dd>
          </div>
        </dl>
      </UiCard>

      <UiCard
        title="Résultats disponibles"
        :description="
          uiText('{n} formulaire(s) — cliquez pour consulter').replace(
            '{n}',
            String(panelFiles.length),
          )
        "
        icon-variant="teal"
        :icon="ClipboardList"
        class="lab-dossier__card lab-dossier__card--files"
      >
        <p v-if="!panelFiles.length" class="hint">
          {{ uiText('Aucun formulaire enregistré pour ce dossier.') }}
        </p>

        <div v-else class="panel-files">
          <button
            v-for="file in panelFiles"
            :key="file.slug"
            type="button"
            class="panel-file"
            :class="{ 'panel-file--active': activePanel === file.slug }"
            @click="selectPanel(file.slug)"
          >
            <span class="panel-file__icon" aria-hidden="true">
              <FileText :size="18" stroke-width="1.75" />
            </span>
            <span class="panel-file__body">
              <span class="panel-file__label">{{ file.label }}</span>
              <span class="panel-file__meta">{{ file.dateLabel }} · {{ file.timeLabel }}</span>
            </span>
            <span v-if="panelHasDoctorComment(file.slug)" class="panel-file__note">{{
              uiText('Avis')
            }}</span>
          </button>
        </div>
      </UiCard>

      <UiCard
        v-if="activePanelConfig && activePanel && panelResults[activePanel]"
        :title="activePanelConfig.label"
        :description="`Consultation en lecture seule — ${panelFiles.find((f) => f.slug === activePanel)?.dateLabel ?? ''} ${panelFiles.find((f) => f.slug === activePanel)?.timeLabel ?? ''}`"
        icon-variant="teal"
        :icon="FileText"
      >
        <p v-if="!activePanelFilledSections.length && !activePanelCommentSaved" class="hint">
          Aucune valeur enregistrée pour ce formulaire.
        </p>

        <div
          v-for="section in activePanelFilledSections"
          :key="section.title ?? 'main'"
          class="results-section"
        >
          <h3 v-if="section.title" class="results-section__title">{{ section.title }}</h3>
          <dl class="results-grid">
            <div
              v-for="field in section.fields"
              :key="field.key"
              class="result-item"
              :class="{ 'result-item--wide': !!field.comment }"
            >
              <dt>
                {{ field.label }}
                <span v-if="field.reference" class="result-item__ref">({{ field.reference }})</span>
              </dt>
              <dd>
                <template v-if="field.value">
                  {{ field.value }}
                  <span v-if="field.unit" class="result-item__unit">{{ field.unit }}</span>
                </template>
                <span v-else class="result-item__empty">—</span>
                <p v-if="field.comment" class="result-item__comment">{{ field.comment }}</p>
              </dd>
            </div>
          </dl>
        </div>

        <section class="doctor-comment-block">
          <UiTextarea
            v-model="commentDraft"
            :label="uiText('Avis / commentaire du médecin')"
            :placeholder="
              uiText(
                'Interprétation des résultats, recommandations, suite à donner au patient…',
              )
            "
            :rows="4"
          />
          <p v-if="activePanelComment?.updatedAt" class="doctor-comment-block__meta">
            {{ uiText('Dernier enregistrement :') }}
            {{ dateTimeText(activePanelComment.updatedAt) }}
          </p>
        </section>

        <div class="form-actions">
          <UiButton
            variant="primary"
            :icon="Save"
            :disabled="savingComment || !commentDraftDirty"
            @click="savePanelComment"
          >
            {{ savingComment ? uiText('Enregistrement…') : uiText("Enregistrer l'avis") }}
          </UiButton>
          <UiButton variant="outline" :icon="Printer" ui-action="export.print" @click="printPanel">
            {{ uiText('Imprimer ce formulaire') }}
          </UiButton>
        </div>
      </UiCard>
    </template>
  </div>
</template>

<style scoped>
.lab-dossier {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.lab-dossier__card :deep(.ui-card__body) {
  padding-top: 0.65rem;
  padding-bottom: 0.65rem;
}

.lab-dossier__card--info :deep(.ui-card__header),
.lab-dossier__card--files :deep(.ui-card__header) {
  padding-bottom: 0.35rem;
}

.hint {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.8125rem;
}

.info-row {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.35rem 1.25rem;
  margin: 0;
}

.info-row__item {
  display: inline-flex;
  align-items: baseline;
  gap: 0.35rem;
  min-width: 0;
}

.info-row__item dt {
  margin: 0;
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--text-muted);
  white-space: nowrap;
}

.info-row__item dt::after {
  content: ' :';
}

.info-row__item dd {
  margin: 0;
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text);
}

.info-row__item--exams {
  flex: 1 1 12rem;
  min-width: min(100%, 12rem);
}

.info-row__item--full {
  flex: 1 1 100%;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.2rem;
  padding-top: 0.35rem;
  border-top: 1px dashed var(--border);
}

.prescribed-exams-text {
  color: var(--brand-red-700, #b71c1c);
  font-weight: 800;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.doctor-comment-preview {
  white-space: pre-wrap;
  line-height: 1.4;
  font-weight: 500;
}

.panel-files {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}

.panel-file {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
  max-width: 100%;
  padding: 0.4rem 0.65rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  transition: border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;
}

.panel-file:hover {
  border-color: #99f6e4;
  background: #f0fdfa;
}

.panel-file--active {
  border-color: var(--primary-500, #6b7c3e);
  background: var(--primary-50, #f4f6ef);
  box-shadow: 0 1px 6px rgba(61, 79, 37, 0.1);
}

.panel-file__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 1.75rem;
  height: 1.75rem;
  border-radius: 6px;
  background: #ecfdf5;
  color: #0f766e;
}

.panel-file--active .panel-file__icon {
  background: #d1fae5;
  color: #047857;
}

.panel-file__body {
  display: flex;
  flex-direction: column;
  gap: 0.05rem;
  min-width: 0;
}

.panel-file__label {
  font-size: 0.8125rem;
  font-weight: 700;
  color: var(--text);
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.panel-file__meta {
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.panel-file__note {
  flex-shrink: 0;
  margin-left: 0.15rem;
  padding: 0.1rem 0.35rem;
  border-radius: 999px;
  font-size: 0.625rem;
  font-weight: 700;
  color: #0f766e;
  background: #ecfdf5;
}

.results-section + .results-section {
  margin-top: 0.85rem;
  padding-top: 0.85rem;
  border-top: 1px solid var(--border);
}

.results-section__title {
  margin: 0 0 0.5rem;
  font-size: 0.8125rem;
  color: var(--primary-700);
}

.results-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.45rem 0.55rem;
  margin: 0;
}

.result-item {
  margin: 0;
  padding: 0.45rem 0.55rem;
  border-radius: var(--radius-sm);
  background: #f8fafc;
  border: 1px solid var(--border);
}

.result-item--wide {
  grid-column: 1 / -1;
}

.result-item dt {
  margin: 0 0 0.15rem;
  font-size: 0.625rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--text-muted);
}

.result-item__ref {
  display: block;
  margin-top: 0.05rem;
  font-size: 0.5625rem;
  font-weight: 500;
  text-transform: none;
  letter-spacing: normal;
  color: var(--text-light);
}

.result-item dd {
  margin: 0;
  font-size: 0.875rem;
  font-weight: 700;
  color: var(--text);
  line-height: 1.3;
  white-space: pre-wrap;
  word-break: break-word;
}

.result-item__unit {
  margin-left: 0.2rem;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-muted);
}

.result-item__empty {
  font-weight: 500;
  color: var(--text-muted);
}

.result-item__comment {
  margin: 0.25rem 0 0;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-muted);
  white-space: pre-wrap;
  line-height: 1.3;
}

.doctor-comment-block {
  margin-top: 0.9rem;
  padding-top: 0.9rem;
  border-top: 1px solid var(--border);
}

.doctor-comment-block__meta {
  margin: -0.35rem 0 0;
  font-size: 0.75rem;
  color: var(--text-muted);
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 0.9rem;
}

@media (max-width: 1024px) {
  .results-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 768px) {
  .info-row {
    gap: 0.45rem 0.85rem;
  }

  .info-row__item--exams {
    flex-basis: 100%;
  }

  .results-grid {
    grid-template-columns: 1fr;
  }

  .panel-file {
    flex: 1 1 calc(50% - 0.45rem);
  }
}

@media (max-width: 480px) {
  .panel-file {
    flex: 1 1 100%;
  }
}
</style>
