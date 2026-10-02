import { Router } from "express";
import { z } from "zod";
import { InvoiceStatus, InvoiceType, PatientCategory, UserRole, VisitStatus, type Prisma } from "@prisma/client";
import { prisma } from "../lib/db.js";
import { generateInvoiceNumber, generatePatientCode } from "../lib/patient-code.js";
import { computeConsultationAmounts } from "../lib/consultation-amounts.js";
import { ageUnitSchema, refinePatientAge } from "../lib/patient-age.js";
import { resolveConsultationBilling, shouldCreateImmediateInvoice } from "../lib/patient-billing.js";
import { aggregateCollectedToday } from "../lib/revenue-stats.js";
import { buildRegistrationSummary } from "../lib/registration-summary.js";
import {
  aggregateCollectedForCashier,
  applyOpenClosureAdjustments,
  listPatientClosureAmounts,
  sumExpensesForCashierOnDate,
} from "../lib/cashier-personal-stats.js";
import { CASH_COLLECTOR_ROLES } from "../lib/cash-shift.js";
import { resolveConsultationFeeForPatientDoctor } from "../lib/consultation-validity.js";
import {
  consultationInvoiceCreateData,
  consultationInvoiceUpdateData,
} from "../lib/consultation-invoice.js";
import {
  archiveVisitsForReconsultation,
  planReconsultation,
} from "../lib/reconsultation.js";
import {
  PATIENT_ALREADY_CONSULTED_CODE,
  PATIENT_ALREADY_CONSULTED_MESSAGE,
  PATIENT_HAS_DATA_CODE,
  PATIENT_HAS_DATA_MESSAGE,
  PATIENT_HAS_PAYMENTS_CODE,
  PATIENT_HAS_PAYMENTS_MESSAGE,
  assertPatientDeletable,
  findPatientIdsDeletionLocked,
} from "../lib/patient-payment-guard.js";
import { forceDeletePatientCascade } from "../lib/patient-admin-delete.js";
import {
  findDuplicatePatient,
  serializePatientForDuplicate,
} from "../lib/duplicate-detection.js";
import {
  isUsablePatientPhone,
  mergePatientIntoCanonical,
  phonesMatchForDossierReuse,
} from "../lib/merge-patients.js";
import { duplicateErrorResponse } from "../lib/duplicate-error.js";
import { selectableDoctorByIdWhere, resolveDoctorConsultationAmount } from "../lib/doctor-compensation.js";
import { requireAuth, requireModule, requireUiAction } from "../middleware/auth.js";
import { canAccessModule, isDirectionOrGestionnaire, type AppUserRole } from "../lib/roles.js";
import { EXTERNAL_PATIENT_VISIT_NOTE } from "../lib/visit-external.js";
import { patientsWhoReceivedExamsWhere } from "../lib/patient-exam-stats.js";
import { receptionistOwnPatientsWhere } from "../lib/reception-scope.js";

const router = Router();
router.use(requireAuth);

const patientSchema = z
  .object({
    firstName: z.string().min(2),
    lastName: z.string().min(2),
    age: z.number().int().min(0).optional(),
    ageUnit: ageUnitSchema,
    phone: z.string().optional(),
    service: z.string().max(120).optional(),
    gender: z.string().optional(),
    dateOfBirth: z.string().optional(),
    address: z.string().optional(),
    category: z.nativeEnum(PatientCategory).optional(),
    recommendedByName: z.string().optional(),
    /** Médecin traitant permanent du dossier (optionnel) */
    treatingDoctorId: z.string().nullable().optional(),
  })
  .superRefine((data, ctx) => {
    refinePatientAge(data, ctx);
  });

const treatingDoctorSelect = {
  id: true,
  firstName: true,
  lastName: true,
} as const;

function normalizeRecommendedByName(name?: string | null) {
  const trimmed = name?.trim();
  return trimmed ? trimmed : null;
}

function resolvePatientCategory(category?: PatientCategory | null) {
  if (!category || category === PatientCategory.ONG) return PatientCategory.STANDARD;
  return category;
}

function normalizeTreatingDoctorId(value?: string | null) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

async function assertSelectableTreatingDoctor(treatingDoctorId: string | null | undefined) {
  const normalized = normalizeTreatingDoctorId(treatingDoctorId);
  if (!normalized) return normalized;
  const doctor = await prisma.user.findFirst({
    where: selectableDoctorByIdWhere(normalized),
  });
  if (!doctor) {
    throw new Error("TREATING_DOCTOR_INVALID");
  }
  return normalized;
}

const receptionUpdateSchema = patientSchema.safeExtend({
  doctorId: z.string().optional(),
  consultationAmountFcfa: z.number().int().positive().optional(),
  reductionFcfa: z.number().int().min(0).optional(),
});

const ACTIVE_CONSULTATION_STATUSES: VisitStatus[] = [
  VisitStatus.WAITING_CONSULTATION,
  VisitStatus.IN_CONSULTATION,
  VisitStatus.NEEDS_SURGERY,
  VisitStatus.NEEDS_HOSPITALIZATION,
  VisitStatus.AWAITING_ACCOUNTING,
];

