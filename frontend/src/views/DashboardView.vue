<script setup lang="ts">
import { computed, onMounted, ref, type Component } from 'vue'
import { useRouter } from 'vue-router'
import {
  LayoutDashboard,
  Banknote,
  TrendingDown,
  TrendingUp,
  Users,
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
import type { AdminDashboardOverview } from '@/lib/admin-dashboard'
import {
  formatMonthLabel,
  formatTrendPercentLocalized,
  translateCashDelayLabel,
  translateCashScheduleHint,
  translateDashboardLabel,
  translateTemplate,
} from '@/lib/dashboard-i18n'
import { useAppI18n } from '@/i18n/useAppI18n'
import type { GestionnaireDashboardOverview } from '@/lib/gestionnaire-dashboard'
import UiCard from '@/components/ui/UiCard.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiStatCard from '@/components/ui/UiStatCard.vue'
import UiFormModal from '@/components/ui/UiFormModal.vue'
import RoleDashboardShell from '@/components/dashboard/RoleDashboardShell.vue'
import DashboardLineChart from '@/components/dashboard/DashboardLineChart.vue'
import DashboardDonutChart from '@/components/dashboard/DashboardDonutChart.vue'
import DashboardHorizontalBars from '@/components/dashboard/DashboardHorizontalBars.vue'
import type { SummaryStat } from '@/lib/dashboard-summary'

const router = useRouter()
const auth = useAuthStore()
const { localeCode, isArabic } = useAppI18n()

const overview = ref<AdminDashboardOverview | null>(null)
const gestionnaireOverview = ref<GestionnaireDashboardOverview | null>(null)
const loading = ref(false)
const loadError = ref('')
const selectedTrendMonth = ref('')
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
  void localeCode.value
  const k = gestionnaireOverview.value?.financialKpis ?? overview.value?.financialKpis
  if (!k) return []
  return [
    {
      id: 'revenue',
      label: translateDashboardLabel('Recettes du mois'),
      value: formatFcfa(k.revenueMonthFcfa),
      icon: Banknote,
      variant: 'green',
      trend: formatTrendPercentLocalized(k.revenueChangePercent),
    },
    {
      id: 'expenses',
      label: translateDashboardLabel('Dépenses du mois'),
      value: formatFcfa(k.expensesMonthFcfa),
      icon: TrendingDown,
      variant: 'rose',
      trend: formatTrendPercentLocalized(k.expensesChangePercent),
    },
    {
      id: 'net',
      label: translateDashboardLabel('Bénéfice net'),
      value: formatFcfa(k.netMonthFcfa),
      icon: TrendingUp,
      variant: 'blue',
      trend: formatTrendPercentLocalized(k.netChangePercent),
    },
    {
      id: 'payroll',
      label: translateDashboardLabel('Masse salariale'),
      value: formatFcfa(k.payrollMonthFcfa),
      icon: Users,
      variant: 'violet',
      trend: formatTrendPercentLocalized(k.payrollChangePercent),
    },
  ]
})

const filteredTrend = computed(() => {
  if (!overview.value) return []
  const points = overview.value.monthlyTrend
  if (!selectedTrendMonth.value) return points
  const [yearRaw, monthRaw] = selectedTrendMonth.value.split('-')
  const year = Number(yearRaw)
  const month = Number(monthRaw)
  if (!Number.isFinite(year) || !Number.isFinite(month)) return points
  const endIndex = points.findIndex((row) => row.year === year && row.month === month)
  if (endIndex < 0) return points
  return points.slice(Math.max(0, endIndex - 11), endIndex + 1)
})

