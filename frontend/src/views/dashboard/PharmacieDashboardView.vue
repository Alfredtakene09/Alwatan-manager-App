<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  LayoutDashboard,
  PillBottle,
  Banknote,
  PackageX,
  UserRound,
  TrendingUp,
  Wallet,
  Percent,
  ShoppingBag,
  Receipt,
} from '@lucide/vue'
import api from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { canAccessModule, formatFcfa } from '@/lib/roles'
import UiCard from '@/components/ui/UiCard.vue'
import RoleDashboardShell from '@/components/dashboard/RoleDashboardShell.vue'
import DashboardBarChart, { type BarChartDay } from '@/components/dashboard/DashboardBarChart.vue'
import DashboardPendingBars from '@/components/dashboard/DashboardPendingBars.vue'
import UiStatCard from '@/components/ui/UiStatCard.vue'
import type { SummaryStat } from '@/lib/dashboard-summary'
import { useAppI18n } from '@/i18n/useAppI18n'
import { translateTemplate } from '@/lib/dashboard-i18n'

type PharmacyProfit = {
  revenueFcfa: number
  costFcfa: number
  profitFcfa: number
  marginPercent: number
}

type PharmacieDashboardStats = {
  productsCount: number
  lowStock: number
  prescriptionsToday: number
  prescriptionsExternalToday: number
  revenueTodayFcfa: number
  salesLast7Days: Array<{
    date: string
    dayLabel: string
    totalFcfa: number
    patientFcfa: number
    externalFcfa: number
  }>
  topLowStock: Array<{ name: string; quantity: number; minStock: number; level: string }>
  profitToday: PharmacyProfit
  profitWeek: PharmacyProfit
}

const emptyProfit = (): PharmacyProfit => ({
  revenueFcfa: 0,
  costFcfa: 0,
  profitFcfa: 0,
  marginPercent: 0,
})

const auth = useAuthStore()
const { uiText, localeCode } = useAppI18n()
const stats = ref<PharmacieDashboardStats | null>(null)
const loading = ref(false)
const loadError = ref('')

const isPharmacist = computed(() => auth.user?.role === 'PHARMACIEN')

const showProfitSection = computed(() =>
  auth.user ? canAccessModule(auth.user.role, 'gestionnaire') : false,
)

const dashboardSubtitle = computed(() => {
  void localeCode.value
  if (isPharmacist.value) return uiText('Mes ventes, ordonnances et stock')
  if (showProfitSection.value) return uiText('Résumé pharmacie — bénéfice, ventes, ordonnances et stock')
  return uiText('Résumé pharmacie — ventes, ordonnances et stock')
})

const salesChartTitle = computed(() => {
  void localeCode.value
  return isPharmacist.value
    ? uiText('Mes ventes — 7 derniers jours')
    : uiText('Ventes — 7 derniers jours')
})

const salesChartDescription = computed(() => {
  void localeCode.value
  return isPharmacist.value
    ? uiText('Histogramme de vos encaissements patients et clients externes')
    : uiText('Histogramme des encaissements patients et clients externes')
})

const activityChartTitle = computed(() => {
  void localeCode.value
  return isPharmacist.value ? uiText('Mon activité du jour') : uiText('Activité du jour')
})

const salesLegend = computed(() => {
  void localeCode.value
  return [
    { key: 'patient', label: uiText('Patients'), colorClass: 'legend-dot--a' },
    { key: 'external', label: uiText('Clients externes'), colorClass: 'legend-dot--c' },
  ]
})

const activityLegend = computed(() => {
  void localeCode.value
  return [
    { key: 'ordonnances', label: uiText('Ordonnances'), colorClass: 'legend-dot--b' },
    { key: 'externes', label: uiText('Externes'), colorClass: 'legend-dot--c' },
    { key: 'alertes', label: uiText('Alertes stock'), colorClass: 'legend-dot--e' },
  ]
})

