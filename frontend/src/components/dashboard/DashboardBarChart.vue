<script setup lang="ts">
import { computed } from 'vue'

export type BarChartDay = {
  date: string
  dayLabel: string
  total: number
  segments: Array<{
    key: string
    value: number
    colorClass: string
    title: string
  }>
}

const props = defineProps<{
  days: BarChartDay[]
  loading?: boolean
  formatTotal?: (value: number) => string
  legend: Array<{ key: string; label: string; colorClass: string }>
}>()

const maxTotal = computed(() => Math.max(...props.days.map((day) => day.total), 1))

function formatValue(value: number) {
  return props.formatTotal ? props.formatTotal(value) : String(value)
}
</script>

<template>
  <div v-if="loading && !days.length" class="chart-empty">Chargement…</div>
  <div v-else-if="!days.length" class="chart-empty">Aucune donnée sur la période</div>
  <template v-else>
    <div class="bar-chart">
      <div v-for="day in days" :key="day.date" class="bar-chart__column">
        <div class="bar-chart__bars">
          <div
            v-for="segment in day.segments"
            :key="segment.key"
            class="bar-chart__bar"
            :class="segment.colorClass"
            :style="{ height: `${(segment.value / maxTotal) * 100}%` }"
            :title="segment.title"
          />
        </div>
        <span class="bar-chart__total">{{ day.total > 0 ? formatValue(day.total) : '—' }}</span>
        <span class="bar-chart__label">{{ day.dayLabel }}</span>
      </div>
    </div>
    <div class="chart-legend">
      <span v-for="item in legend" :key="item.key">
        <i class="legend-dot" :class="item.colorClass" /> {{ item.label }}
      </span>
    </div>
  </template>
</template>

<style scoped>
.bar-chart__bar--a { background: linear-gradient(180deg, #3b82f6, #2563eb); }
.bar-chart__bar--b { background: linear-gradient(180deg, #14b8a6, #0d9488); }
.bar-chart__bar--c { background: linear-gradient(180deg, #f59e0b, #d97706); }
.bar-chart__bar--d { background: linear-gradient(180deg, #a855f7, #7c3aed); }
.bar-chart__bar--e { background: linear-gradient(180deg, #fb7185, #e11d48); }

.legend-dot--a { background: #2563eb; }
.legend-dot--b { background: #0d9488; }
.legend-dot--c { background: #d97706; }
.legend-dot--d { background: #7c3aed; }
.legend-dot--e { background: #e11d48; }
</style>
