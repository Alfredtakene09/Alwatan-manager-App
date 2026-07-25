/** Conversion stock logistique : carton → paquet → unité (base). */

export type PackagingConfig = {
  unitsPerPackage: number
  packagesPerCarton: number
}

export type PackagingBreakdown = {
  cartons: number
  packages: number
  units: number
  totalUnits: number
}

export function normalizePackaging(config?: Partial<PackagingConfig> | null): PackagingConfig {
  const unitsPerPackage = Math.max(1, Math.trunc(Number(config?.unitsPerPackage) || 1))
  const packagesPerCarton = Math.max(1, Math.trunc(Number(config?.packagesPerCarton) || 1))
  return { unitsPerPackage, packagesPerCarton }
}

export function hasMultiPackaging(config?: Partial<PackagingConfig> | null): boolean {
  const { unitsPerPackage, packagesPerCarton } = normalizePackaging(config)
  return unitsPerPackage > 1 || packagesPerCarton > 1
}

/** Total en unités de base à partir de cartons / paquets / unités. */
export function packagingToUnits(
  input: { cartons?: number; packages?: number; units?: number },
  config?: Partial<PackagingConfig> | null,
): number {
  const { unitsPerPackage, packagesPerCarton } = normalizePackaging(config)
  const cartons = Math.max(0, Math.trunc(Number(input.cartons) || 0))
  const packages = Math.max(0, Math.trunc(Number(input.packages) || 0))
  const units = Math.max(0, Math.trunc(Number(input.units) || 0))
  return cartons * packagesPerCarton * unitsPerPackage + packages * unitsPerPackage + units
}

/** Décompose un stock en unités de base en cartons + paquets + unités. */
export function unitsToPackaging(
  totalUnits: number,
  config?: Partial<PackagingConfig> | null,
): PackagingBreakdown {
  const { unitsPerPackage, packagesPerCarton } = normalizePackaging(config)
  const total = Math.max(0, Math.trunc(Number(totalUnits) || 0))
  const unitsPerCarton = packagesPerCarton * unitsPerPackage
  const cartons = Math.floor(total / unitsPerCarton)
  let remainder = total % unitsPerCarton
  const packages = Math.floor(remainder / unitsPerPackage)
  remainder = remainder % unitsPerPackage
  return {
    cartons,
    packages,
    units: remainder,
    totalUnits: total,
  }
}

/** Libellé lisible du stock (ex. « 2 cartons + 1 paquet + 5 unités »). */
export function formatPackagingStock(
  totalUnits: number,
  config?: Partial<PackagingConfig> | null,
  options?: { unitLabel?: string; short?: boolean },
): string {
  const unitLabel = options?.unitLabel?.trim() || 'unité'
  const short = options?.short ?? false
  const { unitsPerPackage, packagesPerCarton } = normalizePackaging(config)
  const total = Math.max(0, Math.trunc(Number(totalUnits) || 0))

  function pluralize(count: number, label: string) {
    if (count <= 1) return label
    if (label.endsWith('s')) return label
    // unités courantes FR
    if (label === 'unité') return 'unités'
    if (label === 'pièce') return 'pièces'
    if (label === 'paquet') return 'paquets'
    if (label === 'carton') return 'cartons'
    if (label === 'boîte') return 'boîtes'
    return `${label}s`
  }

  if (total === 0) {
    return `0 ${unitLabel}`
  }

  if (!hasMultiPackaging({ unitsPerPackage, packagesPerCarton })) {
    return `${total} ${pluralize(total, unitLabel)}`
  }

  const parts = unitsToPackaging(total, { unitsPerPackage, packagesPerCarton })
  const chunks: string[] = []
  if (parts.cartons > 0) {
    chunks.push(`${parts.cartons} ${pluralize(parts.cartons, 'carton')}`)
  }
  if (parts.packages > 0) {
    chunks.push(`${parts.packages} ${pluralize(parts.packages, 'paquet')}`)
  }
  if (parts.units > 0) {
    chunks.push(`${parts.units} ${pluralize(parts.units, unitLabel)}`)
  }
  return chunks.join(short ? ' · ' : ' + ')
}

/** Résumé de la configuration d’emballage. */
export function formatPackagingConfig(config?: Partial<PackagingConfig> | null): string {
  const { unitsPerPackage, packagesPerCarton } = normalizePackaging(config)
  if (!hasMultiPackaging({ unitsPerPackage, packagesPerCarton })) {
    return 'Stock en unités simples'
  }
  const lines: string[] = []
  if (unitsPerPackage > 1) {
    lines.push(`1 paquet = ${unitsPerPackage} unités`)
  }
  if (packagesPerCarton > 1) {
    lines.push(`1 carton = ${packagesPerCarton} paquet${packagesPerCarton > 1 ? 's' : ''}`)
  }
  const unitsPerCarton = packagesPerCarton * unitsPerPackage
  if (packagesPerCarton > 1 && unitsPerPackage > 1) {
    lines.push(`1 carton = ${unitsPerCarton} unités`)
  }
  return lines.join(' · ')
}
