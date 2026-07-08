export type LogisticsUnitOption = {
  value: string
  label: string
}

/** Conditionnements courants pour les articles logistique. */
export const LOGISTICS_UNITS: LogisticsUnitOption[] = [
  { value: 'unité', label: 'Unité' },
  { value: 'pièce', label: 'Pièce' },
  { value: 'boîte', label: 'Boîte' },
  { value: 'carton', label: 'Carton' },
  { value: 'paquet', label: 'Paquet' },
  { value: 'bidon', label: 'Bidon' },
  { value: 'flacon', label: 'Flacon' },
  { value: 'litre', label: 'Litre (liquide)' },
  { value: 'kg', label: 'Kilogramme' },
  { value: 'g', label: 'Gramme' },
  { value: 'rouleau', label: 'Rouleau' },
  { value: 'ramette', label: 'Ramette' },
  { value: 'lot', label: 'Lot' },
]

export const DEFAULT_LOGISTICS_UNIT = LOGISTICS_UNITS[0]?.value ?? 'unité'

export function logisticsUnitOptions(current?: string | null): LogisticsUnitOption[] {
  const value = current?.trim()
  if (!value || LOGISTICS_UNITS.some((unit) => unit.value === value)) {
    return LOGISTICS_UNITS
  }
  return [{ value, label: value }, ...LOGISTICS_UNITS]
}
