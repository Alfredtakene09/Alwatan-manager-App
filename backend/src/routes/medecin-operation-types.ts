import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { InterventionCategory } from "@prisma/client";
import { prisma } from "../lib/db.js";
import {
  interventionVisibleForServicesWhere,
  resolveDoctorClinicServices,
} from "../lib/clinic-service-exam.js";
import { clinicPercentFromSplits, validateInterventionPercents } from "../lib/intervention-splits.js";
import { findDuplicateIntervention } from "../lib/duplicate-detection.js";
import { duplicateErrorResponse } from "../lib/duplicate-error.js";
import { selectableDoctorByIdWhere, selectableDoctorWhere } from "../lib/doctor-compensation.js";
import {
  authorizedSurgeonsInclude,
  resolveAuthorizedSurgeonIds,
  serializeAuthorizedSurgeons,
  syncInterventionAuthorizedSurgeons,
} from "../lib/intervention-authorized-surgeons.js";
import { requireAuth, requireModule } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth, requireModule("consultation"));

const interventionInclude = {
  surgeon: { select: { id: true, firstName: true, lastName: true } },
  anesthesiologist: { select: { id: true, firstName: true, lastName: true } },
  clinicService: { select: { id: true, name: true } },
  ...authorizedSurgeonsInclude,
};

const interventionBaseSchema = z.object({
  code: z.string().min(2).optional(),
  label: z.string().min(2),
  category: z.nativeEnum(InterventionCategory).optional().default(InterventionCategory.MOYENNE_B),
  totalCostFcfa: z.number().int().positive(),
  surgeonPercent: z.number().int().min(1).max(99),
  anesthesiologistPercent: z.number().int().min(0).max(99).default(0),
  surgeonName: z.string().max(120).optional().nullable(),
  anesthesiologistName: z.string().max(120).optional().nullable(),
  anesthesiologistId: z.preprocess(
    (v) => (v === "" || v === undefined ? null : v),
    z.string().min(1).nullable().optional(),
  ),
  /** Chirurgiens autorisés (User ids) — le créateur est toujours inclus côté serveur. */
  surgeonIds: z.array(z.string().min(1)).optional(),
  active: z.boolean().optional(),
});

function resolveAssistantFields(body: {
  anesthesiologistId?: string | null;
  anesthesiologistName?: string | null;
}) {
  const id = body.anesthesiologistId?.trim() || null;
  const name = body.anesthesiologistName?.trim() || null;
  if (id) return { anesthesiologistId: id, anesthesiologistName: null as string | null };
  return { anesthesiologistId: null as string | null, anesthesiologistName: name };
}

function generateInterventionCode(label: string) {
  const slug = label
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 18);
  return `OP-${slug || "INTERVENTION"}-${Date.now().toString(36).toUpperCase()}`;
}

function serializeIntervention(item: {
  id: string;
  code: string;
  label: string;
  category: InterventionCategory;
  totalCostFcfa: number;
  surgeonPercent: number;
  anesthesiologistPercent: number;
  surgeonId: string | null;
  surgeonName: string | null;
  anesthesiologistId: string | null;
  anesthesiologistName: string | null;
  clinicServiceId?: string | null;
  active: boolean;
  surgeon: { id: string; firstName: string; lastName: string } | null;
  anesthesiologist: { id: string; firstName: string; lastName: string } | null;
  clinicService?: { id: string; name: string } | null;
  authorizedSurgeons?: Array<{
    userId: string;
    user: { id: string; firstName: string; lastName: string };
  }>;
}) {
  const { authorizedSurgeons, ...rest } = item;
  const surgeons = serializeAuthorizedSurgeons(authorizedSurgeons);
  return {
    ...rest,
    clinicPercent: clinicPercentFromSplits(item.surgeonPercent, item.anesthesiologistPercent),
    authorizedSurgeons: surgeons,
    surgeonIds: surgeons.map((d) => d.id),
  };
}

