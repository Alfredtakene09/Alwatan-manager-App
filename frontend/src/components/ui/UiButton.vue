<script setup lang="ts">
import type { Component } from 'vue'

type Variant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'success' | 'dark'
type Size = 'sm' | 'md' | 'lg'

withDefaults(
  defineProps<{
    variant?: Variant
    size?: Size
    icon?: Component
    loading?: boolean
    block?: boolean
    type?: 'button' | 'submit' | 'reset'
    disabled?: boolean
  }>(),
  { variant: 'primary', size: 'md', type: 'button' },
)
</script>

<template>
  <button
    :type="type"
    class="ui-btn"
    :class="[`ui-btn--${variant}`, `ui-btn--${size}`, { 'ui-btn--block': block }]"
    :disabled="disabled || loading"
  >
    <component :is="icon" v-if="icon" :size="size === 'sm' ? 16 : 18" class="ui-btn__icon" />
    <span v-if="loading" class="ui-btn__spinner" />
    <slot />
  </button>
</template>

<style scoped>
.ui-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;
}

.ui-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.ui-btn--sm {
  padding: 0.4rem 0.85rem;
  font-size: 0.8125rem;
}

.ui-btn--md {
  padding: 0.625rem 1.15rem;
  font-size: 0.875rem;
}

.ui-btn--lg {
  padding: 0.8rem 1.5rem;
  font-size: 0.9375rem;
}

.ui-btn--block {
  width: 100%;
}

.ui-btn--primary {
  background: linear-gradient(135deg, var(--action), var(--action-hover));
  color: #fff;
  box-shadow: 0 4px 14px var(--shadow-action);
}

.ui-btn--primary:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 6px 20px var(--shadow-action-hover);
}

.ui-btn--secondary {
  background: var(--menu-btn-bg);
  color: var(--menu-btn-text);
  border: 2px solid var(--menu-btn-border);
}

.ui-btn--secondary:hover:not(:disabled) {
  background: var(--menu-btn-bg-hover);
  border-color: var(--menu-btn-border-hover);
  color: var(--menu-btn-text-hover);
}

.ui-btn--outline {
  background: transparent;
  color: var(--action);
  border-color: var(--accent-500);
}

.ui-btn--outline:hover:not(:disabled) {
  background: var(--accent-50);
  color: var(--action-hover);
}

.ui-btn--ghost {
  background: transparent;
  color: var(--text-muted);
}

.ui-btn--ghost:hover:not(:disabled) {
  background: var(--accent-50);
  color: var(--text);
}

.ui-btn--danger {
  background: linear-gradient(135deg, #ef4444, #dc2626);
  color: #fff;
}

.ui-btn--success {
  background: linear-gradient(135deg, var(--accent-500), var(--accent-600));
  color: #fff;
}

.ui-btn--dark {
  background: rgba(255, 255, 255, 0.06);
  color: #cbd5e1;
  border-color: rgba(255, 255, 255, 0.1);
}

.ui-btn--dark:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
}

.ui-btn__spinner {
  width: 1rem;
  height: 1rem;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
