import { Router } from "express";
import { z } from "zod";
import { ExamCatalogKind, InterventionCategory } from "@prisma/client";
import { prisma } from "../lib/db.js";
import { parseExamCatalogKindSlug } from "../lib/exam-catalog-seed.js";
import { refreshExamPriceCache } from "../lib/lab-exam-prices.js";
import { clinicPercentFromSplits, validateInterventionPercents } from "../lib/intervention-splits.js";
import {
  findDuplicateExamCatalogItem,
  findDuplicateIntervention,
} from "../lib/duplicate-detection.js";
import { duplicateErrorResponse } from "../lib/duplicate-error.js";
import { requireAuth, requireModule } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth, requireModule("comptabilite"));

const catalogItemSchema = z.object({
  code: z.string().min(2).max(64),
  label: z.string().min(2).max(160),
  category: z.string().max(80).optional(),
  priceFcfa: z.number().int().positive(),
  sortOrder: z.number().int().min(0).optional(),
  active: z.boolean().optional(),
});

const interventionBaseSchema = z.object({
  code: z.string().min(2),
  label: z.string().min(2),
  category: z.nativeEnum(InterventionCategory),
  totalCostFcfa: z.number().int().positive(),
  surgeonPercent: z.number().int().min(1).max(99),
  anesthesiologistPercent: z.number().int().min(0).max(99).default(0),
  surgeonName: z.string().max(120).optional().nullable(),
  surgeonId: z.string().min(1).optional().nullable(),
  anesthesiologistName: z.string().max(120).optional().nullable(),
  anesthesiologistId: z.string().min(1).optional().nullable(),
  active: z.boolean().optional(),
});

function resolveStaffFields(body: { id?: string | null; name?: string | null }) {
  const id = body.id?.trim() || null;
  const name = body.name?.trim() || null;
  if (id) {
    return { id, name: null };
  }
  return { id: null, name };
}

function resolveSurgeonFields(body: {
  surgeonId?: string | null;
  surgeonName?: string | null;
}) {
  const { id, name } = resolveStaffFields({
    id: body.surgeonId,
    name: body.surgeonName,
  });
  return { surgeonId: id, surgeonName: name };
}

function resolveAssistantFields(body: {
  anesthesiologistId?: string | null;
  anesthesiologistName?: string | null;
}) {
  const { id, name } = resolveStaffFields({
    id: body.anesthesiologistId,
    name: body.anesthesiologistName,
  });
  return { anesthesiologistId: id, anesthesiologistName: name };
}

const interventionSchema = interventionBaseSchema.superRefine((body, ctx) => {
  const error = validateInterventionPercents(body.surgeonPercent, body.anesthesiologistPercent);
  if (error) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: error });
  }
  const { surgeonId, surgeonName } = resolveSurgeonFields(body);
  if (!surgeonId && !surgeonName) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Sélectionnez un chirurgien ou saisissez son nom.",
    });
  }
  if (surgeonName && surgeonName.length < 2) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Le nom du chirurgien doit contenir au moins 2 caractères.",
    });
  }
  if (body.anesthesiologistPercent > 0) {
    const { anesthesiologistId, anesthesiologistName } = resolveAssistantFields(body);
    if (!anesthesiologistId && !anesthesiologistName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Sélectionnez un assistant chirurgie ou saisissez son nom.",
      });
    }
    if (anesthesiologistName && anesthesiologistName.length < 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Le nom de l'assistant chirurgie doit contenir au moins 2 caractères.",
      });
    }
  }
  if (
    (body.anesthesiologistId || body.anesthesiologistName?.trim()) &&
    body.anesthesiologistPercent <= 0
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Indiquez le pourcentage assistant chirurgie.",
    });
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

const interventionInclude = {
  surgeon: { select: { id: true, firstName: true, lastName: true } },
  anesthesiologist: { select: { id: true, firstName: true, lastName: true } },
} as const;

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
  active: boolean;
  surgeon: { id: string; firstName: string; lastName: string } | null;
  anesthesiologist: { id: string; firstName: string; lastName: string } | null;
}) {
  return {
    ...item,
    clinicPercent: clinicPercentFromSplits(item.surgeonPercent, item.anesthesiologistPercent),
  };
}

router.get("/catalog/:kindSlug", async (req, res) => {
  const kind = parseExamCatalogKindSlug(String(req.params.kindSlug));
  if (!kind) return res.status(400).json({ error: "Type d'examen invalide" });

  const items = await prisma.examCatalogItem.findMany({
    where: { kind },
    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
  });
  return res.json(items);
});

router.post("/catalog/:kindSlug", async (req, res) => {
  const kind = parseExamCatalogKindSlug(String(req.params.kindSlug));
  if (!kind) return res.status(400).json({ error: "Type d'examen invalide" });

  try {
    const body = catalogItemSchema.parse(req.body);

    const duplicate = await findDuplicateExamCatalogItem({
      kind,
      code: body.code,
      label: body.label,
    });
    if (duplicate) {
      return res.status(409).json(
        duplicateErrorResponse(
          "exam_catalog",
          "Un élément de nomenclature avec ce code ou ce libellé existe déjà.",
          {
            code: duplicate.code,
            label: duplicate.label,
            kind: duplicate.kind,
            priceFcfa: duplicate.priceFcfa,
          },
        ),
      );
    }

    const item = await prisma.examCatalogItem.create({
      data: {
        kind,
        code: body.code.trim(),
        label: body.label.trim(),
        category: body.category?.trim() || null,
        priceFcfa: body.priceFcfa,
        sortOrder: body.sortOrder ?? 0,
        active: body.active ?? true,
      },
    });
    await refreshExamPriceCache();
    return res.status(201).json(item);
  } catch {
    return res.status(400).json({ error: "Données invalides ou code déjà utilisé" });
  }
});

