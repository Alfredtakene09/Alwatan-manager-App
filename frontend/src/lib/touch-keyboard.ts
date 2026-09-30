export type TouchKeyAction = 'backspace' | 'enter' | 'shift' | 'space' | 'letters' | 'toggleLang'

export type TouchKey = {
  label: string
  value?: string
  action?: TouchKeyAction
  grow?: number
  variant?: 'fn' | 'accent'
}

export type TouchLayoutId = 'letters' | 'qwerty' | 'accents' | 'digits' | 'symbols' | 'arabic'

const PREF_KEY = 'alwatan-touch-kb'

export function deviceHasTouch(): boolean {
  if (typeof navigator !== 'undefined' && (navigator.maxTouchPoints ?? 0) > 0) return true
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(any-pointer: coarse)').matches || window.matchMedia('(pointer: coarse)').matches
}

export function touchKeyboardPref(): 'on' | 'off' {
  try {
    return sessionStorage.getItem(PREF_KEY) === 'off' ? 'off' : 'on'
  } catch {
    return 'on'
  }
}

export function setTouchKeyboardPref(value: 'on' | 'off') {
  try {
    sessionStorage.setItem(PREF_KEY, value)
  } catch {
    /* session privée */
  }
}

export function isTouchTextField(target: EventTarget | null): target is HTMLInputElement | HTMLTextAreaElement {
  if (target instanceof HTMLTextAreaElement) {
    return !target.disabled && !target.readOnly && target.dataset.touchKeyboard !== 'off'
  }
  if (!(target instanceof HTMLInputElement)) return false
  if (target.disabled || target.readOnly || target.dataset.touchKeyboard === 'off') return false
  const type = (target.type || 'text').toLowerCase()
  return ['text', 'search', 'tel', 'url', 'email', 'password', 'number'].includes(type)
}

function key(label: string, extra: Partial<TouchKey> = {}): TouchKey {
  return { label, value: extra.value ?? label, ...extra }
}

function fn(label: string, action: TouchKeyAction, grow = 1.6): TouchKey {
  return { label, action, grow, variant: 'fn' }
}

export function layoutKeys(id: TouchLayoutId, shifted: boolean): TouchKey[][] {
  if (id === 'digits') {
    return [
      ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].map((label) => key(label)),
      ['+', '-', '/', '*', '(', ')', '.', ',', ':', ';'].map((label) => key(label)),
      [fn('⌫', 'backspace'), fn('Espace', 'space', 4), fn('Entrée', 'enter')],
    ]
  }

  if (id === 'accents') {
    return [
      ['é', 'è', 'ê', 'ë', 'à', 'â', 'ù', 'û', 'ç', 'ô'].map((label) => key(label)),
      ['î', 'ï', 'ö', 'ü', 'æ', 'œ', 'ñ', '°', '’', '-'].map((label) => key(label)),
      [fn('⌫', 'backspace'), fn('Espace', 'space', 4), fn('Entrée', 'enter')],
    ]
  }

  if (id === 'symbols') {
    return [
      ['@', '#', '&', '_', '%', '€', '$', '£', '!', '?'].map((label) => key(label)),
      ['/', '\\', '|', '"', "'", '<', '>', '[', ']', '='].map((label) => key(label)),
      [fn('⌫', 'backspace'), fn('Espace', 'space', 4), fn('Entrée', 'enter')],
    ]
  }

  if (id === 'arabic') {
    return [
      ['ض', 'ص', 'ث', 'ق', 'ف', 'غ', 'ع', 'ه', 'خ', 'ح', 'ج'].map((label) => key(label)),
      ['ش', 'س', 'ي', 'ب', 'ل', 'ا', 'ت', 'ن', 'م', 'ك', 'ط'].map((label) => key(label)),
      [fn('⇧', 'shift', 1.3), ...['ئ', 'ء', 'ؤ', 'ر', 'ى', 'ة', 'و', 'ز', 'ظ', 'د'].map((label) => key(label)), fn('⌫', 'backspace', 1.3)],
      [fn('FR', 'toggleLang', 1.4), fn('Espace', 'space', 3.6), fn('Entrée', 'enter', 1.6)],
    ]
  }

  const upper = (label: string) => (shifted ? label.toUpperCase() : label)
  const letter = (label: string) => key(upper(label), { value: upper(label) })
  const qwerty = id === 'qwerty'
  return [
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].map((label) => key(label)),
    (qwerty ? ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'] : ['a', 'z', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p']).map(letter),
    (qwerty ? ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'] : ['q', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'm']).map(letter),
    [
      fn('⇧', 'shift', 1.35),
      ...(qwerty ? ['z', 'x', 'c', 'v', 'b', 'n', 'm'] : ['w', 'x', 'c', 'v', 'b', 'n']).map(letter),
      key(shifted ? '?' : ','),
      key(shifted ? ':' : '.'),
      fn('⌫', 'backspace', 1.35),
    ],
    [fn('ع', 'toggleLang', 1.4), fn('Espace', 'space', 3.6), fn('Entrée', 'enter', 1.8)],
  ]
}

function nativeValueSetter(el: HTMLInputElement | HTMLTextAreaElement) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  return Object.getOwnPropertyDescriptor(proto, 'value')?.set
}

export function writeFieldValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const setter = nativeValueSetter(el)
  if (setter) setter.call(el, value)
  else el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

function caretOf(el: HTMLInputElement | HTMLTextAreaElement) {
  try {
    const start = el.selectionStart
    const end = el.selectionEnd
    if (start == null || end == null) return { start: el.value.length, end: el.value.length }
    return { start, end }
  } catch {
    return { start: el.value.length, end: el.value.length }
  }
}

function placeCaret(el: HTMLInputElement | HTMLTextAreaElement, pos: number) {
  try {
    el.setSelectionRange(pos, pos)
  } catch {
    /* type=number */
  }
}

export function insertFieldText(el: HTMLInputElement | HTMLTextAreaElement, text: string) {
  const { start, end } = caretOf(el)
  const next = el.value.slice(0, start) + text + el.value.slice(end)
  writeFieldValue(el, next)
  const pos = start + text.length
  requestAnimationFrame(() => placeCaret(el, pos))
}

export function backspaceField(el: HTMLInputElement | HTMLTextAreaElement) {
  const { start, end } = caretOf(el)
  if (start !== end) {
    writeFieldValue(el, el.value.slice(0, start) + el.value.slice(end))
    requestAnimationFrame(() => placeCaret(el, start))
    return
  }
  if (start <= 0) return
  writeFieldValue(el, el.value.slice(0, start - 1) + el.value.slice(end))
  const pos = start - 1
  requestAnimationFrame(() => placeCaret(el, pos))
}

export function pressFieldEnter(el: HTMLInputElement | HTMLTextAreaElement) {
  const init: KeyboardEventInit = { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }
  el.dispatchEvent(new KeyboardEvent('keydown', init))
  el.dispatchEvent(new KeyboardEvent('keyup', init))
}
