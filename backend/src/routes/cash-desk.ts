import { Router } from "express";
import { z } from "zod";
import { ClinicExpenseCategory, Prisma, UserRole } from "@prisma/client";
import { prisma } from "../lib/db.js";
import {
  CASH_COLLECTOR_ROLES,
  formatBusinessDate,
  isValidBusinessDate,
  parseBusinessDate,
} from "../lib/cash-shift.js";
import { DEFAULT_EXPENSE_INDICES } from "../lib/expense-indices-seed.js";
import { requireAuth, requireAnyModule } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth, requireAnyModule("reception", "comptabilite"));

const EXPENSE_CATEGORY_LABELS: Record<ClinicExpenseCategory, string> = {
  FOURNITURES: "Fournitures",
  TRANSPORT: "Transport / course",
  MAINTENANCE: "Maintenance",
  ACHAT_URGENT: "Achat urgent",
  AUTRE: "Autre",
};

const userSelect = { id: true, firstName: true, lastName: true, role: true } as const;

function mapUserLabel(user: { firstName: string; lastName: string }) {
  return `${user.firstName} ${user.lastName}`.trim();
}

async function listCashiers() {
  return prisma.user.findMany({
    where: { role: { in: CASH_COLLECTOR_ROLES }, active: true },
    select: userSelect,
    orderBy: [{ role: "asc" }, { lastName: "asc" }, { firstName: "asc" }],
  });
}

function parseBusinessDateQuery(value: unknown) {
  const iso = typeof value === "string" ? value : formatBusinessDate(new Date());
  if (!isValidBusinessDate(iso)) return null;
  return { iso, date: parseBusinessDate(iso) };
}

const expenseSchema = z.object({
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amountFcfa: z.coerce.number().int().positive(),
  label: z.string().min(2).max(200),
  category: z.nativeEnum(ClinicExpenseCategory).default(ClinicExpenseCategory.AUTRE),
  comment: z.string().max(500).optional(),
  paidById: z.string().min(1).optional(),
});

const expenseUpdateSchema = z.object({
  label: z.string().min(2).max(200).optional(),
  amountFcfa: z.coerce.number().int().positive().optional(),
  comment: z.string().max(500).optional(),
});

function canManageExpense(
  user: { id: string; role: UserRole },
  row: { recordedById: string; paidById: string },
) {
  return (
    row.recordedById === user.id ||
    row.paidById === user.id ||
    user.role === UserRole.ADMIN ||
    user.role === UserRole.COMPTABLE
  );
}

const expenseIndiceSchema = z.object({
  name: z.string().min(2).max(100),
  description: z.string().max(500).optional(),
  active: z.boolean().optional(),
});

async function syncExpenseIndices() {
  for (const [index, item] of DEFAULT_EXPENSE_INDICES.entries()) {
    await prisma.clinicExpenseIndice.upsert({
      where: { name: item.name },
      update: { sortOrder: index, description: item.description },
      create: {
        name: item.name,
        description: item.description,
        sortOrder: index,
        active: true,
      },
    });
  }
  return prisma.clinicExpenseIndice.count();
}

function serializeExpenseIndice(row: {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  sortOrder: number;
}) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    active: row.active,
    sortOrder: row.sortOrder,
  };
}

async function assertCashier(userId: string) {
  return prisma.user.findFirst({
    where: { id: userId, role: { in: CASH_COLLECTOR_ROLES }, active: true },
    select: userSelect,
  });
}

router.get("/cashiers", async (_req, res) => {
  const cashiers = await listCashiers();
  return res.json(
    cashiers.map((row) => ({
      ...row,
      fullName: mapUserLabel(row),
    })),
  );
});

router.get("/expenses", async (req, res) => {
  const user = req.user!;
  const parsed = parseBusinessDateQuery(req.query.businessDate);
  if (!parsed) return res.status(400).json({ error: "Date invalide" });

  const mineOnly =
    user.role === UserRole.RECEPTIONNISTE ||
    (typeof req.query.mine === "string" && req.query.mine === "1");

  const rows = await prisma.clinicExpense.findMany({
    where: {
      businessDate: parsed.date,
      ...(mineOnly ? { paidById: user.id } : {}),
    },
    include: {
      paidBy: { select: userSelect },
      recordedBy: { select: userSelect },
    },
    orderBy: { createdAt: "desc" },
  });

  const totalFcfa = rows.reduce((sum, row) => sum + row.amountFcfa, 0);

  return res.json({
    businessDate: parsed.iso,
    totalFcfa,
    categories: EXPENSE_CATEGORY_LABELS,
    rows: rows.map((row) => ({
      id: row.id,
      businessDate: formatBusinessDate(row.businessDate),
      amountFcfa: row.amountFcfa,
      label: row.label,
      category: row.category,
      categoryLabel: EXPENSE_CATEGORY_LABELS[row.category],
      comment: row.comment,
      paidBy: { ...row.paidBy, fullName: mapUserLabel(row.paidBy) },
      recordedBy: { ...row.recordedBy, fullName: mapUserLabel(row.recordedBy) },
      createdAt: row.createdAt.toISOString(),
    })),
  });
});

