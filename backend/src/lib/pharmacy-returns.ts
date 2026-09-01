import type { Prisma } from "@prisma/client";
import { InvoiceStatus } from "@prisma/client";
import { applyStockMovement } from "./pharmacy-stock.js";

export class PharmacyReturnError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "PharmacyReturnError";
  }
}

export function startOfLocalDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function isSameCalendarDay(a: Date, b: Date): boolean {
  return startOfLocalDay(a).getTime() === startOfLocalDay(b).getTime();
}

export function computeReturnableQuantity(soldQuantity: number, alreadyReturned: number): number {
  return Math.max(0, soldQuantity - alreadyReturned);
}

/** Remboursement net proportionnel au reste encaissable de la vente. */
export function computeProportionalNetRefund(options: {
  grossRefundFcfa: number;
  remainingGrossFcfa: number;
  remainingNetFcfa: number;
}): number {
  const { grossRefundFcfa, remainingGrossFcfa, remainingNetFcfa } = options;
  if (grossRefundFcfa <= 0 || remainingGrossFcfa <= 0 || remainingNetFcfa <= 0) return 0;
  return Math.min(
    remainingNetFcfa,
    Math.round((grossRefundFcfa * remainingNetFcfa) / remainingGrossFcfa),
  );
}

export function resolvePrescriptionTotals(prescription: {
  grossTotalFcfa: number | null;
  netTotalFcfa: number | null;
  saleLines: Array<{ lineTotalFcfa: number }>;
  saleReturns: Array<{ grossRefundFcfa: number; netRefundFcfa: number }>;
}) {
  const grossAtSale =
    prescription.grossTotalFcfa ??
    prescription.saleLines.reduce((sum, line) => sum + line.lineTotalFcfa, 0);
  const netAtSale = prescription.netTotalFcfa ?? grossAtSale;
  const returnedGross = prescription.saleReturns.reduce((sum, row) => sum + row.grossRefundFcfa, 0);
  const returnedNet = prescription.saleReturns.reduce((sum, row) => sum + row.netRefundFcfa, 0);
  return {
    grossAtSale,
    netAtSale,
    remainingGrossFcfa: Math.max(0, grossAtSale - returnedGross),
    remainingNetFcfa: Math.max(0, netAtSale - returnedNet),
  };
}

export function canRegisterPharmacyReturn(
  user: { id: string; role: string },
  prescription: { pharmacistId: string; createdAt: Date },
  now = new Date(),
): boolean {
  if (!isSameCalendarDay(prescription.createdAt, now)) return false;
  if (user.role === "PHARMACIEN") return prescription.pharmacistId === user.id;
  return user.role === "ADMIN" || user.role === "GESTIONNAIRE" || user.role === "COMPTABLE";
}

export type PharmacyReturnLineInput = {
  saleLineId: string;
  quantity: number;
  reason?: string;
};

export async function applyPharmacySaleReturns(
  tx: Prisma.TransactionClient,
  params: {
    prescriptionId: string;
    items: PharmacyReturnLineInput[];
    userId: string;
    now?: Date;
  },
) {
  const now = params.now ?? new Date();
  const prescription = await tx.prescription.findUnique({
    where: { id: params.prescriptionId },
    include: {
      saleLines: { include: { returns: true, invoice: true } },
      saleReturns: true,
    },
  });
  if (!prescription) throw new PharmacyReturnError("SALE_NOT_FOUND", "Vente introuvable");
  if (!isSameCalendarDay(prescription.createdAt, now)) {
    throw new PharmacyReturnError("RETURN_NOT_SAME_DAY", "Les retours sont autorisés uniquement le jour de la vente.");
  }

  const totals = resolvePrescriptionTotals(prescription);
  let remainingGross = totals.remainingGrossFcfa;
  let remainingNet = totals.remainingNetFcfa;

  const lineMap = new Map(prescription.saleLines.map((line) => [line.id, line]));
  const createdReturns: Array<{
    id: string;
    saleLineId: string;
    productId: string;
    quantity: number;
    grossRefundFcfa: number;
    netRefundFcfa: number;
    reason: string | null;
  }> = [];

  let totalGrossRefund = 0;
  let totalNetRefund = 0;

  for (const item of params.items) {
    const line = lineMap.get(item.saleLineId);
    if (!line) throw new PharmacyReturnError("LINE_NOT_FOUND", "Ligne de vente introuvable");
    if (item.quantity <= 0) {
      throw new PharmacyReturnError("INVALID_QUANTITY", "Quantité de retour invalide");
    }

    const alreadyReturned = line.returns.reduce((sum, row) => sum + row.quantity, 0);
    const returnable = computeReturnableQuantity(line.quantity, alreadyReturned);
    if (item.quantity > returnable) {
      throw new PharmacyReturnError(
        "RETURN_EXCEEDS_SOLD",
        `Quantité de retour supérieure au reste vendu (${returnable}).`,
      );
    }

    const grossRefundFcfa = line.unitPriceFcfa * item.quantity;
    const netRefundFcfa = computeProportionalNetRefund({
      grossRefundFcfa,
      remainingGrossFcfa: remainingGross,
      remainingNetFcfa: remainingNet,
    });

    remainingGross = Math.max(0, remainingGross - grossRefundFcfa);
    remainingNet = Math.max(0, remainingNet - netRefundFcfa);
    totalGrossRefund += grossRefundFcfa;
    totalNetRefund += netRefundFcfa;

    const created = await tx.pharmacySaleReturn.create({
      data: {
        saleLineId: line.id,
        prescriptionId: prescription.id,
        productId: line.productId,
        quantity: item.quantity,
        grossRefundFcfa,
        netRefundFcfa,
        reason: item.reason?.trim() || null,
        processedById: params.userId,
      },
    });

    await applyStockMovement(tx, {
      productId: line.productId,
      type: "ENTRY",
      quantity: item.quantity,
      reference: `PHARMACY-RETURN-${created.id.slice(0, 8)}`,
      notes: item.reason?.trim() || "Retour produit pharmacie",
      prescriptionId: prescription.id,
      userId: params.userId,
    });

    createdReturns.push({
      id: created.id,
      saleLineId: created.saleLineId,
      productId: created.productId,
      quantity: created.quantity,
      grossRefundFcfa: created.grossRefundFcfa,
      netRefundFcfa: created.netRefundFcfa,
      reason: created.reason,
    });
  }

  const invoiceIds = [
    ...new Set(prescription.saleLines.map((line) => line.invoiceId).filter(Boolean)),
  ] as string[];

  if (totalNetRefund > 0 && invoiceIds.length > 0) {
    for (const invoiceId of invoiceIds) {
      const invoice = await tx.invoice.findUnique({ where: { id: invoiceId } });
      if (!invoice) continue;
      const nextAmount = Math.max(0, invoice.amountFcfa - totalNetRefund);
      const nextPaid = Math.max(0, invoice.paidAmountFcfa - totalNetRefund);
      await tx.invoice.update({
        where: { id: invoiceId },
        data: {
          amountFcfa: nextAmount,
          paidAmountFcfa: nextPaid,
          ...(nextAmount === 0 ? { status: InvoiceStatus.CANCELLED } : {}),
        },
      });
    }
  }

  return {
    prescriptionId: prescription.id,
    totalGrossRefundFcfa: totalGrossRefund,
    totalNetRefundFcfa: totalNetRefund,
    returns: createdReturns,
  };
}
