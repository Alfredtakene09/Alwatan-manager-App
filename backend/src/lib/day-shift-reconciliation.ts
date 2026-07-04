import { ReceptionShiftSlot, UserRole } from "@prisma/client";
import { prisma } from "./db.js";
import { buildSettlementBreakdown } from "./cash-settlement-breakdown.js";
import {
  ALL_SHIFT_SLOTS,
  CASH_COLLECTOR_ROLE_LABELS,
  CASH_COLLECTOR_ROLES,
  getShiftWindow,
  SHIFT_SLOT_LABELS,
  shiftHoursLabel,
} from "./cash-shift.js";
import { collectedInvoicesWhere, invoiceCollectedAt } from "./revenue-stats.js";

/**
 * Réconciliation « Recettes du jour » vs créneaux caisse.
 *
 * - « Jour » = calendrier [00:00, lendemain 00:00), heure LOCALE du serveur Node.
 * - Matin = [07:00, 14:00)
 * - Soir = [16:00, 21:00)
 * - Nuit sur le calendrier = [00:00, 06:00) U [21:00, 24:00)
 * - TROUS : 06:00–07:00 et 14:00–16:00 → hors créneau, imputés au caissier (issuedBy).
 */

export type OffShiftBucket = {
  id: string;
  label: string;
  totalFcfa: number;
  count: number;
};

export type OffShiftCashierRow = {
  cashier: {
    id: string;
    firstName: string;
    lastName: string;
    role: UserRole;
  };
  roleLabel: string;
  totalFcfa: number;
  transactionCount: number;
  buckets: OffShiftBucket[];
  typeBreakdown: ReturnType<typeof buildSettlementBreakdown>;
};

export type ShiftWindowSummary = {
  label: string;
  hoursLabel: string;
  totalFcfa: number;
  transactionCount: number;
};

export type DayShiftReconciliation = {
  timezoneNote: string;
  dayWindowLabel: string;
  dayTotalFcfa: number;
  morningWindow: ShiftWindowSummary;
  eveningWindow: ShiftWindowSummary;
  nightWindow: ShiftWindowSummary;
  offShift: {
    totalFcfa: number;
    transactionCount: number;
    buckets: OffShiftBucket[];
    byCashier: OffShiftCashierRow[];
    warning: string;
  };
  shiftSlots: {
    morning: { pendingFcfa: number; settledFcfa: number; totalFcfa: number };
    evening: { pendingFcfa: number; settledFcfa: number; totalFcfa: number };
    night: { pendingFcfa: number; settledFcfa: number; totalFcfa: number };
  };
  formula: {
    description: string;
    partsSumFcfa: number;
    isBalanced: boolean;
  };
};

const OFF_SHIFT_BUCKET_LABELS: Record<string, string> = {
  gap_6h_7h: "Entre 6h et 7h",
  gap_14h_16h: "Entre 14h et 16h",
  non_cashier: "Hors caissier comptoir",
};

type InvoiceRow = Awaited<ReturnType<typeof fetchDayInvoices>>[number];

async function fetchDayInvoices(businessDate: Date, dayEnd: Date) {
  return prisma.invoice.findMany({
    where: collectedInvoicesWhere(businessDate, dayEnd),
    include: {
      issuedBy: { select: { id: true, firstName: true, lastName: true, role: true } },
      visit: { select: { consultation: { select: { clinicalNotes: true } } } },
      surgeryCase: { select: { id: true } },
      hospitalization: { select: { id: true } },
    },
  });
}

function isCashCollectorRole(role: UserRole) {
  return CASH_COLLECTOR_ROLES.includes(role);
}

function inHalfOpenWindow(at: Date, from: Date, to: Date) {
  return at >= from && at < to;
}

/** Portion nuit sur une journée calendaire : [00h, 6h) U [21h, 24h). */
function isNightHoursOnCalendarDay(at: Date) {
  const hour = at.getHours();
  return hour < 6 || hour >= 21;
}

function offShiftBucketId(collectedAt: Date) {
  const hour = collectedAt.getHours();
  if (hour >= 6 && hour < 7) return "gap_6h_7h";
  if (hour >= 14 && hour < 16) return "gap_14h_16h";
  return "gap_14h_16h";
}

type CashierOffShiftAcc = OffShiftCashierRow & { _invoices: InvoiceRow[] };

