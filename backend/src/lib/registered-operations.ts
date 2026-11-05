import { InvoiceStatus, InvoiceType, Prisma, SurgeryStatus } from "@prisma/client";
import { prisma } from "./db.js";
import { parsePrescribedExamsByKind } from "./lab-notes.js";
import { comptabilitePatientWhere } from "./patient-billing.js";
import {
  operationCategory,
  operationPaidFcfa,
  otherOperationRegisteredAt,
  surgeryPaidFcfa,
  surgeryRegisteredAt,
  type OperationCategory,
} from "./operation-register.js";

export type RegisteredOperation = {
  invoiceId: string | null;
  patientId: string | null;
  service: { id: string; name: string } | null;
  category: OperationCategory;
  paidFcfa: number;
};

/**
 * Opérations (bloc + hors bloc) enregistrées dans la période, selon les règles de la page
 * « Opérations » : date d'enregistrement de l'opération, montant = cumul payé.
 */
export async function loadRegisteredOperations(
  from: Date,
  to: Date,
  patientWhere: Prisma.PatientWhereInput = {},
): Promise<RegisteredOperation[]> {
  const registeredInRange = { gte: from, lt: to };
  const patient: Prisma.PatientWhereInput = { AND: [comptabilitePatientWhere(), patientWhere] };
  const invoiceSelect = {
    id: true,
    status: true,
    amountFcfa: true,
    paidAmountFcfa: true,
    createdAt: true,
    paidAt: true,
    payments: { select: { amountFcfa: true } },
  } as const;
  const serviceSelect = { select: { id: true, name: true } } as const;
  const [surgeries, otherOperations] = await Promise.all([
    prisma.surgeryCase.findMany({
      where: {
        status: { not: SurgeryStatus.CANCELLED },
        visit: { patient },
        OR: [
          { invoice: { is: { createdAt: registeredInRange } } },
          { invoice: { is: null } },
        ],
      },
      select: {
        totalCostFcfa: true,
        completedAt: true,
        operationScheduledAt: true,
        updatedAt: true,
        invoice: { select: invoiceSelect },
        interventionType: { select: { label: true, clinicService: serviceSelect } },
        visit: {
          select: {
            patientId: true,
            assignedClinicService: serviceSelect,
            patient: { select: { service: true } },
          },
        },
      },
    }),
    prisma.invoice.findMany({
      where: {
        type: InvoiceType.LAB_EXAM,
        billingExamKind: "operation",
        surgeryCaseId: null,
        status: { not: InvoiceStatus.CANCELLED },
        patient,
        createdAt: registeredInRange,
      },
      select: {
        ...invoiceSelect,
        patientId: true,
        visit: {
          select: {
            assignedClinicService: serviceSelect,
            consultation: { select: { clinicalNotes: true } },
          },
        },
      },
    }),
  ]);

  const operations: RegisteredOperation[] = [];
  for (const surgery of surgeries) {
    const registeredAt = surgeryRegisteredAt(surgery);
    if (registeredAt < from || registeredAt >= to) continue;
    const service =
      surgery.interventionType.clinicService ?? surgery.visit.assignedClinicService ?? null;
    operations.push({
      invoiceId: surgery.invoice?.id ?? null,
      patientId: surgery.visit.patientId,
      service,
      category: operationCategory(service?.name, [
        surgery.interventionType.label,
        surgery.visit.patient.service,
      ]),
      paidFcfa: surgeryPaidFcfa(surgery),
    });
  }
  for (const invoice of otherOperations) {
    const registeredAt = otherOperationRegisteredAt(invoice);
    if (registeredAt < from || registeredAt >= to) continue;
    const service = invoice.visit?.assignedClinicService ?? null;
    operations.push({
      invoiceId: invoice.id,
      patientId: invoice.patientId,
      service,
      category: operationCategory(
        service?.name,
        parsePrescribedExamsByKind(invoice.visit?.consultation?.clinicalNotes).operation ?? [],
      ),
      paidFcfa: operationPaidFcfa(invoice.amountFcfa, invoice),
    });
  }
  return operations;
}
