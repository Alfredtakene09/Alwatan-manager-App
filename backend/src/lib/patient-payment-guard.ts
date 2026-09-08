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

export const PATIENT_ALREADY_CONSULTED_CODE = "PATIENT_ALREADY_CONSULTED";

export const PATIENT_ALREADY_CONSULTED_MESSAGE =
  "Impossible de supprimer : ce patient a déjà été envoyé et consulté.";

/** Patient avec au moins un encaissement enregistré (facture payée, opération ou hospitalisation). */
export async function patientHasPaidBilling(
  patientId: string,
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<boolean> {
  const paidInvoice = await db.invoice.findFirst({
    where: {
      patientId,
      OR: [
        { status: InvoiceStatus.PAID },
        { status: InvoiceStatus.PARTIALLY_PAID, paidAmountFcfa: { gt: 0 } },
      ],
    },
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
      where: {
        patientId: { in: uniqueIds },
        OR: [
          { status: InvoiceStatus.PAID },
          { status: InvoiceStatus.PARTIALLY_PAID, paidAmountFcfa: { gt: 0 } },
        ],
      },
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

type ConsultationLockFields = {
  clinicalNotes?: string | null;
  labSentToLabAt?: Date | null;
  doctorId?: string | null;
  completedAt?: Date | null;
  diagnosis?: string | null;
  doctorComment?: string | null;
} | null;

/** True si le médecin a déjà pris en charge / consulté ce passage. */
function consultationIndicatesSeen(consultation?: ConsultationLockFields): boolean {
  if (!consultation) return false;
  if (consultation.completedAt || consultation.doctorId || consultation.labSentToLabAt) return true;
  if (consultation.diagnosis?.trim() || consultation.doctorComment?.trim()) return true;
  const notes = consultation.clinicalNotes;
  if (notes?.includes(EXAMS_PRESCRIBED_PREFIX)) return true;
  if (!isPendingClinicalNotes(notes)) return true;
  return false;
}

function visitIndicatesConsulted(visit: {
  status: VisitStatus;
  consultation?: ConsultationLockFields;
}): boolean {
  if (visit.status !== VisitStatus.WAITING_CONSULTATION) return true;
  return consultationIndicatesSeen(visit.consultation);
}

const consultationLockSelect = {
  clinicalNotes: true,
  labSentToLabAt: true,
  doctorId: true,
  completedAt: true,
  diagnosis: true,
  doctorComment: true,
} as const;

/**
 * IDs patients dont la suppression réceptionniste est verrouillée
 * (déjà pris en charge par un médecin). Les factures ne bloquent plus :
 * elles sont effacées avec le dossier.
 */
export async function findPatientIdsDeletionLocked(patientIds: string[]): Promise<Set<string>> {
  if (!patientIds.length) return new Set();

  const uniqueIds = [...new Set(patientIds)];
  const visits = await prisma.visit.findMany({
    where: { patientId: { in: uniqueIds }, status: { not: VisitStatus.CANCELLED } },
    select: {
      patientId: true,
      status: true,
      consultation: { select: consultationLockSelect },
    },
  });

  const locked = new Set<string>();
  for (const visit of visits) {
    if (visitIndicatesConsulted(visit)) locked.add(visit.patientId);
  }
  return locked;
}

/** Réception : un dossier déjà consulté ne peut pas être supprimé (admin / gestionnaire : cascade). */
export async function assertPatientDeletable(
  patientId: string,
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<void> {
  const visits = await db.visit.findMany({
    where: { patientId, status: { not: VisitStatus.CANCELLED } },
    include: { consultation: { select: consultationLockSelect } },
  });

  if (visits.some(visitIndicatesConsulted)) {
    throw new Error(PATIENT_ALREADY_CONSULTED_CODE);
  }
}
