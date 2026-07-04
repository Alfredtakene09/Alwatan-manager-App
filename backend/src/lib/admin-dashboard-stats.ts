import {
  ClinicExpenseCategory,
  ClinicExpenseStatus,
  HospitalizationStatus,
  PayrollStatus,
  VisitStatus,
} from "@prisma/client";
import { prisma } from "./db.js";
import { labsPendingApprovalWhere } from "./lab-notes.js";
import {
  aggregateCollectedBetween,
  sumCollectedBreakdown,
  collectedInvoicesWhere,
  startOfDay,
} from "./revenue-stats.js";
import {
  currentPayrollPeriod,
  ensurePayrollForMonth,
  mapEmployeeService,
  payrollPeriodBounds,
} from "./admin-payroll.js";

export type MonthPeriod = { year: number; month: number };

function percentChange(current: number, previous: number) {
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}

function monthLabel(year: number, month: number) {
  return new Date(year, month - 1, 1).toLocaleDateString("fr-FR", {
    month: "short",
    year: "numeric",
  });
}

function shiftMonth(year: number, month: number, delta: number): MonthPeriod {
  const date = new Date(year, month - 1 + delta, 1);
  return { year: date.getFullYear(), month: date.getMonth() + 1 };
}

function lastNMonths(count: number, from = new Date()): MonthPeriod[] {
  const { year, month } = currentPayrollPeriod(from);
  const periods: MonthPeriod[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    periods.push(shiftMonth(year, month, -i));
  }
  return periods;
}

async function sumValidatedExpensesBetween(from: Date, to: Date) {
  const rows = await prisma.clinicExpense.findMany({
    where: {
      status: ClinicExpenseStatus.VALIDATED,
      businessDate: { gte: from, lt: to },
    },
    select: { amountFcfa: true, category: true },
  });
  const totalFcfa = rows.reduce((sum, row) => sum + row.amountFcfa, 0);
  return { totalFcfa, rows };
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

  return [
    { key: "salaires", label: "Salaires", amountFcfa: buckets.salaires },
    { key: "fournitures", label: "Fournitures", amountFcfa: buckets.fournitures },
    { key: "equipements", label: "Équipements", amountFcfa: buckets.equipements },
    { key: "maintenance", label: "Maintenance", amountFcfa: buckets.maintenance },
    { key: "autres", label: "Autres", amountFcfa: buckets.autres },
  ];
}

function mapRevenueBreakdown(breakdown: ReturnType<typeof sumCollectedBreakdown>) {
  const hospitalizationFcfa =
    breakdown.hospitalizationFcfa;
  const items = [
    { key: "consultations", label: "Consultations", amountFcfa: breakdown.consultationsFcfa },
    { key: "examens", label: "Examens", amountFcfa: breakdown.examsFcfa },
    { key: "operations", label: "Opérations", amountFcfa: breakdown.surgeryFcfa },
    { key: "hospitalisation", label: "Hospitalisation", amountFcfa: hospitalizationFcfa },
  ];
  const knownTotal = items.reduce((sum, row) => sum + row.amountFcfa, 0);
  const autres = Math.max(0, breakdown.totalFcfa - knownTotal);
  if (autres > 0) {
    items.push({ key: "autres", label: "Autres", amountFcfa: autres });
  }
  const total = breakdown.totalFcfa;
  return items.map((row) => ({
    ...row,
    percent: total > 0 ? Math.round((row.amountFcfa / total) * 100) : 0,
  }));
}

