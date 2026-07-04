<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Banknote, Save, Wallet, Landmark, FileCheck } from '@lucide/vue'
import { formatFcfa } from '@/lib/roles'
import UiFormModal from '@/components/ui/UiFormModal.vue'
import UiTextarea from '@/components/ui/UiTextarea.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'

export type PayrollPaymentTarget = {
  id: string
  grossFcfa: number
  netFcfa: number
  pendingAdvancesFcfa?: number
  advanceDeductionFcfa?: number
  employee: {
    fullName: string
    jobTitle: string | null
    service: string
  }
}

export type PayrollPaymentPayload = {
  paymentMethod: string
  remarks?: string
}

const PAYMENT_METHOD_OPTIONS = [
  { value: 'ESPECES', label: 'Espèces', icon: Wallet, hint: 'Paiement en liquide' },
  { value: 'VIREMENT', label: 'Virement', icon: Landmark, hint: 'Transfert bancaire' },
  { value: 'CHEQUE', label: 'Chèque', icon: FileCheck, hint: 'Chèque nominatif' },
] as const

const props = defineProps<{
  open: boolean
  saving?: boolean
  target: PayrollPaymentTarget | null
  errorMessage?: string
}>()

const emit = defineEmits<{
  close: []
  submit: [payload: PayrollPaymentPayload]
}>()

const form = ref({
  paymentMethod: 'ESPECES',
  remarks: '',
})
const localError = ref('')

watch(
  () => [props.open, props.target] as const,
  ([isOpen]) => {
    if (!isOpen) return
    localError.value = ''
    form.value = { paymentMethod: 'ESPECES', remarks: '' }
  },
)

const modalSubtitle = computed(() => {
  if (!props.target) return ''
  const parts = [props.target.employee.fullName]
  if (props.target.employee.jobTitle) parts.push(props.target.employee.jobTitle)
  return parts.join(' — ')
})

const selectedMethod = computed(
  () => PAYMENT_METHOD_OPTIONS.find((o) => o.value === form.value.paymentMethod) ?? PAYMENT_METHOD_OPTIONS[0],
)

const alertMessage = computed(() => props.errorMessage || localError.value)

function submit() {
  if (!props.target) {
    localError.value = 'Aucune fiche de paie sélectionnée.'
    return
  }
  localError.value = ''
  emit('submit', {
    paymentMethod: form.value.paymentMethod,
    remarks: form.value.remarks.trim() || undefined,
  })
}
</script>

<template>
  <UiFormModal
    v-if="open && target"
    title-id="gestionnaire-payroll-payment-modal-title"
    title="Valider le paiement"
    :subtitle="modalSubtitle"
    :icon="Banknote"
    size="wide"
    @close="emit('close')"
  >
    <div class="gestionnaire-modal-hero">
      <div>
        <p class="gestionnaire-modal-hero__eyebrow">Salaire net à verser</p>
        <p class="gestionnaire-modal-hero__amount">{{ formatFcfa(target.netFcfa) }}</p>
        <p class="gestionnaire-modal-hero__meta">
          {{ target.employee.service }}
          <span v-if="target.employee.jobTitle"> · {{ target.employee.jobTitle }}</span>
        </p>
      </div>
      <span class="gestionnaire-modal-hero__badge">
        <component :is="selectedMethod.icon" :size="12" />
        {{ selectedMethod.label }}
      </span>
    </div>

    <UiAlert v-if="alertMessage" type="error" :message="alertMessage" />

    <section class="form-panel gestionnaire-form-panel gestionnaire-form-panel--accent">
      <h3 class="form-panel__title">
        <Banknote :size="15" />
        Détail de la fiche
      </h3>
      <div class="gestionnaire-preview-box">
        <div class="gestionnaire-preview-box__row">
          <span>Salaire brut</span>
          <strong>{{ formatFcfa(target.grossFcfa) }}</strong>
        </div>
        <div
          v-if="(target.pendingAdvancesFcfa ?? 0) > 0"
          class="gestionnaire-preview-box__row gestionnaire-preview-box__row--deduct"
        >
          <span>Avances à déduire</span>
          <strong>-{{ formatFcfa(target.pendingAdvancesFcfa ?? 0) }}</strong>
        </div>
        <div class="gestionnaire-preview-box__row gestionnaire-preview-box__row--total">
          <span>Net à payer</span>
          <strong>{{ formatFcfa(target.netFcfa) }}</strong>
        </div>
      </div>
    </section>

    <section class="form-panel gestionnaire-form-panel">
      <h3 class="form-panel__title">
        <Wallet :size="15" />
        Mode de paiement
      </h3>
      <p class="form-panel__intro">Sélectionnez le moyen utilisé pour ce versement.</p>

      <div class="gestionnaire-payment-methods" role="radiogroup" aria-label="Mode de paiement">
        <button
          v-for="option in PAYMENT_METHOD_OPTIONS"
          :key="option.value"
          type="button"
          class="gestionnaire-payment-methods__option"
          :class="{ 'gestionnaire-payment-methods__option--active': form.paymentMethod === option.value }"
          :title="option.hint"
          @click="form.paymentMethod = option.value"
        >
          <component :is="option.icon" :size="22" />
          <span class="gestionnaire-payment-methods__label">{{ option.label }}</span>
        </button>
      </div>
    </section>

    <section class="form-panel gestionnaire-form-panel">
      <h3 class="form-panel__title">Remarques</h3>
      <UiTextarea
        v-model="form.remarks"
        label="Observations (optionnel)"
        placeholder="Référence virement, numéro de chèque, remarque comptable…"
      />
    </section>

    <template #footer>
      <UiButton variant="ghost" @click="emit('close')">Annuler</UiButton>
      <UiButton variant="primary" :icon="Save" :disabled="saving" @click="submit">
        {{ saving ? 'Traitement…' : 'Confirmer le paiement' }}
      </UiButton>
    </template>
  </UiFormModal>
</template>
