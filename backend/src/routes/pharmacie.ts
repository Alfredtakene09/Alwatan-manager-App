import { Router } from "express";
import { z } from "zod";
import { InvoiceStatus, InvoiceType, Prisma } from "@prisma/client";
import { prisma } from "../lib/db.js";
import { generateInvoiceNumber } from "../lib/patient-code.js";
import { immediatePaidInvoiceData } from "../lib/invoice-paid.js";
import { generatePharmacyExternalClientCode, splitPharmacyExternalClientName } from "../lib/pharmacy-external-client.js";
import { shouldCreateImmediateInvoice } from "../lib/patient-billing.js";
import { applyStockMovement, recordDispensationMovement } from "../lib/pharmacy-stock.js";
import { listPharmacyStockAlerts, listPharmacyExpiryAlerts } from "../lib/pharmacy-alerts.js";
import { buildPharmacyReport } from "../lib/pharmacy-reports.js";
import { buildPharmacyRevenueReport } from "../lib/pharmacy-revenue.js";
import { parseLimitParam, yearMonthRange } from "../lib/year-month.js";
import {
  applyPharmacySaleReturns,
  canRegisterPharmacyReturn,
  PharmacyReturnError,
} from "../lib/pharmacy-returns.js";
import {
  hasPharmacyOrdonnance,
  isPharmacyOrdonnanceDispensed,
  markPharmacyOrdonnanceDispensedInNotes,
  parsePharmacyOrdonnanceLines,
  PHARMACY_ORDONNANCE_PREFIX,
} from "../lib/lab-notes.js";
import { requireAuth, requireModule, requirePharmacyCatalogAccess, requireUiAction } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth, requireModule("pharmacie"));

const catalogAccess = [requirePharmacyCatalogAccess, requireUiAction("pharmacie.catalog")] as const;

function routeParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

const prescriptionSchema = z
  .object({
    patientId: z.string().optional(),
    externalClientId: z.string().optional(),
    externalClientName: z.string().optional(),
    externalClientPhone: z.string().optional(),
    visitId: z.string().optional(),
    notes: z.string().optional(),
    reductionFcfa: z.number().int().min(0).optional(),
    isFree: z.boolean().optional(),
    coveredByName: z.string().min(2).optional(),
    items: z.array(z.object({ productId: z.string(), quantity: z.number().int().positive() })).min(1),
  })
  .superRefine((body, ctx) => {
    const hasPatient = Boolean(body.patientId);
    const hasExternalId = Boolean(body.externalClientId);
    const hasExternalName = Boolean(body.externalClientName?.trim());
    if (hasPatient && (hasExternalId || hasExternalName)) {
      ctx.addIssue({ code: "custom", message: "Choisir un patient ou un client externe, pas les deux" });
    }
    if (hasExternalId && hasExternalName) {
      ctx.addIssue({ code: "custom", message: "Indiquer un client existant ou un nouveau nom, pas les deux" });
    }
    const reductionFcfa = body.reductionFcfa ?? 0;
    const isFree = body.isFree === true;
    const coveredByName = body.coveredByName?.trim();
    if ((isFree || reductionFcfa > 0) && !coveredByName) {
      ctx.addIssue({ code: "custom", message: "Nom du responsable requis pour réduction/gratuité" });
    }
  });

const updateSaleLinesSchema = z
  .object({
    lines: z
      .array(
        z.object({
          id: z.string(),
          quantity: z.number().int().positive().max(999),
        }),
      )
      .default([]),
    deleteLineIds: z.array(z.string()).default([]),
  })
  .superRefine((body, ctx) => {
    if (body.lines.length === 0 && body.deleteLineIds.length === 0) {
      ctx.addIssue({ code: "custom", message: "NO_LINE_CHANGES" });
    }
  });

function canEditPharmacySale(
  user: { id: string; role: string },
  prescription: { pharmacistId: string },
) {
  if (user.role === "PHARMACIEN") return prescription.pharmacistId === user.id;
  return user.role === "ADMIN" || user.role === "GESTIONNAIRE" || user.role === "COMPTABLE";
}

const pharmacyReturnSchema = z.object({
  items: z
    .array(
      z.object({
        saleLineId: z.string(),
        quantity: z.number().int().positive().max(999),
        reason: z.string().max(500).optional(),
      }),
    )
    .min(1),
});

function serializePharmacySale(item: {
  id: string;
  createdAt: Date;
  notes: string | null;
  patient: { id: string; code: string; firstName: string; lastName: string } | null;
  externalClient: {
    id: string;
    code: string;
    firstName: string;
    lastName: string;
    phone: string | null;
  } | null;
  pharmacist: { id: string; firstName: string; lastName: string };
  saleLines: Array<{
    id: string;
    productId: string;
    quantity: number;
    unitPriceFcfa: number;
    lineTotalFcfa: number;
    product: {
      id: string;
      name: string;
      sku: string;
      category: { name: string } | null;
    };
    invoice: { invoiceNumber: string; amountFcfa: number; status: string } | null;
    returns: Array<{ quantity: number; grossRefundFcfa: number; netRefundFcfa: number }>;
  }>;
}) {
  const totalFcfa = item.saleLines.reduce((sum, line) => sum + line.lineTotalFcfa, 0);
  const returnedGrossFcfa = item.saleLines.reduce(
    (sum, line) => sum + line.returns.reduce((inner, row) => inner + row.grossRefundFcfa, 0),
    0,
  );
  const returnedNetFcfa = item.saleLines.reduce(
    (sum, line) => sum + line.returns.reduce((inner, row) => inner + row.netRefundFcfa, 0),
    0,
  );
  const invoiceNumber =
    item.saleLines.find((line) => line.invoice?.invoiceNumber)?.invoice?.invoiceNumber ?? null;
  return {
    id: item.id,
    createdAt: item.createdAt,
    notes: item.notes,
    patient: item.patient,
    externalClient: item.externalClient,
    buyerType: item.externalClient ? "external" : "patient",
    pharmacist: item.pharmacist,
    totalFcfa,
    returnedGrossFcfa,
    returnedNetFcfa,
    invoiceNumber,
    lines: item.saleLines.map((line) => {
      const quantityReturned = line.returns.reduce((sum, row) => sum + row.quantity, 0);
      return {
        id: line.id,
        productId: line.productId,
        productName: line.product.name,
        sku: line.product.sku,
        categoryName: line.product.category?.name ?? null,
        quantity: line.quantity,
        quantityReturned,
        quantityReturnable: Math.max(0, line.quantity - quantityReturned),
        unitPriceFcfa: line.unitPriceFcfa,
        lineTotalFcfa: line.lineTotalFcfa,
      };
    }),
  };
}

