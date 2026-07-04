<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { Search, ChevronDown, ShoppingBag, X, Plus } from '@lucide/vue'
import UiInput from '@/components/ui/UiInput.vue'
import {
  EXAM_KIND_LABELS,
  HOSPITALISATION_PRESCRIPTION_LABEL,
  getCatalogForKind,
  groupExamsByCategory,
  loadExamCatalog,
  type ExamKindSlug,
} from '@/lib/exam-catalog'

const props = defineProps<{
  kind: ExamKindSlug
  modelValue: string[]
  hospitalisationDays?: number | null
  /** En mode ajout : masquer les examens déjà prescrits sur le dossier. */
  excludeLabels?: string[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string[]]
  'update:hospitalisationDays': [value: number | null]
}>()

const search = ref('')
const dropdownOpen = ref(false)
const rootRef = ref<HTMLElement | null>(null)
const catalogReady = ref(false)

const cart = computed({
  get: () => props.modelValue,
  set: (value: string[]) => emit('update:modelValue', value),
})

const kindLabel = computed(() => EXAM_KIND_LABELS[props.kind])

const catalog = computed(() => getCatalogForKind(props.kind))

const availableExams = computed(() =>
  catalog.value.filter(
    (exam) => !cart.value.includes(exam.label) && !props.excludeLabels?.includes(exam.label),
  ),
)

const filteredExams = computed(() => {
  const q = search.value.trim().toLowerCase()
  const pool = availableExams.value
  if (!q) return pool
  return pool.filter(
    (exam) =>
      exam.label.toLowerCase().includes(q) ||
      exam.category.toLowerCase().includes(q),
  )
})

const groupedFiltered = computed(() => groupExamsByCategory(filteredExams.value))

const hasResults = computed(() => groupedFiltered.value.size > 0)

function addExam(label: string) {
  if (cart.value.includes(label)) return
  cart.value = [...cart.value, label]
  search.value = ''
}

const isHospitalisationKind = computed(() => props.kind === 'hospitalisation')

const hospitalisationPrescribed = computed(() =>
  cart.value.includes(HOSPITALISATION_PRESCRIPTION_LABEL),
)

const hospitalisationDays = computed(() => props.hospitalisationDays)

function removeExam(label: string) {
  cart.value = cart.value.filter((item) => item !== label)
}

function toggleHospitalisation() {
  if (hospitalisationPrescribed.value) {
    cart.value = []
    emit('update:hospitalisationDays', null)
  } else {
    cart.value = [HOSPITALISATION_PRESCRIPTION_LABEL]
    if (props.hospitalisationDays == null || props.hospitalisationDays < 1) {
      emit('update:hospitalisationDays', 1)
    }
  }
}

function onHospitalisationDaysInput(value: string | number) {
  const parsed = Number.parseInt(String(value), 10)
  emit('update:hospitalisationDays', Number.isFinite(parsed) && parsed >= 1 ? parsed : null)
}

function toggleDropdown() {
  dropdownOpen.value = !dropdownOpen.value
  if (dropdownOpen.value) search.value = ''
}

function onClickOutside(event: MouseEvent) {
  if (!rootRef.value?.contains(event.target as Node)) {
    dropdownOpen.value = false
  }
}

onMounted(async () => {
  document.addEventListener('click', onClickOutside)
  await loadExamCatalog()
  catalogReady.value = true
})

onUnmounted(() => document.removeEventListener('click', onClickOutside))
</script>

