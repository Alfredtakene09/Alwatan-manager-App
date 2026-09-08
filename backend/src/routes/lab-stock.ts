import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/db.js";
import { applyLabStockMovement } from "../lib/lab-stock.js";
import { requireAuth, requireLabStockAccess, requireUiAction } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth, requireLabStockAccess, requireUiAction("lab.stock"));

function mapLabStockError(error: unknown, res: import("express").Response) {
  if (error instanceof z.ZodError) return res.status(400).json({ error: "Données invalides" });
  if (error instanceof Error) {
    if (error.message === "ITEM_NOT_FOUND") return res.status(404).json({ error: "Article introuvable" });
    if (error.message === "INSUFFICIENT_STOCK") return res.status(409).json({ error: "Stock insuffisant" });
    if (error.message === "NO_STOCK_CHANGE") return res.status(400).json({ error: "Aucun changement de stock" });
    if (error.message === "INVALID_QUANTITY") return res.status(400).json({ error: "Quantité invalide" });
    if (error.message === "TARGET_QUANTITY_REQUIRED") {
      return res.status(400).json({ error: "Quantité cible requise pour un ajustement" });
    }
  }
  return res.status(500).json({ error: "Erreur serveur" });
}

function parseExpiryDate(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function resolveItemSku(input: { sku?: string; reference?: string; name: string }) {
  const sku = input.sku?.trim();
  if (sku && sku.length >= 2) return sku;
  const reference = input.reference?.trim();
  if (reference && reference.length >= 2) return reference;
  const slug = input.name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24);
  return `LAB-${slug || "ARTICLE"}-${Date.now().toString(36).toUpperCase()}`;
}

// ---------------------------------------------------------------------------
// Catégories
// ---------------------------------------------------------------------------

const categorySchema = z.object({
  name: z.string().min(2),
  sortOrder: z.number().int().min(0).optional(),
  active: z.boolean().optional(),
});

router.get("/categories", async (_req, res) => {
  const items = await prisma.labStockCategory.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: { _count: { select: { items: true } } },
  });
  return res.json(
    items.map((item) => ({
      id: item.id,
      name: item.name,
      sortOrder: item.sortOrder,
      active: item.active,
      itemsCount: item._count.items,
    })),
  );
});

router.post("/categories", async (req, res) => {
  try {
    const body = categorySchema.parse(req.body);
    const item = await prisma.labStockCategory.create({
      data: { name: body.name.trim(), sortOrder: body.sortOrder ?? 0, active: body.active ?? true },
    });
    return res.status(201).json(item);
  } catch {
    return res.status(400).json({ error: "Création impossible — nom peut-être déjà utilisé" });
  }
});

router.put("/categories/:id", async (req, res) => {
  try {
    const body = categorySchema.partial().parse(req.body);
    const item = await prisma.labStockCategory.update({
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
    const linked = await prisma.labStockItem.count({ where: { categoryId: req.params.id } });
    if (linked > 0) {
      await prisma.labStockCategory.update({ where: { id: req.params.id }, data: { active: false } });
      return res.json({ message: "Catégorie désactivée (articles conservés)" });
    }
    await prisma.labStockCategory.delete({ where: { id: req.params.id } });
    return res.json({ message: "Catégorie supprimée" });
  } catch {
    return res.status(400).json({ error: "Suppression impossible" });
  }
});

// ---------------------------------------------------------------------------
// Articles
// ---------------------------------------------------------------------------

const itemSchema = z.object({
  name: z.string().min(2),
  sku: z.string().min(2).optional(),
  reference: z.string().optional(),
  unit: z.string().optional(),
  categoryId: z.string().optional().nullable(),
  quantity: z.number().int().min(0).optional(),
  unitCostFcfa: z.number().int().min(0).optional(),
  minStock: z.number().int().min(0).optional(),
  expiryDate: z.string().optional().nullable(),
  noExpiry: z.boolean().optional(),
  active: z.boolean().optional(),
});

const itemInclude = {
  category: { select: { id: true, name: true } },
} as const;

router.get("/items", async (_req, res) => {
  const items = await prisma.labStockItem.findMany({ orderBy: { name: "asc" }, include: itemInclude });
  return res.json(items);
});

router.post("/items", async (req, res) => {
  try {
    const body = itemSchema.parse(req.body);
    const item = await prisma.labStockItem.create({
      data: {
        name: body.name.trim(),
        sku: resolveItemSku(body),
        reference: body.reference?.trim() || null,
        unit: body.unit?.trim() || "unité",
        categoryId: body.categoryId || null,
        quantity: body.quantity ?? 0,
        unitCostFcfa: body.unitCostFcfa ?? 0,
        minStock: body.minStock ?? 5,
        expiryDate: body.noExpiry ? null : parseExpiryDate(body.expiryDate),
        noExpiry: body.noExpiry ?? true,
        active: body.active ?? true,
      },
      include: itemInclude,
    });
    return res.status(201).json(item);
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: "Données invalides" });
    return res.status(400).json({ error: "Création impossible — référence peut-être déjà utilisée" });
  }
});

