<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { X } from '@lucide/vue'
import { useAppI18n } from '@/i18n/useAppI18n'
import {
  backspaceField,
  deviceHasTouch,
  insertFieldText,
  isTouchTextField,
  layoutKeys,
  prefersNumpad,
  pressFieldEnter,
  type TouchKey,
  type TouchLayoutId,
} from '@/lib/touch-keyboard'

const { uiText, localeCode } = useAppI18n()

const LETTER_LAYOUTS = new Set<TouchLayoutId>(['letters', 'qwerty', 'arabic'])

function sessionLetterLayout(): TouchLayoutId {
  if (localeCode.value === 'ar') return 'arabic'
  if (localeCode.value === 'en') return 'qwerty'
  return 'letters'
}

function latinLetterLayout(): TouchLayoutId {
  return localeCode.value === 'en' ? 'qwerty' : 'letters'
}

const open = ref(false)
const shifted = ref(false)
const shiftLocked = ref(false)
/** Choix manuel FR/ع : conserve le bascule même hors layout lettres. */
const letterLayoutOverride = ref<TouchLayoutId | null>(null)
const layout = ref<TouchLayoutId>(sessionLetterLayout())
const target = ref<HTMLInputElement | HTMLTextAreaElement | null>(null)
const rootRef = ref<HTMLElement | null>(null)
const touchCapable = deviceHasTouch()

const rows = computed(() => layoutKeys(layout.value, shifted.value || shiftLocked.value))
const numpad = computed(() => layout.value === 'numpad')

function activeLetterLayout(): TouchLayoutId {
  const override = letterLayoutOverride.value
  if (override && LETTER_LAYOUTS.has(override)) return override
  return sessionLetterLayout()
}

const modes = computed(() => {
  const primary = activeLetterLayout()
  const latin = latinLetterLayout()
  const items: { id: TouchLayoutId; label: string }[] = []
  if (primary === 'arabic') {
    items.push({ id: 'arabic', label: 'ع' }, { id: latin, label: 'FR' })
  } else {
    items.push({ id: latin, label: latin === 'qwerty' ? 'EN' : 'FR' }, { id: 'arabic', label: 'ع' })
    items.push({ id: 'accents', label: 'éà' })
  }
  items.push({ id: 'digits', label: '123' }, { id: 'symbols', label: '#@' })
  return items
})

function defaultLayout(el: HTMLInputElement | HTMLTextAreaElement): TouchLayoutId {
  if (prefersNumpad(el)) return 'numpad'
  return activeLetterLayout()
}

watch(localeCode, () => {
  letterLayoutOverride.value = null
  if (!LETTER_LAYOUTS.has(layout.value)) return
  layout.value = sessionLetterLayout()
  shifted.value = false
  shiftLocked.value = false
})

function fieldFrom(node: EventTarget | null) {
  return isTouchTextField(node) ? node : null
}

function rememberTarget(el: HTMLInputElement | HTMLTextAreaElement) {
  const prev = target.value
  target.value = el
  if (!open.value) {
    layout.value = defaultLayout(el)
    return
  }
  if (prefersNumpad(el)) layout.value = 'numpad'
  else if (prev && prefersNumpad(prev) && layout.value === 'numpad') layout.value = defaultLayout(el)
}

function setLetterLayout(id: TouchLayoutId) {
  if (!LETTER_LAYOUTS.has(id)) return
  letterLayoutOverride.value = id
  layout.value = id
  shifted.value = false
  shiftLocked.value = false
}

function toggleLangLayout() {
  const next = activeLetterLayout() === 'arabic' ? latinLetterLayout() : 'arabic'
  setLetterLayout(next)
}

function scrollParent(el: HTMLElement): HTMLElement | null {
  let node = el.parentElement
  while (node) {
    const style = getComputedStyle(node)
    if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 4) return node
    node = node.parentElement
  }
  return null
}

function revealField(el: HTMLElement) {
  const place = () => {
    const kbHeight = rootRef.value?.offsetHeight ?? 320
    document.documentElement.style.setProperty('--touch-kb-height', `${kbHeight}px`)
    document.documentElement.classList.add('touch-kb-open')
    const kbTop = rootRef.value?.getBoundingClientRect().top ?? window.innerHeight - kbHeight
    const rect = el.getBoundingClientRect()
    const gap = 110
    const overflow = rect.bottom - (kbTop - gap)
    if (overflow <= 0 && rect.top >= 8) return

    // Sur la page login : scroll vertical uniquement, sans décalage gauche/droite.
    if (el.closest('.login')) {
      el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' })
      return
    }

    const scroller = scrollParent(el) ?? (document.scrollingElement as HTMLElement | null)
    if (!scroller) return
    scroller.scrollTop += Math.max(overflow, 0)
  }
  window.setTimeout(place, 40)
  window.setTimeout(place, 180)
}

