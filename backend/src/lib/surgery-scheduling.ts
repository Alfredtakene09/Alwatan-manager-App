import { SurgeryStatus, VisitStatus } from "@prisma/client";
import { prisma } from "./db.js";
import {
  clearSharePaymentFields,
} from "./surgery-share-payments.js";

const AWAITING_PERFORMANCE_STATUSES: SurgeryStatus[] = [
  SurgeryStatus.PAID,
  SurgeryStatus.AUTHORIZED,
  SurgeryStatus.IN_PROGRESS,
];

/** Fin de journée locale pour une date YYYY-MM-DD */
export function parseOperationDateInput(input: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.trim());
  if (!match) {
    throw new Error("INVALID_OPERATION_DATE");
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day, 23, 59, 59, 999);
  if (Number.isNaN(date.getTime())) {
    throw new Error("INVALID_OPERATION_DATE");
  }
  return date;
}

export function isOperationDue(scheduledAt: Date, now = new Date()): boolean {
  return scheduledAt.getTime() <= now.getTime();
}

export async function promoteDueSurgeries(now = new Date()) {
  const due = await prisma.surgeryCase.findMany({
    where: {
      status: { in: AWAITING_PERFORMANCE_STATUSES },
      AND: [
        { operationScheduledAt: { not: null } },
        { operationScheduledAt: { lte: now } },
      ],
    },
    select: { id: true, visitId: true },
  });

  if (!due.length) return 0;

  await prisma.$transaction(async (tx) => {
    for (const surgery of due) {
      await tx.surgeryCase.update({
        where: { id: surgery.id },
        data: {
          status: SurgeryStatus.COMPLETED,
          completedAt: now,
        },
      });
      await tx.visit.update({
        where: { id: surgery.visitId },
        data: { status: VisitStatus.COMPLETED },
      });
    }
  });

  return due.length;
}

export async function completeSurgeryCase(surgeryId: string, completedAt = new Date()) {
  const surgery = await prisma.surgeryCase.findUniqueOrThrow({
    where: { id: surgeryId },
    select: { id: true, visitId: true, status: true },
  });

  if (!AWAITING_PERFORMANCE_STATUSES.includes(surgery.status)) {
    throw new Error("SURGERY_NOT_COMPLETABLE");
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.surgeryCase.update({
      where: { id: surgery.id },
      data: {
        status: SurgeryStatus.COMPLETED,
        completedAt,
      },
    });
    await tx.visit.update({
      where: { id: surgery.visitId },
      data: { status: VisitStatus.COMPLETED },
    });
    return updated;
  });
}

export async function revertSurgeryToAwaiting(surgeryId: string, operationDate?: Date | null) {
  const surgery = await prisma.surgeryCase.findUniqueOrThrow({
    where: { id: surgeryId },
    select: { id: true, visitId: true, status: true },
  });

  if (surgery.status !== SurgeryStatus.COMPLETED) {
    throw new Error("SURGERY_NOT_REVERTIBLE");
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.surgeryCase.update({
      where: { id: surgery.id },
      data: {
        status: SurgeryStatus.PAID,
        completedAt: null,
        operationScheduledAt: operationDate ?? null,
        ...clearSharePaymentFields(),
      },
    });
    await tx.visit.update({
      where: { id: surgery.visitId },
      data: { status: VisitStatus.IN_TREATMENT },
    });
    return updated;
  });
}

export { AWAITING_PERFORMANCE_STATUSES };