function getOrCreateCashierAcc(
  map: Map<string, CashierOffShiftAcc>,
  invoice: InvoiceRow,
  bucketId: string,
) {
  const cashier = invoice.issuedBy;
  const key = cashier.id;
  if (!map.has(key)) {
    map.set(key, {
      cashier: {
        id: cashier.id,
        firstName: cashier.firstName,
        lastName: cashier.lastName,
        role: cashier.role,
      },
      roleLabel: CASH_COLLECTOR_ROLE_LABELS[cashier.role] ?? cashier.role,
      totalFcfa: 0,
      transactionCount: 0,
      buckets: [],
      typeBreakdown: [],
      _invoices: [],
    });
  }
  const acc = map.get(key)!;
  acc.totalFcfa += invoice.amountFcfa;
  acc.transactionCount += 1;
  acc._invoices.push(invoice);

  const bucketLabel = OFF_SHIFT_BUCKET_LABELS[bucketId] ?? bucketId;
  const existingBucket = acc.buckets.find((b) => b.id === bucketId);
  if (existingBucket) {
    existingBucket.totalFcfa += invoice.amountFcfa;
    existingBucket.count += 1;
  } else {
    acc.buckets.push({ id: bucketId, label: bucketLabel, totalFcfa: invoice.amountFcfa, count: 1 });
  }

  return acc;
}

function slotKey(slot: ReceptionShiftSlot): "morning" | "evening" | "night" {
  if (slot === ReceptionShiftSlot.MORNING) return "morning";
  if (slot === ReceptionShiftSlot.EVENING) return "evening";
  return "night";
}