const interventionSchema = interventionBaseSchema.superRefine((body, ctx) => {
  const error = validateInterventionPercents(body.surgeonPercent, body.anesthesiologistPercent);
  if (error) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: error });
  }
  if (body.anesthesiologistPercent > 0) {
    const hasId = Boolean(body.anesthesiologistId?.trim());
    const name = body.anesthesiologistName?.trim() || "";
    if (!hasId && name.length < 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Liez un médecin ou saisissez le nom de l'assistant chirurgie (2 caractères min.).",
      });
    }
  }
});

const interventionUpdateSchema = interventionBaseSchema.partial().superRefine((body, ctx) => {
  if (
    body.surgeonPercent === undefined &&
    body.anesthesiologistPercent === undefined &&
    body.anesthesiologistId === undefined &&
    body.anesthesiologistName === undefined
  ) {
    return;
  }
  const surgeonPercent = body.surgeonPercent ?? 0;
  const anesthesiologistPercent = body.anesthesiologistPercent ?? 0;
  if (body.surgeonPercent !== undefined || body.anesthesiologistPercent !== undefined) {
    const error = validateInterventionPercents(
      surgeonPercent > 0 ? surgeonPercent : 1,
      anesthesiologistPercent,
    );
    if (error && body.surgeonPercent !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: error });
    }
  }
  if (body.anesthesiologistPercent !== undefined && body.anesthesiologistPercent > 0) {
    const hasId = Boolean(body.anesthesiologistId?.trim());
    const name = body.anesthesiologistName?.trim() || "";
    if (!hasId && name.length < 2 && body.anesthesiologistName !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Liez un médecin ou saisissez le nom de l'assistant chirurgie (2 caractères min.).",
      });
    }
  }
});

async function requireDoctorService(req: Request, res: Response) {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: "Non autorisé" });
    return null;
  }
  const services = await resolveDoctorClinicServices(userId);
  if (!services) {
    res.status(400).json({
      error:
        "Aucun service clinique n'est associé à votre compte. Contactez l'administration.",
    });
    return null;
  }
  return { userId, service: services.default, ids: services.ids };
}

router.get("/me", async (req, res) => {
  const ctx = await requireDoctorService(req, res);
  if (!ctx) return;
  return res.json({
    clinicServiceId: ctx.service.id,
    clinicServiceName: ctx.service.name,
    clinicServiceIds: ctx.ids,
  });
});

router.get("/doctors", async (_req, res) => {
  const doctors = await prisma.user.findMany({
    where: selectableDoctorWhere,
    select: { id: true, firstName: true, lastName: true },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });
  return res.json(doctors);
});

