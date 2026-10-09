<script setup lang="ts">
import { computed } from 'vue'
import { useAppI18n } from '@/i18n/useAppI18n'

const props = defineProps<{
  label: string
  modelValue: string | number | boolean
  required?: boolean
  disabled?: boolean
}>()

defineEmits<{ 'update:modelValue': [value: string] }>()

const { uiText, localeCode } = useAppI18n()
const labelText = computed(() => {
  void localeCode.value
  return uiText(props.label)
})
</script>

<template>
  <label class="ui-field" :class="{ 'ui-field--disabled': disabled }">
    <span class="ui-field__label">
      {{ labelText }}<abbr v-if="required && labelText" class="ui-field__req" title="obligatoire">*</abbr>
    </span>
    <select
      class="ui-select"
      :value="modelValue"
      :required="required"
      :disabled="disabled"
      @change="$emit('update:modelValue', ($event.target as HTMLSelectElement).value)"
    >
      <slot />
    </select>
  </label>
</template>

<style scoped>
.ui-field {
  display: block;
  margin-bottom: var(--density-field-gap);
}

.ui-field--disabled {
  opacity: 0.75;
}

.ui-field__label {
  display: block;
  margin-bottom: 0.4rem;
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text);
}

.ui-field__req {
  margin-left: 0.2rem;
  color: #dc2626;
  font-weight: 700;
  text-decoration: none;
}

.ui-select {
  width: 100%;
  padding: var(--density-control-pad-y) var(--density-control-pad-x);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-family: inherit;
  /* Hérite / suit l’échelle globale des selects (--app-select-scale) */
  font-size: calc(0.875rem * var(--app-select-scale, 1.08) / var(--app-text-scale, 0.95));
  font-weight: 600;
  color: var(--text);
  background: #fff;
  min-height: var(--app-control-height);
}

.ui-select:disabled {
  background: var(--surface-muted, #f8fafc);
  cursor: not-allowed;
}

.ui-select:focus {
  outline: none;
  border-color: var(--primary);
  box-shadow: 0 0 0 2px rgba(15, 118, 110, 0.15);
}
</style>