const consultationVisitInclude = {
  assignedDoctor: { select: { id: true, firstName: true, lastName: true } },
  invoices: {
    where: { type: InvoiceType.CONSULTATION },
    orderBy: { createdAt: "desc" as const },
    take: 1,
  },
};

async function findPrintableConsultationVisit(patientId: string) {
  const hasBill = (visit: {
    consultationFeeFcfa: number | null
    invoices: unknown[]
  }) =>
    (visit.consultationFeeFcfa != null && visit.consultationFeeFcfa > 0) ||
    visit.invoices.length > 0

  const activeVisit = await prisma.visit.findFirst({
    where: {
      patientId,
      status: { in: ACTIVE_CONSULTATION_STATUSES },
    },
    orderBy: { createdAt: "desc" },
    include: consultationVisitInclude,
  });

  if (activeVisit && hasBill(activeVisit)) return activeVisit;

  const billedVisit = await prisma.visit.findFirst({
    where: {
      patientId,
      status: { not: VisitStatus.CANCELLED },
      OR: [
        { consultationFeeFcfa: { gt: 0 } },
        { invoices: { some: { type: InvoiceType.CONSULTATION } } },
      ],
    },
    orderBy: { createdAt: "desc" },
    include: consultationVisitInclude,
  });

  if (billedVisit) return billedVisit;
  if (activeVisit) return activeVisit;

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  return prisma.visit.findFirst({
    where: {
      patientId,
      status: { notIn: [VisitStatus.CANCELLED, VisitStatus.COMPLETED] },
      createdAt: { gte: startOfToday },
    },
    orderBy: { createdAt: "desc" },
    include: consultationVisitInclude,
  });
}

function mapConsultationPayment(invoice: {
  id: string;
  invoiceNumber: string;
  status: InvoiceStatus;
  amountFcfa: number;
  paidAmountFcfa: number;
} | null | undefined) {
  if (!invoice || invoice.status === InvoiceStatus.CANCELLED) return null;
  const remainingFcfa = Math.max(0, invoice.amountFcfa - invoice.paidAmountFcfa);
  return {
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    status: invoice.status,
    amountFcfa: invoice.amountFcfa,
    paidAmountFcfa: invoice.paidAmountFcfa,
    remainingFcfa,
    payable:
      remainingFcfa > 0 &&
      (invoice.status === InvoiceStatus.PENDING ||
        invoice.status === InvoiceStatus.PARTIALLY_PAID ||
        invoice.status === InvoiceStatus.DRAFT),
  };
}

function mapConsultationVisitForReception(
  visit: NonNullable<Awaited<ReturnType<typeof findPrintableConsultationVisit>>>,
) {
  const amounts = computeConsultationAmounts(
    visit.consultationFeeFcfa,
    visit.reductionFcfa,
    visit.invoices[0]?.amountFcfa,
  );

  return {
    id: visit.id,
    doctorId: visit.assignedDoctorId,
    doctor: visit.assignedDoctor,
    consultationFeeFcfa: amounts.consultationFeeFcfa,
    reductionFcfa: amounts.reductionFcfa,
    consultationAmountFcfa: amounts.consultationFeeFcfa || null,
    invoiceNumber: visit.invoices[0]?.invoiceNumber ?? null,
    totalFcfa: amounts.totalFcfa,
    consultationPayment: mapConsultationPayment(visit.invoices[0]),
  };
}

