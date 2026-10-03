import {
  ClinicExpenseCategory,
  ClinicExpenseStatus,
  HospitalizationStatus,
  InvoiceStatus,
  InvoiceType,
  PayrollStatus,
  VisitStatus,
} from "@prisma/client";
import { prisma } from "./db.js";
import { labsPendingApprovalWhere } from "./lab-notes.js";
import {
  aggregateCollectedBetween,
  aggregatePharmacyBetween,
  collectedInvoicesWhere,
  netPaymentAmountsAfterPaidCap,
  startOfDay,
  sumCollectedBreakdown,
} from "./revenue-stats.js";
import { comptabiliteInvoicePatientWhere } from "./patient-billing.js";
import {
  currentPayrollPeriod,
  ensurePayrollForMonth,
  mapEmployeeService,
  payrollCountedWhere,
  payrollPeriodBounds,
} from "./admin-payroll.js";
import { sumSettledDoctorSharesBetween } from "./doctor-share-cash.js";

export type MonthPeriod = { year: number; month: number };

export type OperationsByServiceRow = {
  serviceId: string | null;
  serviceName: string;
  count: number;
  amountFcfa: number;
};

async function buildOperationsByService(
  from: Date,
  to: Date,
): Promise<OperationsByServiceRow[]> {
  const [services, payments, legacyInvoices] = await Promise.all([
    prisma.clinicService.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    }),
    prisma.invoicePayment.findMany({
      where: {
        paidAt: { gte: from, lt: to },
        invoice: {
          status: { not: InvoiceStatus.CANCELLED },
          ...comptabiliteInvoicePatientWhere(),
          OR: [{ type: InvoiceType.SURGERY }, { billingExamKind: "operation" }],
        },
      },
      select: {
        id: true,
        invoiceId: true,
        amountFcfa: true,
        paidAt: true,
        invoice: {
          select: {
            id: true,
            paidAmountFcfa: true,
            surgeryCaseId: true,
            surgeryCase: {
              select: {
                interventionType: {
                  select: {
                    clinicServiceId: true,
                    clinicService: { select: { id: true, name: true } },
                  },
                },
              },
            },
            visit: {
              select: { assignedClinicService: { select: { id: true, name: true } } },
            },
          },
        },
      },
    }),
    prisma.invoice.findMany({
      where: {
        ...collectedInvoicesWhere(from, to),
        payments: { none: {} },
        OR: [{ type: InvoiceType.SURGERY }, { billingExamKind: "operation" }],
      },
      select: {
        id: true,
        amountFcfa: true,
        paidAmountFcfa: true,
        surgeryCaseId: true,
        surgeryCase: {
          select: {
            interventionType: {
              select: {
                clinicServiceId: true,
                clinicService: { select: { id: true, name: true } },
              },
            },
          },
        },
        visit: {
          select: { assignedClinicService: { select: { id: true, name: true } } },
        },
      },
    }),
  ]);

  const byService = new Map<string | null, OperationsByServiceRow>();
  for (const service of services) {
    byService.set(service.id, {
      serviceId: service.id,
      serviceName: service.name,
      count: 0,
      amountFcfa: 0,
    });
  }
  byService.set(null, {
    serviceId: null,
    serviceName: "Sans service",
    count: 0,
    amountFcfa: 0,
  });

  const invoiceIds = [...new Set(payments.map((payment) => payment.invoiceId))];
  const allPaymentsForCap =
    invoiceIds.length === 0
      ? []
      : await prisma.invoicePayment.findMany({
          where: { invoiceId: { in: invoiceIds } },
          select: {
            id: true,
            invoiceId: true,
            amountFcfa: true,
            paidAt: true,
            invoice: { select: { paidAmountFcfa: true } },
          },
        });
  const netByPaymentId = netPaymentAmountsAfterPaidCap(
    allPaymentsForCap.map((payment) => ({
      id: payment.id,
      invoiceId: payment.invoiceId,
      amountFcfa: payment.amountFcfa,
      paidAt: payment.paidAt,
      invoicePaidAmountFcfa: payment.invoice.paidAmountFcfa,
    })),
  );

  const countedIds = new Set<string>();

  function addAmount(
    invoice: {
      id: string;
      surgeryCaseId: string | null;
      surgeryCase: {
        interventionType: {
          clinicServiceId: string | null;
          clinicService: { id: string; name: string } | null;
        };
      } | null;
      visit: { assignedClinicService: { id: string; name: string } | null } | null;
    },
    amountFcfa: number,
  ) {
    if (amountFcfa <= 0) return;
    const service =
      invoice.surgeryCase?.interventionType.clinicService ??
      invoice.visit?.assignedClinicService ??
      null;
    const serviceId =
      invoice.surgeryCase?.interventionType.clinicServiceId ?? service?.id ?? null;
    const key = serviceId;
    const current = byService.get(key) ?? {
      serviceId: key,
      serviceName: service?.name ?? "Sans service",
      count: 0,
      amountFcfa: 0,
    };
    const distinctId = invoice.surgeryCaseId ?? invoice.id;
    if (!countedIds.has(distinctId)) {
      countedIds.add(distinctId);
      current.count += 1;
    }
    current.amountFcfa += amountFcfa;
    byService.set(key, current);
  }

  for (const payment of payments) {
    addAmount(payment.invoice, netByPaymentId.get(payment.id) ?? 0);
  }
  for (const invoice of legacyInvoices) {
    addAmount(invoice, invoice.paidAmountFcfa > 0 ? invoice.paidAmountFcfa : invoice.amountFcfa);
  }

  const rows = [...byService.values()].filter(
    (row) => row.serviceId !== null || row.count > 0,
  );
  rows.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.serviceName.localeCompare(b.serviceName, "fr");
  });
  return rows;
}

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

