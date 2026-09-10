import { Router } from "express";
import {
  computeSurgeryShares,
  resolveSurgeonPercent,
  selectableDoctorByIdWhere,
  selectableDoctorWhere,
} from "../lib/doctor-compensation.js";
import { computeInterventionCostShares } from "../lib/surgery-cost-shares.js";
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
  prescriptionRequiresLabWork,
  EXAMS_PRESCRIBED_PREFIX,
  LAB_BILLABLE_EXAM_KINDS,
  summarizePrescribedExamFieldNames,
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
import { immediatePaidInvoiceData } from "../lib/invoice-paid.js";
import {
  applyExamReclamationRefund,
  ReclamationRefundError,
  voidAllPaidLabExams,
} from "../lib/exam-reclamation-refund.js";
import { assertRoomAvailableForAdmission } from "../lib/hospitalization-rooms.js";
import { shouldCreateImmediateInvoice, comptabilitePatientWhere, comptabiliteInvoicePatientWhere } from "../lib/patient-billing.js";
import {
  aggregateCollectedToday,
  buildRevenueLast7Days,
} from "../lib/revenue-stats.js";
import { aggregateCollectedForCashier } from "../lib/cashier-personal-stats.js";
import { applyExamKindPayment } from "../lib/patient-invoice-payments.js";
import { canAccessModule, type AppUserRole } from "../lib/roles.js";
import { requireAuth, requireAnyModule, requireAdmin, isUiActionPermitted } from "../middleware/auth.js";
import {
  receptionistOwnsPatient,
  receptionistOwnReclamationsWhere,
  receptionistOwnVisitsWhere,
  receptionistScopeUserId,
} from "../lib/reception-scope.js";
import { startOfDay } from "../lib/dashboard-charts.js";

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
  bedId: z.string().optional(),
  depositFcfa: z.number().int().positive(),
  attendingDoctor: z.string().optional(),
  attendingDoctorId: z.string().optional(),
});

const dischargeSchema = z.object({
  hospitalizationId: z.string(),
  endDate: z.string(),
});

