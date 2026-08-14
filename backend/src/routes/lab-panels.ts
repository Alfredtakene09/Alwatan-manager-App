import { Router } from "express";
import { ExamCatalogKind } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/db.js";
import {
  deactivateExamLinkedToLabPanel,
  ensureExamLinkedToLabPanel,
} from "../lib/exam-lab-panel.js";
import { refreshLabPanelRegistry } from "../lib/lab-panels-registry.js";
import { requireAuth, requireAnyModule, requireModule } from "../middleware/auth.js";

const panelInclude = {
  fields: { orderBy: { sortOrder: "asc" as const } },
  examCatalogItems: {
    where: { kind: ExamCatalogKind.EXAMEN },
    select: {
      id: true,
      code: true,
      label: true,
      priceFcfa: true,
      active: true,
    },
    take: 1,
  },
} as const;

const router = Router();
router.use(requireAuth);

/** Lecture des formulaires : labo + médecins (consultation des résultats). */
router.get("/", requireAnyModule("laboratoire", "consultation", "comptabilite", "dossier-patient"), async (_req, res) => {
  const panels = await prisma.labPanel.findMany({
    include: panelInclude,
    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
  });
  return res.json(panels);
});

/** Écriture réservée au module laboratoire. */
router.use(requireModule("laboratoire"));

const optionalFieldPrice = z.preprocess((value) => {
  if (value === "" || value === undefined || value === null) return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) return null;
  return n;
}, z.number().int().min(1).nullable());

const fieldSchema = z.object({
  section: z.string().max(200).optional().nullable(),
  key: z.string().max(120).optional(),
  label: z.string().min(1).max(300),
  unit: z.string().max(120).optional().nullable(),
  reference: z.string().max(2000).optional().nullable(),
  defaultValue: z.string().max(2000).optional().nullable(),
  /** Tarif partiel (FCFA) — omis / null / 0 = pas de tarif unitaire. */
  priceFcfa: optionalFieldPrice,
  hasComment: z.boolean().optional(),
  type: z.enum(["text", "textarea"]).optional(),
});

const panelCreateSchema = z.object({
  label: z.string().min(2).max(160),
  slug: z.string().max(80).optional(),
  isEntry: z.boolean().optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
  /** Tarif facturable (FCFA) — obligatoire à la création. */
  priceFcfa: z.number().int().min(1, "Le tarif doit être supérieur à 0"),
  /** Vide autorisé : formulaire créé depuis un examen catalogue, champs à compléter plus tard. */
  fields: z.array(fieldSchema).default([]),
});

const panelUpdateSchema = z.object({
  label: z.string().min(2).max(160).optional(),
  isEntry: z.boolean().optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
  /** Si fourni (édition formulaire), synchronisé sur l’examen catalogue lié. */
  priceFcfa: z.number().int().min(1, "Le tarif doit être supérieur à 0").optional(),
  fields: z.array(fieldSchema).optional(),
});

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function keyify(value: string) {
  const slug = slugify(value).replace(/-/g, "_");
  return slug || "field";
}

async function makeUniquePanelSlug(base: string) {
  const root = slugify(base) || "formulaire";
  let candidate = root;
  let suffix = 1;
  // eslint-disable-next-line no-await-in-loop
  while (await prisma.labPanel.findUnique({ where: { slug: candidate } })) {
    suffix += 1;
    candidate = `${root}-${suffix}`;
  }
  return candidate;
}

/** Génère des clés de champ uniques au sein d'un formulaire. */
function buildFieldRows(fields: z.infer<typeof fieldSchema>[]) {
  const used = new Set<string>();
  return fields.map((field, index) => {
    let key = keyify(field.key?.trim() || field.label);
    let candidate = key;
    let suffix = 1;
    while (used.has(candidate)) {
      suffix += 1;
      candidate = `${key}_${suffix}`;
    }
    used.add(candidate);
    const priceFcfa =
      field.priceFcfa != null && Number.isFinite(field.priceFcfa) && field.priceFcfa >= 1
        ? field.priceFcfa
        : null;
    return {
      section: field.section?.trim() || null,
      key: candidate,
      label: field.label.trim(),
      unit: field.unit?.trim() || null,
      reference: field.reference?.trim() || null,
      defaultValue: field.defaultValue?.trim() || null,
      priceFcfa,
      hasComment: field.hasComment === true,
      type: field.type ?? "text",
      sortOrder: index,
    };
  });
}

