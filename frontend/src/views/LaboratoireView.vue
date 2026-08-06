<script setup lang="ts">
import { computed, onActivated, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  FlaskConical,
  RefreshCw,
  Search,
  Clock,
  CheckCircle2,
  CalendarDays,
  ClipboardEdit,
} from '@lucide/vue'
import api from '@/api/client'
import { useSilentRefresh } from '@/composables/useSilentRefresh'
import { useLabAlertsStore } from '@/stores/lab-alerts'
import {
  countLabPrescribedExams,
  formatLabPrescribedExamsPreview,
  formatLabPrescribedExamsSummary,
} from '@/lib/lab-notes'
import { matchesLabVisitSearch } from '@/lib/lab-visit-search'
import { fullName } from '@/lib/roles'
import { useAppI18n } from '@/i18n/useAppI18n'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiStatCard from '@/components/ui/UiStatCard.vue'
import LabQueueBell from '@/components/layout/LabQueueBell.vue'
import { type LabsWaitingVisitRow } from '@/components/ui/LabsWaitingDataTable.vue'
import '@/assets/lab-visit-table.css'

const router = useRouter()
const labAlerts = useLabAlertsStore()
const { uiText, dateText, timeText, numberText } = useAppI18n()
const visits = ref<LabsWaitingVisitRow[]>([])
const completedCount = ref(0)
const listSearch = ref('')
const loading = ref(false)
const loadError = ref('')

const stats = computed(() => {
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const todayMs = todayStart.getTime()

  let totalExams = 0
  let transferredToday = 0

  for (const visit of visits.value) {
    totalExams += countLabPrescribedExams(visit.consultation?.clinicalNotes)
    const sentAt = visit.consultation?.labSentToLabAt ?? visit.updatedAt
    if (new Date(sentAt).getTime() >= todayMs) transferredToday += 1
  }

  return {
    pending: visits.value.length,
    totalExams,
    transferredToday,
    completed: completedCount.value,
  }
})

const filteredVisits = computed(() =>
  visits.value.filter((visit) => matchesLabVisitSearch(visit, listSearch.value)),
)

const rows = computed(() =>
  filteredVisits.value
    .map((visit) => {
      const notes = visit.consultation?.clinicalNotes
      const eventAt = new Date(visit.consultation?.labSentToLabAt ?? visit.updatedAt)
      const doctor = visit.consultation?.doctor ?? visit.assignedDoctor
      return {
        id: visit.id,
        code: visit.patient.code,
        patientName: fullName(visit.patient.firstName, visit.patient.lastName),
        patientPhone: visit.patient.phone || '',
        doctorName: doctor ? `Dr ${fullName(doctor.firstName, doctor.lastName)}` : '—',
        exams: formatLabPrescribedExamsPreview(notes),
        examsFull: formatLabPrescribedExamsSummary(notes),
        examCount: countLabPrescribedExams(notes),
        eventDate: dateText(eventAt),
        eventTime: timeText(eventAt),
        eventSort: eventAt.getTime(),
      }
    })
    .sort((a, b) => b.eventSort - a.eventSort),
)

const hasActiveSearch = computed(() => listSearch.value.trim().length > 0)

async function loadQueue(opts?: { silent?: boolean }) {
  if (!opts?.silent) loading.value = true
  if (!opts?.silent) loadError.value = ''
  try {
    const [queueRes, completedRes] = await Promise.all([
      api.get<LabsWaitingVisitRow[]>('/laboratoire/queue'),
      api.get<LabsWaitingVisitRow[]>('/laboratoire/completed'),
    ])
    visits.value = queueRes.data
    completedCount.value = completedRes.data.length
    // Même chiffre que la carte « Examens » — source de vérité pour la cloche.
    labAlerts.syncFromQueueVisits(queueRes.data)
  } catch {
    if (!opts?.silent) {
      loadError.value = 'Impossible de charger la file d\'attente laboratoire.'
      visits.value = []
      completedCount.value = 0
      labAlerts.syncFromQueueVisits([])
    }
  } finally {
    if (!opts?.silent) loading.value = false
  }
}

function goToDossier(visitId: string) {
  router.push({ name: 'laboratoire-dossier', params: { visitId } })
}

function resetSearch() {
  listSearch.value = ''
}

const { refresh: refreshQueue } = useSilentRefresh(
  ({ silent }) => loadQueue({ silent }),
  {
    intervalMs: 20_000,
  },
)

onActivated(() => {
  void refreshQueue({ silent: true })
})
</script>

