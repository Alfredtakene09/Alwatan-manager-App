import { VisitStatus, type Prisma } from "@prisma/client";
import { prisma } from "./db.js";
import { EXAMS_PRESCRIBED_PREFIX } from "./lab-notes.js";

export type ReconsultPlan =
  | { action: "create"; archiveVisitIds: string[] }
  | { action: "update"; visitId: string };

async function loadActiveVisits(patientId: string) {
  return prisma.visit.findMany({
    where: {
      patientId,
      status: { notIn: [VisitStatus.COMPLETED, VisitStatus.CANCELLED] },
    },
    include: {
      consultation: {
        select: { clinicalNotes: true },
      },
    },
    orderBy: { updatedAt: "desc" },
  });
}

/**
 * Reconsultation : le patient peut revenir plusieurs fois.
 * - Visite en attente sans prescription → mise à jour (médecin / tarif).
 * - Sinon → clôture de la visite en cours et nouvelle consultation (0 FCFA si validité).
 */
export async function planReconsultation(patientId: string): Promise<ReconsultPlan> {
  const activeVisits = await loadActiveVisits(patientId);

  if (!activeVisits.length) {
    return { action: "create", archiveVisitIds: [] };
  }

  const idleWaiting = activeVisits.filter(
    (visit) =>
      visit.status === VisitStatus.WAITING_CONSULTATION &&
      !visit.consultation?.clinicalNotes?.includes(EXAMS_PRESCRIBED_PREFIX),
  );

  if (idleWaiting.length === 1 && activeVisits.length === 1) {
    return { action: "update", visitId: idleWaiting[0]!.id };
  }

  return {
    action: "create",
    archiveVisitIds: activeVisits.map((visit) => visit.id),
  };
}

/** Clôture les visites remplacées — les données restent dans le dossier patient. */
export async function archiveVisitsForReconsultation(
  tx: Prisma.TransactionClient,
  visitIds: string[],
) {
  if (!visitIds.length) return;

  const closedAt = new Date();

  await tx.visit.updateMany({
    where: { id: { in: visitIds } },
    data: { status: VisitStatus.COMPLETED },
  });

  await tx.consultation.updateMany({
    where: {
      visitId: { in: visitIds },
      completedAt: null,
    },
    data: { completedAt: closedAt },
  });
}
