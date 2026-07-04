<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  LayoutDashboard,
  Wallet,
  TrendingDown,
  Users,
  TrendingUp,
  Banknote,
  Bell,
  Clock,
  AlertTriangle,
} from '@lucide/vue'
import api from '@/api/client'
import { formatFcfa } from '@/lib/roles'
import { formatTrendPercent } from '@/lib/admin-dashboard'
import {
  filterDailyFlow,
  formatCashDelayLabel,
  formatShortTimeFr,
  comptableScheduleBadgeLabel,
  type FlowFilter,
  type GestionnaireDashboardOverview,
} from '@/lib/gestionnaire-dashboard'
import UiCard from '@/components/ui/UiCard.vue'
import UiButton from '@/components/ui/UiButton.vue'
import RoleDashboardShell from '@/components/dashboard/RoleDashboardShell.vue'
import DashboardLineChart from '@/components/dashboard/DashboardLineChart.vue'
import DashboardDonutChart from '@/components/dashboard/DashboardDonutChart.vue'
import type { SummaryStat } from '@/lib/dashboard-summary'
import '@/styles/dashboard-page.css'

const router = useRouter()
const overview = ref<GestionnaireDashboardOverview | null>(null)
const loading = ref(false)
const loadError = ref('')
const flowFilter = ref<FlowFilter>(30)

const summaryStats = computed((): SummaryStat[] => {
  const k = overview.value?.financialKpis
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

const filteredFlow = computed(() => {
  if (!overview.value) return []
  return filterDailyFlow(overview.value.dailyFlow, flowFilter.value)
})

const flowLabels = computed(() => filteredFlow.value.map((row) => row.label))
const flowSeries = computed(() => {
  const points = filteredFlow.value
  return [
    {
      key: 'inflows',
      label: 'Entrées',
      color: '#16a34a',
      values: points.map((row) => row.inflowsFcfa),
    },
    {
      key: 'outflows',
      label: 'Sorties',
      color: '#e11d48',
      values: points.map((row) => row.outflowsFcfa),
    },
    {
      key: 'balance',
      label: 'Solde',
      color: '#2563eb',
      values: points.map((row) => row.balanceFcfa),
    },
  ]
})

const expenseDonut = computed(() => overview.value?.expenseBreakdown ?? [])

const comptableCashAlert = computed(
  () => overview.value?.alerts.cashRegisters.find((row) => row.id === 'comptabilite') ?? null,
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
    items.push({
      id: 'cash-comptable',
      severity: cash.overdue ? 'danger' : isDuringDay ? 'info' : 'warning',
      title: cash.overdue ? statusLabel : statusLabel,
      message: `${formatFcfa(cash.pendingFcfa)} en tirelire comptable (${delay}). ${scheduleHint}`,
      actionLabel: cash.overdue ? 'Récupérer la tirelire' : 'Voir la caisse comptable',
      actionTo: '/gestionnaire/caisse',
    })
  }

  const unpaidPayroll = overview.value?.alerts.unpaidPayroll ?? 0
  if (unpaidPayroll > 0) {
    items.push({
      id: 'payroll',
      severity: 'warning',
      title: 'Paie du mois incomplète',
      message: `${unpaidPayroll} salaire${unpaidPayroll > 1 ? 's' : ''} encore à valider ce mois.`,
      actionLabel: 'Ouvrir la paie',
      actionTo: '/gestionnaire/salaires',
    })
  }

  return items
})

async function loadOverview() {
  loading.value = true
  loadError.value = ''
  try {
    const { data } = await api.get<GestionnaireDashboardOverview>('/dashboard/gestionnaire')
    overview.value = data
  } catch {
    loadError.value = 'Impossible de charger le tableau de bord gestionnaire.'
    overview.value = null
  } finally {
    loading.value = false
  }
}

onMounted(loadOverview)
</script>

