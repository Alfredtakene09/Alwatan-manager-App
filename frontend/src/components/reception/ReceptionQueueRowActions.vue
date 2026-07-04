<script setup lang="ts">
import type { Component } from 'vue'

export type QueueRowAction = {
  key: string
  label: string
  icon: Component
  variant?: 'default' | 'accent' | 'danger'
  disabled?: boolean
  disabledReason?: string
  showLabel?: boolean
}

withDefaults(
  defineProps<{
    actions: QueueRowAction[]
    ariaLabel?: string
  }>(),
  { ariaLabel: 'Actions sur la ligne' },
)

const emit = defineEmits<{
  action: [key: string]
}>()
</script>

<template>
  <div class="queue-row-actions" role="group" :aria-label="ariaLabel">
    <button
      v-for="item in actions"
      :key="item.key"
      type="button"
      class="queue-row-actions__btn"
      :class="{
        'queue-row-actions__btn--accent': item.variant === 'accent',
        'queue-row-actions__btn--danger': item.variant === 'danger',
        'queue-row-actions__btn--labeled': item.showLabel,
      }"
      :title="item.disabled && item.disabledReason ? item.disabledReason : item.label"
      :aria-label="item.label"
      :disabled="item.disabled"
      @click="emit('action', item.key)"
    >
      <component :is="item.icon" :size="16" class="queue-row-actions__icon" />
      <span v-if="item.showLabel" class="queue-row-actions__label">{{ item.label }}</span>
    </button>
  </div>
</template>

<style scoped>
.queue-row-actions {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.3rem;
  flex-wrap: nowrap;
}

.queue-row-actions__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  min-width: 2rem;
  height: 2rem;
  padding: 0;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: #fff;
  color: var(--text-muted);
  font-family: inherit;
  font-size: 0.75rem;
  font-weight: 600;
  line-height: 1;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    color 0.15s ease,
    background 0.15s ease,
    box-shadow 0.15s ease,
    transform 0.15s ease;
}

.queue-row-actions__btn--labeled {
  padding: 0 0.65rem;
}

.queue-row-actions__btn:hover:not(:disabled) {
  border-color: var(--primary-400);
  color: var(--accent-700);
  background: var(--accent-50);
  box-shadow: 0 2px 8px var(--shadow-action-md);
}

.queue-row-actions__btn:active:not(:disabled) {
  transform: translateY(1px);
}

.queue-row-actions__btn--accent {
  background: linear-gradient(135deg, var(--action), var(--action-hover));
  border-color: var(--action);
  color: #fff;
  box-shadow: 0 2px 10px var(--shadow-action-md);
}

.queue-row-actions__btn--accent:hover:not(:disabled) {
  background: linear-gradient(135deg, var(--action-light), var(--action-hover));
  border-color: var(--action-hover);
  color: #fff;
  box-shadow: 0 4px 14px var(--shadow-action);
}

.queue-row-actions__btn--danger:hover:not(:disabled) {
  border-color: #fca5a5;
  color: var(--danger);
  background: var(--danger-bg);
  box-shadow: 0 2px 8px rgba(220, 38, 38, 0.1);
}

.queue-row-actions__btn:disabled {
  opacity: 0.42;
  cursor: not-allowed;
  box-shadow: none;
  transform: none;
}

.queue-row-actions__icon {
  flex-shrink: 0;
}

.queue-row-actions__label {
  white-space: nowrap;
}

@media (max-width: 960px) {
  .queue-row-actions {
    gap: 0.25rem;
  }

  .queue-row-actions__btn--labeled {
    padding: 0 0.5rem;
  }

  .queue-row-actions__label {
    display: none;
  }
}
</style>
