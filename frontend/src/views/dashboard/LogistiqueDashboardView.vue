<script setup lang="ts">
import { LayoutDashboard, Package, Banknote, PackageX, ClipboardList } from '@lucide/vue'
import { computed, onMounted, ref } from 'vue'
import api from '@/api/client'
import { formatFcfa } from '@/lib/roles'
import RoleDashboardShell from '@/components/dashboard/RoleDashboardShell.vue'
import DashboardBarChart, { type BarChartDay } from '@/components/dashboard/DashboardBarChart.vue'
import DashboardPendingBars from '@/components/dashboard/DashboardPendingBars.vue'
import UiCard from '@/components/ui/UiCard.vue'
import type { SummaryStat } from '@/lib/dashboard-summary'

type LogistiqueDashboardStats = {
  itemsCount: number
  lowStock: number
  expiring: number
  stockValueFcfa: number
  pendingRequests: number
  movementsLast7Days: Array<{ date: string; dayLabel: string; entries: number; exits: number }>
  topLowStock: Array<{ name: string; quantity: number; minStock: number; level: string }>
}

const stats = ref<LogistiqueDashboardStats | null>(null)
const loading = ref(false)
const loadError = ref('')

const summaryStats = computed((): SummaryStat[] => {
  if (!stats.value) return []
  const s = stats.value
  const weekEntries = s.movementsLast7Days.reduce((sum, day) => sum + day.entries, 0)
  const weekExits = s.movementsLast7Days.reduce((sum, day) => sum + day.exits, 0)
  return [
    {
      id: 'items',
      label: 'Articles actifs',
      value: s.itemsCount,
      icon: Package,
      variant: 'blue',
      trend: formatFcfa(s.stockValueFcfa),
    },
    {
      id: 'requests',
      label: 'Demandes en attente',
      value: s.pendingRequests,
      icon: ClipboardList,
      variant: 'amber',
      trend: 'Bons de sortie',
    },
    {
      id: 'movements',
      label: 'Mouvements 7 jours',
      value: weekEntries + weekExits,
      icon: Banknote,
      variant: 'green',
      trend: `${weekEntries} entrées · ${weekExits} sorties`,
    },
    {
      id: 'alerts',
      label: 'Alertes stock',
      value: s.lowStock,
      icon: PackageX,
      variant: 'amber',
      trend: s.expiring > 0 ? `${s.expiring} péremption(s)` : 'Stock surveillé',
    },
  ]
})

const movementsChart = computed((): BarChartDay[] => {
  if (!stats.value) return []
  return stats.value.movementsLast7Days.map((day) => ({
    date: day.date,
    dayLabel: day.dayLabel,
    total: day.entries + day.exits,
    segments:
      day.entries > 0 || day.exits > 0
        ? [
            ...(day.entries > 0
              ? [{
                  key: 'entries',
                  value: day.entries,
                  colorClass: 'bar-chart__bar--a',
                  title: `Entrées : ${day.entries}`,
                }]
              : []),
            ...(day.exits > 0
              ? [{
                  key: 'exits',
                  value: day.exits,
                  colorClass: 'bar-chart__bar--c',
                  title: `Sorties : ${day.exits}`,
                }]
              : []),
          ]
        : [{
            key: 'empty',
            value: 1,
            colorClass: 'bar-chart__bar--empty',
            title: 'Aucun mouvement',
          }],
  }))
})

const stockBars = computed(() => {
  if (!stats.value) return []
  return stats.value.topLowStock.map((item) => ({
    label: item.name,
    count: item.quantity,
    scaleMax: Math.max(item.minStock, 1),
    color: item.level === 'out' || item.level === 'critical' ? '#e11d48' : '#d97706',
  }))
})

async function loadStats() {
  loading.value = true
  loadError.value = ''
  try {
    const { data } = await api.get<LogistiqueDashboardStats>('/logistique/dashboard')
    stats.value = data
  } catch {
    loadError.value = 'Impossible de charger le tableau de bord logistique.'
    stats.value = null
  } finally {
    loading.value = false
  }
}

onMounted(loadStats)
</script>

<template>
  <RoleDashboardShell
    subtitle="Résumé logistique — stock, mouvements et demandes internes"
    :icon="LayoutDashboard"
    :stats="summaryStats"
    :loading="loading"
    :load-error="loadError"
    @refresh="loadStats"
  >
    <div class="charts-grid">
      <UiCard title="Mouvements — 7 derniers jours" description="Entrées et sorties de stock" :icon="Package" icon-variant="blue">
        <DashboardBarChart
          :days="movementsChart"
          :loading="loading"
          :format-total="(v) => String(v)"
          :legend="[
            { key: 'entries', label: 'Entrées', colorClass: 'legend-dot--a' },
            { key: 'exits', label: 'Sorties', colorClass: 'legend-dot--c' },
          ]"
        />
      </UiCard>

      <UiCard title="Demandes en attente" description="Bons de sortie à traiter" :icon="ClipboardList" icon-variant="amber">
        <div class="pending-count">
          <span class="pending-count__value">{{ stats?.pendingRequests ?? 0 }}</span>
          <span class="pending-count__label">demande(s) en attente</span>
        </div>
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

.pending-count {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 2rem 1rem;
  text-align: center;
}

.pending-count__value {
  font-size: 2.5rem;
  font-weight: 800;
  color: #b45309;
  line-height: 1;
}

.pending-count__label {
  margin-top: 0.35rem;
  font-size: 0.875rem;
  color: var(--text-muted);
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
