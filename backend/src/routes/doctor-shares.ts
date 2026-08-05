import { Router } from "express";
import { z } from "zod";
import {
  DoctorShareClaimStatus,
  DoctorShareKind,
  SharePaymentMethod,
  UserRole,
} from "@prisma/client";
import { prisma } from "../lib/db.js";
import {
  buildDoctorReceivable,
  buildReceivablesOverview,
  listDoctorsWithPercentShares,
  periodBounds,
  requestPayrollForItems,
  settleConsultationCash,
} from "../lib/doctor-share-claims.js";
import { buildSharePaymentUpdate } from "../lib/surgery-share-payments.js";
import { requireAuth, requireAnyModule } from "../middleware/auth.js";
import { DIRECTION_GESTIONNAIRE_ROLES } from "../lib/roles.js";

const router = Router();
router.use(requireAuth);

function requireDirection(
  req: import("express").Request,
  res: import("express").Response,
  next: import("express").NextFunction,
) {
  if (!req.user || !DIRECTION_GESTIONNAIRE_ROLES.includes(req.user.role as never)) {
    return res.status(403).json({ error: "Accès réservé à la direction / gestion." });
  }
  next();
}

const periodQuerySchema = z.object({
  period: z.enum(["day", "month"]).default("month"),
  day: z.string().optional(),
  month: z.string().optional(),
  doctorId: z.string().optional(),
});

function parsePeriod(query: z.infer<typeof periodQuerySchema>) {
  if (query.period === "day") return periodBounds("day", query.day);
  return periodBounds("month", query.month);
}

router.get("/doctors", requireDirection, async (_req, res) => {
  const doctors = await listDoctorsWithPercentShares();
  return res.json(doctors);
});

router.get("/receivable", async (req, res) => {
  try {
    const query = periodQuerySchema.parse(req.query);
    const period = parsePeriod(query);
    const user = req.user!;
    const isManager =
      DIRECTION_GESTIONNAIRE_ROLES.includes(user.role as never) ||
      user.role === UserRole.COMPTABLE;

    if (isManager) {
      const overview = await buildReceivablesOverview(period, query.doctorId || null);
      return res.json(overview);
    }

    const mine = await buildDoctorReceivable(user.id, period);
    return res.json({
      period: period.label,
      from: period.from.toISOString(),
      to: period.to.toISOString(),
      totals: {
        consultationShareFcfa: mine.consultationShareFcfa,
        surgeryShareFcfa: mine.surgeryShareFcfa,
        totalShareFcfa: mine.totalShareFcfa,
        pendingPayrollFcfa: mine.pendingPayrollFcfa,
      },
      doctors: [
        {
          id: mine.doctorId,
          firstName: mine.firstName,
          lastName: mine.lastName,
          hasConsultationQuota: mine.hasConsultationQuota,
          canAddToSalary: mine.canAddToSalary,
          consultationShareFcfa: mine.consultationShareFcfa,
          surgeryShareFcfa: mine.surgeryShareFcfa,
          totalShareFcfa: mine.totalShareFcfa,
          pendingPayrollFcfa: mine.pendingPayrollFcfa,
          items: mine.items,
        },
      ],
      selectedDoctorId: mine.doctorId,
      me: mine,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Paramètres invalides." });
    }
    console.error("GET /doctor-shares/receivable failed:", error);
    return res.status(500).json({ error: "Erreur serveur." });
  }
});

const requestPayrollSchema = z.object({
  items: z
    .array(
      z.object({
        kind: z.nativeEnum(DoctorShareKind),
        amountFcfa: z.number().int().positive(),
        businessDate: z.string().min(8),
        surgeryCaseId: z.string().optional(),
        invoiceId: z.string().optional(),
        comment: z.string().max(300).optional(),
      }),
    )
    .min(1)
    .max(200),
});

/** Médecin salarié : demande d'ajout au salaire (consult. et/ou opérations). */
router.post("/request-payroll", async (req, res) => {
  try {
    const body = requestPayrollSchema.parse(req.body);
    const user = req.user!;
    const created = await prisma.$transaction((tx) =>
      requestPayrollForItems(tx, {
        doctorUserId: user.id,
        requestedById: user.id,
        items: body.items,
      }),
    );
    return res.status(201).json({ count: created.length, claims: created });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Données invalides." });
    }
    if (error instanceof Error) {
      if (error.message === "NOT_SALARIED") {
        return res.status(400).json({
          error: "Seul un médecin salarié (ou combiné) peut ajouter des parts au salaire.",
        });
      }
      if (error.message === "DOCTOR_NOT_FOUND") {
        return res.status(404).json({ error: "Médecin introuvable." });
      }
      if (error.message.includes("Unique constraint")) {
        return res.status(409).json({
          error: "Une de ces parts est déjà demandée ou réglée.",
        });
      }
    }
    console.error("POST /doctor-shares/request-payroll failed:", error);
    return res.status(500).json({ error: "Erreur serveur." });
  }
});

