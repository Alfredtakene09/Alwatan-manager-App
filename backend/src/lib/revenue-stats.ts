import { InvoiceStatus, InvoiceType, Prisma } from "@prisma/client";
import { prisma } from "./db.js";
import { comptabiliteInvoicePatientWhere } from "./patient-billing.js";

/** Encaissements comptoir : consultations, examens, chirurgie, hospitalisation — hors associés et pharmacie. */
export const COLLECTED_INVOICE_TYPES: InvoiceType[] = [
  InvoiceType.CONSULTATION,
  InvoiceType.LAB_EXAM,
  InvoiceType.SURGERY,
  InvoiceType.HOSPITALIZATION_DEPOSIT,
  InvoiceType.HOSPITALIZATION_FINAL,
];

export const INVOICE_TYPE_LABELS: Record<InvoiceType, string> = {
  [InvoiceType.CONSULTATION]: "Consultation",
  [InvoiceType.LAB_EXAM]: "Examens",
  [InvoiceType.SURGERY]: "Chirurgie",
  [InvoiceType.HOSPITALIZATION_DEPOSIT]: "Hospitalisation (acompte)",
  [InvoiceType.HOSPITALIZATION_FINAL]: "Hospitalisation (solde)",
  [InvoiceType.PHARMACY]: "Pharmacie",
};

export function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

export function endOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

/**
 * Date d'encaissement effective pour les totaux « jour » et réconciliation.
 * - PAID → paidAt
 * - PARTIALLY_PAID → lastPaidAt (dernier versement) ou createdAt
 * Les consultations PENDING ne sont plus comptées comme encaissées
 * (encaissement réservé au gestionnaire / direction).
 * Les créneaux matin/soir filtrent cette date dans getShiftWindow — voir cash-shift.ts.
 * Les tranches (InvoicePayment) sont agrégées à la date de chaque versement — voir loadCollectedSlicesBetween.
 */
export function invoiceCollectedAt(invoice: {
  type: InvoiceType;
  status: InvoiceStatus;
  paidAt: Date | null;
  createdAt: Date;
  paidAmountFcfa?: number | null;
  lastPaidAt?: Date | null;
}): Date | null {
  if (invoice.status === InvoiceStatus.CANCELLED) return null;
  if (invoice.status === InvoiceStatus.PAID && invoice.paidAt) {
    return invoice.paidAt;
  }
  if (
    invoice.status === InvoiceStatus.PARTIALLY_PAID &&
    Math.max(0, Number(invoice.paidAmountFcfa) || 0) > 0
  ) {
    return invoice.lastPaidAt ?? invoice.paidAt ?? invoice.createdAt;
  }
  return null;
}

export function isCollectedOperationInvoice(invoice: {
  type: InvoiceType;
  billingExamKind?: string | null;
  surgeryCaseId?: string | null;
}) {
  return (
    invoice.type === InvoiceType.SURGERY ||
    invoice.billingExamKind === "operation" ||
    Boolean(invoice.surgeryCaseId)
  );
}

export function isCollectedHospitalizationInvoice(invoice: {
  type: InvoiceType;
  billingExamKind?: string | null;
  hospitalizationId?: string | null;
}) {
  return (
    invoice.type === InvoiceType.HOSPITALIZATION_DEPOSIT ||
    invoice.type === InvoiceType.HOSPITALIZATION_FINAL ||
    invoice.billingExamKind === "hospitalisation" ||
    Boolean(invoice.hospitalizationId)
  );
}

/**
 * Montant réellement encaissé à enregistrer en recette.
 * Priorité au cumul des paiements (paidAmountFcfa) ; sinon montant facture (legacy).
 */
export function collectedAmountFcfa(invoice: {
  amountFcfa: number;
  paidAmountFcfa?: number | null;
}): number {
  const paid = Math.max(0, Number(invoice.paidAmountFcfa) || 0);
  if (paid > 0) return paid;
  return Math.max(0, Number(invoice.amountFcfa) || 0);
}

export function isCollectedInvoice(invoice: {
  type: InvoiceType;
  status: InvoiceStatus;
  paidAt: Date | null;
  createdAt: Date;
}): boolean {
  return invoiceCollectedAt(invoice) !== null;
}

/**
 * Filtre Prisma : factures encaissées sur une période [from, to).
 * Utilisé pour « Recettes du jour » : from = minuit date, to = minuit lendemain (24 h calendaires).
 * Ne filtre PAS par créneau matin/soir — voir day-shift-reconciliation.ts pour la ventilation.
 */
