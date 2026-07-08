<script setup lang="ts">
import { computed } from 'vue'
import { CheckCircle2, AlertCircle, Info, AlertTriangle } from '@lucide/vue'
import { useAppI18n } from '@/i18n/useAppI18n'

const props = defineProps<{
  type?: 'success' | 'error' | 'info' | 'warning'
  message: string
}>()

const { uiText, localeCode } = useAppI18n()

const displayMessage = computed(() => {
  void localeCode.value
  return uiText(props.message)
})

const icons = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
  warning: AlertTriangle,
}
</script>

<template>
  <div class="ui-alert" :class="`ui-alert--${type ?? 'info'}`">
    <component :is="icons[type ?? 'info']" :size="18" />
    <span>{{ displayMessage }}</span>
  </div>
</template>

<style scoped>
.ui-alert {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  padding: 0.75rem 1rem;
  border-radius: var(--radius-sm);
  font-size: 0.875rem;
  font-weight: 500;
  margin-top: 1rem;
}

.ui-alert--success { background: var(--success-bg); color: var(--success); }
.ui-alert--error { background: var(--danger-bg); color: var(--danger); }
.ui-alert--info { background: var(--info-bg); color: var(--info); }
.ui-alert--warning { background: var(--warning-bg); color: var(--warning); }
</style>
