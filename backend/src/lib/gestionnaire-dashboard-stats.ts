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
    expenseBreakdown,
    alerts: {
      cashRegisters: cashAlerts,
      pendingExpenses: 0,
      unpaidPayroll: unpaidPayrollCount,
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
    },
  };
}

export async function buildGestionnaireNavBadges() {
  const { year, month } = currentPayrollPeriod();
  const unpaidPayroll = await prisma.employeePayroll.count({
    where: {
      year,
      month,
      status: { in: [PayrollStatus.PENDING, PayrollStatus.LATE] },
    },
  });
  return { depenses: 0, salaires: unpaidPayroll };
}
