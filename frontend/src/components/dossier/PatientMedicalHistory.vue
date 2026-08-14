<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  ChevronDown,
  ChevronRight,
  FlaskConical,
  MessageSquare,
  Stethoscope,
  Eye,
  FileText,
  PillBottle,
  Printer,
  ClipboardList,
  Scissors,
} from '@lucide/vue'
import { fullName } from '@/lib/roles'
import { getLabFormPanel, getFilledLabPanelSections, labFieldCommentKey, type LabPanelSlug } from '@/lib/lab-form-panels'
import { useLabPanelsStore } from '@/stores/lab-panels'
import type { PharmacyOrdonnanceLine } from '@/lib/lab-notes'
import {
  groupPrescribedByPanel,
  formatPanelGroupDetails,
  type PrescribedPanelChipGroup,
} from '@/lib/lab-prescribed-panels'
import { printPharmacyOrdonnance } from '@/lib/pharmacy-ordonnance-print'
import UiButton from '@/components/ui/UiButton.vue'
import { useAppI18n } from '@/i18n/useAppI18n'
import { translateTemplate } from '@/lib/dashboard-i18n'

export type MedicalHistoryLabPanel = {
  slug: LabPanelSlug
  label: string
  filledCount: number
  values: Record<string, string>
}

export type MedicalHistoryEntry = {
  visitId: string
  date: string
  status: string
  doctor: { firstName: string; lastName: string } | null
  diagnosis?: string | null
  prescribedExams: string[]
  labExams?: string[]
  operations?: string[]
  labPanels: MedicalHistoryLabPanel[]
  doctorComment: string | null
  pharmacyOrdonnance?: PharmacyOrdonnanceLine[]
  hasLabResults: boolean
}

const props = defineProps<{
  entries: MedicalHistoryEntry[]
  loading?: boolean
  showOpenLabLink?: boolean
  emptyMessage?: string
  patient?: {
    code: string
    firstName: string
    lastName: string
    age?: number | null
    gender?: string | null
  } | null
  expandFirst?: boolean
  /** Visite encore ouverte : affiche « Continuer la consultation » sur cette entrée. */
  continueVisitId?: string | null
  continueLoading?: boolean
}>()

const emit = defineEmits<{
  'continue-consultation': [visitId: string]
}>()

const router = useRouter()
const labPanels = useLabPanelsStore()
const { uiText, dateText, timeText, localeCode, t } = useAppI18n()
const expandedVisitId = ref<string | null>(null)
/** Un seul formulaire labo déplié à la fois (compact, surtout tablette). */
const expandedPanelKey = ref<string | null>(null)

const continueConsultationLabel = computed(() => {
  void localeCode.value
  return t('common.continueConsultation')
})

onMounted(() => {
  labPanels.fetchPanels()
})

watch(
  () => [props.entries, props.expandFirst, props.continueVisitId] as const,
  ([entries, expandFirst, continueVisitId]) => {
    if (continueVisitId && entries.some((entry) => entry.visitId === continueVisitId)) {
      expandedVisitId.value = continueVisitId
      expandedPanelKey.value = null
      return
    }
    if (expandFirst !== false && entries.length && !expandedVisitId.value) {
      expandedVisitId.value = entries[0]!.visitId
      expandedPanelKey.value = null
    }
  },
  { immediate: true },
)

function formatDate(iso: string) {
  void localeCode.value
  return dateText(iso, {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  })
}

function formatTime(iso: string) {
  void localeCode.value
  return timeText(iso, { hour: '2-digit', minute: '2-digit' })
}

function pharmacyLines(entry: MedicalHistoryEntry) {
  return entry.pharmacyOrdonnance ?? []
}

function labExamsOf(entry: MedicalHistoryEntry) {
  if (entry.labExams?.length) return entry.labExams
  return []
}

function operationsOf(entry: MedicalHistoryEntry) {
  if (entry.operations?.length) return entry.operations
  return []
}

function otherPrescribedOf(entry: MedicalHistoryEntry) {
  const known = new Set([...labExamsOf(entry), ...operationsOf(entry)])
  return entry.prescribedExams.filter((exam) => !known.has(exam))
}

