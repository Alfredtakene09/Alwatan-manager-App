import { ClinicExpenseStatus, InvoiceStatus, type ReceptionShiftSlot } from "@prisma/client";
import { prisma } from "./db.js";
import {
  COLLECTED_INVOICE_TYPES,
  loadCollectedSlicesBetween,
  sumCollectedBreakdown,
  type CollectedBreakdown,
} from "./revenue-stats.js";
import { formatBusinessDate, getShiftWindow, parseBusinessDate } from "./cash-shift.js";

/** Dépenses rejetées ou désactivées : hors total et hors solde de caisse. */
export const countedClinicExpenseStatus = {
  not: ClinicExpenseStatus.REJECTED,
} as const;

export type CashierExpenseLine = {
  id: string;
  label: string;
  amountFcfa: number;
  createdAt: string;
};

export type CashierExpenseSummary = {
  totalFcfa: number;
  count: number;
  rows: CashierExpenseLine[];
};

export async function aggregateCollectedForCashier(
  cashierId: string,
  from: Date,
  to: Date,
  options?: { patientService?: string },
): Promise<CollectedBreakdown> {
  const slices = await loadCollectedSlicesBetween(from, to, {
    cashierId,
    patientService: options?.patientService,
  });
  return sumCollectedBreakdown(slices);
}

export async function sumExpensesForCashierOnDate(cashierId: string, businessDate: Date) {
  return sumExpensesForCashierInWindow(cashierId, businessDate, null, null);
}

/** Dépenses du caissier sur une plage de dates métier [from, toExclusive). */
export async function sumExpensesForCashierBetween(
  cashierId: string,
  from: Date,
  toExclusive: Date,
) {
  const rangeStart = parseBusinessDate(formatBusinessDate(from));
  const rangeEnd = parseBusinessDate(formatBusinessDate(toExclusive));
  const rows = await prisma.clinicExpense.findMany({
    where: {
      paidById: cashierId,
      status: countedClinicExpenseStatus,
      businessDate: { gte: rangeStart, lt: rangeEnd },
    },
    orderBy: { createdAt: "asc" },
  });

  return {
    totalFcfa: rows.reduce((sum, row) => sum + row.amountFcfa, 0),
    count: rows.length,
    rows: rows.map((row) => ({
      id: row.id,
      label: row.label,
      amountFcfa: row.amountFcfa,
      createdAt: row.createdAt.toISOString(),
    })),
  };
}

/** Dépenses payées par le caissier — optionnellement limitées à [from, to) via createdAt. */
export async function sumExpensesForCashierInWindow(
  cashierId: string,
  businessDate: Date | null,
  from: Date | null,
  to: Date | null,
): Promise<CashierExpenseSummary> {
  const rows = await prisma.clinicExpense.findMany({
    where: {
      paidById: cashierId,
      status: countedClinicExpenseStatus,
      ...(businessDate ? { businessDate } : {}),
      ...(from && to ? { createdAt: { gte: from, lt: to } } : {}),
    },
    orderBy: { createdAt: "asc" },
  });

  return {
    totalFcfa: rows.reduce((sum, row) => sum + row.amountFcfa, 0),
    count: rows.length,
    rows: rows.map((row) => ({
      id: row.id,
      label: row.label,
      amountFcfa: row.amountFcfa,
      createdAt: row.createdAt.toISOString(),
    })),
  };
}

export async function sumExpensesForCashierShift(
  cashierId: string,
  businessDate: Date,
  shiftSlot: ReceptionShiftSlot,
) {
  const { from, to } = getShiftWindow(businessDate, shiftSlot);
  // Nuit traverse minuit : ne pas restreindre à businessDate seule
  if (shiftSlot === "NIGHT") {
    return sumExpensesForCashierInWindow(cashierId, null, from, to);
  }
  return sumExpensesForCashierInWindow(cashierId, businessDate, from, to);
}

export function netAfterExpenses(collectedFcfa: number, expensesFcfa: number) {
  return Math.max(0, collectedFcfa - expensesFcfa);
}

/** Recalcule les dépenses du solde ouvert. Les recettes déjà figées ne sont pas réécrites. */
export async function refreshUnvalidatedDayClosure(cashierId: string, businessDate: Date) {
  const closure = await prisma.receptionDayClosure.findUnique({
    where: {
      receptionistId_businessDate: {
        receptionistId: cashierId,
        businessDate,
      },
    },
  });
  if (!closure || closure.validatedAt || closure.settlementId) return;

  const expenses = await sumExpensesForCashierOnDate(cashierId, businessDate);
  const netFcfa = netAfterExpenses(closure.collectedFcfa, expenses.totalFcfa);
  if (closure.expensesFcfa === expenses.totalFcfa && closure.netFcfa === netFcfa) return;

  await prisma.receptionDayClosure.update({
    where: { id: closure.id },
    data: {
      expensesFcfa: expenses.totalFcfa,
      netFcfa,
    },
  });
}

