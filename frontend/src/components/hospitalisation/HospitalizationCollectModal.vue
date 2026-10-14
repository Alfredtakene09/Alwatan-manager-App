<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Banknote } from '@lucide/vue'
import UiFormModal from '@/components/ui/UiFormModal.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiButton from '@/components/ui/UiButton.vue'
import { formatFcfa, fullName } from '@/lib/roles'
import { useAppI18n } from '@/i18n/useAppI18n'
import { translateTemplate } from '@/lib/dashboard-i18n'

const props = defineProps<{
  hosp: {
    visit: { patient: { firstName: string; lastName: string; code: string } }
  } | null
  remainingFcfa: number
  paidFcfa: number
  totalDueFcfa: number
  submitting?: boolean
}>()

const emit = defineEmits<{
  close: []
  confirm: [amountFcfa: number]
}>()

const { uiText } = useAppI18n()
const amount = ref('')

watch(
  () => [props.hosp, props.remainingFcfa] as const,
  () => {
    amount.value = props.remainingFcfa > 0 ? String(props.remainingFcfa) : ''
  },
  { immediate: true },
)

const parsedAmount = computed(() => {
  const value = Math.round(Number(String(amount.value).replace(/\s/g, '').replace(',', '.')))
  return Number.isFinite(value) ? value : 0
})

const amountError = computed(() => {
  if (parsedAmount.value <= 0) return uiText('Saisissez un montant supérieur à 0.')
  if (parsedAmount.value > props.remainingFcfa) {
    return translateTemplate('Le montant ne peut pas dépasser le reste ({amount}).', {
      amount: formatFcfa(props.remainingFcfa),
    })
  }
  return ''
})

const remainingAfter = computed(() => Math.max(0, props.remainingFcfa - parsedAmount.value))

const patientLabel = computed(() =>
  props.hosp
    ? `${fullName(props.hosp.visit.patient.firstName, props.hosp.visit.patient.lastName)} — ${props.hosp.visit.patient.code}`
    : '',
)

function onSubmit() {
  if (!props.hosp || amountError.value || props.submitting) return
  emit('confirm', parsedAmount.value)
}
</script>

<template>
  <UiFormModal
    v-if="hosp"
    :title="uiText('Encaisser')"
    :subtitle="patientLabel"
    :icon="Banknote"
    :body-scroll="false"
    @close="emit('close')"
  >
    <p class="hosp-collect__meta">
      {{ uiText('Total dû') }} : <strong>{{ formatFcfa(totalDueFcfa) }}</strong>
      · {{ uiText('Encaissé') }} : <strong>{{ formatFcfa(paidFcfa) }}</strong>
      · {{ uiText('Reste à payer') }} : <strong>{{ formatFcfa(remainingFcfa) }}</strong>
    </p>
    <UiInput
      v-model="amount"
      :label="uiText('Montant encaissé')"
      type="number"
      min="1"
      :max="remainingFcfa"
      required
    />
    <p v-if="amountError" class="hosp-collect__error">{{ amountError }}</p>
    <p v-else-if="parsedAmount > 0" class="hosp-collect__hint">
      <template v-if="remainingAfter > 0">
        {{
          translateTemplate('{amount} encaissé — reste à payer : {rest}.', {
            amount: formatFcfa(parsedAmount),
            rest: formatFcfa(remainingAfter),
          })
        }}
      </template>
      <template v-else>
        {{ translateTemplate('{amount} encaissé — séjour soldé.', { amount: formatFcfa(parsedAmount) }) }}
      </template>
    </p>

    <template #footer>
      <UiButton variant="ghost" @click="emit('close')">{{ uiText('Annuler') }}</UiButton>
      <UiButton
        variant="primary"
        :icon="Banknote"
        :disabled="Boolean(amountError) || submitting"
        @click="onSubmit"
      >
        {{ submitting ? uiText('Enregistrement…') : uiText('Encaisser') }}
      </UiButton>
    </template>
  </UiFormModal>
</template>

<style scoped>
.hosp-collect__meta,
.hosp-collect__hint {
  margin: 0 0 0.75rem;
  font-size: 0.8125rem;
  color: var(--text-muted);
  line-height: 1.45;
}

.hosp-collect__meta strong,
.hosp-collect__hint {
  color: var(--text);
  font-weight: 600;
}

.hosp-collect__error {
  margin: 0.35rem 0 0;
  font-size: 0.8125rem;
  font-weight: 600;
  color: #b45309;
}
</style>
