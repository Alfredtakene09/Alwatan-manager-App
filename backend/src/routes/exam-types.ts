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
import { selectableDoctorWhere } from "../lib/doctor-compensation.js";
import {
  authorizedSurgeonsInclude,
  resolveAuthorizedSurgeonIds,
  serializeAuthorizedSurgeons,
  syncInterventionAuthorizedSurgeons,
} from "../lib/intervention-authorized-surgeons.js";
import {
  resolveClinicServiceById,
  suggestExamCatalogKindFromServiceName,
  isExamVisibleOnKindTab,
  examCatalogServiceScopeKey,
} from "../lib/clinic-service-exam.js";
import { ensureLabPanelLinkedToExam } from "../lib/exam-lab-panel.js";
import { requireAuth, requireModule } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth, requireModule("comptabilite"));

const catalogItemSchema = z.object({
  code: z.string().max(64).optional().nullable(),
  label: z.string().min(2).max(160),
  category: z.string().max(80).optional(),
  priceFcfa: z.number().int().min(0),
  clinicServiceId: z.string().optional().nullable(),
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
  labPanelId: true,
  active: true,
  sortOrder: true,
  createdAt: true,
  updatedAt: true,
  clinicService: { select: { id: true, name: true } },
  labPanel: {
    select: {
      id: true,
      slug: true,
      label: true,
      active: true,
      _count: { select: { fields: true } },
    },
  },
} as const;

const serviceTabSchema = z.object({
  clinicServiceId: z.string().min(1),
});

async function resolveExamClinicServiceId(
  clinicServiceId: string | null | undefined,
  required: boolean,
) {
  if (clinicServiceId === undefined) return undefined;
  if (clinicServiceId === null || clinicServiceId.trim() === "") {
    if (required) throw new Error("SERVICE_REQUIRED");
    return null;
  }
  const service = await resolveClinicServiceById(clinicServiceId);
  if (!service) throw new Error("SERVICE_INVALID");
  return service.id;
}

const interventionBaseSchema = z.object({
  code: z.string().min(2).optional(),
  label: z.string().min(2),
  category: z.nativeEnum(InterventionCategory).optional().default(InterventionCategory.MOYENNE_B),
  totalCostFcfa: z.number().int().positive(),
  surgeonPercent: z.number().int().min(1).max(99),
  anesthesiologistPercent: z.number().int().min(0).max(99).default(0),
  surgeonName: z.string().max(120).optional().nullable(),
  surgeonId: z.preprocess(
    (v) => (v === "" || v === undefined ? null : v),
    z.string().min(1).nullable().optional(),
  ),
  anesthesiologistName: z.string().max(120).optional().nullable(),
  anesthesiologistId: z.preprocess(
    (v) => (v === "" || v === undefined ? null : v),
    z.string().min(1).nullable().optional(),
  ),
  clinicServiceId: z.preprocess(
    (v) => (v === "" || v === undefined ? null : v),
    z.string().min(1).nullable().optional(),
  ),
  /** Liste des chirurgiens autorisés (User ids). Si omise à la création : [surgeonId]. */
  surgeonIds: z.array(z.string().min(1)).optional(),
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
  clinicService: { select: { id: true, name: true } },
  ...authorizedSurgeonsInclude,
} as const;

async function resolveInterventionClinicServiceId(
  clinicServiceId: string | null | undefined,
) {
  if (clinicServiceId === undefined) return undefined;
  if (clinicServiceId === null || clinicServiceId.trim() === "") return null;
  const id = clinicServiceId.trim();
  // Accepter un service existant même inactif (édition d'anciennes opérations)
  const service = await prisma.clinicService.findFirst({
    where: { id },
    select: { id: true },
  });
  if (!service) throw new Error("SERVICE_INVALID");
  return service.id;
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

router.get("/service-tabs/:kindSlug", async (req, res) => {
  const kind = parseExamCatalogKindSlug(String(req.params.kindSlug));
  if (!kind) return res.status(400).json({ error: "Type d'examen invalide" });

  const allKinds = [ExamCatalogKind.EXAMEN, ExamCatalogKind.RADIO, ExamCatalogKind.ECHO, ExamCatalogKind.ODONTO];
  const tabsByKind = await prisma.examCatalogServiceTab.findMany({
    where: { kind: { in: allKinds } },
    orderBy: [{ sortOrder: "asc" }, { clinicService: { name: "asc" } }],
    select: {
      kind: true,
      clinicServiceId: true,
      sortOrder: true,
      clinicService: { select: { id: true, name: true, active: true } },
    },
  });

  const byService = new Map<
    string,
    { clinicServiceId: string; sortOrder: number; clinicService: { id: string; name: string; active: boolean } }
  >();
  for (const tab of tabsByKind) {
    if (!tab.clinicService.active) continue;
    const current = byService.get(tab.clinicServiceId);
    if (!current || tab.sortOrder < current.sortOrder) {
      byService.set(tab.clinicServiceId, {
        clinicServiceId: tab.clinicServiceId,
        sortOrder: tab.sortOrder,
        clinicService: tab.clinicService,
      });
    }
  }

  const serviceIds = Array.from(byService.keys());
  const examCounts =
    serviceIds.length === 0
      ? []
      : await prisma.examCatalogItem.groupBy({
          by: ["clinicServiceId"],
          where: { clinicServiceId: { in: serviceIds } },
          _count: { _all: true },
        });
  const countByService = new Map(
    examCounts.map((row) => [row.clinicServiceId as string, row._count._all]),
  );

  return res.json(
    Array.from(byService.values())
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((tab) => ({
        ...tab,
        examCount: countByService.get(tab.clinicServiceId) ?? 0,
      })),
  );
});

router.post("/service-tabs/:kindSlug", async (req, res) => {
  const kind = parseExamCatalogKindSlug(String(req.params.kindSlug));
  if (!kind) return res.status(400).json({ error: "Type d'examen invalide" });

  try {
    const body = serviceTabSchema.parse(req.body);
    const service = await resolveClinicServiceById(body.clinicServiceId);
    if (!service) {
      return res.status(400).json({ error: "Service clinique introuvable ou inactif." });
    }

    const existing = await prisma.examCatalogServiceTab.findUnique({
      where: {
        kind_clinicServiceId: {
          kind: ExamCatalogKind.EXAMEN,
          clinicServiceId: service.id,
        },
      },
      select: {
        clinicServiceId: true,
        sortOrder: true,
        clinicService: { select: { id: true, name: true, active: true } },
      },
    });
    if (existing) {
      return res.json(existing);
    }

    const maxOrder = await prisma.examCatalogServiceTab.aggregate({
      where: { kind: ExamCatalogKind.EXAMEN },
      _max: { sortOrder: true },
    });

    const nextSortOrder = (maxOrder._max.sortOrder ?? -1) + 1;
    const allKinds = [ExamCatalogKind.EXAMEN, ExamCatalogKind.RADIO, ExamCatalogKind.ECHO, ExamCatalogKind.ODONTO];
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

    const created = await prisma.examCatalogServiceTab.findUnique({
      where: {
        kind_clinicServiceId: {
          kind: ExamCatalogKind.EXAMEN,
          clinicServiceId: service.id,
        },
      },
      select: {
        clinicServiceId: true,
        sortOrder: true,
        clinicService: { select: { id: true, name: true, active: true } },
      },
    });
    return res.status(201).json(created ?? null);
  } catch {
    return res.status(400).json({ error: "Ajout de l'onglet service impossible." });
  }
});

router.delete("/service-tabs/:kindSlug/:clinicServiceId", async (req, res) => {
  const kind = parseExamCatalogKindSlug(String(req.params.kindSlug));
  if (!kind) return res.status(400).json({ error: "Type d'examen invalide" });

  const clinicServiceIdRaw =
    typeof req.params.clinicServiceId === "string" ? req.params.clinicServiceId.trim() : "";
  if (!clinicServiceIdRaw) {
    return res.status(400).json({ error: "Service clinique invalide." });
  }

  try {
    const allKinds = [ExamCatalogKind.EXAMEN, ExamCatalogKind.RADIO, ExamCatalogKind.ECHO, ExamCatalogKind.ODONTO];
    const existing = await prisma.examCatalogServiceTab.findFirst({
      where: {
        kind: { in: allKinds },
        clinicServiceId: clinicServiceIdRaw,
      },
      select: { clinicServiceId: true },
    });
    if (!existing) return res.status(404).json({ error: "Onglet service introuvable." });

    const examCount = await prisma.examCatalogItem.count({
      where: { clinicServiceId: clinicServiceIdRaw },
    });
    if (examCount > 0) {
      return res.status(409).json({
        error: "Impossible de retirer cet onglet : supprimez d'abord tous ses examens.",
        examCount,
      });
    }

    await prisma.examCatalogServiceTab.deleteMany({
      where: {
        kind: { in: allKinds },
        clinicServiceId: clinicServiceIdRaw,
      },
    });
    return res.json({ ok: true });
  } catch {
    return res.status(400).json({ error: "Suppression de l'onglet service impossible." });
  }
});

router.get("/catalog-by-service/:clinicServiceId", async (req, res) => {
  const clinicServiceIdRaw =
    typeof req.params.clinicServiceId === "string" ? req.params.clinicServiceId.trim() : "";
  if (!clinicServiceIdRaw) {
    return res.status(400).json({ error: "Service clinique invalide." });
  }

  const service = await resolveClinicServiceById(clinicServiceIdRaw);
  if (!service) {
    return res.status(400).json({ error: "Service clinique introuvable ou inactif." });
  }

  const items = await prisma.examCatalogItem.findMany({
    where: { clinicServiceId: service.id },
    orderBy: [{ kind: "asc" }, { sortOrder: "asc" }, { label: "asc" }],
    select: examCatalogSelect,
  });
  return res.json(items);
});

router.get("/catalog/:kindSlug", async (req, res) => {
  const kind = parseExamCatalogKindSlug(String(req.params.kindSlug));
  if (!kind) return res.status(400).json({ error: "Type d'examen invalide" });

  const clinicServiceIdRaw =
    typeof req.query.clinicServiceId === "string" ? req.query.clinicServiceId.trim() : "";
  let clinicServiceId: string | null = null;
  if (clinicServiceIdRaw) {
    const service = await resolveClinicServiceById(clinicServiceIdRaw);
    if (!service) {
      return res.status(400).json({ error: "Service clinique introuvable ou inactif." });
    }
    clinicServiceId = service.id;
  }

  const items = await prisma.examCatalogItem.findMany({
    where: {
      kind,
      ...(clinicServiceId ? { clinicServiceId } : {}),
    },
    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
    select: examCatalogSelect,
  });

  // Sur un onglet type (Labo/Radio/Écho/Odonto), n'afficher que :
  // - les examens sans service (nomenclature de base)
  // - ou ceux du service canonique du type (ex. Laboratoire pour Labo)
  // Les spécialités (Ophtalmologie, etc.) restent sur leur onglet service.
  if (!clinicServiceId) {
    return res.json(items.filter((item) => isExamVisibleOnKindTab(item, kind)));
  }

  return res.json(items);
});

router.post("/catalog/:kindSlug", async (req, res) => {
  const kind = parseExamCatalogKindSlug(String(req.params.kindSlug));
  if (!kind) return res.status(400).json({ error: "Type d'examen invalide" });

  try {
    const body = catalogItemSchema.parse(req.body);
    const clinicServiceId = await resolveExamClinicServiceId(body.clinicServiceId, false);

    let resolvedKind = kind;
    if (clinicServiceId) {
      const service = await resolveClinicServiceById(clinicServiceId);
      if (service) resolvedKind = suggestExamCatalogKindFromServiceName(service.name);
    }

    const resolvedCode = buildExamCatalogCode(body.code, body.label);

    const duplicate = await findDuplicateExamCatalogItem({
      kind: resolvedKind,
      code: resolvedCode,
      label: body.label,
      clinicServiceId,
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
        kind: resolvedKind,
        code: resolvedCode,
        label: body.label.trim(),
        category: body.category?.trim() || null,
        priceFcfa: body.priceFcfa,
        clinicServiceId,
        serviceScopeKey: examCatalogServiceScopeKey(clinicServiceId),
        sortOrder: body.sortOrder ?? 0,
        active: body.active ?? true,
      },
      select: examCatalogSelect,
    });
    await ensureLabPanelLinkedToExam(item.id);
    const linked = await prisma.examCatalogItem.findUnique({
      where: { id: item.id },
      select: examCatalogSelect,
    });
    await refreshExamPriceCache();
    return res.status(201).json(linked ?? item);
  } catch (error) {
    if (error instanceof Error && error.message === "SERVICE_INVALID") {
      return res.status(400).json({ error: "Service clinique introuvable ou inactif." });
    }
    return res.status(400).json({ error: "Données invalides ou code déjà utilisé" });
  }
});

router.put("/catalog/:kindSlug/:id", async (req, res) => {
  const kind = parseExamCatalogKindSlug(String(req.params.kindSlug));
  if (!kind) return res.status(400).json({ error: "Type d'examen invalide" });

  try {
    const body = catalogItemSchema.partial().parse(req.body);
    const existing = await prisma.examCatalogItem.findFirst({
      where: { id: String(req.params.id) },
    });
    if (!existing) return res.status(404).json({ error: "Élément introuvable" });

    const clinicServiceId =
      body.clinicServiceId !== undefined
        ? await resolveExamClinicServiceId(body.clinicServiceId, false)
        : undefined;

    let nextKind = existing.kind;
    let nextClinicServiceId =
      clinicServiceId !== undefined ? clinicServiceId : existing.clinicServiceId;
    if (clinicServiceId) {
      const service = await resolveClinicServiceById(clinicServiceId);
      if (service) nextKind = suggestExamCatalogKindFromServiceName(service.name);
    } else if (clinicServiceId === null) {
      nextClinicServiceId = null;
    }

    const nextLabel = body.label?.trim() || existing.label;
    const nextCode =
      body.code === undefined
        ? existing.code
        : body.code.trim()
          ? buildExamCatalogCode(body.code, nextLabel)
          : existing.code;

    if (body.code !== undefined || body.label !== undefined || clinicServiceId !== undefined) {
      const duplicate = await findDuplicateExamCatalogItem({
        kind: nextKind,
        code: nextCode,
        label: nextLabel,
        clinicServiceId: nextClinicServiceId,
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
        kind: nextKind,
        code: nextCode,
        label: body.label === undefined ? undefined : nextLabel,
        category: body.category === undefined ? undefined : body.category.trim() || null,
        priceFcfa: body.priceFcfa,
        clinicServiceId,
        serviceScopeKey:
          clinicServiceId !== undefined
            ? examCatalogServiceScopeKey(clinicServiceId)
            : undefined,
        sortOrder: body.sortOrder,
        active: body.active,
      },
      select: examCatalogSelect,
    });
    await ensureLabPanelLinkedToExam(item.id);
    const linked = await prisma.examCatalogItem.findUnique({
      where: { id: item.id },
      select: examCatalogSelect,
    });
    await refreshExamPriceCache();
    return res.json(linked ?? item);
  } catch (error) {
    if (error instanceof Error && error.message === "SERVICE_INVALID") {
      return res.status(400).json({ error: "Service clinique introuvable ou inactif." });
    }
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
    where: selectableDoctorWhere,
    select: { id: true, firstName: true, lastName: true },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });
  return res.json(doctors);
});

router.get("/operations", async (_req, res) => {
  const items = await prisma.interventionType.findMany({
    include: interventionInclude,
    orderBy: [{ label: "asc" }, { category: "asc" }],
  });
  return res.json(items.map(serializeIntervention));
});

router.post("/operations", async (req, res) => {
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

    const surgeon = resolveSurgeonFields(body);
    const assistant =
      body.anesthesiologistPercent > 0
        ? resolveAssistantFields(body)
        : { anesthesiologistId: null, anesthesiologistName: null };
    const clinicServiceId = await resolveInterventionClinicServiceId(body.clinicServiceId);
    const item = await prisma.interventionType.create({
      data: {
        code,
        label: body.label,
        category: body.category,
        totalCostFcfa: body.totalCostFcfa,
        surgeonPercent: body.surgeonPercent,
        anesthesiologistPercent: body.anesthesiologistPercent,
        clinicServiceId: clinicServiceId ?? null,
        ...surgeon,
        ...assistant,
        active: body.active ?? true,
      },
      include: interventionInclude,
    });

    const surgeonIds = await resolveAuthorizedSurgeonIds(
      body.surgeonIds?.length ? body.surgeonIds : surgeon.surgeonId ? [surgeon.surgeonId] : [],
      { alwaysInclude: surgeon.surgeonId },
    );
    await syncInterventionAuthorizedSurgeons(item.id, surgeonIds);

    const refreshed = await prisma.interventionType.findUniqueOrThrow({
      where: { id: item.id },
      include: interventionInclude,
    });
    return res.status(201).json(serializeIntervention(refreshed));
  } catch (error) {
    if (error instanceof Error && error.message === "SERVICE_INVALID") {
      return res.status(400).json({ error: "Service clinique introuvable ou inactif." });
    }
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.issues[0]?.message ?? "Données invalides" });
    }
    console.error("[operations POST]", error);
    const detail =
      error instanceof Error && error.message ? error.message : "Données invalides";
    return res.status(400).json({ error: detail });
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
    const clinicServiceId =
      body.clinicServiceId !== undefined
        ? await resolveInterventionClinicServiceId(body.clinicServiceId)
        : undefined;

    if (body.code !== undefined || body.label !== undefined) {
      const existing = await prisma.interventionType.findUnique({
        where: { id: String(req.params.id) },
        select: { code: true, label: true, category: true },
      });
      if (!existing) return res.status(404).json({ error: "Opération introuvable" });
      const duplicate = await findDuplicateIntervention({
        code: body.code ?? existing.code,
        label: body.label ?? existing.label,
        category: body.category ?? existing.category,
        excludeId: String(req.params.id),
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

    const item = await prisma.interventionType.update({
      where: { id: String(req.params.id) },
      data: {
        ...(body.code !== undefined ? { code: body.code } : {}),
        ...(body.label !== undefined ? { label: body.label } : {}),
        ...(body.category !== undefined ? { category: body.category } : {}),
        ...(body.totalCostFcfa !== undefined ? { totalCostFcfa: body.totalCostFcfa } : {}),
        ...(body.surgeonPercent !== undefined ? { surgeonPercent: body.surgeonPercent } : {}),
        ...(body.anesthesiologistPercent !== undefined
          ? { anesthesiologistPercent: body.anesthesiologistPercent }
          : {}),
        ...(surgeon ?? {}),
        ...(assistant ?? {}),
        ...(clinicServiceId !== undefined ? { clinicServiceId } : {}),
        ...(body.active !== undefined ? { active: body.active } : {}),
      },
      include: interventionInclude,
    });

    if (body.surgeonIds !== undefined || surgeon?.surgeonId) {
      const nextPrimary =
        surgeon?.surgeonId !== undefined ? surgeon.surgeonId : item.surgeonId;
      const surgeonIds = await resolveAuthorizedSurgeonIds(
        body.surgeonIds !== undefined
          ? body.surgeonIds
          : nextPrimary
            ? [nextPrimary]
            : [],
        { alwaysInclude: nextPrimary },
      );
      await syncInterventionAuthorizedSurgeons(item.id, surgeonIds);
    }

    const refreshed = await prisma.interventionType.findUniqueOrThrow({
      where: { id: item.id },
      include: interventionInclude,
    });
    return res.json(serializeIntervention(refreshed));
  } catch (error) {
    if (error instanceof Error && error.message === "SERVICE_INVALID") {
      return res.status(400).json({ error: "Service clinique introuvable." });
    }
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.issues[0]?.message ?? "Mise à jour impossible" });
    }
    console.error("[operations PUT]", error);
    const detail =
      error instanceof Error && error.message ? error.message : "Mise à jour impossible";
    return res.status(400).json({ error: detail });
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
