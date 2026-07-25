<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Wallet, Save } from '@lucide/vue'
import { formatFcfa } from '@/lib/roles'
import type { ExpenseIndiceOption } from '@/lib/expense-indices'
import type { AdminExpenseCategory } from '@/lib/admin-dashboard'
import UiFormModal from '@/components/ui/UiFormModal.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiTextarea from '@/components/ui/UiTextarea.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import UiAlert from '@/components/ui/UiAlert.vue'

type ClinicExpenseStatus = 'PENDING' | 'VALIDATED' | 'REJECTED'

export type AdminExpenseFormPayload = {
  businessDate: string
  label: string
  amountFcfa: number
  category: AdminExpenseCategory
  status: ClinicExpenseStatus
  comment?: string
  rejectionReason?: string
}

export type AdminExpenseEdit = {
  id: string
  businessDate: string
  label: string
  amountFcfa: number
  categoryCode?: AdminExpenseCategory
  comment?: string | null
  status: ClinicExpenseStatus
  rejectionReason?: string | null
}

const props = defineProps<{
  open: boolean
  saving?: boolean
  editing?: AdminExpenseEdit | null
  /** Indices actifs créés dans l'onglet Indices de la page. */
  indices: ExpenseIndiceOption[]
  /** Date utilisée à la création (filtre actif ou jour courant). */
  defaultBusinessDate?: string
}>()

const emit = defineEmits<{
  close: []
  submit: [payload: AdminExpenseFormPayload]
  'go-to-indices': []
}>()

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

function createEmptyForm() {
  return {
    indiceId: '',
    label: '',
    amountFcfa: '',
    status: 'VALIDATED' as ClinicExpenseStatus,
    comment: '',
    rejectionReason: '',
  }
}

const form = ref(createEmptyForm())

const indiceOptions = computed(() => [
  { value: '', label: '— Sélectionner un indice —' },
  ...props.indices.map((item) => ({ value: item.id, label: item.name })),
])

const selectedIndice = computed(() =>
  props.indices.find((item) => item.id === form.value.indiceId) ?? null,
)

function applySelectedIndice() {
  if (!form.value.indiceId || props.editing?.id) return
  const selected = selectedIndice.value
  if (!selected) return
  form.value.label = selected.name
  if (!form.value.comment.trim()) {
    form.value.comment = selected.description ?? ''
  }
}

function resolveBusinessDate() {
  if (props.editing?.id) {
    return (props.editing.businessDate ?? '').slice(0, 10) || todayIso()
  }
  return props.defaultBusinessDate || todayIso()
}

function resolveLabel() {
  if (isEditing.value) return form.value.label.trim()
  return selectedIndice.value?.name ?? form.value.label.trim()
}

watch(
  () => [props.open, props.editing] as const,
  ([isOpen, editing]) => {
    if (!isOpen) return
    if (!editing) {
      form.value = createEmptyForm()
      return
    }
    form.value = {
      indiceId: '',
      label: editing.label,
      amountFcfa: String(editing.amountFcfa),
      status: editing.status,
      comment: editing.comment ?? '',
      rejectionReason: editing.rejectionReason ?? '',
    }
  },
)

watch(() => form.value.indiceId, applySelectedIndice)

const expenseModalSubtitle = computed(() => {
  const label = resolveLabel()
  if (label) return label
  return 'Sortie de caisse — choisissez un indice et renseignez le montant'
})

const isEditing = computed(() => Boolean(props.editing?.id))

const canSubmit = computed(() => {
  const amount = Number(form.value.amountFcfa)
  const hasIndice = isEditing.value || Boolean(form.value.indiceId)
  const hasLabel = isEditing.value ? Boolean(form.value.label.trim()) : Boolean(selectedIndice.value)
  const hasRejectionReason =
    form.value.status !== 'REJECTED' || Boolean(form.value.rejectionReason.trim())
  return (
    hasIndice
    && hasLabel
    && Number.isFinite(amount)
    && amount > 0
    && Boolean(form.value.status)
    && hasRejectionReason
  )
})

