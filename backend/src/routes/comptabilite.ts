import { Router } from "express";
import { computeSurgeryShares, resolveSurgeonPercent } from "../lib/doctor-compensation.js";
import { z } from "zod";
import {
  ExamReclamationReason,
  ExamReclamationStatus,
  HospitalizationStatus,
  InvoiceStatus,
  InvoiceType,
  PatientCategory,
  Prisma,
  SurgeryStatus,
  VisitStatus,
} from "@prisma/client";
import { prisma } from "../lib/db.js";
import {
  appendPaidExamKindMarker,
  getUnpaidPrescribedExamKinds,
  getUnpaidCashierQueueKinds,
  hasUnpaidCashierQueueExams,
  isExamKindPaid,
  labsPendingApprovalWhere,
  labsPaidExamsWhere,
  parsePaidExamKindsByKind,
  parsePrescribedExamsByKind,
  EXAMS_PRESCRIBED_PREFIX,
  LAB_BILLABLE_EXAM_KINDS,
} from "../lib/lab-notes.js";
import {
  ensureHospitalizationFromReferral,
  isHospitalizationPendingAdmission,
  syncHospitalizationReferralsFromPaymentQueue,
  syncMissingHospitalizationReferrals,
} from "../lib/hospitalization-referral.js";
import {
  buildExamLinesFromNotes,
  buildExamsByKindPayload,
  buildExamSheetsByKind,
  computeExamNetFcfa,
  emptyExamReductionsByKind,
  normalizeExamReductionsByKind,
  sumExamReductionsByKind,
  type ExamKindSlug,
} from "../lib/exam-billing.js";
import {
  computeLabExamsGrossFcfa,
} from "../lib/lab-exam-prices.js";
import { generateInvoiceNumber, generateInvoiceNumberBatch } from "../lib/patient-code.js";
import {
  applyExamReclamationRefund,
  ReclamationRefundError,
} from "../lib/exam-reclamation-refund.js";
import { assertRoomAvailableForAdmission } from "../lib/hospitalization-rooms.js";
import { shouldCreateImmediateInvoice, comptabilitePatientWhere } from "../lib/patient-billing.js";
import {
  aggregateCollectedToday,
  buildRevenueLast7Days,
} from "../lib/revenue-stats.js";
import { canAccessModule, type AppUserRole } from "../lib/roles.js";
import { requireAuth, requireAnyModule } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

const cashierAccess = requireAnyModule("comptabilite", "reception");

const surgeryPaymentSchema = z.object({
  surgeryCaseId: z.string(),
  interventionTypeId: z.string(),
  surgeonId: z.string(),
});

const hospitalizationSchema = z.object({
  hospitalizationId: z.string(),
  roomId: z.string(),
  depositFcfa: z.number().int().positive(),
});

const dischargeSchema = z.object({
  hospitalizationId: z.string(),
  endDate: z.string(),
});

const examKindSchema = z.enum([
  "examen",
  "radio",
  "echo",
  "odonto",
  "operation",
  "hospitalisation",
]);

const payLabExamsSchema = z.object({
  consultationId: z.string(),
  kinds: z.array(examKindSchema).min(1),
  reductionsByKind: z
    .object({
      examen: z.number().int().min(0).optional(),
      radio: z.number().int().min(0).optional(),
      echo: z.number().int().min(0).optional(),
      odonto: z.number().int().min(0).optional(),
      operation: z.number().int().min(0).optional(),
      hospitalisation: z.number().int().min(0).optional(),
    })
    .optional(),
  reductionFcfa: z.number().int().min(0).optional(),
});

const examReclamationReasonSchema = z.enum([
  "EXAM_MISSING",
  "RESULT_MISSING",
  "ERROR",
  "OTHER",
]);

const examReclamationStatusSchema = z.enum([
  "PENDING",
  "IN_PROGRESS",
  "REFUNDED",
  "REJECTED",
]);

const examReclamationLineSchema = z.object({
  examKind: examKindSchema,
  examLabel: z.string().min(1),
  unitPriceFcfa: z.coerce
    .number()
    .transform((value) => Math.floor(value))
    .pipe(z.number().int().min(0)),
});

const createExamReclamationSchema = z.object({
  consultationId: z.string(),
  exams: z.array(examReclamationLineSchema).min(1).max(50),
  reason: examReclamationReasonSchema,
  reasonDetail: z.string().max(2000).optional(),
});

const updateExamReclamationSchema = z.object({
  status: examReclamationStatusSchema,
});

