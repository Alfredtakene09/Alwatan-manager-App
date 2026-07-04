import { prisma } from "./db.js";

export type PharmacyStockAlert = {
  productId: string;
  name: string;
  sku: string;
  quantity: number;
  minStock: number;
  unitPriceFcfa: number;
  categoryName: string | null;
  level: "out" | "critical" | "low";
  kind: "stock";
};

export type PharmacyExpiryAlert = {
  productId: string;
  name: string;
  sku: string;
  expiryDate: string;
  daysLeft: number;
  level: "expired" | "soon";
  kind: "expiry";
};

export async function listPharmacyExpiryAlerts(withinDays = 60): Promise<PharmacyExpiryAlert[]> {
  const now = new Date();
  const horizon = new Date(now);
  horizon.setDate(horizon.getDate() + withinDays);

  const products = await prisma.product.findMany({
    where: {
      active: true,
      noExpiry: false,
      expiryDate: { not: null, lte: horizon },
    },
    orderBy: { expiryDate: "asc" },
    select: {
      id: true,
      name: true,
      sku: true,
      expiryDate: true,
    },
  });

  return products
    .filter((product) => product.expiryDate)
    .map((product) => {
      const expiry = product.expiryDate!;
      const daysLeft = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      return {
        productId: product.id,
        name: product.name,
        sku: product.sku,
        expiryDate: expiry.toISOString().slice(0, 10),
        daysLeft,
        level: daysLeft < 0 ? "expired" : "soon",
        kind: "expiry" as const,
      };
    });
}

export async function listPharmacyStockAlerts(): Promise<PharmacyStockAlert[]> {
  const products = await prisma.product.findMany({
    where: { active: true },
    orderBy: [{ quantity: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      sku: true,
      quantity: true,
      minStock: true,
      unitPriceFcfa: true,
      category: { select: { name: true } },
    },
  });

  return products
    .filter((product) => product.quantity <= product.minStock)
    .map((product) => ({
      productId: product.id,
      name: product.name,
      sku: product.sku,
      quantity: product.quantity,
      minStock: product.minStock,
      unitPriceFcfa: product.unitPriceFcfa,
      categoryName: product.category?.name ?? null,
      level:
        product.quantity <= 0
          ? "out"
          : product.quantity <= Math.max(1, Math.floor(product.minStock / 2))
            ? "critical"
            : "low",
      kind: "stock" as const,
    }));
}

export async function countLowStockProducts(): Promise<number> {
  const products = await prisma.product.findMany({
    where: { active: true },
    select: { quantity: true, minStock: true },
  });
  return products.filter((product) => product.quantity <= product.minStock).length;
}