function toIsoDay(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseIsoDay(value: unknown, fallback: Date): Date {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return startOfDay(fallback);
  }
  const [year, month, day] = value.trim().split("-").map(Number);
  const parsed = new Date(year, month - 1, day);
  if (Number.isNaN(parsed.getTime())) return startOfDay(fallback);
  return startOfDay(parsed);
}

export type DashboardDateRange = {
  from: Date;
  toExclusive: Date;
  fromIso: string;
  toIso: string;
};

export function resolveDashboardDateRange(query: {
  from?: unknown;
  to?: unknown;
} = {}): DashboardDateRange {
  const now = new Date();
  const { year, month } = currentPayrollPeriod(now);
  const monthBounds = payrollPeriodBounds(year, month);
  const defaultTo = startOfDay(new Date(monthBounds.end.getTime() - 1));
  let from = parseIsoDay(query.from, monthBounds.start);
  let toStart = parseIsoDay(query.to, defaultTo);
  if (toStart < from) {
    const swapped = from;
    from = toStart;
    toStart = swapped;
  }
  const maxRangeMs = 366 * 24 * 60 * 60 * 1000;
  if (toStart.getTime() - from.getTime() > maxRangeMs) {
    from = startOfDay(new Date(toStart));
    from.setDate(from.getDate() - 366);
    from = startOfDay(from);
  }
  const toExclusive = new Date(toStart);
  toExclusive.setDate(toExclusive.getDate() + 1);
  return { from, toExclusive, fromIso: toIsoDay(from), toIso: toIsoDay(toStart) };
}

function previousEqualRange(from: Date, toExclusive: Date) {
  const durationMs = toExclusive.getTime() - from.getTime();
  return {
    from: new Date(from.getTime() - durationMs),
    toExclusive: from,
  };
}