const externalClientSchema = z.object({
  firstName: z.string().min(2),
  lastName: z.string().min(2),
  phone: z.string().optional(),
  active: z.boolean().optional(),
});

const fcfaInt = z.preprocess(
  (value) => Math.round(Number(value)),
  z.number().int().positive(),
);

const fcfaIntOptional = z.preprocess(
  (value) => {
    if (value === null || value === undefined || value === "") return null;
    const rounded = Math.round(Number(value));
    return Number.isFinite(rounded) && rounded > 0 ? rounded : null;
  },
  z.number().int().positive().nullable(),
);

const stockInt = z.preprocess(
  (value) => Math.round(Number(value)),
  z.number().int().min(0),
);

const productSchema = z.object({
  name: z.string().min(2),
  sku: z.string().min(2).optional(),
  barcode: z.string().optional(),
  dosage: z.string().optional(),
  pharmaceuticalForm: z.string().optional(),
  categoryId: z.string().optional().nullable(),
  supplierId: z.string().optional().nullable(),
  expiryDate: z.string().optional().nullable(),
  noExpiry: z.boolean().optional(),
  quantity: stockInt.optional(),
  unitPriceFcfa: fcfaInt,
  purchasePriceFcfa: fcfaIntOptional.optional(),
  minStock: stockInt.optional(),
  sachetsPerBox: z.preprocess(
    (value) => Math.round(Number(value)),
    z.number().int().positive(),
  ).optional(),
  sachetPriceFcfa: fcfaIntOptional.optional(),
  sellBySachet: z.boolean().optional(),
  active: z.boolean().optional(),
});

function resolveProductSku(input: { sku?: string; barcode?: string; name: string }) {
  const sku = input.sku?.trim();
  if (sku && sku.length >= 2) return sku;
  const slug = input.name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24);
  return `MED-${slug || "PRODUIT"}-${Date.now().toString(36).toUpperCase()}`;
}

function mapProductCatalogError(error: unknown, res: import("express").Response) {
  if (error instanceof z.ZodError) {
    const field = error.issues[0]?.path.join(".") || "champ";
    return res.status(400).json({ error: `Données invalides — vérifiez le ${field}.` });
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      const target = String(error.meta?.target ?? "");
      if (target.includes("barcode")) {
        return res.status(409).json({ error: "Ce code-barres est déjà utilisé par un autre produit." });
      }
      if (target.includes("sku")) {
        return res.status(409).json({ error: "Ce code produit (SKU) existe déjà." });
      }
      return res.status(409).json({ error: "Référence produit déjà utilisée." });
    }
    if (error.code === "P2003") {
      return res.status(400).json({ error: "Catégorie ou fournisseur invalide." });
    }
  }
  return res.status(400).json({ error: "Enregistrement impossible — vérifiez les données saisies." });
}

function parseExpiryDate(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function productDataFromBody(body: z.infer<typeof productSchema>, options?: { includeSku?: boolean }) {
  const sku = options?.includeSku === false ? undefined : resolveProductSku(body);
  return {
    ...(sku ? { sku } : {}),
    name: body.name,
    barcode: body.barcode?.trim() || null,
    dosage: body.dosage?.trim() || null,
    pharmaceuticalForm: body.pharmaceuticalForm?.trim() || null,
    categoryId: body.categoryId || null,
    supplierId: body.supplierId || null,
    expiryDate: body.noExpiry ? null : parseExpiryDate(body.expiryDate),
    noExpiry: body.noExpiry ?? false,
    quantity: body.quantity ?? 0,
    unitPriceFcfa: body.unitPriceFcfa,
    purchasePriceFcfa: body.purchasePriceFcfa ?? null,
    minStock: body.minStock ?? 10,
    sachetsPerBox: body.sachetsPerBox ?? 1,
    sachetPriceFcfa: body.sachetPriceFcfa ?? null,
    sellBySachet: body.sellBySachet ?? false,
    active: body.active ?? true,
  };
}

const productInclude = {
  category: { select: { id: true, name: true } },
  supplier: { select: { id: true, name: true } },
};

const categorySchema = z.object({
  name: z.string().min(2),
  sortOrder: z.number().int().min(0).optional(),
  active: z.boolean().optional(),
});

const formSchema = z.object({
  name: z.string().min(2),
  sortOrder: z.number().int().min(0).optional(),
  active: z.boolean().optional(),
});

const supplierSchema = z.object({
  name: z.string().min(2),
  contactName: z.string().optional(),
  phone: z.string().optional(),
  email: z.union([z.string().email(), z.literal("")]).optional(),
  address: z.string().optional(),
  active: z.boolean().optional(),
});

const stockMovementSchema = z
  .object({
    productId: z.string(),
    type: z.enum(["ENTRY", "EXIT", "ADJUSTMENT"]),
    quantity: z.number().int().positive().optional(),
    targetQuantity: z.number().int().min(0).optional(),
    unitCostFcfa: z.number().int().positive().optional(),
    supplierId: z.string().optional(),
    reference: z.string().optional(),
    notes: z.string().optional(),
  })
  .superRefine((body, ctx) => {
    if (body.type === "ADJUSTMENT") {
      if (body.targetQuantity === undefined) {
        ctx.addIssue({ code: "custom", message: "targetQuantity requis pour un ajustement" });
      }
      return;
    }
    if (!body.quantity) {
      ctx.addIssue({ code: "custom", message: "quantity requise" });
    }
    if (body.type === "ENTRY" && !body.supplierId) {
      ctx.addIssue({ code: "custom", message: "supplierId requis pour une entrée" });
    }
  });

function mapStockError(error: unknown, res: import("express").Response) {
  if (error instanceof z.ZodError) return res.status(400).json({ error: "Données invalides" });
  if (error instanceof PharmacyReturnError) {
    if (error.code === "SALE_NOT_FOUND") return res.status(404).json({ error: error.message });
    if (error.code === "LINE_NOT_FOUND") return res.status(404).json({ error: error.message });
    if (error.code === "RETURN_NOT_SAME_DAY") return res.status(400).json({ error: error.message });
    if (error.code === "RETURN_EXCEEDS_SOLD") return res.status(409).json({ error: error.message });
    if (error.code === "INVALID_QUANTITY") return res.status(400).json({ error: error.message });
    return res.status(400).json({ error: error.message });
  }
  if (error instanceof Error) {
    if (error.message === "INVALID_EXTERNAL_NAME") return res.status(400).json({ error: "Nom du client externe invalide" });
    if (error.message === "INSUFFICIENT_STOCK") return res.status(409).json({ error: "Stock insuffisant" });
    if (error.message === "PRODUCT_NOT_FOUND") return res.status(404).json({ error: "Produit introuvable" });
    if (error.message === "SUPPLIER_NOT_FOUND") return res.status(404).json({ error: "Fournisseur introuvable" });
    if (error.message === "NO_STOCK_CHANGE") return res.status(400).json({ error: "Aucun changement de stock" });
    if (error.message === "PATIENT_NOT_FOUND") return res.status(404).json({ error: "Patient introuvable" });
    if (error.message === "EXTERNAL_CLIENT_NOT_FOUND") return res.status(404).json({ error: "Client externe introuvable" });
    if (error.message === "VISIT_NOT_FOUND") return res.status(404).json({ error: "Visite introuvable" });
    if (error.message === "VISIT_PATIENT_MISMATCH") {
      return res.status(400).json({ error: "La visite ne correspond pas au patient." });
    }
    if (error.message === "ORDONNANCE_ALREADY_DISPENSED") {
      return res.status(409).json({ error: "Cette ordonnance a déjà été délivrée." });
    }
    if (error.message === "SALE_NOT_FOUND") return res.status(404).json({ error: "Vente introuvable" });
    if (error.message === "LINE_NOT_FOUND") return res.status(404).json({ error: "Ligne de vente introuvable" });
    if (error.message === "NOT_AUTHORIZED") {
      return res.status(403).json({ error: "Vous ne pouvez modifier que vos propres ventes." });
    }
    if (error.message === "NO_LINE_CHANGES") {
      return res.status(400).json({ error: "Aucune modification à enregistrer." });
    }
    if (error.message === "NOT_AUTHORIZED_RETURN") {
      return res.status(403).json({ error: "Vous ne pouvez pas enregistrer ce retour." });
    }
  }
  return res.status(500).json({ error: "Erreur serveur" });
}

router.get("/categories", async (_req, res) => {
  const items = await prisma.productCategory.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: { _count: { select: { products: true } } },
  });
  return res.json(
    items.map((item) => ({
      id: item.id,
      name: item.name,
      sortOrder: item.sortOrder,
      active: item.active,
      productsCount: item._count.products,
    })),
  );
});

