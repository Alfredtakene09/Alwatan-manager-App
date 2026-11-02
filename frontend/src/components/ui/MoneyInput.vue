<script setup lang="ts">
import { useMoneyField } from '@/composables/useMoneyField'

/** Champ de montant nu (sans libellé) : FCFA dans le formulaire, rial à l'écran en arabe. */
const props = defineProps<{ modelValue: string | number | null | undefined }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const { shownValue, onMoneyInput, onMoneyBlur } = useMoneyField(
  () => true,
  () => props.modelValue,
  (value) => emit('update:modelValue', value),
)
</script>

<template>
  <input
    type="number"
    :value="shownValue"
    @input="onMoneyInput(($event.target as HTMLInputElement).value)"
    @blur="onMoneyBlur"
  />
</template>
