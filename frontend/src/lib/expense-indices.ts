import api from '@/api/client'

export type ExpenseIndiceRecord = {
  id: string
  name: string
  description: string | null
  active: boolean
  sortOrder: number
}

export type ExpenseIndiceOption = {
  id: string
  name: string
  description: string | null
}

export async function fetchExpenseIndices() {
  const { data } = await api.get<ExpenseIndiceRecord[]>('/cash-desk/expense-indices')
  return data
}

export function toActiveIndiceOptions(items: ExpenseIndiceRecord[]): ExpenseIndiceOption[] {
  return items
    .filter((item) => item.active)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'fr'))
    .map(({ id, name, description }) => ({ id, name, description }))
}
