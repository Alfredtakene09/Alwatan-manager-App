<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { BarChart3, RefreshCw } from '@lucide/vue'
import api from '@/api/client'
import { formatFcfa } from '@/lib/roles'
import UiCard from '@/components/ui/UiCard.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import DashboardBarChart, { type BarChartDay } from '@/components/dashboard/DashboardBarChart.vue'
import DashboardPendingBars from '@/components/dashboard/DashboardPendingBars.vue'

type PharmacyReport = {
  from: string
  to: string
  prescriptionsCount: number
  totalUnitsSold: number
  totalRevenueFcfa: number
  salesByDay: Array<{ date: string; dayLabel: string; totalFcfa: number }>
  topProducts: Array<{ name: string; quantity: number; revenueFcfa: number }>
  salesByCategory: Array<{ name: string; quantity: number; revenueFcfa: number }>
}

const report = ref<PharmacyReport | null>(null)
const loading = ref(false)
const message = ref('')
const period = ref<'7d' | '30d' | 'month'>('7d')

const salesChart = computed((): BarChartDay[] => {
  if (!report.value) return []
  return report.value.salesByDay.map((day) => ({
    date: day.date,
    dayLabel: day.dayLabel,
    total: day.totalFcfa,
    segments: [
      {
        key: 'sales',
        value: day.totalFcfa,
        colorClass: 'bar-chart__bar--a',
        title: `Ventes : ${formatFcfa(day.totalFcfa)}`,
      },
    ],
  }))
})

const topProductBars = computed(() => {
  if (!report.value) return []
  return report.value.topProducts.map((row) => ({
    label: row.name,
    count: row.revenueFcfa,
    amount: row.revenueFcfa,
    color: '#0d9488',
  }))
})

const categoryBars = computed(() => {
  if (!report.value) return []
  return report.value.salesByCategory.map((row) => ({
    label: row.name,
    count: row.revenueFcfa,
    amount: row.revenueFcfa,
    color: '#7c3aed',
  }))
})

async function loadReport() {
  loading.value = true
  message.value = ''
  try {
    const { data } = await api.get<PharmacyReport>('/pharmacie/reports', { params: { period: period.value } })
    report.value = data
  } catch {
    message.value = 'Impossible de charger le rapport.'
    report.value = null
  } finally {
    loading.value = false
  }
}

onMounted(loadReport)
</script>

<template>
  <div class="reports-layout">
    <UiCard
      title="Rapport des ventes"
      description="Chiffre d'affaires, volumes et classements"
      :icon="BarChart3"
      icon-variant="green"
    >
      <template #actions>
        <UiSelect v-model="period" label="Période" class="period-select" @change="loadReport">
          <option value="7d">7 derniers jours</option>
          <option value="30d">30 derniers jours</option>
          <option value="month">Mois en cours</option>
        </UiSelect>
        <UiButton variant="ghost" size="sm" :icon="RefreshCw" :disabled="loading" @click="loadReport">
          Actualiser
        </UiButton>
      </template>

      <UiAlert v-if="message" type="error" :message="message" />

      <div v-if="report" class="report-kpis">
        <div class="kpi">
          <span>Ordonnances</span>
          <strong>{{ report.prescriptionsCount }}</strong>
        </div>
        <div class="kpi">
          <span>Unités vendues</span>
          <strong>{{ report.totalUnitsSold }}</strong>
        </div>
        <div class="kpi kpi--accent">
          <span>Chiffre d'affaires</span>
          <strong>{{ formatFcfa(report.totalRevenueFcfa) }}</strong>
        </div>
      </div>
    </UiCard>

    <div class="charts-grid">
      <UiCard title="Ventes par jour" description="Encaissements sur la période" :icon="BarChart3" icon-variant="teal">
        <DashboardBarChart
          :days="salesChart"
          :loading="loading"
          :format-total="formatFcfa"
          :legend="[{ key: 'sales', label: 'Ventes', colorClass: 'legend-dot--a' }]"
        />
      </UiCard>

      <UiCard title="Top produits" description="Classement par chiffre d'affaires" :icon="BarChart3" icon-variant="amber">
        <div v-if="!topProductBars.length" class="chart-empty">Aucune vente sur la période</div>
        <DashboardPendingBars v-else :items="topProductBars" />
      </UiCard>

      <UiCard title="Ventes par catégorie" description="Répartition du CA" :icon="BarChart3" icon-variant="violet">
        <div v-if="!categoryBars.length" class="chart-empty">Aucune vente sur la période</div>
        <DashboardPendingBars v-else :items="categoryBars" />
      </UiCard>
    </div>
  </div>
</template>

<style scoped>
@import '@/styles/dashboard-charts.css';

.reports-layout {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.period-select {
  min-width: 11rem;
}

.report-kpis {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.75rem;
  margin-top: 0.5rem;
}

.kpi {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.85rem 1rem;
  border-radius: var(--radius-sm);
  background: var(--surface-muted, #f8faf5);
  border: 1px solid var(--border);
  font-size: 0.8125rem;
  color: var(--text-muted);
}

.kpi strong {
  font-size: 1.15rem;
  color: var(--primary-800);
}

.kpi--accent strong {
  color: var(--action);
}

.charts-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
}

.charts-grid > :first-child {
  grid-column: 1 / -1;
}

.chart-empty {
  padding: 2rem 1rem;
  text-align: center;
  color: var(--text-muted);
  font-size: 0.875rem;
}

@media (max-width: 900px) {
  .report-kpis,
  .charts-grid {
    grid-template-columns: 1fr;
  }

  .charts-grid > :first-child {
    grid-column: auto;
  }
}
</style>