function formatActivityEntry(log: {
  action: string;
  entity: string;
  metadata: unknown;
  createdAt: Date;
}) {
  const meta = (log.metadata ?? {}) as Record<string, unknown>;
  const amount =
    typeof meta.amountFcfa === "number"
      ? meta.amountFcfa
      : typeof meta.grossFcfa === "number"
        ? meta.grossFcfa
        : null;

  if (log.entity === "ClinicExpense" && log.action === "VALIDATE") {
    const label = typeof meta.label === "string" ? meta.label : "Dépense";
    return `Dépense validée — ${label}${amount != null ? ` — ${amount.toLocaleString("fr-FR")} FCFA` : ""}`;
  }
  if (log.entity === "EmployeePayroll" && log.action === "PAY") {
    const name = typeof meta.employeeName === "string" ? meta.employeeName : "Employé";
    return `Salaire de ${name} payé`;
  }
  if (log.entity === "ClinicExpense" && log.action === "CREATE") {
    return `Nouvelle dépense enregistrée`;
  }
  return `${log.action} — ${log.entity}`;
}

export type FinancialKpis = {
  revenueMonthFcfa: number;
  revenueChangePercent: number;
  expensesMonthFcfa: number;
  expensesChangePercent: number;
  netMonthFcfa: number;
  netChangePercent: number;
  payrollMonthFcfa: number;
  payrollChangePercent: number;
};

export async function buildFinancialKpis(now = new Date()): Promise<FinancialKpis> {
  const { year, month } = currentPayrollPeriod(now);
  const prev = shiftMonth(year, month, -1);
  const currentBounds = payrollPeriodBounds(year, month);
  const prevBounds = payrollPeriodBounds(prev.year, prev.month);

  const [
    currentRevenue,
    prevRevenue,
    currentExpenses,
    prevExpenses,
    currentPayrollPaid,
    prevPayrollPaid,
  ] = await Promise.all([
    aggregateCollectedBetween(currentBounds.start, currentBounds.end),
    aggregateCollectedBetween(prevBounds.start, prevBounds.end),
    sumValidatedExpensesBetween(currentBounds.start, currentBounds.end),
    sumValidatedExpensesBetween(prevBounds.start, prevBounds.end),
    sumPayrollPaidBetween(currentBounds.start, currentBounds.end),
    sumPayrollPaidBetween(prevBounds.start, prevBounds.end),
  ]);

  const currentExpensesTotal = currentExpenses.totalFcfa + currentPayrollPaid;
  const prevExpensesTotal = prevExpenses.totalFcfa + prevPayrollPaid;
  const currentNet = currentRevenue.totalFcfa - currentExpensesTotal;
  const prevNet = prevRevenue.totalFcfa - prevExpensesTotal;

  return {
    revenueMonthFcfa: currentRevenue.totalFcfa,
    revenueChangePercent: percentChange(currentRevenue.totalFcfa, prevRevenue.totalFcfa),
    expensesMonthFcfa: currentExpensesTotal,
    expensesChangePercent: percentChange(currentExpensesTotal, prevExpensesTotal),
    netMonthFcfa: currentNet,
    netChangePercent: percentChange(currentNet, prevNet),
    payrollMonthFcfa: currentPayrollPaid,
    payrollChangePercent: percentChange(currentPayrollPaid, prevPayrollPaid),
  };
}

