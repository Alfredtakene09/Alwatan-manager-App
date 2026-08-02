<script setup lang="ts">
import type { Component } from 'vue'
import { computed } from 'vue'
import { useAppI18n } from '@/i18n/useAppI18n'

const props = withDefaults(
  defineProps<{
    icon: Component
    label: string
    variant?: 'edit' | 'success' | 'danger' | 'neutral' | 'pdf'
    href?: string
    disabled?: boolean
    showLabel?: boolean
  }>(),
  { variant: 'neutral', showLabel: false },
)

const emit = defineEmits<{ click: [] }>()
const { uiText } = useAppI18n()
const labelText = computed(() => uiText(props.label))
</script>

<template>
  <a
    v-if="href"
    :href="href"
    target="_blank"
    rel="noopener"
    class="gestionnaire-row-action"
    :class="[
      `gestionnaire-row-action--${variant}`,
      { 'gestionnaire-row-action--labeled': showLabel },
    ]"
    :aria-label="labelText"
    :title="labelText"
  >
    <component :is="icon" :size="15" stroke-width="2.25" />
    <span v-if="showLabel" class="gestionnaire-row-action__text">{{ labelText }}</span>
  </a>
  <button
    v-else
    type="button"
    class="gestionnaire-row-action"
    :class="[
      `gestionnaire-row-action--${variant}`,
      { 'gestionnaire-row-action--labeled': showLabel },
    ]"
    :aria-label="labelText"
    :title="showLabel ? undefined : labelText"
    :disabled="disabled"
    @click="emit('click')"
  >
    <component :is="icon" :size="15" stroke-width="2.25" />
    <span v-if="showLabel" class="gestionnaire-row-action__text">{{ labelText }}</span>
  </button>
</template>
