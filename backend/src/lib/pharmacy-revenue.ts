import { prisma } from "./db.js";

function startOfDay(date: Date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfWeek(date: Date) {
  const d = startOfDay(date);
  const day = d.getDay();
  const diff = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - diff);
  return d;
}

function startOfMonth(date: Date) {
  const d = startOfDay(date);
  d.setDate(1);
  return d;
}

function startOfQuarter(date: Date) {
  const d = startOfDay(date);
  const quarterMonth = Math.floor(d.getMonth() / 3) * 3;
  d.setMonth(quarterMonth, 1);
  return d;
}

export function parseRevenuePeriod(
  period: string | undefined,
  fromParam?: string,
  toParam?: string,
  now = new Date(),
) {
  const to = toParam ? startOfDay(new Date(toParam)) : startOfDay(now);
  to.setDate(to.getDate() + 1);

  if (fromParam) {
    return { from: startOfDay(new Date(fromParam)), to, period: "custom" as const };
  }

  const from = startOfDay(now);
  switch (period) {
    case "today":
      return { from, to, period: "today" as const };
    case "week":
      return { from: startOfWeek(now), to, period: "week" as const };
    case "month":
      return { from: startOfMonth(now), to, period: "month" as const };
    case "quarter":
      return { from: startOfQuarter(now), to, period: "quarter" as const };
    case "30d":
      from.setDate(from.getDate() - 29);
      return { from, to, period: "30d" as const };
    case "7d":
    default:
      from.setDate(from.getDate() - 6);
      return { from, to, period: "7d" as const };
  }
}

export async function buildPharmacyRevenueReport(options?: {
  period?: string;
  from?: string;
  to?: string;
  pharmacistId?: string;
}) {
  const { from, to, period } = parseRevenuePeriod(options?.period, options?.from, options?.to);
  const pharmacistFilter = options?.pharmacistId
    ? { pharmacistId: options.pharmacistId }
    : {};

  const [prescriptions, returns, pharmacist] = options?.pharmacistId
    ? await Promise.all([
        prisma.prescription.findMany({
          where: { createdAt: { gte: from, lt: to }, ...pharmacistFilter },
          select: {
            id: true,
            createdAt: true,
            grossTotalFcfa: true,
            netTotalFcfa: true,
            saleLines: { select: { lineTotalFcfa: true } },
          },
        }),
        prisma.pharmacySaleReturn.findMany({
          where: {
            createdAt: { gte: from, lt: to },
            prescription: pharmacistFilter,
          },
          select: { grossRefundFcfa: true, netRefundFcfa: true, createdAt: true },
        }),
        prisma.user.findUnique({
          where: { id: options.pharmacistId },
          select: { id: true, firstName: true, lastName: true },
        }),
      ])
    : await Promise.all([
        prisma.prescription.findMany({
          where: { createdAt: { gte: from, lt: to }, ...pharmacistFilter },
          select: {
            id: true,
            createdAt: true,
            grossTotalFcfa: true,
            netTotalFcfa: true,
            saleLines: { select: { lineTotalFcfa: true } },
          },
        }),
        prisma.pharmacySaleReturn.findMany({
          where: {
            createdAt: { gte: from, lt: to },
            prescription: pharmacistFilter,
          },
          select: { grossRefundFcfa: true, netRefundFcfa: true, createdAt: true },
        }),
        Promise.resolve(null),
      ]);

  let grossSalesFcfa = 0;
  let netSalesFcfa = 0;
  for (const prescription of prescriptions) {
    const gross =
      prescription.grossTotalFcfa ??
      prescription.saleLines.reduce((sum, line) => sum + line.lineTotalFcfa, 0);
    const net = prescription.netTotalFcfa ?? gross;
    grossSalesFcfa += gross;
    netSalesFcfa += net;
  }

  const returnsGrossFcfa = returns.reduce((sum, row) => sum + row.grossRefundFcfa, 0);
  const returnsNetFcfa = returns.reduce((sum, row) => sum + row.netRefundFcfa, 0);
  const netRevenueFcfa = Math.max(0, netSalesFcfa - returnsNetFcfa);

  const byDay = new Map<string, { grossSalesFcfa: number; returnsNetFcfa: number }>();

  for (const prescription of prescriptions) {
    const dayKey = prescription.createdAt.toISOString().slice(0, 10);
    const gross =
      prescription.grossTotalFcfa ??
      prescription.saleLines.reduce((sum, line) => sum + line.lineTotalFcfa, 0);
    const net = prescription.netTotalFcfa ?? gross;
    const row = byDay.get(dayKey) ?? { grossSalesFcfa: 0, returnsNetFcfa: 0 };
    row.grossSalesFcfa += net;
    byDay.set(dayKey, row);
  }

  for (const row of returns) {
    const dayKey = row.createdAt.toISOString().slice(0, 10);
    const bucket = byDay.get(dayKey) ?? { grossSalesFcfa: 0, returnsNetFcfa: 0 };
    bucket.returnsNetFcfa += row.netRefundFcfa;
    byDay.set(dayKey, bucket);
  }

  const salesByDay = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, row]) => ({
      date,
      dayLabel: new Date(`${date}T12:00:00`).toLocaleDateString("fr-FR", {
        weekday: "short",
        day: "numeric",
        month: "short",
      }),
      grossSalesFcfa: row.grossSalesFcfa,
      returnsNetFcfa: row.returnsNetFcfa,
      netRevenueFcfa: Math.max(0, row.grossSalesFcfa - row.returnsNetFcfa),
    }));

  return {
    period,
    from: from.toISOString(),
    to: new Date(to.getTime() - 1).toISOString(),
    pharmacist: pharmacist
      ? { id: pharmacist.id, firstName: pharmacist.firstName, lastName: pharmacist.lastName }
      : null,
    prescriptionsCount: prescriptions.length,
    returnsCount: returns.length,
    grossSalesFcfa,
    netSalesFcfa,
    returnsGrossFcfa,
    returnsNetFcfa,
    netRevenueFcfa,
    salesByDay,
  };
}
