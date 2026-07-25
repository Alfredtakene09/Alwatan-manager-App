<script setup lang="ts">
import { LayoutDashboard, Package, Banknote, PackageX, ClipboardList } from '@lucide/vue'
import { computed, onMounted, ref } from 'vue'
import api from '@/api/client'
import { formatFcfa } from '@/lib/roles'
import RoleDashboardShell from '@/components/dashboard/RoleDashboardShell.vue'
import DashboardLineChart from '@/components/dashboard/DashboardLineChart.vue'
import DashboardSplitChart from '@/components/dashboard/DashboardSplitChart.vue'
import DashboardPendingBars from '@/components/dashboard/DashboardPendingBars.vue'
import UiCard from '@/components/ui/UiCard.vue'
import type { SummaryStat } from '@/lib/dashboard-summary'

type LogistiqueDashboardStats = {
  itemsCount: number
  lowStock: number
  expiring: number
  stockValueFcfa: number
  pendingRequests: number
  requestsByStatus: { pending: number; fulfilled: number; rejected: number }
  pendingByService: Array<{ service: string; count: number }>
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

const movementLabels = computed(() => stats.value?.movementsLast7Days.map((day) => day.dayLabel) ?? [])

const movementSeries = computed(() => {
  if (!stats.value) return []
  return [
    {
      key: 'entries',
      label: 'Entrées',
      color: '#2563eb',
      values: stats.value.movementsLast7Days.map((day) => day.entries),
    },
    {
      key: 'exits',
      label: 'Sorties',
      color: '#d97706',
      values: stats.value.movementsLast7Days.map((day) => day.exits),
    },
  ]
})

const requestsSplit = computed(() => {
  if (!stats.value) return []
  const r = stats.value.requestsByStatus
  return [
    { label: 'En attente', value: r.pending, colorClass: 'split-chart__segment--c' },
    { label: 'Livrées', value: r.fulfilled, colorClass: 'split-chart__segment--b' },
    { label: 'Refusées', value: r.rejected, colorClass: 'split-chart__segment--d' },
  ]
})

const pendingServiceBars = computed(() => {
  if (!stats.value?.pendingByService.length) return []
  return stats.value.pendingByService.map((row) => ({
    label: row.service,
    count: row.count,
    color: '#d97706',
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
      <UiCard
        title="Mouvements — 7 derniers jours"
        description="Entrées et sorties de stock"
        :icon="Package"
        icon-variant="blue"
      >
        <DashboardLineChart
          :labels="movementLabels"
          :series="movementSeries"
          :loading="loading"
          :format-value="(v) => String(v)"
        />
      </UiCard>

      <UiCard
        title="Demandes — répartition"
        description="Statut des bons de sortie internes"
        :icon="ClipboardList"
        icon-variant="amber"
      >
        <DashboardSplitChart
          :rows="requestsSplit"
          :format-value="(v) => String(v)"
          empty-label="Aucune demande enregistrée"
        />

        <div v-if="pendingServiceBars.length" class="requests-by-service">
          <p class="requests-by-service__title">En attente par service</p>
          <DashboardPendingBars :items="pendingServiceBars" />
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

.requests-by-service {
  margin-top: 1.25rem;
  padding-top: 1rem;
  border-top: 1px dashed var(--border);
}

.requests-by-service__title {
  margin: 0 0 0.75rem;
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
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

<style>
@import '@/styles/dashboard-charts.css';
</style>
