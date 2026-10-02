import { formatBusinessDate } from "./cash-shift.js";
import { prisma } from "./db.js";
import { buildPharmacyRevenueReport } from "./pharmacy-revenue.js";

export type PharmacyDayClosureProductLine = {
  label: string;
  qty: number;
  totalFcfa: number;
};

export function pharmacyDayBounds(now = new Date()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end, businessDate: start, businessDateIso: formatBusinessDate(start) };
}

function parseLocalIsoDay(iso: string | undefined, fallback: Date) {
  if (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const [year, month, day] = iso.split("-").map(Number);
    return new Date(year, month - 1, day, 0, 0, 0, 0);
  }
  const start = new Date(fallback);
  start.setHours(0, 0, 0, 0);
  return start;
}

function mergeProductLine(
  map: Map<string, PharmacyDayClosureProductLine>,
  label: string,
  qty: number,
  totalFcfa: number,
) {
  const key = label.trim() || "Produit";
  const existing = map.get(key);
  if (existing) {
    existing.qty += qty;
    existing.totalFcfa += totalFcfa;
    return;
  }
  map.set(key, { label: key, qty, totalFcfa });
}

export async function buildPharmacyDayClosureSnapshot(
  pharmacistId?: string,
  now = new Date(),
  range?: { from?: string; to?: string },
) {
  const start = parseLocalIsoDay(range?.from, now);
  let endDay = parseLocalIsoDay(range?.to ?? range?.from, now);
  if (endDay < start) endDay = new Date(start);
  const maxRangeMs = 366 * 24 * 60 * 60 * 1000;
  if (endDay.getTime() - start.getTime() > maxRangeMs) {
    endDay = new Date(start);
    endDay.setDate(endDay.getDate() + 366);
  }
  const end = new Date(endDay);
  end.setDate(end.getDate() + 1);
  const fromIso = formatBusinessDate(start);
  const toIso = formatBusinessDate(endDay);
  const singleDay = fromIso === toIso;
  const pharmacistFilter = pharmacistId ? { pharmacistId } : {};
  const periodWhere = { createdAt: { gte: start, lt: end }, ...pharmacistFilter };

  const [report, user, existing, saleLines, returnRows] = await Promise.all([
    buildPharmacyRevenueReport({
      from: fromIso,
      to: toIso,
      pharmacistId,
    }),
    pharmacistId
      ? prisma.user.findUnique({
          where: { id: pharmacistId },
          select: { firstName: true, lastName: true, username: true },
        })
      : Promise.resolve(null),
    pharmacistId && singleDay
      ? prisma.pharmacyDayClosure.findUnique({
          where: {
            pharmacistId_businessDate: { pharmacistId, businessDate: start },
          },
        })
      : Promise.resolve(null),
    prisma.pharmacySaleLine.findMany({
      where: { prescription: periodWhere },
      select: {
        quantity: true,
        lineTotalFcfa: true,
        product: { select: { name: true } },
      },
    }),
    prisma.pharmacySaleReturn.findMany({
      where: {
        createdAt: { gte: start, lt: end },
        prescription: pharmacistFilter,
      },
      select: {
        quantity: true,
        grossRefundFcfa: true,
        netRefundFcfa: true,
        product: { select: { name: true } },
      },
    }),
  ]);

  const productMap = new Map<string, PharmacyDayClosureProductLine>();
  for (const line of saleLines) {
    mergeProductLine(productMap, line.product.name, line.quantity, line.lineTotalFcfa);
  }
  for (const row of returnRows) {
    mergeProductLine(
      productMap,
      row.product.name,
      -row.quantity,
      -(row.grossRefundFcfa || row.netRefundFcfa),
    );
  }
  const productLines = [...productMap.values()]
    .map((line) => ({
      label: line.label,
      qty: line.qty,
      totalFcfa: Math.max(0, line.totalFcfa),
    }))
    .filter((line) => line.qty > 0 || line.totalFcfa > 0)
    .sort((a, b) => a.label.localeCompare(b.label, "fr"));

  const pharmacistName = user
    ? `${user.firstName} ${user.lastName}`.trim()
    : "Tous les pharmaciens";
  const catalogueSalesFcfa = Math.max(0, report.grossSalesFcfa - report.returnsGrossFcfa);
  const netFcfa = report.netRevenueFcfa;
  const discountFcfa = Math.max(0, catalogueSalesFcfa - netFcfa);
  return {
    businessDate: fromIso,
    periodTo: toIso,
    pharmacistName,
    pharmacistUsername: user?.username?.trim() || "",
    salesCount: report.prescriptionsCount,
    returnsCount: report.returnsCount,
    grossSalesFcfa: report.netSalesFcfa,
    catalogueSalesFcfa,
    discountFcfa,
    returnsFcfa: report.returnsNetFcfa,
    netFcfa,
    productLines,
    closed: Boolean(existing),
    closedAt: existing?.closedAt.toISOString() ?? null,
  };
}
