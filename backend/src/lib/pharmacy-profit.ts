import { prisma } from "./db.js";

export type PharmacyProfitPeriod = {
  revenueFcfa: number;
  costFcfa: number;
  profitFcfa: number;
  marginPercent: number;
  /** Lignes vendues sans prix d'achat connu : exclues du CA et du coût ci-dessus. */
  excludedLinesCount: number;
  excludedRevenueFcfa: number;
};

type CostProduct = {
  purchasePriceFcfa: number | null;
  unitPriceFcfa: number;
  sellBySachet: boolean;
  sachetsPerBox: number;
  sachetPriceFcfa: number | null;
};

const costProductSelect = {
  purchasePriceFcfa: true,
  unitPriceFcfa: true,
  sellBySachet: true,
  sachetsPerBox: true,
  sachetPriceFcfa: true,
} as const;

function emptyProfit(): PharmacyProfitPeriod {
  return {
    revenueFcfa: 0,
    costFcfa: 0,
    profitFcfa: 0,
    marginPercent: 0,
    excludedLinesCount: 0,
    excludedRevenueFcfa: 0,
  };
}

/**
 * Coût d'achat d'une unité vendue. Le prix d'achat de la fiche produit est celui
 * d'une boîte : une vente au détail (sachet / comprimé) en coûte une fraction.
 * Null quand le produit n'a pas de prix d'achat.
 */
export function productUnitCostFcfa(product: CostProduct, soldByDetail: boolean): number | null {
  const purchase = product.purchasePriceFcfa;
  if (purchase == null || purchase <= 0) return null;
  if (soldByDetail && product.sachetsPerBox > 1) {
    return Math.round(purchase / product.sachetsPerBox);
  }
  return purchase;
}

/** Ligne enregistrée avant `unitCostFcfa` : vente au détail reconnue à son prix unitaire. */
function inferSoldByDetail(product: CostProduct, unitPriceFcfa: number): boolean {
  return (
    product.sellBySachet &&
    product.sachetsPerBox > 1 &&
    product.sachetPriceFcfa != null &&
    product.sachetPriceFcfa !== product.unitPriceFcfa &&
    unitPriceFcfa === product.sachetPriceFcfa
  );
}

function lineUnitCost(line: {
  unitCostFcfa: number | null;
  unitPriceFcfa: number;
  product: CostProduct;
}): number | null {
  if (line.unitCostFcfa != null) return line.unitCostFcfa;
  return productUnitCostFcfa(line.product, inferSoldByDetail(line.product, line.unitPriceFcfa));
}

/** Part encaissée de la vente (remise / gratuité déduites), entre 0 et 1. */
function netRatio(prescription: { grossTotalFcfa: number | null; netTotalFcfa: number | null }) {
  const gross = prescription.grossTotalFcfa;
  const net = prescription.netTotalFcfa;
  if (gross == null || net == null || gross <= 0) return 1;
  return Math.min(1, Math.max(0, net / gross));
}

export function allocateNetRevenueByLine(
  lines: Array<{ lineTotalFcfa: number }>,
  prescription: { grossTotalFcfa: number | null; netTotalFcfa: number | null },
): number[] {
  const grossLines = lines.map((line) => Math.max(0, line.lineTotalFcfa));
  const grossTotal = grossLines.reduce((sum, amount) => sum + amount, 0);
  if (grossTotal <= 0) return lines.map(() => 0);

  const targetNet = Math.round(grossTotal * netRatio(prescription));
  const exactShares = grossLines.map((amount) => (amount * targetNet) / grossTotal);
  const allocated = exactShares.map(Math.floor);
  let remainder = targetNet - allocated.reduce((sum, amount) => sum + amount, 0);
  const remainderOrder = exactShares
    .map((amount, index) => ({ index, fraction: amount - allocated[index] }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);

  for (let index = 0; remainder > 0; index += 1, remainder -= 1) {
    allocated[remainderOrder[index % remainderOrder.length].index] += 1;
  }
  return allocated;
}

/**
 * Marge brute réalisée sur la période :
 * - CA = montant net des lignes (remises et gratuités réparties au prorata), moins les retours nets ;
 * - coût = quantité × coût unitaire figé à la vente (repli : prix d'achat actuel), moins les retours ;
 * - les lignes de produits sans prix d'achat sont exclues des deux et comptées à part.
 */
export async function computePharmacyProfit(
  from: Date,
  toExclusive: Date,
  options?: { pharmacistId?: string },
): Promise<PharmacyProfitPeriod> {
  const pharmacistFilter = options?.pharmacistId ? { pharmacistId: options.pharmacistId } : {};
  const [saleLines, returns] = await Promise.all([
    prisma.pharmacySaleLine.findMany({
      where: {
        prescription: {
          createdAt: { gte: from, lt: toExclusive },
          ...pharmacistFilter,
        },
      },
      select: {
        prescriptionId: true,
        quantity: true,
        unitPriceFcfa: true,
        lineTotalFcfa: true,
        unitCostFcfa: true,
        product: { select: costProductSelect },
        prescription: { select: { grossTotalFcfa: true, netTotalFcfa: true } },
      },
    }),
    prisma.pharmacySaleReturn.findMany({
      where: {
        createdAt: { gte: from, lt: toExclusive },
        prescription: pharmacistFilter,
      },
      select: {
        quantity: true,
        netRefundFcfa: true,
        saleLine: {
          select: {
            unitPriceFcfa: true,
            unitCostFcfa: true,
            product: { select: costProductSelect },
          },
        },
      },
    }),
  ]);

  if (!saleLines.length && !returns.length) return emptyProfit();

  const result = emptyProfit();
  let revenueFcfa = 0;
  let costFcfa = 0;
  const linesByPrescription = new Map<
    string,
    {
      prescription: (typeof saleLines)[number]["prescription"];
      lines: typeof saleLines;
    }
  >();
  for (const line of saleLines) {
    const group = linesByPrescription.get(line.prescriptionId);
    if (group) {
      group.lines.push(line);
    } else {
      linesByPrescription.set(line.prescriptionId, {
        prescription: line.prescription,
        lines: [line],
      });
    }
  }
  for (const group of linesByPrescription.values()) {
    const lineNetAmounts = allocateNetRevenueByLine(group.lines, group.prescription);
    for (const [index, line] of group.lines.entries()) {
      const lineNet = lineNetAmounts[index];
      const unitCost = lineUnitCost(line);
      if (unitCost == null) {
        result.excludedLinesCount += 1;
        result.excludedRevenueFcfa += lineNet;
        continue;
      }
      revenueFcfa += lineNet;
      costFcfa += line.quantity * unitCost;
    }
  }
  for (const row of returns) {
    const unitCost = lineUnitCost(row.saleLine);
    if (unitCost == null) {
      result.excludedRevenueFcfa -= row.netRefundFcfa;
      continue;
    }
    revenueFcfa -= row.netRefundFcfa;
    costFcfa -= row.quantity * unitCost;
  }

  revenueFcfa = Math.max(0, revenueFcfa);
  costFcfa = Math.max(0, costFcfa);
  const profitFcfa = revenueFcfa - costFcfa;
  return {
    revenueFcfa,
    costFcfa,
    profitFcfa,
    marginPercent: revenueFcfa > 0 ? Math.round((profitFcfa / revenueFcfa) * 1000) / 10 : 0,
    excludedLinesCount: result.excludedLinesCount,
    excludedRevenueFcfa: Math.max(0, result.excludedRevenueFcfa),
  };
}
