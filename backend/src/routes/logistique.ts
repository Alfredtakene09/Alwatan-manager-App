import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/db.js";
import { applyLogisticsMovement } from "../lib/logistics-stock.js";
import { requireAuth, requireModule } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth, requireModule("logistique"));

const EXPIRY_HORIZON_DAYS = 60;

function mapLogisticsError(error: unknown, res: import("express").Response) {
  if (error instanceof z.ZodError) return res.status(400).json({ error: "Données invalides" });
  if (error instanceof Error) {
    if (error.message === "ITEM_NOT_FOUND") return res.status(404).json({ error: "Article introuvable" });
    if (error.message === "SUPPLIER_NOT_FOUND") return res.status(404).json({ error: "Fournisseur introuvable" });
    if (error.message === "INSUFFICIENT_STOCK") return res.status(409).json({ error: "Stock insuffisant" });
    if (error.message === "NO_STOCK_CHANGE") return res.status(400).json({ error: "Aucun changement de stock" });
    if (error.message === "INVALID_QUANTITY") return res.status(400).json({ error: "Quantité invalide" });
    if (error.message === "REQUEST_NOT_FOUND") return res.status(404).json({ error: "Demande introuvable" });
    if (error.message === "REQUEST_NOT_PENDING") return res.status(409).json({ error: "Demande déjà traitée" });
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
  return `LOG-${slug || "ARTICLE"}-${Date.now().toString(36).toUpperCase()}`;
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
  const items = await prisma.logisticsCategory.findMany({
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
    const item = await prisma.logisticsCategory.create({
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
    const item = await prisma.logisticsCategory.update({
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
    const linked = await prisma.logisticsItem.count({ where: { categoryId: req.params.id } });
    if (linked > 0) {
      await prisma.logisticsCategory.update({ where: { id: req.params.id }, data: { active: false } });
      return res.json({ message: "Catégorie désactivée (articles conservés)" });
    }
    await prisma.logisticsCategory.delete({ where: { id: req.params.id } });
    return res.json({ message: "Catégorie supprimée" });
  } catch {
    return res.status(400).json({ error: "Suppression impossible" });
  }
});

// ---------------------------------------------------------------------------
// Fournisseurs
// ---------------------------------------------------------------------------

const supplierSchema = z.object({
  name: z.string().min(2),
  contactName: z.string().optional(),
  phone: z.string().optional(),
  email: z.union([z.string().email(), z.literal("")]).optional(),
  address: z.string().optional(),
  active: z.boolean().optional(),
});

router.get("/suppliers", async (_req, res) => {
  const items = await prisma.logisticsSupplier.findMany({ orderBy: { name: "asc" } });
  return res.json(items);
});

router.post("/suppliers", async (req, res) => {
  try {
    const body = supplierSchema.parse({ ...req.body, email: req.body.email === "" ? undefined : req.body.email });
    const item = await prisma.logisticsSupplier.create({
      data: {
        name: body.name.trim(),
        contactName: body.contactName?.trim() || null,
        phone: body.phone?.trim() || null,
        email: body.email || null,
        address: body.address?.trim() || null,
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
    const body = supplierSchema.partial().parse({ ...req.body, email: req.body.email === "" ? undefined : req.body.email });
    const item = await prisma.logisticsSupplier.update({
      where: { id: req.params.id },
      data: {
        ...(body.name !== undefined ? { name: body.name.trim() } : {}),
        ...(body.contactName !== undefined ? { contactName: body.contactName?.trim() || null } : {}),
        ...(body.phone !== undefined ? { phone: body.phone?.trim() || null } : {}),
        ...(body.email !== undefined ? { email: body.email || null } : {}),
        ...(body.address !== undefined ? { address: body.address?.trim() || null } : {}),
        ...(body.active !== undefined ? { active: body.active } : {}),
      },
    });
    return res.json(item);
  } catch {
    return res.status(400).json({ error: "Mise à jour impossible" });
  }
});

router.delete("/suppliers/:id", async (req, res) => {
  try {
    const movementCount = await prisma.logisticsStockMovement.count({ where: { supplierId: req.params.id } });
    const itemCount = await prisma.logisticsItem.count({ where: { supplierId: req.params.id } });
    if (movementCount > 0 || itemCount > 0) {
      await prisma.logisticsSupplier.update({ where: { id: req.params.id }, data: { active: false } });
      return res.json({ message: "Fournisseur désactivé (historique conservé)" });
    }
    await prisma.logisticsSupplier.delete({ where: { id: req.params.id } });
    return res.json({ message: "Fournisseur supprimé" });
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
  supplierId: z.string().optional().nullable(),
  quantity: z.number().int().min(0).optional(),
  unitCostFcfa: z.number().int().min(0).optional(),
  minStock: z.number().int().min(0).optional(),
  expiryDate: z.string().optional().nullable(),
  noExpiry: z.boolean().optional(),
  active: z.boolean().optional(),
});

const itemInclude = {
  category: { select: { id: true, name: true } },
  supplier: { select: { id: true, name: true } },
} as const;

router.get("/items", async (_req, res) => {
  const items = await prisma.logisticsItem.findMany({ orderBy: { name: "asc" }, include: itemInclude });
  return res.json(items);
});

router.post("/items", async (req, res) => {
  try {
    const body = itemSchema.parse(req.body);
    const item = await prisma.logisticsItem.create({
      data: {
        name: body.name.trim(),
        sku: resolveItemSku(body),
        reference: body.reference?.trim() || null,
        unit: body.unit?.trim() || "unité",
        categoryId: body.categoryId || null,
        supplierId: body.supplierId || null,
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
    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = body.name.trim();
    if (body.sku !== undefined) data.sku = body.sku.trim();
    if (body.reference !== undefined) data.reference = body.reference?.trim() || null;
    if (body.unit !== undefined) data.unit = body.unit?.trim() || "unité";
    if (body.categoryId !== undefined) data.categoryId = body.categoryId || null;
    if (body.supplierId !== undefined) data.supplierId = body.supplierId || null;
    if (body.quantity !== undefined) data.quantity = body.quantity;
    if (body.unitCostFcfa !== undefined) data.unitCostFcfa = body.unitCostFcfa;
    if (body.minStock !== undefined) data.minStock = body.minStock;
    if (body.noExpiry !== undefined) data.noExpiry = body.noExpiry;
    if (body.noExpiry === true) data.expiryDate = null;
    else if (body.expiryDate !== undefined) data.expiryDate = parseExpiryDate(body.expiryDate);
    if (body.active !== undefined) data.active = body.active;

    const item = await prisma.logisticsItem.update({ where: { id: req.params.id }, data, include: itemInclude });
    return res.json(item);
  } catch {
    return res.status(400).json({ error: "Mise à jour impossible" });
  }
});

router.delete("/items/:id", async (req, res) => {
  try {
    const movementCount = await prisma.logisticsStockMovement.count({ where: { itemId: req.params.id } });
    const lineCount = await prisma.logisticsRequestLine.count({ where: { itemId: req.params.id } });
    if (movementCount > 0 || lineCount > 0) {
      await prisma.logisticsItem.update({ where: { id: req.params.id }, data: { active: false } });
      return res.json({ message: "Article désactivé (historique conservé)" });
    }
    await prisma.logisticsItem.delete({ where: { id: req.params.id } });
    return res.json({ message: "Article supprimé" });
  } catch {
    return res.status(400).json({ error: "Suppression impossible" });
  }
});

// ---------------------------------------------------------------------------
// Mouvements de stock
// ---------------------------------------------------------------------------

const movementSchema = z
  .object({
    itemId: z.string(),
    type: z.enum(["ENTRY", "EXIT", "ADJUSTMENT"]),
    quantity: z.number().int().positive().optional(),
    targetQuantity: z.number().int().min(0).optional(),
    unitCostFcfa: z.number().int().min(0).optional(),
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

router.get("/stock-movements", async (req, res) => {
  const itemId = typeof req.query.itemId === "string" ? req.query.itemId : undefined;
  const items = await prisma.logisticsStockMovement.findMany({
    where: itemId ? { itemId } : undefined,
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      item: { select: { id: true, name: true, sku: true, unit: true } },
      supplier: { select: { id: true, name: true } },
      user: { select: { id: true, firstName: true, lastName: true } },
    },
  });
  return res.json(items);
});

router.post("/stock-movements", async (req, res) => {
  const user = req.user!;
  try {
    const body = movementSchema.parse(req.body);
    const movement = await prisma.$transaction((tx) =>
      applyLogisticsMovement(tx, {
        itemId: body.itemId,
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
    return mapLogisticsError(error, res);
  }
});

// ---------------------------------------------------------------------------
// Demandes internes (bons de sortie)
// ---------------------------------------------------------------------------

const requestSchema = z.object({
  service: z.string().min(2),
  notes: z.string().optional(),
  lines: z.array(z.object({ itemId: z.string(), quantityRequested: z.number().int().positive() })).min(1),
});

async function generateRequestCode() {
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const count = await prisma.logisticsRequest.count({
    where: { createdAt: { gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()) } },
  });
  return `BS-${stamp}-${String(count + 1).padStart(3, "0")}`;
}

const requestInclude = {
  requestedBy: { select: { id: true, firstName: true, lastName: true } },
  handledBy: { select: { id: true, firstName: true, lastName: true } },
  lines: { include: { item: { select: { id: true, name: true, sku: true, unit: true, quantity: true } } } },
} as const;

router.get("/requests", async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const items = await prisma.logisticsRequest.findMany({
    where: status && ["PENDING", "FULFILLED", "REJECTED"].includes(status) ? { status: status as never } : undefined,
    orderBy: { createdAt: "desc" },
    take: 200,
    include: requestInclude,
  });
  return res.json(items);
});

router.post("/requests", async (req, res) => {
  const user = req.user!;
  try {
    const body = requestSchema.parse(req.body);
    const request = await prisma.logisticsRequest.create({
      data: {
        code: await generateRequestCode(),
        service: body.service.trim(),
        notes: body.notes?.trim() || null,
        requestedById: user.id,
        lines: {
          create: body.lines.map((line) => ({ itemId: line.itemId, quantityRequested: line.quantityRequested })),
        },
      },
      include: requestInclude,
    });
    return res.status(201).json(request);
  } catch (error) {
    return mapLogisticsError(error, res);
  }
});

router.post("/requests/:id/fulfill", async (req, res) => {
  const user = req.user!;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const request = await tx.logisticsRequest.findUnique({
        where: { id: req.params.id },
        include: { lines: true },
      });
      if (!request) throw new Error("REQUEST_NOT_FOUND");
      if (request.status !== "PENDING") throw new Error("REQUEST_NOT_PENDING");

      for (const line of request.lines) {
        await applyLogisticsMovement(tx, {
          itemId: line.itemId,
          type: "EXIT",
          quantity: line.quantityRequested,
          reference: request.code,
          notes: `Sortie ${request.service}`,
          requestId: request.id,
          userId: user.id,
        });
        await tx.logisticsRequestLine.update({
          where: { id: line.id },
          data: { quantityIssued: line.quantityRequested },
        });
      }

      return tx.logisticsRequest.update({
        where: { id: request.id },
        data: { status: "FULFILLED", handledById: user.id, handledAt: new Date() },
        include: requestInclude,
      });
    });
    return res.json(result);
  } catch (error) {
    return mapLogisticsError(error, res);
  }
});

router.post("/requests/:id/reject", async (req, res) => {
  const user = req.user!;
  try {
    const request = await prisma.logisticsRequest.findUnique({ where: { id: req.params.id } });
    if (!request) throw new Error("REQUEST_NOT_FOUND");
    if (request.status !== "PENDING") throw new Error("REQUEST_NOT_PENDING");
    const updated = await prisma.logisticsRequest.update({
      where: { id: req.params.id },
      data: { status: "REJECTED", handledById: user.id, handledAt: new Date() },
      include: requestInclude,
    });
    return res.json(updated);
  } catch (error) {
    return mapLogisticsError(error, res);
  }
});

// ---------------------------------------------------------------------------
// Alertes
// ---------------------------------------------------------------------------

router.get("/alerts", async (_req, res) => {
  const now = new Date();
  const horizon = new Date(now);
  horizon.setDate(horizon.getDate() + EXPIRY_HORIZON_DAYS);

  const items = await prisma.logisticsItem.findMany({
    where: { active: true },
    orderBy: [{ quantity: "asc" }, { name: "asc" }],
    include: { category: { select: { name: true } } },
  });

  const stockItems = items
    .filter((item) => item.quantity <= item.minStock)
    .map((item) => ({
      itemId: item.id,
      name: item.name,
      sku: item.sku,
      unit: item.unit,
      quantity: item.quantity,
      minStock: item.minStock,
      categoryName: item.category?.name ?? null,
      level:
        item.quantity <= 0
          ? ("out" as const)
          : item.quantity <= Math.max(1, Math.floor(item.minStock / 2))
            ? ("critical" as const)
            : ("low" as const),
    }));

  const expiryItems = items
    .filter((item) => !item.noExpiry && item.expiryDate && item.expiryDate <= horizon)
    .map((item) => {
      const expiry = item.expiryDate!;
      const daysLeft = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      return {
        itemId: item.id,
        name: item.name,
        sku: item.sku,
        expiryDate: expiry.toISOString().slice(0, 10),
        daysLeft,
        level: daysLeft < 0 ? ("expired" as const) : ("soon" as const),
      };
    })
    .sort((a, b) => a.daysLeft - b.daysLeft);

  return res.json({
    count: stockItems.length + expiryItems.length,
    outOfStock: stockItems.filter((row) => row.level === "out").length,
    critical: stockItems.filter((row) => row.level === "critical").length,
    low: stockItems.filter((row) => row.level === "low").length,
    expirySoon: expiryItems.filter((row) => row.level === "soon").length,
    expired: expiryItems.filter((row) => row.level === "expired").length,
    stockItems,
    expiryItems,
  });
});

// ---------------------------------------------------------------------------
// Rapports
// ---------------------------------------------------------------------------

router.get("/reports", async (req, res) => {
  const period = typeof req.query.period === "string" ? req.query.period : "30d";
  const days = period === "7d" ? 7 : period === "90d" ? 90 : 30;
  const from = new Date();
  from.setDate(from.getDate() - days);

  const [items, movements] = await Promise.all([
    prisma.logisticsItem.findMany({
      where: { active: true },
      include: { category: { select: { name: true } } },
    }),
    prisma.logisticsStockMovement.findMany({
      where: { createdAt: { gte: from } },
      include: { item: { select: { id: true, name: true } } },
    }),
  ]);

  const stockValueFcfa = items.reduce((sum, item) => sum + item.quantity * item.unitCostFcfa, 0);
  const entries = movements.filter((m) => m.type === "ENTRY");
  const exits = movements.filter((m) => m.type === "EXIT");
  const entriesQty = entries.reduce((sum, m) => sum + m.quantity, 0);
  const exitsQty = exits.reduce((sum, m) => sum + m.quantity, 0);
  const entriesValueFcfa = entries.reduce((sum, m) => sum + (m.unitCostFcfa ?? 0) * m.quantity, 0);

  const byCategory = new Map<string, { name: string; itemsCount: number; stockValueFcfa: number }>();
  for (const item of items) {
    const key = item.category?.name ?? "Sans catégorie";
    const current = byCategory.get(key) ?? { name: key, itemsCount: 0, stockValueFcfa: 0 };
    current.itemsCount += 1;
    current.stockValueFcfa += item.quantity * item.unitCostFcfa;
    byCategory.set(key, current);
  }

  const topExitCounts = new Map<string, { name: string; quantity: number }>();
  for (const m of exits) {
    const current = topExitCounts.get(m.item.id) ?? { name: m.item.name, quantity: 0 };
    current.quantity += m.quantity;
    topExitCounts.set(m.item.id, current);
  }
  const topExits = [...topExitCounts.values()].sort((a, b) => b.quantity - a.quantity).slice(0, 10);

  return res.json({
    period,
    itemsCount: items.length,
    stockValueFcfa,
    movementsCount: movements.length,
    entriesQty,
    exitsQty,
    entriesValueFcfa,
    byCategory: [...byCategory.values()].sort((a, b) => b.stockValueFcfa - a.stockValueFcfa),
    topExits,
  });
});

// ---------------------------------------------------------------------------
// Tableau de bord
// ---------------------------------------------------------------------------

router.get("/dashboard", async (_req, res) => {
  const now = new Date();
  const horizon = new Date(now);
  horizon.setDate(horizon.getDate() + EXPIRY_HORIZON_DAYS);
  const from = new Date();
  from.setDate(from.getDate() - 6);
  from.setHours(0, 0, 0, 0);

  const [items, pendingRequests, movements] = await Promise.all([
    prisma.logisticsItem.findMany({ where: { active: true } }),
    prisma.logisticsRequest.count({ where: { status: "PENDING" } }),
    prisma.logisticsStockMovement.findMany({
      where: { createdAt: { gte: from } },
      include: { item: { select: { name: true } } },
    }),
  ]);

  const lowStock = items.filter((item) => item.quantity <= item.minStock);
  const expiring = items.filter((item) => !item.noExpiry && item.expiryDate && item.expiryDate <= horizon);
  const stockValueFcfa = items.reduce((sum, item) => sum + item.quantity * item.unitCostFcfa, 0);

  const dayFmt = new Intl.DateTimeFormat("fr-FR", { weekday: "short" });
  const movementsLast7Days: Array<{ date: string; dayLabel: string; entries: number; exits: number }> = [];
  for (let i = 0; i < 7; i += 1) {
    const day = new Date(from);
    day.setDate(from.getDate() + i);
    const next = new Date(day);
    next.setDate(day.getDate() + 1);
    const dayMovements = movements.filter((m) => m.createdAt >= day && m.createdAt < next);
    movementsLast7Days.push({
      date: day.toISOString().slice(0, 10),
      dayLabel: dayFmt.format(day),
      entries: dayMovements.filter((m) => m.type === "ENTRY").reduce((s, m) => s + m.quantity, 0),
      exits: dayMovements.filter((m) => m.type === "EXIT").reduce((s, m) => s + m.quantity, 0),
    });
  }

  const topLowStock = lowStock
    .slice()
    .sort((a, b) => a.quantity - b.quantity)
    .slice(0, 6)
    .map((item) => ({
      name: item.name,
      quantity: item.quantity,
      minStock: item.minStock,
      level: item.quantity <= 0 ? "out" : item.quantity <= Math.max(1, Math.floor(item.minStock / 2)) ? "critical" : "low",
    }));

  return res.json({
    itemsCount: items.length,
    lowStock: lowStock.length,
    expiring: expiring.length,
    stockValueFcfa,
    pendingRequests,
    movementsLast7Days,
    topLowStock,
  });
});

export default router;
