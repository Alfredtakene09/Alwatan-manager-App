import {
  ClinicExpenseCategory,
  ClinicExpenseStatus,
  InvoiceStatus,
  InvoiceType,
  PayrollStatus,
  UserRole,
} from "@prisma/client";
import { prisma } from "./db.js";
import {
  currentPayrollPeriod,
  ensurePayrollForMonth,
  payrollPeriodBounds,
} from "./admin-payroll.js";
import { netAfterExpenses } from "./cashier-personal-stats.js";
import {
  assessComptableDisbursementSchedule,
  COMPTABLE_DISBURSEMENT_WORKFLOW_HINT,
} from "./gestionnaire-comptable-disbursement.js";
import { buildFinancialKpis } from "./admin-dashboard-stats.js";
import { comptabiliteInvoicePatientWhere } from "./patient-billing.js";
import {
  aggregateCollectedBetween,
  COLLECTED_INVOICE_TYPES,
  invoiceCollectedAt,
  startOfDay,
} from "./revenue-stats.js";

const CASH_REGISTER_ROLES: UserRole[] = [UserRole.RECEPTIONNISTE, UserRole.COMPTABLE];

const EXPENSE_DONUT_COLORS: Record<string, string> = {
  salaires: "#7c3aed",
  fournitures: "#2563eb",
  equipements: "#d97706",
  maintenance: "#0d9488",
  autres: "#64748b",
};

const CARD_SHARE_COLORS: Record<string, string> = {
  revenue: "#16a34a",
  expenses: "#e11d48",
  net: "#2563eb",
  payroll: "#7c3aed",
};

export type CardPeriodKey = "week" | "month" | "year";

function percentChange(current: number, previous: number) {
  if (previous === 0) return current > 0 ? 100 : current < 0 ? -100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}

function shiftCalendarDays(from: Date, deltaDays: number) {
  const date = startOfDay(from);
  date.setDate(date.getDate() + deltaDays);
  return date;
}

function yearBounds(now: Date) {
  const year = now.getFullYear();
  return {
    start: new Date(year, 0, 1),
    end: new Date(year + 1, 0, 1),
  };
}

function previousYearBounds(now: Date) {
  const year = now.getFullYear() - 1;
  return {
    start: new Date(year, 0, 1),
    end: new Date(year + 1, 0, 1),
  };
}

async function sumPeriodCardTotals(from: Date, to: Date) {
  const [revenue, expenses, payrollPaid] = await Promise.all([
    aggregateCollectedBetween(from, to),
    sumValidatedExpensesBetween(from, to),
    sumPayrollPaidBetween(from, to),
  ]);
  const expensesTotal = expenses.totalFcfa + payrollPaid;
  return {
    revenueFcfa: revenue.totalFcfa,
    expensesFcfa: expensesTotal,
    chargesFcfa: expenses.totalFcfa,
    payrollFcfa: payrollPaid,
    netFcfa: revenue.totalFcfa - expensesTotal,
    expenseRows: expenses.rows,
  };
}

function mapCardShares(totals: {
  revenueFcfa: number;
  chargesFcfa: number;
  payrollFcfa: number;
  netFcfa: number;
}) {
  const items = [
    {
      key: "revenue",
      label: "Recettes",
      amountFcfa: totals.revenueFcfa,
      color: CARD_SHARE_COLORS.revenue,
    },
    {
      key: "expenses",
      label: "Dépenses",
      amountFcfa: totals.chargesFcfa,
      color: CARD_SHARE_COLORS.expenses,
    },
    {
      key: "payroll",
      label: "Masse salariale",
      amountFcfa: totals.payrollFcfa,
      color: CARD_SHARE_COLORS.payroll,
    },
  ];
  const total = items.reduce((sum, row) => sum + row.amountFcfa, 0);
  const shares = items.map((row) => ({
    ...row,
    percent: total > 0 ? Math.round((row.amountFcfa / total) * 100) : 0,
  }));
  const absNet = Math.abs(totals.netFcfa);
  const netBase = totals.revenueFcfa > 0 ? totals.revenueFcfa : total;
  return {
    shares,
    netShare: {
      key: "net",
      label: "Bénéfice net",
      amountFcfa: totals.netFcfa,
      color: CARD_SHARE_COLORS.net,
      percent: netBase > 0 ? Math.round((absNet / netBase) * 100) * (totals.netFcfa < 0 ? -1 : 1) : 0,
    },
  };
}

