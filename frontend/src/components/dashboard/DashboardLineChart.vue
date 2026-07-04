<script setup lang="ts">
import { computed } from 'vue'

export type LineSeries = {
  key: string
  label: string
  color: string
  values: number[]
}

const props = defineProps<{
  labels: string[]
  series: LineSeries[]
  formatValue: (value: number) => string
  loading?: boolean
}>()

const maxValue = computed(() => {
  const all = props.series.flatMap((s) => s.values)
  return Math.max(1, ...all, 0)
})

function pointY(value: number, height: number) {
  return height - (value / maxValue.value) * (height - 8) - 4
}

function buildPath(values: number[], width: number, height: number) {
  if (!values.length) return ''
  const step = values.length > 1 ? width / (values.length - 1) : 0
  return values
    .map((value, index) => {
      const x = index * step
      const y = pointY(value, height)
      return `${index === 0 ? 'M' : 'L'} ${x} ${y}`
    })
    .join(' ')
}
</script>

<template>
  <div v-if="loading" class="line-chart-skeleton" />
  <div v-else-if="!labels.length" class="chart-empty">Aucune donnée disponible</div>
  <div v-else class="line-chart">
    <svg class="line-chart__svg" viewBox="0 0 600 200" preserveAspectRatio="none">
      <g v-for="row in series" :key="row.key">
        <path
          :d="buildPath(row.values, 600, 200)"
          fill="none"
          :stroke="row.color"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </g>
    </svg>
    <div class="line-chart__labels">
      <span v-for="label in labels" :key="label">{{ label }}</span>
    </div>
    <div class="chart-legend">
      <span v-for="row in series" :key="row.key">
        <span class="legend-dot" :style="{ background: row.color }" />
        {{ row.label }}
        <strong>{{ formatValue(row.values[row.values.length - 1] ?? 0) }}</strong>
      </span>
    </div>
  </div>
</template>

<style scoped>
.line-chart {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.line-chart__svg {
  width: 100%;
  height: 200px;
  background: linear-gradient(180deg, rgba(244, 246, 239, 0.5) 0%, transparent 100%);
  border-radius: var(--radius);
}

.line-chart__labels {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(0, 1fr));
  gap: 0.25rem;
  font-size: 0.6875rem;
  color: var(--text-light);
  text-align: center;
}

.line-chart-skeleton {
  height: 220px;
  border-radius: var(--radius);
  background: linear-gradient(90deg, #f1f5f9 25%, #e2e8f0 50%, #f1f5f9 75%);
  background-size: 200% 100%;
  animation: shimmer 1.2s infinite;
}

@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
</style>
