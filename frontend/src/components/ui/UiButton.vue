<script setup lang="ts">
import { Comment, Fragment, Text, computed, useSlots, type Component, type VNode } from 'vue'
import { useAppI18n } from '@/i18n/useAppI18n'

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

const slots = useSlots()
const { uiText, localeCode, isArabic } = useAppI18n()

function extractPlainText(nodes: VNode[] | undefined): string | null {
  if (!nodes?.length) return null
  let text = ''
  for (const node of nodes) {
    if (node.type === Comment) continue
    if (node.type === Text) {
      text += String(node.children ?? '')
      continue
    }
    if (node.type === Fragment) {
      const inner = extractPlainText(node.children as VNode[])
      if (inner === null) return null
      text += inner
      continue
    }
    return null
  }
  const trimmed = text.replace(/\s+/g, ' ').trim()
  return trimmed || null
}

/** Texte simple du slot, traduit si présent dans le dictionnaire UI. */
const plainLabel = computed(() => {
  void localeCode.value
  const text = extractPlainText(slots.default?.())
  return text === null ? null : uiText(text)
})
</script>

<template>
  <button
    :type="type"
    class="ui-btn"
    :class="[`ui-btn--${variant}`, `ui-btn--${size}`, { 'ui-btn--block': block, 'lang-ar': isArabic && plainLabel !== null }]"
    :lang="isArabic && plainLabel !== null ? 'ar' : undefined"
    :disabled="disabled || loading"
  >
    <component :is="icon" v-if="icon" :size="size === 'sm' ? 16 : 18" class="ui-btn__icon" />
    <span v-if="loading" class="ui-btn__spinner" />
    <template v-if="plainLabel !== null">{{ plainLabel }}</template>
    <slot v-else />
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

.ui-btn--primary:active:not(:disabled) {
  transform: translateY(0);
}

.ui-btn--secondary {
  background: var(--bg-card);
  color: var(--text);
  border-color: var(--border);
}

.ui-btn--secondary:hover:not(:disabled) {
  border-color: var(--primary-400);
  color: var(--primary-700);
}

.ui-btn--outline {
  background: transparent;
  color: var(--primary-700);
  border-color: var(--primary-300);
}

.ui-btn--outline:hover:not(:disabled) {
  background: var(--primary-50);
}

.ui-btn--ghost {
  background: transparent;
  color: var(--text-muted);
}

.ui-btn--ghost:hover:not(:disabled) {
  background: var(--primary-50);
  color: var(--primary-800);
}

.ui-btn--danger {
  background: var(--danger);
  color: #fff;
}

.ui-btn--danger:hover:not(:disabled) {
  filter: brightness(0.95);
}

.ui-btn--success {
  background: var(--success);
  color: #fff;
}

.ui-btn--dark {
  background: var(--medical-navy);
  color: #fff;
}

.ui-btn__icon {
  flex-shrink: 0;
}

.ui-btn__spinner {
  width: 1rem;
  height: 1rem;
  border: 2px solid rgba(255, 255, 255, 0.35);
  border-top-color: #fff;
  border-radius: 50%;
  animation: ui-btn-spin 0.6s linear infinite;
}

@keyframes ui-btn-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