function mapSeriesPercents(
  points: Array<{
    label: string;
    revenueFcfa: number;
    expensesFcfa: number;
    netFcfa: number;
    payrollFcfa: number;
  }>,
) {
  const maxRevenue = Math.max(1, ...points.map((row) => row.revenueFcfa));
  const maxExpenses = Math.max(1, ...points.map((row) => row.expensesFcfa));
  const maxAbsNet = Math.max(1, ...points.map((row) => Math.abs(row.netFcfa)));
  const maxPayroll = Math.max(1, ...points.map((row) => row.payrollFcfa));
  return points.map((row) => ({
    ...row,
    revenuePercent: Math.round((row.revenueFcfa / maxRevenue) * 100),
    expensesPercent: Math.round((row.expensesFcfa / maxExpenses) * 100),
    netPercent: Math.round((Math.abs(row.netFcfa) / maxAbsNet) * 100) * (row.netFcfa < 0 ? -1 : 1),
    payrollPercent: Math.round((row.payrollFcfa / maxPayroll) * 100),
  }));
}

async function buildCardPeriodStats(now = new Date(), dailyFlow: Awaited<ReturnType<typeof buildDailyFlow>>) {
  const { year, month } = currentPayrollPeriod(now);
  const monthBounds = payrollPeriodBounds(year, month);
  const prevMonth = (() => {
    const date = new Date(year, month - 2, 1);
    return payrollPeriodBounds(date.getFullYear(), date.getMonth() + 1);
  })();
  const todayStart = startOfDay(now);
  const tomorrowStart = shiftCalendarDays(todayStart, 1);
  const weekStart = shiftCalendarDays(todayStart, -6);
  const prevWeekStart = shiftCalendarDays(todayStart, -13);
  const prevWeekEnd = weekStart;
  const yearRange = yearBounds(now);
  const prevYearRange = previousYearBounds(now);

  const [
    weekTotals,
    prevWeekTotals,
    monthTotals,
    prevMonthTotals,
    yearTotals,
    prevYearTotals,
  ] = await Promise.all([
    sumPeriodCardTotals(weekStart, tomorrowStart),
    sumPeriodCardTotals(prevWeekStart, prevWeekEnd),
    sumPeriodCardTotals(monthBounds.start, monthBounds.end),
    sumPeriodCardTotals(prevMonth.start, prevMonth.end),
    sumPeriodCardTotals(yearRange.start, yearRange.end),
    sumPeriodCardTotals(prevYearRange.start, prevYearRange.end),
  ]);

  const weekSeriesRaw = dailyFlow.slice(-7).map((row) => ({
    label: row.label,
    revenueFcfa: row.inflowsFcfa,
    expensesFcfa: row.outflowsFcfa,
    netFcfa: row.balanceFcfa,
    payrollFcfa: row.payrollFcfa,
  }));

  const monthSeriesRaw = dailyFlow.slice(-30).map((row) => ({
    label: row.label,
    revenueFcfa: row.inflowsFcfa,
    expensesFcfa: row.outflowsFcfa,
    netFcfa: row.balanceFcfa,
    payrollFcfa: row.payrollFcfa,
  }));

  const yearMonths = Array.from({ length: 12 }, (_, index) => {
    const date = new Date(now.getFullYear(), index, 1);
    return {
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      label: date.toLocaleDateString("fr-FR", { month: "short" }),
      start: new Date(date.getFullYear(), date.getMonth(), 1),
      end: new Date(date.getFullYear(), date.getMonth() + 1, 1),
    };
  });

  const yearSeriesRaw = await Promise.all(
    yearMonths.map(async (period) => {
      if (period.start > now) {
        return {
          label: period.label,
          revenueFcfa: 0,
          expensesFcfa: 0,
          netFcfa: 0,
          payrollFcfa: 0,
        };
      }
      const end = period.end > tomorrowStart ? tomorrowStart : period.end;
      const totals = await sumPeriodCardTotals(period.start, end);
      return {
        label: period.label,
        revenueFcfa: totals.revenueFcfa,
        expensesFcfa: totals.expensesFcfa,
        netFcfa: totals.netFcfa,
        payrollFcfa: totals.payrollFcfa,
      };
    }),
  );

  function pack(
    key: CardPeriodKey,
    label: string,
    current: Awaited<ReturnType<typeof sumPeriodCardTotals>>,
    previous: Awaited<ReturnType<typeof sumPeriodCardTotals>>,
    seriesRaw: Array<{
      label: string;
      revenueFcfa: number;
      expensesFcfa: number;
      netFcfa: number;
      payrollFcfa: number;
    }>,
  ) {
    const { shares, netShare } = mapCardShares(current);
    return {
      key,
      label,
      revenueFcfa: current.revenueFcfa,
      expensesFcfa: current.expensesFcfa,
      netFcfa: current.netFcfa,
      payrollFcfa: current.payrollFcfa,
      revenueChangePercent: percentChange(current.revenueFcfa, previous.revenueFcfa),
      expensesChangePercent: percentChange(current.expensesFcfa, previous.expensesFcfa),
      netChangePercent: percentChange(current.netFcfa, previous.netFcfa),
      payrollChangePercent: percentChange(current.payrollFcfa, previous.payrollFcfa),
      shares,
      netShare,
      changeBars: [
        {
          key: "revenue",
          label: "Recettes",
          amountFcfa: current.revenueFcfa,
          percent: percentChange(current.revenueFcfa, previous.revenueFcfa),
          color: CARD_SHARE_COLORS.revenue,
        },
        {
          key: "expenses",
          label: "Dépenses",
          amountFcfa: current.expensesFcfa,
          percent: percentChange(current.expensesFcfa, previous.expensesFcfa),
          color: CARD_SHARE_COLORS.expenses,
        },
        {
          key: "net",
          label: "Bénéfice net",
          amountFcfa: current.netFcfa,
          percent: percentChange(current.netFcfa, previous.netFcfa),
          color: CARD_SHARE_COLORS.net,
        },
        {
          key: "payroll",
          label: "Masse salariale",
          amountFcfa: current.payrollFcfa,
          percent: percentChange(current.payrollFcfa, previous.payrollFcfa),
          color: CARD_SHARE_COLORS.payroll,
        },
      ],
      series: mapSeriesPercents(seriesRaw),
      expenseBreakdown: mapExpenseBreakdown(current.expenseRows, current.payrollFcfa),
    };
  }

  return {
    week: pack("week", "Semaine", weekTotals, prevWeekTotals, weekSeriesRaw),
    month: pack("month", "Mois", monthTotals, prevMonthTotals, monthSeriesRaw),
    year: pack("year", "Année", yearTotals, prevYearTotals, yearSeriesRaw),
  };
}