router.put("/catalog/:kindSlug/:id", async (req, res) => {
  const kind = parseExamCatalogKindSlug(String(req.params.kindSlug));
  if (!kind) return res.status(400).json({ error: "Type d'examen invalide" });

  try {
    const body = catalogItemSchema.partial().parse(req.body);
    const existing = await prisma.examCatalogItem.findFirst({
      where: { id: String(req.params.id), kind },
    });
    if (!existing) return res.status(404).json({ error: "Élément introuvable" });

    const item = await prisma.examCatalogItem.update({
      where: { id: existing.id },
      data: {
        code: body.code?.trim(),
        label: body.label?.trim(),
        category: body.category === undefined ? undefined : body.category.trim() || null,
        priceFcfa: body.priceFcfa,
        sortOrder: body.sortOrder,
        active: body.active,
      },
    });
    await refreshExamPriceCache();
    return res.json(item);
  } catch {
    return res.status(400).json({ error: "Mise à jour impossible" });
  }
});

router.delete("/catalog/:kindSlug/:id", async (req, res) => {
  const kind = parseExamCatalogKindSlug(String(req.params.kindSlug));
  if (!kind) return res.status(400).json({ error: "Type d'examen invalide" });

  try {
    const existing = await prisma.examCatalogItem.findFirst({
      where: { id: String(req.params.id), kind },
    });
    if (!existing) return res.status(404).json({ error: "Élément introuvable" });

    await prisma.examCatalogItem.delete({ where: { id: existing.id } });
    await refreshExamPriceCache();
    return res.json({ ok: true });
  } catch {
    return res.status(400).json({ error: "Suppression impossible" });
  }
});

router.get("/operations/doctors", async (_req, res) => {
  const doctors = await prisma.user.findMany({
    where: { role: "MEDECIN", active: true },
    select: { id: true, firstName: true, lastName: true },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });
  return res.json(doctors);
});

router.get("/operations", async (_req, res) => {
  const items = await prisma.interventionType.findMany({
    include: interventionInclude,
    orderBy: { category: "asc" },
  });
  return res.json(items.map(serializeIntervention));
});

router.post("/operations", async (req, res) => {
  try {
    const body = interventionSchema.parse(req.body);

    const duplicate = await findDuplicateIntervention({
      code: body.code,
      label: body.label,
      category: body.category,
    });
    if (duplicate) {
      return res.status(409).json(
        duplicateErrorResponse(
          "intervention",
          "Une opération avec ce code ou ce libellé existe déjà dans la nomenclature.",
          {
            code: duplicate.code,
            label: duplicate.label,
            category: duplicate.category,
            totalCostFcfa: duplicate.totalCostFcfa,
          },
        ),
      );
    }

    const surgeon = resolveSurgeonFields(body);
    const assistant =
      body.anesthesiologistPercent > 0
        ? resolveAssistantFields(body)
        : { anesthesiologistId: null, anesthesiologistName: null };
    const item = await prisma.interventionType.create({
      data: {
        code: body.code,
        label: body.label,
        category: body.category,
        totalCostFcfa: body.totalCostFcfa,
        surgeonPercent: body.surgeonPercent,
        anesthesiologistPercent: body.anesthesiologistPercent,
        ...surgeon,
        ...assistant,
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

router.put("/operations/:id", async (req, res) => {
  try {
    const body = interventionUpdateSchema.parse(req.body);
    const nextAnesthesiologistPercent = body.anesthesiologistPercent;
    const surgeon =
      body.surgeonId !== undefined || body.surgeonName !== undefined
        ? resolveSurgeonFields(body)
        : undefined;
    const assistant =
      body.anesthesiologistId !== undefined ||
      body.anesthesiologistName !== undefined ||
      nextAnesthesiologistPercent === 0
        ? nextAnesthesiologistPercent === 0
          ? { anesthesiologistId: null, anesthesiologistName: null }
          : resolveAssistantFields(body)
        : undefined;
    const item = await prisma.interventionType.update({
      where: { id: String(req.params.id) },
      data: {
        code: body.code,
        label: body.label,
        category: body.category,
        totalCostFcfa: body.totalCostFcfa,
        surgeonPercent: body.surgeonPercent,
        anesthesiologistPercent: body.anesthesiologistPercent,
        ...(surgeon ?? {}),
        ...(assistant ?? {}),
        active: body.active,
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

router.delete("/operations/:id", async (req, res) => {
  try {
    const id = String(req.params.id);
    const usedCount = await prisma.surgeryCase.count({ where: { interventionTypeId: id } });
    if (usedCount > 0) {
      return res.status(409).json({
        error: "Cette opération a déjà été utilisée. Désactivez-la plutôt que de la supprimer.",
      });
    }
    await prisma.interventionType.delete({ where: { id } });
    return res.json({ ok: true });
  } catch {
    return res.status(400).json({ error: "Suppression impossible" });
  }
});

export default router;
