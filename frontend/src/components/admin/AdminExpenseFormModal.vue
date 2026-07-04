<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Component } from 'vue'
import {
  Wallet,
  CalendarDays,
  Tags,
  Save,
  Package,
  Wrench,
  Monitor,
  Truck,
  CircleEllipsis,
} from '@lucide/vue'
import { formatFcfa } from '@/lib/roles'
import {
  ADMIN_EXPENSE_CATEGORY_OPTIONS,
  type AdminExpenseCategory,
} from '@/lib/admin-dashboard'
import UiFormModal from '@/components/ui/UiFormModal.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiTextarea from '@/components/ui/UiTextarea.vue'
import UiButton from '@/components/ui/UiButton.vue'

export type AdminExpenseFormPayload = {
  businessDate: string
  label: string
  amountFcfa: number
  category: AdminExpenseCategory
  comment?: string
}

const CATEGORY_ICONS: Record<AdminExpenseCategory, Component> = {
  FOURNITURES: Package,
  MAINTENANCE: Wrench,
  ACHAT_URGENT: Monitor,
  TRANSPORT: Truck,
  AUTRE: CircleEllipsis,
}

const props = defineProps<{
  open: boolean
  saving?: boolean
}>()

const emit = defineEmits<{
  close: []
  submit: [payload: AdminExpenseFormPayload]
}>()

function createEmptyForm() {
  return {
    businessDate: new Date().toISOString().slice(0, 10),
    label: '',
    amountFcfa: '',
    category: 'AUTRE' as AdminExpenseCategory,
    comment: '',
  }
}

const form = ref(createEmptyForm())

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) form.value = createEmptyForm()
  },
)

const expenseModalSubtitle = computed(() => {
  const label = form.value.label.trim()
  if (label) return label
  return 'Sortie de caisse — renseignez la catégorie et le montant ; la dépense sera soumise à validation'
})

const canSubmit = computed(() => {
  const amount = Number(form.value.amountFcfa)
  return Boolean(form.value.label.trim()) && Number.isFinite(amount) && amount > 0 && form.value.businessDate
})

const amountPreview = computed(() => {
  const amount = Number(form.value.amountFcfa)
  if (!Number.isFinite(amount) || amount <= 0) return null
  return formatFcfa(amount)
})

const selectedCategoryLabel = computed(
  () => ADMIN_EXPENSE_CATEGORY_OPTIONS.find((item) => item.value === form.value.category)?.label ?? '',
)

function submit() {
  if (!canSubmit.value) return
  emit('submit', {
    businessDate: form.value.businessDate,
    label: form.value.label.trim(),
    amountFcfa: Number(form.value.amountFcfa),
    category: form.value.category,
    comment: form.value.comment.trim() || undefined,
  })
}
</script>

<template>
  <UiFormModal
    v-if="open"
    title-id="admin-expense-modal-title"
    title="Nouvelle dépense"
    :subtitle="expenseModalSubtitle"
    :icon="Wallet"
    size="wide"
    @close="emit('close')"
  >
    <section class="form-panel">
      <h3 class="form-panel__title">
        <CalendarDays :size="15" />
        Informations
      </h3>
      <div class="form-grid-2">
        <UiInput
          v-model="form.businessDate"
          label="Date de la dépense"
          type="date"
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
      </div>
      <UiInput
        v-model="form.label"
        label="Description"
        placeholder="Ex. Achat produits d'entretien"
        required
      />
    </section>

    <section class="form-panel form-panel--accent">
      <h3 class="form-panel__title">
        <Tags :size="15" />
        Catégorie &amp; notes
      </h3>
      <p class="form-panel__intro">
        Choisissez la nature de la dépense pour le suivi comptable et les rapports.
      </p>

      <div class="category-picker" role="radiogroup" aria-label="Catégorie de dépense">
        <button
          v-for="option in ADMIN_EXPENSE_CATEGORY_OPTIONS"
          :key="option.value"
          type="button"
          class="category-picker__option"
          :class="{ 'category-picker__option--active': form.category === option.value }"
          @click="form.category = option.value"
        >
          <component :is="CATEGORY_ICONS[option.value]" :size="18" />
          <span class="category-picker__label">{{ option.label }}</span>
          <span class="category-picker__hint">{{ option.hint }}</span>
        </button>
      </div>

      <UiTextarea
        v-model="form.comment"
        label="Commentaire (optionnel)"
        placeholder="Justificatif, référence facture, détail complémentaire…"
      />

      <div v-if="amountPreview" class="expense-preview">
        <div class="expense-preview__row">
          <span>Catégorie</span>
          <strong>{{ selectedCategoryLabel }}</strong>
        </div>
        <div class="expense-preview__row expense-preview__row--amount">
          <span>Montant saisi</span>
          <strong>{{ amountPreview }}</strong>
        </div>
      </div>
    </section>

    <template #footer>
      <UiButton variant="ghost" @click="emit('close')">Annuler</UiButton>
      <UiButton variant="primary" :icon="Save" :disabled="saving || !canSubmit" @click="submit">
        {{ saving ? 'Enregistrement…' : 'Enregistrer la dépense' }}
      </UiButton>
    </template>
  </UiFormModal>
</template>

<style scoped>
.category-picker {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.65rem;
}

.category-picker__option {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.25rem;
  padding: 0.85rem 0.9rem;
  border: 2px solid var(--border);
  border-radius: 11px;
  background: var(--surface-muted, #f4f6ef);
  color: var(--text-muted);
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    box-shadow 0.15s ease,
    color 0.15s ease;
}

.category-picker__option:hover {
  border-color: rgba(107, 124, 62, 0.45);
  color: var(--primary-800);
}

.category-picker__option--active {
  border-color: var(--primary-500);
  background: #fff;
  color: var(--primary-800);
  box-shadow: 0 0 0 1px rgba(107, 124, 62, 0.15);
}

.category-picker__label {
  font-size: 0.875rem;
  font-weight: 800;
}

.category-picker__hint {
  font-size: 0.6875rem;
  font-weight: 600;
  line-height: 1.35;
  opacity: 0.9;
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

@media (max-width: 700px) {
  .category-picker {
    grid-template-columns: 1fr;
  }
}
</style>
