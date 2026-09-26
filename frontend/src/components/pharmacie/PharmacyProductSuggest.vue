<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { Search } from '@lucide/vue'
import { useAppI18n } from '@/i18n/useAppI18n'

export type SuggestProduct = {
  id: string
  name: string
  dosage?: string | null
  sku?: string | null
  barcode?: string | null
}

const props = withDefaults(
  defineProps<{
    modelValue: string
    items: SuggestProduct[]
    placeholder?: string
    ariaLabel?: string
    label?: string
    /** search = barre d’outils, field = formulaire, catalog = caisse */
    variant?: 'search' | 'field' | 'catalog'
    excludeId?: string | null
    /** Entrée choisit la suggestion. Désactivé à la caisse pour garder le scan code-barres. */
    pickOnEnter?: boolean
  }>(),
  {
    variant: 'search',
    excludeId: null,
    pickOnEnter: true,
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
  pick: [product: SuggestProduct]
}>()

const { uiText, localeCode } = useAppI18n()
const inputRef = ref<HTMLInputElement | null>(null)
const open = ref(false)
const activeIndex = ref(0)
const listStyle = ref({ top: '0px', left: '0px', width: '0px' })

const SUGGEST_LIMIT = 8

function foldText(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

const suggestions = computed(() => {
  const query = foldText(props.modelValue.trim())
  if (!open.value || query.length < 1) return []
  return props.items
    .filter((item) => {
      if (props.excludeId && item.id === props.excludeId) return false
      const hay = foldText(
        [item.name, item.dosage, item.sku, item.barcode].filter(Boolean).join(' '),
      )
      return hay.includes(query)
    })
    .slice(0, SUGGEST_LIMIT)
})

const placeholderText = computed(() => {
  void localeCode.value
  return props.placeholder ? uiText(props.placeholder) : undefined
})

const labelText = computed(() => {
  void localeCode.value
  return props.label ? uiText(props.label) : ''
})

const ariaLabelText = computed(() => {
  void localeCode.value
  return uiText(props.ariaLabel || props.label || 'Rechercher un produit')
})

function placeList() {
  const el = inputRef.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  listStyle.value = {
    top: `${rect.bottom + 4}px`,
    left: `${rect.left}px`,
    width: `${Math.max(rect.width, 220)}px`,
  }
}

function bindPlaceListeners() {
  window.addEventListener('scroll', placeList, true)
  window.addEventListener('resize', placeList)
}

function unbindPlaceListeners() {
  window.removeEventListener('scroll', placeList, true)
  window.removeEventListener('resize', placeList)
}

watch(open, (isOpen) => {
  if (isOpen) {
    placeList()
    bindPlaceListeners()
  } else {
    unbindPlaceListeners()
  }
})

watch(
  () => props.modelValue,
  () => {
    activeIndex.value = 0
    if (open.value) placeList()
  },
)

onUnmounted(unbindPlaceListeners)

function showSuggestions() {
  open.value = true
  placeList()
}

function closeSuggestions() {
  open.value = false
}

function onInput(event: Event) {
  emit('update:modelValue', (event.target as HTMLInputElement).value)
  showSuggestions()
}

function choose(item: SuggestProduct) {
  emit('update:modelValue', item.name)
  emit('pick', item)
  closeSuggestions()
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    closeSuggestions()
    return
  }
  if (!suggestions.value.length) return
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    activeIndex.value = (activeIndex.value + 1) % suggestions.value.length
    return
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    activeIndex.value = (activeIndex.value - 1 + suggestions.value.length) % suggestions.value.length
    return
  }
  if (event.key === 'Enter' && props.pickOnEnter) {
    const item = suggestions.value[activeIndex.value]
    if (!item) return
    event.preventDefault()
    event.stopPropagation()
    choose(item)
  }
}

defineExpose({
  focus() {
    inputRef.value?.focus()
  },
})
</script>

