import { prisma } from "./db.js";

/** Nombre total d'enregistrements métier liés à un compte utilisateur. */
export async function countUserRelatedData(userId: string): Promise<number> {
  const counts = await Promise.all([
    prisma.vitalSign.count({ where: { recordedById: userId } }),
    prisma.consultation.count({ where: { doctorId: userId } }),
    prisma.consultation.count({ where: { labApprovedById: userId } }),
    prisma.surgeryCase.count({ where: { surgeonId: userId } }),
    prisma.surgeryCase.count({ where: { accountantId: userId } }),
    prisma.surgeryCase.count({ where: { surgeonPaidById: userId } }),
    prisma.surgeryCase.count({ where: { assistantPaidById: userId } }),
    prisma.surgeryCase.count({ where: { clinicPaidById: userId } }),
    prisma.interventionType.count({ where: { surgeonId: userId } }),
    prisma.interventionType.count({ where: { anesthesiologistId: userId } }),
    prisma.hospitalization.count({ where: { accountantId: userId } }),
    prisma.invoice.count({ where: { issuedById: userId } }),
    prisma.prescription.count({ where: { pharmacistId: userId } }),
    prisma.auditLog.count({ where: { userId } }),
    prisma.visit.count({ where: { assignedDoctorId: userId } }),
    prisma.patientDocument.count({ where: { uploadedById: userId } }),
    prisma.receptionCashSettlement.count({ where: { receptionistId: userId } }),
    prisma.receptionCashSettlement.count({ where: { accountantId: userId } }),
    prisma.clinicExpense.count({ where: { paidById: userId } }),
    prisma.clinicExpense.count({ where: { recordedById: userId } }),
    prisma.cashChangeTransfer.count({ where: { requesterId: userId } }),
    prisma.cashChangeTransfer.count({ where: { providerId: userId } }),
    prisma.cashChangeTransfer.count({ where: { recordedById: userId } }),
    prisma.cashChangeTransfer.count({ where: { refundedById: userId } }),
    prisma.examReclamation.count({ where: { createdById: userId } }),
    prisma.examReclamation.count({ where: { handledById: userId } }),
  ]);

  return counts.reduce((sum, n) => sum + n, 0);
}

export function userDeletionBlockedMessage(relatedCount: number): string {
  const suffix = relatedCount > 1 ? "enregistrements liés" : "enregistrement lié";
  return `Suppression impossible : ce compte a ${relatedCount} ${suffix} (consultations, factures, caisse, etc.). Désactivez-le plutôt.`;
}
