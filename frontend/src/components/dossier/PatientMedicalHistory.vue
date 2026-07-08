<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ChevronDown, ChevronRight, FlaskConical, MessageSquare, Stethoscope, Eye, FileText } from '@lucide/vue'
import { fullName } from '@/lib/roles'
import { getLabFormPanel, getFilledLabPanelSections, type LabPanelSlug } from '@/lib/lab-form-panels'
import { useLabPanelsStore } from '@/stores/lab-panels'
import UiButton from '@/components/ui/UiButton.vue'

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
  prescribedExams: string[]
  labPanels: MedicalHistoryLabPanel[]
  doctorComment: string | null
  hasLabResults: boolean
}

const props = defineProps<{
  entries: MedicalHistoryEntry[]
  loading?: boolean
  showOpenLabLink?: boolean
  emptyMessage?: string
}>()

const router = useRouter()
const labPanels = useLabPanelsStore()
const expandedVisitId = ref<string | null>(null)
const expandedPanel = ref<{ visitId: string; slug: LabPanelSlug } | null>(null)

onMounted(() => {
  labPanels.fetchPanels()
})

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  })
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

function toggleVisit(visitId: string) {
  expandedVisitId.value = expandedVisitId.value === visitId ? null : visitId
  expandedPanel.value = null
}

function togglePanel(visitId: string, slug: LabPanelSlug) {
  const same =
    expandedPanel.value?.visitId === visitId && expandedPanel.value.slug === slug
  expandedPanel.value = same ? null : { visitId, slug }
}

function openLabDossier(visitId: string) {
  router.push({ name: 'medecin-labs-resultats-dossier', params: { visitId } })
}

function panelSections(entry: MedicalHistoryEntry, slug: LabPanelSlug) {
  const panel = getLabFormPanel(slug)
  if (!panel) return []
  const values = entry.labPanels.find((p) => p.slug === slug)?.values ?? {}
  return getFilledLabPanelSections(panel, values)
}
</script>

<template>
  <p v-if="loading" class="history-empty">Chargement de l'historique…</p>
  <p v-else-if="!entries.length" class="history-empty">
    {{ emptyMessage ?? 'Aucune consultation, examen ou commentaire enregistré pour ce patient.' }}
  </p>

  <ol v-else class="timeline">
    <li v-for="entry in entries" :key="entry.visitId" class="timeline-item">
      <div class="timeline-item__marker" :class="{ 'timeline-item__marker--lab': entry.labPanels.length }" />

      <article class="timeline-card">
        <button type="button" class="timeline-card__head" @click="toggleVisit(entry.visitId)">
          <div class="timeline-card__title-row">
            <component :is="expandedVisitId === entry.visitId ? ChevronDown : ChevronRight" :size="16" />
            <strong>{{ formatDate(entry.date) }}</strong>
            <span class="timeline-card__time">{{ formatTime(entry.date) }}</span>
          </div>
          <div class="timeline-card__badges">
            <span v-if="entry.prescribedExams.length" class="badge badge--exam">
              <FlaskConical :size="12" />
              {{ entry.prescribedExams.length }} examen(s)
            </span>
            <span v-if="entry.labPanels.length" class="badge badge--result">
              {{ entry.labPanels.length }} résultat(s)
            </span>
            <span v-if="entry.doctorComment" class="badge badge--comment">
              <MessageSquare :size="12" />
              Commentaire
            </span>
          </div>
        </button>

        <div v-if="expandedVisitId === entry.visitId" class="timeline-card__body">
          <p v-if="entry.doctor" class="timeline-meta">
            <Stethoscope :size="14" />
            Dr {{ fullName(entry.doctor.firstName, entry.doctor.lastName) }}
          </p>

          <div v-if="entry.prescribedExams.length" class="timeline-block">
            <h4>Examens prescrits</h4>
            <p class="exam-list">{{ entry.prescribedExams.join(' · ') }}</p>
          </div>

          <div v-if="entry.doctorComment" class="timeline-block timeline-block--comment">
            <h4>Commentaire médecin</h4>
            <p>{{ entry.doctorComment }}</p>
          </div>

          <div v-if="entry.labPanels.length" class="timeline-block">
            <div class="timeline-block__head">
              <h4>Résultats laboratoire</h4>
              <UiButton
                v-if="showOpenLabLink && entry.hasLabResults"
                variant="ghost"
                size="sm"
                :icon="Eye"
                @click="openLabDossier(entry.visitId)"
              >
                Ouvrir en détail
              </UiButton>
            </div>

            <div class="panel-grid">
              <div v-for="panel in entry.labPanels" :key="panel.slug" class="panel-card">
                <button
                  type="button"
                  class="panel-card__head"
                  @click="togglePanel(entry.visitId, panel.slug)"
                >
                  <FileText :size="14" />
                  <span>{{ panel.label }}</span>
                  <span class="panel-card__count">{{ panel.filledCount }} valeur(s)</span>
                </button>

                <div
                  v-if="expandedPanel?.visitId === entry.visitId && expandedPanel.slug === panel.slug"
                  class="panel-card__body"
                >
                  <div
                    v-for="section in panelSections(entry, panel.slug)"
                    :key="section.title ?? 'default'"
                    class="result-section"
                  >
                    <h5 v-if="section.title">{{ section.title }}</h5>
                    <dl class="result-grid">
                      <template v-for="field in section.fields" :key="field.key">
                        <dt>{{ field.label }}</dt>
                        <dd>
                          {{ panel.values[field.key]?.trim() || '—' }}
                          <span v-if="field.unit && panel.values[field.key]?.trim()" class="unit">
                            {{ field.unit }}
                          </span>
                        </dd>
                      </template>
                    </dl>
                  </div>
                </div>
              </div>
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
  box-shadow: 0 0 0 3px var(--primary-50);
}

