<script setup lang="ts">
import { computed } from 'vue'
import { useAppI18n } from '@/i18n/useAppI18n'

const props = defineProps<{
  label: string
  modelValue: string | number | boolean
  required?: boolean
}>()

defineEmits<{ 'update:modelValue': [value: string] }>()

const { uiText, localeCode } = useAppI18n()
const labelText = computed(() => {
  void localeCode.value
  return uiText(props.label)
})
</script>

<template>
  <label class="ui-field">
    <span class="ui-field__label">{{ labelText }}</span>
    <select
      class="ui-select"
      :value="modelValue"
      :required="required"
      @change="$emit('update:modelValue', ($event.target as HTMLSelectElement).value)"
    >
      <slot />
    </select>
  </label>
</template>

<style scoped>
.ui-field {
  display: block;
  margin-bottom: 1rem;
}

.ui-field__label {
  display: block;
  margin-bottom: 0.4rem;
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text);
}

.ui-select {
  width: 100%;
  padding: 0.55rem 0.75rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-family: inherit;
  font-size: 0.875rem;
  color: var(--text);
  background: #fff;
}

.ui-select:focus {
  outline: none;
  border-color: var(--primary);
  box-shadow: 0 0 0 2px rgba(15, 118, 110, 0.15);
}
</style>