router.post("/categories", ...catalogAccess, async (req, res) => {
  try {
    const body = categorySchema.parse(req.body);
    const item = await prisma.productCategory.create({
      data: {
        name: body.name.trim(),
        sortOrder: body.sortOrder ?? 0,
        active: body.active ?? true,
      },
    });
    return res.status(201).json(item);
  } catch {
    return res.status(400).json({ error: "Création impossible — nom peut-être déjà utilisé" });
  }
});

router.put("/categories/:id", ...catalogAccess, async (req, res) => {
  try {
    const body = categorySchema.partial().parse(req.body);
    const item = await prisma.productCategory.update({
      where: { id: routeParam(req.params.id) },
      data: {
        ...(body.name !== undefined ? { name: body.name.trim() } : {}),
        ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
        ...(body.active !== undefined ? { active: body.active } : {}),
      },
    });
    return res.json(item);
  } catch {
    return res.status(400).json({ error: "Mise à jour impossible" });
  }
});

router.delete("/categories/:id", ...catalogAccess, async (req, res) => {
  try {
    const linked = await prisma.product.count({ where: { categoryId: routeParam(req.params.id) } });
    if (linked > 0) {
      await prisma.productCategory.update({
        where: { id: routeParam(req.params.id) },
        data: { active: false },
      });
      return res.json({ message: "Catégorie désactivée (produits conservés)" });
    }
    await prisma.productCategory.delete({ where: { id: routeParam(req.params.id) } });
    return res.json({ message: "Catégorie supprimée" });
  } catch {
    return res.status(400).json({ error: "Suppression impossible" });
  }
});

router.get("/forms", async (_req, res) => {
  try {
    const items = await prisma.productForm.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    const names = items.map((item) => item.name);
    const counts =
      names.length === 0
        ? []
        : await prisma.product.groupBy({
            by: ["pharmaceuticalForm"],
            where: { pharmaceuticalForm: { in: names } },
            _count: { _all: true },
          });
    const countByName = new Map(
      counts
        .filter((row) => row.pharmaceuticalForm)
        .map((row) => [row.pharmaceuticalForm as string, row._count._all]),
    );
    return res.json(
      items.map((item) => ({
        id: item.id,
        name: item.name,
        sortOrder: item.sortOrder,
        active: item.active,
        productsCount: countByName.get(item.name) ?? 0,
      })),
    );
  } catch {
    return res.status(500).json({ error: "Impossible de charger les formes" });
  }
});

router.post("/forms", ...catalogAccess, async (req, res) => {
  try {
    const body = formSchema.parse(req.body);
    const item = await prisma.productForm.create({
      data: {
        name: body.name.trim(),
        sortOrder: body.sortOrder ?? 0,
        active: body.active ?? true,
      },
    });
    return res.status(201).json(item);
  } catch {
    return res.status(400).json({ error: "Création impossible — nom peut-être déjà utilisé" });
  }
});

router.put("/forms/:id", ...catalogAccess, async (req, res) => {
  try {
    const body = formSchema.partial().parse(req.body);
    const existing = await prisma.productForm.findUnique({ where: { id: routeParam(req.params.id) } });
    if (!existing) return res.status(404).json({ error: "Forme introuvable" });

    const nextName = body.name !== undefined ? body.name.trim() : undefined;
    const item = await prisma.$transaction(async (tx) => {
      const updated = await tx.productForm.update({
        where: { id: routeParam(req.params.id) },
        data: {
          ...(nextName !== undefined ? { name: nextName } : {}),
          ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
          ...(body.active !== undefined ? { active: body.active } : {}),
        },
      });
      if (nextName && nextName !== existing.name) {
        await tx.product.updateMany({
          where: { pharmaceuticalForm: existing.name },
          data: { pharmaceuticalForm: nextName },
        });
      }
      return updated;
    });
    return res.json(item);
  } catch {
    return res.status(400).json({ error: "Mise à jour impossible" });
  }
});

