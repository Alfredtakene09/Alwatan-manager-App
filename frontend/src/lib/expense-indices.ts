import api from '@/api/client'

export type ExpenseFlow = 'SORTIE' | 'ENTREE'

export type ExpenseIndiceRecord = {
  id: string
  name: string
  description: string | null
  flow: ExpenseFlow
  active: boolean
  sortOrder: number
}

export type ExpenseIndiceOption = {
  id: string
  name: string
  description: string | null
  flow: ExpenseFlow
}

export async function fetchExpenseIndices() {
  const { data } = await api.get<ExpenseIndiceRecord[]>('/cash-desk/expense-indices')
  return data
}

export type ExpenseCategoryCode =
  | 'FOURNITURES'
  | 'TRANSPORT'
  | 'MAINTENANCE'
  | 'ACHAT_URGENT'
  | 'AUTRE'

export const EXPENSE_CATEGORY_CODE_LABELS: Record<ExpenseCategoryCode, string> = {
  FOURNITURES: 'Fournitures',
  TRANSPORT: 'Transport / course',
  MAINTENANCE: 'Maintenance',
  ACHAT_URGENT: 'Équipements',
  AUTRE: 'Autre',
}

/** Même règle que le serveur : le code comptable suit le nom de l'indice indiqué. */
export function categoryCodeFromIndiceName(name: string): ExpenseCategoryCode {
  const normalized = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
  if (normalized.includes('transport')) return 'TRANSPORT'
  if (normalized.includes('maintenance')) return 'MAINTENANCE'
  if (normalized.includes('urgent') || normalized.includes('equipement')) return 'ACHAT_URGENT'
  if (
    normalized.includes('fourniture') ||
    normalized.includes('entretien') ||
    normalized.includes('papier')
  ) {
    return 'FOURNITURES'
  }
  return 'AUTRE'
}

export function toActiveIndiceOptions(items: ExpenseIndiceRecord[]): ExpenseIndiceOption[] {
  return items
    .filter((item) => item.active)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'fr'))
    .map(({ id, name, description, flow }) => ({
      id,
      name,
      description,
      flow: flow === 'ENTREE' ? 'ENTREE' as const : 'SORTIE' as const,
    }))
}