function showFor(el: HTMLInputElement | HTMLTextAreaElement) {
  rememberTarget(el)
  shifted.value = false
  open.value = true
  revealField(el)
}

function hideKeyboard() {
  open.value = false
  shifted.value = false
  shiftLocked.value = false
  document.documentElement.classList.remove('touch-kb-open')
}

function onPointerDown(event: PointerEvent) {
  const el = fieldFrom(event.target)
  if (!el || !touchCapable) return
  if (rootRef.value?.contains(event.target as Node)) return
  if (event.pointerType === 'touch' || event.pointerType === 'pen' || window.matchMedia('(pointer: coarse)').matches) {
    if (!el.dataset.prevInputMode) el.dataset.prevInputMode = el.getAttribute('inputmode') ?? ''
    el.dataset.osKbSuppressed = '1'
    el.setAttribute('inputmode', 'none')
  }
  showFor(el)
}

function restoreOsKeyboard(el: HTMLInputElement | HTMLTextAreaElement) {
  if (el.dataset.osKbSuppressed !== '1') return
  const prev = el.dataset.prevInputMode ?? ''
  if (prev) el.setAttribute('inputmode', prev)
  else el.removeAttribute('inputmode')
  delete el.dataset.osKbSuppressed
  delete el.dataset.prevInputMode
}

function onFocusIn(event: FocusEvent) {
  const el = fieldFrom(event.target)
  if (!el || !touchCapable) return
  rememberTarget(el)
  showFor(el)
}

function onFocusOut(event: FocusEvent) {
  const next = event.relatedTarget
  if (next instanceof Node && rootRef.value?.contains(next)) return
  window.setTimeout(() => {
    const active = document.activeElement
    if (active && rootRef.value?.contains(active)) return
    const field = fieldFrom(active)
    if (field) {
      rememberTarget(field)
      return
    }
    if (target.value) restoreOsKeyboard(target.value)
    open.value = false
    document.documentElement.classList.remove('touch-kb-open')
    target.value = null
  }, 90)
}

function keepFocus(event: Event) {
  event.preventDefault()
}

function applyKey(item: TouchKey) {
  const el = target.value
  if (!el) return
  el.focus()
  if (item.action === 'backspace') {
    backspaceField(el)
    return
  }
  if (item.action === 'space') {
    insertFieldText(el, ' ')
    return
  }
  if (item.action === 'enter') {
    pressFieldEnter(el)
    return
  }
  if (item.action === 'letters') {
    layout.value = activeLetterLayout()
    return
  }
  if (item.action === 'toggleLang') {
    toggleLangLayout()
    return
  }
  if (item.action === 'shift') {
    if (shifted.value) {
      shiftLocked.value = true
      shifted.value = false
    } else if (shiftLocked.value) {
      shiftLocked.value = false
    } else {
      shifted.value = true
    }
    return
  }
  if (!item.value) return
  insertFieldText(el, item.value)
  if (shifted.value && !shiftLocked.value) shifted.value = false
}

function selectLayout(id: TouchLayoutId) {
  if (LETTER_LAYOUTS.has(id)) {
    setLetterLayout(id)
  } else {
    layout.value = id
    shifted.value = false
    shiftLocked.value = false
  }
  target.value?.focus()
}

function keyClass(item: TouchKey) {
  return {
    'touch-kb__key--fn': item.variant === 'fn',
    'touch-kb__key--on': item.action === 'shift' && (shifted.value || shiftLocked.value),
  }
}

function keyStyle(item: TouchKey) {
  return { flexGrow: String(item.grow ?? 1) }
}

function keyLabel(item: TouchKey) {
  if (item.action === 'space') return uiText('Espace')
  if (item.action === 'enter') return uiText('Touche Entrée')
  if (item.action === 'letters') return activeLetterLayout() === 'arabic' ? 'ع' : 'ABC'
  if (item.action === 'toggleLang') return layout.value === 'arabic' ? 'FR' : 'ع'
  return item.label
}

onMounted(() => {
  document.addEventListener('pointerdown', onPointerDown, true)
  document.addEventListener('focusin', onFocusIn, true)
  document.addEventListener('focusout', onFocusOut, true)
})

onUnmounted(() => {
  document.removeEventListener('pointerdown', onPointerDown, true)
  document.removeEventListener('focusin', onFocusIn, true)
  document.removeEventListener('focusout', onFocusOut, true)
})
</script>