<template>
  <div class="product-suggest" :class="`product-suggest--${variant}`">
    <label v-if="variant === 'field'" class="product-suggest__shell">
      <span class="product-suggest__label">{{ labelText }}</span>
      <div class="product-suggest__control">
        <input
          ref="inputRef"
          class="product-suggest__input"
          type="text"
          autocomplete="off"
          role="combobox"
          aria-autocomplete="list"
          :aria-expanded="suggestions.length > 0"
          :aria-label="ariaLabelText"
          :value="modelValue"
          :placeholder="placeholderText"
          @focus="showSuggestions"
          @input="onInput"
          @keydown="onKeydown"
          @blur="closeSuggestions"
        />
      </div>
    </label>
    <div v-else class="product-suggest__control">
      <Search v-if="variant === 'catalog'" :size="16" class="product-suggest__icon" aria-hidden="true" />
      <input
        ref="inputRef"
        class="product-suggest__input"
        type="search"
        autocomplete="off"
        role="combobox"
        aria-autocomplete="list"
        :aria-expanded="suggestions.length > 0"
        :aria-label="ariaLabelText"
        :value="modelValue"
        :placeholder="placeholderText"
        @focus="showSuggestions"
        @input="onInput"
        @keydown="onKeydown"
        @blur="closeSuggestions"
      />
    </div>

    <Teleport to="body">
      <ul
        v-if="suggestions.length"
        class="product-suggest__list"
        role="listbox"
        :style="listStyle"
      >
        <li
          v-for="(item, index) in suggestions"
          :key="item.id"
          role="option"
          :aria-selected="index === activeIndex"
          :class="{ 'is-active': index === activeIndex }"
          @pointerdown.prevent="choose(item)"
          @mouseenter="activeIndex = index"
        >
          <span class="product-suggest__name">{{ item.name }}</span>
          <span v-if="item.dosage" class="product-suggest__meta">{{ item.dosage }}</span>
        </li>
      </ul>
    </Teleport>
  </div>
</template>

<style scoped>
.product-suggest--search {
  position: relative;
  flex: 1 1 12rem;
  max-width: 22rem;
  min-width: 12rem;
}

.product-suggest--catalog {
  position: relative;
}

.product-suggest__control {
  position: relative;
}

.product-suggest--field {
  display: block;
  margin-bottom: var(--density-field-gap);
}

.product-suggest__label {
  display: block;
  margin-bottom: 0.4rem;
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text);
}

.product-suggest__icon {
  position: absolute;
  left: 0.85rem;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-muted);
  pointer-events: none;
}

.product-suggest__input {
  width: 100%;
  border: 1px solid var(--border);
  background: #fff;
  color: var(--text);
  font-family: inherit;
}

.product-suggest--search .product-suggest__input {
  min-width: 12rem;
  padding: 0.4rem 0.6rem;
  border-radius: 8px;
  font-size: 0.8125rem;
}

.product-suggest--field .product-suggest__input {
  min-height: var(--app-control-height);
  padding: var(--density-control-pad-y) var(--density-control-pad-x);
  border-width: 1.5px;
  border-radius: var(--radius-sm);
  background: var(--ui-input-bg);
}

.product-suggest--catalog .product-suggest__input {
  padding: 0.7rem 0.9rem 0.7rem 2.35rem;
  border-width: 1.5px;
  border-radius: 10px;
  font-size: 0.875rem;
  background: var(--ui-input-bg, #fff);
}

.product-suggest__input:focus {
  outline: none;
  border-color: var(--accent-500);
  box-shadow: 0 0 0 3px var(--focus-ring);
}

.product-suggest__list {
  position: fixed;
  z-index: 14100;
  margin: 0;
  padding: 0.25rem;
  list-style: none;
  max-height: 16rem;
  overflow: auto;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 12px 28px rgba(15, 23, 42, 0.16);
}

.product-suggest__list li {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.75rem;
  min-height: 2.75rem;
  padding: 0.7rem 0.75rem;
  border-radius: 7px;
  cursor: pointer;
  font-size: 1rem;
  color: var(--text);
  touch-action: manipulation;
}

.product-suggest__list li.is-active {
  background: #eff6ff;
  color: #1d4ed8;
}

.product-suggest__name {
  font-weight: 600;
}

.product-suggest__meta {
  flex-shrink: 0;
  font-size: 0.75rem;
  color: var(--text-muted);
}
</style>
