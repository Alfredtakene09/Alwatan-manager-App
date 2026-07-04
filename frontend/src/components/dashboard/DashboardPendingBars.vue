<script setup lang="ts">
import { computed } from 'vue'
import { formatFcfa } from '@/lib/roles'

export type PendingBar = {
  label: string
  count: number
  amount?: number | null
  color: string
}

const props = defineProps<{
  items: PendingBar[]
}>()

const maxCount = computed(() => Math.max(...props.items.map((item) => item.count), 1))
</script>

<template>
  <div class="pending-chart">
    <div v-for="item in items" :key="item.label" class="pending-chart__row">
      <span class="pending-chart__label">{{ item.label }}</span>
      <div class="pending-chart__track">
        <div
          class="pending-chart__fill"
          :style="{
            width: `${(item.count / maxCount) * 100}%`,
            backgroundColor: item.color,
          }"
        />
      </div>
      <strong class="pending-chart__value">{{ item.count }}</strong>
      <span v-if="item.amount != null" class="pending-chart__amount">{{ formatFcfa(item.amount) }}</span>
    </div>
  </div>
</template>
