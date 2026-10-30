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
    const auditLines = [];
    for (const line of lines) {
      let productId = line.productId ?? null;
      // La facture compte des boîtes ; un produit vendu au détail est stocké en sachets.
      let unitsPerBox = 1;
      const expiryData =
        line.noExpiry
          ? { expiryDate: null, noExpiry: true }
          : line.expiryDate
            ? { expiryDate: line.expiryDate, noExpiry: false }
            : {};

      if (productId) {
        const existing = await tx.product.findUnique({ where: { id: productId } });
        if (!existing) throw new Error("PRODUCT_NOT_FOUND");
        if (existing.sellBySachet && existing.sachetsPerBox > 1) unitsPerBox = existing.sachetsPerBox;
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
          quantity: line.quantity * unitsPerBox,
          unitCostFcfa: Math.round(line.purchasePriceFcfa / unitsPerBox),
          supplierId: supplier.id,
          reference,
          notes:
            unitsPerBox > 1
              ? `Facture fournisseur n° ${invoiceNumber} — ${line.quantity} boîte(s) × ${unitsPerBox}`
              : `Facture fournisseur n° ${invoiceNumber}`,
          userId: input.userId,
        }),
      );
      auditLines.push({
        productId,
        quantity: line.quantity,
        unitCostFcfa: line.purchasePriceFcfa,
        stockQuantity: line.quantity * unitsPerBox,
      });
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
          lines: auditLines,
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

type PurchaseAuditMetadata = {
  invoiceNumber?: string;
  lines?: Array<{ productId: string; quantity: number; unitCostFcfa: number | null }>;
};

export type PurchaseExpenseDetails = {
  invoiceNumber: string | null;
  lines: Array<{ productName: string; quantity: number; unitCostFcfa: number; totalFcfa: number }>;
};

/**
 * Produits achetés de chaque facture fournisseur, par id de dépense
 * (lus dans le journal d'audit écrit à l'enregistrement de la facture).
 */
export async function loadPurchaseDetails(expenseIds: string[]) {
  const audits = expenseIds.length
    ? await prisma.auditLog.findMany({
        where: { entity: "PharmacyPurchase", entityId: { in: expenseIds } },
        select: { entityId: true, metadata: true },
      })
    : [];
  const metadataRows = audits.map((row) => ({
    expenseId: row.entityId!,
    metadata: (row.metadata ?? {}) as PurchaseAuditMetadata,
  }));

  const productIds = [
    ...new Set(metadataRows.flatMap((row) => row.metadata.lines ?? []).map((line) => line.productId)),
  ];
  const products = productIds.length
    ? await prisma.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, name: true, dosage: true },
      })
    : [];
  const productName = new Map(
    products.map((row) => [row.id, row.dosage ? `${row.name} ${row.dosage}` : row.name]),
  );

  return new Map<string, PurchaseExpenseDetails>(
    metadataRows.map(({ expenseId, metadata }) => [
      expenseId,
      {
        invoiceNumber: metadata.invoiceNumber ?? null,
        lines: (metadata.lines ?? []).map((line) => ({
          productName: productName.get(line.productId) ?? "Produit supprimé",
          quantity: line.quantity,
          unitCostFcfa: line.unitCostFcfa ?? 0,
          totalFcfa: line.quantity * (line.unitCostFcfa ?? 0),
        })),
      },
    ]),
  );
}

/** Ajoute `purchase` (produits achetés) aux dépenses issues d'une facture fournisseur. */
export async function withPurchaseDetails<T extends { id: string }>(rows: T[]) {
  const details = await loadPurchaseDetails(rows.map((row) => row.id));
  return rows.map((row) => ({ ...row, purchase: details.get(row.id) ?? null }));
}

/**
 * Factures fournisseur saisies sur la période (date comptable) : nombre, montant total
 * et produits entrés en stock pour chaque facture (lus dans le journal d'audit).
 */
export async function buildPharmacyPurchaseReport(fromIso: string, toIso: string) {
  const expenses = await prisma.clinicExpense.findMany({
    where: {
      indice: { name: PHARMACY_PURCHASE_INDICE.name },
      status: ClinicExpenseStatus.VALIDATED,
      businessDate: { gte: parseBusinessDate(fromIso), lte: parseBusinessDate(toIso) },
    },
    orderBy: [{ businessDate: "desc" }, { createdAt: "desc" }],
    select: { id: true, businessDate: true, amountFcfa: true, label: true, beneficiary: true },
  });

  const detailsByExpense = await loadPurchaseDetails(expenses.map((row) => row.id));

  const invoices = expenses.map((expense) => {
    const lines = detailsByExpense.get(expense.id)?.lines ?? [];
    return {
      id: expense.id,
      businessDate: expense.businessDate.toISOString().slice(0, 10),
      invoiceNumber:
        detailsByExpense.get(expense.id)?.invoiceNumber ?? expense.label.match(/facture n° (.+)$/)?.[1] ?? "—",
      supplierName: expense.beneficiary ?? "—",
      amountFcfa: expense.amountFcfa,
      productsCount: lines.length,
      unitsCount: lines.reduce((sum, line) => sum + line.quantity, 0),
      lines,
    };
  });

  return {
    from: fromIso,
    to: toIso,
    invoicesCount: invoices.length,
    totalFcfa: invoices.reduce((sum, row) => sum + row.amountFcfa, 0),
    productsCount: invoices.reduce((sum, row) => sum + row.productsCount, 0),
    invoices,
  };
}
