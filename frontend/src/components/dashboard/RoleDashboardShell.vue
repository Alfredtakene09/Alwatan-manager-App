<script setup lang="ts">
import type { Component } from 'vue'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiStatCard from '@/components/ui/UiStatCard.vue'
import type { SummaryStat } from '@/lib/dashboard-summary'

defineProps<{
  title?: string
  subtitle: string
  icon: Component
  stats: SummaryStat[]
  loading?: boolean
  loadError?: string
}>()

const emit = defineEmits<{ refresh: [] }>()
</script>

<template>
  <div class="role-dashboard">
    <UiPageHeader
      :title="title ?? 'Tableau de bord'"
      :subtitle="subtitle"
      :icon="icon"
    >
      <template #actions>
        <slot name="actions">
          <UiButton variant="ghost" size="sm" :disabled="loading" @click="emit('refresh')">
            Actualiser
          </UiButton>
        </slot>
      </template>
    </UiPageHeader>

    <p v-if="loadError" class="dashboard-error">{{ loadError }}</p>

    <div v-if="loading && !stats.length" class="dashboard-cards-skeleton">
      <div v-for="n in 4" :key="n" class="dashboard-cards-skeleton__cell" />
    </div>

    <div v-else class="dashboard-cards" :class="{ 'dashboard-cards--loading': loading }">
      <UiStatCard
        v-for="card in stats"
        :key="card.id"
        :label="card.label"
        :value="card.value"
        :icon="card.icon"
        :variant="card.variant"
        :trend="card.trend"
        compact
      />
    </div>

    <slot />
  </div>
</template>

<style scoped>
@import '@/styles/dashboard-page.css';

.role-dashboard {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}
</style>
