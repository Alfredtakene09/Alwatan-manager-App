<script setup lang="ts">
import type { Component } from 'vue'

defineProps<{
  title: string
  description?: string
  icon?: Component
  iconVariant?: 'green' | 'teal' | 'blue' | 'amber' | 'rose' | 'violet' | 'cyan'
  padding?: boolean
}>()
</script>

<template>
  <div
    class="ui-card card-accent"
    :class="[
      `card-accent--${iconVariant ?? 'green'}`,
      { 'ui-card--flat': padding === false },
    ]"
  >
    <div v-if="title || description || icon" class="ui-card__header">
      <div v-if="icon" class="ui-card__icon" :class="`ui-card__icon--${iconVariant ?? 'green'}`">
        <component :is="icon" :size="20" />
      </div>
      <div class="ui-card__titles">
        <h3 v-if="title">{{ title }}</h3>
        <p v-if="description">{{ description }}</p>
      </div>
      <div v-if="$slots.actions" class="ui-card__actions">
        <slot name="actions" />
      </div>
    </div>
    <div class="ui-card__body">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.ui-card {
  border-radius: var(--radius);
  overflow: hidden;
}

.ui-card__header {
  display: flex;
  align-items: flex-start;
  gap: 0.875rem;
  padding: 1.25rem 1.5rem 0;
}

.ui-card__actions {
  margin-left: auto;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  flex-shrink: 0;
}

.ui-card__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2.75rem;
  height: 2.75rem;
  border-radius: 12px;
  flex-shrink: 0;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.65);
}

.ui-card__icon--green,
.ui-card__icon--teal { background: var(--accent-100); color: var(--accent-700); }
.ui-card__icon--blue { background: var(--medical-blue-light); color: var(--medical-blue); }
.ui-card__icon--amber { background: var(--warning-bg); color: var(--warning); }
.ui-card__icon--rose { background: #ffe4e6; color: #e11d48; }
.ui-card__icon--violet { background: #ede9fe; color: #7c3aed; }
.ui-card__icon--cyan { background: #cffafe; color: #0e7490; }

.ui-card__titles {
  flex: 1;
  min-width: 0;
}

.ui-card__titles h3 {
  margin: 0;
  font-size: 1.0625rem;
  font-weight: 700;
  color: var(--text);
}

.ui-card__titles p {
  margin: 0.25rem 0 0;
  font-size: 0.8125rem;
  color: var(--text-muted);
  line-height: 1.5;
}

.ui-card__body {
  padding: 1.25rem 1.5rem 1.5rem;
}

.ui-card--flat .ui-card__body {
  padding-top: 0;
}
</style>