/** Médecins du même service (avec compte User) pour cocher les chirurgiens autorisés. */
router.get("/service-doctors", async (req, res) => {
  const ctx = await requireDoctorService(req, res);
  if (!ctx) return;

  const links = await prisma.clinicServiceDoctor.findMany({
    where: {
      clinicServiceId: { in: ctx.ids },
      employee: {
        isMedecin: true,
        active: true,
        user: { isNot: null },
      },
    },
    select: {
      employee: {
        select: {
          user: { select: { id: true } },
        },
      },
    },
  });

  const userIds = [
    ...new Set(
      links
        .map((link) => link.employee.user?.id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  if (!userIds.length) return res.json([]);

  const doctors = await prisma.user.findMany({
    where: { id: { in: userIds }, ...selectableDoctorWhere },
    select: { id: true, firstName: true, lastName: true },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });
  return res.json(doctors);
});

router.get("/", async (req, res) => {
  const ctx = await requireDoctorService(req, res);
  if (!ctx) return;

  const items = await prisma.interventionType.findMany({
    where: interventionVisibleForServicesWhere(ctx.ids, { doctorUserId: ctx.userId }),
    include: interventionInclude,
    orderBy: [{ label: "asc" }, { category: "asc" }],
  });
  return res.json(items.map(serializeIntervention));
});

router.post("/", async (req, res) => {
  const ctx = await requireDoctorService(req, res);
  if (!ctx) return;

  try {
    const body = interventionSchema.parse(req.body);
    const code = body.code?.trim() || generateInterventionCode(body.label);
    const duplicate = await findDuplicateIntervention({
      code,
      label: body.label,
      category: body.category,
    });
    if (duplicate) {
      return res.status(409).json(
        duplicateErrorResponse(
          "intervention",
          "Une opération avec ce libellé existe déjà dans la nomenclature.",
          {
            code: duplicate.code,
            label: duplicate.label,
            category: duplicate.category,
            totalCostFcfa: duplicate.totalCostFcfa,
          },
        ),
      );
    }

    const assistant =
      body.anesthesiologistPercent > 0
        ? resolveAssistantFields(body)
        : { anesthesiologistId: null, anesthesiologistName: null };

    if (assistant.anesthesiologistId) {
      const doctor = await prisma.user.findFirst({
        where: selectableDoctorByIdWhere(assistant.anesthesiologistId),
        select: { id: true },
      });
      if (!doctor) {
        return res.status(400).json({ error: "Assistant chirurgie introuvable." });
      }
    }

    const surgeonIds = await resolveAuthorizedSurgeonIds(body.surgeonIds, {
      alwaysInclude: ctx.userId,
    });

    const item = await prisma.interventionType.create({
      data: {
        code,
        label: body.label.trim(),
        category: body.category,
        totalCostFcfa: body.totalCostFcfa,
        surgeonPercent: body.surgeonPercent,
        anesthesiologistPercent: body.anesthesiologistPercent,
        clinicServiceId: ctx.service.id,
        surgeonId: ctx.userId,
        surgeonName: null,
        ...assistant,
        active: body.active ?? true,
      },
      include: interventionInclude,
    });

    await syncInterventionAuthorizedSurgeons(item.id, surgeonIds);
    const refreshed = await prisma.interventionType.findUniqueOrThrow({
      where: { id: item.id },
      include: interventionInclude,
    });
    return res.status(201).json(serializeIntervention(refreshed));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.issues[0]?.message ?? "Données invalides" });
    }
    return res.status(400).json({ error: "Données invalides" });
  }
});

