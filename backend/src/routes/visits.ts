import { Router } from "express";
import { z } from "zod";
import { InvoiceStatus, InvoiceType, PatientCategory, Prisma, UserRole, VisitStatus } from "@prisma/client";
import { prisma } from "../lib/db.js";
import {
  EXAMS_PRESCRIBED_PREFIX,
  LAB_BILLABLE_EXAM_KINDS,
  appendPaidExamKindMarker,
  hasExamsPrescribed,
  buildPrescribedExamsNotes,
  buildPrescribedExamsNotesByKind,
  flattenPrescribedExams,
  type ExamKindSlug,
} from "../lib/lab-notes.js";
import {
  medecinDejaConsulteVisitWhere,
  medecinPendingConsultationVisitWhere,
  visitBelongsToDoctor,
} from "../lib/medecin-queues.js";
import { canAccessModule } from "../lib/roles.js";
import { generateInvoiceNumber, generatePatientCode } from "../lib/patient-code.js";
import { computeGrossFcfaFromExamLabels, computeLabExamsGrossFcfa, buildLabExamLines } from "../lib/lab-exam-prices.js";
import { EXTERNAL_PATIENT_VISIT_NOTE, EXTERNAL_EXAMS_PENDING_NOTE } from "../lib/visit-external.js";
import {
  cancelDuplicateActiveVisits,
  keepLatestVisitPerPatient,
} from "../lib/visit-dedupe.js";
import {
  PATIENT_HAS_PAYMENTS_MESSAGE,
  PATIENT_HAS_PAYMENTS_CODE,
} from "../lib/patient-payment-guard.js";
import { computeConsultationAmounts } from "../lib/consultation-amounts.js";
import { serializeDoctorFields } from "../lib/doctor-compensation.js";
import { resolveConsultationFeeForPatientDoctor } from "../lib/consultation-validity.js";
import { resolveConsultationBilling, shouldCreateImmediateInvoice, isComptabiliteBillablePatient, comptabilitePatientWhere } from "../lib/patient-billing.js";
import { consultationInvoiceCreateData, consultationInvoiceUpdateData } from "../lib/consultation-invoice.js";
import { planReconsultation, archiveVisitsForReconsultation } from "../lib/reconsultation.js";
import {
  findDuplicatePatient,
  serializePatientForDuplicate,
} from "../lib/duplicate-detection.js";
import { duplicateErrorResponse } from "../lib/duplicate-error.js";
import {
  collectedInvoicesWhere,
  INVOICE_TYPE_LABELS,
  invoiceCollectedAt,
} from "../lib/revenue-stats.js";
import { ageUnitSchema, patientAgeShape, refinePatientAge } from "../lib/patient-age.js";
import { requireAuth, requireModule } from "../middleware/auth.js";

const visitInclude = {
  patient: true,
  assignedDoctor: { select: { id: true, firstName: true, lastName: true } },
  vitalSigns: { orderBy: { recordedAt: "desc" as const }, take: 1 },
  consultation: true,
  invoices: {
    where: { type: InvoiceType.CONSULTATION },
    orderBy: { createdAt: "desc" as const },
    take: 1,
  },
  surgeryCase: { include: { interventionType: true, surgeon: true } },
  hospitalization: { include: { room: true } },
};

function mapVisitWithBilling<T extends {
  consultationFeeFcfa: number | null;
  reductionFcfa: number | null;
  invoices: { id: string; invoiceNumber: string; amountFcfa: number; status: string }[];
}>(visit: T) {
  const invoice = visit.invoices[0];
  const amounts = computeConsultationAmounts(
    visit.consultationFeeFcfa,
    visit.reductionFcfa,
    invoice?.amountFcfa,
  );

  return {
    ...visit,
    billing: {
      ...amounts,
      invoiceId: invoice?.id ?? null,
      invoiceNumber: invoice?.invoiceNumber ?? null,
      invoiceStatus: invoice?.status ?? null,
    },
  };
}

const router = Router();
router.use(requireAuth);

const visitSchema = z.object({
  patientId: z.string(),
  doctorId: z.string().optional(),
  consultationAmountFcfa: z.number().int().min(0).optional(),
  reductionFcfa: z.number().int().min(0).optional(),
  weightKg: z.number().optional(),
  bloodPressure: z.string().optional(),
  temperatureC: z.number().optional(),
  pulseBpm: z.number().int().optional(),
  notes: z.string().optional(),
});

