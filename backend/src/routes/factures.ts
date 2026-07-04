import { Router } from "express";
import { InvoiceType } from "@prisma/client";
import { prisma } from "../lib/db.js";
import { generateInvoicePdf } from "../lib/pdf-invoice.js";
import { canAccessModule, type AppUserRole } from "../lib/roles.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

function canReadFactures(role: AppUserRole) {
  return canAccessModule(role, "factures") || canAccessModule(role, "reception");
}

router.get("/", async (req, res) => {
  const user = req.user!;
  if (!canReadFactures(user.role as AppUserRole)) {
    return res.status(403).json({ error: "Accès refusé" });
  }

  const fullAccess = canAccessModule(user.role as AppUserRole, "factures");
  const { type, status, limit } = req.query;
  const invoiceType = fullAccess ? (type as string | undefined) : InvoiceType.CONSULTATION;

  const invoices = await prisma.invoice.findMany({
    where: {
      type: invoiceType as never,
      ...(status ? { status: status as never } : {}),
    },
    include: {
      patient: { select: { code: true, firstName: true, lastName: true } },
      issuedBy: { select: { firstName: true, lastName: true } },
    },
    orderBy: { createdAt: "desc" },
    take: limit ? Number(limit) : 100,
  });
  return res.json(invoices);
});

router.get("/:id/pdf", async (req, res) => {
  const user = req.user!;
  if (!canReadFactures(user.role as AppUserRole)) {
    return res.status(403).json({ error: "Accès refusé" });
  }

  const invoice = await prisma.invoice.findUnique({
    where: { id: req.params.id as string },
    include: {
      patient: true,
      externalClient: true,
      issuedBy: { select: { firstName: true, lastName: true } },
    },
  });

  if (!invoice) {
    return res.status(404).json({ error: "Facture introuvable" });
  }

  const fullAccess = canAccessModule(user.role as AppUserRole, "factures");
  if (!fullAccess && invoice.type !== InvoiceType.CONSULTATION) {
    return res.status(403).json({ error: "Accès refusé" });
  }

  const pdf = await generateInvoicePdf(invoice);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `inline; filename="${invoice.invoiceNumber}.pdf"`,
  );
  return res.send(pdf);
});

export default router;
