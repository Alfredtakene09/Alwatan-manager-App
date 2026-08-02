/** Isolation LTR (U+2066…U+2069) — empêche l’inversion des montants en contexte RTL/arabe. */
const LRI = '\u2066'
const PDI = '\u2069'

export function ltrIsolate(text: string): string {
  if (!text) return text
  return `${LRI}${text}${PDI}`
}

function formatDigitsRaw(amount: number): string {
  const n = Math.round(Number(amount) || 0)
  const sign = n < 0 ? '− ' : ''
  /** Espaces ASCII — évite U+202F (affiché « / » en PDF et à l'impression). */
  return sign + Math.abs(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}

/** Chiffres isolés LTR (ne pas inverser en arabe). */
export function formatFcfaDigits(amount: number): string {
  return ltrIsolate(formatDigitsRaw(amount))
}

export function formatFcfa(amount: number): string {
  return ltrIsolate(`${formatDigitsRaw(amount)} FCFA`)
}

/** Montant sans suffixe (cartes KPI, prévisualisations compactes). */
export function formatFcfaCompact(amount: number): string {
  return formatFcfaDigits(amount)
}

/** Normalise une chaîne déjà formatée (Intl, CSV, etc.). */
export function normalizeFcfaString(value: string): string {
  return value.replace(/[\u202f\u00a0]/g, ' ')
}