function filterExamsByKindUnpaid(
  notes: string | null | undefined,
  examsByKind: ReturnType<typeof buildExamsByKindPayload>,
  unpaidOnly: boolean,
) {
  if (!unpaidOnly) return examsByKind;
  const unpaidKinds = new Set(getUnpaidPrescribedExamKinds(notes));
  const filtered = {} as ReturnType<typeof buildExamsByKindPayload>;
  for (const kind of Object.keys(examsByKind) as ExamKindSlug[]) {
    if (!unpaidKinds.has(kind)) continue;
    filtered[kind] = examsByKind[kind];
  }
  return filtered;
}

function mapLabExamPending(
  consultation: {
  id: string;
  visitId: string;
  clinicalNotes: string | null;
  updatedAt: Date;
  visit: { patient: { code: string; firstName: string; lastName: string; phone?: string | null } };
  doctor: { firstName: string; lastName: string } | null;
},
  options?: { unpaidOnly?: boolean },
) {
  const unpaidOnly = options?.unpaidOnly ?? true;
  const allExamsByKind = buildExamsByKindPayload(consultation.clinicalNotes);
  const examsByKind = filterExamsByKindUnpaid(
    consultation.clinicalNotes,
    allExamsByKind,
    unpaidOnly,
  );
  const examLines = buildExamLinesFromNotes(consultation.clinicalNotes).filter(
    (line) => !unpaidOnly || !isExamKindPaid(consultation.clinicalNotes, line.kind),
  );
  const grossFcfa = examLines.reduce((sum, line) => sum + line.unitPriceFcfa, 0);
  const paidKinds = Object.keys(parsePaidExamKindsByKind(consultation.clinicalNotes)) as ExamKindSlug[];
  const unpaidKinds = getUnpaidPrescribedExamKinds(consultation.clinicalNotes);
  return {
    ...consultation,
    allExamsByKind,
    examsByKind,
    examLines,
    grossFcfa,
    paidKinds,
    unpaidKinds,
    examsSummary: examLines.map((line) => line.label).join(", "),
  };
}

function mapLabExamPaid(consultation: {
  id: string;
  visitId: string;
  clinicalNotes: string | null;
  updatedAt: Date;
  labSentToLabAt: Date | null;
  labExamReductionFcfa: number;
  visit: {
    patient: { code: string; firstName: string; lastName: string; phone?: string | null };
    invoices: Array<{
      invoiceNumber: string;
      amountFcfa: number;
      type: InvoiceType;
      createdAt: Date;
      issuedBy?: { firstName: string; lastName: string } | null;
    }>;
  };
  doctor: { firstName: string; lastName: string } | null;
}) {
  // Cause racine bug impression : unpaidOnly=true vidait examsByKind quand tout était payé.
  const base = mapLabExamPending(consultation, { unpaidOnly: false });
  const sheets = buildExamSheetsByKind(consultation.clinicalNotes);
  const labInvoices = consultation.visit.invoices
    .filter((invoice) => invoice.type === InvoiceType.LAB_EXAM)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  const invoicesByKind: Partial<
    Record<ExamKindSlug, { invoiceNumber: string; grossFcfa: number; reductionFcfa: number; netFcfa: number }>
  > = {};
  const reductionsByKind = emptyExamReductionsByKind();

  const paidAtByKind = parsePaidExamKindsByKind(consultation.clinicalNotes);
  const paidSheets = sheets.filter((sheet) => paidAtByKind[sheet.kind]);
  paidSheets.sort((a, b) => {
    const ta = paidAtByKind[a.kind]!.getTime();
    const tb = paidAtByKind[b.kind]!.getTime();
    if (ta !== tb) return ta - tb;
    return sheets.findIndex((s) => s.kind === a.kind) - sheets.findIndex((s) => s.kind === b.kind);
  });

  paidSheets.forEach((sheet, index) => {
    const invoice = labInvoices[index];
    const reductionFcfa = invoice
      ? Math.max(0, sheet.grossFcfa - invoice.amountFcfa)
      : 0;
    reductionsByKind[sheet.kind] = reductionFcfa;
    if (invoice) {
      invoicesByKind[sheet.kind] = {
        invoiceNumber: invoice.invoiceNumber,
        grossFcfa: sheet.grossFcfa,
        reductionFcfa,
        netFcfa: invoice.amountFcfa,
      };
    }
  });

  return {
    ...base,
    paidAt: consultation.labSentToLabAt,
    labExamReductionFcfa: consultation.labExamReductionFcfa,
    invoicesByKind,
    reductionsByKind,
    cashierName: labInvoices[0]?.issuedBy
      ? `${labInvoices[0].issuedBy.firstName} ${labInvoices[0].issuedBy.lastName}`.trim()
      : null,
  };
}

