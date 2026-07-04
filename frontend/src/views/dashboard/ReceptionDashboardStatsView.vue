<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { LayoutDashboard, Users, CalendarDays, Banknote, Clock, Search, X, UserPlus } from '@lucide/vue'
import api from '@/api/client'
import { formatFcfa } from '@/lib/roles'
import { sortPatientsNewestFirst } from '@/lib/patient-sort'
import UiCard from '@/components/ui/UiCard.vue'
import UiButton from '@/components/ui/UiButton.vue'
import RoleDashboardShell from '@/components/dashboard/RoleDashboardShell.vue'
import DashboardBarChart, { type BarChartDay } from '@/components/dashboard/DashboardBarChart.vue'
import DashboardSplitChart from '@/components/dashboard/DashboardSplitChart.vue'
import DashboardPendingBars from '@/components/dashboard/DashboardPendingBars.vue'
import PatientsDataTable, { type PatientRow } from '@/components/ui/PatientsDataTable.vue'
import type { SummaryStat } from '@/lib/dashboard-summary'

type ReceptionDashboardStats = {
  registeredToday: number
  visitsToday: number
  revenueTodayFcfa: number
  expensesTodayFcfa?: number
  netTodayFcfa?: number
  pendingPayments: number
  externalQueue: number
  hospitalizationsPending: number
  femalePatients: number
  malePatients: number
  activityLast7Days: Array<{
    date: string
    dayLabel: string
    visits: number
    registrations: number
    revenueFcfa: number
  }>
}

const router = useRouter()
const stats = ref<ReceptionDashboardStats | null>(null)
const loading = ref(false)
const loadError = ref('')
const patients = ref<PatientRow[]>([])
const loadingPatients = ref(false)
const search = ref('')

let searchTimer: ReturnType<typeof setTimeout> | undefined

const summaryStats = computed((): SummaryStat[] => {
  if (!stats.value) return []
  const s = stats.value
  return [
    {
      id: 'visits',
      label: 'Visites aujourd\'hui',
      value: s.visitsToday,
      icon: CalendarDays,
      variant: 'teal',
      trend: `${s.registeredToday} nouveau(x) patient(s)`,
    },
    {
      id: 'revenue',
      label: 'Mes encaissements (jour)',
      value: formatFcfa(s.netTodayFcfa ?? s.revenueTodayFcfa),
      icon: Banknote,
      variant: 'green',
      trend: s.expensesTodayFcfa
        ? `Brut ${formatFcfa(s.revenueTodayFcfa)} − dép. ${formatFcfa(s.expensesTodayFcfa)}`
        : 'Uniquement vos encaissements',
    },
    {
      id: 'pending',
      label: 'En attente paiement',
      value: s.pendingPayments,
      icon: Clock,
      variant: 'amber',
      trend: 'Examens à encaisser',
    },
    {
      id: 'queues',
      label: 'Files actives',
      value: s.externalQueue,
      icon: Users,
      variant: 'blue',
      trend: `${s.hospitalizationsPending} hospitalisation(s)`,
    },
  ]
})

const activityChart = computed((): BarChartDay[] => {
  if (!stats.value) return []
  return stats.value.activityLast7Days.map((day) => ({
    date: day.date,
    dayLabel: day.dayLabel,
    total: Math.max(day.visits, day.registrations),
    segments: [
      { key: 'visits', value: day.visits, colorClass: 'bar-chart__bar--a', title: `Visites : ${day.visits}` },
      { key: 'registrations', value: day.registrations, colorClass: 'bar-chart__bar--b', title: `Inscriptions : ${day.registrations}` },
    ],
  }))
})

const genderSplit = computed(() => {
  if (!stats.value) return []
  return [
    { label: 'Femmes', value: stats.value.femalePatients, colorClass: 'split-chart__segment--a' },
    { label: 'Hommes', value: stats.value.malePatients, colorClass: 'split-chart__segment--b' },
  ]
})

const pendingBars = computed(() => {
  if (!stats.value) return []
  const s = stats.value
  return [
    { label: 'Examens en attente', count: s.pendingPayments, color: '#d97706' },
    { label: 'Patients externes', count: s.externalQueue, color: '#2563eb' },
    { label: 'Hospitalisations', count: s.hospitalizationsPending, color: '#e11d48' },
  ]
})

