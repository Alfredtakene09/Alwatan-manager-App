import { prisma } from "./db.js";

function startOfDay(date: Date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function parsePeriod(period: string | undefined, fromParam?: string, toParam?: string) {
  const now = new Date();
  const to = toParam ? startOfDay(new Date(toParam)) : startOfDay(now);
  to.setDate(to.getDate() + 1);

  if (fromParam) {
    return { from: startOfDay(new Date(fromParam)), to };
  }

  const from = startOfDay(now);
  if (period === "30d") {
    from.setDate(from.getDate() - 29);
  } else if (period === "month") {
    from.setDate(1);
  } else {
    from.setDate(from.getDate() - 6);
  }
  return { from, to };
}

export async function buildPharmacyReport(options?: {
  period?: string;
  from?: string;
  to?: string;
}) {
  const { from, to } = parsePeriod(options?.period, options?.from, options?.to);

  const saleLines = await prisma.pharmacySaleLine.findMany({
    where: {
      prescription: { createdAt: { gte: from, lt: to } },
    },
    select: {
      quantity: true,
      lineTotalFcfa: true,
      product: {
        select: {
          id: true,
          name: true,
          category: { select: { id: true, name: true } },
        },
      },
      prescription: { select: { createdAt: true } },
    },
  });

  const prescriptions = await prisma.prescription.findMany({
    where: { createdAt: { gte: from, lt: to } },
    select: { id: true, createdAt: true },
  });

  let totalRevenueFcfa = 0;
  let totalUnitsSold = 0;
  const byProduct = new Map<string, { name: string; quantity: number; revenueFcfa: number }>();
  const byCategory = new Map<string, { name: string; quantity: number; revenueFcfa: number }>();
  const byDay = new Map<string, number>();

  for (const line of saleLines) {
    totalRevenueFcfa += line.lineTotalFcfa;
    totalUnitsSold += line.quantity;

    const productKey = line.product.id;
    const productRow = byProduct.get(productKey) ?? {
      name: line.product.name,
      quantity: 0,
      revenueFcfa: 0,
    };
    productRow.quantity += line.quantity;
    productRow.revenueFcfa += line.lineTotalFcfa;
    byProduct.set(productKey, productRow);

    const categoryId = line.product.category?.id ?? "_none";
    const categoryName = line.product.category?.name ?? "Sans catégorie";
    const categoryRow = byCategory.get(categoryId) ?? {
      name: categoryName,
      quantity: 0,
      revenueFcfa: 0,
    };
    categoryRow.quantity += line.quantity;
    categoryRow.revenueFcfa += line.lineTotalFcfa;
    byCategory.set(categoryId, categoryRow);

    const dayKey = line.prescription.createdAt.toISOString().slice(0, 10);
    byDay.set(dayKey, (byDay.get(dayKey) ?? 0) + line.lineTotalFcfa);
  }

  const salesByDay = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, totalFcfa]) => ({
      date,
      dayLabel: new Date(`${date}T12:00:00`).toLocaleDateString("fr-FR", {
        weekday: "short",
        day: "numeric",
        month: "short",
      }),
      totalFcfa,
    }));

  const topProducts = [...byProduct.values()]
    .sort((a, b) => b.revenueFcfa - a.revenueFcfa)
    .slice(0, 10);

  const salesByCategory = [...byCategory.values()].sort((a, b) => b.revenueFcfa - a.revenueFcfa);

  return {
    from: from.toISOString(),
    to: new Date(to.getTime() - 1).toISOString(),
    prescriptionsCount: prescriptions.length,
    totalUnitsSold,
    totalRevenueFcfa,
    salesByDay,
    topProducts,
    salesByCategory,
  };
}