function zodErrorMessage(error: z.ZodError) {
  const issue = error.issues[0];
  if (!issue) return "Données invalides";
  const path = issue.path.filter((part) => part !== undefined && part !== "").join(" › ");
  return path ? `${issue.message} (${path})` : issue.message;
}

router.post("/", async (req, res) => {
  try {
    const body = panelCreateSchema.parse(req.body);
    const slug = body.slug?.trim()
      ? await makeUniquePanelSlug(body.slug)
      : await makeUniquePanelSlug(body.label);

    const maxOrder = await prisma.labPanel.aggregate({ _max: { sortOrder: true } });
    const panel = await prisma.labPanel.create({
      data: {
        slug,
        label: body.label.trim(),
        isEntry: body.isEntry ?? true,
        active: body.active ?? true,
        sortOrder: body.sortOrder ?? (maxOrder._max.sortOrder ?? 0) + 1,
        fields: { create: buildFieldRows(body.fields) },
      },
      include: panelInclude,
    });
    await refreshLabPanelRegistry();
    await ensureExamLinkedToLabPanel(panel.id, { priceFcfa: body.priceFcfa });
    const linked = await prisma.labPanel.findUnique({
      where: { id: panel.id },
      include: panelInclude,
    });
    return res.status(201).json(linked ?? panel);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: zodErrorMessage(error) });
    }
    console.error("[lab-panels] create failed", error);
    return res.status(400).json({
      error: error instanceof Error ? error.message : "Création impossible",
    });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const body = panelUpdateSchema.parse(req.body);
    const existing = await prisma.labPanel.findUnique({ where: { id: String(req.params.id) } });
    if (!existing) return res.status(404).json({ error: "Formulaire introuvable" });

    const panel = await prisma.$transaction(
      async (tx) => {
        await tx.labPanel.update({
          where: { id: existing.id },
          data: {
            label: body.label?.trim(),
            isEntry: body.isEntry,
            active: body.active,
            sortOrder: body.sortOrder,
          },
        });

        if (body.fields) {
          await tx.labPanelField.deleteMany({ where: { panelId: existing.id } });
          const rows = buildFieldRows(body.fields);
          if (rows.length) {
            await tx.labPanelField.createMany({
              data: rows.map((field) => ({ ...field, panelId: existing.id })),
            });
          }
        }

        return tx.labPanel.findUnique({ where: { id: existing.id }, include: panelInclude });
      },
      { timeout: 120_000 },
    );

    await refreshLabPanelRegistry();
    await ensureExamLinkedToLabPanel(existing.id, {
      priceFcfa: body.priceFcfa,
    });
    const linked = await prisma.labPanel.findUnique({
      where: { id: existing.id },
      include: panelInclude,
    });
    return res.json(linked ?? panel);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: zodErrorMessage(error) });
    }
    console.error("[lab-panels] update failed", error);
    return res.status(400).json({
      error: error instanceof Error ? error.message : "Mise à jour impossible",
    });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const existing = await prisma.labPanel.findUnique({ where: { id: String(req.params.id) } });
    if (!existing) return res.status(404).json({ error: "Formulaire introuvable" });

    await deactivateExamLinkedToLabPanel(existing.id);
    await prisma.labPanel.delete({ where: { id: existing.id } });
    await refreshLabPanelRegistry();
    return res.json({ ok: true });
  } catch {
    return res.status(400).json({ error: "Suppression impossible" });
  }
});

export default router;