<template>
  <div ref="rootRef" class="exam-picker">
    <template v-if="isHospitalisationKind">
      <label class="exam-picker__label">Orientation hospitalisation</label>
      <p class="exam-picker__hosp-hint">
        Le médecin oriente le patient vers l'hospitalisation. Le choix de la salle, la
        disponibilité des salles et le paiement se font à la réception.
      </p>
      <button
        type="button"
        class="exam-picker__hosp-toggle"
        :class="{ 'exam-picker__hosp-toggle--active': hospitalisationPrescribed }"
        :disabled="!catalogReady"
        @click="toggleHospitalisation"
      >
        {{ hospitalisationPrescribed ? 'Hospitalisation prescrite' : 'Prescrire une hospitalisation' }}
      </button>
      <div v-if="hospitalisationPrescribed" class="exam-picker__cart exam-picker__cart--inline">
        <div class="exam-picker__cart-head">
          <ShoppingBag :size="16" />
          <span>Hospitalisation</span>
          <strong>1</strong>
        </div>
        <ul class="exam-picker__cart-list">
          <li class="exam-picker__cart-item">
            <span class="exam-picker__cart-num">1</span>
            <span class="exam-picker__cart-label">{{ HOSPITALISATION_PRESCRIPTION_LABEL }}</span>
            <button
              type="button"
              class="exam-picker__cart-remove"
              aria-label="Retirer"
              @click="toggleHospitalisation"
            >
              <X :size="14" />
            </button>
          </li>
        </ul>
      </div>
      <UiInput
        v-if="hospitalisationPrescribed"
        :model-value="hospitalisationDays ?? 1"
        label="Nombre de jours d'hospitalisation"
        type="number"
        min="1"
        max="365"
        required
        @update:model-value="onHospitalisationDaysInput"
      />
    </template>

    <template v-else>
    <label class="exam-picker__label">Ajouter — {{ kindLabel }}</label>

    <div class="exam-picker__search-wrap">
      <button
        type="button"
        class="exam-picker__trigger"
        :class="{ 'exam-picker__trigger--open': dropdownOpen }"
        aria-haspopup="listbox"
        :aria-expanded="dropdownOpen"
        @click.stop="toggleDropdown"
      >
        <Search :size="16" class="exam-picker__search-icon" />
        <input
          v-model="search"
          type="search"
          class="exam-picker__search-input"
          :placeholder="`Rechercher un examen ${kindLabel.toLowerCase()}…`"
          @focus="dropdownOpen = true"
          @click.stop
          @keydown.escape="dropdownOpen = false"
        />
        <ChevronDown :size="16" class="exam-picker__chevron" :class="{ 'exam-picker__chevron--open': dropdownOpen }" />
      </button>

      <div v-if="dropdownOpen" class="exam-picker__dropdown" role="listbox">
        <p v-if="!catalogReady" class="exam-picker__empty">Chargement du catalogue…</p>
        <template v-else-if="hasResults">
          <div
            v-for="[category, exams] in groupedFiltered"
            :key="category"
            class="exam-picker__group"
          >
            <div class="exam-picker__group-label">{{ category }}</div>
            <button
              v-for="exam in exams"
              :key="exam.id"
              type="button"
              class="exam-picker__option"
              role="option"
              @click="addExam(exam.label)"
            >
              <span>{{ exam.label }}</span>
              <Plus :size="15" />
            </button>
          </div>
        </template>
        <p v-else class="exam-picker__empty">
          {{ availableExams.length === 0 ? 'Tous les examens sont déjà sélectionnés.' : 'Aucun examen trouvé.' }}
        </p>
      </div>
    </div>

    <div v-if="cart.length" class="exam-picker__cart exam-picker__cart--inline">
      <div class="exam-picker__cart-head">
        <ShoppingBag :size="16" />
        <span>{{ kindLabel }}</span>
        <strong>{{ cart.length }}</strong>
      </div>
      <ul class="exam-picker__cart-list">
        <li v-for="(exam, index) in cart" :key="exam" class="exam-picker__cart-item">
          <span class="exam-picker__cart-num">{{ index + 1 }}</span>
          <span class="exam-picker__cart-label">{{ exam }}</span>
          <button
            type="button"
            class="exam-picker__cart-remove"
            aria-label="Retirer"
            @click="removeExam(exam)"
          >
            <X :size="14" />
          </button>
        </li>
      </ul>
    </div>
    </template>
  </div>
</template>

<style scoped>
.exam-picker {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.exam-picker__label {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-muted);
}

.exam-picker__search-wrap {
  position: relative;
}

