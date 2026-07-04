<script setup lang="ts">
import { computed, useAttrs } from 'vue'

defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    /** Dans un onglet ou panneau déjà entouré par page-with-table__body */
    embedded?: boolean
    /** Empile plusieurs tableaux (ex. dashboard encaissements) */
    stack?: boolean
  }>(),
  {
    embedded: false,
    stack: false,
  },
)

const attrs = useAttrs()

const rootTag = computed(() => (props.embedded || props.stack ? 'div' : 'section'))

const rootClass = computed(() => {
  const base = props.embedded
    ? 'page-table-section page-table-section--embedded'
    : props.stack
      ? 'page-table-section-stack'
      : 'page-with-table__body page-table-section'
  const extra = attrs.class
  return extra ? [base, extra] : base
})
</script>

<template>
  <component :is="rootTag" :class="rootClass">
    <div v-if="$slots.toolbar" class="page-table-toolbar">
      <slot name="toolbar" />
    </div>
    <slot />
  </component>
</template>