function prescribedExamGroups(entry: MedicalHistoryEntry): PrescribedPanelChipGroup[] {
  return groupPrescribedByPanel([...labExamsOf(entry), ...otherPrescribedOf(entry)])
}

function formatPharmacyLine(line: PharmacyOrdonnanceLine) {
  void localeCode.value
  const parts = [line.name]
  if (line.dosage?.trim()) parts.push(line.dosage.trim())
  parts.push(`× ${line.quantity}`)
  if (line.instructions?.trim()) parts.push(`— ${line.instructions.trim()}`)
  if (!line.productId?.trim()) parts.push(uiText('(hors pharmacie)'))
  return parts.join(' ')
}

function statusLabel(status: string) {
  void localeCode.value
  const map: Record<string, string> = {
    WAITING_CONSULTATION: uiText('En attente'),
    IN_CONSULTATION: uiText('En consultation'),
    WAITING_LAB: uiText('Laboratoire'),
    WAITING_PAYMENT: uiText('Paiement'),
    COMPLETED: uiText('Terminée'),
    CANCELLED: uiText('Annulée'),
  }
  return map[status] ?? status
}

function toggleVisit(visitId: string) {
  if (expandedVisitId.value === visitId) {
    expandedVisitId.value = null
    expandedPanelKey.value = null
    return
  }
  expandedVisitId.value = visitId
  expandedPanelKey.value = null
}

function panelExpandKey(visitId: string, slug: string) {
  return `${visitId}:${slug}`
}

function isPanelExpanded(visitId: string, slug: string) {
  return expandedPanelKey.value === panelExpandKey(visitId, slug)
}

function togglePanel(visitId: string, slug: string) {
  const key = panelExpandKey(visitId, slug)
  expandedPanelKey.value = expandedPanelKey.value === key ? null : key
}

function panelSummary(entry: MedicalHistoryEntry, slug: LabPanelSlug) {
  void localeCode.value
  const parts = panelSections(entry, slug).flatMap((section) =>
    section.fields.map((field) => {
      const label = uiText(field.label)
      const unit = field.unit && field.value ? ` ${field.unit}` : ''
      return `${label}: ${field.value || '—'}${unit}`
    }),
  )
  if (!parts.length) return uiText('Aucune valeur détaillée.')
  if (parts.length <= 2) return parts.join(' · ')
  return `${parts.slice(0, 2).join(' · ')} · +${parts.length - 2}`
}

function openLabDossier(visitId: string) {
  router.push({ name: 'medecin-labs-resultats-dossier', params: { visitId } })
}

function panelSections(entry: MedicalHistoryEntry, slug: LabPanelSlug) {
  const values = entry.labPanels.find((p) => p.slug === slug)?.values ?? {}
  const panel = getLabFormPanel(slug)
  if (panel) {
    const sections = getFilledLabPanelSections(panel, values)
    if (sections.length) return sections
  }

  // Repli : afficher les clés saisies même si le formulaire a changé / n'est pas chargé.
  const fields = Object.entries(values)
    .filter(([key, value]) => !key.endsWith('__comment') && String(value ?? '').trim())
    .map(([key, value]) => {
      const comment = String(values[labFieldCommentKey(key)] ?? '').trim()
      return {
        key,
        label: key,
        type: 'text' as const,
        value: String(value).trim(),
        unit: undefined as string | undefined,
        comment: comment || undefined,
      }
    })

  return fields.length ? [{ title: undefined as string | undefined, fields }] : []
}

function printOrdonnance(entry: MedicalHistoryEntry) {
  if (!props.patient) return
  const lines = pharmacyLines(entry)
  if (!lines.length) return
  printPharmacyOrdonnance({
    patient: props.patient,
    doctorName: entry.doctor
      ? `Dr ${fullName(entry.doctor.firstName, entry.doctor.lastName)}`
      : null,
    lines,
    date: entry.date,
  })
}
</script>

