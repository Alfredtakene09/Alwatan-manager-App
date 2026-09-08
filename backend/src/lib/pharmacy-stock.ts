import type { Prisma, StockMovementType } from "@prisma/client";

export type StockMovementInput = {
  productId: string;
  type: Exclude<StockMovementType, "DISPENSATION">;
  quantity?: number;
  targetQuantity?: number;
  unitCostFcfa?: number;
  supplierId?: string;
  reference?: string;
  notes?: string;
  prescriptionId?: string;
  userId: string;
};

async function loadProductAfterChange(tx: Prisma.TransactionClient, productId: string) {
  const product = await tx.product.findUnique({ where: { id: productId } });
  if (!product) throw new Error("PRODUCT_NOT_FOUND");
  return product;
}

export async function applyStockMovement(tx: Prisma.TransactionClient, input: StockMovementInput) {
  const product = await tx.product.findUnique({ where: { id: input.productId } });
  if (!product) throw new Error("PRODUCT_NOT_FOUND");

  let stockAfter: number;
  let movementQuantity: number;

  if (input.type === "ADJUSTMENT") {
    if (input.targetQuantity === undefined) throw new Error("TARGET_QUANTITY_REQUIRED");
    if (input.targetQuantity < 0) throw new Error("INVALID_QUANTITY");
    stockAfter = input.targetQuantity;
    movementQuantity = Math.abs(stockAfter - product.quantity);
    if (movementQuantity === 0) throw new Error("NO_STOCK_CHANGE");
    await tx.product.update({
      where: { id: product.id },
      data: { quantity: stockAfter },
    });
  } else {
    if (!input.quantity || input.quantity <= 0) throw new Error("INVALID_QUANTITY");
    movementQuantity = input.quantity;
    if (input.type === "ENTRY") {
      const updated = await tx.product.update({
        where: { id: product.id },
        data: { quantity: { increment: movementQuantity } },
      });
      stockAfter = updated.quantity;
    } else {
      const result = await tx.product.updateMany({
        where: { id: product.id, quantity: { gte: movementQuantity } },
        data: { quantity: { decrement: movementQuantity } },
      });
      if (result.count !== 1) throw new Error("INSUFFICIENT_STOCK");
      stockAfter = (await loadProductAfterChange(tx, product.id)).quantity;
    }
  }

  if (input.supplierId) {
    const supplier = await tx.pharmacySupplier.findFirst({
      where: { id: input.supplierId, active: true },
    });
    if (!supplier) throw new Error("SUPPLIER_NOT_FOUND");
  }

  return tx.stockMovement.create({
    data: {
      productId: product.id,
      type: input.type,
      quantity: movementQuantity,
      unitCostFcfa: input.unitCostFcfa,
      supplierId: input.supplierId,
      reference: input.reference,
      notes: input.notes,
      prescriptionId: input.prescriptionId,
      userId: input.userId,
      stockAfter,
    },
    include: {
      product: { select: { id: true, name: true, sku: true } },
      supplier: { select: { id: true, name: true } },
      user: { select: { id: true, firstName: true, lastName: true } },
    },
  });
}

export async function recordDispensationMovement(
  tx: Prisma.TransactionClient,
  params: {
    productId: string;
    quantity: number;
    prescriptionId: string;
    userId: string;
  },
) {
  if (params.quantity <= 0) throw new Error("INVALID_QUANTITY");

  const result = await tx.product.updateMany({
    where: { id: params.productId, quantity: { gte: params.quantity } },
    data: { quantity: { decrement: params.quantity } },
  });
  if (result.count !== 1) {
    const exists = await tx.product.findUnique({ where: { id: params.productId }, select: { id: true } });
    if (!exists) throw new Error("PRODUCT_NOT_FOUND");
    throw new Error("INSUFFICIENT_STOCK");
  }

  const product = await loadProductAfterChange(tx, params.productId);

  return tx.stockMovement.create({
    data: {
      productId: product.id,
      type: "DISPENSATION",
      quantity: params.quantity,
      prescriptionId: params.prescriptionId,
      userId: params.userId,
      stockAfter: product.quantity,
    },
  });
}
