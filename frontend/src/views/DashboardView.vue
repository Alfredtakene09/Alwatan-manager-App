<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  LayoutDashboard,
  Banknote,
  TrendingDown,
  TrendingUp,
  Users,
  CalendarDays,
  FlaskConical,
  BedDouble,
  Wallet,
  Bell,
  Clock,
  AlertTriangle,
} from '@lucide/vue'
import api from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { canAccessModule, formatFcfa } from '@/lib/roles'
import type { AdminDashboardOverview, TrendFilter } from '@/lib/admin-dashboard'
import { filterTrend, formatTrendPercent } from '@/lib/admin-dashboard'
import {
  formatCashDelayLabel,
  type GestionnaireDashboardOverview,
} from '@/lib/gestionnaire-dashboard'
import UiCard from '@/components/ui/UiCard.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiStatCard from '@/components/ui/UiStatCard.vue'
import UiFormModal from '@/components/ui/UiFormModal.vue'
import RoleDashboardShell from '@/components/dashboard/RoleDashboardShell.vue'
import DashboardLineChart from '@/components/dashboard/DashboardLineChart.vue'
import DashboardDonutChart from '@/components/dashboard/DashboardDonutChart.vue'
import DashboardHorizontalBars from '@/components/dashboard/DashboardHorizontalBars.vue'
import type { SummaryStat } from '@/lib/dashboard-summary'

const router = useRouter()
const auth = useAuthStore()

const overview = ref<AdminDashboardOverview | null>(null)
const gestionnaireOverview = ref<GestionnaireDashboardOverview | null>(null)
const loading = ref(false)
const loadError = ref('')
const trendFilter = ref<TrendFilter>('year')
const showAlertsModal = ref(false)

const showAdminSection = computed(() =>
  auth.user ? canAccessModule(auth.user.role, 'admin') : false,
)
const showGestionnaireSection = computed(() =>
  auth.user ? canAccessModule(auth.user.role, 'gestionnaire') : false,
)

const REVENUE_COLORS: Record<string, string> = {
  consultations: '#2563eb',
  examens: '#0d9488',
  operations: '#d97706',
  hospitalisation: '#7c3aed',
  autres: '#64748b',
}

const EXPENSE_COLORS: Record<string, string> = {
  salaires: '#7c3aed',
  fournitures: '#2563eb',
  equipements: '#d97706',
  maintenance: '#0d9488',
  autres: '#64748b',
}

const summaryStats = computed((): SummaryStat[] => {
  const k = gestionnaireOverview.value?.financialKpis ?? overview.value?.financialKpis
  if (!k) return []
  return [
    {
      id: 'revenue',
      label: 'Recettes du mois',
      value: formatFcfa(k.revenueMonthFcfa),
      icon: Banknote,
      variant: 'green',
      trend: formatTrendPercent(k.revenueChangePercent),
    },
    {
      id: 'expenses',
      label: 'Dépenses du mois',
      value: formatFcfa(k.expensesMonthFcfa),
      icon: TrendingDown,
      variant: 'rose',
      trend: formatTrendPercent(k.expensesChangePercent),
    },
    {
      id: 'net',
      label: 'Bénéfice net',
      value: formatFcfa(k.netMonthFcfa),
      icon: TrendingUp,
      variant: 'blue',
      trend: formatTrendPercent(k.netChangePercent),
    },
    {
      id: 'payroll',
      label: 'Masse salariale',
      value: formatFcfa(k.payrollMonthFcfa),
      icon: Users,
      variant: 'violet',
      trend: formatTrendPercent(k.payrollChangePercent),
    },
  ]
})

const filteredTrend = computed(() => {
  if (!overview.value) return []
  return filterTrend(overview.value.monthlyTrend, trendFilter.value)
})

const lineChartLabels = computed(() => filteredTrend.value.map((row) => row.label))
const lineChartSeries = computed(() => {
  const points = filteredTrend.value
  return [
    {
      key: 'revenue',
      label: 'Recettes',
      color: '#16a34a',
      values: points.map((row) => row.revenueFcfa),
    },
    {
      key: 'expenses',
      label: 'Dépenses',
      color: '#e11d48',
      values: points.map((row) => row.expensesFcfa),
    },
    {
      key: 'net',
      label: 'Bénéfice net',
      color: '#2563eb',
      values: points.map((row) => row.netFcfa),
    },
  ]
})