async function syncWaitingVisit(
  tx: Prisma.TransactionClient,
  patientId: string,
  doctorId: string | undefined,
  consultationAmountFcfa: number | undefined,
  reductionFcfa: number | undefined,
  issuedById: string,
) {
  if (!doctorId && consultationAmountFcfa === undefined && reductionFcfa === undefined) return;

  const patient = await tx.patient.findUnique({ where: { id: patientId } });
  if (!patient) return;

  let resolvedAmount = consultationAmountFcfa;
  if (doctorId) {
    const doctor = await tx.user.findFirst({
      where: selectableDoctorByIdWhere(doctorId),
      include: { employee: true },
    });
    if (doctor) {
      resolvedAmount = resolveDoctorConsultationAmount(doctor, consultationAmountFcfa);
    }
  }

  const billing = resolveConsultationBilling(
    patient.category,
    resolvedAmount,
    reductionFcfa ?? 0,
  );

  let visit = await tx.visit.findFirst({
    where: {
      patientId,
      status: { in: [VisitStatus.WAITING_CONSULTATION, VisitStatus.IN_CONSULTATION] },
    },
    orderBy: { createdAt: "desc" },
  });

  if (!visit) {
    if (!doctorId && consultationAmountFcfa === undefined) return;
    visit = await tx.visit.create({
      data: {
        patientId,
        status: VisitStatus.WAITING_CONSULTATION,
        createdById: issuedById,
        assignedDoctorId: doctorId,
        consultationFeeFcfa: billing.consultationAmountFcfa || undefined,
        reductionFcfa: billing.reductionFcfa,
      },
    });
  } else {
    visit = await tx.visit.update({
      where: { id: visit.id },
      data: {
        assignedDoctorId: doctorId ?? visit.assignedDoctorId,
        consultationFeeFcfa: doctorId || consultationAmountFcfa !== undefined
          ? billing.consultationAmountFcfa || null
          : visit.consultationFeeFcfa,
        reductionFcfa: billing.reductionFcfa,
      },
    });
  }

  if (billing.billableAmountFcfa > 0) {
    const existingInvoice = await tx.invoice.findFirst({
      where: { visitId: visit.id, type: InvoiceType.CONSULTATION },
    });

    if (existingInvoice?.status === InvoiceStatus.PAID) {
      if (doctorId) {
        await tx.visit.update({
          where: { id: visit.id },
          data: { assignedDoctorId: doctorId },
        });
      }
      return;
    }

    if (existingInvoice) {
      await tx.invoice.update({
        where: { id: existingInvoice.id },
        data: consultationInvoiceUpdateData(patient.category, billing.billableAmountFcfa),
      });
    } else {
      await tx.invoice.create({
        data: consultationInvoiceCreateData(patient.category, {
          invoiceNumber: await generateInvoiceNumber(tx),
          patientId,
          visitId: visit.id,
          amountFcfa: billing.billableAmountFcfa,
          issuedById,
        }),
      });
    }
  } else {
    const existingInvoice = await tx.invoice.findFirst({
      where: { visitId: visit.id, type: InvoiceType.CONSULTATION },
    });
    if (existingInvoice) {
      if (existingInvoice.status === InvoiceStatus.PAID) {
        throw new Error(PATIENT_HAS_PAYMENTS_CODE);
      }
      await tx.invoice.delete({ where: { id: existingInvoice.id } });
    }
  }
}

router.get("/", async (req, res) => {
  const user = req.user!;
  const role = user.role as AppUserRole;
  const canFullList =
    canAccessModule(role, "reception") || canAccessModule(role, "comptabilite");
  const canSearchDossier = canAccessModule(role, "dossier-patient");
  if (!canFullList && !canSearchDossier) {
    return res.status(403).json({ error: "Accès refusé" });
  }

  const q = String(req.query.q ?? "").trim();
  const category = req.query.category as string | undefined;
  const fromParam = String(req.query.from ?? req.query.date ?? "").trim();
  const toParam = String(req.query.to ?? "").trim();
  const createdById = String(req.query.createdById ?? "").trim();
  const service = String(req.query.service ?? "").trim();
  const doctorId = String(req.query.doctorId ?? "").trim();
  const terms = q.split(/\s+/).filter(Boolean);
  if (!canFullList && terms.length === 0) {
    return res.json([]);
  }
  const ownScope = receptionistOwnPatientsWhere(user, createdById);

  function parseDayStart(value: string): Date | null {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const [year, month, day] = value.split("-").map(Number);
    const start = new Date();
    start.setFullYear(year, month - 1, day);
    start.setHours(0, 0, 0, 0);
    return start;
  }

  let createdAtFilter: { gte?: Date; lt?: Date } | undefined;
  const fromDay = parseDayStart(fromParam);
  const toDay = parseDayStart(toParam || fromParam);
  if (fromDay || toDay) {
    createdAtFilter = {};
    if (fromDay) createdAtFilter.gte = fromDay;
    if (toDay) {
      const end = new Date(toDay);
      end.setDate(end.getDate() + 1);
      createdAtFilter.lt = end;
    }
  }

  const patients = await prisma.patient.findMany({
    where: {
      ...ownScope,
      ...(category ? { category: category as PatientCategory } : {}),
      ...(service ? { service } : {}),
      ...(createdAtFilter ? { createdAt: createdAtFilter } : {}),
      ...patientsAssignedToDoctorWhere(doctorId, createdAtFilter),
      ...(terms.length > 0
        ? {
            AND: terms.map((term) => ({
              OR: [
                { code: { contains: term, mode: "insensitive" } },
                { firstName: { contains: term, mode: "insensitive" } },
                { lastName: { contains: term, mode: "insensitive" } },
                { phone: { contains: term, mode: "insensitive" } },
              ],
            })),
          }
        : {}),
    },
    include: {
      treatingDoctor: { select: treatingDoctorSelect },
      createdBy: { select: { id: true, firstName: true, lastName: true } },
      updatedBy: { select: { id: true, firstName: true, lastName: true } },
      invoices: {
        where: {
          type: { in: [InvoiceType.CONSULTATION, InvoiceType.LAB_EXAM] },
          status: { not: InvoiceStatus.CANCELLED },
        },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          invoiceNumber: true,
          type: true,
          status: true,
          amountFcfa: true,
          paidAmountFcfa: true,
        },
      },
    },
    orderBy: [{ createdAt: "desc" }, { code: "desc" }],
    take: createdAtFilter ? 500 : 50,
  });

  const lockedIds = await findPatientIdsDeletionLocked(patients.map((p) => p.id));
  return res.json(
    patients.map((patient) => {
      const { invoices, ...rest } = patient;
      // Même colonne « paiement » : consultation si présente, sinon montant labo (patients externes).
      const paymentInvoice =
        invoices.find((invoice) => invoice.type === InvoiceType.CONSULTATION) ??
        invoices.find((invoice) => invoice.type === InvoiceType.LAB_EXAM);
      return {
        ...rest,
        canDelete: canFullList && !lockedIds.has(patient.id),
        consultationPayment: canFullList ? mapConsultationPayment(paymentInvoice) : null,
      };
    }),
  );
});

