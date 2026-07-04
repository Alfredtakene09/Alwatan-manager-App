<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Wallet, Banknote, Save, ListOrdered, FileText, AlertCircle } from '@lucide/vue'
import UiFormModal from '@/components/ui/UiFormModal.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiTextarea from '@/components/ui/UiTextarea.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import { formatFcfa } from '@/lib/roles'
import { formatDateTimeFr } from '@/lib/gestionnaire-dashboard'

export type CashRegisterDetail = {
  id: 'reception' | 'comptabilite'
  label: string
  balanceFcfa: number
  grossFcfa: number
  expensesFcfa: number
  transactionCount: number
  transactions: Array<{
    id: string
    invoiceNumber: string
    typeLabel: string
    amountFcfa: number
    collectedAt: string
    cashierName: string
    patientLabel: string
  }>
}

const props = defineProps<{
  open: boolean
  detail: CashRegisterDetail | null
  saving?: boolean
}>()

const emit = defineEmits<{
  close: []
  confirm: [payload: { disbursementFcfa: number; comment: string }]
}>()

const amount = ref('')
const comment = ref('')
const localError = ref('')

const defaultAmount = computed(() => props.detail?.balanceFcfa ?? 0)

function resetForm() {
  amount.value = String(defaultAmount.value)
  comment.value = ''
  localError.value = ''
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) resetForm()
  },
)

const amountValue = computed(() => Number(amount.value))

const canSubmit = computed(() => {
  return (
    props.detail != null &&
    Number.isFinite(amountValue.value) &&
    amountValue.value > 0 &&
    amountValue.value <= (props.detail?.balanceFcfa ?? 0)
  )
})

const remainder = computed(() => {
  if (!props.detail || !Number.isFinite(amountValue.value)) return null
  return props.detail.balanceFcfa - amountValue.value
})

const validationHint = computed(() => {
  if (!props.detail) return ''
  if (!amount.value.trim()) return ''
  if (!Number.isFinite(amountValue.value) || amountValue.value <= 0) {
    return 'Le montant doit être supérieur à zéro.'
  }
  if (amountValue.value > props.detail.balanceFcfa) {
    return `Le montant ne peut pas dépasser ${formatFcfa(props.detail.balanceFcfa)}.`
  }
  return ''
})

function submit() {
  if (!canSubmit.value) {
    localError.value = validationHint.value || 'Montant invalide.'
    return
  }
  localError.value = ''
  emit('confirm', {
    disbursementFcfa: amountValue.value,
    comment: comment.value.trim(),
  })
}
</script>

