<script setup lang="ts">
import { computed } from 'vue'
// Styles du graphique chargés ici : un @import dans le style scoped du parent ne s'applique pas à l'intérieur du graphique.
import '@/styles/dashboard-charts.css'
import { formatFcfa } from '@/lib/roles'

export type PendingBar = {
  label: string
  count: number
  amount?: number | null
  color: string
  /** Texte affiché à la place du nombre (ex. « × 12 ») ; chaîne vide = rien. */
  valueLabel?: string
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
      <strong v-if="item.valueLabel !== ''" class="pending-chart__value">{{ item.valueLabel ?? item.count }}</strong>
      <span v-if="item.amount != null" class="pending-chart__amount">{{ formatFcfa(item.amount) }}</span>
    </div>
  </div>
</template>