const summaryStats = computed((): SummaryStat[] => {
  void localeCode.value
  if (!stats.value) return []
  const s = stats.value
  const today = s.profitToday ?? emptyProfit()
  const week = s.profitWeek ?? emptyProfit()
  const cards: SummaryStat[] = [
    {
      id: 'prescriptions',
      label: isPharmacist.value ? uiText('Mes ordonnances (jour)') : uiText('Ordonnances (jour)'),
      value: s.prescriptionsToday,
      icon: PillBottle,
      variant: 'teal',
      trend: formatFcfa(s.revenueTodayFcfa),
    },
    {
      id: 'external-today',
      label: isPharmacist.value
        ? uiText('Mes ventes externes (jour)')
        : uiText('Clients externes (jour)'),
      value: s.prescriptionsExternalToday,
      icon: UserRound,
      variant: 'blue',
      trend: uiText('Ventes comptoir'),
    },
    {
      id: 'low-stock',
      label: uiText('Alertes stock'),
      value: s.lowStock,
      icon: PackageX,
      variant: 'amber',
      trend: translateTemplate('{n} produits actifs', { n: s.productsCount }),
    },
  ]
  if (showProfitSection.value) {
    cards.push({
      id: 'purchases-total',
      label: uiText('Prix total des achats'),
      value: formatFcfa(week.costFcfa),
      icon: Receipt,
      variant: 'cyan',
      trend: translateTemplate('7 jours · jour {amount}', { amount: formatFcfa(today.costFcfa) }),
    })
  }
  return cards
})

const profitCards = computed(() => {
  void localeCode.value
  const today = stats.value?.profitToday ?? emptyProfit()
  const week = stats.value?.profitWeek ?? emptyProfit()
  return [
    {
      id: 'profit-today',
      label: uiText('Bénéfice du jour'),
      value: formatFcfa(today.profitFcfa),
      icon: TrendingUp,
      variant: today.profitFcfa >= 0 ? ('green' as const) : ('rose' as const),
      trend: translateTemplate('CA {amount}', { amount: formatFcfa(today.revenueFcfa) }),
    },
    {
      id: 'profit-week',
      label: uiText('Bénéfice 7 jours'),
      value: formatFcfa(week.profitFcfa),
      icon: Wallet,
      variant: week.profitFcfa >= 0 ? ('teal' as const) : ('rose' as const),
      trend: translateTemplate('CA {amount}', { amount: formatFcfa(week.revenueFcfa) }),
    },
    {
      id: 'margin-today',
      label: uiText('Marge du jour'),
      value: `${today.marginPercent} %`,
      icon: Percent,
      variant: 'violet' as const,
      trend: translateTemplate('Coût {amount}', { amount: formatFcfa(today.costFcfa) }),
    },
    {
      id: 'cost-today',
      label: uiText("Coût d'achat (jour)"),
      value: formatFcfa(today.costFcfa),
      icon: ShoppingBag,
      variant: 'amber' as const,
      trend: translateTemplate('Marge 7 j. {n} %', { n: week.marginPercent }),
    },
  ]
})

const salesChart = computed((): BarChartDay[] => {
  void localeCode.value
  if (!stats.value) return []
  return stats.value.salesLast7Days.map((day) => ({
    date: day.date,
    dayLabel: day.dayLabel,
    total: day.totalFcfa,
    segments:
      day.patientFcfa > 0 || day.externalFcfa > 0
        ? [
            ...(day.patientFcfa > 0
              ? [{
                  key: 'patient',
                  value: day.patientFcfa,
                  colorClass: 'bar-chart__bar--a',
                  title: translateTemplate('Patients : {amount}', {
                    amount: formatFcfa(day.patientFcfa),
                  }),
                }]
              : []),
            ...(day.externalFcfa > 0
              ? [{
                  key: 'external',
                  value: day.externalFcfa,
                  colorClass: 'bar-chart__bar--c',
                  title: translateTemplate('Clients externes : {amount}', {
                    amount: formatFcfa(day.externalFcfa),
                  }),
                }]
              : []),
          ]
        : [{
            key: 'empty',
            value: 1,
            colorClass: 'bar-chart__bar--empty',
            title: uiText('Aucune vente'),
          }],
  }))
})