router.delete("/forms/:id", ...catalogAccess, async (req, res) => {
  try {
    const existing = await prisma.productForm.findUnique({ where: { id: routeParam(req.params.id) } });
    if (!existing) return res.status(404).json({ error: "Forme introuvable" });
    const linked = await prisma.product.count({ where: { pharmaceuticalForm: existing.name } });
    if (linked > 0) {
      await prisma.productForm.update({
        where: { id: routeParam(req.params.id) },
        data: { active: false },
      });
      return res.json({ message: "Forme désactivée (produits conservés)" });
    }
    await prisma.productForm.delete({ where: { id: routeParam(req.params.id) } });
    return res.json({ message: "Forme supprimée" });
  } catch {
    return res.status(400).json({ error: "Suppression impossible" });
  }
});

router.get("/sales", async (req, res) => {
  const user = req.user!;
  const fromParam = typeof req.query.from === "string" ? req.query.from : undefined;
  const toParam = typeof req.query.to === "string" ? req.query.to : undefined;
  const patientId = typeof req.query.patientId === "string" ? req.query.patientId : undefined;
  const productId = typeof req.query.productId === "string" ? req.query.productId : undefined;

  const createdAt: { gte?: Date; lt?: Date } = {};
  if (fromParam) createdAt.gte = new Date(fromParam);
  if (toParam) {
    const to = new Date(toParam);
    to.setDate(to.getDate() + 1);
    createdAt.lt = to;
  }

  const ownSalesOnly = user.role === "PHARMACIEN";

  const items = await prisma.prescription.findMany({
    where: {
      ...(Object.keys(createdAt).length ? { createdAt } : {}),
      ...(patientId ? { patientId } : {}),
      ...(productId ? { saleLines: { some: { productId } } } : {}),
      ...(ownSalesOnly ? { pharmacistId: user.id } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      patient: { select: { id: true, code: true, firstName: true, lastName: true } },
      externalClient: { select: { id: true, code: true, firstName: true, lastName: true, phone: true } },
      pharmacist: { select: { id: true, firstName: true, lastName: true } },
      saleLines: {
        include: {
          product: {
            select: {
              id: true,
              name: true,
              sku: true,
              category: { select: { name: true } },
            },
          },
          invoice: { select: { invoiceNumber: true, amountFcfa: true, status: true } },
          returns: { select: { quantity: true, grossRefundFcfa: true, netRefundFcfa: true } },
        },
      },
    },
  });

  return res.json(items.map((item) => serializePharmacySale(item)));
});

router.patch("/sales/:prescriptionId", async (req, res) => {
  const user = req.user!;
  const prescriptionId = String(req.params.prescriptionId);
  try {
    const body = updateSaleLinesSchema.parse(req.body);
    const result = await prisma.$transaction(async (tx) => {
      const prescription = await tx.prescription.findUnique({
        where: { id: prescriptionId },
        include: {
          saleLines: { include: { product: true, invoice: true } },
        },
      });
      if (!prescription) throw new Error("SALE_NOT_FOUND");
      if (!canEditPharmacySale(user, prescription)) throw new Error("NOT_AUTHORIZED");

      const lineMap = new Map(prescription.saleLines.map((line) => [line.id, line]));
      let invoiceDeltaFcfa = 0;
      let changed = false;

      for (const lineId of body.deleteLineIds) {
        const existing = lineMap.get(lineId);
        if (!existing) throw new Error("LINE_NOT_FOUND");
        changed = true;

        await applyStockMovement(tx, {
          productId: existing.productId,
          type: "ENTRY",
          quantity: existing.quantity,
          reference: `SALE-LINE-REMOVE-${prescription.id.slice(0, 8)}`,
          notes: "Suppression ligne vente pharmacie",
          prescriptionId: prescription.id,
          userId: user.id,
        });

        invoiceDeltaFcfa -= existing.lineTotalFcfa;
        await tx.pharmacySaleLine.delete({ where: { id: lineId } });
        lineMap.delete(lineId);
      }

      for (const update of body.lines) {
        const existing = lineMap.get(update.id);
        if (!existing) continue;
        if (update.quantity === existing.quantity) continue;
        changed = true;

        const delta = update.quantity - existing.quantity;
        if (delta > 0) {
          await recordDispensationMovement(tx, {
            productId: existing.productId,
            quantity: delta,
            prescriptionId: prescription.id,
            userId: user.id,
          });
        } else {
          await applyStockMovement(tx, {
            productId: existing.productId,
            type: "ENTRY",
            quantity: Math.abs(delta),
            reference: `SALE-CORRECTION-${prescription.id.slice(0, 8)}`,
            notes: "Correction quantité vente pharmacie",
            prescriptionId: prescription.id,
            userId: user.id,
          });
        }

        const oldLineTotal = existing.lineTotalFcfa;
        const newLineTotal = existing.unitPriceFcfa * update.quantity;
        invoiceDeltaFcfa += newLineTotal - oldLineTotal;

        await tx.pharmacySaleLine.update({
          where: { id: existing.id },
          data: { quantity: update.quantity, lineTotalFcfa: newLineTotal },
        });
      }

      if (!changed) throw new Error("NO_LINE_CHANGES");

      const remainingCount = await tx.pharmacySaleLine.count({
        where: { prescriptionId: prescription.id },
      });

      if (remainingCount === 0) {
        if (invoiceDeltaFcfa !== 0) {
          const invoiceIds = [
            ...new Set(prescription.saleLines.map((line) => line.invoiceId).filter(Boolean)),
          ] as string[];
          for (const invoiceId of invoiceIds) {
            const invoice = await tx.invoice.findUnique({ where: { id: invoiceId } });
            if (!invoice) continue;
            const nextAmount = Math.max(0, invoice.amountFcfa + invoiceDeltaFcfa);
            await tx.invoice.update({
              where: { id: invoiceId },
              data: { amountFcfa: nextAmount },
            });
          }
        }
        await tx.prescription.delete({ where: { id: prescription.id } });
        return { deleted: true as const, id: prescription.id };
      }

      const updatedLines = await tx.pharmacySaleLine.findMany({
        where: { prescriptionId: prescription.id },
        include: {
          product: {
            select: {
              id: true,
              name: true,
              sku: true,
              category: { select: { name: true } },
            },
          },
          invoice: { select: { invoiceNumber: true, amountFcfa: true, status: true } },
        },
      });

      const totalFcfa = updatedLines.reduce((sum, line) => sum + line.lineTotalFcfa, 0);

      if (invoiceDeltaFcfa !== 0) {
        const invoiceIds = [
          ...new Set(prescription.saleLines.map((line) => line.invoiceId).filter(Boolean)),
        ] as string[];
        for (const invoiceId of invoiceIds) {
          const invoice = await tx.invoice.findUnique({ where: { id: invoiceId } });
          if (!invoice) continue;
          const nextAmount = Math.max(0, invoice.amountFcfa + invoiceDeltaFcfa);
          const nextPaid =
            invoice.status === InvoiceStatus.PAID
              ? nextAmount
              : Math.min(invoice.paidAmountFcfa, nextAmount);
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

      const invoiceNumber =
        updatedLines.find((line) => line.invoice?.invoiceNumber)?.invoice?.invoiceNumber ?? null;

      return {
        id: prescription.id,
        createdAt: prescription.createdAt,
        notes: prescription.notes,
        patient: prescription.patientId
          ? await tx.patient.findUnique({
              where: { id: prescription.patientId },
              select: { code: true, firstName: true, lastName: true },
            })
          : null,
        externalClient: prescription.externalClientId
          ? await tx.pharmacyExternalClient.findUnique({
              where: { id: prescription.externalClientId },
              select: { code: true, firstName: true, lastName: true },
            })
          : null,
        buyerType: prescription.externalClientId ? "external" : "patient",
        pharmacist: await tx.user.findUnique({
          where: { id: prescription.pharmacistId },
          select: { firstName: true, lastName: true },
        }),
        totalFcfa,
        invoiceNumber,
        lines: updatedLines.map((line) => ({
          id: line.id,
          productId: line.productId,
          productName: line.product.name,
          sku: line.product.sku,
          categoryName: line.product.category?.name ?? null,
          quantity: line.quantity,
          unitPriceFcfa: line.unitPriceFcfa,
          lineTotalFcfa: line.lineTotalFcfa,
        })),
      };
    });

    return res.json(result);
  } catch (error) {
    return mapStockError(error, res);
  }
});

router.post("/sales/:prescriptionId/returns", async (req, res) => {
  const user = req.user!;
  const prescriptionId = String(req.params.prescriptionId);
  try {
    const body = pharmacyReturnSchema.parse(req.body);
    const prescription = await prisma.prescription.findUnique({
      where: { id: prescriptionId },
      select: { id: true, pharmacistId: true, createdAt: true },
    });
    if (!prescription) throw new PharmacyReturnError("SALE_NOT_FOUND", "Vente introuvable");
    if (!canRegisterPharmacyReturn(user, prescription)) {
      throw new Error("NOT_AUTHORIZED_RETURN");
    }

    const result = await prisma.$transaction(async (tx) =>
      applyPharmacySaleReturns(tx, {
        prescriptionId,
        items: body.items,
        userId: user.id,
      }),
    );

    const updated = await prisma.prescription.findUnique({
      where: { id: prescriptionId },
      include: {
        patient: { select: { id: true, code: true, firstName: true, lastName: true } },
        externalClient: {
          select: { id: true, code: true, firstName: true, lastName: true, phone: true },
        },
        pharmacist: { select: { id: true, firstName: true, lastName: true } },
        saleLines: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                sku: true,
                category: { select: { name: true } },
              },
            },
            invoice: { select: { invoiceNumber: true, amountFcfa: true, status: true } },
            returns: { select: { quantity: true, grossRefundFcfa: true, netRefundFcfa: true } },
          },
        },
      },
    });

    return res.status(201).json({
      ...result,
      sale: updated ? serializePharmacySale(updated) : null,
    });
  } catch (error) {
    return mapStockError(error, res);
  }
});