const lineChartLabels = computed(() => {
  void localeCode.value
  const locale = isArabic.value ? 'ar-TD' : 'fr-FR'
  return filteredTrend.value.map((row) => formatMonthLabel(row.year, row.month, locale))
})
const lineChartSeries = computed(() => {
  void localeCode.value
  const points = filteredTrend.value
  return [
    {
      key: 'revenue',
      label: translateDashboardLabel('Recettes'),
      color: '#16a34a',
      values: points.map((row) => row.revenueFcfa),
    },
    {
      key: 'expenses',
      label: translateDashboardLabel('Dépenses'),
      color: '#e11d48',
      values: points.map((row) => row.expensesFcfa),
    },
    {
      key: 'net',
      label: translateDashboardLabel('Bénéfice net'),
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

const moduleIconByKey: Record<string, Component> = {
  consultations: Users,
  examens: FlaskConical,
  laboratoire: FlaskConical,
  operations: TrendingUp,
  hospitalisation: BedDouble,
  pharmacie: Wallet,
  autres: Banknote,
}

const moduleVariantByKey: Record<string, NonNullable<SummaryStat['variant']>> = {
  consultations: 'teal',
  examens: 'blue',
  laboratoire: 'blue',
  operations: 'amber',
  hospitalisation: 'violet',
  pharmacie: 'green',
  autres: 'cyan',
}

const revenueModuleStats = computed(() => {
  void localeCode.value
  const rows = overview.value?.revenueBreakdown ?? []
  return rows.map((row) => {
    const normalizedKey = row.key.toLowerCase()
    const icon = moduleIconByKey[normalizedKey] ?? Banknote
    const variant = moduleVariantByKey[normalizedKey] ?? 'green'
    return {
      id: `revenue-module-${row.key}`,
      label: `${translateDashboardLabel('Entrées')} ${translateDashboardLabel(row.label)}`,
      value: formatFcfa(row.amountFcfa),
      icon,
      variant,
    }
  })
})

const pharmacieRevenueFcfa = computed(() => {
  const rows = overview.value?.revenueBreakdown ?? []
  const pharmacie = rows.find((row) => row.key.toLowerCase() === 'pharmacie')
  return pharmacie?.amountFcfa ?? 0
})

const comptableCashAlert = computed(
  () => gestionnaireOverview.value?.alerts.cashRegisters.find((row) => row.id === 'comptabilite') ?? null,
)

const dashboardAlerts = computed(() => {
  void localeCode.value
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
    const delay = translateCashDelayLabel(cash.hoursSinceLastDisbursement, cash.lastDisbursementAt)
    const scheduleHint = translateCashScheduleHint(cash.hint ?? cash.workflowHint ?? '')
    const statusLabel = translateDashboardLabel(cash.disbursementStatusLabel ?? 'Solde comptable en attente')
    const isDuringDay = cash.disbursementPhase === 'during_day'
    let cashSeverity: 'danger' | 'warning' | 'info' = 'warning'
    if (cash.overdue) cashSeverity = 'danger'
    else if (isDuringDay) cashSeverity = 'info'
    items.push({
      id: 'cash-comptable',
      severity: cashSeverity,
      title: statusLabel,
      message: translateTemplate('{amount} en tirelire comptable ({delay}). {hint}', {
        amount: formatFcfa(cash.pendingFcfa),
        delay,
        hint: scheduleHint,
      }),
      actionLabel: cash.overdue
        ? translateDashboardLabel('Récupérer la tirelire')
        : translateDashboardLabel('Voir la caisse comptable'),
      actionTo: '/gestionnaire/caisse',
    })
  }

  const unpaidPayroll =
    gestionnaireOverview.value?.alerts.unpaidPayroll ?? overview.value?.alerts.unpaidPayroll ?? 0
  if (unpaidPayroll > 0) {
    items.push({
      id: 'payroll',
      severity: 'warning',
      title: translateDashboardLabel('Paie du mois incomplète'),
      message: unpaidPayroll > 1
        ? translateTemplate('{n} salaires encore à valider ce mois.', { n: unpaidPayroll })
        : translateTemplate('{n} salaire encore à valider ce mois.', { n: unpaidPayroll }),
      actionLabel: translateDashboardLabel('Ouvrir la paie'),
      actionTo: showGestionnaireSection.value ? '/gestionnaire/salaires' : '/admin/salaires',
    })
  }

  const pendingExpenses = overview.value?.alerts.pendingExpenses ?? 0
  if (pendingExpenses > 0) {
    items.push({
      id: 'pending-expenses',
      severity: 'warning',
      title: translateDashboardLabel('Dépenses à valider'),
      message: pendingExpenses > 1
        ? translateTemplate('{n} dépenses en attente de validation.', { n: pendingExpenses })
        : translateTemplate('{n} dépense en attente de validation.', { n: pendingExpenses }),
      actionLabel: translateDashboardLabel('Voir les dépenses'),
      actionTo: '/admin/depenses',
    })
  }

  const lowStock = overview.value?.alerts.lowStock ?? 0
  if (lowStock > 0) {
    items.push({
      id: 'low-stock',
      severity: 'warning',
      title: translateDashboardLabel('Stock pharmacie bas'),
      message: lowStock > 1
        ? translateTemplate('{n} produits en stock critique.', { n: lowStock })
        : translateTemplate('{n} produit en stock critique.', { n: lowStock }),
      actionLabel: translateDashboardLabel('Voir la pharmacie'),
      actionTo: '/pharmacie/alertes',
    })
  }

  return items
})

const alertsAriaLabel = computed(() => {
  void localeCode.value
  return translateTemplate('Alertes ({n})', { n: alertsCount.value })
})

const alertsModalSubtitle = computed(() => {
  void localeCode.value
  if (!alertsCount.value) return translateDashboardLabel('Aucune alerte')
  return alertsCount.value > 1
    ? translateTemplate('{n} alertes à traiter', { n: alertsCount.value })
    : translateTemplate('{n} alerte à traiter', { n: alertsCount.value })
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
    if (showAdminSection.value) {
      const { data } = await api.get<AdminDashboardOverview>('/dashboard/admin')
      overview.value = data
      // Priorité au chargement direction pour afficher rapidement cartes + graphes.
      gestionnaireOverview.value = null
    } else if (showGestionnaireSection.value) {
      const { data } = await api.get<GestionnaireDashboardOverview>('/dashboard/gestionnaire')
      gestionnaireOverview.value = data
      overview.value = null
    } else {
      overview.value = null
      gestionnaireOverview.value = null
    }
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
        :aria-label="alertsAriaLabel"
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
        Gestion des dépenses
      </UiButton>
      <UiButton variant="ghost" size="sm" :disabled="loading" @click="loadOverview">
        Actualiser
      </UiButton>
    </template>

    <div class="admin-dashboard">
      <section v-if="showAdminSection && revenueModuleStats.length" class="finance-entry-section">
        <div class="finance-entry-section__header">
          <h3>Entrées financières par module</h3>
          <span>{{ selectedTrendMonth ? 'Période personnalisée' : 'Vue agrégée' }}</span>
        </div>
        <div class="finance-entry-cards">
          <UiStatCard
            v-for="card in revenueModuleStats"
            :key="card.id"
            :label="card.label"
            :value="card.value"
            :icon="card.icon"
            :variant="card.variant"
            compact
          />
        </div>
      </section>

      <section v-if="showAdminSection" class="clinical-cards">
        <UiStatCard
          label="Patients aujourd'hui"
          :value="overview?.clinical.patientsToday ?? 0"
          :icon="Users"
          variant="teal"
          compact
        />
        <UiStatCard
          label="Entrées pharmacie"
          :value="formatFcfa(pharmacieRevenueFcfa)"
          :icon="Wallet"
          variant="green"
          compact
        />
        <UiStatCard
          label="Examens en attente"
          :value="overview?.clinical.examsPending ?? 0"
          :icon="FlaskConical"
          variant="amber"
          compact
        />
        <UiStatCard
          label="Hospitalisations actives"
          :value="overview?.clinical.activeHospitalizations ?? 0"
          :icon="BedDouble"
          variant="violet"
          compact
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
            <UiInput v-model="selectedTrendMonth" type="month" label="Période" class="trend-filters__date" />
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
      :subtitle="alertsModalSubtitle"
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
  gap: 1rem;
}

.finance-entry-section {
  border: 1px solid rgba(22, 163, 74, 0.22);
  border-radius: 14px;
  padding: 0.75rem;
  background: linear-gradient(180deg, rgba(240, 253, 244, 0.75), rgba(255, 255, 255, 0.95));
}

.finance-entry-section__header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.5rem;
}

.finance-entry-section__header h3 {
  margin: 0;
  font-size: 0.95rem;
  color: #166534;
}

.finance-entry-section__header span {
  font-size: 0.75rem;
  color: #4b5563;
}

.finance-entry-cards {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.75rem;
}

.charts-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
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

.trend-filters__date {
  max-width: 220px;
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
  .clinical-cards,
  .finance-entry-cards {
    grid-template-columns: 1fr;
  }

  .charts-grid > :first-child {
    grid-column: auto;
  }
}
</style>