<template>
  <p v-if="loading" class="history-empty">{{ uiText("Chargement de l'historique…") }}</p>
  <p v-else-if="!entries.length" class="history-empty">
    {{
      emptyMessage ??
      uiText(
        'Aucune consultation, ordonnance, examen ou commentaire enregistré pour ce patient.',
      )
    }}
  </p>

  <ol v-else class="timeline">
    <li v-for="entry in entries" :key="entry.visitId" class="timeline-item">
      <div
        class="timeline-item__marker"
        :class="{
          'timeline-item__marker--lab': entry.labPanels.length,
          'timeline-item__marker--clinical':
            !entry.labPanels.length &&
            (entry.doctorComment || entry.diagnosis || pharmacyLines(entry).length),
        }"
      />

      <article class="timeline-card">
        <div class="timeline-card__top">
          <button type="button" class="timeline-card__head" @click="toggleVisit(entry.visitId)">
            <div class="timeline-card__title-row">
              <component :is="expandedVisitId === entry.visitId ? ChevronDown : ChevronRight" :size="16" />
              <strong>{{ formatDate(entry.date) }}</strong>
              <span class="timeline-card__time">{{ formatTime(entry.date) }}</span>
              <span class="badge badge--status">{{ statusLabel(entry.status) }}</span>
            </div>
            <div class="timeline-card__badges">
              <span v-if="entry.diagnosis" class="badge badge--diagnosis">
                <ClipboardList :size="12" />
                {{ uiText('Diagnostic') }}
              </span>
              <span v-if="entry.doctorComment" class="badge badge--comment">
                <MessageSquare :size="12" />
                {{ uiText('Note finale') }}
              </span>
              <span v-if="pharmacyLines(entry).length" class="badge badge--pharmacy">
                <PillBottle :size="12" />
                {{ pharmacyLines(entry).length }}
              </span>
              <span v-if="prescribedExamGroups(entry).length" class="badge badge--exam">
                <FlaskConical :size="12" />
                {{ prescribedExamGroups(entry).length }}
              </span>
              <span v-if="operationsOf(entry).length" class="badge badge--operation">
                <Scissors :size="12" />
                {{ operationsOf(entry).length }}
              </span>
              <span v-if="entry.labPanels.length" class="badge badge--result">
                {{ translateTemplate('{n} résultat(s)', { n: entry.labPanels.length }) }}
              </span>
            </div>
            <p v-if="entry.diagnosis && expandedVisitId !== entry.visitId" class="timeline-card__preview">
              {{ entry.diagnosis }}
            </p>
            <p
              v-else-if="entry.doctorComment && expandedVisitId !== entry.visitId"
              class="timeline-card__preview"
            >
              {{ entry.doctorComment }}
            </p>
            <p
              v-else-if="entry.labPanels.length && expandedVisitId !== entry.visitId"
              class="timeline-card__preview"
            >
              {{ entry.labPanels.map((panel) => uiText(panel.label)).join(' · ') }}
            </p>
          </button>

          <div
            v-if="continueVisitId && continueVisitId === entry.visitId"
            class="timeline-card__continue"
          >
            <UiButton
              variant="primary"
              size="sm"
              :icon="Stethoscope"
              :loading="continueLoading"
              @click="emit('continue-consultation', entry.visitId)"
            >
              {{ continueConsultationLabel }}
            </UiButton>
          </div>
        </div>

        <div v-if="expandedVisitId === entry.visitId" class="timeline-card__body">
          <div class="timeline-card__toolbar">
            <p v-if="entry.doctor" class="timeline-meta">
              <Stethoscope :size="14" />
              {{
                translateTemplate('Dr {name}', {
                  name: fullName(entry.doctor.firstName, entry.doctor.lastName),
                })
              }}
            </p>
            <UiButton
              v-if="patient && pharmacyLines(entry).length"
              variant="ghost"
              size="sm"
              :icon="Printer"
              @click="printOrdonnance(entry)"
            >
              {{ uiText('Ordonnance') }}
            </UiButton>
          </div>

          <div v-if="entry.diagnosis" class="timeline-block timeline-block--diagnosis">
            <h4>{{ uiText('Diagnostic') }}</h4>
            <p class="timeline-block__text">{{ entry.diagnosis }}</p>
          </div>

          <div v-if="entry.labPanels.length" class="timeline-block">
            <div class="timeline-block__head">
              <h4>
                {{ uiText('Résultats labo') }}
                <span class="timeline-block__count">{{ entry.labPanels.length }}</span>
              </h4>
              <UiButton
                v-if="showOpenLabLink && entry.hasLabResults"
                variant="ghost"
                size="sm"
                :icon="Eye"
                @click="openLabDossier(entry.visitId)"
              >
                {{ uiText('Détail') }}
              </UiButton>
            </div>

            <div class="panel-grid">
              <div
                v-for="panel in entry.labPanels"
                :key="panel.slug"
                class="panel-card"
                :class="{ 'panel-card--open': isPanelExpanded(entry.visitId, panel.slug) }"
              >
                <button
                  type="button"
                  class="panel-card__head"
                  :aria-expanded="isPanelExpanded(entry.visitId, panel.slug)"
                  @click="togglePanel(entry.visitId, panel.slug)"
                >
                  <component
                    :is="isPanelExpanded(entry.visitId, panel.slug) ? ChevronDown : ChevronRight"
                    :size="14"
                    class="panel-card__chevron"
                  />
                  <FileText :size="14" />
                  <span class="panel-card__title">{{ uiText(panel.label) }}</span>
                  <span class="panel-card__count">{{ panel.filledCount }}</span>
                </button>
                <p
                  v-if="!isPanelExpanded(entry.visitId, panel.slug)"
                  class="panel-card__summary"
                >
                  {{ panelSummary(entry, panel.slug) }}
                </p>
                <div v-else class="panel-card__body">
                  <div
                    v-for="section in panelSections(entry, panel.slug)"
                    :key="section.title ?? 'default'"
                    class="result-section"
                  >
                    <h5 v-if="section.title">{{ uiText(section.title) }}</h5>
                    <dl class="result-grid">
                      <template v-for="field in section.fields" :key="field.key">
                        <dt>{{ uiText(field.label) }}</dt>
                        <dd>
                          {{ field.value || '—' }}
                          <span v-if="field.unit && field.value" class="unit">
                            {{ field.unit }}
                          </span>
                          <p v-if="field.comment" class="result-comment">{{ field.comment }}</p>
                        </dd>
                      </template>
                    </dl>
                  </div>
                  <p v-if="!panelSections(entry, panel.slug).length" class="result-empty">
                    {{ uiText('Aucune valeur détaillée.') }}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div
            v-if="prescribedExamGroups(entry).length || pharmacyLines(entry).length || entry.doctorComment"
            class="timeline-grid"
          >
            <div v-if="prescribedExamGroups(entry).length" class="timeline-block timeline-grid__item">
              <h4>{{ uiText('Examens prescrits') }}</h4>
              <div class="chip-row">
                <span
                  v-for="group in prescribedExamGroups(entry)"
                  :key="`exam-${group.panel}`"
                  class="mini-chip"
                  :title="formatPanelGroupDetails(group)"
                >
                  {{ uiText(group.panel) }} ({{ group.items.length }})
                </span>
              </div>
            </div>

            <div v-if="pharmacyLines(entry).length" class="timeline-block timeline-block--pharmacy timeline-grid__item">
              <h4>{{ uiText('Ordonnance') }}</h4>
              <ul class="pharmacy-list">
                <li v-for="line in pharmacyLines(entry)" :key="`${line.productId}-${line.name}`">
                  {{ formatPharmacyLine(line) }}
                </li>
              </ul>
            </div>

            <div v-if="entry.doctorComment" class="timeline-block timeline-block--comment timeline-grid__item">
              <h4>{{ uiText('Commentaire final') }}</h4>
              <p class="timeline-block__text">{{ entry.doctorComment }}</p>
            </div>
          </div>

          <div v-if="operationsOf(entry).length" class="timeline-block timeline-block--operation">
            <h4>{{ uiText('Opérations') }}</h4>
            <div class="chip-row">
              <span
                v-for="op in operationsOf(entry)"
                :key="`op-${op}`"
                class="mini-chip mini-chip--op"
              >
                <Scissors :size="12" />
                {{ uiText(op) }}
              </span>
            </div>
          </div>
        </div>
      </article>
    </li>
  </ol>
