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
  const date = new Date()
  date.setFullYear(date.getFullYear() + 1)
  return date.toISOString().slice(0, 10)
}