router.get("/receptionists", requireModule("reception"), async (req, res) => {
  const user = req.user!;
  if (user.role === UserRole.RECEPTIONNISTE) {
    return res.json([]);
  }

  const users = await prisma.user.findMany({
    where: { role: UserRole.RECEPTIONNISTE, active: true },
    select: { id: true, firstName: true, lastName: true },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });

  return res.json(
    users.map((item) => ({
      id: item.id,
      name: `${item.firstName} ${item.lastName}`.trim(),
    })),
  );
});

function parseDayStart(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const start = new Date();
  start.setFullYear(year, month - 1, day);
  start.setHours(0, 0, 0, 0);
  return start;
}

function patientsAssignedToDoctorWhere(
  doctorId: string,
  createdAt?: { gte?: Date; lt?: Date },
): Prisma.PatientWhereInput {
  if (!doctorId) return {};
  return {
    visits: {
      some: {
        assignedDoctorId: doctorId,
        ...(createdAt ? { createdAt } : {}),
      },
    },
  };
}

router.get("/reception-stats", requireModule("reception"), async (req, res) => {
  const user = req.user!;
  const createdById = String(req.query.createdById ?? "").trim();
  const service = String(req.query.service ?? "").trim();
  const doctorId = String(req.query.doctorId ?? "").trim();
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const tomorrowStart = new Date(startOfToday);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);
  const fromParam = String(req.query.from ?? "").trim();
  const toParam = String(req.query.to ?? "").trim();
  const fromDay = parseDayStart(fromParam) ?? startOfToday;
  const toDay = parseDayStart(toParam || fromParam) ?? startOfToday;
  const rangeStart = fromDay <= toDay ? fromDay : toDay;
  const rangeEndExclusive = new Date(fromDay <= toDay ? toDay : fromDay);
  rangeEndExclusive.setDate(rangeEndExclusive.getDate() + 1);
  const createdAtRange = { gte: rangeStart, lt: rangeEndExclusive };
  const ownScope = receptionistOwnPatientsWhere(user, createdById);
  const patientScope = {
    ...ownScope,
    active: true,
    ...(service ? { service } : {}),
    ...patientsAssignedToDoctorWhere(doctorId, createdAtRange),
  };
  const patientPeriodScope = { ...patientScope, createdAt: createdAtRange };
  const isReceptionist = user.role === UserRole.RECEPTIONNISTE;
  const scopedReceptionistId = isReceptionist ? user.id : createdById || null;
  const revenueOptions = service ? { patientService: service } : undefined;
  // L'admin voit tous les encaissements du jour, pas seulement les siens.
  const personalCashScope =
    user.role !== UserRole.ADMIN && CASH_COLLECTOR_ROLES.includes(user.role);

  const [
    registeredToday,
    femalePatients,
    malePatients,
    examPatientsCount,
    visitsToday,
    externalPatientsToday,
    collectedToday,
    myExpensesToday,
  ] = await Promise.all([
    prisma.patient.count({
      where: patientPeriodScope,
    }),
    prisma.patient.count({ where: { ...patientPeriodScope, gender: "F" } }),
    prisma.patient.count({ where: { ...patientPeriodScope, gender: "M" } }),
    prisma.patient.count({ where: patientsWhoReceivedExamsWhere(patientPeriodScope) }),
    scopedReceptionistId
      ? prisma.visit.count({
          where: {
            createdAt: createdAtRange,
            ...(doctorId ? { assignedDoctorId: doctorId } : {}),
            OR: [
              { patient: { createdById: scopedReceptionistId, ...(service ? { service } : {}) } },
              {
                invoices: {
                  some: {
                    type: InvoiceType.CONSULTATION,
                    issuedById: scopedReceptionistId,
                    ...(service ? { patient: { service } } : {}),
                  },
                },
              },
            ],
          },
        })
      : prisma.visit.count({
          where: {
            createdAt: createdAtRange,
            ...(doctorId ? { assignedDoctorId: doctorId } : {}),
            ...(service ? { patient: { service } } : {}),
          },
        }),
    prisma.visit.count({
      where: {
        createdAt: createdAtRange,
        ...(doctorId ? { assignedDoctorId: doctorId } : {}),
        notes: { contains: EXTERNAL_PATIENT_VISIT_NOTE },
        patient: { ...patientScope },
      },
    }),
    personalCashScope
      ? aggregateCollectedForCashier(user.id, startOfToday, tomorrowStart, revenueOptions)
      : aggregateCollectedToday(revenueOptions),
    personalCashScope && !service
      ? sumExpensesForCashierOnDate(user.id, startOfToday)
      : Promise.resolve({ totalFcfa: 0, count: 0, rows: [] }),
  ]);

  const netTodayFcfa = Math.max(0, collectedToday.totalFcfa - myExpensesToday.totalFcfa);

  return res.json({
    registeredToday,
    femalePatients,
    malePatients,
    examPatientsCount,
    visitsToday,
    externalPatientsToday,
    revenueTodayFcfa: collectedToday.totalFcfa,
    expensesTodayFcfa: myExpensesToday.totalFcfa,
    netTodayFcfa,
    isPersonalScope: personalCashScope,
    consultationsTodayFcfa: collectedToday.consultationsFcfa,
    examsTodayFcfa: collectedToday.examsFcfa,
    surgeryTodayFcfa: collectedToday.surgeryFcfa,
    hospitalizationTodayFcfa: collectedToday.hospitalizationFcfa,
    serviceFilter: service || null,
  });
});

