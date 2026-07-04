<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Tags, Save, Palette } from '@lucide/vue'
import UiFormModal from '@/components/ui/UiFormModal.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import { EXPENSE_CATEGORY_COLOR_PRESETS } from '@/lib/expense-category-icons'

export type ExpenseCategoryFormPayload = {
  name: string
  icon: string
  color: string
}

export type ExpenseCategoryEdit = {
  id: string
  name: string
  icon: string
  color: string
  sortOrder: number
}

const props = defineProps<{
  open: boolean
  saving?: boolean
  category?: ExpenseCategoryEdit | null
  errorMessage?: string
}>()

const emit = defineEmits<{
  close: []
  submit: [payload: ExpenseCategoryFormPayload]
}>()

function emptyForm() {
  return {
    name: '',
    color: '#d97706',
  }
}

const form = ref(emptyForm())
const localError = ref('')

watch(
  () => [props.open, props.category] as const,
  ([isOpen, category]) => {
    if (!isOpen) return
    localError.value = ''
    if (category) {
      form.value = {
        name: category.name,
        color: category.color || '#d97706',
      }
    } else {
      form.value = emptyForm()
    }
  },
  { immediate: true },
)

const isEditing = computed(() => Boolean(props.category?.id))

const modalSubtitle = computed(() => {
  const name = form.value.name.trim()
  if (name) return name
  return 'Libellé et couleur pour le classement comptable'
})

const canSubmit = computed(() => form.value.name.trim().length >= 2)

const alertMessage = computed(() => props.errorMessage || localError.value)

function submit() {
  if (!canSubmit.value) {
    localError.value = 'Le nom doit contenir au moins 2 caractères.'
    return
  }
  localError.value = ''
  emit('submit', {
    name: form.value.name.trim(),
    icon: props.category?.icon?.trim() || 'receipt',
    color: form.value.color.trim() || '#64748b',
  })
}
</script>

<template>
  <UiFormModal
    v-if="open"
    title-id="gestionnaire-expense-category-modal-title"
    :title="isEditing ? 'Modifier la catégorie' : 'Nouvelle catégorie'"
    :subtitle="modalSubtitle"
    :icon="Tags"
    size="wide"
    @close="emit('close')"
  >
    <div class="gestionnaire-modal-hero gestionnaire-modal-hero--center">
      <div class="category-hero__swatch" :style="{ background: form.color }" />
      <div class="category-hero__content">
        <p class="gestionnaire-modal-hero__eyebrow">
          {{ isEditing ? 'Mise à jour catégorie' : 'Nouvelle catégorie' }}
        </p>
        <strong class="gestionnaire-modal-hero__title">
          {{ form.name.trim() || 'Nom à renseigner' }}
        </strong>
      </div>
    </div>

    <UiAlert v-if="alertMessage" type="error" :message="alertMessage" />

    <section class="form-panel gestionnaire-form-panel">
      <h3 class="form-panel__title">
        <Tags :size="15" />
        Libellé
      </h3>
      <UiInput
        v-model="form.name"
        label="Nom de la catégorie"
        required
        placeholder="Ex. Fournitures, Carburant…"
      />
    </section>

    <section class="form-panel gestionnaire-form-panel gestionnaire-form-panel--accent">
      <h3 class="form-panel__title">
        <Palette :size="15" />
        Couleur
      </h3>
      <p class="form-panel__intro">Couleur affichée dans les listes et formulaires de dépenses.</p>

      <div class="gestionnaire-color-presets" role="radiogroup" aria-label="Couleur de catégorie">
        <button
          v-for="color in EXPENSE_CATEGORY_COLOR_PRESETS"
          :key="color"
          type="button"
          class="gestionnaire-color-presets__swatch"
          :class="{ 'gestionnaire-color-presets__swatch--active': form.color === color }"
          :style="{ background: color }"
          :title="color"
          @click="form.color = color"
        />
      </div>
      <UiInput v-model="form.color" label="Couleur personnalisée (hex)" placeholder="#d97706" />
    </section>

    <template #footer>
      <UiButton variant="ghost" @click="emit('close')">Annuler</UiButton>
      <UiButton variant="primary" :icon="Save" :disabled="saving || !canSubmit" @click="submit">
        {{ saving ? 'Enregistrement…' : isEditing ? 'Mettre à jour' : 'Créer la catégorie' }}
      </UiButton>
    </template>
  </UiFormModal>
</template>

<style scoped>
.category-hero__swatch {
  width: 3.5rem;
  height: 3.5rem;
  flex-shrink: 0;
  border-radius: 14px;
  border: 2px solid rgba(15, 23, 42, 0.08);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.35);
}

.category-hero__content {
  min-width: 0;
  flex: 1;
}
</style>
