import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/db.js";
import { refreshLabPanelRegistry } from "../lib/lab-panels-registry.js";
import { requireAuth, requireModule } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth, requireModule("laboratoire"));

const fieldSchema = z.object({
  section: z.string().max(120).optional().nullable(),
  key: z.string().max(80).optional(),
  label: z.string().min(1).max(160),
  unit: z.string().max(60).optional().nullable(),
  reference: z.string().max(200).optional().nullable(),
  defaultValue: z.string().max(500).optional().nullable(),
  type: z.enum(["text", "textarea"]).optional(),
});

const panelCreateSchema = z.object({
  label: z.string().min(2).max(160),
  slug: z.string().max(80).optional(),
  isEntry: z.boolean().optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
  fields: z.array(fieldSchema).min(1),
});

const panelUpdateSchema = z.object({
  label: z.string().min(2).max(160).optional(),
  isEntry: z.boolean().optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
  fields: z.array(fieldSchema).min(1).optional(),
});

const panelInclude = {
  fields: { orderBy: { sortOrder: "asc" as const } },
} as const;

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
    return {
      section: field.section?.trim() || null,
      key: candidate,
      label: field.label.trim(),
      unit: field.unit?.trim() || null,
      reference: field.reference?.trim() || null,
      defaultValue: field.defaultValue?.trim() || null,
      type: field.type ?? "text",
      sortOrder: index,
    };
  });
}

router.get("/", async (_req, res) => {
  const panels = await prisma.labPanel.findMany({
    include: panelInclude,
    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
  });
  return res.json(panels);
});

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
    return res.status(201).json(panel);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.issues[0]?.message ?? "Données invalides" });
    }
    return res.status(400).json({ error: "Création impossible" });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const body = panelUpdateSchema.parse(req.body);
    const existing = await prisma.labPanel.findUnique({ where: { id: String(req.params.id) } });
    if (!existing) return res.status(404).json({ error: "Formulaire introuvable" });

    const panel = await prisma.$transaction(async (tx) => {
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
        await tx.labPanelField.createMany({
          data: buildFieldRows(body.fields).map((field) => ({ ...field, panelId: existing.id })),
        });
      }

      return tx.labPanel.findUnique({ where: { id: existing.id }, include: panelInclude });
    });

    await refreshLabPanelRegistry();
    return res.json(panel);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.issues[0]?.message ?? "Mise à jour impossible" });
    }
    return res.status(400).json({ error: "Mise à jour impossible" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const existing = await prisma.labPanel.findUnique({ where: { id: String(req.params.id) } });
    if (!existing) return res.status(404).json({ error: "Formulaire introuvable" });

    await prisma.labPanel.delete({ where: { id: existing.id } });
    await refreshLabPanelRegistry();
    return res.json({ ok: true });
  } catch {
    return res.status(400).json({ error: "Suppression impossible" });
  }
});

export default router;
