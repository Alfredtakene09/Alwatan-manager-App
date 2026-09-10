<script setup lang="ts">
import { watch } from 'vue'
import { Percent } from '@lucide/vue'
import UiInput from '@/components/ui/UiInput.vue'
import { useAppI18n } from '@/i18n/useAppI18n'
import {
  RECEPTION_PATIENT_REDUCTION_PERCENTS,
  matchReceptionReductionPercent,
  reductionFcfaFromPercent,
} from '@/lib/reception-reduction'

const reductionFcfa = defineModel<string>('reductionFcfa', { required: true })
const reductionPercent = defineModel<string>('reductionPercent', { default: '' })

const props = defineProps<{
  amountFcfa: number
}>()

const { uiText } = useAppI18n()

function selectPercent(pct: string) {
  if (!pct || pct === reductionPercent.value) {
    reductionPercent.value = ''
    reductionFcfa.value = '0'
    return
  }
  reductionPercent.value = pct
  reductionFcfa.value = String(reductionFcfaFromPercent(props.amountFcfa, Number(pct)))
}

function onFcfaInput(value: string) {
  reductionFcfa.value = value
  const amount = Number.parseInt(String(value).replace(/\s/g, ''), 10)
  const match = matchReceptionReductionPercent(
    props.amountFcfa,
    Number.isFinite(amount) ? amount : 0,
  )
  reductionPercent.value = match != null ? String(match) : ''
}

watch(
  () => props.amountFcfa,
  (amount) => {
    if (!reductionPercent.value) return
    reductionFcfa.value = String(reductionFcfaFromPercent(amount, Number(reductionPercent.value)))
  },
)
</script>

<template>
  <div class="reception-reduction">
    <div class="reception-reduction__chips" role="group" :aria-label="uiText('Réduction (%)')">
      <button
        type="button"
        class="reception-reduction__chip"
        :class="{ 'reception-reduction__chip--active': !reductionPercent }"
        @click="selectPercent('')"
      >
        {{ uiText('Aucune') }}
      </button>
      <button
        v-for="pct in RECEPTION_PATIENT_REDUCTION_PERCENTS"
        :key="pct"
        type="button"
        class="reception-reduction__chip"
        :class="{ 'reception-reduction__chip--active': reductionPercent === String(pct) }"
        @click="selectPercent(String(pct))"
      >
        {{ pct }} %
      </button>
    </div>
    <div class="form-grid-2">
      <UiInput
        :model-value="reductionFcfa"
        :label="uiText('Réduction (FCFA)')"
        type="number"
        min="0"
        placeholder="0"
        :icon="Percent"
        @update:model-value="onFcfaInput"
      />
      <slot />
    </div>
  </div>
</template>

<style scoped>
.reception-reduction {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.reception-reduction__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.reception-reduction__chip {
  border: 1px solid var(--border);
  background: #fff;
  color: var(--text);
  border-radius: 999px;
  padding: 0.32rem 0.75rem;
  font: inherit;
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;
}

.reception-reduction__chip--active {
  background: color-mix(in srgb, var(--primary, #2563eb) 14%, #fff);
  border-color: color-mix(in srgb, var(--primary, #2563eb) 45%, var(--border));
  color: var(--primary, #2563eb);
}

.form-grid-2 {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
}

@media (max-width: 640px) {
  .form-grid-2 {
    grid-template-columns: 1fr;
  }
}
</style>