router.get("/revenue-report", async (req, res) => {
  const user = req.user!;
  const period = typeof req.query.period === "string" ? req.query.period : "today";
  const from = typeof req.query.from === "string" ? req.query.from : undefined;
  const to = typeof req.query.to === "string" ? req.query.to : undefined;
  const pharmacistIdParam =
    typeof req.query.pharmacistId === "string" ? req.query.pharmacistId : undefined;

  const pharmacistId =
    user.role === "PHARMACIEN" ? user.id : pharmacistIdParam || undefined;

  const report = await buildPharmacyRevenueReport({
    period,
    from,
    to,
    pharmacistId,
  });
  return res.json(report);
});

router.get("/pharmacists", async (_req, res) => {
  const pharmacists = await prisma.user.findMany({
    where: { role: "PHARMACIEN", active: true },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    select: { id: true, firstName: true, lastName: true },
  });
  return res.json(pharmacists);
});

router.get("/reports", async (req, res) => {
  const user = req.user!;
  const period = typeof req.query.period === "string" ? req.query.period : "7d";
  const from = typeof req.query.from === "string" ? req.query.from : undefined;
  const to = typeof req.query.to === "string" ? req.query.to : undefined;
  const pharmacistIdParam =
    typeof req.query.pharmacistId === "string" ? req.query.pharmacistId : undefined;
  const pharmacistId = user.role === "PHARMACIEN" ? user.id : pharmacistIdParam || undefined;
  const report = await buildPharmacyReport({
    period,
    from,
    to,
    ...(pharmacistId ? { pharmacistId } : {}),
  });
  return res.json(report);
});

router.get("/alerts", async (_req, res) => {
  const [stockAlerts, expiryAlerts] = await Promise.all([
    listPharmacyStockAlerts(),
    listPharmacyExpiryAlerts(),
  ]);
  return res.json({
    count: stockAlerts.length + expiryAlerts.length,
    outOfStock: stockAlerts.filter((row) => row.level === "out").length,
    critical: stockAlerts.filter((row) => row.level === "critical").length,
    low: stockAlerts.filter((row) => row.level === "low").length,
    expirySoon: expiryAlerts.filter((row) => row.level === "soon").length,
    expired: expiryAlerts.filter((row) => row.level === "expired").length,
    stockItems: stockAlerts,
    expiryItems: expiryAlerts,
    items: stockAlerts,
  });
});

router.get("/products", async (_req, res) => {
  const items = await prisma.product.findMany({
    orderBy: { name: "asc" },
    include: productInclude,
  });
  return res.json(items);
});

/** Retire du catalogue actif tous les produits dont la date d'expiration est dépassée. */
router.post("/products/remove-expired", async (req, res) => {
  const user = req.user!;
  try {
    const now = new Date();
    const expired = await prisma.product.findMany({
      where: {
        active: true,
        noExpiry: false,
        expiryDate: { not: null, lt: now },
      },
      select: { id: true, name: true, quantity: true },
    });

    if (!expired.length) {
      return res.json({ removedCount: 0, products: [], message: "Aucun produit expiré à retirer." });
    }

    await prisma.$transaction(async (tx) => {
      for (const product of expired) {
        if (product.quantity > 0) {
          await applyStockMovement(tx, {
            productId: product.id,
            type: "ADJUSTMENT",
            targetQuantity: 0,
            notes: "Retrait produit expiré",
            reference: "EXPIRY-PURGE",
            userId: user.id,
          });
        }
        await tx.product.update({
          where: { id: product.id },
          data: { active: false, quantity: 0 },
        });
      }
    });

    return res.json({
      removedCount: expired.length,
      products: expired.map((p) => ({ id: p.id, name: p.name })),
      message: `${expired.length} produit(s) expiré(s) retiré(s) du catalogue.`,
    });
  } catch (error) {
    return mapStockError(error, res);
  }
});