const searchLabel = computed(() =>
  search.value.trim() ? `${patients.value.length} résultat(s)` : `${patients.value.length} dossier(s)`,
)

async function loadStats() {
  loading.value = true
  loadError.value = ''
  try {
    const { data } = await api.get<ReceptionDashboardStats>('/dashboard/reception')
    stats.value = data
  } catch {
    loadError.value = 'Impossible de charger le tableau de bord réception.'
    stats.value = null
  } finally {
    loading.value = false
  }
}

async function loadPatients() {
  loadingPatients.value = true
  try {
    const { data } = await api.get<PatientRow[]>('/patients', {
      params: { q: search.value.trim() || undefined },
    })
    patients.value = sortPatientsNewestFirst(data)
  } finally {
    loadingPatients.value = false
  }
}

async function refreshAll() {
  await Promise.all([loadStats(), loadPatients()])
}

function clearSearch() {
  search.value = ''
}

function goToRegistration() {
  router.push('/reception')
}

watch(search, () => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(loadPatients, 300)
})

onMounted(refreshAll)
</script>

<template>
  <div class="page-with-table">
    <section class="page-with-table__head">
      <RoleDashboardShell
        subtitle="Résumé de l'activité réception — flux patients et encaissements"
        :icon="LayoutDashboard"
        :stats="summaryStats"
        :loading="loading"
        :load-error="loadError"
        @refresh="refreshAll"
      >
        <div class="charts-grid">
          <UiCard title="Activité — 7 derniers jours" description="Visites et nouvelles inscriptions" :icon="CalendarDays" icon-variant="teal">
            <DashboardBarChart
              :days="activityChart"
              :loading="loading"
              :legend="[
                { key: 'visits', label: 'Visites', colorClass: 'legend-dot--a' },
                { key: 'registrations', label: 'Inscriptions', colorClass: 'legend-dot--b' },
              ]"
            />
          </UiCard>

          <UiCard title="Répartition patients" description="Par genre (base totale)" :icon="Users" icon-variant="blue">
            <DashboardSplitChart
              :rows="genderSplit"
              :format-value="(v) => String(v)"
              empty-label="Aucun patient enregistré"
            />
          </UiCard>
        </div>

        <UiCard title="Files en cours" description="Volumes par type de dossier" :icon="Clock" icon-variant="amber">
          <DashboardPendingBars :items="pendingBars" />
        </UiCard>
      </RoleDashboardShell>
    </section>

    <section class="page-with-table__body">
      <UiCard
        title="Patients enregistrés"
        description="Liste des dossiers créés à la réception"
        class="ui-card--table-panel"
        :icon="Users"
        icon-variant="teal"
      >
        <template #actions>
          <div class="table-toolbar">
            <div class="search-compact">
              <Search :size="16" class="search-compact__icon" />
              <input
                v-model="search"
                type="search"
                class="search-compact__input"
                placeholder="Rechercher par matricule, nom ou téléphone…"
              />
              <button
                v-if="search"
                type="button"
                class="search-compact__clear"
                aria-label="Effacer la recherche"
                @click="clearSearch"
              >
                <X :size="14" />
              </button>
            </div>
            <span class="search-count">{{ searchLabel }}</span>
            <UiButton variant="primary" size="sm" @click="goToRegistration">
              <UserPlus :size="16" />
              Nouveau
            </UiButton>
          </div>
        </template>

        <PatientsDataTable
          fill
          :show-delete="false"
          :patients="patients"
          :loading="loadingPatients"
          @print="goToRegistration"
          @edit="goToRegistration"
          @reconsult="goToRegistration"
        />
      </UiCard>
    </section>
  </div>
</template>

<style scoped>
@import '@/styles/dashboard-charts.css';

.table-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem;
}

.search-compact {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  min-width: min(100%, 16rem);
  padding: 0.35rem 0.65rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-card);
}

.search-compact__icon {
  color: var(--text-muted);
  flex-shrink: 0;
}

.search-compact__input {
  flex: 1;
  min-width: 0;
  border: none;
  background: transparent;
  font-size: 0.8125rem;
  color: var(--text);
  outline: none;
}

.search-compact__clear {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.15rem;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}

.search-count {
  font-size: 0.75rem;
  color: var(--text-muted);
  white-space: nowrap;
}
</style>
