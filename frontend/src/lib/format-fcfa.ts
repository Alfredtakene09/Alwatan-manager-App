/** Chiffres avec espaces ASCII — évite U+202F (affiché « / » en PDF et à l'impression). */
export function formatFcfaDigits(amount: number): string {
  const n = Math.round(Number(amount) || 0)
  const sign = n < 0 ? '− ' : ''
  return sign + Math.abs(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}

export function formatFcfa(amount: number): string {
  return `${formatFcfaDigits(amount)} FCFA`
}

/** Normalise une chaîne déjà formatée (Intl, CSV, etc.). */
export function normalizeFcfaString(value: string): string {
  return value.replace(/[\u202f\u00a0]/g, ' ')
}