export async function buildAdminDashboardOverview() {
  const now = new Date();
  const { year, month } = currentPayrollPeriod(now);
  const prev = shiftMonth(year, month, -1);

  await ensurePayrollForMonth(year, month);

  const currentBounds = payrollPeriodBounds(year, month);
  const prevBounds = payrollPeriodBounds(prev.year, prev.month);

  const [
    currentRevenue,
    prevRevenue,
    currentExpenses,
    prevExpenses,
    currentPayrollPaid,
    prevPayrollPaid,
    monthInvoices,
    recentExpenses,
    employees,
    payrollRows,
    clinical,
    pendingExpensesCount,
    unpaidPayrollCount,
    lowStock,
    recentValidations,
    activityLogs,
  ] = await Promise.all([
    aggregateCollectedBetween(currentBounds.start, currentBounds.end),
    aggregateCollectedBetween(prevBounds.start, prevBounds.end),
    sumValidatedExpensesBetween(currentBounds.start, currentBounds.end),
    sumValidatedExpensesBetween(prevBounds.start, prevBounds.end),
    sumPayrollPaidBetween(currentBounds.start, currentBounds.end),
    sumPayrollPaidBetween(prevBounds.start, prevBounds.end),
    prisma.invoice.findMany({
      where: collectedInvoicesWhere(currentBounds.start, currentBounds.end),
      select: {
        type: true,
        status: true,
        amountFcfa: true,
        paidAt: true,
        createdAt: true,
      },
    }),
    prisma.clinicExpense.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      include: {
        paidBy: { select: { firstName: true, lastName: true } },
      },
    }),
    prisma.employee.findMany({
      where: { active: true },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        jobTitle: true,
        isMedecin: true,
        createdAt: true,
        user: { select: { role: true } },
      },
    }),
    prisma.employeePayroll.findMany({
      where: { year, month },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            jobTitle: true,
            isMedecin: true,
            user: { select: { role: true } },
          },
        },
      },
      orderBy: [{ status: "asc" }, { employee: { lastName: "asc" } }],
    }),
    buildClinicalSupervision(now),
    prisma.clinicExpense.count({ where: { status: ClinicExpenseStatus.PENDING } }),
    prisma.employeePayroll.count({
      where: {
        year,
        month,
        status: { in: [PayrollStatus.PENDING, PayrollStatus.LATE] },
      },
    }),
    prisma.product.count({ where: { quantity: { lte: 5 }, active: true } }),
    prisma.clinicExpense.findMany({
      where: { status: ClinicExpenseStatus.VALIDATED, validatedAt: { not: null } },
      orderBy: { validatedAt: "desc" },
      take: 5,
      select: { id: true, label: true, amountFcfa: true, validatedAt: true },
    }),
    prisma.auditLog.findMany({
      where: {
        OR: [
          { entity: "ClinicExpense" },
          { entity: "EmployeePayroll" },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: {
        user: { select: { firstName: true, lastName: true, role: true } },
      },
    }),
  ]);

  const currentExpensesTotal =
    currentExpenses.totalFcfa + currentPayrollPaid;
  const prevExpensesTotal = prevExpenses.totalFcfa + prevPayrollPaid;
  const currentNet = currentRevenue.totalFcfa - currentExpensesTotal;
  const prevNet = prevRevenue.totalFcfa - prevExpensesTotal;

  const monthBreakdown = sumCollectedBreakdown(monthInvoices);
  const expenseBreakdown = mapExpenseBreakdown(currentExpenses.rows, currentPayrollPaid);

  const monthlyTrend = await Promise.all(
    lastNMonths(12).map(async (period) => {
      const bounds = payrollPeriodBounds(period.year, period.month);
      const [revenue, expenses, payrollPaid] = await Promise.all([
        aggregateCollectedBetween(bounds.start, bounds.end),
        sumValidatedExpensesBetween(bounds.start, bounds.end),
        sumPayrollPaidBetween(bounds.start, bounds.end),
      ]);
      const expensesTotal = expenses.totalFcfa + payrollPaid;
      return {
        year: period.year,
        month: period.month,
        label: monthLabel(period.year, period.month),
        revenueFcfa: revenue.totalFcfa,
        expensesFcfa: expensesTotal,
        netFcfa: revenue.totalFcfa - expensesTotal,
      };
    }),
  );

  const serviceCounts: Record<string, number> = {};
  let newThisMonth = 0;
  for (const employee of employees) {
    const service = mapEmployeeService(employee);
    serviceCounts[service] = (serviceCounts[service] ?? 0) + 1;
    if (
      employee.createdAt >= currentBounds.start &&
      employee.createdAt < currentBounds.end
    ) {
      newThisMonth += 1;
    }
  }

  const payrollPaidCount = payrollRows.filter((row) => row.status === PayrollStatus.PAID).length;

  const CATEGORY_LABELS: Record<ClinicExpenseCategory, string> = {
    FOURNITURES: "Fournitures",
    TRANSPORT: "Transport",
    MAINTENANCE: "Maintenance",
    ACHAT_URGENT: "Équipements",
    AUTRE: "Autre",
  };

  const STATUS_LABELS: Record<ClinicExpenseStatus, string> = {
    PENDING: "En attente",
    VALIDATED: "Validée",
    REJECTED: "Rejetée",
  };

  return {
    financialKpis: {
      revenueMonthFcfa: currentRevenue.totalFcfa,
      revenueChangePercent: percentChange(currentRevenue.totalFcfa, prevRevenue.totalFcfa),
      expensesMonthFcfa: currentExpensesTotal,
      expensesChangePercent: percentChange(currentExpensesTotal, prevExpensesTotal),
      netMonthFcfa: currentNet,
      netChangePercent: percentChange(currentNet, prevNet),
      payrollMonthFcfa: currentPayrollPaid,
      payrollChangePercent: percentChange(currentPayrollPaid, prevPayrollPaid),
    },
    monthlyTrend,
    revenueBreakdown: mapRevenueBreakdown(monthBreakdown),
    expenseBreakdown,
    recentExpenses: recentExpenses.map((row) => ({
      id: row.id,
      date: row.businessDate.toISOString().slice(0, 10),
      category: CATEGORY_LABELS[row.category],
      description: row.label,
      amountFcfa: row.amountFcfa,
      status: row.status,
      statusLabel: STATUS_LABELS[row.status],
    })),
    employees: {
      totalActive: employees.length,
      newThisMonth,
      byService: Object.entries(serviceCounts).map(([service, count]) => ({ service, count })),
    },
    payroll: {
      year,
      month,
      paidCount: payrollPaidCount,
      totalCount: payrollRows.length,
      rows: payrollRows.map((row) => ({
        id: row.id,
        employeeName: `${row.employee.firstName} ${row.employee.lastName}`.trim(),
        jobTitle: row.employee.jobTitle,
        grossFcfa: row.grossFcfa,
        status: row.status,
      })),
    },
    clinical,
    alerts: {
      pendingExpenses: pendingExpensesCount,
      unpaidPayroll: unpaidPayrollCount,
      lowStock,
      recentValidations: recentValidations.map((row) => ({
        id: row.id,
        label: row.label,
        amountFcfa: row.amountFcfa,
        validatedAt: row.validatedAt?.toISOString() ?? null,
      })),
    },
    activityJournal: activityLogs.map((log) => ({
      id: log.id,
      message: formatActivityEntry(log),
      actorName: log.user
        ? `${log.user.firstName} ${log.user.lastName}`.trim()
        : "Système",
      createdAt: log.createdAt.toISOString(),
    })),
    navBadges: {
      depenses: pendingExpensesCount,
      salaires: unpaidPayrollCount,
    },
  };
}