router.post("/expenses", async (req, res) => {
  const user = req.user!;
  try {
    const body = expenseSchema.parse(req.body);
    const businessDate = parseBusinessDate(body.businessDate);
    const paidById = body.paidById ?? user.id;

    const cashier = await assertCashier(paidById);
    if (!cashier) return res.status(400).json({ error: "Caissier invalide" });

    const row = await prisma.clinicExpense.create({
      data: {
        businessDate,
        amountFcfa: body.amountFcfa,
        label: body.label.trim(),
        category: body.category,
        comment: body.comment?.trim() || null,
        paidById,
        recordedById: user.id,
      },
      include: {
        paidBy: { select: userSelect },
        recordedBy: { select: userSelect },
      },
    });

    return res.status(201).json({
      id: row.id,
      message: "Dépense enregistrée.",
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Données invalides", details: error.issues });
    }
    return res.status(400).json({ error: "Enregistrement impossible" });
  }
});

router.delete("/expenses/:id", async (req, res) => {
  const user = req.user!;
  const row = await prisma.clinicExpense.findUnique({ where: { id: req.params.id } });
  if (!row) return res.status(404).json({ error: "Dépense introuvable" });

  if (!canManageExpense(user, row)) {
    return res.status(403).json({ error: "Suppression non autorisée" });
  }

  await prisma.clinicExpense.delete({ where: { id: row.id } });
  return res.json({ message: "Dépense supprimée." });
});

router.put("/expenses/:id", async (req, res) => {
  const user = req.user!;
  const row = await prisma.clinicExpense.findUnique({ where: { id: req.params.id } });
  if (!row) return res.status(404).json({ error: "Dépense introuvable" });

  if (!canManageExpense(user, row)) {
    return res.status(403).json({ error: "Modification non autorisée" });
  }

  try {
    const body = expenseUpdateSchema.parse(req.body);
    const updated = await prisma.clinicExpense.update({
      where: { id: row.id },
      data: {
        ...(body.label !== undefined ? { label: body.label.trim() } : {}),
        ...(body.amountFcfa !== undefined ? { amountFcfa: body.amountFcfa } : {}),
        ...(body.comment !== undefined ? { comment: body.comment.trim() || null } : {}),
      },
      include: {
        paidBy: { select: userSelect },
        recordedBy: { select: userSelect },
      },
    });

    return res.json({
      id: updated.id,
      businessDate: formatBusinessDate(updated.businessDate),
      amountFcfa: updated.amountFcfa,
      label: updated.label,
      comment: updated.comment,
      createdAt: updated.createdAt.toISOString(),
      message: "Dépense modifiée.",
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Données invalides", details: error.issues });
    }
    return res.status(400).json({ error: "Modification impossible" });
  }
});

function expenseIndiceErrorMessage(error: unknown, fallback: string) {
  if (error instanceof z.ZodError) {
    return { status: 400 as const, error: "Données invalides", details: error.issues };
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return { status: 409 as const, error: "Un indice avec ce nom existe déjà." };
  }
  return { status: 400 as const, error: fallback };
}

router.get("/expense-indices", async (_req, res) => {
  let items = await prisma.clinicExpenseIndice.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  if (items.length === 0) {
    await syncExpenseIndices();
    items = await prisma.clinicExpenseIndice.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
  }
  return res.json(items.map(serializeExpenseIndice));
});

router.post("/expense-indices", async (req, res) => {
  try {
    const body = expenseIndiceSchema.parse(req.body);
    const item = await prisma.clinicExpenseIndice.create({
      data: {
        name: body.name.trim(),
        description: body.description?.trim() || null,
      },
    });
    return res.status(201).json(serializeExpenseIndice(item));
  } catch (error) {
    const mapped = expenseIndiceErrorMessage(
      error,
      "Ajout impossible — vérifiez le nom saisi.",
    );
    return res.status(mapped.status).json(
      "details" in mapped
        ? { error: mapped.error, details: mapped.details }
        : { error: mapped.error },
    );
  }
});

router.put("/expense-indices/:id", async (req, res) => {
  const id = req.params.id;
  try {
    const existing = await prisma.clinicExpenseIndice.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "Indice introuvable" });

    const body = expenseIndiceSchema.partial().parse(req.body);
    const item = await prisma.clinicExpenseIndice.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name.trim() } : {}),
        ...(body.description !== undefined
          ? { description: body.description.trim() || null }
          : {}),
        ...(body.active !== undefined ? { active: body.active } : {}),
      },
    });
    return res.json(serializeExpenseIndice(item));
  } catch (error) {
    const mapped = expenseIndiceErrorMessage(error, "Modification impossible.");
    return res.status(mapped.status).json(
      "details" in mapped
        ? { error: mapped.error, details: mapped.details }
        : { error: mapped.error },
    );
  }
});

router.delete("/expense-indices/:id", async (req, res) => {
  const item = await prisma.clinicExpenseIndice.findUnique({ where: { id: req.params.id } });
  if (!item) return res.status(404).json({ error: "Indice introuvable" });

  await prisma.clinicExpenseIndice.delete({ where: { id: item.id } });
  return res.json({ message: "Indice supprimé." });
});

export { EXPENSE_CATEGORY_LABELS };
export default router;
