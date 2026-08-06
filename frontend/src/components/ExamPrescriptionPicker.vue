<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { Search, ChevronDown, ShoppingBag, X, Plus, Check } from '@lucide/vue'
import UiInput from '@/components/ui/UiInput.vue'
import {
  EXAM_KIND_LABELS,
  HOSPITALISATION_PRESCRIPTION_LABEL,
  examCatalogInvalidateEventName,
  getCatalogForKind,
  getSpecialtyServiceName,
  groupExamsByCategory,
  loadExamCatalog,
  type ExamKindSlug,
} from '@/lib/exam-catalog'
import { useAppI18n } from '@/i18n/useAppI18n'
import { translateTemplate } from '@/lib/dashboard-i18n'

const props = defineProps<{
  kind: ExamKindSlug
  modelValue: string[]
  hospitalisationDays?: number | null
  /** En mode ajout : masquer les examens déjà prescrits sur le dossier. */
  excludeLabels?: string[]
  /** Filtre le catalogue selon le médecin (service + Laboratoire/Hospitalisation). */
  doctorId?: string | null
  serviceId?: string | null
  /** Filtre les examens de spécialité sur un service clinique précis. */
  clinicServiceId?: string | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string[]]
  'update:hospitalisationDays': [value: number | null]
}>()

const { uiText, localeCode } = useAppI18n()

const search = ref('')
const dropdownOpen = ref(false)
const rootRef = ref<HTMLElement | null>(null)
const catalogReady = ref(false)
const catalogEpoch = ref(0)
const catalogItems = ref(
  getCatalogForKind(props.kind, props.doctorId, props.serviceId, props.clinicServiceId),
)

const cart = computed({
  get: () => props.modelValue,
  set: (value: string[]) => emit('update:modelValue', value),
})

const kindLabel = computed(() => {
  void localeCode.value
  void catalogEpoch.value
  if (props.clinicServiceId) {
    const match = catalogItems.value.find((exam) => exam.clinicServiceId === props.clinicServiceId)
    if (match?.clinicServiceName) return uiText(match.clinicServiceName)
  }
  if (props.kind === 'specialty') {
    const serviceName = getSpecialtyServiceName(props.doctorId, props.serviceId)
    if (serviceName) return uiText(serviceName)
  }
  return uiText(EXAM_KIND_LABELS[props.kind])
})

const addKindLabel = computed(() => {
  void localeCode.value
  return translateTemplate('Ajouter — {kind}', { kind: kindLabel.value })
})

/** Laboratoire : grille visible (sélection / désélection au clic). */
const useChipGrid = computed(() => props.kind === 'examen')

const searchPlaceholder = computed(() => {
  void localeCode.value
  if (useChipGrid.value) {
    const count = selectableExams.value.length
    return count > 0
      ? translateTemplate('Filtrer {count} examens…', { count: String(count) })
      : uiText('Filtrer les examens…')
  }
  const count = availableExams.value.length
  if (props.kind === 'examen' && count > 0) {
    return translateTemplate('Rechercher parmi {count} examens…', {
      count: String(count),
    })
  }
  return translateTemplate('Rechercher un examen {kind}…', {
    kind: kindLabel.value.toLowerCase(),
  })
})

const catalog = computed(() => {
  void catalogEpoch.value
  return catalogItems.value
})

const selectableExams = computed(() =>
  catalog.value.filter((exam) => !props.excludeLabels?.includes(exam.label)),
)

const availableExams = computed(() =>
  selectableExams.value.filter((exam) => !cart.value.includes(exam.label)),
)

async function refreshCatalog(force = true) {
  catalogReady.value = false
  await loadExamCatalog({
    doctorId: props.doctorId,
    serviceId: props.serviceId,
    force,
  })
  catalogItems.value = getCatalogForKind(
    props.kind,
    props.doctorId,
    props.serviceId,
    props.clinicServiceId,
  )
  catalogEpoch.value += 1
  catalogReady.value = true
}

watch(
  () => [props.doctorId, props.serviceId, props.clinicServiceId, props.kind] as const,
  () => {
    void refreshCatalog()
  },
)

