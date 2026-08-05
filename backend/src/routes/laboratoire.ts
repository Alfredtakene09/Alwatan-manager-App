import { Router } from "express";
import { z } from "zod";
import { InvoiceType } from "@prisma/client";
import { prisma } from "../lib/db.js";
import {
  hasLabResults,
  hasPaidLabWorkPending,
  labsWaitingWhere,
  labsCompletedWhere,
} from "../lib/lab-notes.js";
import {
  appendLabResultsCompletion,
  hasFilledLabPanelResults,
  hasLabExamsPrescribed,
  isLabPanelSlug,
  labPanelValuesHaveEntry,
  parseLabPanelReceivedAt,
  parseLabPanelResults,
  upsertLabPanelResult,
} from "../lib/lab-panel-results.js";
import { requireAuth, requireModule } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth, requireModule("laboratoire"));

const personWithEmployeeSelect = {
  id: true,
  firstName: true,
  lastName: true,
  employee: { select: { firstName: true, lastName: true } },
} as const;

const visitInclude = {
  patient: {
    include: {
      createdBy: { select: personWithEmployeeSelect },
    },
  },
  assignedDoctor: { select: personWithEmployeeSelect },
  invoices: {
    where: { type: InvoiceType.LAB_EXAM },
    select: {
      invoiceNumber: true,
      amountFcfa: true,
      type: true,
      createdAt: true,
      issuedBy: { select: personWithEmployeeSelect },
    },
    orderBy: { createdAt: "asc" as const },
  },
  vitalSigns: { orderBy: { recordedAt: "desc" as const }, take: 1 },
  consultation: {
    include: {
      doctor: { select: personWithEmployeeSelect },
      labApprovedBy: { select: personWithEmployeeSelect },
    },
  },
} as const;

const panelSchema = z.object({
  values: z.record(z.string(), z.string()),
});

async function findLabVisit(visitId: string) {
  const visit = await prisma.visit.findFirst({
    where: {
      id: visitId,
      consultation: { is: labsWaitingWhere() },
    },
    include: visitInclude,
  });

  if (!visit?.consultation) return null;
  if (
    !hasPaidLabWorkPending(
      visit.consultation.clinicalNotes,
      visit.consultation.labSentToLabAt,
    )
  ) {
    return null;
  }
  return visit;
}

function hasLabDossierContext(
  notes?: string | null,
  labSentToLabAt?: Date | null,
) {
  if (hasLabExamsPrescribed(notes)) return true;
  if (hasLabResults(notes)) return true;
  if (Object.keys(parseLabPanelResults(notes)).length > 0) return true;
  return hasPaidLabWorkPending(notes, labSentToLabAt);
}

async function findLabVisitForRead(visitId: string) {
  const visit = await prisma.visit.findFirst({
    where: { id: visitId },
    include: visitInclude,
  });

  if (!visit?.consultation) return null;
  if (!hasLabDossierContext(visit.consultation.clinicalNotes, visit.consultation.labSentToLabAt)) {
    return null;
  }
  return visit;
}

router.get("/queue", async (_req, res) => {
  const visits = await prisma.visit.findMany({
    where: {
      consultation: { is: labsWaitingWhere() },
    },
    include: visitInclude,
    orderBy: { updatedAt: "desc" },
    take: 100,
  });

  return res.json(
    visits.filter((visit) =>
      hasPaidLabWorkPending(
        visit.consultation?.clinicalNotes,
        visit.consultation?.labSentToLabAt,
      ),
    ),
  );
});

router.get("/completed", async (_req, res) => {
  const visits = await prisma.visit.findMany({
    where: {
      consultation: { is: labsCompletedWhere() },
    },
    include: visitInclude,
    orderBy: { updatedAt: "desc" },
    take: 100,
  });

  return res.json(
    visits.filter((visit) =>
      hasLabDossierContext(
        visit.consultation?.clinicalNotes,
        visit.consultation?.labSentToLabAt,
      ),
    ),
  );
});

router.get("/visits/:visitId", async (req, res) => {
  const visit = await findLabVisitForRead(String(req.params.visitId));
  if (!visit) return res.status(404).json({ error: "Dossier laboratoire introuvable" });

  return res.json({
    visit,
    panelResults: parseLabPanelResults(visit.consultation?.clinicalNotes),
    panelReceivedAt: parseLabPanelReceivedAt(visit.consultation?.clinicalNotes),
    completed: hasLabResults(visit.consultation?.clinicalNotes),
  });
});

router.put("/visits/:visitId/panels/:panelSlug", async (req, res) => {
  const panelSlug = String(req.params.panelSlug);
  if (!isLabPanelSlug(panelSlug)) {
    return res.status(400).json({ error: "Type de formulaire invalide" });
  }

  try {
    const body = panelSchema.parse(req.body);
    if (!labPanelValuesHaveEntry(body.values)) {
      return res.status(400).json({
        error: "Remplissez au moins un résultat avant d'enregistrer.",
      });
    }
    const visit = await findLabVisitForRead(String(req.params.visitId));
    if (!visit?.consultation) {
      return res.status(404).json({ error: "Dossier laboratoire introuvable" });
    }

    const withPanel = upsertLabPanelResult(
      visit.consultation.clinicalNotes,
      panelSlug,
      body.values,
    );

    const consultation = await prisma.consultation.update({
      where: { id: visit.consultation.id },
      data: { clinicalNotes: withPanel },
    });

    return res.json({
      panelResults: parseLabPanelResults(consultation.clinicalNotes),
      completed: hasLabResults(consultation.clinicalNotes),
    });
  } catch {
    return res.status(400).json({ error: "Données invalides" });
  }
});

router.post("/visits/:visitId/complete", async (req, res) => {
  const visit = await findLabVisitForRead(String(req.params.visitId));
  if (!visit?.consultation) {
    return res.status(404).json({ error: "Dossier laboratoire introuvable" });
  }

  if (hasLabResults(visit.consultation.clinicalNotes)) {
    return res.json({ ok: true });
  }

  if (!hasFilledLabPanelResults(visit.consultation.clinicalNotes)) {
    return res.status(400).json({
      error: "Aucun résultat saisi — impossible de clôturer le dossier.",
    });
  }

  const clinicalNotes = appendLabResultsCompletion(visit.consultation.clinicalNotes);

  await prisma.consultation.update({
    where: { id: visit.consultation.id },
    data: { clinicalNotes },
  });

  return res.json({ ok: true });
});

export default router;