const revenueDonut = computed(() =>
  (overview.value?.revenueBreakdown ?? []).map((row) => ({
    ...row,
    percent: row.percent ?? 0,
    color: REVENUE_COLORS[row.key] ?? '#64748b',
  })),
)

const expenseBars = computed(() =>
  (overview.value?.expenseBreakdown ?? []).map((row) => ({
    key: row.key,
    label: row.label,
    amountFcfa: row.amountFcfa,
    color: EXPENSE_COLORS[row.key] ?? '#64748b',
  })),
)

const comptableCashAlert = computed(
  () => gestionnaireOverview.value?.alerts.cashRegisters.find((row) => row.id === 'comptabilite') ?? null,
)

const dashboardAlerts = computed(() => {
  const items: Array<{
    id: string
    severity: 'danger' | 'warning' | 'info'
    title: string
    message: string
    actionLabel?: string
    actionTo?: string
  }> = []

  const cash = comptableCashAlert.value
  if (cash && cash.pendingFcfa > 0) {
    const delay = formatCashDelayLabel(cash.hoursSinceLastDisbursement, cash.lastDisbursementAt)
    const scheduleHint = cash.hint ?? cash.workflowHint ?? ''
    const statusLabel = cash.disbursementStatusLabel ?? 'Solde comptable en attente'
    const isDuringDay = cash.disbursementPhase === 'during_day'
    let cashSeverity: 'danger' | 'warning' | 'info' = 'warning'
    if (cash.overdue) cashSeverity = 'danger'
    else if (isDuringDay) cashSeverity = 'info'
    items.push({
      id: 'cash-comptable',
      severity: cashSeverity,
      title: statusLabel,
      message: `${formatFcfa(cash.pendingFcfa)} en tirelire comptable (${delay}). ${scheduleHint}`,
      actionLabel: cash.overdue ? 'Récupérer la tirelire' : 'Voir la caisse comptable',
      actionTo: '/gestionnaire/caisse',
    })
  }

  const unpaidPayroll =
    gestionnaireOverview.value?.alerts.unpaidPayroll ?? overview.value?.alerts.unpaidPayroll ?? 0
  if (unpaidPayroll > 0) {
    items.push({
      id: 'payroll',
      severity: 'warning',
      title: 'Paie du mois incomplète',
      message: `${unpaidPayroll} salaire${unpaidPayroll > 1 ? 's' : ''} encore à valider ce mois.`,
      actionLabel: 'Ouvrir la paie',
      actionTo: showGestionnaireSection.value ? '/gestionnaire/salaires' : '/admin/salaires',
    })
  }

  const pendingExpenses = overview.value?.alerts.pendingExpenses ?? 0
  if (pendingExpenses > 0) {
    items.push({
      id: 'pending-expenses',
      severity: 'warning',
      title: 'Dépenses à valider',
      message: `${pendingExpenses} dépense${pendingExpenses > 1 ? 's' : ''} en attente de validation.`,
      actionLabel: 'Voir les dépenses',
      actionTo: '/admin/depenses',
    })
  }

  const lowStock = overview.value?.alerts.lowStock ?? 0
  if (lowStock > 0) {
    items.push({
      id: 'low-stock',
      severity: 'warning',
      title: 'Stock pharmacie bas',
      message: `${lowStock} produit${lowStock > 1 ? 's' : ''} en stock critique.`,
      actionLabel: 'Voir la pharmacie',
      actionTo: '/pharmacie/alertes',
    })
  }

  return items
})

const alertsCount = computed(() => dashboardAlerts.value.length)

function openAlertTarget(to?: string) {
  showAlertsModal.value = false
  if (to) router.push(to)
}

