export type FinancialKpis = {
  revenueMonthFcfa: number
  revenueChangePercent: number
  expensesMonthFcfa: number
  expensesChangePercent: number
  netMonthFcfa: number
  netChangePercent: number
  payrollMonthFcfa: number
  payrollChangePercent: number
}

export type MonthlyTrendPoint = {
  year: number
  month: number
  label: string
  revenueFcfa: number
  expensesFcfa: number
  netFcfa: number
}

export type BreakdownItem = {
  key: string
  label: string
  amountFcfa: number
  percent?: number
}

export type AdminExpenseRow = {
  id: string
  date: string
  category: string
  description: string
  amountFcfa: number
  status: 'PENDING' | 'VALIDATED' | 'REJECTED'
  statusLabel: string
}

export type PayrollRow = {
  id: string
  employeeName: string
  jobTitle: string | null
  grossFcfa: number
  status: 'PENDING' | 'PAID' | 'LATE'
}

export type AdminDashboardOverview = {
  financialKpis: FinancialKpis
  monthlyTrend: MonthlyTrendPoint[]
  revenueBreakdown: BreakdownItem[]
  expenseBreakdown: BreakdownItem[]
  recentExpenses: AdminExpenseRow[]
  employees: {
    totalActive: number
    newThisMonth: number
    byService: Array<{ service: string; count: number }>
  }
  payroll: {
    year: number
    month: number
    paidCount: number
    totalCount: number
    rows: PayrollRow[]
  }
  clinical: {
    patientsToday: number
    appointmentsToday: number
    examsPending: number
    activeHospitalizations: number
  }
  alerts: {
    pendingExpenses: number
    unpaidPayroll: number
    lowStock: number
    recentValidations: Array<{
      id: string
      label: string
      amountFcfa: number
      validatedAt: string | null
    }>
  }
  activityJournal: Array<{
    id: string
    message: string
    actorName: string
    createdAt: string
  }>
  navBadges: {
    depenses: number
    salaires: number
  }
}

export type TrendFilter = 'month' | 'quarter' | 'year'

export function filterTrend(points: MonthlyTrendPoint[], filter: TrendFilter) {
  if (filter === 'year') return points
  if (filter === 'quarter') return points.slice(-3)
  return points.slice(-1)
}

export function formatTrendPercent(value: number) {
  const sign = value > 0 ? '↑' : value < 0 ? '↓' : '→'
  return `${sign} ${Math.abs(value)} % vs mois précédent`
}

export function formatShortDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

export function formatRelativeTime(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(diffMs / 60000)
  if (minutes < 1) return "à l'instant"
  if (minutes < 60) return `il y a ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `il y a ${hours} h`
  const days = Math.floor(hours / 24)
  return `il y a ${days} jour${days > 1 ? 's' : ''}`
}

export type AdminExpenseCategory =
  | 'FOURNITURES'
  | 'MAINTENANCE'
  | 'ACHAT_URGENT'
  | 'TRANSPORT'
  | 'AUTRE'

export const ADMIN_EXPENSE_CATEGORY_OPTIONS: Array<{
  value: AdminExpenseCategory
  label: string
  hint: string
}> = [
  { value: 'FOURNITURES', label: 'Fournitures', hint: 'Consommables, produits, petit matériel' },
  { value: 'MAINTENANCE', label: 'Maintenance', hint: 'Entretien, réparations, services' },
  { value: 'ACHAT_URGENT', label: 'Équipements', hint: 'Matériel médical ou technique' },
  { value: 'TRANSPORT', label: 'Transport', hint: 'Déplacements, livraisons, carburant' },
  { value: 'AUTRE', label: 'Autre', hint: 'Dépense hors catégories standard' },
]

export const EXPENSE_STATUS_VARIANT: Record<AdminExpenseRow['status'], string> = {
  PENDING: 'amber',
  VALIDATED: 'green',
  REJECTED: 'rose',
}

export const PAYROLL_STATUS_LABEL: Record<PayrollRow['status'], string> = {
  PENDING: 'En attente ⏳',
  PAID: 'Payé ✅',
  LATE: 'En retard ⚠️',
}
