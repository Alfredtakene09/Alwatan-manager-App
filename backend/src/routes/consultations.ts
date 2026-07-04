import { Router } from "express";
import { z } from "zod";
import {
  SurgeryStatus,
  VisitStatus,
  PatientCategory,
} from "@prisma/client";
import { prisma } from "../lib/db.js";
import {
  EXAMS_PRESCRIBED_PREFIX,
  LAB_RESULTS_PREFIX,
  buildPrescribedExamsNotes,
  buildPrescribedExamsNotesByKind,
  flattenPrescribedExams,
  hasExamsPrescribed,
  hasLabResults,
  labsResultsWhere,
  labsWaitingWhere,
  mergeExamsByKind,
  countNewExamsInAppend,
  parseLatestLabResultAt,
  parsePrescribedExamsByKind,
  mergeHospitalisationDaysInNotes,
  parsePrescribedExamCommentsByKind,
  type ExamKindSlug,
} from "../lib/lab-notes.js";
import {
  ensureHospitalizationFromReferral,
  HOSPITALISATION_PRESCRIPTION_LABEL,
} from "../lib/hospitalization-referral.js";
import {
  isLabPanelSlug,
  parseLabPanelDoctorComments,
  parseLabPanelResults,
  parseLabPanelReceivedAt,
  upsertLabPanelDoctorComment,
} from "../lib/lab-panel-results.js";
import {
  doctorUsesQuota,
  serializeDoctorFields,
  computeConsultationShares,
} from "../lib/doctor-compensation.js";
import {
  medecinDejaConsulteVisitWhere,
  medecinMatchWhere,
  medecinPendingConsultationVisitWhere,
  medecinPrescribedTodayVisitWhere,
  visitBelongsToDoctor,
} from "../lib/medecin-queues.js";
import { computeLabExamsGrossFcfa } from "../lib/lab-exam-prices.js";
import { isExemptPatient, shouldCreateImmediateInvoice } from "../lib/patient-billing.js";
import { getMedecinDossierPatients } from "../lib/patient-medical-record.js";
import { requireAuth, requireModule } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth, requireModule("consultation"));

const consultationSchema = z.object({
  visitId: z.string(),
  diagnosis: z.string().optional(),
  clinicalNotes: z.string().optional(),
  needsSurgery: z.boolean().default(false),
  needsHospitalization: z.boolean().default(false),
});

const examsByKindSchema = z.object({
  examen: z.array(z.string().min(1)).default([]),
  radio: z.array(z.string().min(1)).default([]),
  echo: z.array(z.string().min(1)).default([]),
  odonto: z.array(z.string().min(1)).default([]),
  operation: z.array(z.string().min(1)).default([]),
  hospitalisation: z.array(z.string().min(1)).default([]),
});

const examCommentsByKindSchema = z.object({
  examen: z.string().max(2000).optional(),
  radio: z.string().max(2000).optional(),
  echo: z.string().max(2000).optional(),
  odonto: z.string().max(2000).optional(),
  operation: z.string().max(2000).optional(),
  hospitalisation: z.string().max(2000).optional(),
});

const prescribeExamsSchema = z
  .object({
    visitId: z.string(),
    exams: z.array(z.string().min(1)).optional(),
    examsByKind: examsByKindSchema.optional(),
    examCommentsByKind: examCommentsByKindSchema.optional(),
    doctorComment: z.string().max(5000).optional(),
    hospitalisationDays: z.number().int().min(1).max(365).optional(),
    notes: z.string().optional(),
    append: z.boolean().optional().default(false),
  })
  .refine(
    (data) => {
      if (data.append) {
        if (data.examsByKind) {
          return flattenPrescribedExams(data.examsByKind as Record<ExamKindSlug, string[]>).length > 0;
        }
        return (data.exams?.length ?? 0) > 0;
      }
      const hasExams = data.examsByKind
        ? flattenPrescribedExams(data.examsByKind as Record<ExamKindSlug, string[]>).length > 0
        : (data.exams?.length ?? 0) > 0;
      const hasComment = (data.doctorComment?.trim().length ?? 0) >= 2;
      return hasExams || hasComment;
    },
    { message: "Sélectionnez au moins un examen ou saisissez un commentaire." },
  );

