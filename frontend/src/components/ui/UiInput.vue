<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Component } from 'vue'
import { Eye, EyeOff } from '@lucide/vue'
import { useAppI18n } from '@/i18n/useAppI18n'

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
  revealable?: boolean
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const { uiText, localeCode } = useAppI18n()
const labelText = computed(() => {
  void localeCode.value
  return uiText(props.label)
})
const placeholderText = computed(() => {
  void localeCode.value
  return props.placeholder ? uiText(props.placeholder) : undefined
})

function onInput(event: Event) {
  if (props.disabled || props.readonly) return
  emit('update:modelValue', (event.target as HTMLInputElement).value)
}

const inputRef = ref<HTMLInputElement | null>(null)
const passwordVisible = ref(false)

const isPasswordField = computed(() => (props.type ?? 'text') === 'password')
const inputType = computed(() => {
  if (isPasswordField.value && props.revealable && passwordVisible.value) return 'text'
  return props.type ?? 'text'
})

function togglePasswordVisibility() {
  passwordVisible.value = !passwordVisible.value
}

defineExpose({
  focus() {
    inputRef.value?.focus()
  },
})
</script>

<template>
  <label class="ui-field">
    <span class="ui-field__label">{{ labelText }}</span>
    <div class="ui-field__wrap" :class="{ 'ui-field__wrap--revealable': revealable && isPasswordField }">
      <component :is="icon" v-if="icon" :size="18" class="ui-field__icon" />
      <input
        ref="inputRef"
        :type="inputType"
        :value="modelValue"
        :placeholder="placeholderText"
        :required="required"
        :autofocus="autofocus"
        :disabled="disabled"
        :readonly="readonly"
        class="ui-field__input"
        :class="{
          'ui-field__input--icon': !!icon,
          'ui-field__input--revealable': revealable && isPasswordField,
          'ui-field__input--disabled': disabled || readonly,
        }"
        @input="onInput"
      />
      <button
        v-if="revealable && isPasswordField"
        type="button"
        class="ui-field__reveal"
        :aria-label="passwordVisible ? uiText('Masquer le mot de passe') : uiText('Afficher le mot de passe')"
        :title="passwordVisible ? 'Masquer' : 'Voir'"
        tabindex="-1"
        @click="togglePasswordVisibility"
      >
        <EyeOff v-if="passwordVisible" :size="18" />
        <Eye v-else :size="18" />
      </button>
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

.ui-field__wrap--revealable .ui-field__input--icon {
  padding-right: 2.75rem;
}

.ui-field__input--revealable {
  padding-right: 2.75rem;
}

.ui-field__reveal {
  position: absolute;
  right: 0.55rem;
  top: 50%;
  transform: translateY(-50%);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-light);
  cursor: pointer;
}

.ui-field__reveal:hover {
  color: var(--text-muted);
  background: rgba(15, 23, 42, 0.05);
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
