import {
  ClinicExpenseStatus,
  InvoiceStatus,
  InvoiceType,
  PayrollStatus,
} from "@prisma/client";
import { prisma } from "./db.js";
import { comptabiliteInvoicePatientWhere } from "./patient-billing.js";
import {
  COLLECTED_INVOICE_TYPES,
  INVOICE_TYPE_LABELS,
  invoiceCollectedAt,
  startOfDay,
} from "./revenue-stats.js";

export type JournalCategory =
  | "CONSULTATION"
  | "EXAMEN"
  | "SALAIRE"
  | "DEPENSE"
  | "DECAISSEMENT"
  | "OPERATION"
  | "HOSPITALISATION"
  | "AUTRE";

export type JournalEntryType = "ENTREE" | "SORTIE";

export type JournalEntry = {
  id: string;
  occurredAt: string;
  label: string;
  category: JournalCategory;
  categoryLabel: string;
  type: JournalEntryType;
  inflowFcfa: number;
  outflowFcfa: number;
  reference: string;
  source: string;
};

export type JournalFilters = {
  from?: Date;
  to?: Date;
  type?: "all" | "ENTREE" | "SORTIE";
  category?: JournalCategory | "all";
  minAmount?: number;
  maxAmount?: number;
  search?: string;
};

const CATEGORY_LABELS: Record<JournalCategory, string> = {
  CONSULTATION: "Consultation",
  EXAMEN: "Examen",
  SALAIRE: "Salaire",
  DEPENSE: "Dépense",
  DECAISSEMENT: "Décaissement",
  OPERATION: "Opération",
  HOSPITALISATION: "Hospitalisation",
  AUTRE: "Autre",
};

function invoiceCategory(type: InvoiceType): JournalCategory {
  switch (type) {
    case InvoiceType.CONSULTATION:
      return "CONSULTATION";
    case InvoiceType.LAB_EXAM:
      return "EXAMEN";
    case InvoiceType.SURGERY:
      return "OPERATION";
    case InvoiceType.HOSPITALIZATION_DEPOSIT:
    case InvoiceType.HOSPITALIZATION_FINAL:
      return "HOSPITALISATION";
    default:
      return "AUTRE";
  }
}

function inPeriod(date: Date, from?: Date, to?: Date) {
  if (from && date < from) return false;
  if (to && date >= to) return false;
  return true;
}

export type JournalDayLine = {
  type: JournalEntryType;
  label: string;
  amountFcfa: number;
  variant: "header" | "sub" | "item";
};

export type JournalDaySummary = {
  date: string;
  label: string;
  inflowsFcfa: number;
  outflowsFcfa: number;
  balanceFcfa: number;
  lines: JournalDayLine[];
};

export type JournalMonthDailySummary = {
  year: number;
  month: number;
  monthLabel: string;
  inflowsFcfa: number;
  outflowsFcfa: number;
  balanceFcfa: number;
  days: JournalDaySummary[];
};

function formatDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function enumeratePeriodDays(from?: Date, to?: Date) {
  if (!from || !to) return [] as string[];
  const days: string[] = [];
  const cursor = startOfDay(from);
  const end = startOfDay(to);
  while (cursor < end) {
    days.push(formatDateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function buildDayLines(dayEntries: JournalEntry[]): JournalDayLine[] {
  const lines: JournalDayLine[] = [];
  const inflows = dayEntries.filter((entry) => entry.type === "ENTREE");
  const outflows = dayEntries.filter((entry) => entry.type === "SORTIE");

  if (inflows.length) {
    const inflowTotal = inflows.reduce((sum, entry) => sum + entry.inflowFcfa, 0);
    lines.push({
      type: "ENTREE",
      label: "Recettes journalières",
      amountFcfa: inflowTotal,
      variant: "header",
    });
  }

  if (outflows.length) {
    lines.push({
      type: "SORTIE",
      label: "Dépenses et sorties",
      amountFcfa: outflows.reduce((sum, entry) => sum + entry.outflowFcfa, 0),
      variant: "header",
    });

    const disbursementTotal = outflows
      .filter((entry) => entry.category === "DECAISSEMENT")
      .reduce((sum, entry) => sum + entry.outflowFcfa, 0);

    for (const entry of outflows.filter((entry) => entry.category !== "DECAISSEMENT")) {
      lines.push({
        type: "SORTIE",
        label: entry.label,
        amountFcfa: entry.outflowFcfa,
        variant: "item",
      });
    }

    if (disbursementTotal > 0) {
      lines.push({
        type: "SORTIE",
        label: "Décaissement journalier comptable",
        amountFcfa: disbursementTotal,
        variant: "item",
      });
    }
  }

  return lines;
}

export function journalHasActiveFilters(filters: JournalFilters): boolean {
  return (
    (filters.type != null && filters.type !== "all") ||
    (filters.category != null && filters.category !== "all") ||
    filters.minAmount != null ||
    filters.maxAmount != null ||
    Boolean(filters.search?.trim())
  );
}

export function parseJournalFiltersFromQuery(query: Record<string, unknown>) {
  const preset = typeof query.preset === "string" ? query.preset : "month";
  const customFrom = typeof query.from === "string" ? query.from : undefined;
  const customTo = typeof query.to === "string" ? query.to : undefined;
  const { from, to } = parseJournalPeriod(preset, customFrom, customTo);
  const type =
    query.type === "ENTREE" || query.type === "SORTIE" ? query.type : "all";
  const category = (typeof query.category === "string"
    ? query.category
    : "all") as JournalCategory | "all";
  const minRaw = query.minAmount != null ? Number(query.minAmount) : undefined;
  const maxRaw = query.maxAmount != null ? Number(query.maxAmount) : undefined;

  return {
    from,
    to,
    type,
    category,
    minAmount: minRaw != null && Number.isFinite(minRaw) ? minRaw : undefined,
    maxAmount: maxRaw != null && Number.isFinite(maxRaw) ? maxRaw : undefined,
    search: typeof query.search === "string" ? query.search : undefined,
    preset,
    customFrom,
    customTo,
  };
}

export function buildJournalDailySummaries(
  entries: JournalEntry[],
  from?: Date,
  to?: Date,
  options?: { hideEmptyDays?: boolean },
): JournalMonthDailySummary[] {
  const byDay = new Map<string, { inflowsFcfa: number; outflowsFcfa: number; entries: JournalEntry[] }>();

  for (const day of enumeratePeriodDays(from, to)) {
    byDay.set(day, { inflowsFcfa: 0, outflowsFcfa: 0, entries: [] });
  }

  for (const entry of entries) {
    const key = formatDateKey(new Date(entry.occurredAt));
    const bucket = byDay.get(key) ?? { inflowsFcfa: 0, outflowsFcfa: 0, entries: [] };
    bucket.inflowsFcfa += entry.inflowFcfa;
    bucket.outflowsFcfa += entry.outflowFcfa;
    bucket.entries.push(entry);
    byDay.set(key, bucket);
  }

  const byMonth = new Map<string, JournalMonthDailySummary>();

  for (const [date, totals] of [...byDay.entries()].sort()) {
    const [year, month] = date.split("-").map(Number);
    const monthKey = `${year}-${String(month).padStart(2, "0")}`;
    const monthLabel = new Date(year, month - 1, 1).toLocaleDateString("fr-FR", {
      month: "long",
      year: "numeric",
    });

    const daySummary: JournalDaySummary = {
      date,
      label: new Date(year, month - 1, Number(date.split("-")[2])).toLocaleDateString("fr-FR", {
        weekday: "short",
        day: "2-digit",
        month: "short",
      }),
      inflowsFcfa: totals.inflowsFcfa,
      outflowsFcfa: totals.outflowsFcfa,
      balanceFcfa: totals.inflowsFcfa - totals.outflowsFcfa,
      lines: buildDayLines(totals.entries),
    };

    if (options?.hideEmptyDays && totals.entries.length === 0) continue;

    const existing = byMonth.get(monthKey);
    if (existing) {
      existing.days.push(daySummary);
      existing.inflowsFcfa += daySummary.inflowsFcfa;
      existing.outflowsFcfa += daySummary.outflowsFcfa;
      existing.balanceFcfa += daySummary.balanceFcfa;
    } else {
      byMonth.set(monthKey, {
        year,
        month,
        monthLabel,
        inflowsFcfa: daySummary.inflowsFcfa,
        outflowsFcfa: daySummary.outflowsFcfa,
        balanceFcfa: daySummary.balanceFcfa,
        days: [daySummary],
      });
    }
  }

  return [...byMonth.values()].sort((a, b) =>
    a.year === b.year ? a.month - b.month : a.year - b.year,
  );
}

export async function buildJournalEntries(filters: JournalFilters = {}) {
  const from = filters.from;
  const to = filters.to;

  const [invoices, expenses, payrolls, disbursements] = await Promise.all([
    prisma.invoice.findMany({
      where: {
        type: { in: COLLECTED_INVOICE_TYPES },
        status: { not: InvoiceStatus.CANCELLED },
        ...comptabiliteInvoicePatientWhere(),
        OR: [
          { status: InvoiceStatus.PAID },
          { type: InvoiceType.CONSULTATION, status: InvoiceStatus.PENDING },
        ],
      },
      select: {
        id: true,
        invoiceNumber: true,
        type: true,
        status: true,
        amountFcfa: true,
        paidAt: true,
        createdAt: true,
        patient: { select: { firstName: true, lastName: true } },
      },
    }),
    prisma.clinicExpense.findMany({
      where: { status: ClinicExpenseStatus.VALIDATED },
      select: {
        id: true,
        label: true,
        amountFcfa: true,
        businessDate: true,
        validatedAt: true,
        createdAt: true,
      },
    }),
    prisma.employeePayroll.findMany({
      where: { status: PayrollStatus.PAID, paidAt: { not: null } },
      include: {
        employee: { select: { firstName: true, lastName: true } },
      },
    }),
    prisma.receptionCashSettlement.findMany({
      select: {
        id: true,
        disbursementFcfa: true,
        settledAt: true,
        comment: true,
        receptionist: { select: { firstName: true, lastName: true } },
      },
    }),
  ]);

  const raw: JournalEntry[] = [];

  for (const invoice of invoices) {
    const collectedAt = invoiceCollectedAt(invoice);
    if (!collectedAt || !inPeriod(collectedAt, from, to)) continue;
    const category = invoiceCategory(invoice.type);
    raw.push({
      id: `inv-${invoice.id}`,
      occurredAt: collectedAt.toISOString(),
      label: invoice.patient
        ? `${INVOICE_TYPE_LABELS[invoice.type]} — ${invoice.patient.firstName} ${invoice.patient.lastName}`.trim()
        : `${INVOICE_TYPE_LABELS[invoice.type]} — Client externe`,
      category,
      categoryLabel: CATEGORY_LABELS[category],
      type: "ENTREE",
      inflowFcfa: invoice.amountFcfa,
      outflowFcfa: 0,
      reference: invoice.invoiceNumber,
      source: "Invoice",
    });
  }

  for (const expense of expenses) {
    const occurredAt = expense.validatedAt ?? expense.createdAt;
    if (!inPeriod(occurredAt, from, to)) continue;
    raw.push({
      id: `exp-${expense.id}`,
      occurredAt: occurredAt.toISOString(),
      label: expense.label,
      category: "DEPENSE",
      categoryLabel: CATEGORY_LABELS.DEPENSE,
      type: "SORTIE",
      inflowFcfa: 0,
      outflowFcfa: expense.amountFcfa,
      reference: expense.id.slice(-8).toUpperCase(),
      source: "ClinicExpense",
    });
  }

  for (const payroll of payrolls) {
    const occurredAt = payroll.paidAt!;
    if (!inPeriod(occurredAt, from, to)) continue;
    const net = Math.max(0, payroll.grossFcfa - payroll.advanceDeductionFcfa);
    raw.push({
      id: `pay-${payroll.id}`,
      occurredAt: occurredAt.toISOString(),
      label: `Salaire — ${payroll.employee.firstName} ${payroll.employee.lastName}`.trim(),
      category: "SALAIRE",
      categoryLabel: CATEGORY_LABELS.SALAIRE,
      type: "SORTIE",
      inflowFcfa: 0,
      outflowFcfa: net,
      reference: `${payroll.year}-${String(payroll.month).padStart(2, "0")}`,
      source: "EmployeePayroll",
    });
  }

  for (const row of disbursements) {
    if (!inPeriod(row.settledAt, from, to)) continue;
    raw.push({
      id: `dis-${row.id}`,
      occurredAt: row.settledAt.toISOString(),
      label: `Décaissement — ${row.receptionist.firstName} ${row.receptionist.lastName}`.trim(),
      category: "DECAISSEMENT",
      categoryLabel: CATEGORY_LABELS.DECAISSEMENT,
      type: "SORTIE",
      inflowFcfa: 0,
      outflowFcfa: row.disbursementFcfa,
      reference: row.id.slice(-8).toUpperCase(),
      source: "ReceptionCashSettlement",
    });
  }

  raw.sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());

  let running = 0;
  const withBalance = raw.map((entry, index) => {
    running += entry.inflowFcfa - entry.outflowFcfa;
    return { ...entry, sequence: index + 1, runningBalanceFcfa: running };
  });

  const search = filters.search?.trim().toLowerCase();
  const filtered = withBalance.filter((entry) => {
    if (filters.type && filters.type !== "all" && entry.type !== filters.type) return false;
    if (filters.category && filters.category !== "all" && entry.category !== filters.category) {
      return false;
    }
    const amount = entry.inflowFcfa || entry.outflowFcfa;
    if (filters.minAmount != null && amount < filters.minAmount) return false;
    if (filters.maxAmount != null && amount > filters.maxAmount) return false;
    if (search) {
      const haystack = `${entry.label} ${entry.reference} ${amount}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });

  const totalInflowsFcfa = filtered.reduce((sum, row) => sum + row.inflowFcfa, 0);
  const totalOutflowsFcfa = filtered.reduce((sum, row) => sum + row.outflowFcfa, 0);
  const hideEmptyDays = journalHasActiveFilters(filters);
  const dailyByMonth = buildJournalDailySummaries(
    filtered.map(({ sequence: _sequence, runningBalanceFcfa: _balance, ...entry }) => entry),
    from,
    to,
    { hideEmptyDays },
  );

  return {
    entries: filtered,
    dailyByMonth,
    totals: {
      inflowsFcfa: totalInflowsFcfa,
      outflowsFcfa: totalOutflowsFcfa,
      balanceFcfa: totalInflowsFcfa - totalOutflowsFcfa,
    },
  };
}

function parseLocalDateKey(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function parseJournalPeriod(preset: string, customFrom?: string, customTo?: string) {
  const now = new Date();
  const todayStart = startOfDay(now);
  const tomorrow = new Date(todayStart);
  tomorrow.setDate(tomorrow.getDate() + 1);

  switch (preset) {
    case "today":
      return { from: todayStart, to: tomorrow };
    case "week": {
      const from = new Date(todayStart);
      from.setDate(from.getDate() - 6);
      return { from, to: tomorrow };
    }
    case "month": {
      const from = new Date(now.getFullYear(), now.getMonth(), 1);
      const to = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      return { from, to };
    }
    case "year": {
      const from = new Date(now.getFullYear(), 0, 1);
      const to = new Date(now.getFullYear() + 1, 0, 1);
      return { from, to };
    }
    case "custom": {
      if (!customFrom) return { from: undefined, to: undefined };
      const from = startOfDay(parseLocalDateKey(customFrom));
      const to = customTo
        ? (() => {
            const end = startOfDay(parseLocalDateKey(customTo));
            end.setDate(end.getDate() + 1);
            return end;
          })()
        : tomorrow;
      return { from, to };
    }
    default:
      return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: new Date(now.getFullYear(), now.getMonth() + 1, 1) };
  }
}

export function journalEntriesToCsv(
  entries: Array<JournalEntry & { sequence: number; runningBalanceFcfa: number }>,
) {
  const header = "N°;Date;Libellé;Catégorie;Entrée;Sortie;Solde;Référence";
  const lines = entries.map((row) => {
    const date = new Date(row.occurredAt).toLocaleString("fr-FR");
    return [
      row.sequence,
      date,
      `"${row.label.replace(/"/g, '""')}"`,
      row.categoryLabel,
      row.inflowFcfa || "",
      row.outflowFcfa || "",
      row.runningBalanceFcfa,
      row.reference,
    ].join(";");
  });
  return [header, ...lines].join("\n");
}