async function syncPrescribedProcedures(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  visitId: string,
  examsByKind: Partial<Record<ExamKindSlug, string[]>>,
  doctorId: string,
) {
  const operationLabel = examsByKind.operation?.find(Boolean);
  if (operationLabel) {
    const intervention = await tx.interventionType.findFirst({
      where: { label: operationLabel, active: true },
    });
    if (intervention) {
      const surgeonShare = Math.round(
        (intervention.totalCostFcfa * intervention.surgeonPercent) / 100,
      );
      await tx.surgeryCase.upsert({
        where: { visitId },
        update: {
          interventionTypeId: intervention.id,
          surgeonId: doctorId,
          totalCostFcfa: intervention.totalCostFcfa,
          surgeonShareFcfa: surgeonShare,
          clinicShareFcfa: intervention.totalCostFcfa - surgeonShare,
          status: SurgeryStatus.NOTIFIED,
        },
        create: {
          visitId,
          interventionTypeId: intervention.id,
          surgeonId: doctorId,
          totalCostFcfa: intervention.totalCostFcfa,
          surgeonShareFcfa: surgeonShare,
          clinicShareFcfa: intervention.totalCostFcfa - surgeonShare,
          status: SurgeryStatus.NOTIFIED,
        },
      });
      await tx.consultation.update({
        where: { visitId },
        data: { needsSurgery: true },
      });
    }
  }

  const hospitalisationLabel = examsByKind.hospitalisation?.find(Boolean);
  if (hospitalisationLabel || (examsByKind.hospitalisation?.length ?? 0) > 0) {
    await ensureHospitalizationFromReferral(tx, visitId, hospitalisationLabel);
    await tx.consultation.update({
      where: { visitId },
      data: { needsHospitalization: true },
    });
  }
}

router.get("/medecin-stats", async (req, res) => {
  const doctorId = req.user!.id;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const prescribedTodayWhere = medecinPrescribedTodayVisitWhere(doctorId, startOfToday);

  const [
    consultationToday,
    dejaConsulteToday,
    labsWaitingToday,
    labsResultsToday,
    myPatientsToday,
    userWithEmployee,
    associePatientsToday,
    consultationsTotalToday,
    dossierPatientsCount,
  ] = await Promise.all([
    prisma.visit.count({
      where: {
        createdAt: { gte: startOfToday },
        ...medecinPendingConsultationVisitWhere(doctorId),
      },
    }),
    prisma.visit.count({
      where: medecinDejaConsulteVisitWhere(doctorId),
    }),
    prisma.consultation.count({
      where: labsWaitingWhere(doctorId),
    }),
    prisma.consultation.count({
      where: {
        doctorId,
        updatedAt: { gte: startOfToday },
        clinicalNotes: { contains: LAB_RESULTS_PREFIX },
      },
    }),
    prisma.visit.count({
      where: {
        createdAt: { gte: startOfToday },
        status: { in: [VisitStatus.WAITING_CONSULTATION, VisitStatus.IN_CONSULTATION] },
        OR: [
          { assignedDoctorId: doctorId },
          { consultation: { is: { doctorId } } },
        ],
      },
    }),
    prisma.user.findUnique({
      where: { id: doctorId },
      select: {
        role: true,
        employee: {
          select: {
            isMedecin: true,
            doctorCompensationType: true,
            consultationTotalFcfa: true,
            consultationQuotaMode: true,
            consultationQuotaPercent: true,
            consultationQuotaFcfa: true,
          },
        },
      },
    }),
    prisma.visit.count({
      where: {
        ...prescribedTodayWhere,
        patient: { category: PatientCategory.ASSOCIE },
      },
    }),
    prisma.visit.count({ where: prescribedTodayWhere }),
    getMedecinDossierPatients(doctorId).then((rows) => rows.length),
  ]);

  const doctorProfile = {
    role: userWithEmployee!.role,
    employee: userWithEmployee!.employee,
  };
  const quotaFields = serializeDoctorFields(doctorProfile);
  const hasQuota = doctorUsesQuota(doctorProfile);
  const consultationFee = quotaFields.consultationTotalFcfa ?? 0;
  const consultationsGrossFcfa =
    hasQuota && consultationFee > 0
      ? consultationsTotalToday * consultationFee
      : null;
  const consultationsDoctorShareFcfa =
    hasQuota && consultationsGrossFcfa != null
      ? computeConsultationShares(
          consultationsGrossFcfa,
          quotaFields.consultationQuotaPercent ?? 0,
          quotaFields.consultationQuotaFcfa,
          quotaFields.consultationQuotaMode,
          doctorProfile,
        ).doctorShareFcfa
      : null;

  return res.json({
    consultationToday,
    dejaConsulteToday,
    labsWaitingToday,
    labsResultsToday,
    myPatientsToday,
    associePatientsToday,
    hasQuota,
    consultationsTotalToday: hasQuota ? consultationsTotalToday : null,
    consultationsGrossFcfa,
    consultationsDoctorShareFcfa,
    consultationTotalFcfa: quotaFields.consultationTotalFcfa,
    consultationQuotaMode: quotaFields.consultationQuotaMode,
    consultationQuotaPercent: quotaFields.consultationQuotaPercent,
    consultationQuotaFcfa: quotaFields.consultationQuotaFcfa,
    dossierPatientsCount,
  });
});

