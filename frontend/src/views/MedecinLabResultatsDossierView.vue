<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
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
import { buildPrescribedByLabel, printLabPanelResult } from '@/lib/lab-panel-print'
import { fetchAndPrintLabVisitResults } from '@/lib/lab-visit-print'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiTextarea from '@/components/ui/UiTextarea.vue'
import type { LabsResultsVisitRow } from '@/components/ui/LabsResultsDataTable.vue'

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
  buildPrescribedByLabel(visit.value?.consultation?.doctor ?? visit.value?.assignedDoctor ?? null),
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

async function loadDossier() {
  if (commentDraftDirty.value) return
  loading.value = true
  message.value = ''
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
    visit.value = null
    selectPanel(null)
    showMessage('Résultats laboratoire introuvables.', 'error')
  } finally {
    loading.value = false
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
    showMessage('Avis enregistré pour ce formulaire.')
  } catch {
    showMessage("Impossible d'enregistrer l'avis.", 'error')
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

const POLL_MS = 30_000
let pollTimer: ReturnType<typeof setInterval> | null = null

watch(
  () => route.params.visitId,
  () => {
    selectPanel(null)
    loadDossier()
  },
)

onMounted(async () => {
  await labPanels.fetchPanels()
  loadDossier()
  pollTimer = setInterval(loadDossier, POLL_MS)
})

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer)
})
</script>

<template>
  <div class="lab-dossier">
    <UiPageHeader
      :title="patientLabel || 'Résultats laboratoire'"
      :subtitle="visit ? `${visit.patient.code} — ${prescribedExamsPreview}` : 'Chargement…'"
      :icon="ClipboardList"
    >
      <template #actions>
        <UiButton
          v-if="panelFiles.length"
          variant="outline"
          size="sm"
          :icon="Printer"
          :disabled="printingAll"
          @click="printAllPanels"
        >
          {{ printingAll ? 'Impression…' : 'Imprimer tout le dossier' }}
        </UiButton>
        <UiButton
          v-if="visit?.patient?.id"
          variant="outline"
          size="sm"
          :icon="FolderOpen"
          @click="router.push({ name: 'dossier-patient', query: { patient: visit!.patient.id } })"
        >
          Dossier patient
        </UiButton>
        <UiButton
          variant="ghost"
          size="sm"
          :icon="ArrowLeft"
          @click="router.push({ name: 'medecin-labs-resultats' })"
        >
          Retour
        </UiButton>
      </template>
    </UiPageHeader>

    <UiAlert v-if="message" :type="messageType" :message="message" />

    <p v-if="loading" class="hint">Chargement des résultats…</p>

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
            <dt>Prescripteur</dt>
            <dd>{{ doctorLabel }}</dd>
          </div>
          <div>
            <dt>Examens laboratoire</dt>
            <dd :title="prescribedExamsFull">{{ prescribedExamsPreview }}</dd>
          </div>
          <div v-if="doctorComment" class="info-grid__full">
            <dt>Commentaire à la prescription</dt>
            <dd class="doctor-comment-preview">{{ doctorComment }}</dd>
          </div>
        </dl>
      </UiCard>

      <UiCard
        title="Résultats disponibles"
        :description="`${panelFiles.length} formulaire(s) — cliquez sur un fichier pour consulter`"
        icon-variant="teal"
        :icon="ClipboardList"
      >
        <p v-if="!panelFiles.length" class="hint">Aucun formulaire enregistré pour ce dossier.</p>

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
              <FileText :size="28" stroke-width="1.5" />
            </span>
            <span class="panel-file__label">{{ file.label }}</span>
            <span class="panel-file__meta">
              <span>{{ file.dateLabel }}</span>
              <span>{{ file.timeLabel }}</span>
            </span>
            <span v-if="panelHasDoctorComment(file.slug)" class="panel-file__note">Avis médecin</span>
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
              :class="{ 'result-item--wide': field.type === 'textarea' }"
            >
              <dt>
                {{ field.label }}
                <span v-if="field.reference" class="result-item__ref">({{ field.reference }})</span>
              </dt>
              <dd>
                {{ field.value }}
                <span v-if="field.unit" class="result-item__unit">{{ field.unit }}</span>
              </dd>
            </div>
          </dl>
        </div>

        <section class="doctor-comment-block">
          <UiTextarea
            v-model="commentDraft"
            label="Avis / commentaire du médecin"
            placeholder="Interprétation des résultats, recommandations, suite à donner au patient…"
            :rows="4"
          />
          <p v-if="activePanelComment?.updatedAt" class="doctor-comment-block__meta">
            Dernier enregistrement :
            {{ new Date(activePanelComment.updatedAt).toLocaleString('fr-FR') }}
          </p>
        </section>

        <div class="form-actions">
          <UiButton
            variant="primary"
            :icon="Save"
            :disabled="savingComment || !commentDraftDirty"
            @click="savePanelComment"
          >
            {{ savingComment ? 'Enregistrement…' : "Enregistrer l'avis" }}
          </UiButton>
          <UiButton variant="outline" :icon="Printer" @click="printPanel">
            Imprimer ce formulaire
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
  gap: 1rem;
}

