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
 * - CONSULTATION + PENDING (legacy réception) → createdAt (encaissée à l'accueil sans passage PAID)
 * Les créneaux matin/soir filtrent cette date dans getShiftWindow — voir cash-shift.ts.
 */
export function invoiceCollectedAt(invoice: {
  type: InvoiceType;
  status: InvoiceStatus;
  paidAt: Date | null;
  createdAt: Date;
}): Date | null {
  if (invoice.status === InvoiceStatus.CANCELLED) return null;
  if (invoice.status === InvoiceStatus.PAID && invoice.paidAt) {
    return invoice.paidAt;
  }
  if (
    invoice.type === InvoiceType.CONSULTATION &&
    invoice.status === InvoiceStatus.PENDING
  ) {
    return invoice.createdAt;
  }
  return null;
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
    status: { not: InvoiceStatus.CANCELLED },
    ...comptabiliteInvoicePatientWhere(),
    OR: [
      {
        status: InvoiceStatus.PAID,
        paidAt: { gte: from, lt: toDate },
      },
      {
        type: InvoiceType.CONSULTATION,
        status: InvoiceStatus.PENDING,
        createdAt: { gte: from, lt: toDate },
      },
    ],
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

export function sumCollectedBreakdown(invoices: Array<{
  type: InvoiceType;
  status: InvoiceStatus;
  amountFcfa: number;
  paidAt: Date | null;
  createdAt: Date;
}>): CollectedBreakdown {
  const result = emptyBreakdown();

  for (const invoice of invoices) {
    const collectedAt = invoiceCollectedAt(invoice);
    if (!collectedAt) continue;

    result.totalCount += 1;
    result.totalFcfa += invoice.amountFcfa;

    switch (invoice.type) {
      case InvoiceType.CONSULTATION:
        result.consultationsCount += 1;
        result.consultationsFcfa += invoice.amountFcfa;
        break;
      case InvoiceType.LAB_EXAM:
        result.examsCount += 1;
        result.examsFcfa += invoice.amountFcfa;
        break;
      case InvoiceType.SURGERY:
        result.surgeryCount += 1;
        result.surgeryFcfa += invoice.amountFcfa;
        break;
      case InvoiceType.HOSPITALIZATION_DEPOSIT:
      case InvoiceType.HOSPITALIZATION_FINAL:
        result.hospitalizationCount += 1;
        result.hospitalizationFcfa += invoice.amountFcfa;
        break;
    }
  }

  return result;
}

export async function aggregateCollectedBetween(from: Date, to: Date) {
  const invoices = await prisma.invoice.findMany({
    where: collectedInvoicesWhere(from, to),
    select: {
      type: true,
      status: true,
      amountFcfa: true,
      paidAt: true,
      createdAt: true,
    },
  });

  return sumCollectedBreakdown(invoices);
}

export async function aggregateCollectedToday() {
  const todayStart = startOfDay(new Date());
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);
  return aggregateCollectedBetween(todayStart, tomorrowStart);
}

/** Totaux journaliers par rôle encaisseur — fenêtre 24 h, aligné sur « Recettes du jour ». */
export async function aggregateDayRoleTotals(from: Date, to: Date) {
  const invoices = await prisma.invoice.findMany({
    where: collectedInvoicesWhere(from, to),
    include: { issuedBy: { select: { role: true } } },
  });

  let receptionFcfa = 0;
  let comptabiliteFcfa = 0;
  for (const invoice of invoices) {
    if (!invoiceCollectedAt(invoice)) continue;
    if (invoice.issuedBy.role === "RECEPTIONNISTE") {
      receptionFcfa += invoice.amountFcfa;
    } else {
      comptabiliteFcfa += invoice.amountFcfa;
    }
  }

  const breakdown = sumCollectedBreakdown(invoices);
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

  const invoices = await prisma.invoice.findMany({
    where: collectedInvoicesWhere(dayStarts[0]!, rangeEnd),
    select: {
      type: true,
      status: true,
      amountFcfa: true,
      paidAt: true,
      createdAt: true,
    },
  });

  return dayStarts.map((dayStart) => {
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const dayInvoices = invoices.filter((invoice) => {
      const collectedAt = invoiceCollectedAt(invoice);
      return collectedAt && collectedAt >= dayStart && collectedAt < dayEnd;
    });

    const breakdown = sumCollectedBreakdown(dayInvoices);

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

/** Marque PAID les consultations legacy encore en PENDING (encaissées à la réception). */
export async function backfillLegacyConsultationInvoices() {
  const pending = await prisma.invoice.findMany({
    where: {
      type: InvoiceType.CONSULTATION,
      status: InvoiceStatus.PENDING,
      ...comptabiliteInvoicePatientWhere(),
    },
    select: { id: true, createdAt: true },
  });

  if (!pending.length) return 0;

  await prisma.$transaction(
    pending.map((invoice) =>
      prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          status: InvoiceStatus.PAID,
          paidAt: invoice.createdAt,
        },
      }),
    ),
  );

  return pending.length;
}