/** Cumul par section/service des patients enregistrés — alimente le PDF des enregistrements. */
router.get("/registration-summary", requireModule("reception"), async (req, res) => {
  try {
    const user = req.user!;
    const createdById = String(req.query.createdById ?? "").trim();
    const service = String(req.query.service ?? "").trim();
    const doctorId = String(req.query.doctorId ?? "").trim();
    const q = String(req.query.q ?? "").trim();
    const fromParam = String(req.query.from ?? "").trim();
    const toParam = String(req.query.to ?? "").trim();

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const fromDay = parseDayStart(fromParam) ?? startOfToday;
    const toDay = parseDayStart(toParam || fromParam) ?? startOfToday;
    const rangeStart = fromDay <= toDay ? fromDay : toDay;
    const rangeEndExclusive = new Date(fromDay <= toDay ? toDay : fromDay);
    rangeEndExclusive.setDate(rangeEndExclusive.getDate() + 1);

    const terms = q.split(/\s+/).filter(Boolean);
    const patientWhere: Prisma.PatientWhereInput = {
      ...receptionistOwnPatientsWhere(user, createdById),
      active: true,
      ...(service ? { service } : {}),
      createdAt: { gte: rangeStart, lt: rangeEndExclusive },
      ...patientsAssignedToDoctorWhere(doctorId, { gte: rangeStart, lt: rangeEndExclusive }),
      ...(terms.length > 0
        ? {
            AND: terms.map((term) => ({
              OR: [
                { code: { contains: term, mode: "insensitive" as const } },
                { firstName: { contains: term, mode: "insensitive" as const } },
                { lastName: { contains: term, mode: "insensitive" as const } },
                { phone: { contains: term, mode: "insensitive" as const } },
              ],
            })),
          }
        : {}),
    };

    const lines = await buildRegistrationSummary({ patientWhere });
    return res.json({ lines });
  } catch (error) {
    console.error("GET /patients/registration-summary failed:", error);
    return res.status(500).json({ error: "Impossible de calculer le cumul des enregistrements." });
  }
});

const registerConsultationSchema = patientSchema
  .safeExtend({
    doctorId: z.string(),
    consultationAmountFcfa: z.number().int().min(0).optional(),
    reductionFcfa: z.number().int().min(0).optional(),
    phone: z.string().trim().optional(),
  })
  .superRefine((data, ctx) => {
    const phone = data.phone?.trim() ?? "";
    if (phone && !isUsablePatientPhone(phone)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["phone"],
        message: "Numéro de téléphone invalide (au moins 6 chiffres).",
      });
    }
  });