export function collectedInvoicesWhere(from: Date, to?: Date): Prisma.InvoiceWhereInput {
  const toDate = to ?? new Date(Date.now() + 86400000);
  return {
    type: { in: COLLECTED_INVOICE_TYPES },
    ...comptabiliteInvoicePatientWhere(),
    status: InvoiceStatus.PAID,
    paidAt: { gte: from, lt: toDate },
  };
}

export type CollectedBreakdown = {
  consultationsCount: number;
  consultationsFcfa: number;
  examsCount: number;
  examsFcfa: number;
  surgeryCount: number;
  surgeryFcfa: number;
  hospitalizationCount: number;
  hospitalizationFcfa: number;
  totalCount: number;
  totalFcfa: number;
};

function emptyBreakdown(): CollectedBreakdown {
  return {
    consultationsCount: 0,
    consultationsFcfa: 0,
    examsCount: 0,
    examsFcfa: 0,
    surgeryCount: 0,
    surgeryFcfa: 0,
    hospitalizationCount: 0,
    hospitalizationFcfa: 0,
    totalCount: 0,
    totalFcfa: 0,
  };
}

export type CollectedInvoiceFields = {
  type: InvoiceType;
  status: InvoiceStatus;
  amountFcfa: number;
  paidAmountFcfa?: number | null;
  paidAt: Date | null;
  createdAt: Date;
  billingExamKind?: string | null;
  surgeryCaseId?: string | null;
  hospitalizationId?: string | null;
  lastPaidAt?: Date | null;
};

export function sumCollectedBreakdown(invoices: CollectedInvoiceFields[]): CollectedBreakdown {
  const result = emptyBreakdown();

  for (const invoice of invoices) {
    const collectedAt = invoiceCollectedAt(invoice);
    if (!collectedAt) continue;

    const amount = collectedAmountFcfa(invoice);
    result.totalCount += 1;
    result.totalFcfa += amount;

    if (invoice.type === InvoiceType.CONSULTATION) {
      result.consultationsCount += 1;
      result.consultationsFcfa += amount;
      continue;
    }
    if (isCollectedOperationInvoice(invoice)) {
      result.surgeryCount += 1;
      result.surgeryFcfa += amount;
      continue;
    }
    if (isCollectedHospitalizationInvoice(invoice)) {
      result.hospitalizationCount += 1;
      result.hospitalizationFcfa += amount;
      continue;
    }
    if (invoice.type === InvoiceType.LAB_EXAM) {
      result.examsCount += 1;
      result.examsFcfa += amount;
    }
  }

  return result;
}

const collectedInvoiceSelect = {
  type: true,
  status: true,
  amountFcfa: true,
  paidAmountFcfa: true,
  paidAt: true,
  createdAt: true,
  billingExamKind: true,
  surgeryCaseId: true,
  hospitalizationId: true,
} as const;

function collectedInvoiceParentWhere(): Prisma.InvoiceWhereInput {
  return {
    type: { in: COLLECTED_INVOICE_TYPES },
    status: { not: InvoiceStatus.CANCELLED },
    ...comptabiliteInvoicePatientWhere(),
  };
}

export type CollectedSlice = CollectedInvoiceFields & {
  issuedByRole?: string | null;
  recordedById?: string | null;
};

/**
 * Recettes d'une période [from, to) : chaque versement (InvoicePayment) à sa date,
 * plus les factures PAID legacy sans ligne de paiement.
 */
export async function loadCollectedSlicesBetween(
  from: Date,
  to: Date,
  options?: { cashierId?: string },
): Promise<CollectedSlice[]> {
  const invoiceWhere = collectedInvoiceParentWhere();
  const [payments, legacyInvoices] = await Promise.all([
    prisma.invoicePayment.findMany({
      where: {
        paidAt: { gte: from, lt: to },
        ...(options?.cashierId ? { recordedById: options.cashierId } : {}),
        invoice: invoiceWhere,
      },
      select: {
        amountFcfa: true,
        paidAt: true,
        recordedById: true,
        recordedBy: { select: { role: true } },
        invoice: { select: collectedInvoiceSelect },
      },
    }),
    prisma.invoice.findMany({
      where: {
        ...collectedInvoicesWhere(from, to),
        payments: { none: {} },
        ...(options?.cashierId ? { issuedById: options.cashierId } : {}),
      },
      select: {
        ...collectedInvoiceSelect,
        issuedBy: { select: { role: true } },
      },
    }),
  ]);

  const fromPayments: CollectedSlice[] = payments.map((payment) => ({
    ...payment.invoice,
    status: InvoiceStatus.PAID,
    amountFcfa: payment.amountFcfa,
    paidAmountFcfa: payment.amountFcfa,
    paidAt: payment.paidAt,
    createdAt: payment.paidAt,
    lastPaidAt: payment.paidAt,
    issuedByRole: payment.recordedBy.role,
    recordedById: payment.recordedById,
  }));

  const fromLegacy: CollectedSlice[] = legacyInvoices.map((invoice) => ({
    ...invoice,
    issuedByRole: invoice.issuedBy.role,
  }));

  return [...fromPayments, ...fromLegacy];
}