const examKindSchema = z.enum([
  "specialty",
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
      specialty: z.number().int().min(0).optional(),
      examen: z.number().int().min(0).optional(),
      radio: z.number().int().min(0).optional(),
      echo: z.number().int().min(0).optional(),
      odonto: z.number().int().min(0).optional(),
      operation: z.number().int().min(0).optional(),
      hospitalisation: z.number().int().min(0).optional(),
    })
    .optional(),
  reductionFcfa: z.number().int().min(0).optional(),
  installmentAmountFcfa: z.number().int().positive().optional(),
  installmentsByKind: z
    .object({
      specialty: z.number().int().positive().optional(),
      examen: z.number().int().positive().optional(),
      radio: z.number().int().positive().optional(),
      echo: z.number().int().positive().optional(),
      odonto: z.number().int().positive().optional(),
      operation: z.number().int().positive().optional(),
      hospitalisation: z.number().int().positive().optional(),
    })
    .optional(),
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
  visit: {
    patient: { code: string; firstName: string; lastName: string; phone?: string | null };
    surgeryCase?: { totalCostFcfa: number } | null;
    invoices?: Array<{
      billingExamKind?: string | null;
      amountFcfa: number;
      paidAmountFcfa?: number;
      status?: InvoiceStatus;
      invoiceNumber?: string;
      type?: InvoiceType;
      createdAt?: Date;
      issuedBy?: { firstName: string; lastName: string } | null;
    }>;
  };
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
  let examLines = buildExamLinesFromNotes(consultation.clinicalNotes).filter(
    (line) => !unpaidOnly || !isExamKindPaid(consultation.clinicalNotes, line.kind),
  );
  const surgeryTotal = consultation.visit.surgeryCase?.totalCostFcfa;
  if (surgeryTotal != null && surgeryTotal > 0) {
    examLines = examLines.map((line) =>
      line.kind === "operation" ? { ...line, unitPriceFcfa: surgeryTotal } : line,
    );
    if (examsByKind.operation?.lines?.length) {
      examsByKind.operation = {
        ...examsByKind.operation,
        lines: examsByKind.operation.lines.map((line, index) =>
          index === 0 ? { ...line, unitPriceFcfa: surgeryTotal } : { ...line, unitPriceFcfa: 0 },
        ),
        grossFcfa: surgeryTotal,
      };
    }
  }
  const grossFcfa = examLines.reduce((sum, line) => sum + line.unitPriceFcfa, 0);
  const paidKinds = Object.keys(parsePaidExamKindsByKind(consultation.clinicalNotes)) as ExamKindSlug[];
  const unpaidKinds = getUnpaidPrescribedExamKinds(consultation.clinicalNotes);
  const partialPaymentsByKind: Partial<
    Record<ExamKindSlug, { totalFcfa: number; paidFcfa: number; remainingFcfa: number }>
  > = {};
  for (const invoice of consultation.visit.invoices ?? []) {
    if (!invoice.billingExamKind) continue;
    const kind = invoice.billingExamKind as ExamKindSlug;
    if (paidKinds.includes(kind)) continue;
    const paidAmountFcfa = invoice.paidAmountFcfa ?? 0;
    const status = invoice.status ?? InvoiceStatus.PENDING;
    if (paidAmountFcfa <= 0 && status !== InvoiceStatus.PARTIALLY_PAID) continue;
    partialPaymentsByKind[kind] = {
      totalFcfa: invoice.amountFcfa,
      paidFcfa: paidAmountFcfa,
      remainingFcfa: Math.max(0, invoice.amountFcfa - paidAmountFcfa),
    };
  }
  return {
    ...consultation,
    allExamsByKind,
    examsByKind,
    examLines,
    grossFcfa,
    paidKinds,
    unpaidKinds,
    partialPaymentsByKind,
    examsSummary: summarizePrescribedExamFieldNames(examLines.map((line) => line.label)),
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
      paidAmountFcfa?: number;
      billingExamKind?: string | null;
      status?: InvoiceStatus;
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
  const sheetByKind = new Map(sheets.map((sheet) => [sheet.kind, sheet]));

  const labInvoices = consultation.visit.invoices
    .filter(
      (invoice) =>
        invoice.type === InvoiceType.LAB_EXAM &&
        (invoice.status === InvoiceStatus.PAID ||
          invoice.status === InvoiceStatus.PARTIALLY_PAID) &&
        (invoice.paidAmountFcfa ?? 0) > 0,
    )
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  const invoicesByKind: Partial<
    Record<
      ExamKindSlug,
      {
        invoiceNumber: string;
        grossFcfa: number;
        reductionFcfa: number;
        netFcfa: number;
        paidFcfa: number;
        remainingFcfa: number;
        isFullyPaid: boolean;
      }
    >
  > = {};
  const reductionsByKind = emptyExamReductionsByKind();

  let collectedFcfa = 0;
  let remainingFcfa = 0;
  let latestInvoiceAt: Date | null = null;
  let cashierName: string | null = null;

  for (const invoice of labInvoices) {
    const kind = (invoice.billingExamKind ?? null) as ExamKindSlug | null;
    const paidFcfa = Math.max(0, invoice.paidAmountFcfa ?? 0);
    const amountFcfa = Math.max(0, invoice.amountFcfa);
    const remaining = Math.max(0, amountFcfa - paidFcfa);
    collectedFcfa += paidFcfa;
    remainingFcfa += remaining;
    if (!latestInvoiceAt || invoice.createdAt > latestInvoiceAt) {
      latestInvoiceAt = invoice.createdAt;
    }
    if (!cashierName && invoice.issuedBy) {
      cashierName = `${invoice.issuedBy.firstName} ${invoice.issuedBy.lastName}`.trim();
    }
    if (!kind) continue;

    const sheet = sheetByKind.get(kind);
    const grossFcfa = sheet?.grossFcfa ?? amountFcfa;
    const reductionFcfa = Math.max(0, grossFcfa - amountFcfa);
    reductionsByKind[kind] = reductionFcfa;
    invoicesByKind[kind] = {
      invoiceNumber: invoice.invoiceNumber,
      grossFcfa,
      reductionFcfa,
      netFcfa: amountFcfa,
      paidFcfa,
      remainingFcfa: remaining,
      isFullyPaid: invoice.status === InvoiceStatus.PAID || remaining <= 0,
    };
  }

  // Fallback historique : marquers payés sans paidAmountFcfa renseigné correctement.
  if (!labInvoices.length) {
    const paidAtByKind = parsePaidExamKindsByKind(consultation.clinicalNotes);
    const paidSheets = sheets.filter((sheet) => paidAtByKind[sheet.kind]);
    const legacyPaidInvoices = consultation.visit.invoices
      .filter((invoice) => invoice.type === InvoiceType.LAB_EXAM)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    paidSheets.forEach((sheet, index) => {
      const invoice = legacyPaidInvoices[index];
      const reductionFcfa = invoice
        ? Math.max(0, sheet.grossFcfa - invoice.amountFcfa)
        : 0;
      reductionsByKind[sheet.kind] = reductionFcfa;
      if (invoice) {
        const paidFcfa = Math.max(invoice.paidAmountFcfa ?? 0, invoice.amountFcfa);
        invoicesByKind[sheet.kind] = {
          invoiceNumber: invoice.invoiceNumber,
          grossFcfa: sheet.grossFcfa,
          reductionFcfa,
          netFcfa: invoice.amountFcfa,
          paidFcfa,
          remainingFcfa: 0,
          isFullyPaid: true,
        };
        collectedFcfa += paidFcfa;
        if (!latestInvoiceAt || invoice.createdAt > latestInvoiceAt) {
          latestInvoiceAt = invoice.createdAt;
        }
        if (!cashierName && invoice.issuedBy) {
          cashierName = `${invoice.issuedBy.firstName} ${invoice.issuedBy.lastName}`.trim();
        }
      }
    });
  }

  const paidAtByKind = parsePaidExamKindsByKind(consultation.clinicalNotes);
  const markerDates = Object.values(paidAtByKind);
  const paidAt =
    consultation.labSentToLabAt ??
    (markerDates.length
      ? new Date(Math.max(...markerDates.map((d) => d.getTime())))
      : latestInvoiceAt);

  return {
    ...base,
    paidAt,
    labExamReductionFcfa: consultation.labExamReductionFcfa,
    invoicesByKind,
    reductionsByKind,
    collectedFcfa,
    remainingFcfa,
    cashierName,
  };
}