function isFullCalendarMonth(from: Date, toExclusive: Date) {
  const expectedEnd = new Date(from.getFullYear(), from.getMonth() + 1, 1);
  return from.getDate() === 1 && toExclusive.getTime() === expectedEnd.getTime();
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

/** Somme totale des salaires bruts du mois (tous statuts) — hors comptes désactivés. */
async function sumPayrollMonthGross(year: number, month: number) {
  const rows = await prisma.employeePayroll.findMany({
    where: { year, month, ...payrollCountedWhere },
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

function mapRevenueBreakdown(
  breakdown: ReturnType<typeof sumCollectedBreakdown>,
  pharmacyFcfa = 0,
) {
  const hospitalizationFcfa =
    breakdown.hospitalizationFcfa;
  const items = [
    { key: "consultations", label: "Consultations", amountFcfa: breakdown.consultationsFcfa },
    { key: "examens", label: "Examens", amountFcfa: breakdown.examsFcfa },
    { key: "operations", label: "Opérations", amountFcfa: breakdown.surgeryFcfa },
    { key: "hospitalisation", label: "Hospitalisation", amountFcfa: hospitalizationFcfa },
    { key: "pharmacie", label: "Pharmacie", amountFcfa: pharmacyFcfa },
  ];
  const knownTotal =
    breakdown.consultationsFcfa +
    breakdown.examsFcfa +
    breakdown.surgeryFcfa +
    hospitalizationFcfa;
  const autres = Math.max(0, breakdown.totalFcfa - knownTotal);
  if (autres > 0) {
    items.push({ key: "autres", label: "Autres", amountFcfa: autres });
  }
  const total = breakdown.totalFcfa + pharmacyFcfa;
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
  doctorSharesReceivedFcfa: number;
  doctorSharesChangePercent: number;
  doctorSharesConsultationFcfa: number;
  doctorSharesSurgeryFcfa: number;
};

export async function buildFinancialKpis(
  now = new Date(),
  range?: { from: Date; toExclusive: Date },
): Promise<FinancialKpis> {
  const currentBounds = range
    ? { start: range.from, end: range.toExclusive }
    : payrollPeriodBounds(
        currentPayrollPeriod(now).year,
        currentPayrollPeriod(now).month,
      );
  const prevRange = range
    ? previousEqualRange(range.from, range.toExclusive)
    : (() => {
        const { year, month } = currentPayrollPeriod(now);
        const prev = shiftMonth(year, month, -1);
        const bounds = payrollPeriodBounds(prev.year, prev.month);
        return { from: bounds.start, toExclusive: bounds.end };
      })();
  const prevBounds = { start: prevRange.from, end: prevRange.toExclusive };
  const useMonthGross = range
    ? isFullCalendarMonth(range.from, range.toExclusive)
    : true;
  const currentMonth = {
    year: currentBounds.start.getFullYear(),
    month: currentBounds.start.getMonth() + 1,
  };
  const prevMonth = {
    year: prevBounds.start.getFullYear(),
    month: prevBounds.start.getMonth() + 1,
  };

  const [
    currentRevenue,
    prevRevenue,
    currentExpenses,
    prevExpenses,
    currentPayrollPaid,
    prevPayrollPaid,
    currentPayrollGross,
    prevPayrollGross,
    currentDoctorShares,
    prevDoctorShares,
  ] = await Promise.all([
    aggregateCollectedBetween(currentBounds.start, currentBounds.end),
    aggregateCollectedBetween(prevBounds.start, prevBounds.end),
    sumValidatedExpensesBetween(currentBounds.start, currentBounds.end),
    sumValidatedExpensesBetween(prevBounds.start, prevBounds.end),
    sumPayrollPaidBetween(currentBounds.start, currentBounds.end),
    sumPayrollPaidBetween(prevBounds.start, prevBounds.end),
    useMonthGross
      ? sumPayrollMonthGross(currentMonth.year, currentMonth.month)
      : Promise.resolve(0),
    useMonthGross
      ? sumPayrollMonthGross(prevMonth.year, prevMonth.month)
      : Promise.resolve(0),
    sumSettledDoctorSharesBetween(currentBounds.start, currentBounds.end),
    sumSettledDoctorSharesBetween(prevBounds.start, prevBounds.end),
  ]);

  const currentPayrollKpi = useMonthGross ? currentPayrollGross : currentPayrollPaid;
  const prevPayrollKpi = useMonthGross ? prevPayrollGross : prevPayrollPaid;

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
    payrollMonthFcfa: currentPayrollKpi,
    payrollChangePercent: percentChange(currentPayrollKpi, prevPayrollKpi),
    doctorSharesReceivedFcfa: currentDoctorShares.totalFcfa,
    doctorSharesChangePercent: percentChange(
      currentDoctorShares.totalFcfa,
      prevDoctorShares.totalFcfa,
    ),
    doctorSharesConsultationFcfa: currentDoctorShares.consultationFcfa,
    doctorSharesSurgeryFcfa: currentDoctorShares.surgeryFcfa,
  };
}

export async function buildAdminDashboardOverview(range?: DashboardDateRange) {
  const now = new Date();
  const { year, month } = currentPayrollPeriod(now);
  const resolved = range ?? resolveDashboardDateRange();
  const currentBounds = { start: resolved.from, end: resolved.toExclusive };
  const prevRange = previousEqualRange(resolved.from, resolved.toExclusive);
  const prevBounds = { start: prevRange.from, end: prevRange.toExclusive };
  const useMonthGross = isFullCalendarMonth(resolved.from, resolved.toExclusive);
  const kpiMonth = {
    year: resolved.from.getFullYear(),
    month: resolved.from.getMonth() + 1,
  };
  const prevKpiMonth = {
    year: prevRange.from.getFullYear(),
    month: prevRange.from.getMonth() + 1,
  };

  await ensurePayrollForMonth(year, month);

  const [
    currentRevenue,
    prevRevenue,
    currentExpenses,
    prevExpenses,
    currentPayrollPaid,
    prevPayrollPaid,
    currentPayrollGross,
    prevPayrollGross,
    currentDoctorShares,
    prevDoctorShares,
    pharmacyMonth,
    recentExpenses,
    employees,
    payrollRows,
    clinical,
    pendingExpensesCount,
    unpaidPayrollCount,
    lowStock,
    pendingDayClosures,
    recentValidations,
    activityLogs,
  ] = await Promise.all([
    aggregateCollectedBetween(currentBounds.start, currentBounds.end),
    aggregateCollectedBetween(prevBounds.start, prevBounds.end),
    sumValidatedExpensesBetween(currentBounds.start, currentBounds.end),
    sumValidatedExpensesBetween(prevBounds.start, prevBounds.end),
    sumPayrollPaidBetween(currentBounds.start, currentBounds.end),
    sumPayrollPaidBetween(prevBounds.start, prevBounds.end),
    useMonthGross
      ? sumPayrollMonthGross(kpiMonth.year, kpiMonth.month)
      : Promise.resolve(0),
    useMonthGross
      ? sumPayrollMonthGross(prevKpiMonth.year, prevKpiMonth.month)
      : Promise.resolve(0),
    sumSettledDoctorSharesBetween(currentBounds.start, currentBounds.end),
    sumSettledDoctorSharesBetween(prevBounds.start, prevBounds.end),
    aggregatePharmacyBetween(currentBounds.start, currentBounds.end),
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
      where: { year, month, ...payrollCountedWhere },
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
    buildClinicalSupervision(now, currentBounds.start, currentBounds.end),
    prisma.clinicExpense.count({ where: { status: ClinicExpenseStatus.PENDING } }),
    prisma.employeePayroll.count({
      where: {
        year,
        month,
        status: { in: [PayrollStatus.PENDING, PayrollStatus.LATE] },
        ...payrollCountedWhere,
      },
    }),
    prisma.product.count({ where: { quantity: { lte: 5 }, active: true } }),
    prisma.receptionDayClosure.count({ where: { validatedAt: null } }),
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

  const currentPayrollKpi = useMonthGross ? currentPayrollGross : currentPayrollPaid;
  const prevPayrollKpi = useMonthGross ? prevPayrollGross : prevPayrollPaid;
  const currentExpensesTotal =
    currentExpenses.totalFcfa + currentPayrollPaid;
  const prevExpensesTotal = prevExpenses.totalFcfa + prevPayrollPaid;
  const currentNet = currentRevenue.totalFcfa - currentExpensesTotal;
  const prevNet = prevRevenue.totalFcfa - prevExpensesTotal;

  const expenseBreakdown = mapExpenseBreakdown(currentExpenses.rows, currentPayrollPaid);
  const operationsByService = await buildOperationsByService(
    currentBounds.start,
    currentBounds.end,
  );

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
      employee.createdAt >= payrollPeriodBounds(year, month).start &&
      employee.createdAt < payrollPeriodBounds(year, month).end
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
      payrollMonthFcfa: currentPayrollKpi,
      payrollChangePercent: percentChange(currentPayrollKpi, prevPayrollKpi),
      doctorSharesReceivedFcfa: currentDoctorShares.totalFcfa,
      doctorSharesChangePercent: percentChange(
        currentDoctorShares.totalFcfa,
        prevDoctorShares.totalFcfa,
      ),
      doctorSharesConsultationFcfa: currentDoctorShares.consultationFcfa,
      doctorSharesSurgeryFcfa: currentDoctorShares.surgeryFcfa,
    },
    period: {
      from: resolved.fromIso,
      to: resolved.toIso,
    },
    monthlyTrend,
    revenueBreakdown: mapRevenueBreakdown(currentRevenue, pharmacyMonth.totalFcfa),
    expenseBreakdown,
    operationsByService,
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
      pendingDayClosures,
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
      caisse: pendingDayClosures,
    },
  };
}

async function buildClinicalSupervision(now: Date, periodFrom?: Date, periodToExclusive?: Date) {
  const todayStart = startOfDay(now);
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);
  const patientsFrom = periodFrom ?? todayStart;
  const patientsTo = periodToExclusive ?? tomorrowStart;

  const [patientsToday, patientsInPeriod, openVisitsToday, examsPending, activeHospitalizations] =
    await Promise.all([
      prisma.visit.count({ where: { createdAt: { gte: todayStart, lt: tomorrowStart } } }),
      prisma.visit.count({ where: { createdAt: { gte: patientsFrom, lt: patientsTo } } }),
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
    patientsInPeriod,
    /** Visites du jour non terminées / non annulées (pas un module RDV). */
    openVisitsToday,
    examsPending,
    activeHospitalizations,
  };
}

export async function buildAdminNavBadges() {
  const { year, month } = currentPayrollPeriod();
  const [pendingExpenses, unpaidPayroll, pendingDayClosures] = await Promise.all([
    prisma.clinicExpense.count({ where: { status: ClinicExpenseStatus.PENDING } }),
    prisma.employeePayroll.count({
      where: {
        year,
        month,
        status: { in: [PayrollStatus.PENDING, PayrollStatus.LATE] },
        ...payrollCountedWhere,
      },
    }),
    prisma.receptionDayClosure.count({ where: { validatedAt: null } }),
  ]);
  return { depenses: pendingExpenses, salaires: unpaidPayroll, caisse: pendingDayClosures };
}
