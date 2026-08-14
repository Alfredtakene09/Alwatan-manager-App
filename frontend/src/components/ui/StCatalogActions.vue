<script setup lang="ts">
import { computed } from 'vue'
import { Pencil, Ban, Check, Trash2, Eye } from '@lucide/vue'

const props = withDefaults(
  defineProps<{
    id: string
    toggleLabel?: string
    isActive?: boolean
    canDelete?: boolean
    showEdit?: boolean
    showView?: boolean
    showToggle?: boolean
  }>(),
  {
    isActive: true,
    canDelete: true,
    showEdit: true,
    showView: false,
    showToggle: true,
  },
)

const emit = defineEmits<{
  action: [payload: { action: string; id: string }]
}>()

const resolvedToggleLabel = computed(
  () => props.toggleLabel ?? (props.isActive ? 'Désactiver' : 'Activer'),
)
</script>

<template>
  <div class="st-actions">
    <button
      v-if="showView"
      type="button"
      class="st-btn st-btn--soft"
      title="Voir"
      aria-label="Voir"
      @click="emit('action', { action: 'view', id })"
    >
      <Eye :size="15" />
    </button>
    <button
      v-if="showEdit"
      type="button"
      class="st-btn st-btn--edit"
      title="Modifier"
      aria-label="Modifier"
      @click="emit('action', { action: 'edit', id })"
    >
      <Pencil :size="15" />
    </button>
    <button
      v-if="showToggle"
      type="button"
      class="st-btn"
      :class="isActive ? 'st-btn--catalog-off' : 'st-btn--catalog-on'"
      :title="resolvedToggleLabel"
      :aria-label="resolvedToggleLabel"
      @click="emit('action', { action: 'toggle', id })"
    >
      <Ban v-if="isActive" :size="15" />
      <Check v-else :size="15" />
    </button>
    <button
      v-if="canDelete"
      type="button"
      class="st-btn st-btn--delete"
      title="Supprimer"
      aria-label="Supprimer"
      @click="emit('action', { action: 'delete', id })"
    >
      <Trash2 :size="15" />
    </button>
  </div>
</template>
