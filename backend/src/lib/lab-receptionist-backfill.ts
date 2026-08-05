import { InvoiceType } from "@prisma/client";
import { prisma } from "./db.js";
import {
  EXAM_KIND_SECTION_LABELS,
  EXAMS_PRESCRIBED_PREFIX,
  LAB_RESULTS_COMPLETION_MARKER,
} from "./lab-notes.js";

/**
 * Remplit labApprovedById manquant sur les anciens dossiers labo
 * (facture examens → enregistrement patient).
 */
export async function backfillLabReceptionistApprovals() {
  const consultations = await prisma.consultation.findMany({
    where: {
      labApprovedById: null,
      OR: [
        { labSentToLabAt: { not: null } },
        { clinicalNotes: { contains: "Labo panel (" } },
        { clinicalNotes: { contains: LAB_RESULTS_COMPLETION_MARKER } },
        {
          clinicalNotes: {
            contains: `${EXAMS_PRESCRIBED_PREFIX} (${EXAM_KIND_SECTION_LABELS.examen})`,
          },
        },
      ],
    },
    select: {
      id: true,
      visit: {
        select: {
          patient: { select: { createdById: true } },
          invoices: {
            where: { type: InvoiceType.LAB_EXAM },
            orderBy: { createdAt: "asc" },
            take: 1,
            select: { issuedById: true },
          },
        },
      },
    },
    take: 5000,
  });

  let updated = 0;
  for (const row of consultations) {
    const receptionistId =
      row.visit.invoices[0]?.issuedById ?? row.visit.patient.createdById ?? null;
    if (!receptionistId) continue;

    await prisma.consultation.update({
      where: { id: row.id },
      data: { labApprovedById: receptionistId },
    });
    updated += 1;
  }

  return updated;
}
