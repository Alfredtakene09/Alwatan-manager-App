<script setup lang="ts">
defineProps<{
  label: string
  modelValue: string
  rows?: number
  placeholder?: string
}>()

defineEmits<{ 'update:modelValue': [value: string] }>()
</script>

<template>
  <label class="ui-field">
    <span class="ui-field__label">{{ label }}</span>
    <textarea
      class="ui-textarea"
      :rows="rows ?? 3"
      :value="modelValue"
      :placeholder="placeholder"
      @input="$emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
    />
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
}

.ui-textarea {
  width: 100%;
  padding: 0.65rem 0.9rem;
  border: 1.5px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--ui-input-bg);
  resize: vertical;
}

.ui-textarea:focus {
  outline: none;
  border-color: var(--accent-500);
  box-shadow: 0 0 0 3px var(--focus-ring);
  background: #fff;
}
</style>