router.put("/items/:id", async (req, res) => {
  try {
    const body = itemSchema.partial().parse(req.body);
    const existing = await prisma.labStockItem.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Article introuvable" });

    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = body.name.trim();
    if (body.sku !== undefined) data.sku = body.sku.trim();
    if (body.reference !== undefined) data.reference = body.reference?.trim() || null;
    if (body.unit !== undefined) data.unit = body.unit?.trim() || "unité";
    if (body.categoryId !== undefined) data.categoryId = body.categoryId || null;
    if (body.unitCostFcfa !== undefined) data.unitCostFcfa = body.unitCostFcfa;
    if (body.minStock !== undefined) data.minStock = body.minStock;
    if (body.noExpiry !== undefined) data.noExpiry = body.noExpiry;
    if (body.noExpiry === true) data.expiryDate = null;
    else if (body.expiryDate !== undefined) data.expiryDate = parseExpiryDate(body.expiryDate);
    if (body.active !== undefined) data.active = body.active;

    const requestedQuantity = body.quantity;
    const item = await prisma.$transaction(async (tx) => {
      const updated = await tx.labStockItem.update({
        where: { id: req.params.id },
        data,
        include: itemInclude,
      });
      if (requestedQuantity !== undefined && requestedQuantity !== existing.quantity) {
        await applyLabStockMovement(tx, {
          itemId: existing.id,
          type: "ADJUSTMENT",
          targetQuantity: requestedQuantity,
          userId: req.user!.id,
        });
        return tx.labStockItem.findUniqueOrThrow({
          where: { id: existing.id },
          include: itemInclude,
        });
      }
      return updated;
    });
    return res.json(item);
  } catch {
    return res.status(400).json({ error: "Mise à jour impossible" });
  }
});

router.delete("/items/:id", async (req, res) => {
  try {
    const movementCount = await prisma.labStockMovement.count({ where: { itemId: req.params.id } });
    if (movementCount > 0) {
      await prisma.labStockItem.update({ where: { id: req.params.id }, data: { active: false } });
      return res.json({ message: "Article désactivé (historique conservé)" });
    }
    await prisma.labStockItem.delete({ where: { id: req.params.id } });
    return res.json({ message: "Article supprimé" });
  } catch {
    return res.status(400).json({ error: "Suppression impossible" });
  }
});

// ---------------------------------------------------------------------------
// Mouvements
// ---------------------------------------------------------------------------

const movementSchema = z
  .object({
    itemId: z.string(),
    type: z.enum(["ENTRY", "EXIT", "ADJUSTMENT"]),
    quantity: z.number().int().positive().optional(),
    targetQuantity: z.number().int().min(0).optional(),
    unitCostFcfa: z.number().int().min(0).optional(),
    reference: z.string().optional(),
    notes: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.type === "ADJUSTMENT" && data.targetQuantity === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "targetQuantity requis", path: ["targetQuantity"] });
    }
    if (data.type !== "ADJUSTMENT" && data.quantity === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "quantity requis", path: ["quantity"] });
    }
  });

router.get("/stock-movements", async (req, res) => {
  const itemId = typeof req.query.itemId === "string" ? req.query.itemId : undefined;
  const movements = await prisma.labStockMovement.findMany({
    where: itemId ? { itemId } : undefined,
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      item: { select: { id: true, name: true, sku: true, unit: true } },
      user: { select: { id: true, firstName: true, lastName: true } },
    },
  });
  return res.json(movements);
});

router.post("/stock-movements", async (req, res) => {
  try {
    const body = movementSchema.parse(req.body);
    const userId = req.user!.id;
    const movement = await prisma.$transaction((tx) =>
      applyLabStockMovement(tx, {
        itemId: body.itemId,
        type: body.type,
        quantity: body.quantity,
        targetQuantity: body.targetQuantity,
        unitCostFcfa: body.unitCostFcfa,
        reference: body.reference?.trim() || undefined,
        notes: body.notes?.trim() || undefined,
        userId,
      }),
    );
    return res.status(201).json(movement);
  } catch (error) {
    return mapLabStockError(error, res);
  }
});

export default router;
