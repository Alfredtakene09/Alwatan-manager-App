import type { PrismaClient } from "@prisma/client";
import { InvoiceStatus, InvoiceType } from "@prisma/client";
import { buildExamSheetsByKind, type ExamKindSlug } from "./exam-billing.js";
import {
  isExamKindPaid,
  LAB_BILLABLE_EXAM_KINDS,
  parsePaidExamKindsByKind,
  parsePrescribedExamsByKind,
  removePaidExamKindMarker,
  removePrescribedExamLabelsFromNotes,
} from "./lab-notes.js";

type Tx = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

export type ExamRefundLine = {
  examKind: ExamKindSlug;
  examLabel: string;
  unitPriceFcfa: number;
};

export class ReclamationRefundError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "ReclamationRefundError";
  }
}

type VisitInvoiceRow = {
  id: string;
  type: InvoiceType;
  amountFcfa: number;
  surgeryCaseId: string | null;
  hospitalizationId: string | null;
  createdAt: Date;
};

function getPaidExamSheets(notes: string) {
  const paidKinds = new Set(Object.keys(parsePaidExamKindsByKind(notes)) as ExamKindSlug[]);
  return buildExamSheetsByKind(notes).filter((sheet) => paidKinds.has(sheet.kind));
}

function findGenericLabExamInvoiceIndex(kind: ExamKindSlug, notes: string): number {
  return getPaidExamSheets(notes).findIndex((sheet) => sheet.kind === kind);
}

async function findInvoiceForExamKind(
  tx: Tx,
  visitId: string,
  kind: ExamKindSlug,
  notes: string,
  invoices: VisitInvoiceRow[],
) {
  if (kind === "operation") {
    const surgery = await tx.surgeryCase.findUnique({
      where: { visitId },
      select: { id: true },
    });
    if (surgery) return invoices.find((invoice) => invoice.surgeryCaseId === surgery.id) ?? null;
  }

  if (kind === "hospitalisation") {
    const hospitalization = await tx.hospitalization.findUnique({
      where: { visitId },
      select: { id: true },
    });
    if (hospitalization) {
      return invoices.find((invoice) => invoice.hospitalizationId === hospitalization.id) ?? null;
    }
  }

  const generic = invoices
    .filter(
      (invoice) =>
        invoice.type === InvoiceType.LAB_EXAM &&
        !invoice.surgeryCaseId &&
        !invoice.hospitalizationId,
    )
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const index = findGenericLabExamInvoiceIndex(kind, notes);
  return index >= 0 ? (generic[index] ?? null) : null;
}

export async function applyExamReclamationRefund(params: {
  tx: Tx;
  consultation: {
    id: string;
    visitId: string;
    clinicalNotes: string | null;
    labSentToLabAt: Date | null;
    visit: {
      invoices: VisitInvoiceRow[];
    };
  };
  examLines: ExamRefundLine[];
}): Promise<{ clinicalNotes: string; totalRefundedFcfa: number }> {
  const { tx, consultation, examLines } = params;
  const originalNotes = consultation.clinicalNotes ?? "";
  let notes = originalNotes;
  const visitInvoices = consultation.visit.invoices.filter(
    (invoice) => invoice.type === InvoiceType.LAB_EXAM,
  );

  const prescribed = parsePrescribedExamsByKind(originalNotes);
  for (const line of examLines) {
    if (!isExamKindPaid(originalNotes, line.examKind)) {
      throw new ReclamationRefundError(
        "KIND_NOT_PAID",
        `Le type d'examen « ${line.examKind} » n'est pas marqué comme payé.`,
      );
    }
    const exists = (prescribed[line.examKind] ?? []).some(
      (label) => label.trim() === line.examLabel.trim(),
    );
    if (!exists) {
      throw new ReclamationRefundError(
        "EXAM_NOT_FOUND",
        `Examen introuvable dans le dossier : ${line.examLabel}`,
      );
    }
  }

  const refundByKind = new Map<ExamKindSlug, number>();
  for (const line of examLines) {
    refundByKind.set(
      line.examKind,
      (refundByKind.get(line.examKind) ?? 0) + line.unitPriceFcfa,
    );
  }

  notes = removePrescribedExamLabelsFromNotes(notes, examLines);

  let totalRefundedFcfa = 0;

  for (const [kind, refundFcfa] of refundByKind) {
    const invoice = await findInvoiceForExamKind(
      tx,
      consultation.visitId,
      kind,
      originalNotes,
      visitInvoices,
    );

    if (invoice) {
      const deducted = Math.min(refundFcfa, invoice.amountFcfa);
      totalRefundedFcfa += deducted;
      const newAmount = Math.max(0, invoice.amountFcfa - refundFcfa);
      await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          amountFcfa: newAmount,
          ...(newAmount === 0 ? { status: InvoiceStatus.CANCELLED } : {}),
        },
      });
    } else {
      totalRefundedFcfa += refundFcfa;
    }

    const remaining = parsePrescribedExamsByKind(notes)[kind] ?? [];
    if (remaining.length === 0) {
      notes = removePaidExamKindMarker(notes, kind);
    }
  }

  const stillInLabQueue = LAB_BILLABLE_EXAM_KINDS.some((kind) => {
    if (!isExamKindPaid(notes, kind)) return false;
    return (parsePrescribedExamsByKind(notes)[kind]?.length ?? 0) > 0;
  });

  await tx.consultation.update({
    where: { id: consultation.id },
    data: {
      clinicalNotes: notes,
      ...(stillInLabQueue ? {} : { labSentToLabAt: null }),
    },
  });

  return { clinicalNotes: notes, totalRefundedFcfa };
}
