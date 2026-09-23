/** Isolation LTR (U+2066…U+2069) — empêche l’inversion des montants en contexte RTL/arabe. */
const LRI = '\u2066'
const PDI = '\u2069'

export function ltrIsolate(text: string): string {
  if (!text) return text
  return `${LRI}${text}${PDI}`
}

/** Retire LRI/RLI/FSI/PDI et marques de direction — Excel/Word les affichent comme « LRI » / « PDI ». */
export function stripBidiMarks(text: string): string {
  return text.replace(/[\u2066-\u2069\u202A-\u202E\u200E\u200F]/g, '')
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

/** Montant fichier (PDF / Excel / Word) — sans isolats Unicode. */
export function formatFcfaPlain(amount: number): string {
  return `${formatDigitsRaw(amount)} FCFA`
}

/** Montant compact pour tickets thermiques (ex. pharmacie). */
export function formatFcfaShort(amount: number): string {
  return ltrIsolate(`${formatDigitsRaw(amount)} F`)
}

/** Montant sans suffixe (cartes KPI, prévisualisations compactes). */
export function formatFcfaCompact(amount: number): string {
  return formatFcfaDigits(amount)
}

/** Normalise une chaîne déjà formatée (Intl, CSV, etc.). */
export function normalizeFcfaString(value: string): string {
  return stripBidiMarks(value.replace(/[\u202f\u00a0]/g, ' '))
}
