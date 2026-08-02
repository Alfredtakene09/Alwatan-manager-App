import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { ExamCatalogKind } from "@prisma/client";
import { prisma } from "../lib/db.js";
import {
  resolveDoctorClinicService,
  suggestExamCatalogKindFromServiceName,
  examCatalogServiceScopeKey,
} from "../lib/clinic-service-exam.js";
import { findDuplicateExamCatalogItem } from "../lib/duplicate-detection.js";
import { duplicateErrorResponse } from "../lib/duplicate-error.js";
import { refreshExamPriceCache } from "../lib/lab-exam-prices.js";
import { requireAuth, requireModule } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth, requireModule("consultation"));

const catalogItemSchema = z.object({
  code: z.string().max(64).optional().nullable(),
  label: z.string().min(2).max(160),
  category: z.string().max(80).optional(),
  priceFcfa: z.number().int().positive(),
  sortOrder: z.number().int().min(0).optional(),
  active: z.boolean().optional(),
});

function buildExamCatalogCode(code: string | null | undefined, label: string) {
  const fromCode = String(code ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  if (fromCode.length >= 2) return fromCode;

  const fromLabel = label
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  if (fromLabel.length >= 2) return fromLabel;
  return `exam-${Date.now().toString(36)}`;
}

const examCatalogSelect = {
  id: true,
  kind: true,
  code: true,
  label: true,
  category: true,
  priceFcfa: true,
  clinicServiceId: true,
  active: true,
  sortOrder: true,
  createdAt: true,
  updatedAt: true,
  clinicService: { select: { id: true, name: true } },
} as const;

async function requireDoctorService(req: Request, res: Response) {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: "Non autorisé" });
    return null;
  }
  const service = await resolveDoctorClinicService(userId);
  if (!service) {
    res.status(400).json({
      error:
        "Aucun service clinique n'est associé à votre compte. Contactez l'administration.",
    });
    return null;
  }
  return service;
}

router.get("/me", async (req, res) => {
  const service = await requireDoctorService(req, res);
  if (!service) return;
  return res.json({
    clinicServiceId: service.id,
    clinicServiceName: service.name,
    suggestedKind: suggestExamCatalogKindFromServiceName(service.name),
  });
});

router.get("/", async (req, res) => {
  const service = await requireDoctorService(req, res);
  if (!service) return;

  const items = await prisma.examCatalogItem.findMany({
    where: { clinicServiceId: service.id },
    orderBy: [{ kind: "asc" }, { sortOrder: "asc" }, { label: "asc" }],
    select: examCatalogSelect,
  });
  return res.json(items);
});

router.post("/", async (req, res) => {
  const service = await requireDoctorService(req, res);
  if (!service) return;

  try {
    const body = catalogItemSchema.parse(req.body);
    const kind = suggestExamCatalogKindFromServiceName(service.name);
    const resolvedCode = buildExamCatalogCode(body.code, body.label);

    const duplicate = await findDuplicateExamCatalogItem({
      kind,
      code: resolvedCode,
      label: body.label,
      clinicServiceId: service.id,
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
        code: resolvedCode,
        label: body.label.trim(),
        category: body.category?.trim() || null,
        priceFcfa: body.priceFcfa,
        clinicServiceId: service.id,
        serviceScopeKey: examCatalogServiceScopeKey(service.id),
        sortOrder: body.sortOrder ?? 0,
        active: body.active ?? true,
      },
      select: examCatalogSelect,
    });

    const allKinds = [
      ExamCatalogKind.EXAMEN,
      ExamCatalogKind.RADIO,
      ExamCatalogKind.ECHO,
      ExamCatalogKind.ODONTO,
    ];
    const maxOrder = await prisma.examCatalogServiceTab.aggregate({
      where: { kind: ExamCatalogKind.EXAMEN },
      _max: { sortOrder: true },
    });
    const nextSortOrder = (maxOrder._max.sortOrder ?? -1) + 1;
    await prisma.$transaction(
      allKinds.map((examKind) =>
        prisma.examCatalogServiceTab.upsert({
          where: {
            kind_clinicServiceId: {
              kind: examKind,
              clinicServiceId: service.id,
            },
          },
          update: {},
          create: {
            kind: examKind,
            clinicServiceId: service.id,
            sortOrder: nextSortOrder,
          },
        }),
      ),
    );

    await refreshExamPriceCache();
    return res.status(201).json(item);
  } catch {
    return res.status(400).json({ error: "Données invalides ou code déjà utilisé" });
  }
});

router.put("/:id", async (req, res) => {
  const service = await requireDoctorService(req, res);
  if (!service) return;

  try {
    const body = catalogItemSchema.partial().parse(req.body);
    const existing = await prisma.examCatalogItem.findFirst({
      where: { id: String(req.params.id), clinicServiceId: service.id },
    });
    if (!existing) return res.status(404).json({ error: "Élément introuvable" });

    const nextKind = existing.kind;
    const nextLabel = body.label?.trim() || existing.label;
    const nextCode =
      body.code === undefined
        ? existing.code
        : body.code.trim()
          ? buildExamCatalogCode(body.code, nextLabel)
          : existing.code;

    if (body.code !== undefined || body.label !== undefined) {
      const duplicate = await findDuplicateExamCatalogItem({
        kind: nextKind,
        code: nextCode,
        label: nextLabel,
        clinicServiceId: service.id,
        excludeId: existing.id,
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
    }

    const item = await prisma.examCatalogItem.update({
      where: { id: existing.id },
      data: {
        code: nextCode,
        label: body.label === undefined ? undefined : nextLabel,
        category: body.category === undefined ? undefined : body.category.trim() || null,
        priceFcfa: body.priceFcfa,
        sortOrder: body.sortOrder,
        active: body.active,
        clinicServiceId: service.id,
        serviceScopeKey: examCatalogServiceScopeKey(service.id),
      },
      select: examCatalogSelect,
    });
    await refreshExamPriceCache();
    return res.json(item);
  } catch {
    return res.status(400).json({ error: "Mise à jour impossible" });
  }
});

router.delete("/:id", async (req, res) => {
  const service = await requireDoctorService(req, res);
  if (!service) return;

  try {
    const existing = await prisma.examCatalogItem.findFirst({
      where: { id: String(req.params.id), clinicServiceId: service.id },
    });
    if (!existing) return res.status(404).json({ error: "Élément introuvable" });

    await prisma.examCatalogItem.delete({ where: { id: existing.id } });
    await refreshExamPriceCache();
    return res.json({ ok: true });
  } catch {
    return res.status(400).json({ error: "Suppression impossible" });
  }
});

export default router;