const settleConsultCashSchema = z.object({
  items: z
    .array(
      z.object({
        invoiceId: z.string().min(1),
        amountFcfa: z.number().int().positive(),
        businessDate: z.string().min(8),
        doctorUserId: z.string().min(1),
      }),
    )
    .min(1)
    .max(200),
});

/** Admin / gestionnaire : règlement espèces des parts consultation. */
router.post("/settle-consultations-cash", requireDirection, async (req, res) => {
  try {
    const body = settleConsultCashSchema.parse(req.body);
    const created = await prisma.$transaction((tx) =>
      settleConsultationCash(tx, {
        settledById: req.user!.id,
        items: body.items,
      }),
    );
    return res.status(201).json({ count: created.length });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Données invalides." });
    }
    if (error instanceof Error && error.message.includes("Unique constraint")) {
      return res.status(409).json({ error: "Certaines consultations sont déjà réglées." });
    }
    console.error("POST /doctor-shares/settle-consultations-cash failed:", error);
    return res.status(500).json({ error: "Erreur serveur." });
  }
});

const settleSurgeryCashSchema = z.object({
  surgeryId: z.string().min(1),
  shares: z.array(z.enum(["surgeon", "assistant", "clinic"])).min(1).max(3),
});

/** Règlement espèces d'une opération (distinct des consultations). */
router.post(
  "/settle-surgery-cash",
  requireAnyModule("comptabilite", "admin", "gestionnaire"),
  async (req, res) => {
    try {
      const body = settleSurgeryCashSchema.parse(req.body);
      const surgery = await prisma.surgeryCase.findUnique({
        where: { id: body.surgeryId },
        include: { interventionType: true },
      });
      if (!surgery) return res.status(404).json({ error: "Opération introuvable." });

      const now = new Date();
      const data = {
        ...buildSharePaymentUpdate(surgery, body.shares, req.user!.id, now),
        ...(body.shares.includes("surgeon")
          ? { surgeonPaidMethod: SharePaymentMethod.CASH }
          : {}),
        ...(body.shares.includes("assistant")
          ? { assistantPaidMethod: SharePaymentMethod.CASH }
          : {}),
        ...(body.shares.includes("clinic")
          ? { clinicPaidMethod: SharePaymentMethod.CASH }
          : {}),
      };

      const updated = await prisma.$transaction(async (tx) => {
        const row = await tx.surgeryCase.update({
          where: { id: surgery.id },
          data,
        });
        const kinds: DoctorShareKind[] = [];
        if (body.shares.includes("surgeon")) kinds.push(DoctorShareKind.OPERATION_SURGEON);
        if (body.shares.includes("assistant")) kinds.push(DoctorShareKind.OPERATION_ASSISTANT);
        if (kinds.length) {
          await tx.doctorShareClaim.updateMany({
            where: {
              surgeryCaseId: surgery.id,
              kind: { in: kinds },
              status: DoctorShareClaimStatus.PENDING_PAYROLL,
            },
            data: {
              status: DoctorShareClaimStatus.CANCELLED,
              settledAt: now,
              settledById: req.user!.id,
            },
          });
        }
        return row;
      });

      return res.json(updated);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Données invalides." });
      }
      if (error instanceof Error && error.message === "SHARE_ALREADY_PAID") {
        return res.status(409).json({ error: "Une ou plusieurs parts sont déjà réglées." });
      }
      console.error("POST /doctor-shares/settle-surgery-cash failed:", error);
      return res.status(500).json({ error: "Erreur serveur." });
    }
  },
);

router.post("/:id/reject", requireDirection, async (req, res) => {
  const claimId = String(req.params.id);
  const claim = await prisma.doctorShareClaim.findUnique({ where: { id: claimId } });
  if (!claim) return res.status(404).json({ error: "Demande introuvable." });
  if (claim.status !== DoctorShareClaimStatus.PENDING_PAYROLL) {
    return res.status(409).json({ error: "Cette demande n’est plus en attente." });
  }
  const reason =
    typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 300) : null;
  const updated = await prisma.doctorShareClaim.update({
    where: { id: claim.id },
    data: {
      status: DoctorShareClaimStatus.REJECTED,
      rejectionReason: reason,
      settledById: req.user!.id,
      settledAt: new Date(),
    },
  });
  return res.json(updated);
});

export default router;