function mapExpenseBreakdown(
  rows: Array<{ amountFcfa: number; category: ClinicExpenseCategory }>,
  payrollSalariesFcfa: number,
) {
  const buckets = {
    salaires: payrollSalariesFcfa,
    fournitures: 0,
    equipements: 0,
    maintenance: 0,
    autres: 0,
  };

  for (const row of rows) {
    switch (row.category) {
      case ClinicExpenseCategory.FOURNITURES:
        buckets.fournitures += row.amountFcfa;
        break;
      case ClinicExpenseCategory.MAINTENANCE:
        buckets.maintenance += row.amountFcfa;
        break;
      case ClinicExpenseCategory.ACHAT_URGENT:
        buckets.equipements += row.amountFcfa;
        break;
      default:
        buckets.autres += row.amountFcfa;
        break;
    }
  }

  const items = [
    { key: "salaires", label: "Salaires", amountFcfa: buckets.salaires },
    { key: "fournitures", label: "Fournitures", amountFcfa: buckets.fournitures },
    { key: "equipements", label: "Équipements", amountFcfa: buckets.equipements },
    { key: "maintenance", label: "Maintenance", amountFcfa: buckets.maintenance },
    { key: "autres", label: "Autres", amountFcfa: buckets.autres },
  ];
  const total = items.reduce((sum, row) => sum + row.amountFcfa, 0);
  return items.map((row) => ({
    ...row,
    color: EXPENSE_DONUT_COLORS[row.key] ?? "#64748b",
    percent: total > 0 ? Math.round((row.amountFcfa / total) * 100) : 0,
  }));
}