export async function refreshUnvalidatedDayClosureForExpense(
  cashierId: string,
  businessDate: Date,
) {
  await refreshUnvalidatedDayClosure(cashierId, businessDate);
}

/** Caisses touchées par les factures d’un patient (avant suppression du dossier). */
export async function listPatientCashTouchpoints(patientId: string) {
  const [patient, invoices] = await Promise.all([
    prisma.patient.findUnique({
      where: { id: patientId },
      select: { createdById: true, createdAt: true },
    }),
    prisma.invoice.findMany({
      where: { patientId },
      select: {
        issuedById: true,
        paidAt: true,
        createdAt: true,
        payments: { select: { recordedById: true, paidAt: true } },
      },
    }),
  ]);

  const points = new Map<string, { cashierId: string; businessDate: Date }>();
  function add(cashierId: string | null | undefined, at: Date | null | undefined) {
    if (!cashierId || !at) return;
    const businessDate = parseBusinessDate(formatBusinessDate(at));
    points.set(`${cashierId}|${businessDate.toISOString()}`, { cashierId, businessDate });
  }

  if (patient) add(patient.createdById, patient.createdAt);
  for (const invoice of invoices) {
    add(invoice.issuedById, invoice.paidAt ?? invoice.createdAt);
    for (const payment of invoice.payments) {
      add(payment.recordedById, payment.paidAt);
    }
  }
  return [...points.values()];
}

export async function refreshUnvalidatedDayClosures(
  points: Array<{ cashierId: string; businessDate: Date }>,
) {
  for (const point of points) {
    await refreshUnvalidatedDayClosure(point.cashierId, point.businessDate);
  }
}

export type ClosureAmountAdjustment = {
  cashierId: string;
  businessDate: Date;
  amountFcfa: number;
};

/** Montant encaissé d’un patient, par caissier et par jour. */
export async function listPatientClosureAmounts(patientId: string): Promise<ClosureAmountAdjustment[]> {
  const invoices = await prisma.invoice.findMany({
    where: {
      patientId,
      type: { in: COLLECTED_INVOICE_TYPES },
      status: { not: InvoiceStatus.CANCELLED },
    },
    select: {
      issuedById: true,
      amountFcfa: true,
      paidAmountFcfa: true,
      status: true,
      paidAt: true,
      createdAt: true,
    },
  });

  const groups = new Map<string, ClosureAmountAdjustment>();
  for (const invoice of invoices) {
    const paid = Math.max(0, invoice.paidAmountFcfa ?? 0);
    const amountFcfa =
      paid > 0 ? paid : invoice.status === InvoiceStatus.PAID ? Math.max(0, invoice.amountFcfa) : 0;
    if (!invoice.issuedById || amountFcfa <= 0) continue;
    const businessDate = parseBusinessDate(formatBusinessDate(invoice.paidAt ?? invoice.createdAt));
    const key = `${invoice.issuedById}|${businessDate.toISOString()}`;
    const current = groups.get(key) ?? {
      cashierId: invoice.issuedById,
      businessDate,
      amountFcfa: 0,
    };
    current.amountFcfa += amountFcfa;
    groups.set(key, current);
  }
  return [...groups.values()];
}

/** Ajoute ou retire ce montant du solde de clôture encore ouvert. */
export async function applyOpenClosureAdjustments(
  adjustments: ClosureAmountAdjustment[],
  direction: 1 | -1,
) {
  for (const adjustment of adjustments) {
    const closure = await prisma.receptionDayClosure.findUnique({
      where: {
        receptionistId_businessDate: {
          receptionistId: adjustment.cashierId,
          businessDate: adjustment.businessDate,
        },
      },
    });
    if (!closure || closure.validatedAt || closure.settlementId) continue;
    const collectedFcfa = Math.max(0, closure.collectedFcfa + direction * adjustment.amountFcfa);
    const netFcfa = netAfterExpenses(collectedFcfa, closure.expensesFcfa);
    if (collectedFcfa === closure.collectedFcfa && netFcfa === closure.netFcfa) continue;
    await prisma.receptionDayClosure.update({
      where: { id: closure.id },
      data: { collectedFcfa, netFcfa },
    });
  }
}
