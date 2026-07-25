<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { HandCoins, Save, CalendarDays } from '@lucide/vue'
import UiFormModal from '@/components/ui/UiFormModal.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import UiTextarea from '@/components/ui/UiTextarea.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import { formatFcfa } from '@/lib/roles'

export type SalaryAdvanceEmployeeOption = {
  id: string
  fullName: string
  jobTitle: string | null
}

export type SalaryAdvanceFormPayload = {
  employeeId: string
  amountFcfa: number
  installmentFcfa?: number | null
  businessDate: string
  comment?: string
}

const props = defineProps<{
  open: boolean
  saving?: boolean
  employees: SalaryAdvanceEmployeeOption[]
  errorMessage?: string
}>()

const emit = defineEmits<{
  close: []
  submit: [payload: SalaryAdvanceFormPayload]
}>()

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

function emptyForm() {
  return {
    employeeId: '',
    amountFcfa: '',
    installmentMode: 'full' as 'full' | 'installment',
    installmentFcfa: '',
    businessDate: todayIso(),
    comment: '',
  }
}

const form = ref(emptyForm())
const localError = ref('')

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return
    localError.value = ''
    form.value = emptyForm()
  },
)

const selectedEmployee = computed(() =>
  props.employees.find((row) => row.id === form.value.employeeId) ?? null,
)

const modalSubtitle = computed(() => {
  if (selectedEmployee.value) return selectedEmployee.value.fullName
  return 'Sélectionnez l\'employé concerné'
})

const alertMessage = computed(() => props.errorMessage || localError.value)

const estimatedPayments = computed(() => {
  const total = Number(form.value.amountFcfa)
  const tranche = Number(form.value.installmentFcfa)
  if (
    form.value.installmentMode !== 'installment' ||
    !Number.isFinite(total) ||
    total <= 0 ||
    !Number.isFinite(tranche) ||
    tranche <= 0
  ) {
    return null
  }
  return Math.ceil(total / tranche)
})

function submit() {
  const amount = Number(form.value.amountFcfa)
  if (!form.value.employeeId) {
    localError.value = 'Sélectionnez un employé.'
    return
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    localError.value = 'Indiquez un montant valide.'
    return
  }
  if (!form.value.businessDate) {
    localError.value = 'Indiquez la date de l\'avance.'
    return
  }

  let installmentFcfa: number | null = null
  if (form.value.installmentMode === 'installment') {
    const tranche = Number(form.value.installmentFcfa)
    if (!Number.isFinite(tranche) || tranche <= 0) {
      localError.value = 'Indiquez une tranche mensuelle valide.'
      return
    }
    if (tranche > amount) {
      localError.value = 'La tranche ne peut pas dépasser le montant total.'
      return
    }
    installmentFcfa = Math.round(tranche)
  }

  localError.value = ''
  emit('submit', {
    employeeId: form.value.employeeId,
    amountFcfa: Math.round(amount),
    installmentFcfa,
    businessDate: form.value.businessDate,
    comment: form.value.comment.trim() || undefined,
  })
}
</script>

<template>
  <UiFormModal
    v-if="open"
    title-id="gestionnaire-salary-advance-modal-title"
    title="Nouvelle avance sur salaire"
    :subtitle="modalSubtitle"
    :icon="HandCoins"
    size="wide"
    @close="emit('close')"
  >
    <div v-if="selectedEmployee" class="gestionnaire-modal-hero">
      <div>
        <p class="gestionnaire-modal-hero__eyebrow">Employé</p>
        <p class="gestionnaire-modal-hero__amount">{{ selectedEmployee.fullName }}</p>
        <p v-if="selectedEmployee.jobTitle" class="gestionnaire-modal-hero__meta">
          {{ selectedEmployee.jobTitle }}
        </p>
      </div>
      <span v-if="form.amountFcfa" class="gestionnaire-modal-hero__badge">
        {{ formatFcfa(Number(form.amountFcfa) || 0) }}
      </span>
    </div>

    <UiAlert v-if="alertMessage" type="error" :message="alertMessage" />

    <section class="form-panel gestionnaire-form-panel gestionnaire-form-panel--accent">
      <h3 class="form-panel__title">
        <HandCoins :size="15" />
        Détails de l'avance
      </h3>
      <p class="form-panel__intro">
        Choisissez une déduction totale à la prochaine paie, ou une tranche fixe déduite automatiquement à chaque paiement.
      </p>

      <UiSelect v-model="form.employeeId" label="Employé" required>
        <option value="">— Choisir —</option>
        <option v-for="employee in employees" :key="employee.id" :value="employee.id">
          {{ employee.fullName }}{{ employee.jobTitle ? ` — ${employee.jobTitle}` : '' }}
        </option>
      </UiSelect>

      <div class="gestionnaire-form-grid">
        <UiInput
          v-model="form.amountFcfa"
          label="Montant total (FCFA)"
          type="number"
          min="1"
          step="1"
          required
          placeholder="Ex. 50000"
        />
        <UiInput
          v-model="form.businessDate"
          label="Date de l'avance"
          type="date"
          required
          :icon="CalendarDays"
        />
      </div>

      <div class="installment-mode" role="radiogroup" aria-label="Mode de déduction">
        <button
          type="button"
          class="installment-mode__btn"
          :class="{ 'installment-mode__btn--active': form.installmentMode === 'full' }"
          @click="form.installmentMode = 'full'"
        >
          Tout déduire à la prochaine paie
        </button>
        <button
          type="button"
          class="installment-mode__btn"
          :class="{ 'installment-mode__btn--active': form.installmentMode === 'installment' }"
          @click="form.installmentMode = 'installment'"
        >
          Déduire par tranches
        </button>
      </div>

      <div v-if="form.installmentMode === 'installment'" class="installment-fields">
        <UiInput
          v-model="form.installmentFcfa"
          label="Tranche à chaque paie (FCFA)"
          type="number"
          min="1"
          step="1"
          required
          placeholder="Ex. 10000"
        />
        <p v-if="estimatedPayments" class="installment-hint">
          Environ {{ estimatedPayments }} paiement(s) de salaire pour solder l'avance
          <template v-if="form.installmentFcfa">
            ({{ formatFcfa(Number(form.installmentFcfa) || 0) }} / paie).
          </template>
        </p>
      </div>

      <UiTextarea
        v-model="form.comment"
        label="Commentaire (optionnel)"
        placeholder="Motif, référence interne…"
      />
    </section>

    <template #footer>
      <UiButton variant="ghost" @click="emit('close')">Annuler</UiButton>
      <UiButton variant="primary" :icon="Save" :disabled="saving" @click="submit">
        {{ saving ? 'Enregistrement…' : 'Enregistrer l\'avance' }}
      </UiButton>
    </template>
  </UiFormModal>
</template>

<style scoped>
.gestionnaire-form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
}

.installment-mode {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem;
  margin-top: 0.15rem;
}

.installment-mode__btn {
  min-height: 2.4rem;
  padding: 0.45rem 0.7rem;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  background: #fff;
  color: #64748b;
  font-family: inherit;
  font-size: 0.75rem;
  font-weight: 700;
  line-height: 1.25;
  cursor: pointer;
  text-align: center;
}

.installment-mode__btn--active {
  border-color: #fcd34d;
  background: #fffbeb;
  color: #b45309;
}

.installment-fields {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.installment-hint {
  margin: 0;
  font-size: 0.75rem;
  color: var(--text-muted);
  font-weight: 600;
}

@media (max-width: 560px) {
  .gestionnaire-form-grid,
  .installment-mode {
    grid-template-columns: 1fr;
  }
}
</style>
