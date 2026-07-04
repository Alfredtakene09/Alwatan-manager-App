import { Router } from "express";
import { z } from "zod";
import { InvoiceStatus, InvoiceType } from "@prisma/client";
import { prisma } from "../lib/db.js";
import { generateInvoiceNumber } from "../lib/patient-code.js";
import { generatePharmacyExternalClientCode, splitPharmacyExternalClientName } from "../lib/pharmacy-external-client.js";
import { shouldCreateImmediateInvoice } from "../lib/patient-billing.js";
import { applyStockMovement, recordDispensationMovement } from "../lib/pharmacy-stock.js";
import { listPharmacyStockAlerts, listPharmacyExpiryAlerts } from "../lib/pharmacy-alerts.js";
import { buildPharmacyReport } from "../lib/pharmacy-reports.js";
import { requireAuth, requireModule } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth, requireModule("pharmacie"));

const prescriptionSchema = z
  .object({
    patientId: z.string().optional(),
    externalClientId: z.string().optional(),
    externalClientName: z.string().min(2).optional(),
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
    const hasExternal =
      Boolean(body.externalClientId) || Boolean(body.externalClientName?.trim());
    if (!hasPatient && !hasExternal) {
      ctx.addIssue({ code: "custom", message: "patientId ou client externe requis" });
    }
    if (hasPatient && hasExternal) {
      ctx.addIssue({ code: "custom", message: "Choisir un patient ou un client externe, pas les deux" });
    }
    if (body.externalClientId && body.externalClientName) {
      ctx.addIssue({ code: "custom", message: "Indiquer un client existant ou un nouveau nom, pas les deux" });
    }
    const reductionFcfa = body.reductionFcfa ?? 0;
    const isFree = body.isFree === true;
    const coveredByName = body.coveredByName?.trim();
    if ((isFree || reductionFcfa > 0) && !coveredByName) {
      ctx.addIssue({ code: "custom", message: "Nom du responsable requis pour réduction/gratuité" });
    }
  });

const externalClientSchema = z.object({
  firstName: z.string().min(2),
  lastName: z.string().min(2),
  phone: z.string().optional(),
  active: z.boolean().optional(),
});

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
  quantity: z.number().int().min(0).optional(),
  unitPriceFcfa: z.number().int().positive(),
  minStock: z.number().int().min(0).optional(),
  sachetsPerBox: z.number().int().positive().optional(),
  sachetPriceFcfa: z.number().int().positive().optional().nullable(),
  sellBySachet: z.boolean().optional(),
  active: z.boolean().optional(),
});

