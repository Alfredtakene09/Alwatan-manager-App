<script setup lang="ts">
import { ref } from 'vue'
import type { Component } from 'vue'

const props = defineProps<{
  label: string
  modelValue: string | number
  type?: string
  placeholder?: string
  required?: boolean
  autofocus?: boolean
  disabled?: boolean
  readonly?: boolean
  icon?: Component
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

function onInput(event: Event) {
  if (props.disabled || props.readonly) return
  emit('update:modelValue', (event.target as HTMLInputElement).value)
}

const inputRef = ref<HTMLInputElement | null>(null)

defineExpose({
  focus() {
    inputRef.value?.focus()
  },
})
</script>

<template>
  <label class="ui-field">
    <span class="ui-field__label">{{ label }}</span>
    <div class="ui-field__wrap">
      <component :is="icon" v-if="icon" :size="18" class="ui-field__icon" />
      <input
        ref="inputRef"
        :type="type ?? 'text'"
        :value="modelValue"
        :placeholder="placeholder"
        :required="required"
        :autofocus="autofocus"
        :disabled="disabled"
        :readonly="readonly"
        class="ui-field__input"
        :class="{
          'ui-field__input--icon': !!icon,
          'ui-field__input--disabled': disabled || readonly,
        }"
        @input="onInput"
      />
    </div>
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

.ui-field__wrap {
  position: relative;
}

.ui-field__icon {
  position: absolute;
  left: 0.875rem;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-light);
  pointer-events: none;
}

.ui-field__input {
  width: 100%;
  padding: 0.65rem 0.9rem;
  border: 1.5px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--ui-input-bg);
  color: var(--text);
  transition: border-color 0.2s, box-shadow 0.2s;
}

.ui-field__input--icon {
  padding-left: 2.5rem;
}

.ui-field__input:focus {
  outline: none;
  border-color: var(--accent-500);
  box-shadow: 0 0 0 3px var(--focus-ring);
  background: #fff;
}

.ui-field__input--disabled,
.ui-field__input:disabled,
.ui-field__input:read-only {
  background: #f8fafc;
  color: var(--text-muted);
  cursor: default;
}

.ui-field__input--disabled:focus,
.ui-field__input:disabled:focus,
.ui-field__input:read-only:focus {
  border-color: var(--border);
  box-shadow: none;
  background: #f8fafc;
}
</style>
