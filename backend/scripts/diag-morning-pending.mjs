import { prisma } from "../src/lib/db.js";
import { parseBusinessDate, getShiftWindow } from "../src/lib/cash-shift.js";
import { invoiceCollectedAt } from "../src/lib/revenue-stats.js";
import { CASH_COLLECTOR_ROLES } from "../src/lib/cash-shift.js";
import { sumExpensesForCashierShift } from "../src/lib/cashier-personal-stats.js";

async function main() {
  const businessDate = parseBusinessDate("2026-06-27");
  const morning = getShiftWindow(businessDate, "MORNING");
  const evening = getShiftWindow(businessDate, "EVENING");

  const unsettledMorning = await prisma.invoice.findMany({
    where: {
      type: { in: ["CONSULTATION", "LAB_EXAM", "SURGERY", "HOSPITALIZATION_DEPOSIT", "HOSPITALIZATION_FINAL"] },
      status: { not: "CANCELLED" },
      cashSettlementLine: null,
      issuedBy: { role: { in: CASH_COLLECTOR_ROLES } },
      OR: [
        { status: "PAID", paidAt: { gte: morning.from, lt: morning.to } },
        { type: "CONSULTATION", status: "PENDING", createdAt: { gte: morning.from, lt: morning.to } },
      ],
    },
    include: { issuedBy: { select: { id: true, firstName: true, lastName: true } } },
  });

  let gross = 0;
  for (const inv of unsettledMorning) {
    gross += inv.amountFcfa;
    console.log("morning unsettled:", inv.amountFcfa, inv.issuedBy.firstName, invoiceCollectedAt(inv)?.toISOString());
  }

  const settlements = await prisma.receptionCashSettlement.findMany({
    where: { businessDate, shiftSlot: "MORNING" },
  });

  const byCashier = new Map();
  for (const inv of unsettledMorning) {
    byCashier.set(inv.issuedBy.id, (byCashier.get(inv.issuedBy.id) ?? 0) + inv.amountFcfa);
  }

  for (const [id, amt] of byCashier) {
    const exp = await sumExpensesForCashierShift(id, businessDate, "MORNING");
    console.log("cashier", id, "gross", amt, "expenses", exp.totalFcfa, "net", amt - exp.totalFcfa);
  }

  console.log(JSON.stringify({
    morningWindow: { from: morning.from.toISOString(), to: morning.to.toISOString() },
    eveningWindow: { from: evening.from.toISOString(), to: evening.to.toISOString() },
    unsettledCount: unsettledMorning.length,
    unsettledGross: gross,
    settlements: settlements.map((s) => ({ disb: s.disbursementFcfa, sys: s.systemTotalFcfa })),
  }, null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