async function sumValidatedExpensesBetween(from: Date, to: Date) {
  const rows = await prisma.clinicExpense.findMany({
    where: {
      status: ClinicExpenseStatus.VALIDATED,
      businessDate: { gte: from, lt: to },
    },
    select: { amountFcfa: true, category: true },
  });
  return {
    totalFcfa: rows.reduce((sum, row) => sum + row.amountFcfa, 0),
    rows,
  };
}

async function sumPayrollPaidBetween(from: Date, to: Date) {
  const rows = await prisma.employeePayroll.findMany({
    where: {
      status: PayrollStatus.PAID,
      paidAt: { gte: from, lt: to },
    },
    select: { grossFcfa: true },
  });
  return rows.reduce((sum, row) => sum + row.grossFcfa, 0);
}

function lastNDayStarts(count: number, from = new Date()) {
  const days: Date[] = [];
  const anchor = startOfDay(from);
  for (let i = count - 1; i >= 0; i -= 1) {
    const day = new Date(anchor);
    day.setDate(day.getDate() - i);
    days.push(day);
  }
  return days;
}

async function buildDailyFlow(days: number) {
  const dayStarts = lastNDayStarts(days);
  return Promise.all(
    dayStarts.map(async (dayStart) => {
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);
      const [revenue, expenses, payrollPaid] = await Promise.all([
        aggregateCollectedBetween(dayStart, dayEnd),
        sumValidatedExpensesBetween(dayStart, dayEnd),
        sumPayrollPaidBetween(dayStart, dayEnd),
      ]);
      const outflowsFcfa = expenses.totalFcfa + payrollPaid;
      return {
        date: dayStart.toISOString().slice(0, 10),
        label: dayStart.toLocaleDateString("fr-FR", { day: "numeric", month: "short" }),
        inflowsFcfa: revenue.totalFcfa,
        outflowsFcfa,
        payrollFcfa: payrollPaid,
        balanceFcfa: revenue.totalFcfa - outflowsFcfa,
      };
    }),
  );
}

async function computeGlobalCashBalance() {
  const unsettled = await prisma.invoice.findMany({
    where: {
      type: { in: COLLECTED_INVOICE_TYPES },
      status: { not: InvoiceStatus.CANCELLED },
      cashSettlementLine: null,
      issuedBy: { role: { in: CASH_REGISTER_ROLES } },
      ...comptabiliteInvoicePatientWhere(),
      OR: [
        { status: InvoiceStatus.PAID },
        {
          type: InvoiceType.CONSULTATION,
          status: InvoiceStatus.PENDING,
        },
      ],
    },
    select: {
      amountFcfa: true,
      issuedById: true,
      issuedBy: { select: { role: true } },
    },
  });

  const byCashier = new Map<string, { role: UserRole; grossFcfa: number }>();
  for (const invoice of unsettled) {
    const current = byCashier.get(invoice.issuedById) ?? {
      role: invoice.issuedBy.role,
      grossFcfa: 0,
    };
    current.grossFcfa += invoice.amountFcfa;
    byCashier.set(invoice.issuedById, current);
  }

  const settlements = await prisma.receptionCashSettlement.findMany({
    orderBy: { settledAt: "desc" },
    select: { receptionistId: true, settledAt: true },
  });
  const lastSettlementByCashier = new Map<string, Date>();
  for (const row of settlements) {
    if (!lastSettlementByCashier.has(row.receptionistId)) {
      lastSettlementByCashier.set(row.receptionistId, row.settledAt);
    }
  }

  let receptionFcfa = 0;
  let comptableFcfa = 0;

  await Promise.all(
    [...byCashier.entries()].map(async ([cashierId, bucket]) => {
      const since = lastSettlementByCashier.get(cashierId) ?? new Date(0);
      const expenses = await prisma.clinicExpense.aggregate({
        where: {
          paidById: cashierId,
          status: ClinicExpenseStatus.VALIDATED,
          createdAt: { gte: since },
        },
        _sum: { amountFcfa: true },
      });
      const net = netAfterExpenses(bucket.grossFcfa, expenses._sum.amountFcfa ?? 0);
      if (bucket.role === UserRole.RECEPTIONNISTE) {
        receptionFcfa += net;
      } else {
        comptableFcfa += net;
      }
    }),
  );

  return {
    totalFcfa: receptionFcfa + comptableFcfa,
    receptionFcfa,
    comptableFcfa,
  };
}