const activityChart = computed((): BarChartDay[] => {
  void localeCode.value
  if (!stats.value) return []
  const s = stats.value
  const makeBar = (
    date: string,
    dayLabel: string,
    value: number,
    colorClass: string,
    title: string,
  ): BarChartDay => ({
    date,
    dayLabel,
    total: value,
    segments:
      value > 0
        ? [{ key: date, value, colorClass, title }]
        : [{ key: 'empty', value: 1, colorClass: 'bar-chart__bar--empty', title }],
  })
  return [
    makeBar(
      'ordonnances',
      uiText('Ordonnances'),
      s.prescriptionsToday,
      'bar-chart__bar--b',
      translateTemplate('Ordonnances patients : {n}', { n: s.prescriptionsToday }),
    ),
    makeBar(
      'externes',
      uiText('Externes'),
      s.prescriptionsExternalToday,
      'bar-chart__bar--c',
      translateTemplate('Clients externes : {n}', { n: s.prescriptionsExternalToday }),
    ),
    makeBar(
      'alertes',
      uiText('Alertes stock'),
      s.lowStock,
      'bar-chart__bar--e',
      translateTemplate('Alertes stock : {n}', { n: s.lowStock }),
    ),
  ]
})

const stockBars = computed(() => {
  if (!stats.value) return []
  return stats.value.topLowStock.map((product) => ({
    label: product.name,
    count: product.quantity,
    scaleMax: Math.max(product.minStock, 1),
    color: product.quantity <= 0 ? '#e11d48' : product.quantity <= Math.max(1, Math.floor(product.minStock / 2)) ? '#e11d48' : '#d97706',
  }))
})

async function loadStats() {
  loading.value = true
  loadError.value = ''
  try {
    const { data } = await api.get<PharmacieDashboardStats>('/dashboard/pharmacie')
    stats.value = {
      ...data,
      profitToday: data.profitToday ?? emptyProfit(),
      profitWeek: data.profitWeek ?? emptyProfit(),
    }
  } catch {
    loadError.value = 'Impossible de charger le tableau de bord pharmacie.'
    stats.value = null
  } finally {
    loading.value = false
  }
}

onMounted(loadStats)
</script>

<template>
  <RoleDashboardShell
    :subtitle="dashboardSubtitle"
    :icon="LayoutDashboard"
    :stats="summaryStats"
    :loading="loading"
    :load-error="loadError"
    @refresh="loadStats"
  >
    <section v-if="showProfitSection" class="profit-section" :aria-label="uiText('Bénéfice pharmacie')">
      <h2 class="profit-section__title">{{ uiText('Bénéfice') }}</h2>
      <p class="profit-section__hint">
        {{ uiText('Marge brute = ventes − coût d’achat (prix d’achat des produits)') }}
      </p>
      <div class="profit-cards">
        <UiStatCard
          v-for="card in profitCards"
          :key="card.id"
          :label="card.label"
          :value="card.value"
          :icon="card.icon"
          :variant="card.variant"
          :trend="card.trend"
          compact
        />
      </div>
    </section>

    <div class="charts-grid">
      <UiCard
        :title="salesChartTitle"
        :description="salesChartDescription"
        :icon="Banknote"
        icon-variant="green"
      >
        <DashboardBarChart
          :days="salesChart"
          :loading="loading"
          :format-total="formatFcfa"
          :legend="salesLegend"
        />
      </UiCard>

      <UiCard
        :title="activityChartTitle"
        :description="uiText('Histogramme — ordonnances, ventes externes et alertes')"
        :icon="PillBottle"
        icon-variant="teal"
      >
        <DashboardBarChart
          :days="activityChart"
          :loading="loading"
          :format-total="(v) => String(v)"
          :legend="activityLegend"
        />
      </UiCard>
    </div>

    <UiCard
      title="Stocks critiques"
      description="Niveau par rapport au seuil d'alerte"
      :icon="PackageX"
      icon-variant="amber"
    >
      <div v-if="!stockBars.length" class="chart-empty">{{ uiText('Aucune alerte stock') }}</div>
      <DashboardPendingBars v-else :items="stockBars" />
    </UiCard>
  </RoleDashboardShell>
</template>

<style scoped>
.profit-section {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.profit-section__title {
  margin: 0;
  font-size: 1rem;
  font-weight: 700;
  color: var(--text);
}

.profit-section__hint {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--text-muted);
}

.profit-cards {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.85rem;
}

.charts-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
}

.chart-empty {
  padding: 2rem 1rem;
  text-align: center;
  color: var(--text-light);
  font-size: 0.875rem;
}

@media (max-width: 1100px) {
  .profit-cards {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 960px) {
  .charts-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 560px) {
  .profit-cards {
    grid-template-columns: 1fr;
  }
}
</style>
