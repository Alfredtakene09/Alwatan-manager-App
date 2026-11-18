<script setup lang="ts">
import { Wallet } from '@lucide/vue'
import { formatFcfa } from '@/lib/roles'
import { useAppI18n } from '@/i18n/useAppI18n'
import UiStatCard from '@/components/ui/UiStatCard.vue'

defineProps<{ amount: number | null }>()
const { uiText } = useAppI18n()
</script>

<template>
  <div class="payroll-mass-card" :title="uiText('Salaires fixes actuels des employés actifs, hors comptes désactivés')">
    <UiStatCard
      :label="uiText('Masse salariale actuelle (salaires fixes)')"
      :value="amount === null ? '—' : formatFcfa(amount)"
      :icon="Wallet"
      variant="blue"
      compact
    />
  </div>
</template>

<style scoped>
.payroll-mass-card {
  width: min(100%, 14rem);
}
</style>
