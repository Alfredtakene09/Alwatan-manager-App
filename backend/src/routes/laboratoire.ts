import { Router } from "express";
import { z } from "zod";
import { ExamCatalogKind, InvoiceType } from "@prisma/client";
import { prisma } from "../lib/db.js";
import {
  extractBasePanelLabel,
  hasLabResults,
  hasPaidLabWorkPending,
  labsWaitingWhere,
  labsCompletedWhere,
  parsePrescribedExamsByKind,
  formatGroupedPrescribedLabels,
  countGroupedPrescribedPanels,
} from "../lib/lab-notes.js";
import { normalizeExamFormLabelKey } from "../lib/exam-lab-panel.js";
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
import type { AppUserRole } from "../lib/roles.js";

const router = Router();
router.use(requireAuth, requireModule("laboratoire"));

/** Les laborantins ne voient que leurs propres dossiers dans « Examens terminés ». */
function isLaborantinScoped(role: string | undefined): boolean {
  return role === ("LABORANTIN" satisfies AppUserRole);
}

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
      labRecordedBy: { select: personWithEmployeeSelect },
    },
  },
} as const;

const panelSchema = z.object({
  values: z.record(z.string(), z.string()),
});

/** Formulaires labo correspondant aux examens laboratoire prescrits. */
async function resolvePrescribedPanels(clinicalNotes?: string | null) {
  const labels = parsePrescribedExamsByKind(clinicalNotes).examen;
  if (!labels.length) return [] as Array<{ slug: string; label: string; examLabel: string }>;

  const keys = new Set(
    labels.map((label) => normalizeExamFormLabelKey(extractBasePanelLabel(label))).filter(Boolean),
  );
  const panels = await prisma.labPanel.findMany({
    where: { active: true },
    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
    select: {
      slug: true,
      label: true,
      examCatalogItems: {
        where: { kind: ExamCatalogKind.EXAMEN, active: true },
        select: { label: true },
        take: 5,
      },
    },
  });

  return panels
    .filter((panel) => {
      const candidates = [panel.label, ...panel.examCatalogItems.map((item) => item.label)];
      return candidates.some((label) => keys.has(normalizeExamFormLabelKey(label)));
    })
    .map((panel) => ({
      slug: panel.slug,
      label: panel.label,
      examLabel: panel.examCatalogItems[0]?.label?.trim() || panel.label,
    }));
}

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

/** Compteurs cloche labo : examens en attente / récents (transférés < 24 h). */
router.get("/alerts", async (_req, res) => {
  const visits = await prisma.visit.findMany({
    where: {
      consultation: { is: labsWaitingWhere() },
    },
    select: {
      id: true,
      updatedAt: true,
      patient: { select: { code: true, firstName: true, lastName: true } },
      consultation: { select: { clinicalNotes: true, labSentToLabAt: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });

  const recentCutoff = Date.now() - 24 * 60 * 60 * 1000;
  const items: Array<{
    visitId: string;
    patientCode: string;
    patientName: string;
    examCount: number;
    exams: string[];
    labSentToLabAt: string | null;
    recent: boolean;
  }> = [];

  let waitingExamCount = 0;
  let recentExamCount = 0;

  for (const visit of visits) {
    if (
      !hasPaidLabWorkPending(
        visit.consultation?.clinicalNotes,
        visit.consultation?.labSentToLabAt,
      )
    ) {
      continue;
    }
    const exams = parsePrescribedExamsByKind(visit.consultation?.clinicalNotes).examen;
    const examCount = countGroupedPrescribedPanels(exams);
    const sentAt = visit.consultation?.labSentToLabAt ?? null;
    const recent = Boolean(sentAt && sentAt.getTime() >= recentCutoff);
    waitingExamCount += examCount;
    if (recent) recentExamCount += examCount;
    items.push({
      visitId: visit.id,
      patientCode: visit.patient.code,
      patientName: `${visit.patient.firstName} ${visit.patient.lastName}`.trim(),
      examCount,
      exams: formatGroupedPrescribedLabels(exams).slice(0, 6),
      labSentToLabAt: sentAt ? sentAt.toISOString() : null,
      recent,
    });
  }

  return res.json({
    waitingExamCount,
    recentExamCount,
    waitingVisitCount: items.length,
    items,
  });
});

router.get("/completed", async (req, res) => {
  const scopedToUser =
    isLaborantinScoped(req.user?.role) && req.user?.id
      ? { labRecordedById: req.user.id }
      : {};

  const visits = await prisma.visit.findMany({
    where: {
      consultation: { is: { ...labsCompletedWhere(), ...scopedToUser } },
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

  const prescribedPanels = await resolvePrescribedPanels(visit.consultation?.clinicalNotes);

  return res.json({
    visit,
    panelResults: parseLabPanelResults(visit.consultation?.clinicalNotes),
    panelReceivedAt: parseLabPanelReceivedAt(visit.consultation?.clinicalNotes),
    completed: hasLabResults(visit.consultation?.clinicalNotes),
    prescribedPanels,
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
    const visit = await findLabVisit(String(req.params.visitId));
    if (!visit?.consultation) {
      return res.status(404).json({ error: "Dossier laboratoire introuvable" });
    }

    const withPanel = upsertLabPanelResult(
      visit.consultation.clinicalNotes,
      panelSlug,
      body.values,
    );

    const recordedById = req.user?.id;
    const consultation = await prisma.consultation.update({
      where: { id: visit.consultation.id },
      data: {
        clinicalNotes: withPanel,
        ...(recordedById && !visit.consultation.labRecordedById
          ? { labRecordedById: recordedById, labRecordedAt: new Date() }
          : {}),
      },
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

  const recordedById = req.user?.id;

  if (hasLabResults(visit.consultation.clinicalNotes)) {
    if (recordedById && !visit.consultation.labRecordedById) {
      await prisma.consultation.update({
        where: { id: visit.consultation.id },
        data: { labRecordedById: recordedById, labRecordedAt: new Date() },
      });
    }
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
    data: {
      clinicalNotes,
      ...(recordedById && !visit.consultation.labRecordedById
        ? { labRecordedById: recordedById, labRecordedAt: new Date() }
        : {}),
    },
  });

  return res.json({ ok: true });
});

export default router;
