import { InvoiceStatus, VisitStatus, type AgeUnit, type Prisma } from "@prisma/client";
import { prisma } from "./db.js";
import { EXAMS_PRESCRIBED_PREFIX } from "./lab-notes.js";
import {
  EXTERNAL_EXAMS_PENDING_NOTE,
  ONG_EXAMS_PENDING_NOTE,
} from "./visit-external.js";

export const PATIENT_HAS_PAYMENTS_CODE = "PATIENT_HAS_PAYMENTS";

export const PATIENT_HAS_PAYMENTS_MESSAGE =
  "Impossible de supprimer : ce patient a déjà effectué un paiement (consultation, examen ou autre).";

export const PATIENT_HAS_DATA_CODE = "PATIENT_HAS_DATA";

export const PATIENT_HAS_DATA_MESSAGE =
  "Impossible de supprimer : ce patient a déjà des données (facture, consultation, examens ou documents).";

/** Patient avec au moins un encaissement enregistré (facture payée, opération ou hospitalisation). */
export async function patientHasPaidBilling(
  patientId: string,
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<boolean> {
  const paidInvoice = await db.invoice.findFirst({
    where: { patientId, status: InvoiceStatus.PAID },
    select: { id: true },
  });
  if (paidInvoice) return true;

  const paidSurgery = await db.surgeryCase.findFirst({
    where: {
      visit: { patientId },
      OR: [
        { paidAt: { not: null } },
        { surgeonPaidAt: { not: null } },
        { assistantPaidAt: { not: null } },
        { clinicPaidAt: { not: null } },
      ],
    },
    select: { id: true },
  });
  if (paidSurgery) return true;

  const paidHospitalization = await db.hospitalization.findFirst({
    where: {
      visit: { patientId },
      paidAt: { not: null },
    },
    select: { id: true },
  });
  if (paidHospitalization) return true;

  return false;
}

export async function findPatientIdsWithPaidBilling(patientIds: string[]): Promise<Set<string>> {
  if (!patientIds.length) return new Set();

  const uniqueIds = [...new Set(patientIds)];

  const [paidInvoices, paidSurgeries, paidHospitalizations] = await Promise.all([
    prisma.invoice.findMany({
      where: { patientId: { in: uniqueIds }, status: InvoiceStatus.PAID },
      select: { patientId: true },
      distinct: ["patientId"],
    }),
    prisma.surgeryCase.findMany({
      where: {
        visit: { patientId: { in: uniqueIds } },
        OR: [
          { paidAt: { not: null } },
          { surgeonPaidAt: { not: null } },
          { assistantPaidAt: { not: null } },
          { clinicPaidAt: { not: null } },
        ],
      },
      select: { visit: { select: { patientId: true } } },
    }),
    prisma.hospitalization.findMany({
      where: {
        visit: { patientId: { in: uniqueIds } },
        paidAt: { not: null },
      },
      select: { visit: { select: { patientId: true } } },
    }),
  ]);

  const result = new Set<string>();
  for (const row of paidInvoices) {
    if (row.patientId) result.add(row.patientId);
  }
  for (const row of paidSurgeries) result.add(row.visit.patientId);
  for (const row of paidHospitalizations) result.add(row.visit.patientId);
  return result;
}

export async function assertPatientDataDeletable(
  patientId: string,
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<void> {
  if (await patientHasPaidBilling(patientId, db)) {
    throw new Error(PATIENT_HAS_PAYMENTS_CODE);
  }
}

function isPendingClinicalNotes(notes?: string | null): boolean {
  const trimmed = notes?.trim() ?? "";
  if (!trimmed) return true;
  if (trimmed === EXTERNAL_EXAMS_PENDING_NOTE || trimmed === ONG_EXAMS_PENDING_NOTE) return true;
  return false;
}

/** Suppression dossier patient — autorisée seulement sans facture ni activité clinique. */
export async function assertPatientDeletable(
  patientId: string,
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<void> {
  await assertPatientDataDeletable(patientId, db);

  const [invoiceCount, documentCount, reclamationCount, activeVisit] = await Promise.all([
    db.invoice.count({ where: { patientId } }),
    db.patientDocument.count({ where: { patientId } }),
    db.examReclamation.count({ where: { patientId } }),
    db.visit.findFirst({
      where: { patientId, status: { not: VisitStatus.CANCELLED } },
      include: { consultation: { select: { clinicalNotes: true, labSentToLabAt: true } } },
    }),
  ]);

  if (invoiceCount > 0 || documentCount > 0 || reclamationCount > 0) {
    throw new Error(PATIENT_HAS_DATA_CODE);
  }

  if (!activeVisit) return;

  if (activeVisit.status !== VisitStatus.WAITING_CONSULTATION) {
    throw new Error(PATIENT_HAS_DATA_CODE);
  }

  const notes = activeVisit.consultation?.clinicalNotes;
  if (activeVisit.consultation?.labSentToLabAt) {
    throw new Error(PATIENT_HAS_DATA_CODE);
  }
  if (notes?.includes(EXAMS_PRESCRIBED_PREFIX)) {
    throw new Error(PATIENT_HAS_DATA_CODE);
  }
  if (!isPendingClinicalNotes(notes)) {
    throw new Error(PATIENT_HAS_DATA_CODE);
  }
}
