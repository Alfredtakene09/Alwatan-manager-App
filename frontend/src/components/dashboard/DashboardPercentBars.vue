<script setup lang="ts">
import { computed } from 'vue'
import { useAppI18n } from '@/i18n/useAppI18n'
import { translateDashboardLabel } from '@/lib/dashboard-i18n'

export type PercentBar = {
  key: string
  label: string
  percent: number
  color: string
  amountFcfa?: number
}

const props = defineProps<{
  rows: PercentBar[]
  formatValue?: (value: number) => string
  emptyLabel?: string
}>()

const { localeCode } = useAppI18n()

const emptyText = computed(() => {
  void localeCode.value
  return props.emptyLabel
    ? translateDashboardLabel(props.emptyLabel)
    : translateDashboardLabel('Aucune donnée')
})

const localizedRows = computed(() => {
  void localeCode.value
  return props.rows.map((row) => ({
    ...row,
    label: translateDashboardLabel(row.label),
    signedLabel: formatSignedPercent(row.percent),
  }))
})

const maxAbs = computed(() => Math.max(1, ...props.rows.map((row) => Math.abs(row.percent))))

function formatSignedPercent(value: number) {
  const sign = value > 0 ? '+' : value < 0 ? '−' : ''
  return `${sign}${Math.abs(value)} %`
}
</script>

<template>
  <div v-if="!rows.length" class="chart-empty">{{ emptyText }}</div>
  <div v-else class="p-bars">
    <div v-for="row in localizedRows" :key="row.key" class="p-bars__row">
      <div class="p-bars__head">
        <span class="p-bars__label">{{ row.label }}</span>
        <strong
          class="p-bars__percent"
          :class="{
            'p-bars__percent--up': row.percent > 0,
            'p-bars__percent--down': row.percent < 0,
          }"
        >
          {{ row.signedLabel }}
        </strong>
      </div>
      <div class="p-bars__track">
        <div
          class="p-bars__fill"
          :style="{
            width: `${(Math.abs(row.percent) / maxAbs) * 100}%`,
            background: row.color,
          }"
        />
      </div>
      <span v-if="formatValue && row.amountFcfa != null" class="p-bars__amount">
        {{ formatValue(row.amountFcfa) }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.p-bars {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.p-bars__row {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.p-bars__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.75rem;
}

.p-bars__label {
  font-size: 0.8125rem;
  color: var(--text-muted);
}

.p-bars__percent {
  font-size: 0.8125rem;
  color: var(--text);
}

.p-bars__percent--up {
  color: #15803d;
}

.p-bars__percent--down {
  color: #be123c;
}

.p-bars__track {
  height: 0.7rem;
  border-radius: 999px;
  background: #f1f5f9;
  overflow: hidden;
}

.p-bars__fill {
  height: 100%;
  border-radius: 999px;
  min-width: 4px;
  transition: width 0.25s ease;
}

.p-bars__amount {
  font-size: 0.75rem;
  color: var(--text-muted);
}
</style>
