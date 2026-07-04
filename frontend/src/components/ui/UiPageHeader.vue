<script setup lang="ts">
import type { Component } from 'vue'

defineProps<{
  title: string
  subtitle?: string
  icon?: Component
}>()
</script>

<template>
  <header class="page-header">
    <div class="page-header__main">
      <div v-if="icon" class="page-header__icon">
        <component :is="icon" :size="18" />
      </div>
      <div>
        <h1>{{ title }}</h1>
        <p v-if="subtitle">{{ subtitle }}</p>
      </div>
    </div>
    <div v-if="$slots.actions" class="page-header__actions">
      <slot name="actions" />
    </div>
  </header>
</template>

<style scoped>
.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}

.page-header__main {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.page-header__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2.25rem;
  height: 2.25rem;
  border-radius: 10px;
  background: linear-gradient(135deg, var(--action), var(--action-hover));
  color: #fff;
  box-shadow: 0 4px 12px var(--shadow-action-md);
}

.page-header h1 {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.page-header p {
  margin: 0.1rem 0 0;
  color: var(--text-muted);
  font-size: 0.75rem;
  line-height: 1.3;
}

.page-header__actions {
  display: flex;
  gap: 0.5rem;
  flex-shrink: 0;
  flex-wrap: wrap;
}

@media (max-width: 639px) {
  .page-header {
    flex-direction: column;
    align-items: stretch;
    margin-bottom: 0.65rem;
  }

  .page-header__main {
    gap: 0.55rem;
  }

  .page-header__actions {
    width: 100%;
  }

  .page-header__actions :deep(.ui-button) {
    flex: 1;
    min-width: 0;
  }
}
</style>
