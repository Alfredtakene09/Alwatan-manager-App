import { VisitStatus } from "@prisma/client";
import { prisma } from "./db.js";

type VisitWithPatient = {
  id: string;
  patientId: string;
  updatedAt: Date;
};

export function keepLatestVisitPerPatient<T extends VisitWithPatient>(visits: T[]): T[] {
  const byPatient = new Map<string, T>();
  for (const visit of visits) {
    const existing = byPatient.get(visit.patientId);
    if (!existing || visit.updatedAt > existing.updatedAt) {
      byPatient.set(visit.patientId, visit);
    }
  }
  return Array.from(byPatient.values());
}

/** Annule les visites actives en double — conserve la plus récente par patient. */
export async function cancelDuplicateActiveVisits(): Promise<number> {
  const active = await prisma.visit.findMany({
    where: { status: { notIn: [VisitStatus.COMPLETED, VisitStatus.CANCELLED] } },
    select: { id: true, patientId: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
  });

  const keepIds = new Set<string>();
  const cancelIds: string[] = [];

  for (const visit of active) {
    if (keepIds.has(visit.patientId)) {
      cancelIds.push(visit.id);
    } else {
      keepIds.add(visit.patientId);
    }
  }

  if (!cancelIds.length) return 0;

  await prisma.visit.updateMany({
    where: { id: { in: cancelIds } },
    data: { status: VisitStatus.CANCELLED },
  });

  return cancelIds.length;
}