.exam-picker__trigger {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.55rem 0.75rem;
  border: 1.5px solid var(--border);
  border-radius: var(--radius-sm);
  background: #fff;
  cursor: text;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.exam-picker__trigger--open,
.exam-picker__trigger:focus-within {
  border-color: var(--primary-400);
  box-shadow: 0 0 0 3px var(--focus-ring-sm);
}

.exam-picker__search-icon {
  color: var(--text-light);
  flex-shrink: 0;
}

.exam-picker__search-input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  font-family: var(--font);
  font-size: 0.875rem;
  color: var(--text);
  outline: none;
}

.exam-picker__search-input::placeholder {
  color: var(--text-light);
}

.exam-picker__chevron {
  color: var(--text-light);
  flex-shrink: 0;
  transition: transform 0.2s;
}

.exam-picker__chevron--open {
  transform: rotate(180deg);
}

.exam-picker__dropdown {
  position: absolute;
  top: calc(100% + 0.35rem);
  left: 0;
  right: 0;
  z-index: 20;
  max-height: 14rem;
  overflow-y: auto;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-md);
  padding: 0.35rem;
}

.exam-picker__group + .exam-picker__group {
  margin-top: 0.35rem;
  padding-top: 0.35rem;
  border-top: 1px solid var(--border);
}

.exam-picker__group-label {
  padding: 0.35rem 0.5rem 0.25rem;
  font-size: 0.625rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-light);
}

.exam-picker__option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  width: 100%;
  padding: 0.55rem 0.6rem;
  border: 0;
  border-radius: 8px;
  background: transparent;
  font-family: var(--font);
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--text);
  text-align: left;
  cursor: pointer;
  transition: background 0.12s;
}

.exam-picker__option:hover {
  background: var(--primary-50);
  color: var(--primary-800);
}

.exam-picker__option svg {
  color: var(--primary-600);
  flex-shrink: 0;
  opacity: 0.7;
}

.exam-picker__empty {
  margin: 0;
  padding: 1rem 0.75rem;
  font-size: 0.8125rem;
  color: var(--text-muted);
  text-align: center;
}

.exam-picker__cart--inline {
  border: 1px solid var(--primary-100);
  border-radius: var(--radius-sm);
  background: #fff;
  padding: 0.65rem 0.75rem;
}

.exam-picker__cart-head {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  margin-bottom: 0.55rem;
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--primary-800);
}

.exam-picker__cart-head strong {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.5rem;
  height: 1.5rem;
  padding: 0 0.4rem;
  border-radius: 999px;
  background: var(--primary-600);
  color: #fff;
  font-size: 0.75rem;
}

.exam-picker__cart-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  max-height: 8rem;
  overflow-y: auto;
}

.exam-picker__cart-item {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.45rem 0.5rem;
  background: var(--primary-50);
  border: 1px solid var(--primary-100);
  border-radius: 8px;
}

.exam-picker__cart-num {
  width: 1.35rem;
  height: 1.35rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  background: var(--primary-100);
  color: var(--primary-800);
  font-size: 0.6875rem;
  font-weight: 700;
  flex-shrink: 0;
}

.exam-picker__cart-label {
  flex: 1;
  min-width: 0;
  font-size: 0.8125rem;
  font-weight: 500;
  line-height: 1.3;
}

.exam-picker__cart-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.65rem;
  height: 1.65rem;
  border: 0;
  border-radius: 6px;
  background: #fee2e2;
  color: var(--danger);
  cursor: pointer;
  flex-shrink: 0;
}

.exam-picker__hosp-hint {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--text-muted);
  line-height: 1.45;
}

.exam-picker__hosp-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  padding: 0.7rem 1rem;
  border: 1.5px solid var(--primary-200);
  border-radius: var(--radius-sm);
  background: #fff;
  color: var(--primary-800);
  font-family: inherit;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}

.exam-picker__hosp-toggle:hover:not(:disabled) {
  background: var(--primary-50);
}

.exam-picker__hosp-toggle--active {
  background: var(--primary-600);
  border-color: var(--primary-600);
  color: #fff;
}

.exam-picker__hosp-toggle:disabled {
  opacity: 0.6;
  cursor: wait;
}
</style>
