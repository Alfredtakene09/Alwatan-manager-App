import { shallowRef } from 'vue'

/** Isolation LTR (U+2066…U+2069) — empêche l’inversion des montants en contexte RTL/arabe. */
const LRI = '⁦'
const PDI = '⁩'

export function ltrIsolate(text: string): string {
  if (!text) return text
  return `${LRI}${text}${PDI}`
}

/** Retire LRI/RLI/FSI/PDI et marques de direction — Excel/Word les affichent comme « LRI » / « PDI ». */
export function stripBidiMarks(text: string): string {
  return text.replace(/[⁦-⁩‪-‮‎‏]/g, '')
}

/* ------------------------------------------------------------------ */
/* Devise selon la langue de la session                                */
/* ------------------------------------------------------------------ */

/**
 * Montants enregistrés en FCFA. En arabe, ils sont affichés et saisis en rial :
 * 1 rial = 5 FCFA (montant affiché = FCFA ÷ 5, montant saisi × 5 = FCFA).
 */
export const FCFA_PER_RIAL = 5
export const RIAL_UNIT = 'ريال'

/** Réactif : les montants affichés se recalculent au changement de langue. */
const currencyLocale = shallowRef<string>('fr')

export function setCurrencyLocale(locale: string) {
  currencyLocale.value = locale
}

export function isRialCurrency(): boolean {
  return currencyLocale.value === 'ar'
}

export function currencyUnit(): string {
  return isRialCurrency() ? RIAL_UNIT : 'FCFA'
}

/** Montant FCFA → montant dans la devise de la session. */
export function toDisplayAmount(amountFcfa: number): number {
  const n = Number(amountFcfa) || 0
  return isRialCurrency() ? n / FCFA_PER_RIAL : n
}

/** Montant saisi dans la devise de la session → FCFA entier. */
export function fromDisplayAmount(amount: number): number {
  const n = Number(amount) || 0
  return Math.round(isRialCurrency() ? n * FCFA_PER_RIAL : n)
}

/** Valeur d'un champ (texte FCFA) → texte affiché dans la devise de la session. */
export function fcfaToInputText(value: string | number | null | undefined): string {
  if (value == null || value === '') return ''
  const n = Number(value)
  if (!Number.isFinite(n)) return String(value)
  if (!isRialCurrency()) return String(value)
  return String(Math.round((n / FCFA_PER_RIAL) * 100) / 100)
}

/** Texte saisi dans la devise de la session → texte FCFA (entier) pour le formulaire. */
export function inputTextToFcfa(text: string): string {
  const raw = text.trim().replace(',', '.')
  if (!raw) return ''
  const n = Number(raw)
  if (!Number.isFinite(n)) return text
  return String(fromDisplayAmount(n))
}

function formatDigitsRaw(amountFcfa: number): string {
  const value = toDisplayAmount(amountFcfa)
  // FCFA entiers ; en rial, jusqu'à 2 décimales (ex. 2 501 FCFA → 500.2).
  const rounded = isRialCurrency() ? Math.round(value * 100) / 100 : Math.round(value)
  const sign = rounded < 0 ? '− ' : ''
  const [intPart, decimals] = Math.abs(rounded).toString().split('.')
  /** Espaces ASCII — évite U+202F (affiché « / » en PDF et à l'impression). */
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return sign + grouped + (decimals ? `.${decimals}` : '')
}

/** Chiffres isolés LTR (ne pas inverser en arabe). */
export function formatFcfaDigits(amount: number): string {
  return ltrIsolate(formatDigitsRaw(amount))
}

export function formatFcfa(amount: number): string {
  return ltrIsolate(`${formatDigitsRaw(amount)} ${currencyUnit()}`)
}

/** Montant fichier (PDF / Excel / Word) — sans isolats Unicode. */
export function formatFcfaPlain(amount: number): string {
  return `${formatDigitsRaw(amount)} ${currencyUnit()}`
}

/** Montant compact pour tickets thermiques (ex. pharmacie). */
export function formatFcfaShort(amount: number): string {
  return ltrIsolate(`${formatDigitsRaw(amount)} ${isRialCurrency() ? RIAL_UNIT : 'F'}`)
}

/** Montant sans suffixe (cartes KPI, prévisualisations compactes). */
export function formatFcfaCompact(amount: number): string {
  return formatFcfaDigits(amount)
}

/** Normalise une chaîne déjà formatée (Intl, CSV, etc.). */
export function normalizeFcfaString(value: string): string {
  return stripBidiMarks(value.replace(/[  ]/g, ' '))
}
