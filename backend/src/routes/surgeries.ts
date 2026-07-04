import { Router } from "express";
import { z } from "zod";
import { SurgeryStatus } from "@prisma/client";
import { prisma } from "../lib/db.js";
import { comptabilitePatientWhere } from "../lib/patient-billing.js";
import {
  AWAITING_PERFORMANCE_STATUSES,
  completeSurgeryCase,
  parseOperationDateInput,
  promoteDueSurgeries,
  revertSurgeryToAwaiting,
} from "../lib/surgery-scheduling.js";
import {
  buildSharePaymentUpdate,
  getUnpaidShareKinds,
  hasAnySharePaid,
  type OperationShareKind,
} from "../lib/surgery-share-payments.js";
import { requireAuth, requireAnyModule, requireModule } from "../middleware/auth.js";

const router = Router();

const surgeryInclude = {
  visit: { include: { patient: true } },
  interventionType: {
    include: {
      anesthesiologist: { select: { id: true, firstName: true, lastName: true } },
    },
  },
  surgeon: { select: { id: true, firstName: true, lastName: true } },
} as const;

const DOCTOR_VISIBLE_STATUSES: SurgeryStatus[] = [
  ...AWAITING_PERFORMANCE_STATUSES,
  SurgeryStatus.COMPLETED,
];

function resolveMyShareKind(
  surgery: {
    surgeonId: string;
    interventionType: { anesthesiologistId: string | null; anesthesiologistPercent: number };
  },
  userId: string,
): OperationShareKind | null {
  if (surgery.surgeonId === userId) return "surgeon";
  if (
    surgery.interventionType.anesthesiologistPercent > 0 &&
    surgery.interventionType.anesthesiologistId === userId
  ) {
    return "assistant";
  }
  return null;
}

function doctorSurgeryWhere(userId: string) {
  return {
    OR: [
      { surgeonId: userId },
      {
        interventionType: {
          anesthesiologistId: userId,
          anesthesiologistPercent: { gt: 0 },
        },
      },
    ],
  };
}

router.get("/mine", requireAuth, requireModule("consultation"), async (req, res) => {
  try {
    const userId = req.user!.id;
    const scope = String(req.query.scope ?? "all");
    const now = new Date();

    await promoteDueSurgeries(now);

    let statusFilter: { status: { in: SurgeryStatus[] } } | { status: SurgeryStatus };
    if (scope === "awaiting") {
      statusFilter = { status: { in: AWAITING_PERFORMANCE_STATUSES } };
    } else if (scope === "completed") {
      statusFilter = { status: SurgeryStatus.COMPLETED };
    } else if (scope === "all") {
      statusFilter = { status: { in: DOCTOR_VISIBLE_STATUSES } };
    } else {
      return res.status(400).json({ error: "Scope invalide." });
    }

    const surgeries = await prisma.surgeryCase.findMany({
      where: {
        ...doctorSurgeryWhere(userId),
        ...statusFilter,
        visit: { patient: comptabilitePatientWhere() },
      },
      include: surgeryInclude,
      orderBy: [{ completedAt: "desc" }, { operationScheduledAt: "asc" }, { paidAt: "desc" }],
    });

    const payload = surgeries
      .map((surgery) => {
        const myShareKind = resolveMyShareKind(surgery, userId);
        if (!myShareKind) return null;
        return { ...surgery, myShareKind };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);

    return res.json(payload);
  } catch (error) {
    console.error("GET /surgeries/mine failed:", error);
    return res.status(500).json({ error: "Impossible de charger vos opérations." });
  }
});

router.use(requireAuth, requireAnyModule("reception", "comptabilite", "bloc-salles"));

const shareKindSchema = z.enum(["surgeon", "assistant", "clinic"]);

router.get("/", async (req, res) => {
  try {
    const scope = String(req.query.scope ?? "awaiting");
    const now = new Date();

    await promoteDueSurgeries(now);

    if (scope === "awaiting") {
      const surgeries = await prisma.surgeryCase.findMany({
        where: {
          status: { in: AWAITING_PERFORMANCE_STATUSES },
          visit: { patient: comptabilitePatientWhere() },
        },
        include: surgeryInclude,
        orderBy: [{ operationScheduledAt: "asc" }, { paidAt: "asc" }],
      });

      return res.json(surgeries);
    }

    if (scope === "completed") {
      const surgeries = await prisma.surgeryCase.findMany({
        where: {
          status: SurgeryStatus.COMPLETED,
          visit: { patient: comptabilitePatientWhere() },
        },
        include: surgeryInclude,
        orderBy: [{ completedAt: "desc" }, { updatedAt: "desc" }],
      });

      return res.json(surgeries);
    }

    return res.status(400).json({ error: "Scope invalide." });
  } catch (error) {
    console.error("GET /surgeries failed:", error);
    return res.status(500).json({ error: "Impossible de charger les opérations." });
  }
});

const scheduleSchema = z.object({
  operationDate: z.string().min(1),
});

router.post("/:id/schedule", async (req, res) => {
  const { operationDate } = scheduleSchema.parse(req.body);
  const surgeryId = String(req.params.id);

  let scheduledAt: Date;
  try {
    scheduledAt = parseOperationDateInput(operationDate);
  } catch {
    return res.status(400).json({ error: "Date d'opération invalide." });
  }

  const surgery = await prisma.surgeryCase.findUnique({
    where: { id: surgeryId },
    include: surgeryInclude,
  });

  if (!surgery) {
    return res.status(404).json({ error: "Opération introuvable." });
  }

  if (!AWAITING_PERFORMANCE_STATUSES.includes(surgery.status)) {
    return res.status(409).json({
      error: "Seules les opérations payées peuvent être planifiées.",
    });
  }

  await prisma.surgeryCase.update({
    where: { id: surgery.id },
    data: { operationScheduledAt: scheduledAt },
  });

  await promoteDueSurgeries(new Date());

  const updated = await prisma.surgeryCase.findUniqueOrThrow({
    where: { id: surgery.id },
    include: surgeryInclude,
  });

  return res.json(updated);
});

router.post("/:id/complete", async (req, res) => {
  const surgeryId = String(req.params.id);
  const surgery = await prisma.surgeryCase.findUnique({
    where: { id: surgeryId },
    include: surgeryInclude,
  });

  if (!surgery) {
    return res.status(404).json({ error: "Opération introuvable." });
  }

  if (!AWAITING_PERFORMANCE_STATUSES.includes(surgery.status)) {
    return res.status(409).json({
      error: "Cette opération ne peut pas être clôturée.",
    });
  }

  await completeSurgeryCase(surgery.id);

  const updated = await prisma.surgeryCase.findUniqueOrThrow({
    where: { id: surgery.id },
    include: surgeryInclude,
  });

  return res.json(updated);
});

const revertSchema = z.object({
  operationDate: z.string().optional(),
});

const paySharesSchema = z.object({
  shares: z.array(shareKindSchema).min(1).max(3),
});

const paySharesBatchSchema = z.object({
  surgeryIds: z.array(z.string().min(1)).min(1).max(500),
});

function mapSharePaymentError(error: unknown) {
  if (error instanceof Error) {
    if (error.message === "ASSISTANT_SHARE_NOT_APPLICABLE") {
      return "La part assistant ne s'applique pas à cette opération.";
    }
    if (error.message === "SHARE_ALREADY_PAID") {
      return "Une ou plusieurs parts sont déjà réglées.";
    }
  }
  return null;
}

router.post("/pay-shares-batch", async (req, res) => {
  try {
    const { surgeryIds } = paySharesBatchSchema.parse(req.body);
    const userId = req.user!.id;
    const now = new Date();

    const surgeries = await prisma.surgeryCase.findMany({
      where: {
        id: { in: surgeryIds },
        status: SurgeryStatus.COMPLETED,
      },
      include: { interventionType: true },
    });

    let count = 0;

    for (const surgery of surgeries) {
      const unpaidShares = getUnpaidShareKinds(surgery);
      if (!unpaidShares.length) continue;

      try {
        const data = buildSharePaymentUpdate(surgery, unpaidShares, userId, now);
        await prisma.surgeryCase.update({
          where: { id: surgery.id },
          data,
        });
        count += unpaidShares.length;
      } catch (error) {
        const message = mapSharePaymentError(error);
        if (message) {
          return res.status(409).json({ error: message });
        }
        throw error;
      }
    }

    return res.json({ count });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Liste d'opérations invalide." });
    }
    console.error("POST /surgeries/pay-shares-batch failed:", error);
    return res.status(500).json({ error: "Impossible d'enregistrer les paiements." });
  }
});