.hint {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.875rem;
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

.info-grid__full {
  grid-column: 1 / -1;
}

.doctor-comment-preview {
  white-space: pre-wrap;
  line-height: 1.45;
}

.panel-files {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(10.5rem, 1fr));
  gap: 0.75rem;
}

.panel-file {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.45rem;
  padding: 1rem 0.75rem 0.85rem;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: #fff;
  cursor: pointer;
  text-align: center;
  font-family: inherit;
  transition: border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease, transform 0.12s ease;
}

.panel-file:hover {
  border-color: #99f6e4;
  background: #f0fdfa;
  box-shadow: 0 4px 14px rgba(15, 118, 110, 0.08);
}

.panel-file--active {
  border-color: var(--primary-500, #6b7c3e);
  background: var(--primary-50, #f4f6ef);
  box-shadow: 0 4px 16px rgba(61, 79, 37, 0.12);
}

.panel-file__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 3.25rem;
  height: 3.25rem;
  border-radius: 10px;
  background: #ecfdf5;
  color: #0f766e;
}

.panel-file--active .panel-file__icon {
  background: #d1fae5;
  color: #047857;
}

.panel-file__label {
  font-size: 0.8125rem;
  font-weight: 700;
  color: var(--text);
  line-height: 1.3;
}

.panel-file__meta {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.panel-file__note {
  margin-top: 0.15rem;
  font-size: 0.625rem;
  font-weight: 700;
  color: #0f766e;
}

.results-section + .results-section {
  margin-top: 1.25rem;
  padding-top: 1.25rem;
  border-top: 1px solid var(--border);
}

.results-section__title {
  margin: 0 0 0.75rem;
  font-size: 0.875rem;
  color: var(--primary-700);
}

.results-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.65rem 0.75rem;
  margin: 0;
}

.result-item {
  margin: 0;
  padding: 0.65rem 0.75rem;
  border-radius: var(--radius-sm);
  background: #f8fafc;
  border: 1px solid var(--border);
}

.result-item--wide {
  grid-column: 1 / -1;
}

.result-item dt {
  margin: 0 0 0.25rem;
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--text-muted);
}

.result-item__ref {
  display: block;
  margin-top: 0.1rem;
  font-size: 0.625rem;
  font-weight: 500;
  text-transform: none;
  letter-spacing: normal;
  color: var(--text-light);
}

.result-item dd {
  margin: 0;
  font-size: 0.9375rem;
  font-weight: 700;
  color: var(--text);
  line-height: 1.35;
  white-space: pre-wrap;
  word-break: break-word;
}

.result-item__unit {
  margin-left: 0.2rem;
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-muted);
}

.doctor-comment-block {
  margin-top: 1.25rem;
  padding-top: 1.25rem;
  border-top: 1px solid var(--border);
}

.doctor-comment-block__meta {
  margin: -0.5rem 0 0;
  font-size: 0.75rem;
  color: var(--text-muted);
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 1.25rem;
}

@media (max-width: 1024px) {
  .results-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 768px) {
  .info-grid,
  .results-grid {
    grid-template-columns: 1fr;
  }

  .panel-files {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 480px) {
  .panel-files {
    grid-template-columns: 1fr;
  }
}
</style>
