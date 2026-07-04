import api from '@/api/client'

/** Valeurs par défaut si l'API est indisponible. */
export const EMPLOYEE_JOB_TITLES = [
  'Administrateur système',
  'Réceptionniste',
  'Secrétaire médicale',
  'Direction',
  'Médecin généraliste',
  'Médecin spécialiste',
  'Chirurgien',
  'Assistant chirurgie',
  'Infirmière',
  'Aide-soignante',
  'Laborantin',
  'Pharmacien',
  'Agent de sécurité',
  "Agent d'entretien",
] as const

export type EmployeeJobTitleRecord = {
  id: string
  label: string
  active: boolean
  sortOrder: number
  employeeCount?: number
}

let cachedJobTitleLabels: string[] | null = null

export async function fetchEmployeeJobTitles(
  activeOnly = false,
  apiBase = '/admin',
): Promise<EmployeeJobTitleRecord[]> {
  const { data } = await api.get<EmployeeJobTitleRecord[]>(`${apiBase}/job-titles`, {
    params: { activeOnly: activeOnly ? 'true' : 'false' },
  })
  return data
}

export async function syncEmployeeJobTitles(apiBase = '/admin'): Promise<EmployeeJobTitleRecord[]> {
  const { data } = await api.post<{ count: number; items: EmployeeJobTitleRecord[] }>(
    `${apiBase}/job-titles/sync`,
  )
  cachedJobTitleLabels = data.items.filter((item) => item.active).map((item) => item.label)
  return data.items
}

export async function loadEmployeeJobTitleLabels(
  activeOnly = true,
  apiBase = '/admin',
): Promise<string[]> {
  try {
    const items = await fetchEmployeeJobTitles(activeOnly, apiBase)
    const labels = items.map((item) => item.label)
    cachedJobTitleLabels = labels.length > 0 ? labels : [...EMPLOYEE_JOB_TITLES]
    return cachedJobTitleLabels
  } catch {
    cachedJobTitleLabels = [...EMPLOYEE_JOB_TITLES]
    return cachedJobTitleLabels
  }
}

export function employeeJobTitleOptions(current?: string | null, loaded?: string[] | null): string[] {
  const base = loaded ?? cachedJobTitleLabels ?? [...EMPLOYEE_JOB_TITLES]
  const titles = [...base]
  const trimmed = current?.trim()
  if (trimmed && !titles.includes(trimmed)) {
    titles.unshift(trimmed)
  }
  return titles
}

export function invalidateEmployeeJobTitleCache() {
  cachedJobTitleLabels = null
}