router.post(
  "/register-consultation",
  requireModule("reception"),
  requireUiAction("reception.create_patient"),
  async (req, res) => {
  try {
    const body = registerConsultationSchema.parse(req.body);

    const doctor = await prisma.user.findFirst({
      where: selectableDoctorByIdWhere(body.doctorId),
      include: { employee: true },
    });
    if (!doctor) return res.status(400).json({ error: "Médecin invalide" });

    let treatingDoctorId: string | null | undefined;
    try {
      treatingDoctorId = await assertSelectableTreatingDoctor(body.treatingDoctorId);
    } catch {
      return res.status(400).json({ error: "Médecin traitant invalide" });
    }

    const requestedCategory = resolvePatientCategory(body.category);

    const duplicate = await findDuplicatePatient({
      firstName: body.firstName,
      lastName: body.lastName,
      phone: body.phone,
      gender: body.gender,
      age: body.age,
      ageUnit: body.ageUnit,
      dateOfBirth: body.dateOfBirth ? new Date(body.dateOfBirth) : null,
    });
    const reuseExisting =
      !!duplicate && phonesMatchForDossierReuse(body.phone, duplicate.phone);

    let existingPatientId: string | null = null;
    if (reuseExisting && duplicate) {
      const merged = await mergePatientIntoCanonical(duplicate.id);
      existingPatientId = merged.patientId;
    }

    const existingPatient = existingPatientId
      ? await prisma.patient.findUnique({ where: { id: existingPatientId } })
      : null;
    const category = existingPatient
      ? resolvePatientCategory(existingPatient.category)
      : requestedCategory;

    let consultationAmountFcfa = resolveDoctorConsultationAmount(
      doctor,
      body.consultationAmountFcfa ?? null,
    );
    if (existingPatient) {
      try {
        const renewal = await resolveConsultationFeeForPatientDoctor({
          patientId: existingPatient.id,
          doctorId: body.doctorId,
          requestedAmount: body.consultationAmountFcfa,
        });
        consultationAmountFcfa = renewal.amountFcfa;
      } catch {
        return res.status(400).json({ error: "Impossible de calculer le tarif de consultation." });
      }
    }

    if ((body.reductionFcfa ?? 0) > (consultationAmountFcfa ?? 0)) {
      return res.status(400).json({ error: "La réduction ne peut pas dépasser le montant." });
    }
    const billing = resolveConsultationBilling(
      category,
      consultationAmountFcfa,
      body.reductionFcfa ?? 0,
    );

    const reconsultPlan = existingPatient
      ? await planReconsultation(existingPatient.id)
      : null;

    const result = await prisma.$transaction(async (tx) => {
      if (existingPatient && reconsultPlan) {
        if (reconsultPlan.action === "create" && reconsultPlan.archiveVisitIds.length) {
          await archiveVisitsForReconsultation(tx, reconsultPlan.archiveVisitIds);
        }

        const patient = await tx.patient.update({
          where: { id: existingPatient.id },
          data: {
            ...(existingPatient.phone
              ? {}
              : body.phone?.trim()
                ? { phone: body.phone.trim() }
                : {}),
            ...(existingPatient.gender ? {} : body.gender ? { gender: body.gender } : {}),
            ...(existingPatient.age != null
              ? {}
              : body.age != null
                ? { age: body.age, ageUnit: body.ageUnit }
                : {}),
            ...(existingPatient.address
              ? {}
              : body.address
                ? { address: body.address }
                : {}),
            ...(body.service?.trim() ? { service: body.service.trim() } : {}),
            ...(treatingDoctorId !== undefined && treatingDoctorId !== null
              ? { treatingDoctorId }
              : {}),
          },
          include: { treatingDoctor: { select: treatingDoctorSelect } },
        });

        const visit =
          reconsultPlan.action === "update"
            ? await tx.visit.update({
                where: { id: reconsultPlan.visitId },
                data: {
                  status: VisitStatus.WAITING_CONSULTATION,
                  assignedDoctorId: body.doctorId,
                  consultationFeeFcfa: billing.consultationAmountFcfa || undefined,
                  reductionFcfa: billing.reductionFcfa,
                },
              })
            : await tx.visit.create({
                data: {
                  patientId: patient.id,
                  status: VisitStatus.WAITING_CONSULTATION,
                  createdById: req.user!.id,
                  assignedDoctorId: body.doctorId,
                  consultationFeeFcfa: billing.consultationAmountFcfa || undefined,
                  reductionFcfa: billing.reductionFcfa,
                },
              });

        let invoiceNumber: string | null = null;
        if (billing.billableAmountFcfa > 0) {
          const existingInvoice = await tx.invoice.findFirst({
            where: { visitId: visit.id, type: InvoiceType.CONSULTATION },
          });
          if (existingInvoice?.status === InvoiceStatus.PAID) {
            invoiceNumber = existingInvoice.invoiceNumber;
          } else if (existingInvoice) {
            const invoice = await tx.invoice.update({
              where: { id: existingInvoice.id },
              data: consultationInvoiceUpdateData(category, billing.billableAmountFcfa),
            });
            invoiceNumber = invoice.invoiceNumber;
          } else {
            const invoice = await tx.invoice.create({
              data: consultationInvoiceCreateData(category, {
                invoiceNumber: await generateInvoiceNumber(tx),
                patientId: patient.id,
                visitId: visit.id,
                amountFcfa: billing.billableAmountFcfa,
                issuedById: req.user!.id,
              }),
            });
            invoiceNumber = invoice.invoiceNumber;
          }
        }

        return {
          patient,
          visit,
          invoiceNumber,
          totalFcfa: billing.billableAmountFcfa,
          billingDeferred: !shouldCreateImmediateInvoice(category),
          linkedExistingDossier: true as const,
        };
      }

      const patient = await tx.patient.create({
        data: {
          code: await generatePatientCode(tx),
          firstName: body.firstName,
          lastName: body.lastName,
          age: body.age,
          ageUnit: body.ageUnit,
          phone: body.phone?.trim() || null,
          service: body.service?.trim() || null,
          gender: body.gender,
          address: body.address,
          category: resolvePatientCategory(requestedCategory),
          ongName: null,
          recommendedByName: normalizeRecommendedByName(body.recommendedByName),
          treatingDoctorId: treatingDoctorId ?? null,
          createdById: req.user!.id,
          dateOfBirth: body.dateOfBirth ? new Date(body.dateOfBirth) : undefined,
        },
        include: { treatingDoctor: { select: treatingDoctorSelect } },
      });

      const visit = await tx.visit.create({
        data: {
          patientId: patient.id,
          status: VisitStatus.WAITING_CONSULTATION,
          createdById: req.user!.id,
          assignedDoctorId: body.doctorId,
          consultationFeeFcfa: billing.consultationAmountFcfa || undefined,
          reductionFcfa: billing.reductionFcfa,
        },
      });

      let invoiceNumber: string | null = null;
      if (billing.billableAmountFcfa > 0) {
        const invoice = await tx.invoice.create({
          data: consultationInvoiceCreateData(category, {
            invoiceNumber: await generateInvoiceNumber(tx),
            patientId: patient.id,
            visitId: visit.id,
            amountFcfa: billing.billableAmountFcfa,
            issuedById: req.user!.id,
          }),
        });
        invoiceNumber = invoice.invoiceNumber;
      }

      return {
        patient,
        visit,
        invoiceNumber,
        totalFcfa: billing.billableAmountFcfa,
        billingDeferred: !shouldCreateImmediateInvoice(category),
        linkedExistingDossier: false as const,
      };
    });

    return res.status(201).json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const phoneIssue = error.issues.find((issue) => issue.path.includes("phone"));
      if (phoneIssue) {
        return res.status(400).json({ error: phoneIssue.message });
      }
    }
    return res.status(400).json({ error: "Données invalides" });
  }
});

