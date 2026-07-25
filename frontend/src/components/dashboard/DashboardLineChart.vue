<script setup lang="ts">
import { computed } from 'vue'
import { useAppI18n } from '@/i18n/useAppI18n'
import { translateDashboardLabel } from '@/lib/dashboard-i18n'

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

const { localeCode } = useAppI18n()
const emptyLabel = computed(() => {
  void localeCode.value
  return translateDashboardLabel('Aucune donnée disponible')
})
const localizedSeries = computed(() => {
  void localeCode.value
  return props.series.map((row) => ({
    ...row,
    label: translateDashboardLabel(row.label),
  }))
})

const PAD_X = 14
const PAD_TOP = 14
const PAD_BOTTOM = 16
const CHART_WIDTH = 600
const CHART_HEIGHT = 200

const dataExtent = computed(() => {
  const all = props.series.flatMap((s) => s.values)
  const min = Math.min(0, ...all, 0)
  const max = Math.max(0, ...all, 0)
  if (min === max) return { min: min - 1, max: max + 1 }
  return { min, max }
})

function pointY(value: number, height: number) {
  const usable = height - PAD_TOP - PAD_BOTTOM
  const ratio = (value - dataExtent.value.min) / (dataExtent.value.max - dataExtent.value.min)
  const y = PAD_TOP + (1 - ratio) * usable
  return Math.max(PAD_TOP, Math.min(height - PAD_BOTTOM, y))
}

const zeroLineY = computed(() => pointY(0, CHART_HEIGHT))

const histogramBars = computed(() => {
  const labelCount = Math.max(1, props.labels.length)
  const seriesCount = Math.max(1, props.series.length)
  const usableWidth = CHART_WIDTH - PAD_X * 2
  const groupWidth = usableWidth / labelCount
  const barGap = 3
  const barWidth = Math.max(4, (groupWidth - barGap * (seriesCount - 1)) / seriesCount)

  const bars: Array<{
    key: string
    x: number
    y: number
    width: number
    height: number
    color: string
    value: number
  }> = []

  props.labels.forEach((_, labelIndex) => {
    const groupStartX = PAD_X + labelIndex * groupWidth
    props.series.forEach((row, seriesIndex) => {
      const value = row.values[labelIndex] ?? 0
      const valueY = pointY(value, CHART_HEIGHT)
      const baselineY = zeroLineY.value
      bars.push({
        key: `${row.key}-${labelIndex}`,
        x: groupStartX + seriesIndex * (barWidth + barGap),
        y: Math.min(valueY, baselineY),
        width: barWidth,
        height: Math.max(1, Math.abs(valueY - baselineY)),
        color: row.color,
        value,
      })
    })
  })

  return bars
})
</script>

<template>
  <div v-if="loading" class="line-chart-skeleton" />
  <div v-else-if="!labels.length" class="chart-empty">{{ emptyLabel }}</div>
  <div v-else class="line-chart">
    <div class="line-chart__legend">
      <div v-for="row in localizedSeries" :key="row.key" class="line-chart__legend-item">
        <span class="line-chart__legend-line" :style="{ backgroundColor: row.color }" />
        <span class="line-chart__legend-label">{{ row.label }}</span>
      </div>
    </div>
    <svg class="line-chart__svg" viewBox="0 0 600 200" preserveAspectRatio="none" overflow="visible">
      <line class="line-chart__baseline" :x1="PAD_X" :x2="CHART_WIDTH - PAD_X" :y1="zeroLineY" :y2="zeroLineY" />
      <rect
        v-for="bar in histogramBars"
        :key="bar.key"
        :x="bar.x"
        :y="bar.y"
        :width="bar.width"
        :height="bar.height"
        :fill="bar.color"
        class="line-chart__bar"
      />
    </svg>
    <div class="line-chart__labels">
      <span v-for="label in labels" :key="label">{{ label }}</span>
    </div>
    <div class="chart-legend">
      <span v-for="row in localizedSeries" :key="row.key">
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

.line-chart__legend {
  display: flex;
  flex-wrap: wrap;
  gap: 0.85rem;
}

.line-chart__legend-item {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.75rem;
  color: var(--text-muted);
}

.line-chart__legend-line {
  width: 1.05rem;
  height: 0.2rem;
  border-radius: 999px;
}

.line-chart__legend-label {
  font-weight: 600;
}

.line-chart__svg {
  width: 100%;
  height: 200px;
  background: linear-gradient(180deg, rgba(244, 246, 239, 0.5) 0%, transparent 100%);
  border-radius: var(--radius);
}

.line-chart__baseline {
  stroke: rgba(100, 116, 139, 0.45);
  stroke-width: 1;
}

.line-chart__bar {
  opacity: 0.9;
}

.line-chart__labels {
  display: flex;
  justify-content: space-between;
  gap: 0.25rem;
  padding: 0 2%;
  font-size: 0.6875rem;
  color: var(--text-light);
}

.line-chart__labels span {
  flex: 1;
  text-align: center;
}

.line-chart__labels span:first-child {
  text-align: left;
}

.line-chart__labels span:last-child {
  text-align: right;
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
