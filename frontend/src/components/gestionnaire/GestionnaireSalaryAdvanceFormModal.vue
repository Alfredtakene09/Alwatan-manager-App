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
  localError.value = ''
  emit('submit', {
    employeeId: form.value.employeeId,
    amountFcfa: Math.round(amount),
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
        L'avance sera déduite automatiquement lors du prochain paiement de salaire.
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
          label="Montant (FCFA)"
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

@media (max-width: 560px) {
  .gestionnaire-form-grid {
    grid-template-columns: 1fr;
  }
}
</style>
