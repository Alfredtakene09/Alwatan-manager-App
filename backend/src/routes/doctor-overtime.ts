import { Router } from "express";
import { z } from "zod";
import { DoctorOvertimeStatus, UserRole } from "@prisma/client";
import { prisma } from "../lib/db.js";
import { requireAuth, requireAnyModule } from "../middleware/auth.js";
import { DIRECTION_GESTIONNAIRE_ROLES } from "../lib/roles.js";
import {
  computeOvertimeAmountFcfa,
  doctorOvertimeInclude,
  minutesBetweenTimes,
  serializeDoctorOvertime,
} from "../lib/doctor-overtime.js";

const router = Router();

const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;

const submitSchema = z.object({
  employeeId: z.string().min(1).optional(),
  businessDate: z.string().min(8),
  startTime: z.string().regex(timeRegex).optional().nullable(),
  endTime: z.string().regex(timeRegex).optional().nullable(),
  hours: z.number().positive().max(24).optional(),
  minutesWorked: z.number().int().positive().max(24 * 60).optional(),
  comment: z.string().max(500).optional().nullable(),
  hourlyRateFcfa: z.number().int().positive().optional().nullable(),
});

const rejectSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

const validateSchema = z.object({
  hourlyRateFcfa: z.number().int().positive().optional().nullable(),
});

function parseBusinessDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function resolveMinutes(body: z.infer<typeof submitSchema>): number | null {
  if (body.minutesWorked != null && body.minutesWorked > 0) return body.minutesWorked;
  if (body.hours != null && body.hours > 0) return Math.round(body.hours * 60);
  if (body.startTime && body.endTime) return minutesBetweenTimes(body.startTime, body.endTime);
  return null;
}

async function resolveUserEmployeeId(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { employeeId: true },
  });
  return user?.employeeId ?? null;
}

router.use(requireAuth);

/** Médecin : ses propres saisies. Direction/gestionnaire : toutes. */
router.get("/mine", async (req, res) => {
  const user = req.user!;
  const employeeId = await resolveUserEmployeeId(user.id);
  if (!employeeId) {
    return res.status(400).json({ error: "Aucun employé lié au compte." });
  }
  const rows = await prisma.doctorOvertimeEntry.findMany({
    where: { employeeId },
    include: doctorOvertimeInclude,
    orderBy: [{ businessDate: "desc" }, { createdAt: "desc" }],
    take: 100,
  });
  return res.json(rows.map(serializeDoctorOvertime));
});

router.get(
  "/",
  requireAnyModule("gestionnaire", "admin"),
  async (req, res) => {
    const statusParam = typeof req.query.status === "string" ? req.query.status : undefined;
    const status =
      statusParam &&
      ["PENDING", "VALIDATED", "REJECTED", "PAID", "CANCELLED"].includes(statusParam)
        ? (statusParam as DoctorOvertimeStatus)
        : undefined;
    const employeeId =
      typeof req.query.employeeId === "string" ? req.query.employeeId.trim() : undefined;

    const rows = await prisma.doctorOvertimeEntry.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(employeeId ? { employeeId } : {}),
      },
      include: doctorOvertimeInclude,
      orderBy: [{ status: "asc" }, { businessDate: "desc" }, { createdAt: "desc" }],
      take: 300,
    });
    return res.json(rows.map(serializeDoctorOvertime));
  },
);

router.post("/", async (req, res) => {
  const user = req.user!;
  try {
    const body = submitSchema.parse(req.body);
    const businessDate = parseBusinessDate(body.businessDate);
    if (!businessDate) {
      return res.status(400).json({ error: "Date invalide (AAAA-MM-JJ)." });
    }

    const minutesWorked = resolveMinutes(body);
    if (minutesWorked == null || minutesWorked <= 0) {
      return res.status(400).json({
        error: "Indiquez la durée (heures) ou un créneau début/fin valide.",
      });
    }

    const isManager = DIRECTION_GESTIONNAIRE_ROLES.includes(
      user.role as (typeof DIRECTION_GESTIONNAIRE_ROLES)[number],
    );
    let employeeId = body.employeeId?.trim() || null;

    if (user.role === UserRole.MEDECIN) {
      const linkedEmployeeId = await resolveUserEmployeeId(user.id);
      if (!linkedEmployeeId) {
        return res.status(400).json({ error: "Aucun employé lié au compte médecin." });
      }
      employeeId = linkedEmployeeId;
    } else if (!isManager) {
      return res.status(403).json({ error: "Accès refusé." });
    } else if (!employeeId) {
      return res.status(400).json({ error: "Médecin requis." });
    }

    const employee = await prisma.employee.findFirst({
      where: { id: employeeId!, active: true, isMedecin: true },
      select: { id: true, overtimeHourlyRateFcfa: true },
    });
    if (!employee) {
      return res.status(400).json({ error: "Médecin introuvable ou inactif." });
    }

    const hourlyRateFcfa =
      (body.hourlyRateFcfa != null && body.hourlyRateFcfa > 0
        ? body.hourlyRateFcfa
        : employee.overtimeHourlyRateFcfa) ?? 0;

    const created = await prisma.doctorOvertimeEntry.create({
      data: {
        employeeId: employee.id,
        businessDate,
        startTime: body.startTime?.trim() || null,
        endTime: body.endTime?.trim() || null,
        minutesWorked,
        hourlyRateFcfa,
        // Montant calculé à la validation gestionnaire (0 tant que PENDING)
        amountFcfa: 0,
        comment: body.comment?.trim() || null,
        status: DoctorOvertimeStatus.PENDING,
        recordedById: user.id,
      },
      include: doctorOvertimeInclude,
    });

    return res.status(201).json(serializeDoctorOvertime(created));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Données invalides.", details: error.flatten() });
    }
    throw error;
  }
});

