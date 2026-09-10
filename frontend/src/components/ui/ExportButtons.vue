<script setup lang="ts">
import { FileDown, FileSpreadsheet, FileText } from '@lucide/vue'
import UiButton from '@/components/ui/UiButton.vue'
import { useUiActionVisibility } from '@/composables/useUiActionVisibility'

const { canSeeUiAction } = useUiActionVisibility()

withDefaults(
  defineProps<{
    disabled?: boolean
    size?: 'sm' | 'md' | 'lg'
    showPdf?: boolean
    showExcel?: boolean
    showWord?: boolean
  }>(),
  {
    disabled: false,
    size: 'sm',
    showPdf: true,
    showExcel: true,
    showWord: true,
  },
)

defineEmits<{
  pdf: []
  excel: []
  word: []
}>()
</script>

<template>
  <div class="export-buttons">
    <UiButton
      v-if="showPdf && canSeeUiAction('export.pdf')"
      variant="secondary"
      :size="size"
      :icon="FileDown"
      :disabled="disabled"
      @click="$emit('pdf')"
    >
      Exporter PDF
    </UiButton>
    <UiButton
      v-if="showExcel && canSeeUiAction('export.excel')"
      variant="outline"
      :size="size"
      :icon="FileSpreadsheet"
      :disabled="disabled"
      @click="$emit('excel')"
    >
      Exporter Excel
    </UiButton>
    <UiButton
      v-if="showWord && canSeeUiAction('export.word')"
      variant="outline"
      :size="size"
      :icon="FileText"
      :disabled="disabled"
      @click="$emit('word')"
    >
      Exporter Word
    </UiButton>
  </div>
</template>

<style scoped>
.export-buttons {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  align-items: center;
}
</style>
