<script setup lang="ts">
import { computed } from 'vue'

export type SplitRow = {
  label: string
  value: number
  colorClass: string
}

const props = defineProps<{
  rows: SplitRow[]
  formatValue: (value: number) => string
  emptyLabel?: string
}>()

const total = computed(() => props.rows.reduce((sum, row) => sum + row.value, 0))
</script>

<template>
  <div v-if="!total" class="chart-empty">{{ emptyLabel ?? 'Aucune donnée' }}</div>
  <div v-else class="split-chart">
    <div class="split-chart__track">
      <div
        v-for="row in rows"
        :key="row.label"
        class="split-chart__segment"
        :class="row.colorClass"
        :style="{ width: `${(row.value / total) * 100}%` }"
      />
    </div>
    <div class="split-chart__rows">
      <div v-for="row in rows" :key="row.label" class="split-chart__row">
        <span>{{ row.label }}</span>
        <strong>{{ formatValue(row.value) }}</strong>
      </div>
      <div class="split-chart__row split-chart__row--total">
        <span>Total</span>
        <strong>{{ formatValue(total) }}</strong>
      </div>
    </div>
  </div>
</template>

<style scoped>
.split-chart__segment--a { background: linear-gradient(90deg, #3b82f6, #2563eb); }
.split-chart__segment--b { background: linear-gradient(90deg, #2dd4bf, #0d9488); }
.split-chart__segment--c { background: linear-gradient(90deg, #fcd34d, #d97706); }
.split-chart__segment--d { background: linear-gradient(90deg, #c4b5fd, #7c3aed); }
</style>
