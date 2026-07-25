<script setup lang="ts">
import { FileDown, FileSpreadsheet } from '@lucide/vue'
import UiButton from '@/components/ui/UiButton.vue'

withDefaults(
  defineProps<{
    disabled?: boolean
    size?: 'sm' | 'md' | 'lg'
    showPdf?: boolean
    showExcel?: boolean
  }>(),
  {
    disabled: false,
    size: 'sm',
    showPdf: true,
    showExcel: true,
  },
)

defineEmits<{
  pdf: []
  excel: []
}>()
</script>

<template>
  <div class="export-buttons">
    <UiButton
      v-if="showPdf"
      variant="secondary"
      :size="size"
      :icon="FileDown"
      :disabled="disabled"
      @click="$emit('pdf')"
    >
      Exporter PDF
    </UiButton>
    <UiButton
      v-if="showExcel"
      variant="outline"
      :size="size"
      :icon="FileSpreadsheet"
      :disabled="disabled"
      @click="$emit('excel')"
    >
      Exporter Excel
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