router.get("/doctors", async (req, res) => {
  const user = req.user!;
  if (
    !canAccessModule(user.role, "reception") &&
    !canAccessModule(user.role, "consultation")
  ) {
    return res.status(403).json({ error: "Accès refusé" });
  }

  const doctors = await prisma.user.findMany({
    where: { role: "MEDECIN", active: true },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      role: true,
      employee: {
        select: {
          isMedecin: true,
          doctorCompensationType: true,
          consultationTotalFcfa: true,
          consultationQuotaMode: true,
          consultationQuotaPercent: true,
          consultationQuotaFcfa: true,
          consultationValidityDays: true,
          consultationRenewalPolicy: true,
          surgeryQuotaPercent: true,
        },
      },
    },
    orderBy: { lastName: "asc" },
  });
  return res.json(
    doctors.map((doctor) => ({
      id: doctor.id,
      firstName: doctor.firstName,
      lastName: doctor.lastName,
      ...serializeDoctorFields({ role: doctor.role, employee: doctor.employee }),
    })),
  );
});

router.get("/", async (req, res) => {
  const user = req.user!;
  const queue = req.query.queue as string | undefined;
  const statusFilter: VisitStatus[] = [];
  if (canAccessModule(user.role, "consultation")) {
    statusFilter.push(VisitStatus.WAITING_CONSULTATION, VisitStatus.IN_CONSULTATION);
  }
  if (canAccessModule(user.role, "comptabilite")) {
    statusFilter.push(
      VisitStatus.NEEDS_SURGERY,
      VisitStatus.NEEDS_HOSPITALIZATION,
      VisitStatus.AWAITING_ACCOUNTING,
    );
  }
  if (canAccessModule(user.role, "reception")) {
    statusFilter.push(VisitStatus.WAITING_CONSULTATION);
  }

  const where: Prisma.VisitWhereInput = statusFilter.length
    ? { status: { in: statusFilter } }
    : {};

  if (
    queue === "supervision" &&
    (user.role === UserRole.ADMIN || user.role === UserRole.COMPTABLE)
  ) {
    where.status = { in: [VisitStatus.WAITING_CONSULTATION, VisitStatus.IN_CONSULTATION] };
  } else if (queue === "pending" && canAccessModule(user.role, "consultation")) {
    Object.assign(where, medecinPendingConsultationVisitWhere(user.id));
  }

  if (queue === "consulted" && canAccessModule(user.role, "consultation")) {
    Object.assign(where, medecinDejaConsulteVisitWhere(user.id));
  }

  if (queue === "my-patients" && canAccessModule(user.role, "consultation")) {
    where.status = { in: [VisitStatus.WAITING_CONSULTATION, VisitStatus.IN_CONSULTATION] };
    where.OR = [
      { assignedDoctorId: user.id },
      { consultation: { is: { doctorId: user.id } } },
    ];
  }

  const visits = await prisma.visit.findMany({
    where,
    include: visitInclude,
    orderBy:
      queue === "consulted" || queue === "my-patients"
        ? { updatedAt: "desc" }
        : { createdAt: "asc" },
    take: queue === "consulted" ? 200 : 100,
  });
  return res.json(visits.map(mapVisitWithBilling));
});

router.patch("/:id/start-consultation", requireModule("consultation"), async (req, res) => {
  const visitId = String(req.params.id);
  const user = req.user!;
  const existing = await prisma.visit.findUnique({
    where: { id: visitId },
    include: { consultation: { select: { doctorId: true } } },
  });
  if (!existing) return res.status(404).json({ error: "Visite introuvable" });

  if (!visitBelongsToDoctor(existing, user.id)) {
    return res.status(403).json({ error: "Ce patient n'est pas assigné à votre compte." });
  }

  if (
    existing.status !== VisitStatus.WAITING_CONSULTATION &&
    existing.status !== VisitStatus.IN_CONSULTATION
  ) {
    return res.status(409).json({ error: "Cette visite n'est plus en attente de consultation." });
  }

  const visit = await prisma.visit.update({
    where: { id: visitId },
    data: { status: VisitStatus.IN_CONSULTATION },
    include: visitInclude,
  });

  return res.json(mapVisitWithBilling(visit));
});

const transferSchema = z.object({
  doctorId: z.string(),
});