router.get("/:id/consultation-fee", requireModule("reception"), async (req, res) => {
  const patientId = String(req.params.id);
  const doctorId = String(req.query.doctorId ?? "");

  if (!doctorId) {
    return res.status(400).json({ error: "Médecin requis." });
  }

  const scopedPatient = await prisma.patient.findFirst({
    where: { id: patientId, ...receptionistOwnPatientsWhere(req.user!) },
    select: { id: true },
  });
  if (!scopedPatient) return res.status(404).json({ error: "Patient introuvable" });

  try {
    const fee = await resolveConsultationFeeForPatientDoctor({
      patientId,
      doctorId,
      requestedAmount: req.query.amount ? Number(req.query.amount) : undefined,
    });
    return res.json(fee);
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "PATIENT_NOT_FOUND") {
        return res.status(404).json({ error: "Patient introuvable." });
      }
      if (error.message === "DOCTOR_NOT_FOUND") {
        return res.status(400).json({ error: "Médecin invalide." });
      }
    }
    return res.status(500).json({ error: "Impossible de calculer le tarif." });
  }
});

router.get("/:id", requireModule("reception"), async (req, res) => {
  const patientId = String(req.params.id);
  const patient = await prisma.patient.findFirst({
    where: { id: patientId, ...receptionistOwnPatientsWhere(req.user!) },
    include: { treatingDoctor: { select: treatingDoctorSelect } },
  });
  if (!patient) return res.status(404).json({ error: "Patient introuvable" });

  const printableVisit = await findPrintableConsultationVisit(patient.id);

  return res.json({
    ...patient,
    waitingVisit: printableVisit ? mapConsultationVisitForReception(printableVisit) : null,
    consultationPayment: printableVisit
      ? mapConsultationPayment(printableVisit.invoices[0])
      : null,
  });
});

router.post("/", requireModule("reception"), requireUiAction("reception.create_patient"), async (req, res) => {
  try {
    const body = patientSchema.parse(req.body);

    let treatingDoctorId: string | null | undefined;
    try {
      treatingDoctorId = await assertSelectableTreatingDoctor(body.treatingDoctorId);
    } catch {
      return res.status(400).json({ error: "Médecin traitant invalide" });
    }

    const duplicatePatient = await findDuplicatePatient({
      firstName: body.firstName,
      lastName: body.lastName,
      phone: body.phone,
      gender: body.gender,
      age: body.age,
      ageUnit: body.ageUnit,
      dateOfBirth: body.dateOfBirth ? new Date(body.dateOfBirth) : null,
    });
    if (duplicatePatient) {
      return res.status(409).json(
        duplicateErrorResponse(
          "patient",
          "Un patient avec ces informations est déjà enregistré.",
          serializePatientForDuplicate(duplicatePatient),
        ),
      );
    }

    const patient = await prisma.$transaction(async (tx) => {
      const code = await generatePatientCode(tx);
      return tx.patient.create({
        data: {
          code,
          firstName: body.firstName,
          lastName: body.lastName,
          age: body.age,
          ageUnit: body.ageUnit,
          phone: body.phone,
          service: body.service?.trim() || null,
          gender: body.gender,
          address: body.address,
          category: resolvePatientCategory(body.category),
          ongName: null,
          recommendedByName: normalizeRecommendedByName(body.recommendedByName),
          treatingDoctorId: treatingDoctorId ?? null,
          createdById: req.user!.id,
          dateOfBirth: body.dateOfBirth ? new Date(body.dateOfBirth) : undefined,
        },
        include: { treatingDoctor: { select: treatingDoctorSelect } },
      });
    });
    return res.status(201).json(patient);
  } catch {
    return res.status(400).json({ error: "Données invalides" });
  }
});