.timeline-item__marker--lab {
  background: #7c3aed;
  box-shadow: 0 0 0 3px #ede9fe;
}

.timeline-card {
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: #fff;
  overflow: hidden;
}

.timeline-card__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.65rem;
  width: 100%;
  padding: 0.85rem 1rem;
  border: 0;
  background: linear-gradient(180deg, #fafafa 0%, #fff 100%);
  text-align: left;
  cursor: pointer;
}

.timeline-card__title-row {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  color: var(--text);
}

.timeline-card__time {
  font-size: 0.8125rem;
  color: var(--text-muted);
  font-weight: 500;
}

.timeline-card__badges {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.badge {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.2rem 0.55rem;
  border-radius: 999px;
  font-size: 0.6875rem;
  font-weight: 700;
}

.badge--exam {
  background: #fef3c7;
  color: #92400e;
}

.badge--result {
  background: #ede9fe;
  color: #5b21b6;
}

.badge--comment {
  background: #ccfbf1;
  color: #0f766e;
}

.timeline-card__body {
  padding: 0 1rem 1rem;
  border-top: 1px solid var(--border);
}

.timeline-meta {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  margin: 0.85rem 0 0.5rem;
  font-size: 0.8125rem;
  color: var(--text-muted);
}

.timeline-block {
  margin-top: 0.85rem;
}

.timeline-block h4 {
  margin: 0 0 0.4rem;
  font-size: 0.8125rem;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.timeline-block__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.exam-list {
  margin: 0;
  font-size: 0.875rem;
  line-height: 1.5;
}

.timeline-block--comment p {
  margin: 0;
  padding: 0.65rem 0.75rem;
  border-radius: var(--radius-sm);
  background: #f0fdfa;
  border: 1px solid #99f6e4;
  font-size: 0.875rem;
  line-height: 1.5;
  white-space: pre-wrap;
}

.panel-grid {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.panel-card {
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.panel-card__head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.6rem 0.75rem;
  border: 0;
  background: #f8fafc;
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;
  text-align: left;
}

.panel-card__count {
  margin-left: auto;
  font-size: 0.6875rem;
  font-weight: 700;
  color: var(--text-muted);
}

.panel-card__body {
  padding: 0.75rem;
  border-top: 1px solid var(--border);
}

.result-section + .result-section {
  margin-top: 0.75rem;
  padding-top: 0.75rem;
  border-top: 1px dashed var(--border);
}

.result-section h5 {
  margin: 0 0 0.5rem;
  font-size: 0.75rem;
  color: var(--text-muted);
}

.result-grid {
  display: grid;
  grid-template-columns: minmax(8rem, 1.2fr) 1fr;
  gap: 0.35rem 0.75rem;
  margin: 0;
  font-size: 0.8125rem;
}

.result-grid dt {
  color: var(--text-muted);
  font-weight: 500;
}

.result-grid dd {
  margin: 0;
  font-weight: 600;
}

.unit {
  margin-left: 0.2rem;
  font-weight: 500;
  color: var(--text-muted);
  font-size: 0.75rem;
}
</style>
