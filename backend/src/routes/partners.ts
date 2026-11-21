import { Router, type NextFunction, type Request, type Response } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/db.js";
import { requireAuth, requireModule } from "../middleware/auth.js";

/** Liste des ONG / partenaires proposée dans le formulaire « Patient ONG / Partenaire ». */
const router = Router();
router.use(requireAuth, requireModule("reception"));

const nameSchema = z.string().trim().min(2).max(160);
const DUPLICATE_ERROR = "Ce partenaire existe déjà.";

/** Champ facultatif : vide → null. */
const optionalText = (max: number) =>
  z.string().trim().max(max).nullable().optional().transform((v) => (v ? v : v === undefined ? undefined : null));

const detailsSchema = z.object({
  phone: optionalText(40),
  contactName: optionalText(160),
  address: optionalText(255),
  email: optionalText(160).refine((v) => !v || /^\S+@\S+\.\S+$/.test(v), "Adresse e-mail invalide."),
  notes: optionalText(1000),
});

/** Seul l'administrateur gère la liste ; la réception ne fait que la lire. */
function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role !== "ADMIN") {
    return res.status(403).json({ error: "Seul l'administrateur peut gérer les partenaires." });
  }
  return next();
}

function isDuplicate(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

router.get("/", async (req, res) => {
  const includeInactive = req.query.all === "1";
  const partners = await prisma.partner.findMany({
    where: includeInactive ? {} : { active: true },
    orderBy: { name: "asc" },
  });
  return res.json(partners);
});

router.post("/", requireAdmin, async (req, res) => {
  const parsed = detailsSchema.extend({ name: nameSchema }).safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Données invalides." });
  }
  try {
    const partner = await prisma.partner.create({ data: parsed.data });
    return res.status(201).json(partner);
  } catch (error) {
    if (isDuplicate(error)) return res.status(409).json({ error: DUPLICATE_ERROR });
    throw error;
  }
});

router.patch("/:id", requireAdmin, async (req, res) => {
  const parsed = detailsSchema
    .extend({ name: nameSchema.optional(), active: z.boolean().optional() })
    .safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Données invalides." });
  }
  const existing = await prisma.partner.findUnique({ where: { id: String(req.params.id) } });
  if (!existing) return res.status(404).json({ error: "Partenaire introuvable." });
  try {
    const partner = await prisma.$transaction(async (tx) => {
      const updated = await tx.partner.update({ where: { id: existing.id }, data: parsed.data });
      // Renommage : les dossiers patients gardent le nom en texte, on les aligne.
      if (parsed.data.name && parsed.data.name !== existing.name) {
        await tx.patient.updateMany({
          where: { ongName: existing.name },
          data: { ongName: parsed.data.name },
        });
      }
      return updated;
    });
    return res.json(partner);
  } catch (error) {
    if (isDuplicate(error)) return res.status(409).json({ error: DUPLICATE_ERROR });
    throw error;
  }
});

export default router;
