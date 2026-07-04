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

const changeSchema = z.object({
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  colleagueId: z.string().min(1),
  amountFcfa: z.coerce.number().int().positive(),
  comment: z.string().max(500).optional(),
});

const changeUpdateSchema = z.object({
  colleagueId: z.string().min(1).optional(),
  amountFcfa: z.coerce.number().int().positive().optional(),
  comment: z.string().max(500).optional().nullable(),
});

function canManageChangeTransfer(
  user: { id: string; role: UserRole },
  row: { recordedById: string; requesterId: string },
) {
  return (
    row.recordedById === user.id ||
    row.requesterId === user.id ||
    user.role === UserRole.ADMIN ||
    user.role === UserRole.COMPTABLE
  );
}

function canRefundChangeTransfer(
  user: { id: string; role: UserRole },
  row: { requesterId: string; providerId: string; refundedAt: Date | null },
) {
  if (row.refundedAt) return false;
  return (
    row.requesterId === user.id ||
    row.providerId === user.id ||
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

router.get("/change-transfers", async (req, res) => {
  const user = req.user!;
  const parsed = parseBusinessDateQuery(req.query.businessDate);
  if (!parsed) return res.status(400).json({ error: "Date invalide" });

  try {
    const rows = await prisma.cashChangeTransfer.findMany({
    where: { businessDate: parsed.date },
    include: {
      requester: { select: userSelect },
      provider: { select: userSelect },
      recordedBy: { select: userSelect },
      refundedBy: { select: userSelect },
    },
    orderBy: { createdAt: "desc" },
  });

  const mapRow = (row: (typeof rows)[number]) => ({
    id: row.id,
    businessDate: formatBusinessDate(row.businessDate),
    amountFcfa: row.amountFcfa,
    comment: row.comment,
    isRefunded: row.refundedAt !== null,
    refundedAt: row.refundedAt?.toISOString() ?? null,
    requester: { ...row.requester, fullName: mapUserLabel(row.requester) },
    provider: { ...row.provider, fullName: mapUserLabel(row.provider) },
    recordedBy: { ...row.recordedBy, fullName: mapUserLabel(row.recordedBy) },
    refundedBy: row.refundedBy
      ? { ...row.refundedBy, fullName: mapUserLabel(row.refundedBy) }
      : null,
    createdAt: row.createdAt.toISOString(),
  });

  const mapped = rows.map(mapRow);
  const mySent = mapped.filter((row) => row.requester.id === user.id);
  const myReceived = mapped.filter((row) => row.provider.id === user.id);

  let receivedFcfa = 0;
  let givenFcfa = 0;
  let pendingReceivedFcfa = 0;
  let pendingGivenFcfa = 0;
  for (const row of rows) {
    if (row.providerId === user.id) {
      receivedFcfa += row.amountFcfa;
      if (!row.refundedAt) pendingReceivedFcfa += row.amountFcfa;
    }
    if (row.requesterId === user.id) {
      givenFcfa += row.amountFcfa;
      if (!row.refundedAt) pendingGivenFcfa += row.amountFcfa;
    }
  }

  return res.json({
    businessDate: parsed.iso,
    currentUserId: user.id,
    mySummary: {
      receivedFcfa,
      givenFcfa,
      netFcfa: receivedFcfa - givenFcfa,
      pendingReceivedFcfa,
      pendingGivenFcfa,
      pendingNetFcfa: pendingReceivedFcfa - pendingGivenFcfa,
      sentCount: mySent.length,
      receivedCount: myReceived.length,
    },
    mySent,
    myReceived,
    rows: mapped,
  });
  } catch (error) {
    console.error("GET /change-transfers:", error);
    const prismaCode =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: string }).code)
        : "";
    if (prismaCode === "P2022") {
      return res.status(500).json({
        error:
          "Schéma base de données incomplet. Exécutez : cd backend && npx prisma db push",
      });
    }
    return res.status(500).json({ error: "Impossible de charger les mouvements." });
  }
});

