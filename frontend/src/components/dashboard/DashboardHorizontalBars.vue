<script setup lang="ts">
import { computed } from 'vue'

export type HorizontalBar = {
  key: string
  label: string
  amountFcfa: number
  color: string
}

const props = defineProps<{
  rows: HorizontalBar[]
  formatValue: (value: number) => string
  emptyLabel?: string
}>()

const max = computed(() => Math.max(1, ...props.rows.map((row) => row.amountFcfa)))
const total = computed(() => props.rows.reduce((sum, row) => sum + row.amountFcfa, 0))
</script>

<template>
  <div v-if="!total" class="chart-empty">{{ emptyLabel ?? 'Aucune dépense ce mois' }}</div>
  <div v-else class="h-bars">
    <div v-for="row in rows" :key="row.key" class="h-bars__row">
      <span class="h-bars__label">{{ row.label }}</span>
      <div class="h-bars__track">
        <div
          class="h-bars__fill"
          :style="{ width: `${(row.amountFcfa / max) * 100}%`, background: row.color }"
        />
      </div>
      <strong class="h-bars__value">{{ formatValue(row.amountFcfa) }}</strong>
    </div>
  </div>
</template>

<style scoped>
.h-bars {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.h-bars__row {
  display: grid;
  grid-template-columns: minmax(0, 7rem) 1fr auto;
  gap: 0.75rem;
  align-items: center;
}

.h-bars__label {
  font-size: 0.8125rem;
  color: var(--text-muted);
}

.h-bars__track {
  height: 0.7rem;
  border-radius: 999px;
  background: #f1f5f9;
  overflow: hidden;
}

.h-bars__fill {
  height: 100%;
  border-radius: 999px;
  min-width: 4px;
  transition: width 0.25s ease;
}

.h-bars__value {
  font-size: 0.8125rem;
  min-width: 6rem;
  text-align: right;
}

@media (max-width: 700px) {
  .h-bars__row {
    grid-template-columns: 1fr;
    gap: 0.35rem;
  }

  .h-bars__value {
    text-align: left;
  }
}
</style>