router.post("/:id/pay-shares", async (req, res) => {
  const surgeryId = String(req.params.id);

  try {
    const { shares } = paySharesSchema.parse(req.body);

    const surgery = await prisma.surgeryCase.findUnique({
      where: { id: surgeryId },
      include: surgeryInclude,
    });

    if (!surgery) {
      return res.status(404).json({ error: "Opération introuvable." });
    }

    if (surgery.status !== SurgeryStatus.COMPLETED) {
      return res.status(409).json({
        error: "Seules les opérations effectuées peuvent être réglées.",
      });
    }

    const data = buildSharePaymentUpdate(surgery, shares as OperationShareKind[], req.user!.id);

    const updated = await prisma.surgeryCase.update({
      where: { id: surgery.id },
      data,
      include: surgeryInclude,
    });

    return res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Parts à régler invalides." });
    }
    const message = mapSharePaymentError(error);
    if (message) {
      return res.status(409).json({ error: message });
    }
    console.error("POST /surgeries/:id/pay-shares failed:", error);
    return res.status(500).json({ error: "Impossible d'enregistrer le paiement." });
  }
});

router.post("/:id/revert", async (req, res) => {
  const surgeryId = String(req.params.id);
  const body = revertSchema.parse(req.body ?? {});

  let scheduledAt: Date | null = null;
  if (body.operationDate) {
    try {
      scheduledAt = parseOperationDateInput(body.operationDate);
    } catch {
      return res.status(400).json({ error: "Date de report invalide." });
    }
  }

  const surgery = await prisma.surgeryCase.findUnique({
    where: { id: surgeryId },
    include: surgeryInclude,
  });

  if (!surgery) {
    return res.status(404).json({ error: "Opération introuvable." });
  }

  if (surgery.status !== SurgeryStatus.COMPLETED) {
    return res.status(409).json({
      error: "Seules les opérations effectuées peuvent être renvoyées en attente.",
    });
  }

  if (hasAnySharePaid(surgery)) {
    return res.status(409).json({
      error: "Impossible de renvoyer en attente : un règlement a déjà été enregistré.",
    });
  }

  try {
    await revertSurgeryToAwaiting(surgery.id, scheduledAt);
  } catch (error) {
    console.error("POST /surgeries/:id/revert failed:", error);
    if (error instanceof Error && error.message === "SURGERY_NOT_REVERTIBLE") {
      return res.status(409).json({
        error: "Seules les opérations effectuées peuvent être renvoyées en attente.",
      });
    }
    return res.status(409).json({
      error:
        "Impossible de renvoyer cette opération en attente. Redémarrez le serveur backend si le problème persiste.",
    });
  }

  const updated = await prisma.surgeryCase.findUniqueOrThrow({
    where: { id: surgery.id },
    include: surgeryInclude,
  });

  return res.json(updated);
});

export default router;