export async function buildDayShiftReconciliation(businessDate: Date): Promise<DayShiftReconciliation> {
  const dayEnd = new Date(businessDate);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const morningWin = getShiftWindow(businessDate, ReceptionShiftSlot.MORNING);
  const eveningWin = getShiftWindow(businessDate, ReceptionShiftSlot.EVENING);

  const invoices = await fetchDayInvoices(businessDate, dayEnd);

  let dayTotalFcfa = 0;
  let morningTotalFcfa = 0;
  let morningCount = 0;
  let eveningTotalFcfa = 0;
  let eveningCount = 0;
  let nightTotalFcfa = 0;
  let nightCount = 0;
  let offShiftTotalFcfa = 0;
  let offShiftCount = 0;

  const globalBucketMap = new Map<string, OffShiftBucket>();
  const cashierOffShiftMap = new Map<string, CashierOffShiftAcc>();

  for (const invoice of invoices) {
    const collectedAt = invoiceCollectedAt(invoice);
    if (!collectedAt) continue;

    dayTotalFcfa += invoice.amountFcfa;

    if (!isCashCollectorRole(invoice.issuedBy.role)) {
      offShiftTotalFcfa += invoice.amountFcfa;
      offShiftCount += 1;
      addGlobalBucket(globalBucketMap, "non_cashier", invoice.amountFcfa);
      continue;
    }

    if (inHalfOpenWindow(collectedAt, morningWin.from, morningWin.to)) {
      morningTotalFcfa += invoice.amountFcfa;
      morningCount += 1;
      continue;
    }

    if (inHalfOpenWindow(collectedAt, eveningWin.from, eveningWin.to)) {
      eveningTotalFcfa += invoice.amountFcfa;
      eveningCount += 1;
      continue;
    }

    if (isNightHoursOnCalendarDay(collectedAt)) {
      nightTotalFcfa += invoice.amountFcfa;
      nightCount += 1;
      continue;
    }

    offShiftTotalFcfa += invoice.amountFcfa;
    offShiftCount += 1;

    const bucketId = offShiftBucketId(collectedAt);
    addGlobalBucket(globalBucketMap, bucketId, invoice.amountFcfa);
    getOrCreateCashierAcc(cashierOffShiftMap, invoice, bucketId);
  }

  const byCashier = [...cashierOffShiftMap.values()]
    .map(({ _invoices, buckets, ...row }) => ({
      ...row,
      buckets: buckets.sort((a, b) => b.totalFcfa - a.totalFcfa),
      typeBreakdown: buildSettlementBreakdown(_invoices),
    }))
    .sort((a, b) => b.totalFcfa - a.totalFcfa);

  const settlements = await prisma.receptionCashSettlement.findMany({
    where: { businessDate },
    select: { shiftSlot: true, disbursementFcfa: true },
  });

  const unsettledByShift = await Promise.all(
    ALL_SHIFT_SLOTS.map(async (slot) => {
      const { from, to } = getShiftWindow(businessDate, slot);
      const rows = await prisma.invoice.findMany({
        where: {
          cashSettlementLine: null,
          issuedBy: { role: { in: CASH_COLLECTOR_ROLES } },
          OR: [
            { status: "PAID", paidAt: { gte: from, lt: to } },
            {
              type: "CONSULTATION",
              status: "PENDING",
              createdAt: { gte: from, lt: to },
            },
          ],
        },
        select: { amountFcfa: true },
      });
      return { slot, pendingFcfa: rows.reduce((s, r) => s + r.amountFcfa, 0) };
    }),
  );

  const shiftSlots = {
    morning: { pendingFcfa: 0, settledFcfa: 0, totalFcfa: 0 },
    evening: { pendingFcfa: 0, settledFcfa: 0, totalFcfa: 0 },
    night: { pendingFcfa: 0, settledFcfa: 0, totalFcfa: 0 },
  };

  for (const row of settlements) {
    shiftSlots[slotKey(row.shiftSlot)].settledFcfa += row.disbursementFcfa;
  }

  for (const row of unsettledByShift) {
    shiftSlots[slotKey(row.slot)].pendingFcfa = row.pendingFcfa;
  }

  for (const key of ["morning", "evening", "night"] as const) {
    shiftSlots[key].totalFcfa = shiftSlots[key].pendingFcfa + shiftSlots[key].settledFcfa;
  }

  const partsSumFcfa = morningTotalFcfa + eveningTotalFcfa + nightTotalFcfa + offShiftTotalFcfa;
  const buckets = [...globalBucketMap.values()].sort((a, b) => b.totalFcfa - a.totalFcfa);

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const morningHours = shiftHoursLabel(ReceptionShiftSlot.MORNING);
  const eveningHours = shiftHoursLabel(ReceptionShiftSlot.EVENING);
  const nightHours = shiftHoursLabel(ReceptionShiftSlot.NIGHT);

  return {
    timezoneNote: `Heure locale serveur (${tz}). Créneaux décaissement : matin ${morningHours}, soir ${eveningHours}, nuit ${nightHours}. Hors créneau imputé au caissier encaisseur.`,
    dayWindowLabel: "00h00 – 24h00 (journée calendaire)",
    dayTotalFcfa,
    morningWindow: {
      label: SHIFT_SLOT_LABELS.MORNING,
      hoursLabel: morningHours,
      totalFcfa: morningTotalFcfa,
      transactionCount: morningCount,
    },
    eveningWindow: {
      label: SHIFT_SLOT_LABELS.EVENING,
      hoursLabel: eveningHours,
      totalFcfa: eveningTotalFcfa,
      transactionCount: eveningCount,
    },
    nightWindow: {
      label: SHIFT_SLOT_LABELS.NIGHT,
      hoursLabel: nightHours,
      totalFcfa: nightTotalFcfa,
      transactionCount: nightCount,
    },
    offShift: {
      totalFcfa: offShiftTotalFcfa,
      transactionCount: offShiftCount,
      buckets,
      byCashier,
      warning:
        offShiftTotalFcfa > 0
          ? `Ces montants sont comptés au jour et imputés au caissier qui a encaissé. Ils ne sont pas rattachés au décaissement matin (${morningHours}), soir (${eveningHours}) ni nuit (${nightHours}).`
          : "Aucun encaissement hors créneau caisse sur cette date.",
    },
    shiftSlots,
    formula: {
      description: "Recettes du jour = fenêtre matin + fenêtre soir + fenêtre nuit + hors créneau",
      partsSumFcfa,
      isBalanced: partsSumFcfa === dayTotalFcfa,
    },
  };
}

function addGlobalBucket(map: Map<string, OffShiftBucket>, id: string, amountFcfa: number) {
  const label =
    id === "non_cashier"
      ? "Encaissement hors caissier comptoir (rôle non réception/compta)"
      : `${OFF_SHIFT_BUCKET_LABELS[id] ?? id} (hors créneau caisse)`;

  const existing = map.get(id) ?? { id, label, totalFcfa: 0, count: 0 };
  existing.totalFcfa += amountFcfa;
  existing.count += 1;
  map.set(id, existing);
}