async function buildCashAlerts() {
  const balance = await computeGlobalCashBalance();
  const unsettled = await prisma.invoice.findMany({
    where: {
      type: { in: COLLECTED_INVOICE_TYPES },
      status: { not: InvoiceStatus.CANCELLED },
      cashSettlementLine: null,
      issuedBy: { role: UserRole.COMPTABLE },
      ...comptabiliteInvoicePatientWhere(),
      OR: [
        { status: InvoiceStatus.PAID },
        {
          type: InvoiceType.CONSULTATION,
          status: InvoiceStatus.PENDING,
        },
      ],
    },
    select: { paidAt: true, createdAt: true, type: true, status: true },
  });

  let oldestPendingBusinessDate: Date | null = null;
  for (const invoice of unsettled) {
    const collectedAt = invoiceCollectedAt(invoice);
    if (!collectedAt) continue;
    const businessDate = startOfDay(collectedAt);
    if (!oldestPendingBusinessDate || businessDate < oldestPendingBusinessDate) {
      oldestPendingBusinessDate = businessDate;
    }
  }

  const settlements = await prisma.receptionCashSettlement.findMany({
    where: {
      receptionist: { role: { not: UserRole.RECEPTIONNISTE } },
    },
    orderBy: { settledAt: "desc" },
    take: 50,
    select: { settledAt: true },
  });

  const lastDisbursementAt = settlements[0]?.settledAt ?? null;
  const now = Date.now();
  const hoursSince = lastDisbursementAt
    ? (now - lastDisbursementAt.getTime()) / 3600000
    : null;
  const pendingFcfa = balance.comptableFcfa;
  const schedule = assessComptableDisbursementSchedule({
    pendingFcfa,
    lastDisbursementAt,
    oldestPendingBusinessDate,
  });

  if (pendingFcfa <= 0 && schedule.phase === "ok") {
    return [];
  }

  return [
    {
      id: "comptabilite" as const,
      label: "Caisse Comptable",
      pendingFcfa,
      lastDisbursementAt: lastDisbursementAt?.toISOString() ?? null,
      hoursSinceLastDisbursement:
        hoursSince != null ? Math.round(hoursSince) : null,
      overdue: schedule.overdue,
      disbursementPhase: schedule.phase,
      disbursementStatusLabel: schedule.statusLabel,
      hint: schedule.scheduleHint,
      workflowHint: COMPTABLE_DISBURSEMENT_WORKFLOW_HINT,
    },
  ];
}