/** Retire un produit expiré précis (désactivation + stock à 0). */
router.post("/products/:id/retire-expired", async (req, res) => {
  const user = req.user!;
  const productId = String(routeParam(req.params.id));
  try {
    const now = new Date();
    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) return res.status(404).json({ error: "Produit introuvable" });
    if (!product.active) {
      return res.json({ message: "Produit déjà retiré.", product: { id: product.id, name: product.name } });
    }
    if (product.noExpiry || !product.expiryDate || product.expiryDate >= now) {
      return res.status(400).json({ error: "Ce produit n’est pas expiré." });
    }

    await prisma.$transaction(async (tx) => {
      if (product.quantity > 0) {
        await applyStockMovement(tx, {
          productId: product.id,
          type: "ADJUSTMENT",
          targetQuantity: 0,
          notes: "Retrait produit expiré",
          reference: "EXPIRY-RETIRE",
          userId: user.id,
        });
      }
      await tx.product.update({
        where: { id: product.id },
        data: { active: false, quantity: 0 },
      });
    });

    return res.json({
      message: `« ${product.name} » retiré (expiré).`,
      product: { id: product.id, name: product.name },
    });
  } catch (error) {
    return mapStockError(error, res);
  }
});

router.post("/products", ...catalogAccess, async (req, res) => {
  try {
    const body = productSchema.parse(req.body);
    const item = await prisma.product.create({
      data: {
        ...productDataFromBody(body),
        sku: resolveProductSku(body),
      },
      include: productInclude,
    });
    return res.status(201).json(item);
  } catch (error) {
    return mapProductCatalogError(error, res);
  }
});

router.put("/products/:id", ...catalogAccess, async (req, res) => {
  try {
    const body = productSchema.partial().parse(req.body);
    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.sku !== undefined) data.sku = body.sku;
    if (body.barcode !== undefined) data.barcode = body.barcode?.trim() || null;
    if (body.dosage !== undefined) data.dosage = body.dosage?.trim() || null;
    if (body.pharmaceuticalForm !== undefined) data.pharmaceuticalForm = body.pharmaceuticalForm?.trim() || null;
    if (body.categoryId !== undefined) data.categoryId = body.categoryId || null;
    if (body.supplierId !== undefined) data.supplierId = body.supplierId || null;
    if (body.noExpiry !== undefined) data.noExpiry = body.noExpiry;
    if (body.noExpiry === true) data.expiryDate = null;
    else if (body.expiryDate !== undefined) data.expiryDate = parseExpiryDate(body.expiryDate);
    if (body.quantity !== undefined) data.quantity = body.quantity;
    if (body.unitPriceFcfa !== undefined) data.unitPriceFcfa = body.unitPriceFcfa;
    if (body.purchasePriceFcfa !== undefined) data.purchasePriceFcfa = body.purchasePriceFcfa;
    if (body.minStock !== undefined) data.minStock = body.minStock;
    if (body.sachetsPerBox !== undefined) data.sachetsPerBox = body.sachetsPerBox;
    if (body.sachetPriceFcfa !== undefined) data.sachetPriceFcfa = body.sachetPriceFcfa;
    if (body.sellBySachet !== undefined) data.sellBySachet = body.sellBySachet;
    if (body.active !== undefined) data.active = body.active;

    const productId = routeParam(req.params.id);
    const existing = await prisma.product.findUnique({ where: { id: productId } });
    if (!existing) return res.status(404).json({ error: "Produit introuvable" });
    const requestedQuantity = body.quantity;
    delete data.quantity;

    const item = await prisma.$transaction(async (tx) => {
      const updated = await tx.product.update({
        where: { id: productId },
        data,
        include: productInclude,
      });
      if (requestedQuantity !== undefined && requestedQuantity !== existing.quantity) {
        await applyStockMovement(tx, {
          productId,
          type: "ADJUSTMENT",
          targetQuantity: requestedQuantity,
          userId: req.user!.id,
        });
        return tx.product.findUniqueOrThrow({
          where: { id: productId },
          include: productInclude,
        });
      }
      return updated;
    });
    return res.json(item);
  } catch (error) {
    return mapProductCatalogError(error, res);
  }
});

router.delete("/products/:id", ...catalogAccess, async (req, res) => {
  try {
    const salesCount = await prisma.pharmacySaleLine.count({ where: { productId: routeParam(req.params.id) } });
    if (salesCount > 0) {
      await prisma.product.update({ where: { id: routeParam(req.params.id) }, data: { active: false } });
      return res.json({ message: "Produit désactivé (historique de ventes conservé)" });
    }
    await prisma.stockMovement.deleteMany({ where: { productId: routeParam(req.params.id) } });
    await prisma.product.delete({ where: { id: routeParam(req.params.id) } });
    return res.json({ message: "Produit supprimé" });
  } catch {
    return res.status(400).json({ error: "Suppression impossible" });
  }
});

router.get("/suppliers", async (_req, res) => {
  const items = await prisma.pharmacySupplier.findMany({ orderBy: { name: "asc" } });
  return res.json(items);
});

router.post("/suppliers", ...catalogAccess, async (req, res) => {
  try {
    const body = supplierSchema.parse({
      ...req.body,
      email: req.body.email === "" ? undefined : req.body.email,
    });
    const item = await prisma.pharmacySupplier.create({
      data: {
        name: body.name,
        contactName: body.contactName,
        phone: body.phone,
        email: body.email || undefined,
        address: body.address,
        active: body.active ?? true,
      },
    });
    return res.status(201).json(item);
  } catch {
    return res.status(400).json({ error: "Données invalides" });
  }
});

router.put("/suppliers/:id", ...catalogAccess, async (req, res) => {
  try {
    const body = supplierSchema.partial().parse({
      ...req.body,
      email: req.body.email === "" ? undefined : req.body.email,
    });
    const item = await prisma.pharmacySupplier.update({ where: { id: routeParam(req.params.id) }, data: body });
    return res.json(item);
  } catch {
    return res.status(400).json({ error: "Mise à jour impossible" });
  }
});