router.get("/stats", cashierAccess, async (_req, res) => {
  const patientWhere = comptabilitePatientWhere();
  await syncMissingHospitalizationReferrals(prisma, patientWhere);
  await syncHospitalizationReferralsFromPaymentQueue(prisma, patientWhere);

  const [
    labExamsPending,
    collectedToday,
    surgeriesPending,
    hospitalizationsForStats,
  ] = await Promise.all([
    prisma.consultation.findMany({
      where: labsPendingApprovalWhere(),
      select: { clinicalNotes: true },
    }).then(rows => rows.filter(row => hasUnpaidCashierQueueExams(row.clinicalNotes))),
    aggregateCollectedToday(),
    prisma.surgeryCase.count({
      where: {
        status: { in: [SurgeryStatus.NOTIFIED, SurgeryStatus.QUOTED] },
        visit: { patient: comptabilitePatientWhere() },
      },
    }),
    prisma.hospitalization.findMany({
      where: {
        status: {
          in: [
            HospitalizationStatus.REQUESTED,
            HospitalizationStatus.RESERVED,
            HospitalizationStatus.ACTIVE,
          ],
        },
        visit: { patient: comptabilitePatientWhere() },
      },
      select: { status: true, roomId: true, startDate: true },
    }),
  ]);

  const hospitalizationsPending = hospitalizationsForStats.filter(isHospitalizationPendingAdmission).length;

  const labPendingGrossFcfa = labExamsPending.reduce(
    (sum, row) => sum + computeLabExamsGrossFcfa(row.clinicalNotes),
    0,
  );

  return res.json({
    labPendingCount: labExamsPending.length,
    labPendingGrossFcfa,
    labPaidTodayCount: collectedToday.examsCount,
    labPaidTodayNetFcfa: collectedToday.examsFcfa,
    consultationsTodayCount: collectedToday.consultationsCount,
    consultationsTodayNetFcfa: collectedToday.consultationsFcfa,
    surgeryPaidTodayCount: collectedToday.surgeryCount,
    surgeryPaidTodayNetFcfa: collectedToday.surgeryFcfa,
    hospitalizationPaidTodayCount: collectedToday.hospitalizationCount,
    hospitalizationPaidTodayNetFcfa: collectedToday.hospitalizationFcfa,
    surgeriesPending,
    hospitalizationsPending,
    collectedTodayTotalFcfa: collectedToday.totalFcfa,
    revenueLast7Days: await buildRevenueLast7Days(),
  });
});