export async function buildGestionnaireDashboardOverview() {
  const now = new Date();
  const { year, month } = currentPayrollPeriod(now);
  await ensurePayrollForMonth(year, month);

  const monthBounds = payrollPeriodBounds(year, month);
  const todayStart = startOfDay(now);
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);

  const [
    cashBalance,
    todayExpenses,
    monthRevenue,
    monthExpenses,
    monthPayrollPaid,
    payrollRows,
    unpaidPayrollCount,
    cashAlerts,
    pendingDayClosures,
    recentDisbursements,
    dailyFlow90,
    monthExpenseRows,
    financialKpis,
  ] = await Promise.all([
    computeGlobalCashBalance(),
    sumValidatedExpensesBetween(todayStart, tomorrowStart),
    aggregateCollectedBetween(monthBounds.start, monthBounds.end),
    sumValidatedExpensesBetween(monthBounds.start, monthBounds.end),
    sumPayrollPaidBetween(monthBounds.start, monthBounds.end),
    prisma.employeePayroll.findMany({
      where: { year, month },
      select: { grossFcfa: true, status: true },
    }),
    prisma.employeePayroll.count({
      where: {
        year,
        month,
        status: { in: [PayrollStatus.PENDING, PayrollStatus.LATE] },
      },
    }),
    buildCashAlerts(),
    prisma.receptionDayClosure.count({ where: { validatedAt: null } }),
    prisma.receptionCashSettlement.findMany({
      where: {
        receptionist: { role: { not: UserRole.RECEPTIONNISTE } },
      },
      orderBy: { settledAt: "desc" },
      take: 5,
      include: {
        receptionist: {
          select: { firstName: true, lastName: true, role: true },
        },
        accountant: { select: { firstName: true, lastName: true } },
        _count: { select: { lines: true } },
      },
    }),
    buildDailyFlow(90),
    sumValidatedExpensesBetween(monthBounds.start, monthBounds.end),
    buildFinancialKpis(now),
  ]);

  const payrollMonthGrossFcfa = payrollRows.reduce((sum, row) => sum + row.grossFcfa, 0);
  const monthOutflowsFcfa = monthExpenses.totalFcfa + monthPayrollPaid;
  const journalBalanceFcfa = monthRevenue.totalFcfa - monthOutflowsFcfa;
  const expenseBreakdown = mapExpenseBreakdown(monthExpenseRows.rows, monthPayrollPaid);
  const cardPeriodStats = await buildCardPeriodStats(now, dailyFlow90);

  const ROLE_GROUP_LABELS: Record<string, string> = {
    RECEPTIONNISTE: "Réception",
    COMPTABLE: "Comptabilité",
    ADMIN: "Administration",
  };

  return {
    financialKpis,
    kpis: {
      globalCashBalanceFcfa: cashBalance.comptableFcfa,
      receptionCashFcfa: cashBalance.receptionFcfa,
      comptableCashFcfa: cashBalance.comptableFcfa,
      expensesTodayFcfa: todayExpenses.totalFcfa,
      payrollMonthGrossFcfa,
      journalBalanceFcfa,
      journalInflowsFcfa: monthRevenue.totalFcfa,
      journalOutflowsFcfa: monthOutflowsFcfa,
    },
    dailyFlow: dailyFlow90,
    cardPeriodStats,
    expenseBreakdown,
    alerts: {
      cashRegisters: cashAlerts,
      pendingExpenses: 0,
      unpaidPayroll: unpaidPayrollCount,
      pendingDayClosures,
    },
    recentDisbursements: recentDisbursements.map((row) => ({
      id: row.id,
      settledAt: row.settledAt.toISOString(),
      amountFcfa: row.disbursementFcfa,
      transactionCount: row._count.lines,
      cashierName: `${row.receptionist.firstName} ${row.receptionist.lastName}`.trim(),
      cashierRole: ROLE_GROUP_LABELS[row.receptionist.role] ?? row.receptionist.role,
      validatedByName: `${row.accountant.firstName} ${row.accountant.lastName}`.trim(),
    })),
    payroll: {
      year,
      month,
      paidCount: payrollRows.filter((row) => row.status === PayrollStatus.PAID).length,
      totalCount: payrollRows.length,
    },
    navBadges: {
      depenses: 0,
      salaires: unpaidPayrollCount,
      caisse: pendingDayClosures,
    },
  };
}

export async function buildGestionnaireNavBadges() {
  const { year, month } = currentPayrollPeriod();
  const [unpaidPayroll, pendingDayClosures] = await Promise.all([
    prisma.employeePayroll.count({
      where: {
        year,
        month,
        status: { in: [PayrollStatus.PENDING, PayrollStatus.LATE] },
      },
    }),
    prisma.receptionDayClosure.count({ where: { validatedAt: null } }),
  ]);
  return { depenses: 0, salaires: unpaidPayroll, caisse: pendingDayClosures };
}
