/** @deprecated Conservé pour compat — les formes vivent en base (ProductForm / API /pharmacie/forms). */
export const PHARMACEUTICAL_FORMS = [
  'Comprimé',
  'Gélule',
  'Sirop',
  'Suspension',
  'Injection',
  'Pommade',
  'Crème',
  'Suppositoire',
  'Gouttes',
  'Collyre',
  'Sachet',
  'Autre',
] as const

export type PharmaceuticalForm = (typeof PHARMACEUTICAL_FORMS)[number]

export function defaultExpiryDateInput(): string {
  return defaultExpiryDateFr()
}

/** Date d’expiration affichée / saisie : JJ/MM/AAAA */
export function defaultExpiryDateFr(): string {
  const date = new Date()
  date.setFullYear(date.getFullYear() + 1)
  return isoDateToFrDisplay(date.toISOString().slice(0, 10))
}

export function isoDateToFrDisplay(value: string | null | undefined): string {
  if (!value) return ''
  const iso = value.slice(0, 10)
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!match) return ''
  return `${match[3]}/${match[2]}/${match[1]}`
}

export function maskFrDateInput(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8)
  if (digits.length <= 2) return digits
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`
}

/** Parse JJ/MM/AAAA → YYYY-MM-DD, ou null si invalide. */
export function frDisplayToIsoDate(value: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim())
  if (!match) return null
  const day = Number(match[1])
  const month = Number(match[2])
  const year = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1900 || year > 2100) return null
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}