const amountPreview = computed(() => {
  const amount = Number(form.value.amountFcfa)
  if (!Number.isFinite(amount) || amount <= 0) return null
  return formatFcfa(amount)
})

function submit() {
  if (!canSubmit.value) return
  emit('submit', {
    businessDate: resolveBusinessDate(),
    label: resolveLabel(),
    amountFcfa: Number(form.value.amountFcfa),
    category: props.editing?.categoryCode ?? 'AUTRE',
    status: form.value.status,
    comment: form.value.comment.trim() || undefined,
    rejectionReason: form.value.status === 'REJECTED' ? form.value.rejectionReason.trim() : undefined,
  })
}
</script>

<template>
  <UiFormModal
    v-if="open"
    title-id="admin-expense-modal-title"
    :title="isEditing ? 'Modifier la dépense' : 'Nouvelle dépense'"
    :subtitle="expenseModalSubtitle"
    :icon="Wallet"
    size="wide"
    @close="emit('close')"
  >
    <section class="form-panel">
      <UiAlert
        v-if="!isEditing && !indices.length"
        type="warning"
        message="Aucun indice actif. Créez des motifs dans l'onglet Indices de cette page."
        class="expense-form__full"
      />

      <div class="form-grid-2">
        <UiSelect
          v-if="!isEditing"
          v-model="form.indiceId"
          label="Indice / motif"
          required
          :disabled="!indices.length"
        >
          <option v-for="opt in indiceOptions" :key="opt.value || 'empty'" :value="opt.value">
            {{ opt.label }}
          </option>
        </UiSelect>

        <UiInput
          v-else
          v-model="form.label"
          label="Description"
          placeholder="Ex. Achat produits d'entretien"
          required
        />

        <UiInput
          v-model="form.amountFcfa"
          label="Montant (FCFA)"
          type="number"
          min="1"
          placeholder="Ex. 15 000"
          required
        />

        <UiSelect v-model="form.status" label="Statut" required>
          <option value="VALIDATED">Validée</option>
          <option value="PENDING">En attente</option>
          <option value="REJECTED">Rejetée</option>
        </UiSelect>

        <UiTextarea
          v-if="form.status === 'REJECTED'"
          v-model="form.rejectionReason"
          label="Motif du rejet"
          placeholder="Précisez le motif du rejet"
          required
          class="expense-form__full"
        />

        <UiTextarea
          v-model="form.comment"
          label="Commentaire (optionnel)"
          placeholder="Justificatif, référence facture, détail complémentaire…"
          class="expense-form__full"
        />

        <div v-if="amountPreview" class="expense-preview expense-form__full">
          <div v-if="selectedIndice && !isEditing" class="expense-preview__row">
            <span>Indice sélectionné</span>
            <strong>{{ selectedIndice.name }}</strong>
          </div>
          <div class="expense-preview__row expense-preview__row--amount">
            <span>Montant saisi</span>
            <strong>{{ amountPreview }}</strong>
          </div>
        </div>
      </div>
    </section>

    <template #footer>
      <UiButton
        v-if="!isEditing && !indices.length"
        variant="ghost"
        @click="emit('go-to-indices')"
      >
        Ouvrir l'onglet Indices
      </UiButton>
      <UiButton variant="ghost" @click="emit('close')">Annuler</UiButton>
      <UiButton variant="primary" :icon="Save" :disabled="saving || !canSubmit" @click="submit">
        {{ saving ? 'Enregistrement…' : isEditing ? 'Mettre à jour' : 'Enregistrer la dépense' }}
      </UiButton>
    </template>
  </UiFormModal>
</template>

<style scoped>
.expense-form__full {
  grid-column: 1 / -1;
}

.expense-preview {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  padding: 0.75rem 0.85rem;
  border-radius: 10px;
  background: #fff;
  border: 1px solid rgba(107, 124, 62, 0.22);
}

.expense-preview__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  font-size: 0.8125rem;
  color: var(--text-muted);
}

.expense-preview__row strong {
  color: var(--text);
  font-size: 0.875rem;
}

.expense-preview__row--amount strong {
  color: var(--primary-800);
  font-size: 1rem;
}
</style>
