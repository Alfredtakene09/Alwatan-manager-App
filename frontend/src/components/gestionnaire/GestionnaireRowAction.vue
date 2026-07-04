<script setup lang="ts">
import type { Component } from 'vue'

withDefaults(
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
    :aria-label="label"
    :title="label"
  >
    <component :is="icon" :size="15" stroke-width="2.25" />
    <span v-if="showLabel" class="gestionnaire-row-action__text">{{ label }}</span>
  </a>
  <button
    v-else
    type="button"
    class="gestionnaire-row-action"
    :class="[
      `gestionnaire-row-action--${variant}`,
      { 'gestionnaire-row-action--labeled': showLabel },
    ]"
    :aria-label="label"
    :title="showLabel ? undefined : label"
    :disabled="disabled"
    @click="emit('click')"
  >
    <component :is="icon" :size="15" stroke-width="2.25" />
    <span v-if="showLabel" class="gestionnaire-row-action__text">{{ label }}</span>
  </button>
</template>