router.delete("/suppliers/:id", ...catalogAccess, async (req, res) => {
  try {
    const movementCount = await prisma.stockMovement.count({ where: { supplierId: routeParam(req.params.id) } });
    if (movementCount > 0) {
      await prisma.pharmacySupplier.update({ where: { id: routeParam(req.params.id) }, data: { active: false } });
      return res.json({ message: "Fournisseur désactivé (mouvements conservés)" });
    }
    await prisma.pharmacySupplier.delete({ where: { id: routeParam(req.params.id) } });
    return res.json({ message: "Fournisseur supprimé" });
  } catch {
    return res.status(400).json({ error: "Suppression impossible" });
  }
});

router.get("/external-clients", async (_req, res) => {
  const items = await prisma.pharmacyExternalClient.findMany({
    where: { active: true },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });
  return res.json(items);
});

router.post("/external-clients", async (req, res) => {
  try {
    const body = externalClientSchema.parse(req.body);
    const item = await prisma.pharmacyExternalClient.create({
      data: {
        code: await generatePharmacyExternalClientCode(),
        firstName: body.firstName.trim(),
        lastName: body.lastName.trim(),
        phone: body.phone?.trim() || null,
        active: body.active ?? true,
      },
    });
    return res.status(201).json(item);
  } catch {
    return res.status(400).json({ error: "Création impossible" });
  }
});

router.put("/external-clients/:id", async (req, res) => {
  try {
    const body = externalClientSchema.partial().parse(req.body);
    const item = await prisma.pharmacyExternalClient.update({
      where: { id: routeParam(req.params.id) },
      data: {
        ...(body.firstName !== undefined ? { firstName: body.firstName.trim() } : {}),
        ...(body.lastName !== undefined ? { lastName: body.lastName.trim() } : {}),
        ...(body.phone !== undefined ? { phone: body.phone?.trim() || null } : {}),
        ...(body.active !== undefined ? { active: body.active } : {}),
      },
    });
    return res.json(item);
  } catch {
    return res.status(400).json({ error: "Mise à jour impossible" });
  }
});

router.delete("/external-clients/:id", async (req, res) => {
  try {
    const linked = await prisma.prescription.count({ where: { externalClientId: routeParam(req.params.id) } });
    if (linked > 0) {
      await prisma.pharmacyExternalClient.update({
        where: { id: routeParam(req.params.id) },
        data: { active: false },
      });
      return res.json({ message: "Client désactivé (historique conservé)" });
    }
    await prisma.pharmacyExternalClient.delete({ where: { id: routeParam(req.params.id) } });
    return res.json({ message: "Client supprimé" });
  } catch {
    return res.status(400).json({ error: "Suppression impossible" });
  }
});

router.get("/stock-movements", async (req, res) => {
  const productId = typeof req.query.productId === "string" ? req.query.productId : undefined;
  const month = typeof req.query.month === "string" ? req.query.month : undefined;
  const range = yearMonthRange(month);
  const take = parseLimitParam(req.query.limit, 200, 10_000);
  const items = await prisma.stockMovement.findMany({
    where: {
      ...(productId ? { productId } : {}),
      ...(range ? { createdAt: { gte: range.from, lt: range.to } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take,
    include: {
      product: { select: { id: true, name: true, sku: true } },
      supplier: { select: { id: true, name: true } },
      user: { select: { id: true, firstName: true, lastName: true } },
    },
  });
  return res.json(items);
});

router.post("/stock-movements", ...catalogAccess, async (req, res) => {
  const user = req.user!;
  try {
    const body = stockMovementSchema.parse(req.body);
    const movement = await prisma.$transaction((tx) =>
      applyStockMovement(tx, {
        productId: body.productId,
        type: body.type,
        quantity: body.quantity,
        targetQuantity: body.targetQuantity,
        unitCostFcfa: body.unitCostFcfa,
        supplierId: body.supplierId,
        reference: body.reference,
        notes: body.notes,
        userId: user.id,
      }),
    );
    return res.status(201).json(movement);
  } catch (error) {
    return mapStockError(error, res);
  }
});

router.get("/", async (_req, res) => {
  const [products, patients] = await Promise.all([
    prisma.product.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      include: productInclude,
    }),
    prisma.patient.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
  ]);
  return res.json({ products, patients });
});

/** Ordonnances médecin en attente de dispensation / encaissement. */
router.get("/ordonnances-pending", async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  const consultations = await prisma.consultation.findMany({
    where: {
      clinicalNotes: { contains: `${PHARMACY_ORDONNANCE_PREFIX} : ` },
      visit: {
        prescriptions: { none: {} },
        ...(q
          ? {
              patient: {
                OR: [
                  { firstName: { contains: q, mode: "insensitive" } },
                  { lastName: { contains: q, mode: "insensitive" } },
                  { code: { contains: q, mode: "insensitive" } },
                  { phone: { contains: q } },
                ],
              },
            }
          : {}),
      },
    },
    include: {
      visit: {
        include: {
          patient: {
            select: {
              id: true,
              code: true,
              firstName: true,
              lastName: true,
              phone: true,
              gender: true,
            },
          },
          assignedDoctor: {
            select: { id: true, firstName: true, lastName: true },
          },
        },
      },
    },
    orderBy: { updatedAt: "desc" },
    take: 80,
  });

  const productIds = new Set<string>();
  const pending = consultations
    .filter((row) => {
      if (isPharmacyOrdonnanceDispensed(row.clinicalNotes)) return false;
      return hasPharmacyOrdonnance(row.clinicalNotes);
    })
    .map((row) => {
      const lines = parsePharmacyOrdonnanceLines(row.clinicalNotes);
      for (const line of lines) {
        if (line.productId?.trim()) productIds.add(line.productId.trim());
      }
      const doctor = row.visit.assignedDoctor;
      return {
        consultationId: row.id,
        visitId: row.visitId,
        prescribedAt: row.updatedAt,
        patient: row.visit.patient,
        doctor: doctor
          ? {
              id: doctor.id,
              firstName: doctor.firstName,
              lastName: doctor.lastName,
            }
          : null,
        lines,
      };
    })
    .filter((row) => row.lines.length > 0);

  const products = productIds.size
    ? await prisma.product.findMany({
        where: { id: { in: [...productIds] } },
        select: {
          id: true,
          name: true,
          dosage: true,
          quantity: true,
          unitPriceFcfa: true,
          active: true,
        },
      })
    : [];
  const productMap = new Map(products.map((p) => [p.id, p]));

  const rows = pending.map((row) => {
    const enrichedLines = row.lines.map((line) => {
      const productId = line.productId?.trim() || null;
      const product = productId ? productMap.get(productId) : undefined;
      const isFreeText = !productId || !product;
      const unitPriceFcfa = product?.unitPriceFcfa ?? 0;
      const stock = product?.quantity ?? 0;
      return {
        ...line,
        productId,
        productName: product?.name ?? line.name,
        dosage: product?.dosage ?? line.dosage,
        unitPriceFcfa,
        stock,
        lineTotalFcfa: unitPriceFcfa * line.quantity,
        available: !isFreeText && Boolean(product?.active) && stock >= line.quantity,
        isFreeText,
      };
    });
    const catalogLines = enrichedLines.filter((line) => !line.isFreeText);
    const estimatedTotalFcfa = catalogLines.reduce((sum, line) => sum + line.lineTotalFcfa, 0);
    return {
      ...row,
      lines: enrichedLines,
      estimatedTotalFcfa,
      allAvailable: catalogLines.length > 0 && catalogLines.every((line) => line.available),
      hasCatalogLines: catalogLines.length > 0,
      hasFreeTextLines: enrichedLines.some((line) => line.isFreeText),
    };
  });

  return res.json({ rows, count: rows.length });
});

