import { Router } from "express";
import { z } from "zod";
import { InvoiceStatus, InvoiceType, PatientCategory, VisitStatus, type Prisma } from "@prisma/client";
import { prisma } from "../lib/db.js";
import { generateInvoiceNumber, generatePatientCode } from "../lib/patient-code.js";
import { computeConsultationAmounts } from "../lib/consultation-amounts.js";
import { ageUnitSchema, refinePatientAge } from "../lib/patient-age.js";
import { comptabilitePatientWhere } from "../lib/patient-billing.js";
import { aggregateCollectedToday } from "../lib/revenue-stats.js";
import {
  aggregateCollectedForCashier,
  sumExpensesForCashierOnDate,
} from "../lib/cashier-personal-stats.js";
import { CASH_COLLECTOR_ROLES } from "../lib/cash-shift.js";
import { resolveConsultationBilling, shouldCreateImmediateInvoice } from "../lib/patient-billing.js";
import { resolveConsultationFeeForPatientDoctor } from "../lib/consultation-validity.js";
import {
  consultationInvoiceCreateData,
  consultationInvoiceUpdateData,
} from "../lib/consultation-invoice.js";
import {
  PATIENT_HAS_DATA_CODE,
  PATIENT_HAS_DATA_MESSAGE,
  PATIENT_HAS_PAYMENTS_CODE,
  PATIENT_HAS_PAYMENTS_MESSAGE,
  assertPatientDeletable,
} from "../lib/patient-payment-guard.js";
import {
  findDuplicatePatient,
  serializePatientForDuplicate,
} from "../lib/duplicate-detection.js";
import { duplicateErrorResponse } from "../lib/duplicate-error.js";
import { requireAuth, requireModule } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

const patientSchema = z
  .object({
    firstName: z.string().min(2),
    lastName: z.string().min(2),
    age: z.number().int().min(0).optional(),
    ageUnit: ageUnitSchema,
    phone: z.string().optional(),
    gender: z.string().optional(),
    dateOfBirth: z.string().optional(),
    address: z.string().optional(),
    category: z.nativeEnum(PatientCategory).optional(),
  })
  .superRefine((data, ctx) => {
    refinePatientAge(data, ctx);
  });

function resolvePatientCategory(category?: PatientCategory | null) {
  if (!category || category === PatientCategory.ONG) return PatientCategory.STANDARD;
  return category;
}

