import type { LabStockMovementType, Prisma } from "@prisma/client";

export type LabStockMovementInput = {
  itemId: string;
  type: LabStockMovementType;
  quantity?: number;
  targetQuantity?: number;
  unitCostFcfa?: number;
  reference?: string;
  notes?: string;
  userId: string;
};

const movementInclude = {
  item: { select: { id: true, name: true, sku: true, unit: true } },
  user: { select: { id: true, firstName: true, lastName: true } },
} as const;

async function loadItemAfterChange(tx: Prisma.TransactionClient, itemId: string) {
  const item = await tx.labStockItem.findUnique({ where: { id: itemId } });
  if (!item) throw new Error("ITEM_NOT_FOUND");
  return item;
}

export async function applyLabStockMovement(tx: Prisma.TransactionClient, input: LabStockMovementInput) {
  const item = await tx.labStockItem.findUnique({ where: { id: input.itemId } });
  if (!item) throw new Error("ITEM_NOT_FOUND");

  let stockAfter: number;
  let movementQuantity: number;

  if (input.type === "ADJUSTMENT") {
    if (input.targetQuantity === undefined) throw new Error("TARGET_QUANTITY_REQUIRED");
    if (input.targetQuantity < 0) throw new Error("INVALID_QUANTITY");
    stockAfter = input.targetQuantity;
    movementQuantity = Math.abs(stockAfter - item.quantity);
    if (movementQuantity === 0) throw new Error("NO_STOCK_CHANGE");
    await tx.labStockItem.update({
      where: { id: item.id },
      data: { quantity: stockAfter },
    });
  } else {
    if (!input.quantity || input.quantity <= 0) throw new Error("INVALID_QUANTITY");
    movementQuantity = input.quantity;
    if (input.type === "ENTRY") {
      const updated = await tx.labStockItem.update({
        where: { id: item.id },
        data: {
          quantity: { increment: movementQuantity },
          ...(input.unitCostFcfa != null ? { unitCostFcfa: input.unitCostFcfa } : {}),
        },
      });
      stockAfter = updated.quantity;
    } else {
      const result = await tx.labStockItem.updateMany({
        where: { id: item.id, quantity: { gte: movementQuantity } },
        data: { quantity: { decrement: movementQuantity } },
      });
      if (result.count !== 1) throw new Error("INSUFFICIENT_STOCK");
      stockAfter = (await loadItemAfterChange(tx, item.id)).quantity;
    }
  }

  return tx.labStockMovement.create({
    data: {
      itemId: item.id,
      type: input.type,
      quantity: movementQuantity,
      unitCostFcfa: input.unitCostFcfa,
      reference: input.reference,
      notes: input.notes,
      userId: input.userId,
      stockAfter,
    },
    include: movementInclude,
  });
}