router.post("/", async (req, res) => {
  const user = req.user!;
  try {
    const body = prescriptionSchema.parse(req.body);
    const result = await prisma.$transaction(async (tx) => {
      let patient = null;
      let externalClient = null;
      let externalClientId = body.externalClientId;

      if (body.patientId) {
        patient = await tx.patient.findUnique({ where: { id: body.patientId } });
        if (!patient) throw new Error("PATIENT_NOT_FOUND");
      } else if (body.externalClientId) {
        externalClient = await tx.pharmacyExternalClient.findFirst({
          where: { id: body.externalClientId, active: true },
        });
        if (!externalClient) throw new Error("EXTERNAL_CLIENT_NOT_FOUND");
        externalClientId = externalClient.id;
      } else {
        // Client externe : nom / téléphone optionnels (vente au comptoir anonyme possible).
        const rawName = body.externalClientName?.trim() ?? "";
        const { firstName, lastName } =
          rawName.length >= 2
            ? splitPharmacyExternalClientName(rawName)
            : { firstName: "Client", lastName: "Passage" };
        externalClient = await tx.pharmacyExternalClient.create({
          data: {
            code: await generatePharmacyExternalClientCode(),
            firstName,
            lastName,
            phone: body.externalClientPhone?.trim() || null,
          },
        });
        externalClientId = externalClient.id;
      }

      if (body.visitId) {
        const visit = await tx.visit.findUnique({
          where: { id: body.visitId },
          include: { consultation: { select: { id: true, clinicalNotes: true } } },
        });
        if (!visit) throw new Error("VISIT_NOT_FOUND");
        if (body.patientId && visit.patientId !== body.patientId) {
          throw new Error("VISIT_PATIENT_MISMATCH");
        }
        if (visit.consultation && hasPharmacyOrdonnance(visit.consultation.clinicalNotes)) {
          if (isPharmacyOrdonnanceDispensed(visit.consultation.clinicalNotes)) {
            throw new Error("ORDONNANCE_ALREADY_DISPENSED");
          }
          await tx.consultation.update({
            where: { id: visit.consultation.id },
            data: {
              clinicalNotes: markPharmacyOrdonnanceDispensedInNotes(
                visit.consultation.clinicalNotes,
              ),
            },
          });
        }
      }

      const products = await tx.product.findMany({ where: { id: { in: body.items.map((i) => i.productId) } } });
      const productMap = new Map(products.map((p) => [p.id, p]));
      let grossTotal = 0;
      const lines = body.items.map((item) => {
        const product = productMap.get(item.productId);
        if (!product) throw new Error("PRODUCT_NOT_FOUND");
        if (product.quantity < item.quantity) throw new Error("INSUFFICIENT_STOCK");
        const lineTotal = product.unitPriceFcfa * item.quantity;
        grossTotal += lineTotal;
        return { product, quantity: item.quantity, lineTotal };
      });

      const requestedReduction = body.reductionFcfa ?? 0;
      const reductionFcfa = body.isFree ? grossTotal : Math.min(requestedReduction, grossTotal);
      const total = Math.max(0, grossTotal - reductionFcfa);
      const coveredByName = body.coveredByName?.trim() || null;
      const paymentNote =
        body.isFree && coveredByName
          ? `Prise en charge gratuite par: ${coveredByName}`
          : reductionFcfa > 0 && coveredByName
            ? `Réduction: ${reductionFcfa} FCFA — Responsable: ${coveredByName}`
            : null;
      const baseNotes = externalClient ? null : body.notes?.trim() || null;
      const mergedNotes = [baseNotes, paymentNote].filter(Boolean).join("\n");

      const prescription = await tx.prescription.create({
        data: {
          patientId: body.patientId,
          externalClientId,
          visitId: body.visitId,
          pharmacistId: user.id,
          notes: mergedNotes || null,
          grossTotalFcfa: grossTotal,
          netTotalFcfa: total,
        },
      });

      let invoice = null;
      const billImmediately = externalClient
        ? total > 0
        : patient && shouldCreateImmediateInvoice(patient.category) && total > 0;

      if (billImmediately) {
        invoice = await tx.invoice.create({
          data: {
            invoiceNumber: await generateInvoiceNumber(tx),
            patientId: body.patientId,
            externalClientId,
            visitId: body.visitId,
            type: InvoiceType.PHARMACY,
            issuedById: user.id,
            ...immediatePaidInvoiceData(total, user.id),
          },
        });
      }

      for (const line of lines) {
        await tx.pharmacySaleLine.create({
          data: {
            prescriptionId: prescription.id,
            productId: line.product.id,
            invoiceId: invoice?.id,
            quantity: line.quantity,
            unitPriceFcfa: line.product.unitPriceFcfa,
            lineTotalFcfa: line.lineTotal,
          },
        });
        await recordDispensationMovement(tx, {
          productId: line.product.id,
          quantity: line.quantity,
          prescriptionId: prescription.id,
          userId: user.id,
        });
      }

      return {
        prescription,
        invoice,
        externalClient,
        total,
        grossTotal,
        reductionFcfa,
        coveredByName,
        isFree: body.isFree === true || total === 0,
        billingDeferred: !billImmediately && !externalClient,
        buyerType: externalClient ? "external" : "patient",
      };
    });
    return res.status(201).json(result);
  } catch (error) {
    return mapStockError(error, res);
  }
});

export default router;
