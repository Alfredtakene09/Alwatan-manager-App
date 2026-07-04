<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  Wallet,
  CalendarDays,
  Tags,
  Save,
  User,
  FileText,
  Paperclip,
  X,
  CheckCircle2,
} from '@lucide/vue'
import { formatFcfa } from '@/lib/roles'
import { expenseCategoryIconComponent } from '@/lib/expense-category-icons'
import UiFormModal from '@/components/ui/UiFormModal.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiTextarea from '@/components/ui/UiTextarea.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'

export type ExpenseCategoryOption = {
  id: string
  name: string
  icon?: string | null
  color?: string | null
  archived?: boolean
}

export type GestionnaireExpenseFormPayload = {
  businessDate: string
  label: string
  amountFcfa: number
  expenseCategoryId?: string
  beneficiary?: string
  comment?: string
  receipt?: File | null
}

export type GestionnaireExpenseEdit = {
  id: string
  businessDate: string
  label: string
  amountFcfa: number
  expenseCategoryId?: string | null
  beneficiary?: string | null
  comment?: string | null
}

const props = defineProps<{
  open: boolean
  saving?: boolean
  categories: ExpenseCategoryOption[]
  editing?: GestionnaireExpenseEdit | null
  errorMessage?: string
}>()

const emit = defineEmits<{
  close: []
  submit: [payload: GestionnaireExpenseFormPayload]
}>()

const fileInputRef = ref<HTMLInputElement | null>(null)
const localError = ref('')

function emptyForm() {
  const firstCategory = props.categories.find((c) => !c.archived)?.id ?? ''
  return {
    businessDate: new Date().toISOString().slice(0, 10),
    label: '',
    amountFcfa: '',
    expenseCategoryId: firstCategory,
    beneficiary: '',
    comment: '',
    receipt: null as File | null,
  }
}

const form = ref(emptyForm())

watch(
  () => [props.open, props.categories, props.editing] as const,
  ([isOpen, , editing]) => {
    if (isOpen) {
      if (editing) {
        form.value = {
          businessDate: editing.businessDate,
          label: editing.label,
          amountFcfa: String(editing.amountFcfa),
          expenseCategoryId: editing.expenseCategoryId ?? props.categories.find((c) => !c.archived)?.id ?? '',
          beneficiary: editing.beneficiary ?? '',
          comment: editing.comment ?? '',
          receipt: null,
        }
      } else {
        form.value = emptyForm()
      }
      localError.value = ''
    }
  },
  { immediate: true },
)

const isEditing = computed(() => Boolean(props.editing?.id))

const activeCategories = computed(() => props.categories.filter((c) => !c.archived))

const modalSubtitle = computed(() => {
  const label = form.value.label.trim()
  if (label) return label
  return 'Comptabilisée dès l\'enregistrement — justificatif optionnel'
})

const amountPreview = computed(() => {
  const amount = Number(form.value.amountFcfa)
  if (!Number.isFinite(amount) || amount <= 0) return null
  return formatFcfa(amount)
})

const selectedCategory = computed(
  () => activeCategories.value.find((c) => c.id === form.value.expenseCategoryId) ?? null,
)

const canSubmit = computed(() => {
  const amount = Number(form.value.amountFcfa)
  return Boolean(form.value.label.trim()) && Number.isFinite(amount) && amount > 0 && form.value.businessDate
})

const alertMessage = computed(() => props.errorMessage || localError.value)

function openFilePicker() {
  fileInputRef.value?.click()
}

function onReceiptChange(event: Event) {
  const input = event.target as HTMLInputElement
  form.value.receipt = input.files?.[0] ?? null
}

function clearReceipt() {
  form.value.receipt = null
  if (fileInputRef.value) fileInputRef.value.value = ''
}

function submit() {
  if (!canSubmit.value) {
    if (!form.value.label.trim()) {
      localError.value = 'La description est obligatoire.'
    } else if (!Number.isFinite(Number(form.value.amountFcfa)) || Number(form.value.amountFcfa) <= 0) {
      localError.value = 'Le montant doit être supérieur à zéro.'
    } else {
      localError.value = 'Vérifiez la date et les champs obligatoires.'
    }
    return
  }
  localError.value = ''
  emit('submit', {
    businessDate: form.value.businessDate,
    label: form.value.label.trim(),
    amountFcfa: Number(form.value.amountFcfa),
    expenseCategoryId: form.value.expenseCategoryId || undefined,
    beneficiary: form.value.beneficiary.trim() || undefined,
    comment: form.value.comment.trim() || undefined,
    receipt: form.value.receipt,
  })
}
</script>