function examMatchesQuery(exam: { label: string; category: string }, q: string) {
  if (!q) return true
  const labelFr = exam.label.toLowerCase()
  const labelLocal = uiText(exam.label).toLowerCase()
  const categoryFr = exam.category.toLowerCase()
  const categoryLocal = uiText(exam.category).toLowerCase()
  return (
    labelFr.includes(q) ||
    labelLocal.includes(q) ||
    categoryFr.includes(q) ||
    categoryLocal.includes(q)
  )
}

const filteredExams = computed(() => {
  void localeCode.value
  const q = search.value.trim().toLowerCase()
  return availableExams.value.filter((exam) => examMatchesQuery(exam, q))
})

/** Grille labo : tous les examens avec formulaire (y compris déjà cochés). */
const filteredSelectableExams = computed(() => {
  void localeCode.value
  const q = search.value.trim().toLowerCase()
  return selectableExams.value.filter((exam) => examMatchesQuery(exam, q))
})

const groupedFiltered = computed(() => groupExamsByCategory(filteredExams.value))

const groupedSelectable = computed(() => groupExamsByCategory(filteredSelectableExams.value))

/** Numérotation globale 1…N dans la liste déroulante. */
const numberedGroupedFiltered = computed(() => {
  let index = 0
  const rows: Array<{
    category: string
    exams: Array<{ id: string; label: string; number: number }>
  }> = []
  for (const [category, exams] of groupedFiltered.value) {
    rows.push({
      category,
      exams: exams.map((exam) => {
        index += 1
        return { id: exam.id, label: exam.label, number: index }
      }),
    })
  }
  return rows
})

const chipGroups = computed(() => {
  let index = 0
  const rows: Array<{
    category: string
    exams: Array<{ id: string; label: string; number: number; selected: boolean }>
  }> = []
  for (const [category, exams] of groupedSelectable.value) {
    rows.push({
      category,
      exams: exams.map((exam) => {
        index += 1
        return {
          id: exam.id,
          label: exam.label,
          number: index,
          selected: cart.value.includes(exam.label),
        }
      }),
    })
  }
  return rows
})

const hasResults = computed(() => numberedGroupedFiltered.value.length > 0)

const hasChipResults = computed(() => chipGroups.value.length > 0)

const selectedCountLabel = computed(() => {
  void localeCode.value
  const n = cart.value.length
  if (n === 0) return uiText('Aucun examen sélectionné')
  if (n === 1) return uiText('1 examen sélectionné')
  return translateTemplate('{n} examens sélectionnés', { n: String(n) })
})

function addExam(label: string) {
  if (cart.value.includes(label)) return
  cart.value = [...cart.value, label]
  if (!useChipGrid.value) search.value = ''
}

