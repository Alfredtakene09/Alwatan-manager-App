<script setup lang="ts">
defineProps<{
  label: string
  modelValue: string | number
  required?: boolean
}>()

defineEmits<{ 'update:modelValue': [value: string] }>()
</script>

<template>
  <label class="ui-field">
    <span class="ui-field__label">{{ label }}</span>
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
  padding: 0.65rem 0.9rem;
  border: 1.5px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--ui-input-bg);
  color: var(--text);
  cursor: pointer;
}

.ui-select:focus {
  outline: none;
  border-color: var(--accent-500);
  box-shadow: 0 0 0 3px var(--focus-ring);
  background: #fff;
}
</style>