router.patch("/:id/transfer", requireModule("consultation"), async (req, res) => {
  try {
    const visitId = String(req.params.id);
    const user = req.user!;
    const body = transferSchema.parse(req.body);

    const doctor = await prisma.user.findFirst({
      where: { id: body.doctorId, role: "MEDECIN", active: true },
    });
    if (!doctor) return res.status(400).json({ error: "Médecin invalide" });

    const existing = await prisma.visit.findUnique({
      where: { id: visitId },
      include: { consultation: true },
    });
    if (!existing) return res.status(404).json({ error: "Visite introuvable" });

    if (!visitBelongsToDoctor(existing, user.id)) {
      return res.status(403).json({ error: "Vous ne pouvez transférer que vos propres patients." });
    }

    if (
      existing.status !== VisitStatus.WAITING_CONSULTATION &&
      existing.status !== VisitStatus.IN_CONSULTATION
    ) {
      return res.status(409).json({ error: "Ce patient n'est plus en file de consultation." });
    }

    if (hasExamsPrescribed(existing.consultation?.clinicalNotes ?? null)) {
      return res.status(409).json({ error: "Patient déjà consulté — transfert impossible." });
    }

    const visit = await prisma.$transaction(async (tx) => {
      if (existing.consultation) {
        await tx.consultation.delete({ where: { visitId } });
      }

      return tx.visit.update({
        where: { id: visitId },
        data: {
          assignedDoctorId: body.doctorId,
          status: VisitStatus.WAITING_CONSULTATION,
        },
        include: visitInclude,
      });
    });

    return res.json(mapVisitWithBilling(visit));
  } catch {
    return res.status(400).json({ error: "Données invalides" });
  }
});