<template>
  <UiFormModal
    v-if="open"
    title-id="gestionnaire-expense-modal-title"
    :title="isEditing ? 'Modifier la dépense' : 'Nouvelle dépense'"
    :subtitle="modalSubtitle"
    :icon="Wallet"
    size="wide"
    @close="emit('close')"
  >
    <div class="gestionnaire-modal-hero">
      <div>
        <p class="gestionnaire-modal-hero__eyebrow">Sortie de caisse</p>
        <p class="gestionnaire-modal-hero__amount">{{ amountPreview ?? '—' }}</p>
        <p v-if="selectedCategory" class="gestionnaire-modal-hero__meta">
          {{ selectedCategory.name }}
        </p>
      </div>
      <span class="gestionnaire-modal-hero__badge">
        <CheckCircle2 :size="12" />
        {{ isEditing ? 'Mise à jour' : 'Enregistrement immédiat' }}
      </span>
    </div>

    <UiAlert v-if="alertMessage" type="error" :message="alertMessage" />

    <section class="form-panel gestionnaire-form-panel">
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
          placeholder="Ex. 25 000"
          required
        />
      </div>
      <UiInput
        v-model="form.label"
        label="Description"
        placeholder="Ex. Achat produits d'entretien, carburant…"
        required
      />
    </section>

    <section
      v-if="activeCategories.length"
      class="form-panel gestionnaire-form-panel gestionnaire-form-panel--accent"
    >
      <h3 class="form-panel__title">
        <Tags :size="15" />
        Catégorie
      </h3>
      <p class="form-panel__intro">Classement pour le suivi comptable et les rapports.</p>

      <div class="gestionnaire-chips" role="radiogroup" aria-label="Catégorie de dépense">
        <button
          v-for="category in activeCategories"
          :key="category.id"
          type="button"
          class="gestionnaire-chips__item"
          :class="{ 'gestionnaire-chips__item--active': form.expenseCategoryId === category.id }"
          :style="
            form.expenseCategoryId === category.id
              ? { borderColor: category.color ?? '#d97706', background: `${category.color ?? '#d97706'}14` }
              : undefined
          "
          @click="form.expenseCategoryId = category.id"
        >
          <component
            :is="expenseCategoryIconComponent(category.icon)"
            :size="16"
            :style="{ color: category.color ?? '#92400e' }"
          />
          {{ category.name }}
        </button>
      </div>
    </section>

    <section class="form-panel gestionnaire-form-panel">
      <h3 class="form-panel__title">
        <FileText :size="15" />
        Compléments
      </h3>

      <UiInput
        v-model="form.beneficiary"
        label="Bénéficiaire (optionnel)"
        placeholder="Fournisseur, prestataire, employé…"
        :icon="User"
      />

      <UiTextarea
        v-model="form.comment"
        label="Commentaire (optionnel)"
        placeholder="Référence facture, détail du paiement…"
      />

      <div class="receipt-zone">
        <p class="receipt-zone__label">Justificatif (optionnel)</p>
        <p class="receipt-zone__hint">PDF ou image — facture, reçu, bon de caisse</p>

        <div
          v-if="!form.receipt"
          class="receipt-drop"
          role="button"
          tabindex="0"
          @click="openFilePicker"
          @keydown.enter.prevent="openFilePicker"
        >
          <Paperclip :size="22" />
          <span>Cliquez pour joindre un fichier</span>
        </div>

        <div v-else class="receipt-file">
          <Paperclip :size="18" />
          <span class="receipt-file__name">{{ form.receipt.name }}</span>
          <button type="button" class="receipt-file__remove" aria-label="Retirer le fichier" @click="clearReceipt">
            <X :size="16" />
          </button>
        </div>

        <input
          ref="fileInputRef"
          type="file"
          class="receipt-input"
          accept=".pdf,image/*"
          @change="onReceiptChange"
        />
      </div>

      <div v-if="amountPreview && selectedCategory" class="gestionnaire-preview-box">
        <div class="gestionnaire-preview-box__row">
          <span>Catégorie</span>
          <strong>{{ selectedCategory.name }}</strong>
        </div>
        <div class="gestionnaire-preview-box__row gestionnaire-preview-box__row--amount">
          <span>Montant</span>
          <strong>{{ amountPreview }}</strong>
        </div>
      </div>
    </section>

    <template #footer>
      <UiButton variant="ghost" @click="emit('close')">Annuler</UiButton>
      <UiButton variant="primary" :icon="Save" :disabled="saving || !canSubmit" @click="submit">
        {{ saving ? 'Enregistrement…' : isEditing ? 'Mettre à jour' : 'Enregistrer la dépense' }}
      </UiButton>
    </template>
  </UiFormModal>
</template>

<style scoped>
.receipt-zone__label {
  margin: 0 0 0.15rem;
  font-size: 0.8125rem;
  font-weight: 700;
  color: #44403c;
}

.receipt-zone__hint {
  margin: 0 0 0.5rem;
  font-size: 0.75rem;
  color: #78716c;
}

.receipt-drop {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.45rem;
  padding: 1.1rem 1rem;
  border: 2px dashed rgba(217, 119, 6, 0.28);
  border-radius: 12px;
  background: #fffbeb;
  color: #92400e;
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.receipt-drop:hover {
  border-color: rgba(217, 119, 6, 0.5);
  background: #fef3c7;
}

.receipt-file {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.65rem 0.75rem;
  border-radius: 10px;
  border: 1px solid rgba(217, 119, 6, 0.22);
  background: #fff;
  color: #78350f;
}

.receipt-file__name {
  flex: 1;
  min-width: 0;
  font-size: 0.8125rem;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.receipt-file__remove {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.75rem;
  height: 1.75rem;
  border: none;
  border-radius: 8px;
  background: #fef2f2;
  color: #b91c1c;
  cursor: pointer;
}

.receipt-input {
  position: absolute;
  width: 0;
  height: 0;
  opacity: 0;
  pointer-events: none;
}
</style>
