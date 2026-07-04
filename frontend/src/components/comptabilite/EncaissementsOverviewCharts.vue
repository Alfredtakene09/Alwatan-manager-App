<script setup lang="ts">
import { computed } from 'vue'
import { Banknote, Clock, Scissors, BedDouble, FlaskConical } from '@lucide/vue'
import { formatFcfa } from '@/lib/roles'
import UiCard from '@/components/ui/UiCard.vue'
import DashboardLineChart from '@/components/dashboard/DashboardLineChart.vue'
import DashboardDonutChart from '@/components/dashboard/DashboardDonutChart.vue'
import type { ComptabiliteStats } from '@/components/comptabilite/ComptabiliteStatsGrid.vue'

const props = defineProps<{
  stats: ComptabiliteStats | null
  loading?: boolean
}>()

const DONUT_COLORS = ['#2563eb', '#0d9488', '#d97706', '#7c3aed']

const weekLabels = computed(() => (props.stats?.revenueLast7Days ?? []).map((day) => day.dayLabel))

const weekSeries = computed(() => {
  const days = props.stats?.revenueLast7Days ?? []
  return [
    {
      key: 'total',
      label: 'Total encaissé',
      color: '#16a34a',
      values: days.map((day) => day.totalFcfa),
    },
  ]
})

const todayDonut = computed(() => {
  if (!props.stats) return []
  const s = props.stats
  const rows = [
    { key: 'consult', label: 'Consultations', amountFcfa: s.consultationsTodayNetFcfa },
    { key: 'examens', label: 'Examens', amountFcfa: s.labPaidTodayNetFcfa },
    { key: 'operations', label: 'Opérations', amountFcfa: s.surgeryPaidTodayNetFcfa ?? 0 },
    { key: 'hosp', label: 'Hospitalisation', amountFcfa: s.hospitalizationPaidTodayNetFcfa ?? 0 },
  ].filter((row) => row.amountFcfa > 0)
  const total = rows.reduce((sum, row) => sum + row.amountFcfa, 0)
  return rows.map((row, index) => ({
    ...row,
    percent: total > 0 ? Math.round((row.amountFcfa / total) * 100) : 0,
    color: DONUT_COLORS[index % DONUT_COLORS.length]!,
  }))
})

const pendingQueues = computed(() => {
  if (!props.stats) return []
  const s = props.stats
  return [
    {
      key: 'labs',
      label: 'Examens en attente',
      count: s.labPendingCount,
      amountFcfa: s.labPendingGrossFcfa,
      icon: FlaskConical,
      variant: 'amber',
    },
    {
      key: 'surgery',
      label: 'Chirurgies',
      count: s.surgeriesPending,
      amountFcfa: null,
      icon: Scissors,
      variant: 'rose',
    },
    {
      key: 'hosp',
      label: 'Hospitalisations',
      count: s.hospitalizationsPending,
      amountFcfa: null,
      icon: BedDouble,
      variant: 'violet',
    },
  ]
})

const weekTotal = computed(() =>
  (props.stats?.revenueLast7Days ?? []).reduce((sum, day) => sum + day.totalFcfa, 0),
)

const weekAverage = computed(() =>
  props.stats?.revenueLast7Days?.length
    ? Math.round(weekTotal.value / props.stats.revenueLast7Days.length)
    : 0,
)
</script>

<template>
  <div class="encaissements-overview">
    <div class="encaissements-overview__highlights">
      <div class="highlight-card highlight-card--green">
        <span class="highlight-card__label">Encaissé aujourd'hui</span>
        <strong>{{ formatFcfa(stats?.collectedTodayTotalFcfa ?? 0) }}</strong>
        <small>Répartition par type ci-contre</small>
      </div>
      <div class="highlight-card highlight-card--blue">
        <span class="highlight-card__label">Moyenne / jour (7 j)</span>
        <strong>{{ formatFcfa(weekAverage) }}</strong>
        <small>Total semaine : {{ formatFcfa(weekTotal) }}</small>
      </div>
    </div>

    <div class="encaissements-overview__charts">
      <UiCard
        title="Tendance hebdomadaire"
        description="Montant total encaissé par jour — consultations, examens, bloc et hospitalisation"
        :icon="Banknote"
        icon-variant="green"
      >
        <DashboardLineChart
          :labels="weekLabels"
          :series="weekSeries"
          :format-value="formatFcfa"
          :loading="loading"
        />
      </UiCard>

      <UiCard
        title="Répartition du jour"
        description="Part de chaque type de prestation dans les encaissements d'aujourd'hui"
        :icon="Clock"
        icon-variant="teal"
      >
        <DashboardDonutChart
          :slices="todayDonut"
          :format-value="formatFcfa"
          empty-label="Aucun encaissement aujourd'hui"
        />
      </UiCard>
    </div>

    <UiCard
      title="Files d'attente d'encaissement"
      description="Dossiers à traiter avant encaissement — volume et montants estimés"
      :icon="Clock"
      icon-variant="amber"
    >
      <div class="queue-cards">
        <article
          v-for="queue in pendingQueues"
          :key="queue.key"
          class="queue-card"
          :class="`queue-card--${queue.variant}`"
        >
          <div class="queue-card__icon">
            <component :is="queue.icon" :size="20" />
          </div>
          <div class="queue-card__body">
            <span class="queue-card__label">{{ queue.label }}</span>
            <strong class="queue-card__count">{{ queue.count }}</strong>
            <span v-if="queue.amountFcfa != null" class="queue-card__amount">
              {{ formatFcfa(queue.amountFcfa) }}
            </span>
            <span v-else class="queue-card__amount queue-card__amount--muted">dossier(s)</span>
          </div>
        </article>
      </div>
    </UiCard>
  </div>
</template>

<style scoped>
.encaissements-overview {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.encaissements-overview__highlights {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
}

.highlight-card {
  border-radius: var(--radius);
  padding: 1rem 1.15rem;
  border: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.highlight-card--green {
  background: linear-gradient(165deg, rgba(220, 252, 231, 0.65) 0%, #fff 45%);
  border-color: rgba(22, 163, 74, 0.22);
}

.highlight-card--blue {
  background: linear-gradient(165deg, rgba(244, 246, 239, 0.9) 0%, #fff 45%);
  border-color: rgba(107, 124, 62, 0.22);
}

.highlight-card__label {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-muted);
}

.highlight-card strong {
  font-size: 1.65rem;
  letter-spacing: -0.02em;
}

.highlight-card small {
  font-size: 0.75rem;
  color: var(--text-light);
}

.encaissements-overview__charts {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr);
  gap: 1rem;
}

.queue-cards {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.75rem;
}

.queue-card {
  display: flex;
  gap: 0.75rem;
  align-items: flex-start;
  padding: 0.9rem 1rem;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--bg-card);
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.queue-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-sm);
}

.queue-card__icon {
  width: 2.25rem;
  height: 2.25rem;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.queue-card--amber .queue-card__icon { background: #fef3c7; color: #b45309; }
.queue-card--rose .queue-card__icon { background: #ffe4e6; color: #be123c; }
.queue-card--violet .queue-card__icon { background: #ede9fe; color: #7c3aed; }

.queue-card__body {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
}

.queue-card__label {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-muted);
}

.queue-card__count {
  font-size: 1.5rem;
  line-height: 1;
}

.queue-card__amount {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text);
}

.queue-card__amount--muted {
  color: var(--text-light);
  font-weight: 500;
}

@media (max-width: 960px) {
  .encaissements-overview__highlights,
  .encaissements-overview__charts,
  .queue-cards {
    grid-template-columns: 1fr;
  }
}
</style>