router.get("/consultations-comptabilite", async (req, res) => {
  const user = req.user!;
  if (!canAccessModule(user.role, "reception") && !canAccessModule(user.role, "comptabilite")) {
    return res.status(403).json({ error: "Accès refusé" });
  }

  const statusFilter = req.query.status as string | undefined;

  const visits = await prisma.visit.findMany({
    where: {
      patient: comptabilitePatientWhere(),
      OR: [
        { consultationFeeFcfa: { not: null } },
        { invoices: { some: { type: InvoiceType.CONSULTATION } } },
      ],
    },
    include: {
      patient: { select: { code: true, firstName: true, lastName: true } },
      assignedDoctor: { select: { firstName: true, lastName: true } },
      invoices: {
        where: { type: InvoiceType.CONSULTATION },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  const rows = visits
    .map((visit) => {
      const invoice = visit.invoices[0];
      const amounts = computeConsultationAmounts(
        visit.consultationFeeFcfa,
        visit.reductionFcfa,
        invoice?.amountFcfa,
      );

      return {
        visitId: visit.id,
        patient: visit.patient,
        doctor: visit.assignedDoctor,
        ...amounts,
        invoiceId: invoice?.id ?? null,
        invoiceNumber: invoice?.invoiceNumber ?? null,
        invoiceStatus: invoice?.status ?? null,
        visitStatus: visit.status,
        createdAt: visit.createdAt,
      };
    })
    .filter((row) => !statusFilter || row.invoiceStatus === statusFilter);

  return res.json(rows);
});

router.get("/encaissements-comptabilite", async (req, res) => {
  const user = req.user!;
  if (!canAccessModule(user.role, "reception") && !canAccessModule(user.role, "comptabilite")) {
    return res.status(403).json({ error: "Accès refusé" });
  }

  const typeFilter = req.query.type as string | undefined;
  const limit = Math.min(Number(req.query.limit ?? 500), 1000);

  const invoices = await prisma.invoice.findMany({
    where: {
      ...collectedInvoicesWhere(new Date(0)),
      ...(typeFilter ? { type: typeFilter as InvoiceType } : {}),
      ...(user.role === UserRole.RECEPTIONNISTE ? { issuedById: user.id } : {}),
    },
    include: {
      patient: { select: { code: true, firstName: true, lastName: true } },
      visit: {
        select: {
          assignedDoctor: { select: { firstName: true, lastName: true } },
        },
      },
      issuedBy: { select: { firstName: true, lastName: true } },
    },
    orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
    take: limit,
  });

  const rows = invoices
    .map((invoice) => {
      const collectedAt = invoiceCollectedAt(invoice);
      if (!collectedAt) return null;

      return {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        type: invoice.type,
        typeLabel: INVOICE_TYPE_LABELS[invoice.type],
        amountFcfa: invoice.amountFcfa,
        status: invoice.status,
        patient: invoice.patient,
        doctor: invoice.visit?.assignedDoctor ?? null,
        issuedBy: invoice.issuedBy,
        collectedAt: collectedAt.toISOString(),
        createdAt: invoice.createdAt.toISOString(),
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  return res.json(rows);
});

router.get("/compte-rendu-receptions", async (req, res) => {
  const user = req.user!;
  if (!canAccessModule(user.role, "reception") && !canAccessModule(user.role, "comptabilite")) {
    return res.status(403).json({ error: "Accès refusé" });
  }

  const visits = await prisma.visit.findMany({
    where: {
      patient: comptabilitePatientWhere(),
      OR: [
        { consultationFeeFcfa: { not: null } },
        { invoices: { some: { type: InvoiceType.CONSULTATION } } },
      ],
    },
    include: {
      patient: { select: { code: true, firstName: true, lastName: true } },
      assignedDoctor: { select: { firstName: true, lastName: true } },
      invoices: {
        where: { type: InvoiceType.CONSULTATION },
        orderBy: { createdAt: "desc" },
        take: 1,
        include: {
          issuedBy: { select: { id: true, firstName: true, lastName: true, role: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  const grouped = new Map<
    string,
    {
      receptionist: { id: string; firstName: string; lastName: string };
      rows: Array<{
        visitId: string;
        patient: { code: string; firstName: string; lastName: string };
        doctor: { firstName: string; lastName: string } | null;
        consultationFeeFcfa: number;
        reductionFcfa: number;
        totalFcfa: number;
        invoiceId: string | null;
        invoiceNumber: string | null;
        invoiceStatus: string | null;
        visitStatus: string;
        createdAt: string;
      }>;
      totalNet: number;
      totalReduction: number;
      count: number;
    }
  >();

  for (const visit of visits) {
    const invoice = visit.invoices[0];
    const receptionist = invoice?.issuedBy;
    if (!receptionist) continue;

    const amounts = computeConsultationAmounts(
      visit.consultationFeeFcfa,
      visit.reductionFcfa,
      invoice?.amountFcfa,
    );

    const row = {
      visitId: visit.id,
      patient: visit.patient,
      doctor: visit.assignedDoctor,
      ...amounts,
      invoiceId: invoice?.id ?? null,
      invoiceNumber: invoice?.invoiceNumber ?? null,
      invoiceStatus: invoice?.status ?? null,
      visitStatus: visit.status,
      createdAt: visit.createdAt.toISOString(),
    };

    const existing = grouped.get(receptionist.id);
    if (existing) {
      existing.rows.push(row);
      existing.totalNet += amounts.totalFcfa;
      existing.totalReduction += amounts.reductionFcfa;
      existing.count += 1;
    } else {
      grouped.set(receptionist.id, {
        receptionist: {
          id: receptionist.id,
          firstName: receptionist.firstName,
          lastName: receptionist.lastName,
        },
        rows: [row],
        totalNet: amounts.totalFcfa,
        totalReduction: amounts.reductionFcfa,
        count: 1,
      });
    }
  }

  const receptionists = Array.from(grouped.values()).sort((a, b) =>
    `${a.receptionist.lastName} ${a.receptionist.firstName}`.localeCompare(
      `${b.receptionist.lastName} ${b.receptionist.firstName}`,
    ),
  );

  return res.json({ receptionists });
});

router.get("/etat-patients", requireModule("reception"), async (_req, res) => {
  await cancelDuplicateActiveVisits();

  const visits = await prisma.visit.findMany({
    where: {
      status: { notIn: [VisitStatus.CANCELLED] },
    },
    include: {
      patient: true,
      assignedDoctor: { select: { id: true, firstName: true, lastName: true } },
      vitalSigns: { orderBy: { recordedAt: "desc" }, take: 1 },
      consultation: true,
      surgeryCase: { include: { interventionType: true } },
      hospitalization: { include: { room: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: 500,
  });

  const result = keepLatestVisitPerPatient(visits);
  result.sort((a, b) => {
    const byDate = b.patient.createdAt.getTime() - a.patient.createdAt.getTime();
    if (byDate !== 0) return byDate;
    const num = (code: string) => {
      const m = code.match(/(\d+)$/);
      return m ? Number(m[1]) : 0;
    };
    return num(b.patient.code) - num(a.patient.code);
  });
  return res.json(result);
});

router.post("/", requireModule("reception"), async (req, res) => {
  try {
    const body = visitSchema.parse(req.body);
    const plan = await planReconsultation(body.patientId);

    if (body.doctorId) {
      const doctor = await prisma.user.findFirst({
        where: { id: body.doctorId, role: "MEDECIN", active: true },
      });
      if (!doctor) {
        return res.status(400).json({ error: "Médecin invalide" });
      }
    }

    if (body.consultationAmountFcfa && (body.reductionFcfa ?? 0) > body.consultationAmountFcfa) {
      return res.status(400).json({ error: "La réduction ne peut pas dépasser le montant." });
    }

    const patient = await prisma.patient.findUnique({ where: { id: body.patientId } });
    if (!patient) return res.status(404).json({ error: "Patient introuvable" });

    let consultationAmountFcfa = body.consultationAmountFcfa;
    let renewalHint: string | undefined;

    if (body.doctorId) {
      try {
        const renewal = await resolveConsultationFeeForPatientDoctor({
          patientId: body.patientId,
          doctorId: body.doctorId,
          requestedAmount: body.consultationAmountFcfa,
        });
        consultationAmountFcfa = renewal.amountFcfa;
        renewalHint = renewal.message;
      } catch {
        return res.status(400).json({ error: "Impossible de calculer le tarif de consultation." });
      }
    }

    const billing = resolveConsultationBilling(
      patient.category,
      consultationAmountFcfa,
      body.reductionFcfa,
    );

    const visit = await prisma.$transaction(async (tx) => {
      if (plan.action === "create" && plan.archiveVisitIds.length) {
        await archiveVisitsForReconsultation(tx, plan.archiveVisitIds);
      }

      if (plan.action === "update") {
        const updatedVisit = await tx.visit.update({
          where: { id: plan.visitId },
          data: {
            status: VisitStatus.WAITING_CONSULTATION,
            assignedDoctorId: body.doctorId,
            consultationFeeFcfa: billing.consultationAmountFcfa || undefined,
            reductionFcfa: billing.reductionFcfa,
            notes: body.notes,
          },
        });

        if (body.weightKg || body.bloodPressure || body.temperatureC || body.pulseBpm) {
          await tx.vitalSign.create({
            data: {
              visitId: updatedVisit.id,
              patientId: body.patientId,
              weightKg: body.weightKg,
              bloodPressure: body.bloodPressure,
              temperatureC: body.temperatureC,
              pulseBpm: body.pulseBpm,
              recordedById: req.user!.id,
            },
          });
        }

        let invoiceNumber: string | undefined;
        if (billing.billableAmountFcfa > 0) {
          const existingInvoice = await tx.invoice.findFirst({
            where: { visitId: updatedVisit.id, type: InvoiceType.CONSULTATION },
          });

          if (existingInvoice?.status === InvoiceStatus.PAID) {
            invoiceNumber = existingInvoice.invoiceNumber;
          } else if (existingInvoice) {
            const invoice = await tx.invoice.update({
              where: { id: existingInvoice.id },
              data: consultationInvoiceUpdateData(patient.category, billing.billableAmountFcfa),
            });
            invoiceNumber = invoice.invoiceNumber;
          } else {
            const invoice = await tx.invoice.create({
              data: consultationInvoiceCreateData(patient.category, {
                invoiceNumber: await generateInvoiceNumber(),
                patientId: body.patientId,
                visitId: updatedVisit.id,
                amountFcfa: billing.billableAmountFcfa,
                issuedById: req.user!.id,
              }),
            });
            invoiceNumber = invoice.invoiceNumber;
          }
        }

        return {
          ...updatedVisit,
          invoiceNumber,
          totalFcfa: billing.billableAmountFcfa,
          patientCategory: patient.category,
          billingDeferred: !shouldCreateImmediateInvoice(patient.category),
          renewalHint,
        };
      }

      const createdVisit = await tx.visit.create({
        data: {
          patientId: body.patientId,
          status: VisitStatus.WAITING_CONSULTATION,
          assignedDoctorId: body.doctorId,
          consultationFeeFcfa: billing.consultationAmountFcfa || undefined,
          reductionFcfa: billing.reductionFcfa,
          notes: body.notes,
        },
      });

      if (body.weightKg || body.bloodPressure || body.temperatureC || body.pulseBpm) {
        await tx.vitalSign.create({
          data: {
            visitId: createdVisit.id,
            patientId: body.patientId,
            weightKg: body.weightKg,
            bloodPressure: body.bloodPressure,
            temperatureC: body.temperatureC,
            pulseBpm: body.pulseBpm,
            recordedById: req.user!.id,
          },
        });
      }

      if (billing.billableAmountFcfa > 0) {
        const invoice = await tx.invoice.create({
          data: consultationInvoiceCreateData(patient.category, {
            invoiceNumber: await generateInvoiceNumber(),
            patientId: body.patientId,
            visitId: createdVisit.id,
            amountFcfa: billing.billableAmountFcfa,
            issuedById: req.user!.id,
          }),
        });

        return {
          ...createdVisit,
          invoiceNumber: invoice.invoiceNumber,
          totalFcfa: billing.billableAmountFcfa,
          patientCategory: patient.category,
          billingDeferred: !shouldCreateImmediateInvoice(patient.category),
          renewalHint,
        };
      }

      return {
        ...createdVisit,
        totalFcfa: billing.billableAmountFcfa,
        patientCategory: patient.category,
        billingDeferred: !shouldCreateImmediateInvoice(patient.category),
        renewalHint,
      };
    });

    return res.status(201).json(visit);
  } catch (error) {
    if (error instanceof Error && error.message === PATIENT_HAS_PAYMENTS_CODE) {
      return res.status(409).json({ error: PATIENT_HAS_PAYMENTS_MESSAGE });
    }
    return res.status(400).json({ error: "Données invalides" });
  }
});

const examsByKindSchema = z.object({
  examen: z.array(z.string().min(1)).default([]),
  radio: z.array(z.string().min(1)).default([]),
  echo: z.array(z.string().min(1)).default([]),
  odonto: z.array(z.string().min(1)).default([]),
});

const externalLabOrderSchema = z
  .object({
    patientId: z.string().optional(),
    firstName: z.string().min(2).optional(),
    lastName: z.string().min(2).optional(),
    phone: z.string().optional(),
    gender: z.string().optional(),
    ...patientAgeShape,
    exams: z.array(z.string().min(1)).optional(),
    examsByKind: examsByKindSchema.optional(),
    reductionFcfa: z.number().int().min(0).default(0),
  })
  .refine((data) => data.patientId || (data.firstName && data.lastName), {
    message: "Patient requis",
  })
  .refine(
    (data) => {
      if (data.examsByKind) {
        return flattenPrescribedExams(data.examsByKind as Record<ExamKindSlug, string[]>).length > 0;
      }
      return (data.exams?.length ?? 0) > 0;
    },
    { message: "Au moins un examen est requis." },
  )
  .superRefine(refinePatientAge);

const externalPatientSchema = z
  .object({
    patientId: z.string().optional(),
    firstName: z.string().min(2).optional(),
    lastName: z.string().min(2).optional(),
    phone: z.string().optional(),
    gender: z.string().optional(),
    ...patientAgeShape,
  })
  .refine((data) => data.patientId || (data.firstName && data.lastName), {
    message: "Patient requis",
  })
  .superRefine(refinePatientAge);

router.get("/external-queue", requireModule("reception"), async (_req, res) => {
  const consultations = await prisma.consultation.findMany({
    where: {
      visit: {
        notes: { contains: EXTERNAL_PATIENT_VISIT_NOTE },
        patient: { category: PatientCategory.STANDARD },
      },
    },
    include: {
      visit: {
        include: {
          patient: true,
          invoices: { where: { type: InvoiceType.LAB_EXAM }, take: 1 },
        },
      },
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });

  const rows = consultations.map((row) => {
    const hasExams = hasExamsPrescribed(row.clinicalNotes);
    const grossFcfa = hasExams ? computeLabExamsGrossFcfa(row.clinicalNotes) : 0;
    const invoice = row.visit.invoices[0];
    return {
      id: row.id,
      visitId: row.visitId,
      patientId: row.visit.patientId,
      updatedAt: row.updatedAt,
      labSentToLabAt: row.labSentToLabAt,
      patient: row.visit.patient,
      clinicalNotes: row.clinicalNotes,
      hasExams,
      examsSummary: hasExams
        ? buildLabExamLines(row.clinicalNotes).map((l) => l.label).join(", ")
        : "Examens en attente",
      grossFcfa,
      netFcfa: hasExams ? Math.max(0, grossFcfa - (row.labExamReductionFcfa ?? 0)) : 0,
      invoiced: !!invoice,
      invoiceNumber: invoice?.invoiceNumber ?? null,
    };
  });

  return res.json(rows);
});

router.post("/external-patient", requireModule("reception"), async (req, res) => {
  try {
    const body = externalPatientSchema.parse(req.body);

    if (!body.patientId) {
      const duplicate = await findDuplicatePatient({
        firstName: body.firstName!,
        lastName: body.lastName!,
        phone: body.phone,
        age: body.age,
        ageUnit: body.ageUnit,
      });
      if (duplicate) {
        return res.status(409).json(
          duplicateErrorResponse(
            "patient",
            "Un patient avec ces informations est déjà enregistré.",
            serializePatientForDuplicate(duplicate),
          ),
        );
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      let patientId = body.patientId;

      if (!patientId) {
        const patient = await tx.patient.create({
          data: {
            code: await generatePatientCode(),
            firstName: body.firstName!,
            lastName: body.lastName!,
            phone: body.phone,
            gender: body.gender,
            age: body.age,
            ageUnit: body.ageUnit,
            category: PatientCategory.STANDARD,
          },
        });
        patientId = patient.id;
      } else {
        const patient = await tx.patient.findUnique({ where: { id: patientId } });
        if (!patient) throw new Error("PATIENT_NOT_FOUND");
        if (!isComptabiliteBillablePatient(patient.category)) {
          throw new Error("PATIENT_NOT_BILLABLE");
        }
      }

      const pendingVisit = await tx.visit.findFirst({
        where: {
          patientId,
          notes: { contains: EXTERNAL_PATIENT_VISIT_NOTE },
          status: { notIn: [VisitStatus.COMPLETED, VisitStatus.CANCELLED] },
          consultation: {
            OR: [
              { clinicalNotes: null },
              { clinicalNotes: EXTERNAL_EXAMS_PENDING_NOTE },
              { NOT: { clinicalNotes: { contains: EXAMS_PRESCRIBED_PREFIX } } },
            ],
          },
        },
        include: { patient: true, consultation: true },
      });

      if (pendingVisit) {
        return { visit: pendingVisit, consultation: pendingVisit.consultation, alreadyRegistered: true };
      }

      const blockingVisit = await tx.visit.findFirst({
        where: {
          patientId,
          status: { notIn: [VisitStatus.COMPLETED, VisitStatus.CANCELLED] },
          NOT: { notes: { contains: EXTERNAL_PATIENT_VISIT_NOTE } },
        },
      });
      if (blockingVisit) throw new Error("ACTIVE_VISIT_EXISTS");

      const visit = await tx.visit.create({
        data: {
          patientId,
          status: VisitStatus.IN_TREATMENT,
          notes: EXTERNAL_PATIENT_VISIT_NOTE,
        },
        include: { patient: true },
      });

      const consultation = await tx.consultation.create({
        data: {
          visitId: visit.id,
          clinicalNotes: EXTERNAL_EXAMS_PENDING_NOTE,
        },
      });

      return { visit, consultation, alreadyRegistered: false };
    });

    return res.status(201).json(result);
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: "Données invalides" });
    if (error instanceof Error) {
      if (error.message === "PATIENT_NOT_FOUND") {
        return res.status(404).json({ error: "Patient introuvable" });
      }
      if (error.message === "ACTIVE_VISIT_EXISTS") {
        return res.status(409).json({
          error: "Ce patient a déjà une visite en cours dans le parcours clinique.",
        });
      }
      if (error.message === "PATIENT_NOT_BILLABLE") {
        return res.status(400).json({
          error: "Ce patient associé doit être enregistré via le parcours adapté.",
        });
      }
    }
    return res.status(500).json({ error: "Erreur serveur" });
  }
});

router.post("/external-lab-order", requireModule("reception"), async (req, res) => {
  try {
    const body = externalLabOrderSchema.parse(req.body);
    const user = req.user!;
    const examLabels = body.examsByKind
      ? flattenPrescribedExams(body.examsByKind as Record<ExamKindSlug, string[]>)
      : body.exams ?? [];
    const grossFcfa = computeGrossFcfaFromExamLabels(examLabels);

    if (grossFcfa <= 0) {
      return res.status(400).json({ error: "Aucun examen facturable." });
    }
    if (body.reductionFcfa > grossFcfa) {
      return res.status(400).json({ error: "La réduction ne peut pas dépasser le montant total." });
    }

    const clinicalNotes = body.examsByKind
      ? buildPrescribedExamsNotesByKind(body.examsByKind)
      : buildPrescribedExamsNotes(examLabels);

    if (!body.patientId) {
      const duplicate = await findDuplicatePatient({
        firstName: body.firstName!,
        lastName: body.lastName!,
        phone: body.phone,
        age: body.age,
        ageUnit: body.ageUnit,
      });
      if (duplicate) {
        return res.status(409).json(
          duplicateErrorResponse(
            "patient",
            "Un patient avec ces informations est déjà enregistré.",
            serializePatientForDuplicate(duplicate),
          ),
        );
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      let patientId = body.patientId;
      let patientCategory = body.patientId
        ? (await tx.patient.findUnique({ where: { id: body.patientId } }))?.category
        : undefined;

      if (!patientId) {
        const patient = await tx.patient.create({
          data: {
            code: await generatePatientCode(),
            firstName: body.firstName!,
            lastName: body.lastName!,
            phone: body.phone,
            gender: body.gender,
            age: body.age,
            ageUnit: body.ageUnit,
            category: PatientCategory.STANDARD,
          },
        });
        patientId = patient.id;
        patientCategory = patient.category;
      } else if (!patientCategory) {
        throw new Error("PATIENT_NOT_FOUND");
      } else if (!isComptabiliteBillablePatient(patientCategory)) {
        throw new Error("PATIENT_NOT_BILLABLE");
      }

      const activeVisit = await tx.visit.findFirst({
        where: {
          patientId,
          status: { notIn: [VisitStatus.COMPLETED, VisitStatus.CANCELLED] },
        },
        include: { consultation: true, patient: true },
      });

      if (activeVisit && !activeVisit.notes?.includes(EXTERNAL_PATIENT_VISIT_NOTE)) {
        throw new Error("ACTIVE_VISIT_EXISTS");
      }

      const examReduction = body.reductionFcfa;
      const netFcfa = grossFcfa - examReduction;
      const paidAt = new Date();

      let notesWithPayment = clinicalNotes;
      if (body.examsByKind) {
        for (const kind of LAB_BILLABLE_EXAM_KINDS) {
          const exams = (body.examsByKind as Record<ExamKindSlug, string[]>)[kind];
          if (exams?.length) {
            notesWithPayment = appendPaidExamKindMarker(notesWithPayment, kind, paidAt);
          }
        }
      } else if (examLabels.length) {
        notesWithPayment = appendPaidExamKindMarker(notesWithPayment, "examen", paidAt);
      }

      const pendingExternal =
        activeVisit?.notes?.includes(EXTERNAL_PATIENT_VISIT_NOTE) &&
        activeVisit.consultation &&
        !activeVisit.consultation.clinicalNotes?.includes(EXAMS_PRESCRIBED_PREFIX)
          ? activeVisit
          : null;

      let visitId: string;
      let consultation;

      if (pendingExternal?.consultation) {
        visitId = pendingExternal.id;
        consultation = await tx.consultation.update({
          where: { id: pendingExternal.consultation.id },
          data: {
            clinicalNotes: notesWithPayment,
            labExamReductionFcfa: examReduction,
            labSentToLabAt: paidAt,
            labApprovedById: user.id,
          },
        });
      } else {
        const newVisit = await tx.visit.create({
          data: {
            patientId,
            status: VisitStatus.IN_TREATMENT,
            notes: EXTERNAL_PATIENT_VISIT_NOTE,
          },
          include: { patient: true },
        });
        visitId = newVisit.id;

        consultation = await tx.consultation.create({
          data: {
            visitId: newVisit.id,
            clinicalNotes: notesWithPayment,
            labExamReductionFcfa: examReduction,
            labSentToLabAt: paidAt,
            labApprovedById: user.id,
          },
        });
      }

      let invoice = null;
      if (shouldCreateImmediateInvoice(patientCategory!) && netFcfa > 0) {
        invoice = await tx.invoice.create({
          data: {
            invoiceNumber: await generateInvoiceNumber(),
            patientId,
            visitId,
            type: InvoiceType.LAB_EXAM,
            amountFcfa: netFcfa,
            status: InvoiceStatus.PAID,
            issuedById: user.id,
            paidAt: new Date(),
          },
        });
      }

      const visit =
        pendingExternal ??
        (await tx.visit.findUnique({
          where: { id: visitId },
          include: { patient: true },
        }));

      return { visit, consultation, invoice, grossFcfa, netFcfa };
    });

    return res.status(201).json(result);
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: "Données invalides" });
    if (error instanceof Error) {
      if (error.message === "PATIENT_NOT_FOUND") {
        return res.status(404).json({ error: "Patient introuvable" });
      }
      if (error.message === "ACTIVE_VISIT_EXISTS") {
        return res.status(409).json({
          error: "Ce patient a déjà une visite en cours. Utilisez la file d'attente de paiement.",
        });
      }
      if (error.message === "PATIENT_NOT_BILLABLE") {
        return res.status(400).json({
          error: "Ce patient associé ne peut pas être enregistré comme patient externe.",
        });
      }
    }
    return res.status(500).json({ error: "Erreur serveur" });
  }
});

export default router;
