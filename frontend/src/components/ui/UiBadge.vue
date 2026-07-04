<script setup lang="ts">
type Variant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'primary'

defineProps<{ variant?: Variant }>()
</script>

<template>
  <span class="ui-badge" :class="`ui-badge--${variant ?? 'default'}`">
    <slot />
  </span>
</template>

<style scoped>
.ui-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.2rem 0.65rem;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.01em;
}

.ui-badge--default { background: #f1f5f9; color: #475569; }
.ui-badge--primary { background: var(--primary-100); color: var(--primary-800); }
.ui-badge--success { background: var(--success-bg); color: var(--success); }
.ui-badge--warning { background: var(--warning-bg); color: var(--warning); }
.ui-badge--danger { background: var(--danger-bg); color: var(--danger); }
.ui-badge--info { background: var(--info-bg); color: var(--info); }
</style>