</template>

<style scoped>
.history-empty {
  margin: 0;
  padding: 1.5rem;
  text-align: center;
  color: var(--text-muted);
  font-size: 0.875rem;
}

.timeline {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.timeline-item {
  display: grid;
  grid-template-columns: 12px 1fr;
  gap: 0.85rem;
  align-items: start;
}

.timeline-item__marker {
  width: 12px;
  height: 12px;
  margin-top: 1.1rem;
  border-radius: 50%;
  background: var(--primary-400);
  box-shadow: 0 0 0 4px rgba(27, 79, 156, 0.12);
}

.timeline-item__marker--lab {
  background: #0d9488;
  box-shadow: 0 0 0 4px rgba(13, 148, 136, 0.14);
}

.timeline-item__marker--clinical {
  background: #7c3aed;
  box-shadow: 0 0 0 4px rgba(124, 58, 237, 0.14);
}

.timeline-card {
  border: 1px solid rgba(15, 40, 80, 0.1);
  border-radius: 14px;
  background: #fff;
  overflow: hidden;
}

.timeline-card__top {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 0.65rem 0.85rem;
  padding-right: 0.85rem;
}

.timeline-card__head {
  flex: 1 1 14rem;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  padding: 0.9rem 0.15rem 0.9rem 1rem;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.timeline-card__continue {
  flex: 0 0 auto;
  align-self: center;
  padding: 0.65rem 0;
}

.timeline-card__title-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.45rem;
  color: var(--text);
}

.timeline-card__time {
  color: var(--text-muted);
  font-size: 0.8125rem;
}

.timeline-card__badges {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.timeline-card__preview {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--text-muted);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.badge {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.2rem 0.5rem;
  border-radius: 999px;
  font-size: 0.6875rem;
  font-weight: 700;
}

.badge--status {
  background: rgba(100, 116, 139, 0.12);
  color: #475569;
}

.badge--diagnosis {
  background: rgba(124, 58, 237, 0.12);
  color: #6d28d9;
}

.badge--comment {
  background: rgba(27, 79, 156, 0.1);
  color: #1b4f9c;
}

.badge--pharmacy {
  background: rgba(5, 150, 105, 0.12);
  color: #047857;
}

.badge--exam {
  background: rgba(14, 165, 233, 0.12);
  color: #0369a1;
}

.badge--result {
  background: rgba(13, 148, 136, 0.12);
  color: #0f766e;
}

.badge--operation {
  background: rgba(180, 83, 9, 0.12);
  color: #b45309;
}

.timeline-card__body {
  padding: 0 1rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  border-top: 1px solid rgba(15, 40, 80, 0.08);
}

.timeline-card__toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding-top: 0.75rem;
}

.timeline-meta {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  margin: 0;
  font-size: 0.8125rem;
  color: var(--text-muted);
}

.timeline-block {
  padding: 0.75rem 0.85rem;
  border-radius: 10px;
  background: rgba(15, 40, 80, 0.03);
}

.timeline-grid {
  display: grid;
  gap: 0.75rem;
  grid-template-columns: repeat(1, minmax(0, 1fr));
}

.timeline-grid__item {
  height: 100%;
}

.timeline-block--diagnosis {
  background: rgba(124, 58, 237, 0.06);
  border: 1px solid rgba(124, 58, 237, 0.14);
}

.timeline-block--comment {
  background: rgba(27, 79, 156, 0.05);
  border: 1px solid rgba(27, 79, 156, 0.1);
}

.timeline-block--pharmacy {
  background: rgba(5, 150, 105, 0.06);
  border: 1px solid rgba(5, 150, 105, 0.12);
}

.timeline-block--operation {
  background: rgba(180, 83, 9, 0.06);
  border: 1px solid rgba(180, 83, 9, 0.14);
}

.chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.mini-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.25rem 0.55rem;
  border-radius: 999px;
  background: #fff;
  border: 1px solid rgba(15, 40, 80, 0.12);
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text);
}