router.get("/payment-alerts", cashierAccess, async (req, res) => {
  const user = req.user!;
  const ownVisits = receptionistOwnVisitsWhere(user);
  const [examRows, consultationInvoices] = await Promise.all([
    prisma.consultation.findMany({
      // File examens : partagée (prescriptions pédiatre / tout médecin visibles à toute caisse).
      where: labsPendingApprovalWhere(),
      select: {
        id: true,
        visitId: true,
        clinicalNotes: true,
        updatedAt: true,
        visit: {
          select: {
            patient: { select: { code: true, firstName: true, lastName: true } },
          },
        },
      },
      orderBy: { updatedAt: "desc" },
      take: 80,
    }),
    prisma.invoice.findMany({
      where: {
        type: InvoiceType.CONSULTATION,
        status: { in: [InvoiceStatus.PENDING, InvoiceStatus.PARTIALLY_PAID] },
        visitId: { not: null },
        ...comptabiliteInvoicePatientWhere(),
        ...(Object.keys(ownVisits).length ? { visit: ownVisits } : {}),
      },
      select: {
        id: true,
        visitId: true,
        amountFcfa: true,
        paidAmountFcfa: true,
        createdAt: true,
        patient: { select: { code: true, firstName: true, lastName: true } },
        visit: {
          select: {
            patient: { select: { code: true, firstName: true, lastName: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 80,
    }),
  ]);

  const exams = examRows
    .filter((row) => hasUnpaidCashierQueueExams(row.clinicalNotes))
    .map((row) => {
      const mapped = mapLabExamPending({
        id: row.id,
        visitId: row.visitId,
        clinicalNotes: row.clinicalNotes,
        updatedAt: row.updatedAt,
        visit: { patient: row.visit.patient },
        doctor: null,
      });
      return {
        id: row.id,
        visitId: row.visitId,
        patientCode: row.visit.patient.code,
        patientName: `${row.visit.patient.firstName} ${row.visit.patient.lastName}`.trim(),
        examsSummary: mapped.examsSummary,
        examCount: mapped.examLines.length,
        amountFcfa: mapped.grossFcfa,
        updatedAt: row.updatedAt.toISOString(),
      };
    });

  const consultations = consultationInvoices.flatMap((invoice) => {
    const patient = invoice.patient ?? invoice.visit?.patient;
    if (!patient || !invoice.visitId) return [];
    return [
      {
        id: invoice.id,
        visitId: invoice.visitId,
        patientCode: patient.code,
        patientName: `${patient.firstName} ${patient.lastName}`.trim(),
        amountFcfa: Math.max(0, invoice.amountFcfa - (invoice.paidAmountFcfa ?? 0)),
        createdAt: invoice.createdAt.toISOString(),
      },
    ];
  });

  return res.json({ exams, consultations });
});

router.get("/stats", cashierAccess, async (req, res) => {
  const user = req.user!;
  const patientWhere = comptabilitePatientWhere();
  const ownVisits = receptionistOwnVisitsWhere(user);
  const scopedCashierId = receptionistScopeUserId(user);
  const todayStart = startOfDay(new Date());
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);
  await syncMissingHospitalizationReferrals(prisma, patientWhere);
  await syncHospitalizationReferralsFromPaymentQueue(prisma, patientWhere);

  const [
    labExamsPending,
    collectedToday,
    surgeriesPending,
    hospitalizationsForStats,
    consultationsPending,
  ] = await Promise.all([
    prisma.consultation.findMany({
      where: labsPendingApprovalWhere(),
      select: { clinicalNotes: true },
    }).then(rows => rows.filter(row => hasUnpaidCashierQueueExams(row.clinicalNotes))),
    scopedCashierId
      ? aggregateCollectedForCashier(scopedCashierId, todayStart, tomorrowStart)
      : aggregateCollectedToday(),
    prisma.surgeryCase.count({
      where: {
        status: { in: [SurgeryStatus.NOTIFIED, SurgeryStatus.QUOTED] },
        visit: { patient: comptabilitePatientWhere(), ...ownVisits },
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
        visit: { patient: comptabilitePatientWhere(), ...ownVisits },
      },
      select: { status: true, roomId: true, startDate: true },
    }),
    prisma.invoice.findMany({
      where: {
        type: InvoiceType.CONSULTATION,
        status: { in: [InvoiceStatus.PENDING, InvoiceStatus.PARTIALLY_PAID] },
        ...comptabiliteInvoicePatientWhere(),
        ...(Object.keys(ownVisits).length ? { visit: ownVisits } : {}),
      },
      select: { amountFcfa: true, paidAmountFcfa: true },
    }),
  ]);

  const hospitalizationsPending = hospitalizationsForStats.filter(isHospitalizationPendingAdmission).length;

  const labPendingGrossFcfa = labExamsPending.reduce(
    (sum, row) => sum + computeLabExamsGrossFcfa(row.clinicalNotes),
    0,
  );

  const consultationsPendingFcfa = consultationsPending.reduce(
    (sum, row) => sum + Math.max(0, row.amountFcfa - (row.paidAmountFcfa ?? 0)),
    0,
  );

  return res.json({
    labPendingCount: labExamsPending.length,
    labPendingGrossFcfa,
    labPaidTodayCount: collectedToday.examsCount,
    labPaidTodayNetFcfa: collectedToday.examsFcfa,
    consultationsTodayCount: collectedToday.consultationsCount,
    consultationsTodayNetFcfa: collectedToday.consultationsFcfa,
    consultationsPendingCount: consultationsPending.length,
    consultationsPendingFcfa,
    surgeryPaidTodayCount: collectedToday.surgeryCount,
    surgeryPaidTodayNetFcfa: collectedToday.surgeryFcfa,
    hospitalizationPaidTodayCount: collectedToday.hospitalizationCount,
    hospitalizationPaidTodayNetFcfa: collectedToday.hospitalizationFcfa,
    surgeriesPending,
    hospitalizationsPending,
    collectedTodayTotalFcfa: collectedToday.totalFcfa,
    revenueLast7Days: await buildRevenueLast7Days(
      scopedCashierId ? { cashierId: scopedCashierId } : undefined,
    ),
  });
});

router.get("/", cashierAccess, async (req, res) => {
  const user = req.user!;
  const patientWhere = comptabilitePatientWhere();
  const ownVisits = receptionistOwnVisitsWhere(user);
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
        visit: { patient: comptabilitePatientWhere(), ...ownVisits },
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
        visit: { patient: comptabilitePatientWhere(), ...ownVisits },
      },
      include: {
        visit: { include: { patient: true } },
        room: true,
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.interventionType.findMany({ where: { active: true } }),
    prisma.user.findMany({
      where: selectableDoctorWhere,
      select: { id: true, firstName: true, lastName: true },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
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
            surgeryCase: { select: { status: true, totalCostFcfa: true } },
            invoices: {
              where: {
                type: InvoiceType.LAB_EXAM,
                status: { in: [InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.PENDING] },
                billingExamKind: { not: null },
              },
              select: {
                billingExamKind: true,
                amountFcfa: true,
                paidAmountFcfa: true,
                status: true,
              },
            },
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
          (
            surgeryStatus === SurgeryStatus.PAID ||
            surgeryStatus === SurgeryStatus.AUTHORIZED ||
            surgeryStatus === SurgeryStatus.IN_PROGRESS ||
            surgeryStatus === SurgeryStatus.COMPLETED
          )
        ) {
          return getUnpaidCashierQueueKinds(row.clinicalNotes).some((kind) => kind !== "operation");
        }
        return true;
      })
      .map((row) => mapLabExamPending(row)),
  });
});

router.get("/paid-exams", cashierAccess, async (req, res) => {
  const labExamsPaid = await prisma.consultation.findMany({
    where: labsPaidExamsWhere(),
    include: {
      visit: {
        include: {
          patient: true,
          invoices: {
            where: {
              type: InvoiceType.LAB_EXAM,
              status: { in: [InvoiceStatus.PAID, InvoiceStatus.PARTIALLY_PAID] },
            },
            select: {
              invoiceNumber: true,
              amountFcfa: true,
              paidAmountFcfa: true,
              billingExamKind: true,
              status: true,
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
    orderBy: [{ updatedAt: "desc" }, { labSentToLabAt: "desc" }],
  });

  return res.json(labExamsPaid.map(mapLabExamPaid));
});

router.delete("/paid-exams/:consultationId", cashierAccess, requireAdmin, async (req, res) => {
  const consultationId = String(req.params.consultationId ?? "").trim();
  if (!consultationId) {
    return res.status(400).json({ error: "Consultation introuvable" });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const consultation = await tx.consultation.findUnique({
        where: { id: consultationId },
        include: {
          visit: {
            select: {
              invoices: {
                where: { type: InvoiceType.LAB_EXAM },
                select: {
                  id: true,
                  type: true,
                  amountFcfa: true,
                  paidAmountFcfa: true,
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
        throw new ReclamationRefundError("NOT_FOUND", "Consultation introuvable");
      }
      return voidAllPaidLabExams({ tx, consultation });
    });
    return res.json({
      ok: true,
      totalRefundedFcfa: result.totalRefundedFcfa,
    });
  } catch (error) {
    if (error instanceof ReclamationRefundError) {
      const status =
        error.code === "NOT_FOUND"
          ? 404
          : error.code === "LAB_RESULTS_LOCKED" || error.code === "SURGERY_LOCKED"
            ? 409
            : 400;
      return res.status(status).json({ error: error.message, code: error.code });
    }
    return res.status(400).json({ error: "Impossible de supprimer les examens payés." });
  }
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

  const actionUi =
    action === "pay_consultation"
      ? "reception.pay_consultation"
      : action === "pay_lab_exams"
        ? "comptabilite.exam_payments"
        : "comptabilite.encaissements";
  if (!(await isUiActionPermitted(req, actionUi))) {
    return res.status(403).json({
      error: "Action masquée pour ce compte",
      code: "UI_ACTION_HIDDEN",
      action: actionUi,
    });
  }
  if (
    action === "pay_consultation" &&
    Number(req.body?.reductionFcfa ?? 0) > 0 &&
    !(await isUiActionPermitted(req, "comptabilite.reduction"))
  ) {
    return res.status(403).json({
      error: "Action masquée pour ce compte",
      code: "UI_ACTION_HIDDEN",
      action: "comptabilite.reduction",
    });
  }

  try {
    if (action === "pay_consultation") {
      const data = z
        .object({
          invoiceId: z.string().min(1),
          amountFcfa: z.coerce.number().int().positive().optional(),
          reductionFcfa: z.coerce.number().int().min(0).optional(),
        })
        .parse(req.body);

      const invoice = await prisma.invoice.findUnique({
        where: { id: data.invoiceId },
        select: {
          id: true,
          type: true,
          status: true,
          amountFcfa: true,
          paidAmountFcfa: true,
          visitId: true,
          patient: { select: { category: true } },
          visit: {
            select: {
              id: true,
              consultationFeeFcfa: true,
              reductionFcfa: true,
            },
          },
        },
      });

      if (!invoice || invoice.type !== InvoiceType.CONSULTATION) {
        return res.status(404).json({ error: "Facture de consultation introuvable." });
      }
      if (
        invoice.status === InvoiceStatus.PAID ||
        invoice.status === InvoiceStatus.CANCELLED
      ) {
        return res.status(409).json({ error: "Cette consultation est déjà encaissée." });
      }
      if (invoice.paidAmountFcfa > 0 && data.reductionFcfa != null) {
        return res.status(409).json({
          error: "Impossible d'appliquer une réduction : un acompte a déjà été encaissé.",
        });
      }

      const grossFcfa = Math.max(
        0,
        invoice.visit?.consultationFeeFcfa ?? invoice.amountFcfa + (invoice.visit?.reductionFcfa ?? 0),
      );
      const reductionFcfa = Math.min(
        grossFcfa,
        Math.max(0, data.reductionFcfa ?? invoice.visit?.reductionFcfa ?? 0),
      );
      const netFcfa = Math.max(0, grossFcfa - reductionFcfa);

      if (netFcfa <= 0) {
        return res.status(400).json({ error: "Le montant net à encaisser doit être supérieur à 0." });
      }

      const { recordInvoiceInstallment } = await import("../lib/patient-invoice-payments.js");
      const result = await prisma.$transaction(async (tx) => {
        if (invoice.visitId) {
          await tx.visit.update({
            where: { id: invoice.visitId },
            data: {
              consultationFeeFcfa: grossFcfa,
              reductionFcfa,
            },
          });
        }

        const updatedInvoice = await tx.invoice.update({
          where: { id: invoice.id },
          data: {
            amountFcfa: netFcfa,
            // Pas encore payé — on aligne le montant net avant encaissement.
          },
          select: {
            id: true,
            amountFcfa: true,
            paidAmountFcfa: true,
            invoiceNumber: true,
            status: true,
          },
        });

        const remainingFcfa = Math.max(0, updatedInvoice.amountFcfa - updatedInvoice.paidAmountFcfa);
        const amountFcfa = data.amountFcfa ?? remainingFcfa;
        if (amountFcfa <= 0 || amountFcfa > remainingFcfa) {
          throw new Error("INVALID_PAYMENT_AMOUNT");
        }

        return recordInvoiceInstallment(tx, {
          invoiceId: updatedInvoice.id,
          amountFcfa,
          recordedById: user.id,
          note:
            reductionFcfa > 0
              ? `Encaissement consultation (réduction ${reductionFcfa} FCFA)`
              : "Encaissement consultation",
        });
      });

      return res.json({
        success: true,
        invoiceId: result.invoice.id,
        invoiceNumber: result.invoice.invoiceNumber,
        amountFcfa: result.payment.amountFcfa,
        reductionFcfa,
        grossFcfa,
        netFcfa,
        status: result.invoice.status,
        isFullyPaid: result.isFullyPaid,
        remainingFcfa: result.remainingFcfa,
      });
    }

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

      const result = await prisma.$transaction(async (tx) => {
        const current = await tx.surgeryCase.findUnique({
          where: { id: data.surgeryCaseId },
          include: { visit: true },
        });
        if (!current) throw new Error("SURGERY_NOT_FOUND");
        if (current.status === SurgeryStatus.PAID) {
          throw new Error("SURGERY_ALREADY_PAID");
        }
        const billedCost =
          current.totalCostFcfa > 0 ? current.totalCostFcfa : intervention.totalCostFcfa;
        const { surgeonShareFcfa: billedSurgeonShare, clinicShareFcfa: billedClinicShare } =
          computeSurgeryShares(billedCost, surgeonPercent, surgeon ?? { role: "MEDECIN" });

        const surgery = await tx.surgeryCase.update({
          where: { id: data.surgeryCaseId },
          data: {
            interventionTypeId: data.interventionTypeId,
            surgeonId: data.surgeonId,
            accountantId: user.id,
            totalCostFcfa: billedCost,
            surgeonShareFcfa: billedSurgeonShare,
            clinicShareFcfa: billedClinicShare,
            status: SurgeryStatus.PAID,
            paidAt: new Date(),
            authorizedAt: new Date(),
          },
          include: { visit: true },
        });
        const invoice = await tx.invoice.create({
          data: {
            invoiceNumber: await generateInvoiceNumber(tx),
            patientId: surgery.visit.patientId,
            visitId: surgery.visitId,
            surgeryCaseId: surgery.id,
            type: InvoiceType.SURGERY,
            issuedById: user.id,
            ...immediatePaidInvoiceData(billedCost, user.id),
          },
        });
        await tx.visit.update({ where: { id: surgery.visitId }, data: { status: VisitStatus.IN_TREATMENT } });
        return { surgery, invoice };
      });
      return res.json(result);
    }

    if (action === "reserve_room" || action === "reserve_bed") {
      const data = hospitalizationSchema.parse(req.body);

      let attendingDoctorId: string | null = null;
      let attendingDoctor: string | null = data.attendingDoctor?.trim() || null;
      if (data.attendingDoctorId?.trim()) {
        const doctor = await prisma.user.findFirst({
          where: selectableDoctorByIdWhere(data.attendingDoctorId.trim()),
          select: { id: true, firstName: true, lastName: true },
        });
        if (!doctor) return res.status(400).json({ error: "Médecin traitant invalide" });
        attendingDoctorId = doctor.id;
        attendingDoctor = `Dr ${doctor.firstName} ${doctor.lastName}`;
      }

      const result = await prisma.$transaction(async (tx) => {
        const { room, bed } = await assertRoomAvailableForAdmission(
          tx,
          data.roomId,
          data.hospitalizationId,
          { bedId: data.bedId },
        );

        const hospitalization = await tx.hospitalization.update({
          where: { id: data.hospitalizationId },
          data: {
            roomId: room.id,
            bedId: bed?.id ?? null,
            accountantId: user.id,
            roomType: room.type,
            dailyRateFcfa: room.dailyRateFcfa,
            depositFcfa: data.depositFcfa,
            status: HospitalizationStatus.ACTIVE,
            startDate: new Date(),
            paidAt: new Date(),
            attendingDoctor,
            attendingDoctorId,
          },
          include: { visit: true, room: true, bed: true },
        });
        const invoice = await tx.invoice.create({
          data: {
            invoiceNumber: await generateInvoiceNumber(tx),
            patientId: hospitalization.visit.patientId,
            visitId: hospitalization.visitId,
            hospitalizationId: hospitalization.id,
            type: InvoiceType.HOSPITALIZATION_DEPOSIT,
            issuedById: user.id,
            ...immediatePaidInvoiceData(data.depositFcfa, user.id),
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
            bedId: null,
          },
        });

        let invoice = null;
        if (balance > 0) {
          invoice = await tx.invoice.create({
            data: {
              invoiceNumber: await generateInvoiceNumber(tx),
              patientId: hospitalization.visit.patientId,
              visitId: hospitalization.visitId,
              hospitalizationId: hospitalization.id,
              type: InvoiceType.HOSPITALIZATION_FINAL,
              issuedById: user.id,
              ...immediatePaidInvoiceData(balance, user.id),
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
      let sheets = allSheets.filter((sheet) => kindsToPay.includes(sheet.kind));
      if (!sheets.length) {
        return res.status(400).json({ error: "Aucun examen facturable pour les types sélectionnés." });
      }

      const paysOperation = kindsToPay.includes("operation");
      const paysHospitalisation = kindsToPay.includes("hospitalisation");
      const surgeryCase = paysOperation
        ? await prisma.surgeryCase.findUnique({
            where: { visitId: existing.visitId },
            include: {
              interventionType: { select: { surgeonPercent: true, anesthesiologistPercent: true } },
              surgeon: {
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
              },
            },
          })
        : null;

      if (surgeryCase && surgeryCase.totalCostFcfa > 0) {
        sheets = sheets.map((sheet) => {
          if (sheet.kind !== "operation") return sheet;
          const total = surgeryCase.totalCostFcfa;
          const lines =
            sheet.lines.length > 0
              ? sheet.lines.map((line, index) => ({
                  ...line,
                  unitPriceFcfa: index === 0 ? total : 0,
                }))
              : [
                  {
                    label: "Opération",
                    unitPriceFcfa: total,
                    kind: "operation" as ExamKindSlug,
                  },
                ];
          return { ...sheet, lines, grossFcfa: total };
        });
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

      const hospitalization = paysHospitalisation
        ? await prisma.hospitalization.findUnique({ where: { visitId: existing.visitId } })
        : null;
      const hospitalisationLabel = paysHospitalisation
        ? parsePrescribedExamsByKind(existing.clinicalNotes).hospitalisation?.find(Boolean)
        : null;

      const installmentsByKind = data.installmentsByKind ?? {};
      if (data.installmentAmountFcfa != null && kindsToPay.length > 1 && !data.installmentsByKind) {
        return res.status(400).json({
          error: "Pour un paiement en tranche sur plusieurs types, précisez le montant par type.",
        });
      }

      const resolvePaymentAmount = (kind: ExamKindSlug, sheetNetFcfa: number) => {
        const byKind = installmentsByKind[kind];
        if (byKind != null) return byKind;
        if (kindsToPay.length === 1 && data.installmentAmountFcfa != null) {
          return data.installmentAmountFcfa;
        }
        return sheetNetFcfa;
      };

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
            {
              invoiceNumber: string;
              grossFcfa: number;
              reductionFcfa: number;
              netFcfa: number;
              paidFcfa: number;
              remainingFcfa: number;
              isFullyPaid: boolean;
            }
          >
        > = {};

        const existingSurgeryInvoice =
          paysOperation && surgeryCase
            ? await tx.invoice.findUnique({ where: { surgeryCaseId: surgeryCase.id } })
            : null;

        const sheetsNeedingNewInvoice = sheets.filter((sheet) => {
          if (sheet.kind === "operation" && existingSurgeryInvoice) return false;
          return true;
        });
        const invoiceNumbers = await generateInvoiceNumberBatch(sheetsNeedingNewInvoice.length, tx);
        const paidAt = new Date();
        let updatedNotes = existing.clinicalNotes ?? "";
        let numberIndex = 0;
        const fullyPaidKinds = new Set<ExamKindSlug>();

        for (const sheet of sheets) {
          const reductionFcfa = reductionsByKind[sheet.kind] ?? 0;
          const sheetNetFcfa = Math.max(0, sheet.grossFcfa - reductionFcfa);
          const paymentAmountFcfa = resolvePaymentAmount(sheet.kind, sheetNetFcfa);
          if (paymentAmountFcfa > sheetNetFcfa) {
            throw new Error("INVALID_INSTALLMENT_AMOUNT");
          }

          let existingInvoice =
            sheet.kind === "operation" && existingSurgeryInvoice
              ? existingSurgeryInvoice
              : await tx.invoice.findFirst({
                  where: {
                    visitId: existing.visitId,
                    billingExamKind: sheet.kind,
                    type: InvoiceType.LAB_EXAM,
                    status: { in: [InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.PENDING] },
                  },
                });

          if (
            existingInvoice &&
            existingInvoice.status === InvoiceStatus.PAID
          ) {
            continue;
          }

          const invoiceNumber = existingInvoice ? undefined : invoiceNumbers[numberIndex++];
          const { invoice, isFullyPaid } = await applyExamKindPayment(tx, {
            kind: sheet.kind,
            sheetNetFcfa: existingInvoice?.amountFcfa ?? sheetNetFcfa,
            paymentAmountFcfa,
            visitId: existing.visitId,
            patientId: existing.visit.patientId,
            recordedById: user.id,
            surgeryCaseId: sheet.kind === "operation" ? surgeryCase?.id : undefined,
            hospitalizationId: sheet.kind === "hospitalisation" ? hospRecord?.id : undefined,
            existingInvoice: existingInvoice
              ? {
                  id: existingInvoice.id,
                  amountFcfa: existingInvoice.amountFcfa,
                  paidAmountFcfa: existingInvoice.paidAmountFcfa,
                  status: existingInvoice.status,
                }
              : null,
            invoiceNumber,
          });

          invoicesByKind[sheet.kind] = {
            invoiceNumber: invoice.invoiceNumber,
            grossFcfa: sheet.grossFcfa,
            reductionFcfa,
            netFcfa: invoice.amountFcfa,
            paidFcfa: invoice.paidAmountFcfa,
            remainingFcfa: Math.max(0, invoice.amountFcfa - invoice.paidAmountFcfa),
            isFullyPaid,
          };

          if (isFullyPaid) {
            fullyPaidKinds.add(sheet.kind);
            updatedNotes = appendPaidExamKindMarker(updatedNotes, sheet.kind, paidAt);
          }
        }

        const operationFullyPaid = paysOperation && fullyPaidKinds.has("operation");
        const hospitalisationFullyPaid =
          paysHospitalisation && fullyPaidKinds.has("hospitalisation");
        const labKindsFullyPaid = kindsToPay.some(
          (kind) =>
            (LAB_BILLABLE_EXAM_KINDS as readonly ExamKindSlug[]).includes(kind) &&
            fullyPaidKinds.has(kind),
        );
        const sendToLab =
          labKindsFullyPaid &&
          prescriptionRequiresLabWork(parsePrescribedExamsByKind(updatedNotes));

        if (operationFullyPaid && surgeryCase) {
          // Parts calculées sur le cumul réellement encaissé (somme des tranches au solde).
          const paidNet =
            invoicesByKind.operation?.paidFcfa ??
            invoicesByKind.operation?.netFcfa ??
            surgeryCase.totalCostFcfa;
          const surgeonPercent = surgeryCase.surgeon
            ? resolveSurgeonPercent(
                surgeryCase.interventionType?.surgeonPercent ?? 0,
                surgeryCase.surgeon,
              )
            : (surgeryCase.interventionType?.surgeonPercent ?? 0);
          const shares = surgeryCase.surgeon
            ? computeSurgeryShares(paidNet, surgeonPercent, surgeryCase.surgeon)
            : computeInterventionCostShares(paidNet, surgeonPercent);
          await tx.surgeryCase.update({
            where: { id: surgeryCase.id },
            data: {
              accountantId: user.id,
              status: SurgeryStatus.PAID,
              paidAt,
              authorizedAt: paidAt,
              totalCostFcfa: paidNet,
              surgeonShareFcfa: shares.surgeonShareFcfa,
              clinicShareFcfa: shares.clinicShareFcfa,
            },
          });
          await tx.visit.update({
            where: { id: existing.visitId },
            data: { status: VisitStatus.IN_TREATMENT },
          });
        }

        if (hospitalisationFullyPaid && hospRecord) {
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
            ...(sendToLab
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
                amountFcfa: primaryInvoice.paidFcfa,
              }
            : null,
          invoicesByKind,
          paidKinds: [...fullyPaidKinds],
          installmentKinds: kindsToPay.filter((kind) => !fullyPaidKinds.has(kind)),
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
          hasLabTransfer: labKindsFullyPaid,
          surgeryAuthorized: operationFullyPaid && !!surgeryCase,
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
      if (error.message === "INVALID_INSTALLMENT_AMOUNT" || error.message === "INVALID_PAYMENT_AMOUNT") {
        return res.status(400).json({
          error: "Montant de tranche invalide (doit être positif et ne pas dépasser le solde restant).",
        });
      }
      if (error.message === "SURGERY_ALREADY_PAID") {
        return res.status(409).json({ error: "Cette opération a déjà été encaissée." });
      }
      if (error.message === "SURGERY_NOT_FOUND") {
        return res.status(404).json({ error: "Dossier opératoire introuvable." });
      }
      if (error.message === "INVOICE_NOT_PAYABLE") {
        return res.status(409).json({ error: "Cette facture n'accepte plus de paiement." });
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
      ...receptionistOwnReclamationsWhere(req.user!),
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
                paidAmountFcfa: true,
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
    if (receptionistScopeUserId(user)) {
      const allowedVisit = await prisma.visit.findFirst({
        where: { id: consultation.visitId, ...receptionistOwnVisitsWhere(user) },
        select: { id: true },
      });
      if (!allowedVisit) return res.status(404).json({ error: "Consultation introuvable" });
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
      include: { patient: { select: { createdById: true } } },
    });
    if (!existing) return res.status(404).json({ error: "Réclamation introuvable" });
    if (!receptionistOwnsPatient(user, existing.patient) && existing.createdById !== user.id) {
      return res.status(404).json({ error: "Réclamation introuvable" });
    }

    if (body.status === ExamReclamationStatus.REFUNDED) {
      return res.status(400).json({
        error: "Le remboursement doit être enregistré via l'action de remboursement dédiée.",
      });
    }

    const resolvedAt =
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
