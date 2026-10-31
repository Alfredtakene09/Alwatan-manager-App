<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Wallet, Save } from '@lucide/vue'
import { formatFcfa } from '@/lib/roles'
import type { ExpenseIndiceOption } from '@/lib/expense-indices'
import { categoryCodeFromIndiceName, EXPENSE_CATEGORY_CODE_LABELS } from '@/lib/expense-indices'
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
  flow: 'SORTIE' | 'ENTREE'
  indiceId?: string
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
  flow?: 'SORTIE' | 'ENTREE'
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
  /** ENTREE ajoute le montant au solde. SORTIE le retire. */
  defaultFlow?: 'SORTIE' | 'ENTREE'
}>()

const emit = defineEmits<{
  close: []
  submit: [payload: AdminExpenseFormPayload]
  'go-to-indices': []
}>()

function todayIso() {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

function createEmptyForm() {
  return {
    businessDate: (props.defaultBusinessDate || '').slice(0, 10) || todayIso(),
    flow: (props.defaultFlow === 'ENTREE' ? 'ENTREE' : 'SORTIE') as 'SORTIE' | 'ENTREE',
    indiceId: '',
    label: '',
    amountFcfa: '',
    comment: '',
  }
}

const form = ref(createEmptyForm())

const entryFlow = computed(() => form.value.flow === 'ENTREE')

const indicesForFlow = computed(() =>
  props.indices.filter((item) => (item.flow === 'ENTREE') === entryFlow.value),
)

const indiceOptions = computed(() => [
  { value: '', label: '— Sélectionner un indice —' },
  ...indicesForFlow.value.map((item) => ({ value: item.id, label: item.name })),
])

const selectedIndice = computed(() =>
  indicesForFlow.value.find((item) => item.id === form.value.indiceId) ?? null,
)

const indicatedCodeLabel = computed(() => {
  if (!selectedIndice.value) return null
  const code = categoryCodeFromIndiceName(selectedIndice.value.name)
  return EXPENSE_CATEGORY_CODE_LABELS[code]
})

function applySelectedIndice(previousIndiceId?: string) {
  if (!form.value.indiceId || props.editing?.id) return
  const selected = selectedIndice.value
  if (!selected) return
  const previousLabel = props.indices.find((item) => item.id === previousIndiceId)?.name
  if (!form.value.label.trim() || form.value.label.trim() === previousLabel) {
    form.value.label = selected.name
  }
  if (!form.value.comment.trim()) {
    form.value.comment = selected.description ?? ''
  }
}

function resolveLabel() {
  return form.value.label.trim() || selectedIndice.value?.name || ''
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
      businessDate: (editing.businessDate ?? '').slice(0, 10) || todayIso(),
      flow: editing.flow === 'ENTREE' ? 'ENTREE' : 'SORTIE',
      indiceId: '',
      label: editing.label,
      amountFcfa: String(editing.amountFcfa),
      comment: editing.comment ?? '',
    }
  },
)

watch(() => form.value.flow, () => {
  if (props.editing?.id) return
  if (!indicesForFlow.value.some((item) => item.id === form.value.indiceId)) {
    form.value.indiceId = ''
    form.value.label = ''
  }
})

watch(
  () => form.value.indiceId,
  (_indiceId, previousIndiceId) => applySelectedIndice(previousIndiceId),
)

const expenseModalSubtitle = computed(() => {
  const label = resolveLabel()
  if (label) return label
  if (entryFlow.value) {
    return 'Entrée de caisse — le montant saisi est ajouté au solde selon l\'indice indiqué'
  }
  return 'Sortie de caisse — choisissez un indice et renseignez le montant'
})

const isEditing = computed(() => Boolean(props.editing?.id))

const canSubmit = computed(() => {
  const amount = Number(form.value.amountFcfa)
  const hasIndice = isEditing.value || Boolean(form.value.indiceId)
  const hasLabel = form.value.label.trim().length >= 2
  return (
    hasIndice
    && hasLabel
    && Number.isFinite(amount)
    && amount > 0
    && Boolean(form.value.businessDate)
  )
})

const amountPreview = computed(() => {
  const amount = Number(form.value.amountFcfa)
  if (!Number.isFinite(amount) || amount <= 0) return null
  return formatFcfa(amount)
})

function submit() {
  if (!canSubmit.value) return
  const status = props.editing?.status ?? 'VALIDATED'
  const code = selectedIndice.value
    ? categoryCodeFromIndiceName(selectedIndice.value.name)
    : (props.editing?.categoryCode ?? 'AUTRE')
  emit('submit', {
    businessDate: form.value.businessDate,
    label: resolveLabel(),
    amountFcfa: Number(form.value.amountFcfa),
    category: code,
    flow: entryFlow.value ? 'ENTREE' : 'SORTIE',
    indiceId: form.value.indiceId || undefined,
    status,
    comment: form.value.comment.trim() || undefined,
    rejectionReason:
      status === 'REJECTED' ? props.editing?.rejectionReason?.trim() || undefined : undefined,
  })
}
</script>

<template>
  <UiFormModal
    v-if="open"
    title-id="admin-expense-modal-title"
    :title="isEditing ? 'Modifier la saisie' : 'Nouvelle saisie'"
    :subtitle="expenseModalSubtitle"
    :icon="Wallet"
    size="wide"
    @close="emit('close')"
  >
    <section class="form-panel">
      <UiAlert
        v-if="!isEditing && !indicesForFlow.length"
        type="warning"
        :message="entryFlow
          ? 'Aucun indice d\'entrée. Créez-en un dans l\'onglet Indices, avec le type Entrée.'
          : 'Aucun indice de dépense. Créez-en un dans l\'onglet Indices, avec le type Dépense.'"
        class="expense-form__full"
      />

      <div class="form-grid-2">
        <UiInput
          v-model="form.businessDate"
          :label="entryFlow ? 'Date de l\'entrée' : 'Date de la dépense'"
          type="date"
          required
        />

        <UiSelect
          v-if="!isEditing"
          v-model="form.flow"
          label="Type"
          required
        >
          <option value="SORTIE">Dépense</option>
          <option value="ENTREE">Entrée</option>
        </UiSelect>

        <UiSelect
          v-if="!isEditing"
          v-model="form.indiceId"
          label="Indice / motif"
          required
          :disabled="!indicesForFlow.length"
        >
          <option v-for="opt in indiceOptions" :key="opt.value || 'empty'" :value="opt.value">
            {{ opt.label }}
          </option>
        </UiSelect>

        <UiInput
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
          <div v-if="indicatedCodeLabel && !isEditing" class="expense-preview__row">
            <span>Code</span>
            <strong>{{ indicatedCodeLabel }}</strong>
          </div>
          <div class="expense-preview__row expense-preview__row--amount">
            <span>{{ entryFlow ? 'Montant ajouté au solde' : 'Montant saisi' }}</span>
            <strong>{{ amountPreview }}</strong>
          </div>
        </div>
      </div>
    </section>

    <template #footer>
      <UiButton
        v-if="!isEditing && !indicesForFlow.length"
        variant="ghost"
        @click="emit('go-to-indices')"
      >
        Ouvrir l'onglet Indices
      </UiButton>
      <UiButton variant="ghost" @click="emit('close')">Annuler</UiButton>
      <UiButton variant="primary" :icon="Save" :disabled="saving || !canSubmit" @click="submit">
        {{ saving ? 'Enregistrement…' : isEditing ? 'Mettre à jour' : entryFlow ? 'Enregistrer l\'entrée' : 'Enregistrer la dépense' }}
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