.mini-chip--op {
  border-color: rgba(180, 83, 9, 0.25);
  color: #9a3412;
}

.timeline-block h4 {
  margin: 0 0 0.4rem;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}

.timeline-block__text,
.exam-list {
  margin: 0;
  font-size: 0.875rem;
  line-height: 1.5;
  white-space: pre-wrap;
}

.timeline-block__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.timeline-block__head h4 {
  margin: 0;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}

.timeline-block__count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.35rem;
  height: 1.35rem;
  padding: 0 0.35rem;
  border-radius: 999px;
  font-size: 0.6875rem;
  font-weight: 700;
  color: #0f766e;
  background: rgba(13, 148, 136, 0.14);
  text-transform: none;
  letter-spacing: 0;
}

.pharmacy-list {
  margin: 0;
  padding-left: 1.1rem;
  font-size: 0.875rem;
}

.panel-grid {
  display: grid;
  gap: 0.4rem;
}

.panel-card {
  border: 1px solid rgba(15, 40, 80, 0.1);
  border-radius: 8px;
  overflow: hidden;
  background: #fff;
}

.panel-card--open {
  border-color: rgba(13, 148, 136, 0.28);
}

.panel-card__head {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.5rem 0.65rem;
  border: 0;
  background: rgba(13, 148, 136, 0.06);
  font-size: 0.8125rem;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
  color: inherit;
}

