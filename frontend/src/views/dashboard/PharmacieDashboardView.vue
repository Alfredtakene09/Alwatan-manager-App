<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { LayoutDashboard, PillBottle, Banknote, PackageX, UserRound } from '@lucide/vue'
import api from '@/api/client'
import { formatFcfa } from '@/lib/roles'
import UiCard from '@/components/ui/UiCard.vue'
import RoleDashboardShell from '@/components/dashboard/RoleDashboardShell.vue'
import DashboardBarChart, { type BarChartDay } from '@/components/dashboard/DashboardBarChart.vue'
import DashboardSplitChart from '@/components/dashboard/DashboardSplitChart.vue'
import DashboardPendingBars from '@/components/dashboard/DashboardPendingBars.vue'
import type { SummaryStat } from '@/lib/dashboard-summary'

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
}

const stats = ref<PharmacieDashboardStats | null>(null)
const loading = ref(false)
const loadError = ref('')

const summaryStats = computed((): SummaryStat[] => {
  if (!stats.value) return []
  const s = stats.value
  const weekTotal = s.salesLast7Days.reduce((sum, day) => sum + day.totalFcfa, 0)
  const weekExternal = s.salesLast7Days.reduce((sum, day) => sum + day.externalFcfa, 0)
  return [
    {
      id: 'prescriptions',
      label: 'Ordonnances (jour)',
      value: s.prescriptionsToday,
      icon: PillBottle,
      variant: 'teal',
      trend: formatFcfa(s.revenueTodayFcfa),
    },
    {
      id: 'external-today',
      label: 'Clients externes (jour)',
      value: s.prescriptionsExternalToday,
      icon: UserRound,
      variant: 'blue',
      trend: 'Ventes comptoir',
    },
    {
      id: 'revenue-week',
      label: 'Ventes 7 jours',
      value: formatFcfa(weekTotal),
      icon: Banknote,
      variant: 'green',
      trend: `${formatFcfa(weekExternal)} externes`,
    },
    {
      id: 'low-stock',
      label: 'Alertes stock',
      value: s.lowStock,
      icon: PackageX,
      variant: 'amber',
      trend: `${s.productsCount} produits actifs`,
    },
  ]
})

const salesChart = computed((): BarChartDay[] => {
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
                  title: `Patients : ${formatFcfa(day.patientFcfa)}`,
                }]
              : []),
            ...(day.externalFcfa > 0
              ? [{
                  key: 'external',
                  value: day.externalFcfa,
                  colorClass: 'bar-chart__bar--c',
                  title: `Clients externes : ${formatFcfa(day.externalFcfa)}`,
                }]
              : []),
          ]
        : [{
            key: 'empty',
            value: 1,
            colorClass: 'bar-chart__bar--empty',
            title: 'Aucune vente',
          }],
  }))
})

const todaySplit = computed(() => {
  if (!stats.value) return []
  const s = stats.value
  return [
    { label: 'Ordonnances patients', value: s.prescriptionsToday, colorClass: 'split-chart__segment--a' },
    { label: 'Ventes clients externes', value: s.prescriptionsExternalToday, colorClass: 'split-chart__segment--b' },
    { label: 'Alertes stock', value: s.lowStock, colorClass: 'split-chart__segment--c' },
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
    stats.value = data
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
    subtitle="Résumé pharmacie — ventes, ordonnances, clients externes et stock"
    :icon="LayoutDashboard"
    :stats="summaryStats"
    :loading="loading"
    :load-error="loadError"
    @refresh="loadStats"
  >
    <div class="charts-grid">
      <UiCard title="Ventes — 7 derniers jours" description="Encaissements patients et clients externes" :icon="Banknote" icon-variant="green">
        <DashboardBarChart
          :days="salesChart"
          :loading="loading"
          :format-total="formatFcfa"
          :legend="[
            { key: 'patient', label: 'Patients', colorClass: 'legend-dot--a' },
            { key: 'external', label: 'Clients externes', colorClass: 'legend-dot--c' },
          ]"
        />
      </UiCard>

      <UiCard title="Activité du jour" description="Ordonnances, ventes externes et alertes" :icon="PillBottle" icon-variant="teal">
        <DashboardSplitChart
          :rows="todaySplit"
          :format-value="(v) => String(v)"
          empty-label="Aucune activité aujourd'hui"
        />
      </UiCard>
    </div>

    <UiCard title="Stocks critiques" description="Niveau par rapport au seuil d'alerte" :icon="PackageX" icon-variant="amber">
      <div v-if="!stockBars.length" class="chart-empty">Aucune alerte stock</div>
      <DashboardPendingBars v-else :items="stockBars" />
    </UiCard>
  </RoleDashboardShell>
</template>

<style scoped>
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

@media (max-width: 960px) {
  .charts-grid {
    grid-template-columns: 1fr;
  }
}
</style>
