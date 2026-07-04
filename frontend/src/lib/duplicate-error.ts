import type { AppModalOptions } from '@/lib/app-modal'

export type DuplicateApiBody = {
  error: string
  code: 'DUPLICATE'
  entity: string
  existing: Record<string, unknown>
}

export function isDuplicateApiBody(value: unknown): value is DuplicateApiBody {
  if (!value || typeof value !== 'object') return false
  const body = value as Record<string, unknown>
  return body.code === 'DUPLICATE' && typeof body.error === 'string'
}

const ENTITY_LABELS: Record<string, string> = {
  patient: 'Patient',
  intervention: 'Opération',
  exam_catalog: 'Examen',
  surgery_case: 'Dossier opération',
  visit: 'Visite',
  product: 'Produit',
  room: 'Salle',
  user: 'Utilisateur',
}

const HIDDEN_EXISTING_KEYS = new Set(['id'])

function formatExistingData(existing: Record<string, unknown>): Record<string, string> {
  const labels: Record<string, string> = {
    code: 'Matricule',
    firstName: 'Prénom',
    lastName: 'Nom',
    phone: 'Téléphone',
    dateOfBirth: 'Date de naissance',
    label: 'Libellé',
    category: 'Catégorie',
    kind: 'Type',
    name: 'Nom',
    email: 'E-mail',
    sku: 'SKU',
    unitPriceFcfa: 'Prix unitaire (FCFA)',
    totalCostFcfa: 'Coût (FCFA)',
    priceFcfa: 'Tarif (FCFA)',
    type: 'Type de salle',
    dailyRateFcfa: 'Tarif nuitée (FCFA)',
  }

  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(existing)) {
    if (HIDDEN_EXISTING_KEYS.has(key)) continue
    if (value === null || value === undefined || value === '') continue
    const label = labels[key] ?? key
    if (key === 'dateOfBirth' && typeof value === 'string') {
      result[label] = new Date(value).toLocaleDateString('fr-FR')
    } else {
      result[label] = String(value)
    }
  }
  return result
}

export function duplicateModalFromApi(
  body: DuplicateApiBody,
  overrides?: Partial<AppModalOptions>,
): AppModalOptions {
  const entityLabel = ENTITY_LABELS[body.entity] ?? 'Enregistrement'
  return {
    type: 'DUPLICATE',
    title: overrides?.title ?? `${entityLabel} déjà existant`,
    message: overrides?.message ?? body.error,
    existingData: formatExistingData(body.existing),
    confirmLabel: overrides?.confirmLabel ?? 'Compris',
    cancelLabel: overrides?.cancelLabel ?? 'Fermer',
    ...overrides,
  }
}
