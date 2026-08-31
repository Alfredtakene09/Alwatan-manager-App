<script setup lang="ts">
import { computed } from 'vue'

export type MetricBar = {
  key: string
  label: string
  value: number
  color: string
  hint?: string
}

const props = defineProps<{
  items: MetricBar[]
  loading?: boolean
  emptyLabel?: string
}>()

const maxValue = computed(() => Math.max(...props.items.map((item) => item.value), 1))
</script>

<template>
  <div v-if="loading && !items.length" class="chart-empty">Chargement…</div>
  <div v-else-if="!items.length" class="chart-empty">{{ emptyLabel ?? 'Aucune donnée' }}</div>
  <div v-else class="metric-bars">
    <div v-for="item in items" :key="item.key" class="metric-bars__row">
      <div class="metric-bars__head">
        <span class="metric-bars__label">{{ item.label }}</span>
        <strong class="metric-bars__value">{{ item.value }}</strong>
      </div>
      <div class="metric-bars__track">
        <div
          class="metric-bars__fill"
          :style="{
            width: `${Math.max((item.value / maxValue) * 100, item.value > 0 ? 6 : 0)}%`,
            backgroundColor: item.color,
          }"
        />
      </div>
      <p v-if="item.hint" class="metric-bars__hint">{{ item.hint }}</p>
    </div>
  </div>
</template>

<style scoped>
.metric-bars {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding-top: 0.25rem;
}

.metric-bars__row {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.metric-bars__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.75rem;
}

.metric-bars__label {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-muted);
}

.metric-bars__value {
  font-size: 1.125rem;
  font-weight: 700;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}

.metric-bars__track {
  height: 0.55rem;
  border-radius: 999px;
  background: #f1f5f9;
  overflow: hidden;
}

.metric-bars__fill {
  height: 100%;
  border-radius: 999px;
  min-width: 0;
  transition: width 0.3s ease;
}

.metric-bars__hint {
  margin: 0;
  font-size: 0.75rem;
  color: var(--text-light);
}
</style>
