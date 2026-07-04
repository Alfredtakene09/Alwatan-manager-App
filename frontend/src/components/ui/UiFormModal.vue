<script setup lang="ts">
import { computed, useId } from 'vue'
import type { Component } from 'vue'
import { X } from '@lucide/vue'

const props = withDefaults(
  defineProps<{
    title: string
    subtitle?: string
    icon?: Component
    size?: 'default' | 'wide' | 'large'
    titleId?: string
    /** Si false, le modal n'est pas affiché. Défaut true (compatible avec v-if sur le composant). */
    open?: boolean
  }>(),
  {
    size: 'default',
    open: true,
  },
)

const emit = defineEmits<{ close: [] }>()

const fallbackTitleId = useId()
const ariaTitleId = computed(() => props.titleId ?? fallbackTitleId)
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="ui-form-modal-overlay" @click.self="emit('close')">
      <div
        class="ui-form-modal"
        :class="{
          'ui-form-modal--wide': size === 'wide',
          'ui-form-modal--large': size === 'large',
        }"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="ariaTitleId"
      >
        <header class="ui-form-modal__header">
          <div class="ui-form-modal__header-main">
            <div v-if="icon" class="ui-form-modal__icon">
              <component :is="icon" :size="22" />
            </div>
            <div>
              <h2 :id="ariaTitleId">{{ title }}</h2>
              <p v-if="subtitle" class="ui-form-modal__subtitle">{{ subtitle }}</p>
            </div>
          </div>
          <button type="button" class="ui-form-modal__close" aria-label="Fermer" @click="emit('close')">
            <X :size="18" />
          </button>
        </header>

        <div class="ui-form-modal__body">
          <slot />
        </div>

        <footer v-if="$slots.footer" class="ui-form-modal__footer">
          <slot name="footer" />
        </footer>
      </div>
    </div>
  </Teleport>
</template>
