<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Banknote, Printer } from '@lucide/vue'
import UiFormModal from '@/components/ui/UiFormModal.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiButton from '@/components/ui/UiButton.vue'
import { formatFcfa, fullName } from '@/lib/roles'
import { useAppI18n } from '@/i18n/useAppI18n'

const props = defineProps<{
  hosp: {
    id: string
    totalDueFcfa?: number
    paidFcfa?: number
    depositFcfa?: number
    visit: { patient: { firstName: string; lastName: string } }
  } | null
  submitting?: boolean
}>()

const emit = defineEmits<{
  close: []
  confirm: [payload: { hospitalizationId: string; amountFcfa: number; print: boolean }]
  print: []
}>()

const { uiText } = useAppI18n()
const amount = ref('')
const amountInput = ref<{ select: () => void } | null>(null)

const receivedFcfa = computed(() =>
  Math.max(0, props.hosp?.paidFcfa ?? 0, props.hosp?.depositFcfa ?? 0),
)
const totalFcfa = computed(() => Math.max(0, props.hosp?.totalDueFcfa ?? 0))
/** Prix net encore dû : total du séjour moins ce qui est déjà en caisse. */
const balanceFcfa = computed(() => Math.max(0, totalFcfa.value - receivedFcfa.value))

const patientLabel = computed(() =>
  props.hosp
    ? fullName(props.hosp.visit.patient.firstName, props.hosp.visit.patient.lastName)
    : '',
)

const parsedAmount = computed(() => {
  const value = Number.parseInt(String(amount.value).replace(/\s/g, ''), 10)
  return Number.isFinite(value) ? value : 0
})

/** 60 000 saisi alors que 3 F sont déjà reçus : on encaisse le solde, pas un refus. */
const amountToCollect = computed(() => {
  const typed = parsedAmount.value
  if (typed <= 0 || balanceFcfa.value <= 0) return 0
  if (typed <= balanceFcfa.value) return typed
  if (typed === totalFcfa.value) return balanceFcfa.value
  return 0
})

const collectsFullTotal = computed(
  () =>
    parsedAmount.value === totalFcfa.value &&
    parsedAmount.value > balanceFcfa.value &&
    amountToCollect.value > 0,
)

const canSave = computed(() => amountToCollect.value > 0 && !props.submitting)
const partialPayment = computed(
  () => parsedAmount.value > 0 && parsedAmount.value < balanceFcfa.value,
)

watch(
  () => props.hosp?.id,
  async () => {
    amount.value = balanceFcfa.value > 0 ? String(balanceFcfa.value) : ''
    await nextTick()
    amountInput.value?.select()
  },
  { immediate: true },
)

function onSave(print: boolean) {
  if (!props.hosp || !canSave.value) return
  emit('confirm', {
    hospitalizationId: props.hosp.id,
    amountFcfa: amountToCollect.value,
    print,
  })
}
</script>

<template>
  <UiFormModal
    v-if="hosp"
    title="Encaisser l'hospitalisation"
    :subtitle="patientLabel"
    :icon="Banknote"
    @close="emit('close')"
  >
    <p class="hosp-deposit__hint">
      {{ uiText('Ce montant est ajouté à la caisse et apparaît sur le reçu du jour.') }}
    </p>
    <dl class="hosp-deposit__figures">
      <div>
        <dt>{{ uiText('Total à payer') }}</dt>
        <dd>{{ formatFcfa(totalFcfa) }}</dd>
      </div>
      <div>
        <dt>{{ uiText('Déjà reçu') }}</dt>
        <dd>{{ formatFcfa(receivedFcfa) }}</dd>
      </div>
      <div>
        <dt>{{ uiText('Solde restant') }}</dt>
        <dd>{{ formatFcfa(balanceFcfa) }}</dd>
      </div>
    </dl>
    <UiInput
      ref="amountInput"
      v-model="amount"
      label="Prix net à payer"
      type="number"
      min="1"
      required
      autofocus
    />
    <p class="hosp-deposit__hint">
      {{ uiText('Ce montant est le prix net à payer. Réduisez-le pour un paiement partiel.') }}
    </p>
    <p v-if="partialPayment" class="hosp-deposit__hint">
      {{
        uiText('Paiement partiel : il restera {amount} après cet encaissement.')
          .replace('{amount}', formatFcfa(balanceFcfa - parsedAmount))
      }}
    </p>
    <p v-if="collectsFullTotal" class="hosp-deposit__hint">
      {{
        uiText('Ce montant est le total du séjour. Le solde restant de {amount} sera encaissé.')
          .replace('{amount}', formatFcfa(amountToCollect))
      }}
    </p>

    <template #footer>
      <UiButton variant="ghost" @click="emit('close')">{{ uiText('Annuler') }}</UiButton>
      <UiButton variant="secondary" :icon="Printer" @click="emit('print')">
        {{ uiText('Imprimer le reçu') }}
      </UiButton>
      <UiButton variant="outline" :disabled="!canSave" @click="onSave(false)">
        {{ uiText('Encaisser') }}
      </UiButton>
      <UiButton variant="primary" :icon="Banknote" :disabled="!canSave" @click="onSave(true)">
        {{ uiText('Encaisser et imprimer') }}
      </UiButton>
    </template>
  </UiFormModal>
</template>

<style scoped>
.hosp-deposit__hint {
  margin: 0 0 0.85rem;
  font-size: 0.875rem;
  line-height: 1.45;
  color: var(--text-muted);
}

.hosp-deposit__figures {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.65rem;
  margin: 0 0 1rem;
}

.hosp-deposit__figures div {
  padding: 0.55rem 0.65rem;
  border-radius: 0.65rem;
  background: var(--surface-muted, #f4f7f5);
}

.hosp-deposit__figures dt {
  font-size: 0.75rem;
  color: var(--text-muted);
}

.hosp-deposit__figures dd {
  margin: 0.15rem 0 0;
  font-weight: 700;
}
</style>