<template>
  <div class="page-with-table lab-page">
    <section class="page-with-table__head">
      <UiPageHeader
        title="Analyses en attente"
        subtitle="Examens de laboratoire transférés — en attente de résultats"
        :icon="FlaskConical"
      >
        <template #actions>
          <div class="lab-header-actions">
            <LabQueueBell />
            <UiButton variant="ghost" size="sm" :icon="RefreshCw" :disabled="loading" @click="refreshQueue()">
              Actualiser
            </UiButton>
          </div>
        </template>
      </UiPageHeader>

      <UiAlert v-if="loadError" type="error" :message="loadError" />

      <div class="stats-grid" :class="{ 'stats-grid--loading': loading }">
        <UiStatCard mini label="En attente" :value="numberText(stats.pending)" :icon="Clock" variant="amber" />
        <UiStatCard mini label="Examens" :value="numberText(stats.totalExams)" :icon="FlaskConical" variant="teal" />
        <UiStatCard mini label="Aujourd'hui" :value="numberText(stats.transferredToday)" :icon="CalendarDays" variant="blue" />
        <UiStatCard mini label="Terminés" :value="numberText(stats.completed)" :icon="CheckCircle2" variant="green" />
      </div>
    </section>

    <section class="page-with-table__body">
      <UiCard
        title="Liste des dossiers"
        class="ui-card--table-panel lab-table-card"
        :icon="FlaskConical"
        icon-variant="teal"
      >
        <template #actions>
          <div class="lab-toolbar">
            <label class="lab-toolbar__search">
              <Search :size="16" aria-hidden="true" />
              <input
                v-model="listSearch"
                type="search"
                :placeholder="uiText('Patient, matricule, examen, médecin…')"
                :aria-label="uiText('Rechercher un dossier')"
              />
            </label>
            <UiButton v-if="hasActiveSearch" variant="ghost" size="sm" @click="resetSearch">
              Effacer
            </UiButton>
            <span class="lab-toolbar__count">{{
              uiText('{n} dossier(s)').replace('{n}', numberText(filteredVisits.length))
            }}</span>
          </div>
        </template>
        <p v-if="loading && !visits.length" class="empty">{{ uiText('Chargement des analyses en cours…') }}</p>
        <p v-else-if="!loading && !visits.length" class="empty">
          {{ uiText('Aucun examen de laboratoire en attente pour le moment.') }}
        </p>
        <p v-else-if="!loading && visits.length && !rows.length" class="empty">
          {{ uiText('Aucun dossier ne correspond à votre recherche.') }}
        </p>
        <div v-else class="lab-visit-table-wrap">
          <table class="lab-visit-table">
            <thead>
              <tr>
                <th class="lab-visit-table__num">#</th>
                <th>{{ uiText('Matricule') }}</th>
                <th>{{ uiText('Patient') }}</th>
                <th>{{ uiText('Médecin') }}</th>
                <th>{{ uiText('Examens') }}</th>
                <th>{{ uiText('Transféré le') }}</th>
                <th class="lab-visit-table__actions-head">{{ uiText('Actions') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(row, index) in rows"
                :key="row.id"
              >
                <td class="lab-visit-table__num">{{ numberText(index + 1) }}</td>
                <td>
                  <span class="lab-visit-badge">{{ row.code }}</span>
                </td>
                <td>
                  <span class="lab-visit-name">{{ row.patientName }}</span>
                  <span v-if="row.patientPhone" class="lab-visit-sub">{{ row.patientPhone }}</span>
                </td>
                <td>
                  <span v-if="row.doctorName !== '—'" class="lab-visit-name">{{ row.doctorName }}</span>
                  <span v-else class="lab-visit-sub">—</span>
                </td>
                <td>
                  <span class="lab-visit-exams" :title="row.examsFull !== row.exams ? row.examsFull : ''">
                    <span v-if="row.examCount > 0" class="lab-visit-exam-count">{{ numberText(row.examCount) }}</span>
                    <span class="lab-visit-sub lab-visit-sub--truncate">{{ row.exams }}</span>
                  </span>
                </td>
                <td>
                  <span class="lab-visit-date">{{ row.eventDate }}</span>
                  <span class="lab-visit-sub">{{ row.eventTime }}</span>
                </td>
                <td>
                  <div class="lab-visit-actions">
                    <button
                      type="button"
                      class="lab-visit-act lab-visit-act--labeled lab-visit-act--accent"
                      :title="uiText('Saisir les résultats')"
                      :aria-label="uiText('Saisir les résultats')"
                      @click="goToDossier(row.id)"
                    >
                      <ClipboardEdit :size="15" />
                      <span>{{ uiText('Saisir') }}</span>
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </UiCard>
    </section>
  </div>
</template>

<style scoped>
.stats-grid--loading {
  opacity: 0.65;
  pointer-events: none;
}

.lab-header-actions {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}

.lab-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 0.5rem;
}

.lab-toolbar__search {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  min-width: min(100%, 16rem);
  padding: 0.45rem 0.75rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: #fff;
  color: var(--text-muted);
}

.lab-toolbar__search:focus-within {
  border-color: var(--accent-500);
  box-shadow: 0 0 0 3px var(--focus-ring);
}

.lab-toolbar__search input {
  width: 100%;
  min-width: 10rem;
  border: 0;
  background: transparent;
  font: inherit;
  font-size: 0.8125rem;
  color: var(--text);
}

.lab-toolbar__search input:focus {
  outline: none;
}

.lab-toolbar__count {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-muted);
  white-space: nowrap;
}

.empty {
  margin: 0;
  text-align: center;
  color: var(--text-muted);
  padding: 2rem 1rem;
  font-size: 0.9375rem;
}

@media (max-width: 640px) {
  .lab-toolbar {
    width: 100%;
    justify-content: stretch;
  }

  .lab-toolbar__search {
    flex: 1;
    min-width: 0;
  }
}
</style>
