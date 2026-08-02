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
  Activity,
} from '@lucide/vue'
import api from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { canAccessModule, formatFcfa } from '@/lib/roles'
import type { AdminDashboardOverview } from '@/lib/admin-dashboard'
import {
  formatMonthLabel,
  formatTrendPercentLocalized,
  translateDashboardLabel,
  translateTemplate,
} from '@/lib/dashboard-i18n'
import { useAppI18n } from '@/i18n/useAppI18n'
import type { GestionnaireDashboardOverview } from '@/lib/gestionnaire-dashboard'
import UiCard from '@/components/ui/UiCard.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiStatCard from '@/components/ui/UiStatCard.vue'
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
  const cash = gestionnaireOverview.value?.kpis
  const soldeFcfa = cash
    ? cash.receptionCashFcfa + cash.comptableCashFcfa
    : 0
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
    {
      id: 'balance',
      label: translateDashboardLabel('Solde'),
      value: formatFcfa(soldeFcfa),
      icon: Wallet,
      variant: 'cyan',
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

const operationsTotalFcfa = computed(() =>
  (overview.value?.operationsByService ?? []).reduce((sum, row) => sum + row.amountFcfa, 0),
)

const operationsTotalCount = computed(() =>
  (overview.value?.operationsByService ?? []).reduce((sum, row) => sum + row.count, 0),
)

const operationsCountLabel = computed(() => {
  void localeCode.value
  const n = operationsTotalCount.value
  return n <= 1
    ? translateTemplate('{n} opération', { n })
    : translateTemplate('{n} opérations', { n })
})

async function loadOverview() {
  loading.value = true
  loadError.value = ''
  try {
    const tasks: Promise<void>[] = []

    if (showAdminSection.value) {
      tasks.push(
        api.get<AdminDashboardOverview>('/dashboard/admin').then(({ data }) => {
          overview.value = data
        }),
      )
    } else {
      overview.value = null
    }

    if (showGestionnaireSection.value) {
      tasks.push(
        api.get<GestionnaireDashboardOverview>('/dashboard/gestionnaire').then(({ data }) => {
          gestionnaireOverview.value = data
        }),
      )
    } else {
      gestionnaireOverview.value = null
    }

    if (!tasks.length) {
      overview.value = null
      gestionnaireOverview.value = null
    } else {
      await Promise.all(tasks)
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
          label="Opération"
          :value="formatFcfa(operationsTotalFcfa)"
          :trend="operationsCountLabel"
          :icon="Activity"
          variant="amber"
          compact
        />
        <UiStatCard
          label="Patients aujourd'hui"
          :value="overview?.clinical.patientsToday ?? 0"
          :icon="Users"
          variant="teal"
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
  grid-template-columns: repeat(5, minmax(0, 1fr));
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

@media (max-width: 1100px) {
  .charts-grid,
  .clinical-cards {
    grid-template-columns: 1fr;
  }

  .charts-grid > :first-child {
    grid-column: auto;
  }
}

@media (max-width: 800px) {
  .finance-entry-cards {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 520px) {
  .finance-entry-cards {
    grid-template-columns: 1fr;
  }
}
</style>
