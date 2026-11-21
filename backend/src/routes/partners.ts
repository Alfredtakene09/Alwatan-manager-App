import { Router, type NextFunction, type Request, type Response } from "express";
import { InvoiceStatus, PatientCategory, Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/db.js";
import { recordInvoiceInstallment } from "../lib/patient-invoice-payments.js";
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

/**
 * Parcours d'un patient ONG réglé par le partenaire : solde toutes ses factures restantes.
 * Le paiement est enregistré au nom de l'admin (pas du réceptionniste) et daté de maintenant :
 * la part du médecin sur la consultation compte à partir de ce jour.
 */
router.post("/visits/:visitId/mark-paid", requireAdmin, async (req, res) => {
  const visit = await prisma.visit.findUnique({
    where: { id: String(req.params.visitId) },
    select: {
      id: true,
      patient: { select: { category: true, ongName: true } },
      invoices: {
        where: { status: { notIn: [InvoiceStatus.PAID, InvoiceStatus.CANCELLED] } },
        select: { id: true, amountFcfa: true, paidAmountFcfa: true },
      },
    },
  });
  if (!visit) return res.status(404).json({ error: "Parcours introuvable." });
  if (visit.patient.category !== PatientCategory.ONG) {
    return res.status(400).json({ error: "Ce parcours n'est pas celui d'un patient ONG / partenaire." });
  }
  const unpaid = visit.invoices.filter((invoice) => invoice.amountFcfa > invoice.paidAmountFcfa);
  if (!unpaid.length) return res.status(409).json({ error: "Ce parcours est déjà réglé." });

  const note = `Réglé par le partenaire${visit.patient.ongName ? ` ${visit.patient.ongName}` : ""}`;
  const paidFcfa = await prisma.$transaction(async (tx) => {
    let total = 0;
    for (const invoice of unpaid) {
      const amountFcfa = invoice.amountFcfa - invoice.paidAmountFcfa;
      await recordInvoiceInstallment(tx, { invoiceId: invoice.id, amountFcfa, recordedById: req.user!.id, note });
      total += amountFcfa;
    }
    return total;
  });
  return res.json({ paidFcfa, invoiceCount: unpaid.length });
});

/** Les dossiers patients gardent le nom du partenaire en texte : leurs factures restent intactes. */
router.delete("/:id", requireAdmin, async (req, res) => {
  const id = String(req.params.id);
  const existing = await prisma.partner.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "Partenaire introuvable." });
  await prisma.partner.delete({ where: { id } });
  return res.json({ message: "Partenaire supprimé" });
});

export default router;