function resolveProductSku(input: { sku?: string; barcode?: string; name: string }) {
  const sku = input.sku?.trim();
  if (sku && sku.length >= 2) return sku;
  const barcode = input.barcode?.trim();
  if (barcode && barcode.length >= 2) return barcode;
  const slug = input.name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24);
  return `MED-${slug || "PRODUIT"}-${Date.now().toString(36).toUpperCase()}`;
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
  if (error instanceof Error) {
    if (error.message === "INVALID_EXTERNAL_NAME") return res.status(400).json({ error: "Nom du client externe invalide" });
    if (error.message === "INSUFFICIENT_STOCK") return res.status(409).json({ error: "Stock insuffisant" });
    if (error.message === "PRODUCT_NOT_FOUND") return res.status(404).json({ error: "Produit introuvable" });
    if (error.message === "SUPPLIER_NOT_FOUND") return res.status(404).json({ error: "Fournisseur introuvable" });
    if (error.message === "NO_STOCK_CHANGE") return res.status(400).json({ error: "Aucun changement de stock" });
    if (error.message === "PATIENT_NOT_FOUND") return res.status(404).json({ error: "Patient introuvable" });
    if (error.message === "EXTERNAL_CLIENT_NOT_FOUND") return res.status(404).json({ error: "Client externe introuvable" });
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

router.post("/categories", async (req, res) => {
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

router.put("/categories/:id", async (req, res) => {
  try {
    const body = categorySchema.partial().parse(req.body);
    const item = await prisma.productCategory.update({
      where: { id: req.params.id },
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

router.delete("/categories/:id", async (req, res) => {
  try {
    const linked = await prisma.product.count({ where: { categoryId: req.params.id } });
    if (linked > 0) {
      await prisma.productCategory.update({
        where: { id: req.params.id },
        data: { active: false },
      });
      return res.json({ message: "Catégorie désactivée (produits conservés)" });
    }
    await prisma.productCategory.delete({ where: { id: req.params.id } });
    return res.json({ message: "Catégorie supprimée" });
  } catch {
    return res.status(400).json({ error: "Suppression impossible" });
  }
});

router.get("/sales", async (req, res) => {
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

  const items = await prisma.prescription.findMany({
    where: {
      ...(Object.keys(createdAt).length ? { createdAt } : {}),
      ...(patientId ? { patientId } : {}),
      ...(productId ? { saleLines: { some: { productId } } } : {}),
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
        },
      },
    },
  });

  return res.json(
    items.map((item) => {
      const totalFcfa = item.saleLines.reduce((sum, line) => sum + line.lineTotalFcfa, 0);
      const invoiceNumber = item.saleLines.find((line) => line.invoice?.invoiceNumber)?.invoice?.invoiceNumber ?? null;
      return {
        id: item.id,
        createdAt: item.createdAt,
        notes: item.notes,
        patient: item.patient,
        externalClient: item.externalClient,
        buyerType: item.externalClient ? "external" : "patient",
        pharmacist: item.pharmacist,
        totalFcfa,
        invoiceNumber,
        lines: item.saleLines.map((line) => ({
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
    }),
  );
});

router.get("/reports", async (req, res) => {
  const period = typeof req.query.period === "string" ? req.query.period : "7d";
  const from = typeof req.query.from === "string" ? req.query.from : undefined;
  const to = typeof req.query.to === "string" ? req.query.to : undefined;
  const report = await buildPharmacyReport({ period, from, to });
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

router.post("/products", async (req, res) => {
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
    if (error instanceof z.ZodError) return res.status(400).json({ error: "Données invalides" });
    return res.status(400).json({ error: "Création impossible — code-barres peut-être déjà utilisé" });
  }
});

router.put("/products/:id", async (req, res) => {
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
    if (body.minStock !== undefined) data.minStock = body.minStock;
    if (body.sachetsPerBox !== undefined) data.sachetsPerBox = body.sachetsPerBox;
    if (body.sachetPriceFcfa !== undefined) data.sachetPriceFcfa = body.sachetPriceFcfa;
    if (body.sellBySachet !== undefined) data.sellBySachet = body.sellBySachet;
    if (body.active !== undefined) data.active = body.active;

    const item = await prisma.product.update({
      where: { id: req.params.id },
      data,
      include: productInclude,
    });
    return res.json(item);
  } catch {
    return res.status(400).json({ error: "Mise à jour impossible" });
  }
});

router.delete("/products/:id", async (req, res) => {
  try {
    const salesCount = await prisma.pharmacySaleLine.count({ where: { productId: req.params.id } });
    if (salesCount > 0) {
      await prisma.product.update({ where: { id: req.params.id }, data: { active: false } });
      return res.json({ message: "Produit désactivé (historique de ventes conservé)" });
    }
    await prisma.stockMovement.deleteMany({ where: { productId: req.params.id } });
    await prisma.product.delete({ where: { id: req.params.id } });
    return res.json({ message: "Produit supprimé" });
  } catch {
    return res.status(400).json({ error: "Suppression impossible" });
  }
});

router.get("/suppliers", async (_req, res) => {
  const items = await prisma.pharmacySupplier.findMany({ orderBy: { name: "asc" } });
  return res.json(items);
});

router.post("/suppliers", async (req, res) => {
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

router.put("/suppliers/:id", async (req, res) => {
  try {
    const body = supplierSchema.partial().parse({
      ...req.body,
      email: req.body.email === "" ? undefined : req.body.email,
    });
    const item = await prisma.pharmacySupplier.update({ where: { id: req.params.id }, data: body });
    return res.json(item);
  } catch {
    return res.status(400).json({ error: "Mise à jour impossible" });
  }
});

router.delete("/suppliers/:id", async (req, res) => {
  try {
    const movementCount = await prisma.stockMovement.count({ where: { supplierId: req.params.id } });
    if (movementCount > 0) {
      await prisma.pharmacySupplier.update({ where: { id: req.params.id }, data: { active: false } });
      return res.json({ message: "Fournisseur désactivé (mouvements conservés)" });
    }
    await prisma.pharmacySupplier.delete({ where: { id: req.params.id } });
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
      where: { id: req.params.id },
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
    const linked = await prisma.prescription.count({ where: { externalClientId: req.params.id } });
    if (linked > 0) {
      await prisma.pharmacyExternalClient.update({
        where: { id: req.params.id },
        data: { active: false },
      });
      return res.json({ message: "Client désactivé (historique conservé)" });
    }
    await prisma.pharmacyExternalClient.delete({ where: { id: req.params.id } });
    return res.json({ message: "Client supprimé" });
  } catch {
    return res.status(400).json({ error: "Suppression impossible" });
  }
});

router.get("/stock-movements", async (req, res) => {
  const productId = typeof req.query.productId === "string" ? req.query.productId : undefined;
  const items = await prisma.stockMovement.findMany({
    where: productId ? { productId } : undefined,
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      product: { select: { id: true, name: true, sku: true } },
      supplier: { select: { id: true, name: true } },
      user: { select: { id: true, firstName: true, lastName: true } },
    },
  });
  return res.json(items);
});

router.post("/stock-movements", async (req, res) => {
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
      } else if (body.externalClientName?.trim()) {
        const { firstName, lastName } = splitPharmacyExternalClientName(body.externalClientName);
        externalClient = await tx.pharmacyExternalClient.create({
          data: {
            code: await generatePharmacyExternalClientCode(),
            firstName,
            lastName,
            phone: body.externalClientPhone?.trim() || null,
          },
        });
        externalClientId = externalClient.id;
      } else if (body.externalClientId) {
        externalClient = await tx.pharmacyExternalClient.findFirst({
          where: { id: body.externalClientId, active: true },
        });
        if (!externalClient) throw new Error("EXTERNAL_CLIENT_NOT_FOUND");
        externalClientId = externalClient.id;
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
        },
      });

      let invoice = null;
      const billImmediately = externalClient
        ? total > 0
        : patient && shouldCreateImmediateInvoice(patient.category) && total > 0;

      if (billImmediately) {
        invoice = await tx.invoice.create({
          data: {
            invoiceNumber: await generateInvoiceNumber(),
            patientId: body.patientId,
            externalClientId,
            visitId: body.visitId,
            type: InvoiceType.PHARMACY,
            amountFcfa: total,
            status: InvoiceStatus.PAID,
            issuedById: user.id,
            paidAt: new Date(),
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