export async function aggregateCollectedBetween(from: Date, to: Date) {
  const slices = await loadCollectedSlicesBetween(from, to);
  return sumCollectedBreakdown(slices);
}

/** Recettes pharmacie encaissées sur [from, to) — hors totaux caisse réception. */
export async function aggregatePharmacyBetween(from: Date, to: Date) {
  const result = await prisma.invoice.aggregate({
    where: {
      type: InvoiceType.PHARMACY,
      status: InvoiceStatus.PAID,
      paidAt: { gte: from, lt: to },
    },
    _sum: { amountFcfa: true },
    _count: { _all: true },
  });
  return {
    totalFcfa: result._sum.amountFcfa ?? 0,
    totalCount: result._count._all,
  };
}

export async function aggregateCollectedToday() {
  const todayStart = startOfDay(new Date());
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);
  return aggregateCollectedBetween(todayStart, tomorrowStart);
}

/** Totaux journaliers par rôle encaisseur — fenêtre 24 h, aligné sur « Recettes du jour ». */
export async function aggregateDayRoleTotals(from: Date, to: Date) {
  const slices = await loadCollectedSlicesBetween(from, to);

  let receptionFcfa = 0;
  let comptabiliteFcfa = 0;
  for (const slice of slices) {
    if (!invoiceCollectedAt(slice)) continue;
    const amount = collectedAmountFcfa(slice);
    if (slice.issuedByRole === "RECEPTIONNISTE") {
      receptionFcfa += amount;
    } else {
      comptabiliteFcfa += amount;
    }
  }

  const breakdown = sumCollectedBreakdown(slices);
  return {
    receptionFcfa,
    comptabiliteFcfa,
    totalFcfa: breakdown.totalFcfa,
    breakdown,
  };
}

export type RevenueDayRow = {
  date: string;
  dayLabel: string;
  consultationsFcfa: number;
  labExamsFcfa: number;
  surgeryFcfa: number;
  hospitalizationFcfa: number;
  totalFcfa: number;
};

export async function buildRevenueLast7Days(): Promise<RevenueDayRow[]> {
  const dayStarts: Date[] = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const day = new Date();
    day.setDate(day.getDate() - offset);
    dayStarts.push(startOfDay(day));
  }

  const rangeEnd = new Date(dayStarts[dayStarts.length - 1]!);
  rangeEnd.setDate(rangeEnd.getDate() + 1);

  const slices = await loadCollectedSlicesBetween(dayStarts[0]!, rangeEnd);

  return dayStarts.map((dayStart) => {
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const daySlices = slices.filter((slice) => {
      const collectedAt = invoiceCollectedAt(slice);
      return collectedAt && collectedAt >= dayStart && collectedAt < dayEnd;
    });

    const breakdown = sumCollectedBreakdown(daySlices);

    return {
      date: dayStart.toISOString().slice(0, 10),
      dayLabel: dayStart.toLocaleDateString("fr-FR", {
        weekday: "short",
        day: "numeric",
        month: "short",
      }),
      consultationsFcfa: breakdown.consultationsFcfa,
      labExamsFcfa: breakdown.examsFcfa,
      surgeryFcfa: breakdown.surgeryFcfa,
      hospitalizationFcfa: breakdown.hospitalizationFcfa,
      totalFcfa: breakdown.totalFcfa,
    };
  });
}

/**
 * Ancienne migration : ne plus marquer les PENDING comme payées.
 * Les consultations restent en attente d'encaissement gestionnaire.
 */
export async function backfillLegacyConsultationInvoices() {
  return 0;
}
