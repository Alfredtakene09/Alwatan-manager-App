import { HospitalizationStatus, SurgeryStatus, VisitStatus, type Prisma } from "@prisma/client";
import { isExternalPatientVisit } from "./visit-external.js";
import { voidReplacedExamPayments } from "./void-replaced-exam-payment.js";

type Tx = Prisma.TransactionClient;

const normalize = (value?: string | null) =>
  (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");

export type ReregistrationVisit = {
  status: VisitStatus;
  notes: string | null;
  assignedDoctorId: string | null;
  consultation: {
    clinicalNotes: string | null;
    completedAt: Date | null;
    labSentToLabAt: Date | null;
  } | null;
};

/** Le service ou le médecin change : seuls ces deux changements relancent une consultation. */
export function reregistrationRequired(params: {
  visit: ReregistrationVisit | null;
  previousService?: string | null;
  nextService?: string | null;
  nextDoctorId?: string | null;
}): boolean {
  const { visit } = params;
  if (!visit || visit.status === VisitStatus.CANCELLED) return false;
  if (isExternalPatientVisit(visit.notes)) return false;

  const serviceChanged =
    params.nextService !== undefined &&
    normalize(params.nextService) !== normalize(params.previousService);
  const doctorChanged = Boolean(
    params.nextDoctorId &&
      visit.assignedDoctorId &&
      params.nextDoctorId !== visit.assignedDoctorId,
  );
  if (!serviceChanged && !doctorChanged) return false;

  const consultation = visit.consultation;
  const hasWork =
    Boolean(consultation?.clinicalNotes?.trim()) ||
    Boolean(consultation?.completedAt) ||
    Boolean(consultation?.labSentToLabAt) ||
    visit.status !== VisitStatus.WAITING_CONSULTATION;
  return hasWork;
}

/**
 * Réenregistre la visite : examens prescrits annulés (encaissements retirés du solde),
 * consultation remise à zéro, visite rouverte pour le nouveau médecin et attribuée
 * au dernier réceptionniste.
 */
export async function reopenVisitForNewConsultation(
  tx: Tx,
  params: { visitId: string; userId: string },
) {
  await voidReplacedExamPayments(tx, { visitId: params.visitId, userId: params.userId });

  await tx.surgeryCase.updateMany({
    where: {
      visitId: params.visitId,
      status: {
        in: [
          SurgeryStatus.NOTIFIED,
          SurgeryStatus.QUOTED,
          SurgeryStatus.PAID,
          SurgeryStatus.AUTHORIZED,
        ],
      },
    },
    data: {
      status: SurgeryStatus.CANCELLED,
      paidAt: null,
      authorizedAt: null,
      accountantId: null,
    },
  });
  await tx.hospitalization.updateMany({
    where: {
      visitId: params.visitId,
      status: { in: [HospitalizationStatus.REQUESTED, HospitalizationStatus.RESERVED] },
    },
    data: { status: HospitalizationStatus.CANCELLED, paidAt: null },
  });

  const visit = await tx.visit.findUnique({
    where: { id: params.visitId },
    select: { assignedDoctorId: true },
  });
  await tx.consultation.updateMany({
    where: { visitId: params.visitId },
    data: {
      doctorId: visit?.assignedDoctorId ?? null,
      clinicalNotes: null,
      doctorComment: null,
      diagnosis: null,
      needsSurgery: false,
      needsHospitalization: false,
      completedAt: null,
      labSentToLabAt: null,
      labApprovedById: null,
      labRecordedById: null,
      labRecordedAt: null,
      labExamReductionFcfa: 0,
    },
  });
  await tx.visit.update({
    where: { id: params.visitId },
    data: {
      status: VisitStatus.WAITING_CONSULTATION,
      createdById: params.userId,
      createdAt: new Date(),
    },
  });
}
