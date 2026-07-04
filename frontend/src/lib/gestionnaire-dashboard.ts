import type { FinancialKpis } from './admin-dashboard'

export type GestionnaireKpis = {
  globalCashBalanceFcfa: number
  receptionCashFcfa: number
  comptableCashFcfa: number
  expensesTodayFcfa: number
  payrollMonthGrossFcfa: number
  journalBalanceFcfa: number
  journalInflowsFcfa: number
  journalOutflowsFcfa: number
}

export type DailyFlowPoint = {
  date: string
  label: string
  inflowsFcfa: number
  outflowsFcfa: number
  balanceFcfa: number
}

export type ExpenseDonutSlice = {
  key: string
  label: string
  amountFcfa: number
  percent: number
  color: string
}

export type ComptableDisbursementPhase =
  | 'ok'
  | 'during_day'
  | 'evening_due'
  | 'morning_due'
  | 'carry_over'

export type CashRegisterAlert = {
  id: 'comptabilite'
  label: string
  pendingFcfa: number
  lastDisbursementAt: string | null
  hoursSinceLastDisbursement: number | null
  overdue: boolean
  disbursementPhase?: ComptableDisbursementPhase
  disbursementStatusLabel?: string
  hint?: string
  workflowHint?: string
}

export type RecentDisbursement = {
  id: string
  settledAt: string
  amountFcfa: number
  transactionCount: number
  cashierName: string
  cashierRole: string
  validatedByName: string
}

export type GestionnaireDashboardOverview = {
  financialKpis: FinancialKpis
  kpis: GestionnaireKpis
  dailyFlow: DailyFlowPoint[]
  expenseBreakdown: ExpenseDonutSlice[]
  alerts: {
    cashRegisters: CashRegisterAlert[]
    pendingExpenses: number
    unpaidPayroll: number
  }
  recentDisbursements: RecentDisbursement[]
  payroll: {
    year: number
    month: number
    paidCount: number
    totalCount: number
  }
  navBadges: {
    depenses: number
    salaires: number
  }
}

export type FlowFilter = 7 | 30 | 90

export function filterDailyFlow(points: DailyFlowPoint[], days: FlowFilter) {
  return points.slice(-days)
}

export function formatDateTimeFr(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatShortTimeFr(iso: string) {
  return new Date(iso).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Libellé lisible pour un retard de décaissement. */
export function formatCashDelayLabel(hours: number | null, lastAt: string | null) {
  if (lastAt) {
    return `Dernier passage le ${formatDateTimeFr(lastAt)}`
  }
  if (hours == null) return 'Aucun décaissement enregistré'
  if (hours < 1) return 'Depuis moins d\'une heure'
  if (hours < 24) return `Depuis ${hours} h`
  const days = Math.floor(hours / 24)
  const rem = hours % 24
  if (rem === 0) return `Depuis ${days} jour${days > 1 ? 's' : ''}`
  return `Depuis ${days} j ${rem} h`
}

export function comptableScheduleBadgeLabel(phase?: ComptableDisbursementPhase) {
  switch (phase) {
    case 'evening_due':
      return 'Collecte soir'
    case 'morning_due':
      return 'Collecte matin'
    case 'carry_over':
      return 'Report veille'
    case 'during_day':
      return 'Créneaux matin / soir / nuit'
    default:
      return ''
  }
}