router.get("/", cashierAccess, async (req, res) => {
  const patientWhere = comptabilitePatientWhere();
  await syncMissingHospitalizationReferrals(prisma, patientWhere);
  await syncHospitalizationReferralsFromPaymentQueue(prisma, patientWhere);

  const surgeriesScope = req.query.surgeriesScope === "authorized" ? "authorized" : "pending";
  const surgeryStatusFilter =
    surgeriesScope === "authorized"
      ? [SurgeryStatus.PAID, SurgeryStatus.AUTHORIZED, SurgeryStatus.IN_PROGRESS]
      : [SurgeryStatus.NOTIFIED, SurgeryStatus.QUOTED];

  const [surgeries, hospitalizations, interventionTypes, surgeons, rooms, labExamsPending] =
    await Promise.all([
    prisma.surgeryCase.findMany({
      where: {
        status: { in: surgeryStatusFilter },
        visit: { patient: comptabilitePatientWhere() },
      },
      include: {
        visit: { include: { patient: true } },
        interventionType: true,
        surgeon: true,
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.hospitalization.findMany({
      where: {
        status: {
          in: [HospitalizationStatus.REQUESTED, HospitalizationStatus.RESERVED, HospitalizationStatus.ACTIVE],
        },
        visit: { patient: comptabilitePatientWhere() },
      },
      include: {
        visit: { include: { patient: true } },
        room: true,
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.interventionType.findMany({ where: { active: true } }),
    prisma.user.findMany({
      where: { role: "MEDECIN", active: true },
      select: { id: true, firstName: true, lastName: true },
    }),
    prisma.room.findMany({
      where: { active: true },
      orderBy: [{ type: "asc" }, { name: "asc" }],
    }),
    prisma.consultation.findMany({
      where: labsPendingApprovalWhere(),
      include: {
        visit: {
          include: {
            patient: true,
            surgeryCase: { select: { status: true } },
          },
        },
        doctor: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { updatedAt: "asc" },
    }),
  ]);

  return res.json({
    surgeries,
    hospitalizations,
    interventionTypes,
    surgeons,
    rooms,
    labExamsPending: labExamsPending
      .filter((row) => {
        if (!hasUnpaidCashierQueueExams(row.clinicalNotes)) return false;
        const surgeryStatus = row.visit.surgeryCase?.status;
        const unpaidOps = getUnpaidPrescribedExamKinds(row.clinicalNotes).includes("operation");
        if (
          unpaidOps &&
          surgeryStatus &&
          [SurgeryStatus.PAID, SurgeryStatus.AUTHORIZED, SurgeryStatus.IN_PROGRESS, SurgeryStatus.COMPLETED].includes(
            surgeryStatus,
          )
        ) {
          return getUnpaidCashierQueueKinds(row.clinicalNotes).some((kind) => kind !== "operation");
        }
        return true;
      })
      .map((row) => mapLabExamPending(row)),
  });
});

router.get("/paid-exams", cashierAccess, async (_req, res) => {
  const labExamsPaid = await prisma.consultation.findMany({
    where: labsPaidExamsWhere(),
    include: {
      visit: {
        include: {
          patient: true,
          invoices: {
            where: { type: InvoiceType.LAB_EXAM, status: InvoiceStatus.PAID },
            select: {
              invoiceNumber: true,
              amountFcfa: true,
              type: true,
              createdAt: true,
              issuedBy: { select: { firstName: true, lastName: true } },
            },
            orderBy: { createdAt: "asc" },
          },
        },
      },
      doctor: { select: { id: true, firstName: true, lastName: true } },
      labApprovedBy: { select: { firstName: true, lastName: true } },
    },
    orderBy: { labSentToLabAt: "desc" },
  });

  return res.json(labExamsPaid.map(mapLabExamPaid));
});

router.post("/", cashierAccess, async (req, res) => {
  const user = req.user!;
  const action = req.body.action as string;
  const isReceptionOnly =
    canAccessModule(user.role as AppUserRole, "reception") &&
    !canAccessModule(user.role as AppUserRole, "comptabilite");

  if (isReceptionOnly && action !== "pay_lab_exams") {
    return res.status(403).json({ error: "Accès refusé" });
  }

  try {
    if (action === "pay_surgery") {
      const data = surgeryPaymentSchema.parse(req.body);
      const intervention = await prisma.interventionType.findUniqueOrThrow({
        where: { id: data.interventionTypeId },
      });
      const surgeon = await prisma.user.findUnique({
        where: { id: data.surgeonId },
        select: {
          role: true,
          employee: {
            select: {
              isMedecin: true,
              doctorCompensationType: true,
              surgeryQuotaPercent: true,
            },
          },
        },
      });
      const surgeonPercent = surgeon
        ? resolveSurgeonPercent(intervention.surgeonPercent, surgeon)
        : intervention.surgeonPercent;
      const { surgeonShareFcfa: surgeonShare, clinicShareFcfa: clinicShare } = computeSurgeryShares(
        intervention.totalCostFcfa,
        surgeonPercent,
        surgeon ?? { role: "MEDECIN" },
      );

      const result = await prisma.$transaction(async (tx) => {
        const surgery = await tx.surgeryCase.update({
          where: { id: data.surgeryCaseId },
          data: {
            interventionTypeId: data.interventionTypeId,
            surgeonId: data.surgeonId,
            accountantId: user.id,
            totalCostFcfa: intervention.totalCostFcfa,
            surgeonShareFcfa: surgeonShare,
            clinicShareFcfa: clinicShare,
            status: SurgeryStatus.PAID,
            paidAt: new Date(),
            authorizedAt: new Date(),
          },
          include: { visit: true },
        });
        const invoice = await tx.invoice.create({
          data: {
            invoiceNumber: await generateInvoiceNumber(),
            patientId: surgery.visit.patientId,
            visitId: surgery.visitId,
            surgeryCaseId: surgery.id,
            type: InvoiceType.SURGERY,
            amountFcfa: intervention.totalCostFcfa,
            status: InvoiceStatus.PAID,
            issuedById: user.id,
            paidAt: new Date(),
          },
        });
        await tx.visit.update({ where: { id: surgery.visitId }, data: { status: VisitStatus.IN_TREATMENT } });
        return { surgery, invoice };
      });
      return res.json(result);
    }

    if (action === "reserve_room" || action === "reserve_bed") {
      const data = hospitalizationSchema.parse(req.body);
      const result = await prisma.$transaction(async (tx) => {
        const room = await assertRoomAvailableForAdmission(tx, data.roomId, data.hospitalizationId);

        const hospitalization = await tx.hospitalization.update({
          where: { id: data.hospitalizationId },
          data: {
            roomId: data.roomId,
            accountantId: user.id,
            roomType: room.type,
            dailyRateFcfa: room.dailyRateFcfa,
            depositFcfa: data.depositFcfa,
            status: HospitalizationStatus.ACTIVE,
            startDate: new Date(),
            paidAt: new Date(),
          },
          include: { visit: true, room: true },
        });
        const invoice = await tx.invoice.create({
          data: {
            invoiceNumber: await generateInvoiceNumber(),
            patientId: hospitalization.visit.patientId,
            visitId: hospitalization.visitId,
            hospitalizationId: hospitalization.id,
            type: InvoiceType.HOSPITALIZATION_DEPOSIT,
            amountFcfa: data.depositFcfa,
            status: InvoiceStatus.PAID,
            issuedById: user.id,
            paidAt: new Date(),
          },
        });
        await tx.visit.update({ where: { id: hospitalization.visitId }, data: { status: VisitStatus.IN_TREATMENT } });
        return { hospitalization, invoice };
      });
      return res.json(result);
    }

    if (action === "discharge") {
      const data = dischargeSchema.parse(req.body);
      const endDate = new Date(data.endDate);
      const result = await prisma.$transaction(async (tx) => {
        const hospitalization = await tx.hospitalization.findUniqueOrThrow({
          where: { id: data.hospitalizationId },
          include: { visit: true, room: true },
        });
        if (!hospitalization.startDate || !hospitalization.roomId) throw new Error("INVALID_HOSPITALIZATION");

        const nights = Math.max(
          1,
          Math.ceil((endDate.getTime() - hospitalization.startDate.getTime()) / (1000 * 60 * 60 * 24)),
        );
        const totalDue = nights * hospitalization.dailyRateFcfa;
        const balance = Math.max(0, totalDue - hospitalization.depositFcfa);

        const updated = await tx.hospitalization.update({
          where: { id: hospitalization.id },
          data: {
            endDate,
            nightsCount: nights,
            totalDueFcfa: totalDue,
            status: HospitalizationStatus.DISCHARGED,
            dischargedAt: new Date(),
            roomId: null,
          },
        });

        let invoice = null;
        if (balance > 0) {
          invoice = await tx.invoice.create({
            data: {
              invoiceNumber: await generateInvoiceNumber(),
              patientId: hospitalization.visit.patientId,
              visitId: hospitalization.visitId,
              hospitalizationId: hospitalization.id,
              type: InvoiceType.HOSPITALIZATION_FINAL,
              amountFcfa: balance,
              status: InvoiceStatus.PAID,
              issuedById: user.id,
              paidAt: new Date(),
            },
          });
        }
        await tx.visit.update({ where: { id: hospitalization.visitId }, data: { status: VisitStatus.COMPLETED } });
        return { hospitalization: updated, invoice, nights, totalDue, balance };
      });
      return res.json(result);
    }

    if (action === "pay_lab_exams") {
      const data = payLabExamsSchema.parse(req.body);
      const existing = await prisma.consultation.findUnique({
        where: { id: data.consultationId },
        include: { visit: { include: { patient: true } } },
      });
      if (!existing) return res.status(404).json({ error: "Consultation introuvable" });
      if (!shouldCreateImmediateInvoice(existing.visit.patient.category)) {
        return res.status(400).json({
          error: "Ce patient associé n'est pas soumis au paiement immédiat des examens.",
        });
      }
      if (!existing.clinicalNotes?.includes(EXAMS_PRESCRIBED_PREFIX)) {
        return res.status(400).json({ error: "Aucun examen prescrit pour cette consultation." });
      }

      const unpaidKinds = getUnpaidPrescribedExamKinds(existing.clinicalNotes);
      const kindsToPay = [...new Set(data.kinds)] as ExamKindSlug[];
      const invalidKind = kindsToPay.find(
        (kind) => !unpaidKinds.includes(kind),
      );
      if (invalidKind) {
        return res.status(409).json({
          error: `Le type « ${invalidKind} » n'est pas disponible au paiement (déjà payé ou non prescrit).`,
        });
      }

      const allSheets = buildExamSheetsByKind(existing.clinicalNotes);
      const sheets = allSheets.filter((sheet) => kindsToPay.includes(sheet.kind));
      if (!sheets.length) {
        return res.status(400).json({ error: "Aucun examen facturable pour les types sélectionnés." });
      }

      const grossFcfa = sheets.reduce((sum, sheet) => sum + sheet.grossFcfa, 0);
      const reductionsByKind = normalizeExamReductionsByKind(
        sheets,
        data.reductionsByKind,
        data.reductionFcfa,
      );
      const totalReductionFcfa = sumExamReductionsByKind(reductionsByKind, sheets);
      if (totalReductionFcfa > grossFcfa) {
        return res.status(400).json({ error: "La réduction totale ne peut pas dépasser le montant total." });
      }

      const netFcfa = computeExamNetFcfa(sheets, reductionsByKind);
      if (netFcfa < 0) {
        return res.status(400).json({ error: "Montant net invalide." });
      }

      const paysOperation = kindsToPay.includes("operation");
      const paysHospitalisation = kindsToPay.includes("hospitalisation");
      const paysLabKind = kindsToPay.some((kind) =>
        (LAB_BILLABLE_EXAM_KINDS as readonly ExamKindSlug[]).includes(kind),
      );
      const surgeryCase = paysOperation
        ? await prisma.surgeryCase.findUnique({ where: { visitId: existing.visitId } })
        : null;
      const hospitalization = paysHospitalisation
        ? await prisma.hospitalization.findUnique({ where: { visitId: existing.visitId } })
        : null;
      const hospitalisationLabel = paysHospitalisation
        ? parsePrescribedExamsByKind(existing.clinicalNotes).hospitalisation?.find(Boolean)
        : null;

      const result = await prisma.$transaction(async (tx) => {
        let hospRecord = hospitalization;
        if (paysHospitalisation && !hospRecord) {
          hospRecord = await ensureHospitalizationFromReferral(
            tx,
            existing.visitId,
            hospitalisationLabel,
          );
        }

        const invoicesByKind: Partial<
          Record<
            ExamKindSlug,
            { invoiceNumber: string; grossFcfa: number; reductionFcfa: number; netFcfa: number }
          >
        > = {};

        const existingSurgeryInvoice =
          paysOperation && surgeryCase
            ? await tx.invoice.findUnique({ where: { surgeryCaseId: surgeryCase.id } })
            : null;

        const sheetsNeedingNewInvoice = sheets.filter(
          (sheet) => !(sheet.kind === "operation" && existingSurgeryInvoice),
        );
        const invoiceNumbers = await generateInvoiceNumberBatch(sheetsNeedingNewInvoice.length);
        const paidAt = new Date();
        let updatedNotes = existing.clinicalNotes ?? "";
        let numberIndex = 0;

        for (const sheet of sheets) {
          const reductionFcfa = reductionsByKind[sheet.kind] ?? 0;
          const sheetNetFcfa = Math.max(0, sheet.grossFcfa - reductionFcfa);

          let invoice;
          if (sheet.kind === "operation" && surgeryCase && existingSurgeryInvoice) {
            invoice = await tx.invoice.update({
              where: { id: existingSurgeryInvoice.id },
              data: {
                amountFcfa: sheetNetFcfa,
                status: InvoiceStatus.PAID,
                paidAt,
                issuedById: user.id,
                visitId: existing.visitId,
                patientId: existing.visit.patientId,
                type: InvoiceType.LAB_EXAM,
              },
            });
          } else {
            invoice = await tx.invoice.create({
              data: {
                invoiceNumber: invoiceNumbers[numberIndex++]!,
                patientId: existing.visit.patientId,
                visitId: existing.visitId,
                surgeryCaseId: sheet.kind === "operation" ? surgeryCase?.id : undefined,
                hospitalizationId:
                  sheet.kind === "hospitalisation" ? hospRecord?.id : undefined,
                type: InvoiceType.LAB_EXAM,
                amountFcfa: sheetNetFcfa,
                status: InvoiceStatus.PAID,
                issuedById: user.id,
                paidAt,
              },
            });
          }

          invoicesByKind[sheet.kind] = {
            invoiceNumber: invoice.invoiceNumber,
            grossFcfa: sheet.grossFcfa,
            reductionFcfa,
            netFcfa: sheetNetFcfa,
          };
          updatedNotes = appendPaidExamKindMarker(updatedNotes, sheet.kind, paidAt);
        }

        if (paysOperation && surgeryCase) {
          await tx.surgeryCase.update({
            where: { id: surgeryCase.id },
            data: {
              accountantId: user.id,
              status: SurgeryStatus.PAID,
              paidAt,
              authorizedAt: paidAt,
            },
          });
          await tx.visit.update({
            where: { id: existing.visitId },
            data: { status: VisitStatus.IN_TREATMENT },
          });
        }

        if (paysHospitalisation && hospRecord) {
          await tx.hospitalization.update({
            where: { id: hospRecord.id },
            data: {
              status: HospitalizationStatus.RESERVED,
              paidAt,
            },
          });
        }

        const consultation = await tx.consultation.update({
          where: { id: data.consultationId },
          data: {
            clinicalNotes: updatedNotes,
            labExamReductionFcfa: existing.labExamReductionFcfa + totalReductionFcfa,
            ...(paysLabKind
              ? {
                  labSentToLabAt: existing.labSentToLabAt ?? paidAt,
                  labApprovedById: user.id,
                }
              : {}),
          },
          include: {
            visit: { include: { patient: true } },
            doctor: { select: { firstName: true, lastName: true } },
          },
        });

        const primaryInvoice = kindsToPay
          .map((kind) => invoicesByKind[kind])
          .find(Boolean);

        const remainingUnpaidKinds = getUnpaidPrescribedExamKinds(updatedNotes);

        return {
          consultation,
          invoice: primaryInvoice
            ? {
                invoiceNumber: primaryInvoice.invoiceNumber,
                amountFcfa: netFcfa,
              }
            : null,
          invoicesByKind,
          paidKinds: kindsToPay,
          remainingUnpaidKinds,
          examsByKind: buildExamsByKindPayload(updatedNotes),
          examLines: buildExamLinesFromNotes(updatedNotes).filter(
            (line) => !isExamKindPaid(updatedNotes, line.kind),
          ),
          grossFcfa,
          reductionFcfa: totalReductionFcfa,
          reductionsByKind,
          netFcfa,
          hasOperation: paysOperation,
          hasLabTransfer: paysLabKind,
          surgeryAuthorized: paysOperation && !!surgeryCase,
          allKindsPaid: remainingUnpaidKinds.length === 0,
        };
      });

      return res.json(result);
    }


    return res.status(400).json({ error: "Action inconnue" });
  } catch (error) {
    console.error("[comptabilite]", action, error);
    if (error instanceof z.ZodError) return res.status(400).json({ error: "Données invalides" });
    if (error instanceof Error) {
      if (error.message === "ROOM_UNAVAILABLE") return res.status(409).json({ error: "Salle déjà occupée" });
      if (error.message === "VIP_ROOM_OCCUPIED") {
        return res.status(409).json({
          error: "La chambre VIP est déjà occupée. Choisissez une chambre simple ou attendez la sortie du patient.",
        });
      }
      if (error.message === "INVALID_HOSPITALIZATION") {
        return res.status(400).json({ error: "Hospitalisation invalide" });
      }
    }
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "P2002"
    ) {
      return res.status(409).json({
        error: "Une facture existe déjà pour ce dossier. Actualisez la liste puis réessayez.",
      });
    }
    return res.status(500).json({ error: "Erreur serveur" });
  }
});


function mapExamReclamation(row: {
  id: string;
  consultationId: string;
  visitId: string;
  patientId: string;
  examKind: string | null;
  examLabel: string | null;
  examLines: unknown;
  totalFcfa: number;
  reason: ExamReclamationReason;
  reasonDetail: string | null;
  status: ExamReclamationStatus;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt: Date | null;
  patient: { code: string; firstName: string; lastName: string };
  createdBy: { firstName: string; lastName: string };
  handledBy: { firstName: string; lastName: string } | null;
}) {
  const parsedLines = parseExamReclamationLines(row.examLines);
  return {
    id: row.id,
    consultationId: row.consultationId,
    visitId: row.visitId,
    patientId: row.patientId,
    examKind: row.examKind,
    examLabel: row.examLabel,
    examLines: parsedLines,
    totalFcfa: row.totalFcfa || parsedLines.reduce((sum, line) => sum + line.unitPriceFcfa, 0),
    reason: row.reason,
    reasonDetail: row.reasonDetail,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    resolvedAt: row.resolvedAt,
    patient: row.patient,
    createdBy: row.createdBy,
    handledBy: row.handledBy,
  };
}

type ExamReclamationLinePayload = {
  examKind: ExamKindSlug;
  examLabel: string;
  unitPriceFcfa: number;
};

function parseExamReclamationLines(value: unknown): ExamReclamationLinePayload[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Record<string, unknown>;
    const examKind = row.examKind;
    const examLabel = row.examLabel;
    const unitPriceFcfa = row.unitPriceFcfa;
    if (typeof examKind !== "string" || typeof examLabel !== "string" || !examLabel.trim()) {
      return [];
    }
    if (typeof unitPriceFcfa !== "number" || !Number.isFinite(unitPriceFcfa) || unitPriceFcfa < 0) {
      return [];
    }
    return [
      {
        examKind: examKind as ExamKindSlug,
        examLabel: examLabel.trim(),
        unitPriceFcfa: Math.floor(unitPriceFcfa),
      },
    ];
  });
}

const reclamationInclude = {
  patient: { select: { code: true, firstName: true, lastName: true } },
  createdBy: { select: { firstName: true, lastName: true } },
  handledBy: { select: { firstName: true, lastName: true } },
} as const;

router.get("/exam-reclamations", cashierAccess, async (req, res) => {
  const consultationId =
    typeof req.query.consultationId === "string" ? req.query.consultationId : undefined;
  const patientId = typeof req.query.patientId === "string" ? req.query.patientId : undefined;

  const rows = await prisma.examReclamation.findMany({
    where: {
      ...(consultationId ? { consultationId } : {}),
      ...(patientId ? { patientId } : {}),
    },
    include: reclamationInclude,
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return res.json(rows.map(mapExamReclamation));
});

router.post("/exam-reclamations", cashierAccess, async (req, res) => {
  try {
    const body = createExamReclamationSchema.parse(req.body);
    const user = req.user!;

    const consultation = await prisma.consultation.findUnique({
      where: { id: body.consultationId },
      include: {
        visit: {
          select: {
            patientId: true,
            invoices: {
              where: { type: InvoiceType.LAB_EXAM },
              select: {
                id: true,
                type: true,
                amountFcfa: true,
                surgeryCaseId: true,
                hospitalizationId: true,
                createdAt: true,
              },
            },
          },
        },
      },
    });
    if (!consultation?.visit) {
      return res.status(404).json({ error: "Consultation introuvable" });
    }

    const priorRefunds = await prisma.examReclamation.findMany({
      where: {
        consultationId: consultation.id,
        status: ExamReclamationStatus.REFUNDED,
      },
      select: { examLines: true },
    });
    const alreadyRefunded = new Set(
      priorRefunds.flatMap((row) =>
        parseExamReclamationLines(row.examLines).map(
          (line) => `${line.examKind}::${line.examLabel}`,
        ),
      ),
    );
    for (const line of body.exams) {
      const key = `${line.examKind}::${line.examLabel.trim()}`;
      if (alreadyRefunded.has(key)) {
        return res.status(400).json({
          error: `Cet examen a déjà été remboursé : ${line.examLabel}`,
        });
      }
    }

    const totalFcfa = body.exams.reduce((sum, line) => sum + line.unitPriceFcfa, 0);
    const examLines = body.exams.map((line) => ({
      examKind: line.examKind,
      examLabel: line.examLabel,
      unitPriceFcfa: line.unitPriceFcfa,
    }));
    const examKind = body.exams.length === 1 ? body.exams[0]!.examKind : null;
    const examLabel =
      body.exams.length === 1
        ? body.exams[0]!.examLabel
        : body.exams.map((line) => line.examLabel).join(", ");
    const resolvedAt = new Date();

    const reclamation = await prisma.$transaction(async (tx) => {
      const { totalRefundedFcfa } = await applyExamReclamationRefund({
        tx,
        consultation,
        examLines: body.exams,
      });

      const row = await tx.examReclamation.create({
        data: {
          consultationId: consultation.id,
          visitId: consultation.visitId,
          patientId: consultation.visit.patientId,
          examKind,
          examLabel,
          examLines,
          totalFcfa,
          reason: body.reason,
          reasonDetail: body.reasonDetail?.trim() || null,
          status: ExamReclamationStatus.REFUNDED,
          createdById: user.id,
          handledById: user.id,
          resolvedAt,
        },
        include: reclamationInclude,
      });

      return { row, totalRefundedFcfa };
    });

    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: "EXAM_RECLAMATION_REFUNDED",
        entity: "ExamReclamation",
        entityId: reclamation.row.id,
        metadata: {
          patientId: reclamation.row.patientId,
          consultationId: reclamation.row.consultationId,
          examCount: body.exams.length,
          totalFcfa,
          totalRefundedFcfa: reclamation.totalRefundedFcfa,
          examLines,
          reason: reclamation.row.reason,
          notifyRoles: ["LABORANTIN", "COMPTABLE", "ADMIN"],
        },
      },
    });

    return res.status(201).json(mapExamReclamation(reclamation.row));
  } catch (error) {
    console.error("[exam-reclamations] create failed:", error);
    if (error instanceof ReclamationRefundError) {
      return res.status(400).json({ error: error.message });
    }
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Données invalides. Vérifiez les examens sélectionnés." });
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === "P2021" || error.code === "P2022")
    ) {
      return res.status(503).json({
        error: "Base de données non à jour. Exécutez « npx prisma db push » sur le serveur.",
      });
    }
    if (error instanceof Prisma.PrismaClientValidationError) {
      return res.status(503).json({
        error: "Client base de données obsolète. Redémarrez le backend après « npx prisma generate ».",
      });
    }
    return res.status(400).json({ error: "Enregistrement impossible" });
  }
});

router.patch("/exam-reclamations/:id", cashierAccess, async (req, res) => {
  try {
    const body = updateExamReclamationSchema.parse(req.body);
    const user = req.user!;

    const existing = await prisma.examReclamation.findUnique({
      where: { id: String(req.params.id) },
    });
    if (!existing) return res.status(404).json({ error: "Réclamation introuvable" });

    const resolvedAt =
      body.status === ExamReclamationStatus.REFUNDED ||
      body.status === ExamReclamationStatus.REJECTED
        ? new Date()
        : null;

    const reclamation = await prisma.examReclamation.update({
      where: { id: existing.id },
      data: {
        status: body.status,
        handledById: user.id,
        resolvedAt,
      },
      include: reclamationInclude,
    });

    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: "EXAM_RECLAMATION_STATUS_UPDATED",
        entity: "ExamReclamation",
        entityId: reclamation.id,
        metadata: {
          previousStatus: existing.status,
          status: reclamation.status,
        },
      },
    });

    return res.json(mapExamReclamation(reclamation));
  } catch {
    return res.status(400).json({ error: "Données invalides" });
  }
});

export default router;