router.put("/:id", async (req, res) => {
  const ctx = await requireDoctorService(req, res);
  if (!ctx) return;

  try {
    const body = interventionUpdateSchema.parse(req.body);
    const existing = await prisma.interventionType.findFirst({
      where: {
        id: String(req.params.id),
        ...interventionVisibleForServicesWhere(ctx.ids, { doctorUserId: ctx.userId }),
      },
    });
    if (!existing) return res.status(404).json({ error: "Opération introuvable" });

    if (body.code !== undefined || body.label !== undefined) {
      const duplicate = await findDuplicateIntervention({
        code: body.code ?? existing.code,
        label: body.label ?? existing.label,
        category: body.category ?? existing.category,
        excludeId: existing.id,
      });
      if (duplicate) {
        return res.status(409).json(
          duplicateErrorResponse(
            "intervention",
            "Une opération avec ce libellé existe déjà dans la nomenclature.",
            {
              code: duplicate.code,
              label: duplicate.label,
              category: duplicate.category,
              totalCostFcfa: duplicate.totalCostFcfa,
            },
          ),
        );
      }
    }

    const nextAssistantPercent =
      body.anesthesiologistPercent !== undefined
        ? body.anesthesiologistPercent
        : existing.anesthesiologistPercent;
    const nextSurgeonPercent =
      body.surgeonPercent !== undefined ? body.surgeonPercent : existing.surgeonPercent;
    const percentError = validateInterventionPercents(nextSurgeonPercent, nextAssistantPercent);
    if (percentError) {
      return res.status(400).json({ error: percentError });
    }

    let assistantData:
      | { anesthesiologistId: string | null; anesthesiologistName: string | null }
      | undefined;
    if (
      body.anesthesiologistPercent !== undefined ||
      body.anesthesiologistId !== undefined ||
      body.anesthesiologistName !== undefined
    ) {
      if (nextAssistantPercent <= 0) {
        assistantData = { anesthesiologistId: null, anesthesiologistName: null };
      } else {
        assistantData = resolveAssistantFields({
          anesthesiologistId:
            body.anesthesiologistId !== undefined
              ? body.anesthesiologistId
              : existing.anesthesiologistId,
          anesthesiologistName:
            body.anesthesiologistName !== undefined
              ? body.anesthesiologistName
              : existing.anesthesiologistName,
        });
        if (
          !assistantData.anesthesiologistId &&
          !(assistantData.anesthesiologistName && assistantData.anesthesiologistName.length >= 2)
        ) {
          return res.status(400).json({
            error: "Liez un médecin ou saisissez le nom de l'assistant chirurgie (2 caractères min.).",
          });
        }
        if (assistantData.anesthesiologistId) {
          const doctor = await prisma.user.findFirst({
            where: selectableDoctorByIdWhere(assistantData.anesthesiologistId),
            select: { id: true },
          });
          if (!doctor) {
            return res.status(400).json({ error: "Assistant chirurgie introuvable." });
          }
        }
      }
    }

    await prisma.interventionType.update({
      where: { id: existing.id },
      data: {
        ...(body.code !== undefined ? { code: body.code } : {}),
        ...(body.label !== undefined ? { label: body.label.trim() } : {}),
        ...(body.category !== undefined ? { category: body.category } : {}),
        ...(body.totalCostFcfa !== undefined ? { totalCostFcfa: body.totalCostFcfa } : {}),
        ...(body.surgeonPercent !== undefined ? { surgeonPercent: body.surgeonPercent } : {}),
        ...(body.anesthesiologistPercent !== undefined
          ? { anesthesiologistPercent: body.anesthesiologistPercent }
          : {}),
        ...(assistantData ?? {}),
        ...(body.active !== undefined ? { active: body.active } : {}),
        surgeonId: existing.surgeonId ?? ctx.userId,
      },
    });

    if (body.surgeonIds !== undefined) {
      const surgeonIds = await resolveAuthorizedSurgeonIds(body.surgeonIds, {
        alwaysInclude: existing.surgeonId ?? ctx.userId,
      });
      await syncInterventionAuthorizedSurgeons(existing.id, surgeonIds);
    }

    const item = await prisma.interventionType.findUniqueOrThrow({
      where: { id: existing.id },
      include: interventionInclude,
    });
    return res.json(serializeIntervention(item));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.issues[0]?.message ?? "Mise à jour impossible" });
    }
    return res.status(400).json({ error: "Mise à jour impossible" });
  }
});

router.delete("/:id", async (req, res) => {
  const ctx = await requireDoctorService(req, res);
  if (!ctx) return;

  try {
    const existing = await prisma.interventionType.findFirst({
      where: {
        id: String(req.params.id),
        ...interventionVisibleForServicesWhere(ctx.ids, { doctorUserId: ctx.userId }),
      },
      select: { id: true },
    });
    if (!existing) return res.status(404).json({ error: "Opération introuvable" });

    const usedCount = await prisma.surgeryCase.count({
      where: { interventionTypeId: existing.id },
    });
    if (usedCount > 0) {
      return res.status(409).json({
        error: "Cette opération a déjà été utilisée. Désactivez-la plutôt que de la supprimer.",
      });
    }

    await prisma.interventionType.delete({ where: { id: existing.id } });
    return res.json({ ok: true });
  } catch {
    return res.status(400).json({ error: "Suppression impossible" });
  }
});

export default router;
