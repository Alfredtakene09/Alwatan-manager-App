export type LogisticsUnitOption = {
  value: string
  label: string
}

/** Les 3 conditionnements qui activent la saisie carton / paquet / unité. */
export const PACKAGING_MODES: LogisticsUnitOption[] = [
  { value: 'unité', label: 'Unité' },
  { value: 'paquet', label: 'Paquet' },
  { value: 'carton', label: 'Carton' },
]

export type PackagingMode = 'unité' | 'paquet' | 'carton'

/**
 * Mode d’emballage pour la saisie multi-niveaux.
 * Uniquement « paquet » et « carton » activent les champs avancés ;
 * tout autre conditionnement (pièce, kg, boîte…) = saisie simple en quantité.
 */
export function resolvePackagingMode(unit?: string | null): PackagingMode {
  const value = unit?.trim().toLowerCase() ?? 'unité'
  if (value === 'carton') return 'carton'
  if (value === 'paquet') return 'paquet'
  return 'unité'
}

/** Conditionnements courants pour les articles logistique. */
export const LOGISTICS_UNITS: LogisticsUnitOption[] = [
  { value: 'pièce', label: 'Pièce' },
  { value: 'boîte', label: 'Boîte' },
  { value: 'bidon', label: 'Bidon' },
  { value: 'flacon', label: 'Flacon' },
  { value: 'litre', label: 'Litre (liquide)' },
  { value: 'kg', label: 'Kilogramme' },
  { value: 'g', label: 'Gramme' },
  { value: 'rouleau', label: 'Rouleau' },
  { value: 'ramette', label: 'Ramette' },
  { value: 'lot', label: 'Lot' },
  ...PACKAGING_MODES,
]

export const DEFAULT_LOGISTICS_UNIT = 'unité'

export function logisticsUnitOptions(current?: string | null): LogisticsUnitOption[] {
  const value = current?.trim()
  if (!value || LOGISTICS_UNITS.some((unit) => unit.value === value)) {
    return LOGISTICS_UNITS
  }
  return [{ value, label: value }, ...LOGISTICS_UNITS]
}