const receptionUpdateSchema = patientSchema.extend({
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
  const activeVisit = await prisma.visit.findFirst({
    where: {
      patientId,
      status: { in: ACTIVE_CONSULTATION_STATUSES },
    },
    orderBy: { createdAt: "desc" },
    include: consultationVisitInclude,
  });

  if (activeVisit) return activeVisit;

  const billedVisit = await prisma.visit.findFirst({
    where: {
      patientId,
      status: { not: VisitStatus.CANCELLED },
      OR: [
        { consultationFeeFcfa: { not: null } },
        { invoices: { some: { type: InvoiceType.CONSULTATION } } },
      ],
    },
    orderBy: { createdAt: "desc" },
    include: consultationVisitInclude,
  });

  if (billedVisit) return billedVisit;

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

  const billing = resolveConsultationBilling(
    patient.category,
    consultationAmountFcfa,
    reductionFcfa,
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
        consultationFeeFcfa:
          consultationAmountFcfa !== undefined
            ? billing.consultationAmountFcfa
            : visit.consultationFeeFcfa,
        ...(reductionFcfa !== undefined ? { reductionFcfa: billing.reductionFcfa } : {}),
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
          invoiceNumber: await generateInvoiceNumber(),
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
  const q = String(req.query.q ?? "").trim();
  const category = req.query.category as string | undefined;
  const terms = q.split(/\s+/).filter(Boolean);

  const patients = await prisma.patient.findMany({
    where: {
      ...(category ? { category: category as PatientCategory } : {}),
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
    orderBy: [{ createdAt: "desc" }, { code: "desc" }],
    take: 50,
  });
  return res.json(patients);
});

router.get("/reception-stats", requireModule("reception"), async (req, res) => {
  const user = req.user!;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const tomorrowStart = new Date(startOfToday);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);

  const [
    registeredToday,
    femalePatients,
    malePatients,
    visitsToday,
    collectedToday,
    myExpensesToday,
  ] = await Promise.all([
    prisma.patient.count({ where: { createdAt: { gte: startOfToday } } }),
    prisma.patient.count({ where: { gender: "F" } }),
    prisma.patient.count({ where: { gender: "M" } }),
    prisma.visit.count({ where: { createdAt: { gte: startOfToday } } }),
    CASH_COLLECTOR_ROLES.includes(user.role)
      ? aggregateCollectedForCashier(user.id, startOfToday, tomorrowStart)
      : aggregateCollectedToday(),
    CASH_COLLECTOR_ROLES.includes(user.role)
      ? sumExpensesForCashierOnDate(user.id, startOfToday)
      : Promise.resolve({ totalFcfa: 0, count: 0, rows: [] }),
  ]);

  const netTodayFcfa = Math.max(0, collectedToday.totalFcfa - myExpensesToday.totalFcfa);

  return res.json({
    registeredToday,
    femalePatients,
    malePatients,
    visitsToday,
    revenueTodayFcfa: collectedToday.totalFcfa,
    expensesTodayFcfa: myExpensesToday.totalFcfa,
    netTodayFcfa,
    isPersonalScope: CASH_COLLECTOR_ROLES.includes(user.role),
    consultationsTodayFcfa: collectedToday.consultationsFcfa,
    examsTodayFcfa: collectedToday.examsFcfa,
    surgeryTodayFcfa: collectedToday.surgeryFcfa,
    hospitalizationTodayFcfa: collectedToday.hospitalizationFcfa,
  });
});

const registerConsultationSchema = patientSchema.extend({
  doctorId: z.string(),
  consultationAmountFcfa: z.number().int().min(0).optional(),
  reductionFcfa: z.number().int().min(0).optional(),
});

router.post("/register-consultation", requireModule("reception"), async (req, res) => {
  try {
    const body = registerConsultationSchema.parse(req.body);

    const doctor = await prisma.user.findFirst({
      where: { id: body.doctorId, role: "MEDECIN", active: true },
    });
    if (!doctor) return res.status(400).json({ error: "Médecin invalide" });

    const category = resolvePatientCategory(body.category);
    const billing = resolveConsultationBilling(
      category,
      body.consultationAmountFcfa,
      body.reductionFcfa,
    );

    if (
      body.consultationAmountFcfa !== undefined &&
      (body.reductionFcfa ?? 0) > body.consultationAmountFcfa
    ) {
      return res.status(400).json({ error: "La réduction ne peut pas dépasser le montant." });
    }

    const duplicatePatient = await findDuplicatePatient({
      firstName: body.firstName,
      lastName: body.lastName,
      phone: body.phone,
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

    const result = await prisma.$transaction(async (tx) => {
      const patient = await tx.patient.create({
        data: {
          code: await generatePatientCode(),
          firstName: body.firstName,
          lastName: body.lastName,
          age: body.age,
          ageUnit: body.ageUnit,
          phone: body.phone,
          gender: body.gender,
          address: body.address,
          category: resolvePatientCategory(category),
          ongName: null,
          dateOfBirth: body.dateOfBirth ? new Date(body.dateOfBirth) : undefined,
        },
      });

      const visit = await tx.visit.create({
        data: {
          patientId: patient.id,
          status: VisitStatus.WAITING_CONSULTATION,
          assignedDoctorId: body.doctorId,
          consultationFeeFcfa: billing.consultationAmountFcfa || undefined,
          reductionFcfa: billing.reductionFcfa,
        },
      });

      let invoiceNumber: string | null = null;
      if (billing.billableAmountFcfa > 0) {
        const invoice = await tx.invoice.create({
          data: consultationInvoiceCreateData(category, {
            invoiceNumber: await generateInvoiceNumber(),
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
      };
    });

    return res.status(201).json(result);
  } catch {
    return res.status(400).json({ error: "Données invalides" });
  }
});

router.get("/:id/consultation-fee", requireModule("reception"), async (req, res) => {
  const patientId = String(req.params.id);
  const doctorId = String(req.query.doctorId ?? "");

  if (!doctorId) {
    return res.status(400).json({ error: "Médecin requis." });
  }

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
  const patient = await prisma.patient.findUnique({ where: { id: patientId } });
  if (!patient) return res.status(404).json({ error: "Patient introuvable" });

  const printableVisit = await findPrintableConsultationVisit(patient.id);

  return res.json({
    ...patient,
    waitingVisit: printableVisit ? mapConsultationVisitForReception(printableVisit) : null,
  });
});

router.post("/", requireModule("reception"), async (req, res) => {
  try {
    const body = patientSchema.parse(req.body);

    const duplicatePatient = await findDuplicatePatient({
      firstName: body.firstName,
      lastName: body.lastName,
      phone: body.phone,
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

    const patient = await prisma.patient.create({
      data: {
        code: await generatePatientCode(),
        firstName: body.firstName,
        lastName: body.lastName,
        age: body.age,
        ageUnit: body.ageUnit,
        phone: body.phone,
        gender: body.gender,
        address: body.address,
        category: resolvePatientCategory(body.category),
        ongName: null,
        dateOfBirth: body.dateOfBirth ? new Date(body.dateOfBirth) : undefined,
      },
    });
    return res.status(201).json(patient);
  } catch {
    return res.status(400).json({ error: "Données invalides" });
  }
});

router.patch("/:id", requireModule("reception"), async (req, res) => {
  try {
    const body = receptionUpdateSchema.parse(req.body);
    const patientId = String(req.params.id);

    const existing = await prisma.patient.findUnique({ where: { id: patientId } });
    if (!existing) return res.status(404).json({ error: "Patient introuvable" });

    const duplicatePatient = await findDuplicatePatient({
      firstName: body.firstName,
      lastName: body.lastName,
      phone: body.phone,
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
        where: { id: body.doctorId, role: "MEDECIN", active: true },
      });
      if (!doctor) return res.status(400).json({ error: "Médecin invalide" });
    }

    const patient = await prisma.$transaction(async (tx) => {
      const updated = await tx.patient.update({
        where: { id: req.params.id },
        data: {
          firstName: body.firstName,
          lastName: body.lastName,
          age: body.age,
          ageUnit: body.ageUnit,
          phone: body.phone,
          gender: body.gender,
          address: body.address,
          category: nextCategory,
          ongName: null,
          dateOfBirth: body.dateOfBirth ? new Date(body.dateOfBirth) : undefined,
        },
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

router.delete("/:id", requireModule("reception"), async (req, res) => {
  try {
    const patientId = String(req.params.id);
    const existing = await prisma.patient.findUnique({ where: { id: patientId } });
    if (!existing) return res.status(404).json({ error: "Patient introuvable" });

    await assertPatientDeletable(patientId);
    await prisma.patient.delete({ where: { id: patientId } });

    return res.json({ success: true });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === PATIENT_HAS_PAYMENTS_CODE) {
        return res.status(409).json({ error: PATIENT_HAS_PAYMENTS_MESSAGE });
      }
      if (error.message === PATIENT_HAS_DATA_CODE) {
        return res.status(409).json({ error: PATIENT_HAS_DATA_MESSAGE });
      }
    }
    return res.status(500).json({ error: "Erreur serveur" });
  }
});

export default router;
