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
  labelForSlug,
  labPanelValuesHaveEntry,
  parseLabPanelReceivedAt,
  parseLabPanelResults,
  upsertLabPanelResult,
} from "../lib/lab-panel-results.js";
import { backfillLabSentToLabAtForPaidQueue } from "../lib/lab-receptionist-backfill.js";
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

type LabWriteBlockReason =
  | "NOT_FOUND"
  | "NO_CONSULTATION"
  | "NOT_SENT_OR_UNPAID"
  | "NO_LAB_CONTEXT";

/**
 * Lecture/écriture labo : dossiers en attente OU déjà clôturés (modification depuis Terminés).
 */
async function findLabVisitForWrite(visitId: string): Promise<{
  visit: NonNullable<Awaited<ReturnType<typeof findLabVisitForRead>>>;
  blockReason?: undefined;
} | {
  visit: null;
  blockReason: LabWriteBlockReason;
}> {
  const visit = await prisma.visit.findFirst({
    where: { id: visitId },
    include: visitInclude,
  });
  if (!visit) return { visit: null, blockReason: "NOT_FOUND" };
  if (!visit.consultation) return { visit: null, blockReason: "NO_CONSULTATION" };

  const notes = visit.consultation.clinicalNotes;
  const sentAt = visit.consultation.labSentToLabAt;
  const completed = hasLabResults(notes);
  const waitingPaid = hasPaidLabWorkPending(notes, sentAt);
  const hasContext = hasLabDossierContext(notes, sentAt);
  const hasFilled = hasFilledLabPanelResults(notes);

  if (!hasContext) return { visit: null, blockReason: "NO_LAB_CONTEXT" };
  // Attente, déjà clôturé, ou résultats déjà saisis (resaisie / correction).
  if (completed || waitingPaid || hasFilled) return { visit };
  return { visit: null, blockReason: "NOT_SENT_OR_UNPAID" };
}

function labWriteBlockMessage(reason: LabWriteBlockReason, panelLabel?: string): string {
  const panelHint = panelLabel ? ` (formulaire « ${panelLabel} »)` : "";
  switch (reason) {
    case "NOT_FOUND":
      return `Dossier laboratoire introuvable${panelHint}.`;
    case "NO_CONSULTATION":
      return `Aucune consultation liée à ce dossier${panelHint}.`;
    case "NOT_SENT_OR_UNPAID":
      return `Impossible d'enregistrer${panelHint} : examens non envoyés au labo ou non payés.`;
    case "NO_LAB_CONTEXT":
      return `Impossible d'enregistrer${panelHint} : aucun examen laboratoire prescrit pour ce dossier.`;
    default:
      return `Enregistrement impossible${panelHint}.`;
  }
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

const LAB_QUEUE_TAKE = 2000;

const labWaitingOrderBy = [
  { consultation: { labSentToLabAt: "desc" as const } },
  { consultation: { updatedAt: "desc" as const } },
];

router.get("/queue", async (_req, res) => {
  await backfillLabSentToLabAtForPaidQueue();
  const visits = await prisma.visit.findMany({
    where: {
      consultation: { is: labsWaitingWhere() },
    },
    include: visitInclude,
    orderBy: labWaitingOrderBy,
    take: LAB_QUEUE_TAKE,
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
  await backfillLabSentToLabAtForPaidQueue();
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
    orderBy: labWaitingOrderBy,
    take: LAB_QUEUE_TAKE,
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
  const dbPanel = await prisma.labPanel.findUnique({
    where: { slug: panelSlug },
    select: { slug: true, label: true },
  });
  if (!isLabPanelSlug(panelSlug) && !dbPanel) {
    return res.status(400).json({
      error: `Formulaire inconnu « ${panelSlug} ». Vérifiez que le formulaire existe dans Laboratoire → Formulaires.`,
      code: "INVALID_PANEL_SLUG",
      panelSlug,
    });
  }
  if (dbPanel && !isLabPanelSlug(panelSlug)) {
    await refreshLabPanelRegistry();
  }
  const panelLabel = dbPanel?.label?.trim() || labelForSlug(panelSlug);

  try {
    const parsed = panelSchema.safeParse(req.body);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "données"}: ${issue.message}`)
        .slice(0, 3)
        .join(" ; ");
      return res.status(400).json({
        error: `Données invalides pour « ${panelLabel} »${detail ? ` — ${detail}` : "."}`,
        code: "INVALID_PANEL_PAYLOAD",
        panelSlug,
        panelLabel,
      });
    }

    if (!labPanelValuesHaveEntry(parsed.data.values)) {
      return res.status(400).json({
        error: `Remplissez au moins un résultat dans « ${panelLabel} » avant d'enregistrer.`,
        code: "EMPTY_PANEL_VALUES",
        panelSlug,
        panelLabel,
      });
    }

    const { visit, blockReason } = await findLabVisitForWrite(String(req.params.visitId));
    if (!visit?.consultation || blockReason) {
      return res.status(404).json({
        error: labWriteBlockMessage(blockReason ?? "NOT_FOUND", panelLabel),
        code: blockReason ?? "NOT_FOUND",
        panelSlug,
        panelLabel,
      });
    }

    const withPanel = upsertLabPanelResult(
      visit.consultation.clinicalNotes,
      panelSlug,
      parsed.data.values,
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
      panelSlug,
      panelLabel,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "erreur inconnue";
    console.error(`[laboratoire] save panel ${panelSlug}:`, error);
    return res.status(500).json({
      error: `Échec d'enregistrement de « ${panelLabel} » : ${detail}`,
      code: "PANEL_SAVE_FAILED",
      panelSlug,
      panelLabel,
    });
  }
});

router.post("/visits/:visitId/complete", async (req, res) => {
  const visit = await findLabVisitForRead(String(req.params.visitId));
  if (!visit?.consultation) {
    return res.status(404).json({
      error: "Dossier laboratoire introuvable — impossible de clôturer.",
      code: "NOT_FOUND",
    });
  }

  const recordedById = req.user?.id;

  if (hasLabResults(visit.consultation.clinicalNotes)) {
    if (recordedById && !visit.consultation.labRecordedById) {
      await prisma.consultation.update({
        where: { id: visit.consultation.id },
        data: { labRecordedById: recordedById, labRecordedAt: new Date() },
      });
    }
    return res.json({ ok: true, alreadyCompleted: true });
  }

  if (!hasFilledLabPanelResults(visit.consultation.clinicalNotes)) {
    return res.status(400).json({
      error:
        "Aucun résultat saisi — impossible de clôturer. Remplissez au moins un examen prescrit puis réessayez.",
      code: "NO_FILLED_RESULTS",
    });
  }

  try {
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
  } catch (error) {
    const detail = error instanceof Error ? error.message : "erreur inconnue";
    console.error("[laboratoire] complete visit:", error);
    return res.status(500).json({
      error: `Échec de clôture du dossier : ${detail}`,
      code: "COMPLETE_FAILED",
    });
  }
});

export default router;
