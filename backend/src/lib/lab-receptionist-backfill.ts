import { InvoiceStatus, InvoiceType, VisitStatus } from "@prisma/client";
import { prisma } from "./db.js";
import {
  EXAM_KIND_SECTION_LABELS,
  EXAMS_PAID_PREFIX,
  EXAMS_PRESCRIBED_PREFIX,
  LAB_QUEUE_EXAM_KINDS,
  LAB_RESULTS_COMPLETION_MARKER,
  hasPaidLabWorkPending,
  parsePaidExamKindsByKind,
  prescriptionRequiresLabWork,
  parsePrescribedExamsByKind,
  sectionLabelsForKind,
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

/**
 * Dossiers soldés (marqueurs ou facture LAB_EXAM) jamais tamponnés pour la file labo.
 */
export async function backfillLabSentToLabAtForPaidQueue() {
  const consultations = await prisma.consultation.findMany({
    where: {
      labSentToLabAt: null,
      NOT: { clinicalNotes: { contains: LAB_RESULTS_COMPLETION_MARKER } },
      visit: { status: { not: VisitStatus.CANCELLED } },
      OR: [
        ...LAB_QUEUE_EXAM_KINDS.flatMap((kind) =>
          sectionLabelsForKind(kind).map((label) => ({
            clinicalNotes: { contains: `${EXAMS_PAID_PREFIX} (${label})` },
          })),
        ),
        {
          visit: {
            invoices: {
              some: {
                type: InvoiceType.LAB_EXAM,
                status: InvoiceStatus.PAID,
                paidAmountFcfa: { gt: 0 },
                billingExamKind: { in: [...LAB_QUEUE_EXAM_KINDS] },
              },
            },
          },
        },
      ],
    },
    select: { id: true, clinicalNotes: true, updatedAt: true },
    take: 2000,
  });

  let updated = 0;
  for (const row of consultations) {
    const notes = row.clinicalNotes;
    const pendingByNotes = hasPaidLabWorkPending(notes, null);
    const prescribed = parsePrescribedExamsByKind(notes);
    if (!pendingByNotes && !prescriptionRequiresLabWork(prescribed)) continue;
    const paid = parsePaidExamKindsByKind(notes);
    const paidDates = LAB_QUEUE_EXAM_KINDS.map((kind) => paid[kind]).filter(
      (value): value is Date => value instanceof Date,
    );
    const sentAt =
      paidDates.sort((a, b) => a.getTime() - b.getTime())[0] ?? row.updatedAt ?? new Date();
    await prisma.consultation.update({
      where: { id: row.id },
      data: { labSentToLabAt: sentAt },
    });
    updated += 1;
  }
  return updated;
}