.panel-card__head:hover {
  background: rgba(13, 148, 136, 0.1);
}

.panel-card__chevron {
  flex-shrink: 0;
  color: var(--text-muted);
}

.panel-card__title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.panel-card__count {
  margin-inline-start: auto;
  flex-shrink: 0;
  color: var(--text-muted);
  font-weight: 500;
}

.panel-card__summary {
  margin: 0;
  padding: 0.4rem 0.65rem 0.55rem;
  font-size: 0.75rem;
  line-height: 1.35;
  color: var(--text-muted);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.panel-card__body {
  padding: 0.45rem 0.65rem 0.6rem;
  border-top: 1px solid rgba(15, 40, 80, 0.06);
}

.result-empty {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--text-muted);
}

.result-section + .result-section {
  margin-top: 0.55rem;
}

.result-section h5 {
  margin: 0 0 0.3rem;
  font-size: 0.75rem;
  color: var(--text-muted);
}

.result-grid {
  display: grid;
  grid-template-columns: minmax(6rem, 38%) 1fr;
  gap: 0.2rem 0.5rem;
  margin: 0;
  font-size: 0.8125rem;
}

.result-grid dt {
  color: var(--text-muted);
}

.result-grid dd {
  margin: 0;
  word-break: break-word;
}

.unit {
  color: var(--text-muted);
  font-size: 0.75rem;
}

.result-comment {
  margin: 0.15rem 0 0;
  color: var(--text-muted);
  font-size: 0.75rem;
  font-style: italic;
}

@media (max-width: 1024px) {
  .timeline-card__body {
    padding: 0 0.75rem 0.75rem;
    gap: 0.55rem;
  }

  .timeline-block {
    padding: 0.55rem 0.65rem;
  }

  .timeline-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .panel-card__summary {
    -webkit-line-clamp: 1;
  }

  .result-grid {
    grid-template-columns: minmax(5.5rem, 42%) 1fr;
    font-size: 0.78rem;
  }
}

@media (min-width: 1280px) {
  .timeline-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .timeline-item {
    grid-template-columns: 8px 1fr;
    gap: 0.55rem;
  }

  .timeline-card__head {
    padding: 0.7rem 0.1rem 0.7rem 0.75rem;
  }

  .timeline-card__continue {
    width: 100%;
    padding: 0 0.75rem 0.65rem;
  }

  .timeline-card__continue :deep(.ui-btn) {
    width: 100%;
  }

  .timeline-grid {
    grid-template-columns: 1fr;
  }
}
</style>