router.patch(
  "/:id/validate",
  requireAnyModule("gestionnaire", "admin"),
  async (req, res) => {
    const user = req.user!;
    try {
      const body = validateSchema.parse(req.body ?? {});
      const row = await prisma.doctorOvertimeEntry.findUnique({
        where: { id: String(req.params.id) },
        include: { employee: { select: { overtimeHourlyRateFcfa: true } } },
      });
      if (!row) return res.status(404).json({ error: "Saisie introuvable." });
      if (row.status !== DoctorOvertimeStatus.PENDING) {
        return res.status(409).json({ error: "Saisie non validable." });
      }

      const hourlyRateFcfa =
        (body.hourlyRateFcfa != null && body.hourlyRateFcfa > 0
          ? body.hourlyRateFcfa
          : row.hourlyRateFcfa > 0
            ? row.hourlyRateFcfa
            : row.employee.overtimeHourlyRateFcfa) ?? 0;

      if (hourlyRateFcfa <= 0) {
        return res.status(400).json({
          error:
            "Définissez le taux horaire HS sur la fiche médecin, ou saisissez-le à la validation.",
        });
      }

      const amountFcfa = computeOvertimeAmountFcfa(row.minutesWorked, hourlyRateFcfa);
      const updated = await prisma.doctorOvertimeEntry.update({
        where: { id: row.id },
        data: {
          status: DoctorOvertimeStatus.VALIDATED,
          hourlyRateFcfa,
          amountFcfa,
          validatedById: user.id,
          validatedAt: new Date(),
          rejectionReason: null,
        },
        include: doctorOvertimeInclude,
      });
      return res.json(serializeDoctorOvertime(updated));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Données invalides." });
      }
      throw error;
    }
  },
);

router.patch(
  "/:id/reject",
  requireAnyModule("gestionnaire", "admin"),
  async (req, res) => {
    const user = req.user!;
    try {
      const body = rejectSchema.parse(req.body ?? {});
      const row = await prisma.doctorOvertimeEntry.findUnique({
        where: { id: String(req.params.id) },
      });
      if (!row) return res.status(404).json({ error: "Saisie introuvable." });
      if (row.status !== DoctorOvertimeStatus.PENDING) {
        return res.status(409).json({ error: "Saisie non modifiable." });
      }
      const updated = await prisma.doctorOvertimeEntry.update({
        where: { id: row.id },
        data: {
          status: DoctorOvertimeStatus.REJECTED,
          rejectionReason: body.reason,
          validatedById: user.id,
          validatedAt: new Date(),
          amountFcfa: 0,
        },
        include: doctorOvertimeInclude,
      });
      return res.json(serializeDoctorOvertime(updated));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Justification requise (3 caractères min.)." });
      }
      throw error;
    }
  },
);

router.patch(
  "/:id/cancel",
  async (req, res) => {
    const user = req.user!;
    const row = await prisma.doctorOvertimeEntry.findUnique({
      where: { id: String(req.params.id) },
    });
    if (!row) return res.status(404).json({ error: "Saisie introuvable." });
    if (row.status !== DoctorOvertimeStatus.PENDING) {
      return res.status(409).json({ error: "Seule une saisie en attente peut être annulée." });
    }

    const isManager = DIRECTION_GESTIONNAIRE_ROLES.includes(
      user.role as (typeof DIRECTION_GESTIONNAIRE_ROLES)[number],
    );
    const linkedEmployeeId = await resolveUserEmployeeId(user.id);
    const isOwner = linkedEmployeeId === row.employeeId || user.id === row.recordedById;
    if (!isManager && !isOwner) {
      return res.status(403).json({ error: "Accès refusé." });
    }

    const updated = await prisma.doctorOvertimeEntry.update({
      where: { id: row.id },
      data: { status: DoctorOvertimeStatus.CANCELLED },
      include: doctorOvertimeInclude,
    });
    return res.json(serializeDoctorOvertime(updated));
  },
);

/** Paiement direct des HS validées (hors fiche de paie mensuelle). */
router.post(
  "/:id/pay",
  requireAnyModule("gestionnaire", "admin"),
  async (req, res) => {
    const user = req.user!;
    const row = await prisma.doctorOvertimeEntry.findUnique({
      where: { id: String(req.params.id) },
    });
    if (!row) return res.status(404).json({ error: "Saisie introuvable." });
    if (row.status !== DoctorOvertimeStatus.VALIDATED) {
      return res.status(409).json({ error: "Seules les HS validées peuvent être payées." });
    }
    const now = new Date();
    const updated = await prisma.doctorOvertimeEntry.update({
      where: { id: row.id },
      data: {
        status: DoctorOvertimeStatus.PAID,
        paidAt: now,
        paidById: user.id,
        payrollYear: now.getFullYear(),
        payrollMonth: now.getMonth() + 1,
      },
      include: doctorOvertimeInclude,
    });
    return res.json(serializeDoctorOvertime(updated));
  },
);

export default router;