<template>
  <UiFormModal
    v-if="open"
    title-id="gestionnaire-disburse-modal"
    :title="detail ? `Récupération — ${detail.label}` : 'Récupération tirelire'"
    subtitle="Confirmez le montant collecté et vos observations"
    :icon="Wallet"
    size="wide"
    @close="emit('close')"
  >
    <template v-if="detail">
      <div class="gestionnaire-modal-hero">
        <div>
          <p class="gestionnaire-modal-hero__eyebrow">Solde à récupérer</p>
          <p class="gestionnaire-modal-hero__amount">{{ formatFcfa(detail.balanceFcfa) }}</p>
          <div class="disburse-hero__meta">
            <span>{{ detail.transactionCount }} transaction(s)</span>
            <span v-if="detail.expensesFcfa > 0">
              Dépenses caisse : {{ formatFcfa(detail.expensesFcfa) }}
            </span>
          </div>
        </div>
        <span class="gestionnaire-modal-hero__badge">
          <Wallet :size="12" />
          Tirelire {{ detail.label }}
        </span>
      </div>

      <section v-if="detail.transactions.length" class="form-panel gestionnaire-form-panel">
        <h3 class="form-panel__title">
          <ListOrdered :size="15" />
          Détail des encaissements
        </h3>
        <ul class="disburse-tx-list">
          <li v-for="tx in detail.transactions.slice(0, 10)" :key="tx.id">
            <div class="disburse-tx-list__main">
              <strong>{{ tx.typeLabel }}</strong>
              <span>{{ tx.patientLabel }}</span>
            </div>
            <strong class="disburse-tx-list__amount">{{ formatFcfa(tx.amountFcfa) }}</strong>
          </li>
        </ul>
        <p v-if="detail.transactions.length > 10" class="disburse-tx-list__more">
          + {{ detail.transactions.length - 10 }} autre(s) encaissement(s)…
        </p>
      </section>

      <UiAlert v-if="localError || validationHint" type="error" :message="localError || validationHint" />

      <section class="form-panel gestionnaire-form-panel gestionnaire-form-panel--accent">
        <h3 class="form-panel__title">
          <Banknote :size="15" />
          Montant récupéré
        </h3>
        <div class="form-grid-2">
          <UiInput
            v-model="amount"
            label="Montant (FCFA)"
            type="number"
            required
            min="1"
            :max="detail.balanceFcfa"
            :icon="Banknote"
          />
          <p class="disburse-ts">
            Horodatage : {{ formatDateTimeFr(new Date().toISOString()) }}
          </p>
        </div>

        <div v-if="canSubmit && remainder != null" class="gestionnaire-preview-box">
          <div class="gestionnaire-preview-box__row">
            <span>Solde tirelire</span>
            <strong>{{ formatFcfa(detail.balanceFcfa) }}</strong>
          </div>
          <div class="gestionnaire-preview-box__row gestionnaire-preview-box__row--amount">
            <span>Montant récupéré</span>
            <strong>{{ formatFcfa(amountValue) }}</strong>
          </div>
          <div v-if="remainder > 0" class="gestionnaire-preview-box__row">
            <span>Reliquat théorique</span>
            <strong>{{ formatFcfa(remainder) }}</strong>
          </div>
        </div>

        <p v-else-if="validationHint" class="form-panel__hint">
          <AlertCircle :size="13" />
          {{ validationHint }}
        </p>
      </section>

      <section class="form-panel gestionnaire-form-panel">
        <h3 class="form-panel__title">
          <FileText :size="15" />
          Observations
        </h3>
        <UiTextarea
          v-model="comment"
          label="Remarques (optionnel)"
          placeholder="Ex. passage du soir, écart constaté, remarque comptable…"
        />
      </section>
    </template>

    <template #footer>
      <UiButton variant="ghost" @click="emit('close')">Annuler</UiButton>
      <UiButton variant="primary" :icon="Save" :disabled="!canSubmit || saving" @click="submit">
        {{ saving ? 'Traitement…' : 'Confirmer la récupération' }}
      </UiButton>
    </template>
  </UiFormModal>
</template>

<style scoped>
.disburse-hero__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.65rem;
  margin-top: 0.35rem;
  font-size: 0.75rem;
  color: #78716c;
}

.disburse-tx-list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 11rem;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.disburse-tx-list li {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.5rem 0.55rem;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.8);
  border: 1px solid rgba(15, 23, 42, 0.06);
}

.disburse-tx-list__main {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 0;
}

.disburse-tx-list__main strong {
  font-size: 0.8125rem;
  color: #334155;
}

.disburse-tx-list__main span {
  font-size: 0.75rem;
  color: #64748b;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.disburse-tx-list__amount {
  font-size: 0.8125rem;
  color: #15803d;
  flex-shrink: 0;
}

.disburse-tx-list__more {
  margin: 0.35rem 0 0;
  font-size: 0.75rem;
  color: #94a3b8;
}

.disburse-ts {
  margin: 0;
  align-self: end;
  padding-bottom: 0.5rem;
  font-size: 0.75rem;
  color: #94a3b8;
  line-height: 1.4;
}

.form-panel__hint {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  color: #b45309;
}

@media (max-width: 700px) {
  .disburse-ts {
    align-self: start;
    padding-bottom: 0;
  }
}
</style>