<template>
  <RoleDashboardShell
    class="gestionnaire-dashboard"
    subtitle="Finances, caisses, dépenses et paie — espace gestionnaire"
    :icon="LayoutDashboard"
    :stats="summaryStats"
    :loading="loading"
    :load-error="loadError"
    @refresh="loadOverview"
  >
    <div class="gestionnaire-dashboard__body">
      <section class="charts-grid">
        <UiCard
          title="Entrées vs sorties"
          :description="`Évolution sur ${flowFilter} jours`"
          :icon="TrendingUp"
          icon-variant="blue"
        >
          <div class="trend-filters">
            <button
              type="button"
              class="trend-filters__btn"
              :class="{ 'trend-filters__btn--active': flowFilter === 7 }"
              @click="flowFilter = 7"
            >
              7 jours
            </button>
            <button
              type="button"
              class="trend-filters__btn"
              :class="{ 'trend-filters__btn--active': flowFilter === 30 }"
              @click="flowFilter = 30"
            >
              30 jours
            </button>
            <button
              type="button"
              class="trend-filters__btn"
              :class="{ 'trend-filters__btn--active': flowFilter === 90 }"
              @click="flowFilter = 90"
            >
              3 mois
            </button>
          </div>
          <DashboardLineChart
            :labels="flowLabels"
            :series="flowSeries"
            :format-value="formatFcfa"
            :loading="loading"
          />
        </UiCard>

        <UiCard
          title="Répartition des dépenses"
          description="Mois en cours — salaires et charges"
          :icon="Wallet"
          icon-variant="amber"
        >
          <DashboardDonutChart
            :slices="expenseDonut"
            :format-value="formatFcfa"
            empty-label="Aucune dépense ce mois"
          />
        </UiCard>
      </section>

      <section class="gestionnaire-widgets">
        <UiCard title="Alertes" :icon="Bell" icon-variant="amber">
          <p class="alerts-intro">
            Collecte <strong>journalière</strong> de la tirelire comptable (reste du compte rendu
            <strong>7h–14h, 16h–21h, 21h–6h</strong>). La
            réception est gérée par le service comptable.
          </p>
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
                    @click="router.push(alert.actionTo)"
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
        </UiCard>

        <UiCard
          title="Derniers décaissements"
          description="Opérations récentes"
          :icon="Banknote"
          icon-variant="green"
        >
          <div v-if="!overview?.recentDisbursements.length" class="chart-empty">
            Aucun décaissement enregistré
          </div>
          <ul v-else class="disbursement-list">
            <li
              v-for="row in overview.recentDisbursements"
              :key="row.id"
              class="disbursement-list__item"
            >
              <div class="disbursement-list__main">
                <strong>{{ formatFcfa(row.amountFcfa) }}</strong>
                <span class="disbursement-list__meta">
                  {{ row.cashierRole }} — {{ row.cashierName }}
                </span>
              </div>
              <div class="disbursement-list__side">
                <span>{{ formatShortTimeFr(row.settledAt) }}</span>
                <span class="disbursement-list__count">
                  {{ row.transactionCount }} transaction{{ row.transactionCount > 1 ? 's' : '' }}
                </span>
              </div>
            </li>
          </ul>
        </UiCard>

        <UiCard
          title="Caisse comptable"
          description="Collecte journalière — créneaux matin, soir et nuit"
          :icon="Wallet"
          icon-variant="teal"
        >
          <div v-if="comptableCashAlert" class="cash-register-cards">
            <div
              class="cash-register-card"
              :class="{
                'cash-register-card--overdue': comptableCashAlert.overdue,
                'cash-register-card--during-day': comptableCashAlert.disbursementPhase === 'during_day',
              }"
            >
              <div class="cash-register-card__head">
                <strong>{{ comptableCashAlert.label }}</strong>
                <span
                  v-if="comptableScheduleBadgeLabel(comptableCashAlert.disbursementPhase)"
                  class="cash-register-card__badge"
                  :class="{
                    'cash-register-card__badge--danger': comptableCashAlert.overdue,
                    'cash-register-card__badge--info': comptableCashAlert.disbursementPhase === 'during_day',
                  }"
                >
                  {{ comptableScheduleBadgeLabel(comptableCashAlert.disbursementPhase) }}
                </span>
              </div>
              <p class="cash-register-card__amount">{{ formatFcfa(comptableCashAlert.pendingFcfa) }}</p>
              <p class="cash-register-card__meta">
                <template v-if="comptableCashAlert.disbursementStatusLabel">
                  {{ comptableCashAlert.disbursementStatusLabel }} —
                </template>
                <template v-if="comptableCashAlert.lastDisbursementAt">
                  {{ formatCashDelayLabel(comptableCashAlert.hoursSinceLastDisbursement, comptableCashAlert.lastDisbursementAt) }}
                </template>
                <template v-else>Aucun passage gestionnaire enregistré</template>
              </p>
              <p v-if="comptableCashAlert.hint" class="cash-register-card__hint">
                {{ comptableCashAlert.hint }}
              </p>
            </div>
          </div>
          <UiButton class="widget-link" size="sm" variant="primary" @click="router.push('/gestionnaire/caisse')">
            Récupérer la tirelire comptable
          </UiButton>
        </UiCard>
      </section>

      <section class="gestionnaire-quick-links">
        <UiButton size="sm" variant="ghost" @click="router.push('/gestionnaire/livre-journal')">Livre journal</UiButton>
        <UiButton size="sm" variant="ghost" @click="router.push('/gestionnaire/depenses')">Dépenses</UiButton>
        <UiButton size="sm" variant="ghost" @click="router.push('/gestionnaire/salaires')">Salaires</UiButton>
        <UiButton size="sm" variant="ghost" @click="router.push('/gestionnaire/finances')">Finances</UiButton>
      </section>
    </div>
  </RoleDashboardShell>
