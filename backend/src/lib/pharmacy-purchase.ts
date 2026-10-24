import {
  ClinicExpenseCategory,
  ClinicExpenseFlow,
  ClinicExpenseStatus,
  type Prisma,
} from "@prisma/client";
import { prisma } from "./db.js";
import { applyStockMovement } from "./pharmacy-stock.js";
import { parseBusinessDate } from "./cash-shift.js";
import { refreshUnvalidatedDayClosureForExpense } from "./cashier-personal-stats.js";

/** Indice comptable des achats fournisseur de la pharmacie. */
export const PHARMACY_PURCHASE_INDICE = {
  name: "Achat pharmacie",
  description: "Achat de médicaments sur facture fournisseur",
  flow: ClinicExpenseFlow.SORTIE,
} as const;

export type PharmacyPurchaseLineInput = {
  productId?: string | null;
  newProduct?: {
    name: string;
    dosage?: string | null;
    pharmaceuticalForm?: string | null;
    categoryId?: string | null;
  } | null;
  quantity: number;
  purchasePriceFcfa: number;
  unitPriceFcfa?: number | null;
  expiryDate?: Date | null;
  noExpiry?: boolean;
};

export type PharmacyPurchaseInput = {
  supplierId: string;
  invoiceNumber: string;
  businessDate: string;
  comment?: string | null;
  lines: PharmacyPurchaseLineInput[];
  userId: string;
  resolveSku: (name: string) => string;
  findDuplicateId: (body: { name: string; dosage?: string | null }) => Promise<string | null>;
};

async function ensurePurchaseIndice(tx: Prisma.TransactionClient) {
  return tx.clinicExpenseIndice.upsert({
    where: { name: PHARMACY_PURCHASE_INDICE.name },
    update: {},
    create: {
      name: PHARMACY_PURCHASE_INDICE.name,
      description: PHARMACY_PURCHASE_INDICE.description,
      flow: PHARMACY_PURCHASE_INDICE.flow,
      sortOrder: 99,
    },
  });
}

/**
 * Facture fournisseur : entrée en stock de chaque ligne, puis une sortie de caisse
 * (dépense validée) du montant total des prix d'achat.
 */
export async function recordPharmacyPurchase(input: PharmacyPurchaseInput) {
  const supplier = await prisma.pharmacySupplier.findFirst({
    where: { id: input.supplierId, active: true },
  });
  if (!supplier) throw new Error("SUPPLIER_NOT_FOUND");

  // La sortie est imputée à la caisse de l'utilisateur connecté qui saisit la facture.
  const cashier = await prisma.user.findFirst({ where: { id: input.userId, active: true } });
  if (!cashier) throw new Error("CASHIER_INVALID");

  // Un « nouveau » produit déjà au catalogue est réapprovisionné, pas dupliqué.
  const lines = await Promise.all(
    input.lines.map(async (line) => {
      if (line.productId || !line.newProduct) return line;
      const duplicateId = await input.findDuplicateId(line.newProduct);
      return duplicateId ? { ...line, productId: duplicateId, newProduct: null } : line;
    }),
  );

  const totalFcfa = lines.reduce((sum, line) => sum + line.quantity * line.purchasePriceFcfa, 0);
  if (totalFcfa <= 0) throw new Error("EMPTY_PURCHASE");

  const businessDate = parseBusinessDate(input.businessDate);
  const invoiceNumber = input.invoiceNumber.trim();
  const reference = `FACT-${invoiceNumber}`;

  const result = await prisma.$transaction(async (tx) => {
    const movements = [];
    for (const line of lines) {
      let productId = line.productId ?? null;
      const expiryData =
        line.noExpiry
          ? { expiryDate: null, noExpiry: true }
          : line.expiryDate
            ? { expiryDate: line.expiryDate, noExpiry: false }
            : {};

      if (productId) {
        const existing = await tx.product.findUnique({ where: { id: productId } });
        if (!existing) throw new Error("PRODUCT_NOT_FOUND");
        await tx.product.update({
          where: { id: productId },
          data: {
            purchasePriceFcfa: line.purchasePriceFcfa,
            ...(line.unitPriceFcfa ? { unitPriceFcfa: line.unitPriceFcfa } : {}),
            supplierId: supplier.id,
            active: true,
            ...expiryData,
          },
        });
      } else {
        const product = line.newProduct!;
        if (!line.unitPriceFcfa) throw new Error("SALE_PRICE_REQUIRED");
        const created = await tx.product.create({
          data: {
            name: product.name.trim(),
            sku: input.resolveSku(product.name),
            dosage: product.dosage?.trim() || null,
            pharmaceuticalForm: product.pharmaceuticalForm?.trim() || null,
            categoryId: product.categoryId || null,
            supplierId: supplier.id,
            quantity: 0,
            unitPriceFcfa: line.unitPriceFcfa,
            purchasePriceFcfa: line.purchasePriceFcfa,
            ...expiryData,
          },
        });
        productId = created.id;
      }

      movements.push(
        await applyStockMovement(tx, {
          productId,
          type: "ENTRY",
          quantity: line.quantity,
          unitCostFcfa: line.purchasePriceFcfa,
          supplierId: supplier.id,
          reference,
          notes: `Facture fournisseur n° ${invoiceNumber}`,
          userId: input.userId,
        }),
      );
    }

    const indice = await ensurePurchaseIndice(tx);
    const expense = await tx.clinicExpense.create({
      data: {
        businessDate,
        amountFcfa: totalFcfa,
        label: `Achat pharmacie — ${supplier.name} — facture n° ${invoiceNumber}`.slice(0, 200),
        flow: ClinicExpenseFlow.SORTIE,
        category: ClinicExpenseCategory.FOURNITURES,
        indiceId: indice.id,
        status: ClinicExpenseStatus.VALIDATED,
        comment:
          input.comment?.trim() ||
          `${lines.length} produit(s) entré(s) en stock depuis la pharmacie.`,
        beneficiary: supplier.name,
        paidById: cashier.id,
        recordedById: input.userId,
        validatedById: input.userId,
        validatedAt: new Date(),
      },
    });

    await tx.auditLog.create({
      data: {
        userId: input.userId,
        action: "CREATE",
        entity: "PharmacyPurchase",
        entityId: expense.id,
        metadata: {
          supplierId: supplier.id,
          invoiceNumber,
          totalFcfa,
          lines: movements.map((row) => ({
            productId: row.productId,
            quantity: row.quantity,
            unitCostFcfa: row.unitCostFcfa,
          })),
        },
      },
    });

    return { expense, movements };
  });

  await refreshUnvalidatedDayClosureForExpense(cashier.id, businessDate);

  return {
    expenseId: result.expense.id,
    totalFcfa,
    linesCount: result.movements.length,
    supplierName: supplier.name,
    invoiceNumber,
  };
}
