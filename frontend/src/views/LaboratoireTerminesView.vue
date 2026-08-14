<script setup lang="ts">
import { computed, onActivated, ref } from 'vue'
import { useRouter } from 'vue-router'
import { CheckCircle2, ClipboardEdit, Printer, RefreshCw, Search } from '@lucide/vue'
import api from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { fetchAndPrintLabVisitResults } from '@/lib/lab-visit-print'
import { matchesLabVisitSearch } from '@/lib/lab-visit-search'
import { fullName } from '@/lib/roles'
import { useAppI18n } from '@/i18n/useAppI18n'
import {
  countLabPrescribedExams,
  formatLabPrescribedExamsPreview,
  formatLabPrescribedExamsSummary,
  parseLabResultsCompletedAt,
} from '@/lib/lab-notes'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import { useSilentRefresh } from '@/composables/useSilentRefresh'
import { type LabsWaitingVisitRow } from '@/components/ui/LabsWaitingDataTable.vue'
import '@/assets/lab-visit-table.css'
import LabQueueBell from '@/components/layout/LabQueueBell.vue'

const router = useRouter()
const auth = useAuthStore()
const { uiText, dateText, timeText, numberText } = useAppI18n()

const visits = ref<LabsWaitingVisitRow[]>([])
const listSearch = ref('')
const loading = ref(false)
const loadError = ref('')
const printError = ref('')
const printingVisitId = ref<string | null>(null)

const filteredVisits = computed(() =>
  visits.value.filter((visit) => matchesLabVisitSearch(visit, listSearch.value)),
)

const rows = computed(() =>
  filteredVisits.value
    .map((visit) => {
      const notes = visit.consultation?.clinicalNotes
      const eventAt =
        parseLabResultsCompletedAt(notes) ??
        new Date(visit.consultation?.updatedAt ?? visit.updatedAt)
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

async function loadCompleted(opts?: { silent?: boolean }) {
  if (!opts?.silent) loading.value = true
  if (!opts?.silent) loadError.value = ''
  try {
    const { data } = await api.get<LabsWaitingVisitRow[]>('/laboratoire/completed')
    visits.value = data
  } catch {
    if (!opts?.silent) {
      loadError.value = 'Impossible de charger les examens terminés.'
      visits.value = []
    }
  } finally {
    if (!opts?.silent) loading.value = false
  }
}

function goToResaisirResults(visitId: string) {
  router.push({
    name: 'laboratoire-dossier',
    params: { visitId },
    query: { from: 'termines', edit: '1' },
  })
}

async function printResults(visitId: string) {
  const visit = visits.value.find((v) => v.id === visitId)
  if (!visit) return

  printError.value = ''
  printingVisitId.value = visitId

  const result = await fetchAndPrintLabVisitResults(visit, auth.user, 'laboratoire')

  if (!result.ok) {
    printError.value = result.error
  }

  printingVisitId.value = null
}

function resetSearch() {
  listSearch.value = ''
}

const { refresh: refreshCompleted } = useSilentRefresh(
  ({ silent }) => loadCompleted({ silent }),
  { intervalMs: 30_000 },
)

onActivated(() => {
  void refreshCompleted({ silent: true })
})
</script>

<template>
  <div class="page-with-table lab-page">
    <section class="page-with-table__head">
      <UiPageHeader
        title="Examens terminés"
        subtitle="Patients dont les analyses de laboratoire ont été clôturées"
        :icon="CheckCircle2"
      >
        <template #actions>
          <div class="lab-header-actions">
            <LabQueueBell />
            <UiButton variant="ghost" size="sm" :icon="RefreshCw" :disabled="loading" @click="refreshCompleted()">
              Actualiser
            </UiButton>
          </div>
        </template>
      </UiPageHeader>

      <UiAlert v-if="loadError" type="error" :message="loadError" />
      <UiAlert v-if="printError" type="error" :message="printError" />
    </section>

    <section class="page-with-table__body">
      <UiCard direct title="Dossiers clôturés"
        description="Matricule · Patient · Date · Examens — Imprimer · Consulter · Modifier · Ajouter"
        class="ui-card--table-panel lab-table-card"
        :icon="CheckCircle2"
        icon-variant="teal"
      >
        <template #actions>
          <div class="lab-toolbar">
            <label class="lab-toolbar__search">
              <Search :size="16" aria-hidden="true" />
              <input
                v-model="listSearch"
                type="search"
                :placeholder="uiText('Patient, matricule, médecin…')"
                :aria-label="uiText('Rechercher un dossier terminé')"
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

        <p v-if="loading && !visits.length" class="empty">{{ uiText('Chargement des examens terminés…') }}</p>
        <p v-else-if="!loading && !visits.length" class="empty">
          {{ uiText('Aucun examen de laboratoire terminé pour le moment.') }}
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
                <th>{{ uiText('Terminé le') }}</th>
                <th>{{ uiText('Examens') }}</th>
                <th class="lab-visit-table__actions-head">{{ uiText('Actions') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, index) in rows" :key="row.id">
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
                  <span class="lab-visit-date">{{ row.eventDate }}</span>
                  <span class="lab-visit-sub">{{ row.eventTime }}</span>
                </td>
                <td>
                  <span class="lab-visit-exams" :title="row.examsFull !== row.exams ? row.examsFull : ''">
                    <span v-if="row.examCount > 0" class="lab-visit-exam-count">{{ numberText(row.examCount) }}</span>
                    <span class="lab-visit-sub lab-visit-sub--truncate">{{ row.exams }}</span>
                  </span>
                </td>
                <td>
                  <div class="lab-visit-actions">
                    <button
                      type="button"
                      class="lab-visit-act lab-visit-act--labeled lab-visit-act--accent"
                      :title="uiText('Resaisir les résultats')"
                      :aria-label="uiText('Resaisir les résultats')"
                      @click="goToResaisirResults(row.id)"
                    >
                      <ClipboardEdit :size="15" />
                      <span>{{ uiText('Resaisir') }}</span>
                    </button>
                    <button
                      type="button"
                      class="lab-visit-act lab-visit-act--labeled"
                      :title="uiText('Imprimer')"
                      :aria-label="uiText('Imprimer')"
                      :disabled="printingVisitId === row.id"
                      @click="printResults(row.id)"
                    >
                      <Printer :size="15" />
                      <span>{{ uiText('Imprimer') }}</span>
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
.lab-header-actions {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}
.empty {
  margin: 0;
  text-align: center;
  color: var(--text-muted);
  padding: 2rem 1rem;
  font-size: 0.9375rem;
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

.lab-toolbar__search input {
  width: 100%;
  border: 0;
  outline: none;
  font: inherit;
  font-size: 0.8125rem;
  color: var(--text);
  background: transparent;
}

.lab-toolbar__count {
  font-size: 0.75rem;
  color: var(--text-muted);
  white-space: nowrap;
}
</style>