async function loadOverview() {
  loading.value = true
  loadError.value = ''
  try {
    const requests: Promise<void>[] = []

    if (showAdminSection.value) {
      requests.push(
        api.get<AdminDashboardOverview>('/dashboard/admin').then(({ data }) => {
          overview.value = data
        }),
      )
    } else {
      overview.value = null
    }

    if (showGestionnaireSection.value) {
      requests.push(
        api.get<GestionnaireDashboardOverview>('/dashboard/gestionnaire').then(({ data }) => {
          gestionnaireOverview.value = data
        }),
      )
    } else {
      gestionnaireOverview.value = null
    }

    await Promise.all(requests)
  } catch {
    loadError.value = 'Impossible de charger le tableau de bord.'
    overview.value = null
    gestionnaireOverview.value = null
  } finally {
    loading.value = false
  }
}

onMounted(loadOverview)
</script>

<template>
  <RoleDashboardShell
    title="Tableau de board"
    subtitle="Vue d'ensemble, finances, caisses et supervision de la clinique"
    :icon="LayoutDashboard"
    :stats="summaryStats"
    :loading="loading"
    :load-error="loadError"
    @refresh="loadOverview"
  >
    <template #actions>
      <button
        type="button"
        class="alerts-bell"
        :class="{ 'alerts-bell--active': alertsCount > 0 }"
        :aria-label="`Alertes (${alertsCount})`"
        @click="showAlertsModal = true"
      >
        <Bell :size="18" />
        <span v-if="alertsCount > 0" class="alerts-bell__badge">{{ alertsCount }}</span>
      </button>
      <UiButton
        v-if="showAdminSection"
        variant="ghost"
        size="sm"
        :icon="Wallet"
        @click="router.push('/admin/depenses')"
      >
        Dépenses récentes
      </UiButton>
      <UiButton variant="ghost" size="sm" :disabled="loading" @click="loadOverview">
        Actualiser
      </UiButton>
    </template>

    <div class="admin-dashboard">
      <section v-if="showAdminSection" class="clinical-cards">
        <UiStatCard
          label="Patients aujourd'hui"
          :value="overview?.clinical.patientsToday ?? 0"
          :icon="Users"
          variant="teal"
          mini
        />
        <UiStatCard
          label="RDV du jour"
          :value="overview?.clinical.appointmentsToday ?? 0"
          :icon="CalendarDays"
          variant="blue"
          mini
        />
        <UiStatCard
          label="Examens en attente"
          :value="overview?.clinical.examsPending ?? 0"
          :icon="FlaskConical"
          variant="amber"
          mini
        />
        <UiStatCard
          label="Hospitalisations actives"
          :value="overview?.clinical.activeHospitalizations ?? 0"
          :icon="BedDouble"
          variant="violet"
          mini
        />
      </section>

      <section v-if="showAdminSection" class="charts-grid">
        <UiCard
          title="Évolution mensuelle"
          description="Recettes, dépenses et bénéfice net — 12 mois glissants"
          :icon="TrendingUp"
          icon-variant="blue"
        >
          <div class="trend-filters">
            <button
              type="button"
              class="trend-filters__btn"
              :class="{ 'trend-filters__btn--active': trendFilter === 'month' }"
              @click="trendFilter = 'month'"
            >
              Mois
            </button>
            <button
              type="button"
              class="trend-filters__btn"
              :class="{ 'trend-filters__btn--active': trendFilter === 'quarter' }"
              @click="trendFilter = 'quarter'"
            >
              Trimestre
            </button>
            <button
              type="button"
              class="trend-filters__btn"
              :class="{ 'trend-filters__btn--active': trendFilter === 'year' }"
              @click="trendFilter = 'year'"
            >
              Année
            </button>
          </div>
          <DashboardLineChart
            :labels="lineChartLabels"
            :series="lineChartSeries"
            :format-value="formatFcfa"
            :loading="loading"
          />
        </UiCard>

        <UiCard
          title="Répartition des recettes"
          description="Mois en cours"
          :icon="Banknote"
          icon-variant="green"
        >
          <DashboardDonutChart :slices="revenueDonut" :format-value="formatFcfa" />
        </UiCard>

        <UiCard
          title="Répartition des dépenses"
          description="Mois en cours"
          :icon="Wallet"
          icon-variant="rose"
        >
          <DashboardHorizontalBars :rows="expenseBars" :format-value="formatFcfa" />
        </UiCard>
      </section>
    </div>

    <UiFormModal
      v-if="showAlertsModal"
      title="Alertes"
      :subtitle="alertsCount ? `${alertsCount} alerte${alertsCount > 1 ? 's' : ''} à traiter` : 'Aucune alerte'"
      :icon="Bell"
      @close="showAlertsModal = false"
    >
      <ul v-if="dashboardAlerts.length" class="alerts-list">
        <li
          v-for="alert in dashboardAlerts"
          :key="alert.id"
          class="alerts-list__item"
          :class="`alerts-list__item--${alert.severity}`"
        >
          <div class="alerts-list__content">
            <AlertTriangle v-if="alert.severity === 'danger'" :size="18" />
            <Clock v-else :size="18" />
            <div>
              <strong class="alerts-list__title">{{ alert.title }}</strong>
              <p class="alerts-list__message">{{ alert.message }}</p>
              <UiButton
                v-if="alert.actionTo"
                size="sm"
                variant="ghost"
                class="alerts-list__action"
                @click="openAlertTarget(alert.actionTo)"
              >
                {{ alert.actionLabel }}
              </UiButton>
            </div>
          </div>
        </li>
      </ul>
      <p v-else class="alerts-list__item alerts-list__item--ok">
        Tout est à jour — aucune action urgente sur la caisse comptable, les dépenses ni la paie.
      </p>
    </UiFormModal>
  </RoleDashboardShell>
