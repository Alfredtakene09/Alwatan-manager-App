import { prisma } from "./db.js";

export type PharmacyProfitPeriod = {
  revenueFcfa: number;
  costFcfa: number;
  profitFcfa: number;
  marginPercent: number;
};

function emptyProfit(): PharmacyProfitPeriod {
  return { revenueFcfa: 0, costFcfa: 0, profitFcfa: 0, marginPercent: 0 };
}

function finalizeProfit(revenueFcfa: number, costFcfa: number): PharmacyProfitPeriod {
  const profitFcfa = revenueFcfa - costFcfa;
  const marginPercent = revenueFcfa > 0 ? Math.round((profitFcfa / revenueFcfa) * 1000) / 10 : 0;
  return { revenueFcfa, costFcfa, profitFcfa, marginPercent };
}

/**
 * Marge brute sur les lignes de vente : CA catalogue − coût d'achat (prix d'achat × quantité).
 */
export async function computePharmacyProfit(
  from: Date,
  toExclusive: Date,
  options?: { pharmacistId?: string },
): Promise<PharmacyProfitPeriod> {
  const saleLines = await prisma.pharmacySaleLine.findMany({
    where: {
      prescription: {
        createdAt: { gte: from, lt: toExclusive },
        ...(options?.pharmacistId ? { pharmacistId: options.pharmacistId } : {}),
      },
    },
    select: {
      quantity: true,
      lineTotalFcfa: true,
      product: { select: { purchasePriceFcfa: true } },
    },
  });

  if (!saleLines.length) return emptyProfit();

  let revenueFcfa = 0;
  let costFcfa = 0;
  for (const line of saleLines) {
    revenueFcfa += line.lineTotalFcfa;
    costFcfa += line.quantity * (line.product.purchasePriceFcfa ?? 0);
  }
  return finalizeProfit(revenueFcfa, costFcfa);
}
