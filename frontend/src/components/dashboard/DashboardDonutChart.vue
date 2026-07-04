<script setup lang="ts">
import { computed } from 'vue'

export type DonutSlice = {
  key: string
  label: string
  amountFcfa: number
  percent: number
  color: string
}

const props = defineProps<{
  slices: DonutSlice[]
  formatValue: (value: number) => string
  emptyLabel?: string
}>()

const total = computed(() => props.slices.reduce((sum, row) => sum + row.amountFcfa, 0))

const gradient = computed(() => {
  if (!total.value) return '#e2e8f0'
  let cursor = 0
  const stops = props.slices.map((slice) => {
    const start = cursor
    cursor += (slice.amountFcfa / total.value) * 100
    return `${slice.color} ${start}% ${cursor}%`
  })
  return `conic-gradient(${stops.join(', ')})`
})
</script>

<template>
  <div v-if="!total" class="chart-empty">{{ emptyLabel ?? 'Aucune recette ce mois' }}</div>
  <div v-else class="donut-chart">
    <div class="donut-chart__ring" :style="{ background: gradient }">
      <div class="donut-chart__hole">
        <span>Total</span>
        <strong>{{ formatValue(total) }}</strong>
      </div>
    </div>
    <div class="donut-chart__legend">
      <div v-for="slice in slices" :key="slice.key" class="donut-chart__row">
        <span class="donut-chart__dot" :style="{ background: slice.color }" />
        <span>{{ slice.label }}</span>
        <strong>{{ formatValue(slice.amountFcfa) }} ({{ slice.percent }} %)</strong>
      </div>
    </div>
  </div>
</template>

<style scoped>
.donut-chart {
  display: grid;
  grid-template-columns: minmax(0, 11rem) 1fr;
  gap: 1.25rem;
  align-items: center;
}

.donut-chart__ring {
  width: 11rem;
  height: 11rem;
  border-radius: 50%;
  display: grid;
  place-items: center;
  margin: 0 auto;
}

.donut-chart__hole {
  width: 6.5rem;
  height: 6.5rem;
  border-radius: 50%;
  background: var(--bg-card);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: 0.2rem;
  box-shadow: inset 0 0 0 1px var(--border);
}

.donut-chart__hole span {
  font-size: 0.6875rem;
  color: var(--text-muted);
}

.donut-chart__hole strong {
  font-size: 0.8125rem;
}

.donut-chart__legend {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

.donut-chart__row {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 0.5rem;
  align-items: center;
  font-size: 0.8125rem;
  color: var(--text-muted);
}

.donut-chart__dot {
  width: 0.65rem;
  height: 0.65rem;
  border-radius: 999px;
}

.donut-chart__row strong {
  color: var(--text);
  font-size: 0.75rem;
}

@media (max-width: 700px) {
  .donut-chart {
    grid-template-columns: 1fr;
  }
}
</style>