</template>

<style scoped>
.gestionnaire-dashboard :deep(.role-dashboard__title) {
  color: #b45309;
}

.gestionnaire-dashboard__body {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.gestionnaire-widgets {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1rem;
}

.trend-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.trend-filters__btn {
  border: 1px solid rgba(180, 83, 9, 0.2);
  background: #fff;
  color: #92400e;
  border-radius: 999px;
  padding: 0.35rem 0.75rem;
  font-size: 0.8125rem;
  cursor: pointer;
}

.trend-filters__btn--active {
  background: linear-gradient(135deg, #f59e0b, #d97706);
  border-color: transparent;
  color: #fff;
}

.alerts-intro {
  margin: 0 0 1rem;
  font-size: 0.875rem;
  color: #64748b;
  line-height: 1.5;
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

.alerts-list__item--info {
  background: #eff6ff;
  color: #1e40af;
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

.alerts-list__item--danger {
  background: #fef2f2;
  color: #991b1b;
}

.alerts-list__item--warning {
  background: #fffbeb;
  color: #92400e;
}

.alerts-list__item--ok {
  background: #f0fdf4;
  color: #166534;
}

.disbursement-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.disbursement-list__item {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  padding-bottom: 0.75rem;
  border-bottom: 1px solid rgba(15, 23, 42, 0.08);
}

.disbursement-list__item:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.disbursement-list__main {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.disbursement-list__meta,
.disbursement-list__count {
  font-size: 0.8125rem;
  color: var(--color-text-muted, #64748b);
}

.disbursement-list__side {
  text-align: right;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  font-size: 0.875rem;
}

.cash-register-cards {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.cash-register-card {
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 0.75rem;
  padding: 0.85rem 1rem;
  background: #fff;
}

.cash-register-card--overdue {
  border-color: #fecaca;
  background: #fff7f7;
}

.cash-register-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.cash-register-card--during-day {
  border-color: #bfdbfe;
  background: #f8fafc;
}

.cash-register-card__badge {
  color: #fff;
  font-size: 0.6875rem;
  font-weight: 700;
  padding: 0.15rem 0.45rem;
  border-radius: 999px;
}

.cash-register-card__badge--info {
  background: #2563eb;
}

.cash-register-card__hint {
  margin: 0.35rem 0 0;
  font-size: 0.75rem;
  color: var(--color-text-muted, #64748b);
  line-height: 1.4;
}

.cash-register-card__amount {
  margin: 0.35rem 0 0.15rem;
  font-size: 1.25rem;
  font-weight: 700;
  color: #0f172a;
}

.cash-register-card__meta {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--color-text-muted, #64748b);
}

.widget-link {
  margin-top: 0.75rem;
}

.gestionnaire-quick-links {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

@media (max-width: 1100px) {
  .gestionnaire-widgets {
    grid-template-columns: 1fr;
  }
}
</style>
