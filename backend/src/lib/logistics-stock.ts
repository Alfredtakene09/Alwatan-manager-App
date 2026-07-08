import type { Prisma, LogisticsMovementType } from "@prisma/client";

export type LogisticsMovementInput = {
  itemId: string;
  type: LogisticsMovementType;
  quantity?: number;
  targetQuantity?: number;
  unitCostFcfa?: number;
  supplierId?: string;
  reference?: string;
  notes?: string;
  requestId?: string;
  userId: string;
};

const movementInclude = {
  item: { select: { id: true, name: true, sku: true, unit: true } },
  supplier: { select: { id: true, name: true } },
  user: { select: { id: true, firstName: true, lastName: true } },
} as const;

export async function applyLogisticsMovement(tx: Prisma.TransactionClient, input: LogisticsMovementInput) {
  const item = await tx.logisticsItem.findUnique({ where: { id: input.itemId } });
  if (!item) throw new Error("ITEM_NOT_FOUND");

  let stockAfter: number;
  let movementQuantity: number;

  if (input.type === "ADJUSTMENT") {
    if (input.targetQuantity === undefined) throw new Error("TARGET_QUANTITY_REQUIRED");
    stockAfter = input.targetQuantity;
    movementQuantity = Math.abs(stockAfter - item.quantity);
    if (movementQuantity === 0) throw new Error("NO_STOCK_CHANGE");
  } else {
    if (!input.quantity || input.quantity <= 0) throw new Error("INVALID_QUANTITY");
    movementQuantity = input.quantity;
    if (input.type === "ENTRY") {
      stockAfter = item.quantity + movementQuantity;
    } else {
      if (item.quantity < movementQuantity) throw new Error("INSUFFICIENT_STOCK");
      stockAfter = item.quantity - movementQuantity;
    }
  }

  if (input.supplierId) {
    const supplier = await tx.logisticsSupplier.findFirst({
      where: { id: input.supplierId, active: true },
    });
    if (!supplier) throw new Error("SUPPLIER_NOT_FOUND");
  }

  await tx.logisticsItem.update({
    where: { id: item.id },
    data: {
      quantity: stockAfter,
      ...(input.type === "ENTRY" && input.unitCostFcfa ? { unitCostFcfa: input.unitCostFcfa } : {}),
    },
  });

  return tx.logisticsStockMovement.create({
    data: {
      itemId: item.id,
      type: input.type,
      quantity: movementQuantity,
      unitCostFcfa: input.unitCostFcfa,
      supplierId: input.supplierId,
      reference: input.reference,
      notes: input.notes,
      requestId: input.requestId,
      userId: input.userId,
      stockAfter,
    },
    include: movementInclude,
  });
}