<template>
  <section
    v-if="open"
    ref="rootRef"
    class="touch-kb"
    :class="{ 'touch-kb--numpad': numpad }"
    role="group"
    :aria-label="uiText('Clavier tactile')"
    @pointerdown="keepFocus"
  >
    <header class="touch-kb__bar">
      <strong class="touch-kb__title">{{ uiText('Clavier tactile') }}</strong>
      <div class="touch-kb__modes">
        <button
          v-for="mode in modes"
          :key="mode.id"
          type="button"
          class="touch-kb__mode"
          :class="{ 'touch-kb__mode--on': layout === mode.id }"
          @pointerdown.prevent="selectLayout(mode.id)"
        >
          {{ mode.label }}
        </button>
      </div>
      <button type="button" class="touch-kb__hide" @pointerdown.prevent="hideKeyboard">
        <X :size="22" />
        {{ uiText('Masquer') }}
      </button>
    </header>

    <div v-for="(row, index) in rows" :key="index" class="touch-kb__row">
      <button
        v-for="(item, keyIndex) in row"
        :key="`${index}-${keyIndex}-${item.label}`"
        type="button"
        class="touch-kb__key"
        :class="keyClass(item)"
        :style="keyStyle(item)"
        @pointerdown.prevent="applyKey(item)"
      >
        {{ keyLabel(item) }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.touch-kb {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 14000;
  padding: 0.55rem 0.55rem calc(0.7rem + env(safe-area-inset-bottom, 0px));
  background: #0f172a;
  color: #fff;
  box-shadow: 0 -12px 36px rgba(15, 23, 42, 0.35);
  user-select: none;
  touch-action: manipulation;
}

.touch-kb__bar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.45rem;
}

.touch-kb__title {
  font-size: 0.95rem;
  font-weight: 800;
  white-space: nowrap;
}

:global(html.touch-kb-open #app) {
  height: calc(100dvh - var(--touch-kb-height, 18rem));
  overflow: auto;
}

/* Login : rester centré horizontalement ; remonter un peu pour laisser le champ visible. */
:global(html.touch-kb-open .login) {
  align-items: flex-start;
  justify-content: center;
  min-height: calc(100dvh - var(--touch-kb-height, 18rem));
  padding-top: max(1rem, env(safe-area-inset-top, 0px));
  padding-inline: 1.5rem;
}

:global(html.touch-kb-open .login .login__stack),
:global(html.touch-kb-open .login .login__card) {
  margin-inline: auto;
  width: 100%;
}

:global(html.touch-kb-open .ui-form-modal) {
  max-height: calc(100dvh - var(--touch-kb-height, 18rem) - 1.5rem);
}

.touch-kb__modes {
  display: flex;
  flex: 1;
  gap: 0.35rem;
  min-width: 0;
}

.touch-kb__mode,
.touch-kb__hide,
.touch-kb__key {
  border: none;
  cursor: pointer;
  touch-action: manipulation;
}

.touch-kb__mode,
.touch-kb__hide {
  min-height: 2.7rem;
  padding: 0.35rem 0.75rem;
  border-radius: 10px;
  background: #1e293b;
  color: #fff;
  font-size: 1rem;
  font-weight: 800;
}

.touch-kb__mode--on {
  background: #22c55e;
  color: #052e16;
}

.touch-kb__hide {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  margin-left: auto;
}

.touch-kb__row {
  display: flex;
  gap: 0.35rem;
  margin-top: 0.35rem;
}

.touch-kb__key {
  flex: 1 1 0;
  min-width: 0;
  min-height: 4.15rem;
  border-radius: 12px;
  background: #f8fafc;
  color: #0f172a;
  font-size: 1.55rem;
  font-weight: 700;
  line-height: 1;
}

.touch-kb__key--fn {
  background: #334155;
  color: #fff;
  font-size: 1.05rem;
}

.touch-kb__key--on {
  background: #22c55e;
  color: #052e16;
}

.touch-kb--numpad {
  padding-inline: max(0.8rem, calc(50vw - 16rem));
}

.touch-kb--numpad .touch-kb__key {
  min-height: 5rem;
  font-size: 2.1rem;
}

.touch-kb--numpad .touch-kb__key--fn {
  font-size: 1.2rem;
}

@media (max-height: 760px) {
  .touch-kb__key {
    min-height: 3.15rem;
    font-size: 1.3rem;
  }

  .touch-kb--numpad .touch-kb__key {
    min-height: 3.6rem;
    font-size: 1.7rem;
  }
}
</style>