</template>

<style scoped>
@import '@/styles/dashboard-charts.css';

.admin-dashboard {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.charts-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
}

.charts-grid > :first-child {
  grid-column: 1 / -1;
}

.clinical-cards {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.75rem;
}

.trend-filters {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.trend-filters__btn {
  border: 1px solid var(--border);
  background: var(--bg-card);
  color: var(--text-muted);
  border-radius: 999px;
  padding: 0.3rem 0.75rem;
  font-size: 0.75rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.trend-filters__btn--active {
  background: var(--accent-100);
  color: var(--accent-700);
  border-color: rgba(107, 124, 62, 0.35);
}

.alerts-bell {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.25rem;
  height: 2.25rem;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-card);
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.18s ease;
}

.alerts-bell:hover {
  color: var(--primary-800);
  border-color: var(--accent-400);
}

.alerts-bell--active {
  color: #b45309;
  border-color: #fcd34d;
  background: #fffbeb;
}

.alerts-bell__badge {
  position: absolute;
  top: -6px;
  right: -6px;
  min-width: 1.1rem;
  height: 1.1rem;
  padding: 0 0.3rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: #dc2626;
  color: #fff;
  border-radius: 999px;
  font-size: 0.6875rem;
  font-weight: 700;
  line-height: 1;
}

.alerts-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.alerts-list__item {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  padding: 0.65rem 0.75rem;
  border-radius: 0.65rem;
  font-size: 0.875rem;
  line-height: 1.45;
}

.alerts-list__content {
  display: flex;
  gap: 0.65rem;
  align-items: flex-start;
}

.alerts-list__title {
  display: block;
  margin-bottom: 0.2rem;
  font-size: 0.9rem;
}

.alerts-list__message {
  margin: 0;
  font-size: 0.8125rem;
  line-height: 1.45;
  opacity: 0.95;
}

.alerts-list__action {
  margin-top: 0.5rem;
  padding-left: 0;
}

.alerts-list__item--danger {
  background: #fef2f2;
  color: #991b1b;
}

.alerts-list__item--warning {
  background: #fffbeb;
  color: #92400e;
}

.alerts-list__item--info {
  background: #eff6ff;
  color: #1e40af;
}

.alerts-list__item--ok {
  background: #f0fdf4;
  color: #166534;
}

@media (max-width: 1100px) {
  .charts-grid,
  .clinical-cards {
    grid-template-columns: 1fr;
  }

  .charts-grid > :first-child {
    grid-column: auto;
  }
}
</style>
