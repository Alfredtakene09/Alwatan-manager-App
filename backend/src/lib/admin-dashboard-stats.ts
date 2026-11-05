import {
  ClinicExpenseCategory,
  ClinicExpenseStatus,
  HospitalizationStatus,
  PayrollStatus,
  VisitStatus,
} from "@prisma/client";
import { prisma } from "./db.js";
import { labsPendingApprovalWhere } from "./lab-notes.js";
import { startOfDay, sumCollectedBreakdown } from "./revenue-stats.js";
import { sumPeriodFinance, type PeriodFinance } from "./period-finance.js";
import { type OperationCategory } from "./operation-register.js";
import { loadRegisteredOperations } from "./registered-operations.js";
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
  category: OperationCategory;
  serviceId: string | null;
  serviceName: string;
  count: number;
  amountFcfa: number;
};

/**
 * Opérations par service — même périmètre que la page « Opérations » :
 * opérations (bloc + hors bloc) enregistrées dans la période, montant = cumul payé.
 */
export async function buildOperationsByService(
  from: Date,
  to: Date,
): Promise<OperationsByServiceRow[]> {
  const [services, operations] = await Promise.all([
    prisma.clinicService.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    }),
    loadRegisteredOperations(from, to),
  ]);

  const byService = new Map<string, OperationsByServiceRow>();
  for (const service of services) {
    byService.set(`operation:${service.id}`, {
      category: "operation",
      serviceId: service.id,
      serviceName: service.name,
      count: 0,
      amountFcfa: 0,
    });
  }
  byService.set("operation:", {
    category: "operation",
    serviceId: null,
    serviceName: "Sans service",
    count: 0,
    amountFcfa: 0,
  });

  for (const operation of operations) {
    const key = `${operation.category}:${operation.service?.id ?? ""}`;
    const current = byService.get(key) ?? {
      category: operation.category,
      serviceId: operation.service?.id ?? null,
      serviceName: operation.service?.name ?? "Sans service",
      count: 0,
      amountFcfa: 0,
    };
    current.count += 1;
    current.amountFcfa += operation.paidFcfa;
    byService.set(key, current);
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

function shiftMonth(year: number, month: number, delta: number): MonthPeriod {
  const date = new Date(year, month - 1 + delta, 1);
  return { year: date.getFullYear(), month: date.getMonth() + 1 };
}

/** Du premier mois d'enregistrement jusqu'au mois courant (36 mois max). */
function monthsFrom(start: MonthPeriod, end: MonthPeriod): MonthPeriod[] {
  const startIndex = start.year * 12 + (start.month - 1);
  const endIndex = end.year * 12 + (end.month - 1);
  if (startIndex > endIndex) return [end];
  const fromIndex = endIndex - startIndex + 1 > 36 ? endIndex - 35 : startIndex;
  const periods: MonthPeriod[] = [];
  for (let index = fromIndex; index <= endIndex; index += 1) {
    periods.push({ year: Math.floor(index / 12), month: (index % 12) + 1 });
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

/** Premier et dernier jour où un dossier a réellement été enregistré. */
export async function registrationSpan(): Promise<DashboardDateRange | null> {
  const [first, last, firstExpense, lastExpense] = await Promise.all([
    prisma.patient.findFirst({
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
    prisma.patient.findFirst({
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    prisma.clinicExpense.findFirst({
      where: { status: ClinicExpenseStatus.VALIDATED },
      orderBy: { businessDate: "asc" },
      select: { businessDate: true },
    }),
    prisma.clinicExpense.findFirst({
      where: { status: ClinicExpenseStatus.VALIDATED },
      orderBy: { businessDate: "desc" },
      select: { businessDate: true },
    }),
  ]);
  // businessDate est une date SQL (minuit UTC) : on la relit comme jour calendaire local.
  const businessDay = (d?: Date) =>
    d ? new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) : undefined;
  const starts = [first?.createdAt, businessDay(firstExpense?.businessDate)].filter(
    (d): d is Date => !!d,
  );
  const ends = [last?.createdAt, businessDay(lastExpense?.businessDate)].filter(
    (d): d is Date => !!d,
  );
  if (!starts.length || !ends.length) return null;
  const from = startOfDay(new Date(Math.min(...starts.map((d) => d.getTime()))));
  const toStart = startOfDay(new Date(Math.max(...ends.map((d) => d.getTime()))));
  const toExclusive = new Date(toStart);
  toExclusive.setDate(toExclusive.getDate() + 1);
  return { from, toExclusive, fromIso: toIsoDay(from), toIso: toIsoDay(toStart) };
}

/** Sans dates choisies, la période est celle des enregistrements, pas le mois calendaire. */
export async function resolveRequestedDashboardRange(query: {
  from?: unknown;
  to?: unknown;
} = {}): Promise<DashboardDateRange> {
  const from = typeof query.from === "string" ? query.from.trim() : "";
  const to = typeof query.to === "string" ? query.to.trim() : "";
  if (from || to) return resolveDashboardDateRange(query);
  return (await registrationSpan()) ?? resolveDashboardDateRange();
}

function formatFrDay(iso: string) {
  const [year, month, day] = iso.split("-");
  return `${day}-${month}-${year}`;
}

function registrationRangeLabel(fromIso: string, toIso: string) {
  if (fromIso === toIso) return formatFrDay(fromIso);
  return `${formatFrDay(fromIso)} – ${formatFrDay(toIso)}`;
}

function clipToRange(period: MonthPeriod, from: Date, toExclusive: Date) {
  const month = payrollPeriodBounds(period.year, period.month);
  const start = from > month.start ? from : month.start;
  const end = toExclusive < month.end ? toExclusive : month.end;
  if (start >= end) return null;
  const inclusiveEnd = new Date(end);
  inclusiveEnd.setDate(inclusiveEnd.getDate() - 1);
  return {
    start,
    end,
    fromIso: toIsoDay(start),
    toIso: toIsoDay(startOfDay(inclusiveEnd)),
  };
}

function previousEqualRange(from: Date, toExclusive: Date) {
  const durationMs = toExclusive.getTime() - from.getTime();
  return {
    from: new Date(from.getTime() - durationMs),
    toExclusive: from,
  };
}

function mapExpenseBreakdown(
  rows: Array<{ amountFcfa: number; category: ClinicExpenseCategory }>,
  payrollSalariesFcfa: number,
  doctorSharesCashFcfa = 0,
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
    { key: "parts_medecins", label: "Parts médecins", amountFcfa: doctorSharesCashFcfa },
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
  entriesMonthFcfa: number;
  /** Sorties validées du module Dépenses seules (hors paie et parts médecins). */
  expensesModuleFcfa: number;
  netMonthFcfa: number;
  netChangePercent: number;
  /** Salaires et avances réellement versés sur la période. */
  payrollMonthFcfa: number;
  payrollChangePercent: number;
  payrollSalariesFcfa: number;
  payrollAdvancesFcfa: number;
  doctorSharesReceivedFcfa: number;
  doctorSharesChangePercent: number;
  doctorSharesConsultationFcfa: number;
  doctorSharesSurgeryFcfa: number;
};

function financialKpisFrom(
  current: PeriodFinance,
  prev: PeriodFinance,
  currentDoctorShares: Awaited<ReturnType<typeof sumSettledDoctorSharesBetween>>,
  prevDoctorShares: Awaited<ReturnType<typeof sumSettledDoctorSharesBetween>>,
): FinancialKpis {
  return {
    revenueMonthFcfa: current.revenueFcfa,
    revenueChangePercent: percentChange(current.revenueFcfa, prev.revenueFcfa),
    expensesMonthFcfa: current.outflowsFcfa,
    expensesChangePercent: percentChange(current.outflowsFcfa, prev.outflowsFcfa),
    entriesMonthFcfa: current.entriesFcfa,
    expensesModuleFcfa: current.chargesFcfa,
    netMonthFcfa: current.netFcfa,
    netChangePercent: percentChange(current.netFcfa, prev.netFcfa),
    payrollMonthFcfa: current.payrollFcfa,
    payrollChangePercent: percentChange(current.payrollFcfa, prev.payrollFcfa),
    payrollSalariesFcfa: current.payrollSalariesFcfa,
    payrollAdvancesFcfa: current.payrollAdvancesFcfa,
    doctorSharesReceivedFcfa: currentDoctorShares.totalFcfa,
    doctorSharesChangePercent: percentChange(
      currentDoctorShares.totalFcfa,
      prevDoctorShares.totalFcfa,
    ),
    doctorSharesConsultationFcfa: currentDoctorShares.consultationFcfa,
    doctorSharesSurgeryFcfa: currentDoctorShares.surgeryFcfa,
  };
}

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

  const [current, prev, currentDoctorShares, prevDoctorShares] =
    await Promise.all([
      sumPeriodFinance(currentBounds.start, currentBounds.end),
      sumPeriodFinance(prevRange.from, prevRange.toExclusive),
      sumSettledDoctorSharesBetween(currentBounds.start, currentBounds.end),
      sumSettledDoctorSharesBetween(prevRange.from, prevRange.toExclusive),
    ]);
  return financialKpisFrom(current, prev, currentDoctorShares, prevDoctorShares);
}

export async function buildAdminDashboardOverview(range?: DashboardDateRange) {
  const now = new Date();
  const { year, month } = currentPayrollPeriod(now);
  const resolved = range ?? resolveDashboardDateRange();
  const currentBounds = { start: resolved.from, end: resolved.toExclusive };
  const prevRange = previousEqualRange(resolved.from, resolved.toExclusive);
  const prevBounds = { start: prevRange.from, end: prevRange.toExclusive };

  await ensurePayrollForMonth(year, month);

  const [
    current,
    prev,
    currentDoctorShares,
    prevDoctorShares,
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
    sumPeriodFinance(currentBounds.start, currentBounds.end),
    sumPeriodFinance(prevBounds.start, prevBounds.end),
    sumSettledDoctorSharesBetween(currentBounds.start, currentBounds.end),
    sumSettledDoctorSharesBetween(prevBounds.start, prevBounds.end),
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

  const expenseBreakdown = mapExpenseBreakdown(
    current.expenseRows,
    current.payrollFcfa,
    current.doctorSharesCashFcfa,
  );
  const operationsByService = await buildOperationsByService(
    currentBounds.start,
    currentBounds.end,
  );

  const span = await registrationSpan();
  const trendFrom = span && resolved.from < span.from ? span.from : resolved.from;
  const trendTo =
    span && resolved.toExclusive > span.toExclusive ? span.toExclusive : resolved.toExclusive;
  const trendEndDay = new Date(trendTo);
  trendEndDay.setDate(trendEndDay.getDate() - 1);
  const trendPeriods =
    trendFrom < trendTo
      ? monthsFrom(
          { year: trendFrom.getFullYear(), month: trendFrom.getMonth() + 1 },
          { year: trendEndDay.getFullYear(), month: trendEndDay.getMonth() + 1 },
        )
      : [];
  const monthlyTrend = (
    await Promise.all(
      trendPeriods.map(async (period) => {
        const bounds = clipToRange(period, trendFrom, trendTo);
        if (!bounds) return null;
        const finance = await sumPeriodFinance(bounds.start, bounds.end);
        return {
          year: period.year,
          month: period.month,
          label: registrationRangeLabel(bounds.fromIso, bounds.toIso),
          fromIso: bounds.fromIso,
          toIso: bounds.toIso,
          revenueFcfa: finance.revenueFcfa,
          entriesFcfa: finance.entriesFcfa,
          expensesFcfa: finance.outflowsFcfa,
          netFcfa: finance.netFcfa,
        };
      }),
    )
  ).filter((row) => row != null);

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
    financialKpis: financialKpisFrom(
      current,
      prev,
      currentDoctorShares,
      prevDoctorShares,
    ),
    period: {
      from: resolved.fromIso,
      to: resolved.toIso,
    },
    monthlyTrend,
    revenueBreakdown: mapRevenueBreakdown(current.collected, current.pharmacyFcfa),
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
