<script setup lang="ts">
import { computed, onActivated, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { CheckCircle2, Clock, Eye, FlaskConical, RefreshCw, Search } from '@lucide/vue'
import api from '@/api/client'
import { useSilentRefresh } from '@/composables/useSilentRefresh'
import {
  countLabPrescribedExams,
  formatLabPrescribedExamsPreview,
  formatLabPrescribedExamsSummary,
  parseLabResultsCompletedAt,
} from '@/lib/lab-notes'
import { matchesLabVisitSearch } from '@/lib/lab-visit-search'
import { fullName } from '@/lib/roles'
import { useAppI18n } from '@/i18n/useAppI18n'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import { type LabsWaitingVisitRow } from '@/components/ui/LabsWaitingDataTable.vue'
import LabVisitDetailModal from '@/components/laboratoire/LabVisitDetailModal.vue'
import '@/assets/lab-visit-table.css'

const route = useRoute()
const router = useRouter()
const { uiText, dateText, timeText, numberText } = useAppI18n()

const activeTab = ref<'attente' | 'termines'>(route.query.tab === 'termines' ? 'termines' : 'attente')
const pendingVisits = ref<LabsWaitingVisitRow[]>([])
const completedVisits = ref<LabsWaitingVisitRow[]>([])
const listSearch = ref('')
const loading = ref(false)
const loadError = ref('')

const sourceVisits = computed(() =>
  activeTab.value === 'termines' ? completedVisits.value : pendingVisits.value,
)

const filteredVisits = computed(() =>
  sourceVisits.value.filter((visit) => matchesLabVisitSearch(visit, listSearch.value)),
)

const rows = computed(() =>
  filteredVisits.value
    .map((visit) => {
      const notes = visit.consultation?.clinicalNotes
      const eventAt =
        activeTab.value === 'termines'
          ? (parseLabResultsCompletedAt(notes) ??
            new Date(visit.consultation?.updatedAt ?? visit.updatedAt))
          : new Date(visit.consultation?.labSentToLabAt ?? visit.updatedAt)
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
const dateColumnLabel = computed(() =>
  activeTab.value === 'termines' ? uiText('Terminé le') : uiText('Transféré le'),
)
const emptyLabel = computed(() =>
  activeTab.value === 'termines'
    ? uiText('Aucun examen terminé au laboratoire pour le moment.')
    : uiText('Aucun examen de laboratoire en attente pour le moment.'),
)

watch(
  () => route.query.tab,
  (tab) => {
    activeTab.value = tab === 'termines' ? 'termines' : 'attente'
    listSearch.value = ''
  },
)

async function loadLists(opts?: { silent?: boolean }) {
  if (!opts?.silent) loading.value = true
  if (!opts?.silent) loadError.value = ''
  try {
    const [queueRes, completedRes] = await Promise.all([
      api.get<LabsWaitingVisitRow[]>('/laboratoire/queue'),
      api.get<LabsWaitingVisitRow[]>('/laboratoire/completed'),
    ])
    pendingVisits.value = queueRes.data
    completedVisits.value = completedRes.data
  } catch {
    if (!opts?.silent) {
      loadError.value = uiText('Impossible de charger les examens du laboratoire.')
      pendingVisits.value = []
      completedVisits.value = []
    }
  } finally {
    if (!opts?.silent) loading.value = false
  }
}

function setTab(tab: 'attente' | 'termines') {
  if (activeTab.value === tab && route.query.tab === tab) return
  router.replace({ name: 'reception-laboratoire', query: { tab } })
}

const detailOpen = ref(false)
const detailVisitId = ref<string | null>(null)

function openDossier(visitId: string) {
  detailVisitId.value = visitId
  detailOpen.value = true
}

const { refresh } = useSilentRefresh(({ silent }) => loadLists({ silent }), {
  intervalMs: 20_000,
  enabled: () => !detailOpen.value,
})

onActivated(() => {
  void refresh({ silent: true })
})
</script>

<template>
  <div class="page-with-table lab-page">
    <section class="page-with-table__head">
      <UiPageHeader
        title="Laboratoire"
        subtitle="Examens en attente ou déjà terminés au laboratoire"
        :icon="FlaskConical"
      >
        <template #actions>
          <UiButton variant="ghost" size="sm" :icon="RefreshCw" :disabled="loading" @click="refresh()">
            Actualiser
          </UiButton>
        </template>
      </UiPageHeader>

      <UiAlert v-if="loadError" type="error" :message="loadError" />

      <div class="lab-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          class="lab-tabs__btn"
          :class="{ 'lab-tabs__btn--active': activeTab === 'attente' }"
          :aria-selected="activeTab === 'attente'"
          @click="setTab('attente')"
        >
          <Clock :size="16" />
          {{ uiText('En attente') }}
          <span class="lab-tabs__count">{{ numberText(pendingVisits.length) }}</span>
        </button>
        <button
          type="button"
          role="tab"
          class="lab-tabs__btn"
          :class="{ 'lab-tabs__btn--active': activeTab === 'termines' }"
          :aria-selected="activeTab === 'termines'"
          @click="setTab('termines')"
        >
          <CheckCircle2 :size="16" />
          {{ uiText('Terminés') }}
          <span class="lab-tabs__count">{{ numberText(completedVisits.length) }}</span>
        </button>
      </div>
    </section>

    <section class="page-with-table__body">
      <UiCard
        direct
        :title="activeTab === 'termines' ? 'Terminés au laboratoire' : 'En attente au laboratoire'"
        class="ui-card--table-panel lab-table-card"
        :icon="activeTab === 'termines' ? CheckCircle2 : Clock"
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
            <UiButton v-if="hasActiveSearch" variant="ghost" size="sm" @click="listSearch = ''">
              Effacer
            </UiButton>
            <span class="lab-toolbar__count">{{
              uiText('{n} dossier(s)').replace('{n}', numberText(filteredVisits.length))
            }}</span>
          </div>
        </template>

        <p v-if="loading && !sourceVisits.length" class="empty">{{ uiText('Chargement…') }}</p>
        <p v-else-if="!loading && !sourceVisits.length" class="empty">{{ emptyLabel }}</p>
        <p v-else-if="!loading && sourceVisits.length && !rows.length" class="empty">
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
                <th>{{ dateColumnLabel }}</th>
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
                  <span class="lab-visit-exams" :title="row.examsFull !== row.exams ? row.examsFull : ''">
                    <span v-if="row.examCount > 0" class="lab-visit-exam-count">{{ numberText(row.examCount) }}</span>
                    <span class="lab-visit-sub lab-visit-sub--truncate">{{ row.exams }}</span>
                  </span>
                </td>
                <td>
                  <span class="lab-visit-date">{{ row.eventDate }}</span>
                  <span class="lab-visit-sub">{{ row.eventTime }}</span>
                </td>
                <td class="lab-visit-table__actions">
                  <div class="lab-visit-actions">
                    <button
                      type="button"
                      class="lab-visit-act lab-visit-act--labeled"
                      :title="uiText('Voir')"
                      :aria-label="uiText('Voir')"
                      @click="openDossier(row.id)"
                    >
                      <Eye :size="15" />
                      <span>{{ uiText('Voir') }}</span>
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </UiCard>
    </section>
    <LabVisitDetailModal v-model:open="detailOpen" :visit-id="detailVisitId" />
  </div>
</template>

<style scoped>
.lab-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.lab-tabs__btn {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.45rem 0.85rem;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: #fff;
  color: var(--text-muted);
  font: inherit;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
}

.lab-tabs__btn--active {
  background: var(--primary, #2563eb);
  border-color: var(--primary, #2563eb);
  color: #fff;
}

.lab-tabs__count {
  min-width: 1.4rem;
  padding: 0.05rem 0.4rem;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.08);
  font-size: 0.75rem;
}

.lab-tabs__btn--active .lab-tabs__count {
  background: rgba(255, 255, 255, 0.22);
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
</style>
