import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { InterventionCategory } from "@prisma/client";
import { prisma } from "../lib/db.js";
import { resolveDoctorClinicServices } from "../lib/clinic-service-exam.js";
import { clinicPercentFromSplits, validateInterventionPercents } from "../lib/intervention-splits.js";
import { findDuplicateIntervention } from "../lib/duplicate-detection.js";
import { duplicateErrorResponse } from "../lib/duplicate-error.js";
import { requireAuth, requireModule } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth, requireModule("consultation"));

const interventionInclude = {
  surgeon: { select: { id: true, firstName: true, lastName: true } },
  anesthesiologist: { select: { id: true, firstName: true, lastName: true } },
  clinicService: { select: { id: true, name: true } },
} as const;

const interventionBaseSchema = z.object({
  code: z.string().min(2).optional(),
  label: z.string().min(2),
  category: z.nativeEnum(InterventionCategory).optional().default(InterventionCategory.MOYENNE_B),
  totalCostFcfa: z.number().int().positive(),
  surgeonPercent: z.number().int().min(1).max(99),
  anesthesiologistPercent: z.number().int().min(0).max(99).default(0),
  surgeonName: z.string().max(120).optional().nullable(),
  anesthesiologistName: z.string().max(120).optional().nullable(),
  active: z.boolean().optional(),
});

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
}) {
  return {
    ...item,
    clinicPercent: clinicPercentFromSplits(item.surgeonPercent, item.anesthesiologistPercent),
  };
}

const interventionSchema = interventionBaseSchema.superRefine((body, ctx) => {
  const error = validateInterventionPercents(body.surgeonPercent, body.anesthesiologistPercent);
  if (error) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: error });
  }
  if (body.anesthesiologistPercent > 0) {
    const name = body.anesthesiologistName?.trim() || "";
    if (name.length < 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Saisissez le nom de l'assistant chirurgie (2 caractères min.).",
      });
    }
  }
});

const interventionUpdateSchema = interventionBaseSchema.partial().superRefine((body, ctx) => {
  if (body.surgeonPercent === undefined && body.anesthesiologistPercent === undefined) return;
  const surgeonPercent = body.surgeonPercent ?? 0;
  const anesthesiologistPercent = body.anesthesiologistPercent ?? 0;
  const error = validateInterventionPercents(
    surgeonPercent > 0 ? surgeonPercent : 1,
    anesthesiologistPercent,
  );
  if (error && body.surgeonPercent !== undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: error });
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

router.get("/", async (req, res) => {
  const ctx = await requireDoctorService(req, res);
  if (!ctx) return;

  const items = await prisma.interventionType.findMany({
    where: { clinicServiceId: { in: ctx.ids } },
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

    const assistantName =
      body.anesthesiologistPercent > 0 ? body.anesthesiologistName?.trim() || null : null;

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
        anesthesiologistId: null,
        anesthesiologistName: assistantName,
        active: body.active ?? true,
      },
      include: interventionInclude,
    });
    return res.status(201).json(serializeIntervention(item));
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
      where: { id: String(req.params.id), clinicServiceId: { in: ctx.ids } },
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

    const item = await prisma.interventionType.update({
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
        ...(body.anesthesiologistName !== undefined || body.anesthesiologistPercent !== undefined
          ? {
              anesthesiologistId: null,
              anesthesiologistName:
                nextAssistantPercent > 0
                  ? (body.anesthesiologistName?.trim() ||
                      existing.anesthesiologistName ||
                      null)
                  : null,
            }
          : {}),
        ...(body.active !== undefined ? { active: body.active } : {}),
        surgeonId: existing.surgeonId ?? ctx.userId,
      },
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
      where: { id: String(req.params.id), clinicServiceId: { in: ctx.ids } },
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