function toggleExam(label: string) {
  if (cart.value.includes(label)) {
    removeExam(label)
  } else {
    addExam(label)
  }
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

async function toggleDropdown() {
  dropdownOpen.value = !dropdownOpen.value
  if (dropdownOpen.value) {
    search.value = ''
    // Rouvrir = catalogue à jour (formulaires labo récemment créés inclus).
    if (props.kind === 'examen') await refreshCatalog(true)
  }
}

async function onSearchFocus() {
  dropdownOpen.value = true
  if (props.kind === 'examen') await refreshCatalog(true)
}

function onClickOutside(event: MouseEvent) {
  if (!rootRef.value?.contains(event.target as Node)) {
    dropdownOpen.value = false
  }
}

onMounted(async () => {
  document.addEventListener('click', onClickOutside)
  window.addEventListener(examCatalogInvalidateEventName(), onCatalogInvalidate)
  await refreshCatalog()
})

onUnmounted(() => {
  document.removeEventListener('click', onClickOutside)
  window.removeEventListener(examCatalogInvalidateEventName(), onCatalogInvalidate)
})

function onCatalogInvalidate() {
  void refreshCatalog(true)
}
</script>

<template>
  <div ref="rootRef" class="exam-picker">
    <template v-if="isHospitalisationKind">
      <label class="exam-picker__label">{{ uiText('Orientation hospitalisation') }}</label>
      <p class="exam-picker__hosp-hint">
        {{
          uiText(
            "Le médecin oriente le patient vers l'hospitalisation. Le choix de la salle, la disponibilité des salles et le paiement se font à la réception.",
          )
        }}
      </p>
      <button
        type="button"
        class="exam-picker__hosp-toggle"
        :class="{ 'exam-picker__hosp-toggle--active': hospitalisationPrescribed }"
        :disabled="!catalogReady"
        @click="toggleHospitalisation"
      >
        {{
          hospitalisationPrescribed
            ? uiText('Hospitalisation prescrite')
            : uiText('Prescrire une hospitalisation')
        }}
      </button>
      <div v-if="hospitalisationPrescribed" class="exam-picker__cart exam-picker__cart--inline">
        <div class="exam-picker__cart-head">
          <ShoppingBag :size="16" />
          <span>{{ uiText('Hospitalisation') }}</span>
          <strong>1</strong>
        </div>
        <ul class="exam-picker__cart-list">
          <li class="exam-picker__cart-item">
            <span class="exam-picker__cart-num">1</span>
            <span class="exam-picker__cart-label">{{ uiText(HOSPITALISATION_PRESCRIPTION_LABEL) }}</span>
            <button
              type="button"
              class="exam-picker__cart-remove"
              :aria-label="uiText('Retirer')"
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

    <template v-else-if="useChipGrid">
      <div class="exam-picker__chip-toolbar">
        <label class="exam-picker__label">{{ uiText('Examens laboratoire') }}</label>
        <span class="exam-picker__chip-count" :class="{ 'exam-picker__chip-count--active': cart.length }">
          {{ selectedCountLabel }}
        </span>
      </div>
      <p class="exam-picker__chip-hint">
        {{ uiText('Cliquez pour sélectionner ou désélectionner.') }}
      </p>

      <div class="exam-picker__search-wrap exam-picker__search-wrap--static">
        <div class="exam-picker__trigger">
          <Search :size="16" class="exam-picker__search-icon" />
          <input
            v-model="search"
            type="search"
            class="exam-picker__search-input"
            :placeholder="searchPlaceholder"
          />
        </div>
      </div>

      <p v-if="!catalogReady" class="exam-picker__empty">{{ uiText('Chargement du catalogue…') }}</p>
      <div v-else-if="hasChipResults" class="exam-picker__chip-board" role="listbox" aria-multiselectable="true">
        <section
          v-for="group in chipGroups"
          :key="group.category"
          class="exam-picker__chip-group"
        >
          <h4 class="exam-picker__chip-group-label">{{ uiText(group.category) }}</h4>
          <div class="exam-picker__chip-grid">
            <button
              v-for="exam in group.exams"
              :key="exam.id"
              type="button"
              role="option"
              class="exam-picker__chip"
              :class="{ 'exam-picker__chip--selected': exam.selected }"
              :aria-selected="exam.selected"
              @click="toggleExam(exam.label)"
            >
              <span class="exam-picker__chip-check" aria-hidden="true">
                <Check v-if="exam.selected" :size="14" />
              </span>
              <span class="exam-picker__chip-label">{{ uiText(exam.label) }}</span>
            </button>
          </div>
        </section>
      </div>
      <p v-else class="exam-picker__empty">
        {{
          selectableExams.length === 0
            ? uiText('Aucun examen laboratoire disponible.')
            : uiText('Aucun examen trouvé.')
        }}
      </p>
    </template>

    <template v-else>
    <label class="exam-picker__label">{{ addKindLabel }}</label>

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
          :placeholder="searchPlaceholder"
          @focus="onSearchFocus"
          @click.stop
          @keydown.escape="dropdownOpen = false"
        />
        <ChevronDown :size="16" class="exam-picker__chevron" :class="{ 'exam-picker__chevron--open': dropdownOpen }" />
      </button>

      <div v-if="dropdownOpen" class="exam-picker__dropdown" role="listbox">
        <p v-if="!catalogReady" class="exam-picker__empty">{{ uiText('Chargement du catalogue…') }}</p>
        <template v-else-if="hasResults">
          <div
            v-for="group in numberedGroupedFiltered"
            :key="group.category"
            class="exam-picker__group"
          >
            <div class="exam-picker__group-label">{{ uiText(group.category) }}</div>
            <button
              v-for="exam in group.exams"
              :key="exam.id"
              type="button"
              class="exam-picker__option"
              role="option"
              @click="addExam(exam.label)"
            >
              <span class="exam-picker__option-main">
                <span class="exam-picker__option-num">{{ exam.number }}</span>
                <span class="exam-picker__option-label">{{ uiText(exam.label) }}</span>
              </span>
              <Plus :size="15" />
            </button>
          </div>
        </template>
        <p v-else class="exam-picker__empty">
          {{
            availableExams.length === 0
              ? uiText('Tous les examens sont déjà sélectionnés.')
              : uiText('Aucun examen trouvé.')
          }}
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
          <span class="exam-picker__cart-label">{{ uiText(exam) }}</span>
          <button
            type="button"
            class="exam-picker__cart-remove"
            :aria-label="uiText('Retirer')"
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
  max-height: min(28rem, 60vh);
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

.exam-picker__option-main {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  min-width: 0;
}

.exam-picker__option-num {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.55rem;
  height: 1.55rem;
  padding: 0 0.3rem;
  border-radius: 6px;
  background: var(--primary-50, #eff6ff);
  color: var(--primary-700, #1d4ed8);
  font-size: 0.6875rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.exam-picker__option-label {
  min-width: 0;
  overflow-wrap: anywhere;
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
  background: var(--brand-red-50, #fdecea);
  border: 1px solid var(--brand-red-100, #f9c7c5);
  border-radius: 8px;
}

.exam-picker__cart-num {
  width: 1.35rem;
  height: 1.35rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  background: var(--brand-red-100, #f9c7c5);
  color: var(--brand-red-800, #8e1515);
  font-size: 0.6875rem;
  font-weight: 700;
  flex-shrink: 0;
}

.exam-picker__cart-label {
  flex: 1;
  min-width: 0;
  font-size: 0.8125rem;
  font-weight: 700;
  line-height: 1.3;
  color: var(--brand-red-700, #b71c1c);
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

.exam-picker__chip-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.exam-picker__chip-toolbar .exam-picker__label {
  margin: 0;
}

.exam-picker__chip-count {
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--text-muted);
}

.exam-picker__chip-count--active {
  color: var(--primary-700, #1d4ed8);
}

.exam-picker__chip-hint {
  margin: -0.35rem 0 0;
  font-size: 0.75rem;
  color: var(--text-muted);
}

.exam-picker__search-wrap--static {
  position: relative;
}

.exam-picker__chip-board {
  max-height: min(22rem, 46vh);
  overflow-y: auto;
  padding: 0.15rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.exam-picker__chip-group-label {
  margin: 0 0 0.4rem;
  font-size: 0.6875rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-light);
}

.exam-picker__chip-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.exam-picker__chip {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  max-width: 100%;
  padding: 0.45rem 0.65rem 0.45rem 0.45rem;
  border: 1.5px solid var(--border);
  border-radius: 999px;
  background: #fff;
  color: var(--text);
  font-family: inherit;
  font-size: 0.8125rem;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s, color 0.12s, box-shadow 0.12s;
}

.exam-picker__chip:hover {
  border-color: var(--primary-300);
  background: var(--primary-50);
}

.exam-picker__chip--selected {
  border-color: var(--brand-red, #c62828);
  background: var(--brand-red-50, #fdecea);
  color: var(--brand-red-800, #8e1515);
  box-shadow: 0 0 0 1px rgba(198, 40, 40, 0.12);
}

.exam-picker__chip-check {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.2rem;
  height: 1.2rem;
  border-radius: 999px;
  border: 1.5px solid var(--border);
  background: #fff;
  flex-shrink: 0;
  color: #fff;
}

.exam-picker__chip--selected .exam-picker__chip-check {
  border-color: var(--brand-red, #c62828);
  background: var(--brand-red, #c62828);
}

.exam-picker__chip-label {
  min-width: 0;
  overflow-wrap: anywhere;
  line-height: 1.25;
}
</style>