router.patch("/:id", requireModule("reception"), requireUiAction("reception.edit_patient"), async (req, res) => {
  try {
    const body = receptionUpdateSchema.parse(req.body);
    const patientId = String(req.params.id);

    const existing = await prisma.patient.findFirst({
      where: { id: patientId, ...receptionistOwnPatientsWhere(req.user!) },
    });
    if (!existing) return res.status(404).json({ error: "Patient introuvable" });

    let treatingDoctorId: string | null | undefined;
    try {
      treatingDoctorId = await assertSelectableTreatingDoctor(body.treatingDoctorId);
    } catch {
      return res.status(400).json({ error: "Médecin traitant invalide" });
    }

    const duplicatePatient = await findDuplicatePatient({
      firstName: body.firstName,
      lastName: body.lastName,
      phone: body.phone,
      gender: body.gender,
      age: body.age,
      ageUnit: body.ageUnit,
      dateOfBirth: body.dateOfBirth ? new Date(body.dateOfBirth) : null,
      excludeId: patientId,
    });
    if (duplicatePatient) {
      return res.status(409).json(
        duplicateErrorResponse(
          "patient",
          "Un autre patient avec ces informations est déjà enregistré.",
          serializePatientForDuplicate(duplicatePatient),
        ),
      );
    }

    const nextCategory = resolvePatientCategory(body.category ?? existing.category);

    if (body.doctorId) {
      const doctor = await prisma.user.findFirst({
        where: selectableDoctorByIdWhere(body.doctorId),
      });
      if (!doctor) return res.status(400).json({ error: "Médecin invalide" });
    }

    const patient = await prisma.$transaction(async (tx) => {
      const updated = await tx.patient.update({
        where: { id: String(req.params.id) },
        data: {
          firstName: body.firstName,
          lastName: body.lastName,
          age: body.age,
          ageUnit: body.ageUnit,
          phone: body.phone,
          service: body.service === undefined ? undefined : body.service.trim() || null,
          gender: body.gender,
          address: body.address,
          category: nextCategory,
          ongName: null,
          recommendedByName: normalizeRecommendedByName(body.recommendedByName),
          dateOfBirth: body.dateOfBirth ? new Date(body.dateOfBirth) : undefined,
          ...(treatingDoctorId !== undefined ? { treatingDoctorId } : {}),
          updatedById: req.user!.id,
        },
        include: { treatingDoctor: { select: treatingDoctorSelect } },
      });

      await syncWaitingVisit(
        tx,
        updated.id,
        body.doctorId,
        body.consultationAmountFcfa,
        body.reductionFcfa,
        req.user!.id,
      );

      return updated;
    });

    return res.json(patient);
  } catch (error) {
    if (error instanceof Error && error.message === "REDUCTION_TOO_HIGH") {
      return res.status(400).json({ error: "La réduction ne peut pas dépasser le montant." });
    }
    if (error instanceof Error && error.message === PATIENT_HAS_PAYMENTS_CODE) {
      return res.status(409).json({
        error:
          "Impossible de modifier la facturation : la consultation a déjà été encaissée.",
      });
    }
    return res.status(400).json({ error: "Données invalides" });
  }
});

router.patch(
  "/:id/active",
  requireModule("reception"),
  requireUiAction("reception.delete_patient"),
  async (req, res) => {
    const parsed = z.object({ active: z.boolean() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Données invalides" });

    const patientId = String(req.params.id);
    const existing = await prisma.patient.findFirst({
      where: { id: patientId, ...receptionistOwnPatientsWhere(req.user!) },
      select: { id: true },
    });
    if (!existing) return res.status(404).json({ error: "Patient introuvable" });

    const adjustments = await listPatientClosureAmounts(patientId);
    const patient = await prisma.patient.update({
      where: { id: patientId },
      data: { active: parsed.data.active },
      select: { id: true, code: true, active: true },
    });
    await applyOpenClosureAdjustments(adjustments, parsed.data.active ? 1 : -1);
    return res.json(patient);
  },
);

router.delete("/:id", requireModule("reception"), requireUiAction("reception.delete_patient"), async (req, res) => {
  try {
    const patientId = String(req.params.id);
    const existing = await prisma.patient.findFirst({
      where: { id: patientId, ...receptionistOwnPatientsWhere(req.user!) },
    });
    if (!existing) return res.status(404).json({ error: "Patient introuvable" });

    if (!isDirectionOrGestionnaire(req.user!.role as AppUserRole)) {
      await assertPatientDeletable(patientId);
    }
    const adjustments = await listPatientClosureAmounts(patientId);
    await forceDeletePatientCascade(patientId);
    await applyOpenClosureAdjustments(adjustments, -1);

    return res.json({ success: true });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === PATIENT_HAS_PAYMENTS_CODE) {
        return res.status(409).json({ error: PATIENT_HAS_PAYMENTS_MESSAGE });
      }
      if (error.message === PATIENT_ALREADY_CONSULTED_CODE) {
        return res.status(409).json({ error: PATIENT_ALREADY_CONSULTED_MESSAGE });
      }
      if (error.message === PATIENT_HAS_DATA_CODE) {
        return res.status(409).json({ error: PATIENT_HAS_DATA_MESSAGE });
      }
    }
    return res.status(500).json({ error: "Erreur serveur" });
  }
});

export default router;
