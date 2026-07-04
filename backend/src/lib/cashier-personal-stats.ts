import { prisma } from "./db.js";
import {
  collectedInvoicesWhere,
  sumCollectedBreakdown,
  type CollectedBreakdown,
} from "./revenue-stats.js";
import { getShiftWindow } from "./cash-shift.js";
import type { ReceptionShiftSlot } from "@prisma/client";

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
): Promise<CollectedBreakdown> {
  const invoices = await prisma.invoice.findMany({
    where: {
      ...collectedInvoicesWhere(from, to),
      issuedById: cashierId,
    },
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

export async function sumExpensesForCashierOnDate(cashierId: string, businessDate: Date) {
  return sumExpensesForCashierInWindow(cashierId, businessDate, null, null);
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