router.get("/labs-en-attente", async (req, res) => {
  const doctorId = req.user!.id;

  const visits = await prisma.visit.findMany({
    where: {
      AND: [medecinMatchWhere(doctorId), { consultation: { is: labsWaitingWhere() } }],
    },
    include: {
      patient: true,
      assignedDoctor: { select: { id: true, firstName: true, lastName: true } },
      vitalSigns: { orderBy: { recordedAt: "desc" }, take: 1 },
      consultation: {
        include: {
          labApprovedBy: { select: { firstName: true, lastName: true } },
        },
      },
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });

  return res.json(visits);
});

router.get("/labs-resultats", async (req, res) => {
  const doctorId = req.user!.id;

  const visits = await prisma.visit.findMany({
    where: {
      AND: [medecinMatchWhere(doctorId), { consultation: { is: labsResultsWhere() } }],
    },
    include: {
      patient: true,
      assignedDoctor: { select: { id: true, firstName: true, lastName: true } },
      vitalSigns: { orderBy: { recordedAt: "desc" }, take: 1 },
      consultation: true,
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });

  return res.json(visits);
});

router.get("/labs-resultats/:visitId", async (req, res) => {
  const doctorId = req.user!.id;

  const visit = await prisma.visit.findFirst({
    where: {
      id: String(req.params.visitId),
      AND: [medecinMatchWhere(doctorId), { consultation: { is: labsResultsWhere() } }],
    },
    include: {
      patient: true,
      assignedDoctor: { select: { id: true, firstName: true, lastName: true } },
      vitalSigns: { orderBy: { recordedAt: "desc" }, take: 1 },
      consultation: {
        include: {
          doctor: { select: { firstName: true, lastName: true } },
          labApprovedBy: { select: { firstName: true, lastName: true } },
        },
      },
    },
  });

  if (!visit?.consultation) {
    return res.status(404).json({ error: "Résultats laboratoire introuvables" });
  }

  return res.json({
    visit,
    panelResults: parseLabPanelResults(visit.consultation.clinicalNotes),
    panelReceivedAt: parseLabPanelReceivedAt(visit.consultation.clinicalNotes),
    panelDoctorComments: parseLabPanelDoctorComments(visit.consultation.clinicalNotes),
    latestResultAt: parseLatestLabResultAt(visit.consultation.clinicalNotes)?.toISOString() ?? null,
    completed: hasLabResults(visit.consultation.clinicalNotes),
  });
});

const panelDoctorCommentSchema = z.object({
  comment: z.string().max(5000),
});

router.patch("/labs-resultats/:visitId/panels/:panelSlug/comment", async (req, res) => {
  try {
    const doctorId = req.user!.id;
    const visitId = String(req.params.visitId);
    const panelSlug = String(req.params.panelSlug);

    if (!isLabPanelSlug(panelSlug)) {
      return res.status(400).json({ error: "Formulaire laboratoire invalide" });
    }

    const body = panelDoctorCommentSchema.parse(req.body);

    const visit = await prisma.visit.findFirst({
      where: {
        id: visitId,
        AND: [medecinMatchWhere(doctorId), { consultation: { is: labsResultsWhere() } }],
      },
      include: { consultation: true },
    });

    if (!visit?.consultation) {
      return res.status(404).json({ error: "Résultats laboratoire introuvables" });
    }

    const panelResults = parseLabPanelResults(visit.consultation.clinicalNotes);
    if (!panelResults[panelSlug]) {
      return res.status(400).json({ error: "Aucun résultat enregistré pour ce formulaire" });
    }

    const clinicalNotes = upsertLabPanelDoctorComment(
      visit.consultation.clinicalNotes,
      panelSlug,
      body.comment,
      doctorId,
    );

    const consultation = await prisma.consultation.update({
      where: { visitId },
      data: { clinicalNotes },
    });

    return res.json({
      panelSlug,
      panelDoctorComments: parseLabPanelDoctorComments(consultation.clinicalNotes),
    });
  } catch {
    return res.status(400).json({ error: "Données invalides" });
  }
});

router.post("/prescribe-exams", async (req, res) => {
  try {
    const body = prescribeExamsSchema.parse(req.body);
    const user = req.user!;

    const result = await prisma.$transaction(async (tx) => {
      const visit = await tx.visit.findUnique({
        where: { id: body.visitId },
        include: { consultation: true, patient: true },
      });
      if (!visit) throw new Error("VISIT_NOT_FOUND");

      if (!visitBelongsToDoctor(visit, user.id)) {
        throw new Error("NOT_AUTHORIZED");
      }

      if (
        visit.consultation &&
        hasExamsPrescribed(visit.consultation.clinicalNotes) &&
        visit.consultation.doctorId !== user.id
      ) {
        throw new Error("NOT_AUTHORIZED");
      }

      if (visit.status === VisitStatus.WAITING_CONSULTATION) {
        await tx.visit.update({
          where: { id: body.visitId },
          data: { status: VisitStatus.IN_CONSULTATION },
        });
      }

      const existingNotes = visit.consultation?.clinicalNotes;

      if (
        !body.append &&
        existingNotes &&
        hasExamsPrescribed(existingNotes) &&
        (visit.consultation?.labSentToLabAt || hasLabResults(existingNotes))
      ) {
        throw new Error("ALREADY_SENT_TO_LAB");
      }

      let examsByKind = body.examsByKind;
      let examCommentsByKind = body.examCommentsByKind;

      if (body.append && body.examsByKind) {
        const existingByKind = parsePrescribedExamsByKind(existingNotes);
        const existingComments = parsePrescribedExamCommentsByKind(existingNotes);
        const newCount = countNewExamsInAppend(existingNotes, body.examsByKind);
        if (newCount === 0) {
          throw new Error("NO_NEW_EXAMS");
        }
        examsByKind = mergeExamsByKind(existingByKind, body.examsByKind);
        examCommentsByKind = {
          ...existingComments,
          ...Object.fromEntries(
            Object.entries(body.examCommentsByKind ?? {}).filter(([, value]) => value?.trim()),
          ),
        };
      }

      const doctorComment = body.doctorComment?.trim() || null;
      if ((examsByKind?.hospitalisation?.length ?? 0) > 0) {
        examsByKind = {
          ...examsByKind!,
          hospitalisation: [HOSPITALISATION_PRESCRIPTION_LABEL],
        };
      }
      const hasHospitalisation = (examsByKind?.hospitalisation?.length ?? 0) > 0;
      if (hasHospitalisation && body.hospitalisationDays != null && body.hospitalisationDays < 1) {
        throw new Error("INVALID_HOSPITALISATION_DAYS");
      }
      const hasExams = examsByKind
        ? flattenPrescribedExams(examsByKind).length > 0
        : (body.exams?.length ?? 0) > 0;

      const notes = hasExams
        ? examsByKind
          ? buildPrescribedExamsNotesByKind(
              examsByKind,
              existingNotes,
              body.notes,
              examCommentsByKind,
            )
          : buildPrescribedExamsNotes(body.exams ?? [], existingNotes, body.notes)
        : existingNotes;

      const clinicalNotes =
        hasHospitalisation && body.hospitalisationDays
          ? mergeHospitalisationDaysInNotes(notes ?? "", body.hospitalisationDays)
          : notes;

      const consultation = await tx.consultation.upsert({
        where: { visitId: body.visitId },
        update: {
          doctorId: user.id,
          ...(hasExams ? { clinicalNotes } : {}),
          ...(doctorComment ? { doctorComment } : {}),
          ...(shouldCreateImmediateInvoice(visit.patient.category) && hasExams && !body.append
            ? { labSentToLabAt: null, labApprovedById: null }
            : {}),
        },
        create: {
          visitId: body.visitId,
          doctorId: user.id,
          clinicalNotes: clinicalNotes ?? notes,
          doctorComment,
          needsSurgery: false,
          needsHospitalization: false,
        },
      });

      if (hasExams && examsByKind) {
        await syncPrescribedProcedures(tx, body.visitId, examsByKind, user.id);
      }

      if (!hasExams && doctorComment) {
        const completed = await tx.consultation.update({
          where: { id: consultation.id },
          data: { completedAt: new Date() },
        });
        await tx.visit.update({
          where: { id: body.visitId },
          data: { status: VisitStatus.COMPLETED },
        });
        return completed;
      }

      if (!shouldCreateImmediateInvoice(visit.patient.category) && hasExams) {
        const grossFcfa = computeLabExamsGrossFcfa(notes);
        const consultationAfterLab = await tx.consultation.update({
          where: { id: consultation.id },
          data: {
            labSentToLabAt: new Date(),
            labApprovedById: user.id,
            labExamReductionFcfa: isExemptPatient(visit.patient.category) ? grossFcfa : 0,
          },
        });
        return consultationAfterLab;
      }

      return consultation;
    });

    return res.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === "VISIT_NOT_FOUND") {
      return res.status(404).json({ error: "Visite introuvable" });
    }
    if (error instanceof Error && error.message === "NOT_AUTHORIZED") {
      return res.status(403).json({ error: "Vous ne pouvez pas modifier cette consultation." });
    }
    if (error instanceof Error && error.message === "NO_NEW_EXAMS") {
      return res.status(400).json({
        error: "Sélectionnez au moins un nouvel examen à ajouter.",
      });
    }
    if (error instanceof Error && error.message === "ALREADY_SENT_TO_LAB") {
      return res.status(409).json({
        error: "Ce dossier est déjà au laboratoire ou validé — utilisez « Ajouter des examens » pour compléter la prescription.",
      });
    }
    if (error instanceof Error && error.message === "INVALID_HOSPITALISATION_DAYS") {
      return res.status(400).json({
        error: "Indiquez le nombre de jours d'hospitalisation.",
      });
    }
    return res.status(400).json({ error: "Données invalides" });
  }
});

router.post("/", async (req, res) => {
  try {
    const body = consultationSchema.parse(req.body);
    const user = req.user!;

    const result = await prisma.$transaction(async (tx) => {
      const visit = await tx.visit.findUnique({ where: { id: body.visitId } });
      if (!visit) throw new Error("VISIT_NOT_FOUND");

      const consultation = await tx.consultation.upsert({
        where: { visitId: body.visitId },
        update: {
          diagnosis: body.diagnosis,
          clinicalNotes: body.clinicalNotes,
          needsSurgery: body.needsSurgery,
          needsHospitalization: body.needsHospitalization,
          completedAt: new Date(),
        },
        create: {
          visitId: body.visitId,
          doctorId: user.id,
          diagnosis: body.diagnosis,
          clinicalNotes: body.clinicalNotes,
          needsSurgery: body.needsSurgery,
          needsHospitalization: body.needsHospitalization,
          completedAt: new Date(),
        },
      });

      let nextStatus: VisitStatus = VisitStatus.COMPLETED;
      if (body.needsSurgery) nextStatus = VisitStatus.NEEDS_SURGERY;
      else if (body.needsHospitalization) nextStatus = VisitStatus.NEEDS_HOSPITALIZATION;

      await tx.visit.update({ where: { id: body.visitId }, data: { status: nextStatus } });

      if (body.needsSurgery) {
        const defaultIntervention = await tx.interventionType.findFirst({
          where: { active: true },
          orderBy: { category: "asc" },
        });
        if (defaultIntervention) {
          const surgeonShare = Math.round(
            (defaultIntervention.totalCostFcfa * defaultIntervention.surgeonPercent) / 100,
          );
          await tx.surgeryCase.upsert({
            where: { visitId: body.visitId },
            update: {
              interventionTypeId: defaultIntervention.id,
              surgeonId: user.id,
              totalCostFcfa: defaultIntervention.totalCostFcfa,
              surgeonShareFcfa: surgeonShare,
              clinicShareFcfa: defaultIntervention.totalCostFcfa - surgeonShare,
              status: SurgeryStatus.NOTIFIED,
            },
            create: {
              visitId: body.visitId,
              interventionTypeId: defaultIntervention.id,
              surgeonId: user.id,
              totalCostFcfa: defaultIntervention.totalCostFcfa,
              surgeonShareFcfa: surgeonShare,
              clinicShareFcfa: defaultIntervention.totalCostFcfa - surgeonShare,
              status: SurgeryStatus.NOTIFIED,
            },
          });
        }
      }

      if (body.needsHospitalization) {
        await ensureHospitalizationFromReferral(tx, body.visitId);
      }

      return consultation;
    });

    return res.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === "VISIT_NOT_FOUND") {
      return res.status(404).json({ error: "Visite introuvable" });
    }
    return res.status(400).json({ error: "Données invalides" });
  }
});

export default router;
