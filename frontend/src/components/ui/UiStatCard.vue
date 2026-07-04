<script setup lang="ts">
import type { Component } from 'vue'

defineProps<{
  label: string
  value: number | string
  icon: Component
  trend?: string
  variant?: 'green' | 'teal' | 'blue' | 'amber' | 'rose' | 'violet' | 'cyan'
  compact?: boolean
  mini?: boolean
}>()
</script>

<template>
  <div
    class="stat-card card-accent"
    :class="[`card-accent--${variant ?? 'green'}`, {
      'stat-card--compact': compact && !mini,
      'stat-card--mini': mini,
    }]"
  >
    <div class="stat-card__top">
      <span class="stat-card__label">{{ label }}</span>
      <div class="stat-card__icon" :class="`stat-card__icon--${variant ?? 'green'}`">
        <component :is="icon" :size="mini || compact ? 14 : 20" />
      </div>
    </div>
    <strong class="stat-card__value">{{ value }}</strong>
    <span v-if="trend && !mini" class="stat-card__trend">{{ trend }}</span>
  </div>
</template>

<style scoped>
.stat-card {
  border-radius: var(--radius);
  padding: 1.25rem 1.35rem;
  overflow: hidden;
}

.stat-card__top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.75rem;
}

.stat-card__label {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-muted);
}

.stat-card__icon {
  width: 2.5rem;
  height: 2.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.65);
}

.stat-card__icon--green,
.stat-card__icon--teal { background: var(--accent-100); color: var(--accent-700); }
.stat-card__icon--blue { background: var(--medical-blue-light); color: var(--medical-blue); }
.stat-card__icon--amber { background: var(--warning-bg); color: var(--warning); }
.stat-card__icon--rose { background: #ffe4e6; color: #e11d48; }
.stat-card__icon--violet { background: #ede9fe; color: #7c3aed; }
.stat-card__icon--cyan { background: #cffafe; color: #0e7490; }

.stat-card__value {
  display: block;
  font-size: 2rem;
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 1;
}

.stat-card__trend {
  display: block;
  margin-top: 0.5rem;
  font-size: 0.75rem;
  color: var(--text-light);
}

.stat-card--compact,
.stat-card--mini {
  padding: 0.45rem 0.55rem;
}

.stat-card--compact .stat-card__top,
.stat-card--mini .stat-card__top {
  margin-bottom: 0.2rem;
}

.stat-card--compact .stat-card__label,
.stat-card--mini .stat-card__label {
  font-size: 0.625rem;
  line-height: 1.2;
  font-weight: 700;
}

.stat-card--compact .stat-card__icon,
.stat-card--mini .stat-card__icon {
  width: 1.5rem;
  height: 1.5rem;
  border-radius: 6px;
}

.stat-card--compact .stat-card__value,
.stat-card--mini .stat-card__value {
  font-size: 1.125rem;
}
</style>