router.post("/change-transfers", async (req, res) => {
  const user = req.user!;
  try {
    const body = changeSchema.parse(req.body);

    if (body.colleagueId === user.id) {
      return res.status(400).json({ error: "Choisissez un autre collègue." });
    }

    const businessDate = parseBusinessDate(body.businessDate);
    const provider = await assertCashier(body.colleagueId);
    if (!provider) {
      return res.status(400).json({ error: "Collègue invalide" });
    }

    const row = await prisma.cashChangeTransfer.create({
      data: {
        businessDate,
        requesterId: user.id,
        providerId: body.colleagueId,
        amountFcfa: body.amountFcfa,
        patientHint: null,
        comment: body.comment?.trim() || null,
        recordedById: user.id,
      },
    });

    return res.status(201).json({
      id: row.id,
      message: `Envoi de ${body.amountFcfa.toLocaleString("fr-FR")} FCFA chez ${mapUserLabel(provider)} enregistré.`,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Données invalides", details: error.issues });
    }
    return res.status(400).json({ error: "Enregistrement impossible" });
  }
});

router.put("/change-transfers/:id", async (req, res) => {
  const user = req.user!;
  const row = await prisma.cashChangeTransfer.findUnique({ where: { id: req.params.id } });
  if (!row) return res.status(404).json({ error: "Mouvement introuvable" });
  if (!canManageChangeTransfer(user, row)) {
    return res.status(403).json({ error: "Modification non autorisée" });
  }
  if (row.refundedAt) {
    return res.status(400).json({ error: "Mouvement déjà remboursé." });
  }

  try {
    const body = changeUpdateSchema.parse(req.body);
    if (body.colleagueId === user.id) {
      return res.status(400).json({ error: "Choisissez un autre collègue." });
    }

    const providerId = body.colleagueId ?? row.providerId;
    if (body.colleagueId) {
      const provider = await assertCashier(body.colleagueId);
      if (!provider) return res.status(400).json({ error: "Collègue invalide" });
    }

    const updated = await prisma.cashChangeTransfer.update({
      where: { id: row.id },
      data: {
        providerId,
        amountFcfa: body.amountFcfa ?? row.amountFcfa,
        comment:
          body.comment === undefined
            ? row.comment
            : body.comment === null
              ? null
              : body.comment.trim() || null,
      },
    });

    return res.json({
      id: updated.id,
      message: "Mouvement modifié.",
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Données invalides", details: error.issues });
    }
    return res.status(400).json({ error: "Modification impossible" });
  }
});

router.delete("/change-transfers/:id", async (req, res) => {
  const user = req.user!;
  const row = await prisma.cashChangeTransfer.findUnique({ where: { id: req.params.id } });
  if (!row) return res.status(404).json({ error: "Mouvement introuvable" });

  if (!canManageChangeTransfer(user, row)) {
    return res.status(403).json({ error: "Suppression non autorisée" });
  }
  if (row.refundedAt) {
    return res.status(400).json({ error: "Mouvement déjà remboursé." });
  }

  await prisma.cashChangeTransfer.delete({ where: { id: row.id } });
  return res.json({ message: "Mouvement supprimé." });
});

router.post("/change-transfers/:id/refund", async (req, res) => {
  const user = req.user!;
  const row = await prisma.cashChangeTransfer.findUnique({
    where: { id: req.params.id },
    include: {
      requester: { select: userSelect },
      provider: { select: userSelect },
    },
  });
  if (!row) return res.status(404).json({ error: "Mouvement introuvable" });
  if (!canRefundChangeTransfer(user, row)) {
    return res.status(403).json({ error: "Remboursement non autorisé" });
  }

  const updated = await prisma.cashChangeTransfer.update({
    where: { id: row.id },
    data: {
      refundedAt: new Date(),
      refundedById: user.id,
    },
  });

  const counterpart =
    user.id === row.requesterId
      ? mapUserLabel(row.provider)
      : mapUserLabel(row.requester);

  return res.json({
    id: updated.id,
    message: `Remboursement de ${row.amountFcfa.toLocaleString("fr-FR")} FCFA enregistré (${counterpart}).`,
  });
});

export { EXPENSE_CATEGORY_LABELS };
export default router;