async function buildClinicalSupervision(now: Date) {
  const todayStart = startOfDay(now);
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);

  const [patientsToday, appointmentsToday, examsPending, activeHospitalizations] =
    await Promise.all([
      prisma.visit.count({ where: { createdAt: { gte: todayStart, lt: tomorrowStart } } }),
      prisma.visit.count({
        where: {
          createdAt: { gte: todayStart, lt: tomorrowStart },
          status: {
            notIn: [VisitStatus.COMPLETED, VisitStatus.CANCELLED],
          },
        },
      }),
      prisma.consultation.count({ where: labsPendingApprovalWhere() }),
      prisma.hospitalization.count({
        where: { status: HospitalizationStatus.ACTIVE },
      }),
    ]);

  return {
    patientsToday,
    appointmentsToday,
    examsPending,
    activeHospitalizations,
  };
}

export async function buildAdminNavBadges() {
  const { year, month } = currentPayrollPeriod();
  const [pendingExpenses, unpaidPayroll] = await Promise.all([
    prisma.clinicExpense.count({ where: { status: ClinicExpenseStatus.PENDING } }),
    prisma.employeePayroll.count({
      where: {
        year,
        month,
        status: { in: [PayrollStatus.PENDING, PayrollStatus.LATE] },
      },
    }),
  ]);
  return { depenses: pendingExpenses, salaires: unpaidPayroll };
}
