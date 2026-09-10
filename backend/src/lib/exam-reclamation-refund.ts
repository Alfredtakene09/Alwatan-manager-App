import type { PrismaClient } from "@prisma/client";
import { InvoiceStatus, InvoiceType, SurgeryStatus, VisitStatus } from "@prisma/client";
import { buildExamSheetsByKind, type ExamKindSlug } from "./exam-billing.js";
import {
  hasLabResults,
  isExamKindPaid,
  LAB_BILLABLE_EXAM_KINDS,
  parsePaidExamKindsByKind,
  parsePrescribedExamsByKind,
  removePaidExamKindMarker,
  removePrescribedExamLabelsFromNotes,
} from "./lab-notes.js";
import { isExternalPatientVisit } from "./visit-external.js";

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
  paidAmountFcfa: number;
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
      const newPaid = Math.min(invoice.paidAmountFcfa, newAmount);
      await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          amountFcfa: newAmount,
          paidAmountFcfa: newPaid,
          ...(newAmount === 0
            ? { status: InvoiceStatus.CANCELLED }
            : newPaid >= newAmount && newAmount > 0
              ? { status: InvoiceStatus.PAID }
              : newPaid > 0
                ? { status: InvoiceStatus.PARTIALLY_PAID }
                : {}),
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

/** Admin : annule toutes les factures examens payées et retire la prescription. */
export async function voidAllPaidLabExams(params: {
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
}): Promise<{ clinicalNotes: string; totalRefundedFcfa: number }> {
  const notes = params.consultation.clinicalNotes ?? "";
  if (hasLabResults(notes)) {
    throw new ReclamationRefundError(
      "LAB_RESULTS_LOCKED",
      "Impossible de supprimer : des résultats laboratoire sont déjà validés.",
    );
  }

  const surgery = await params.tx.surgeryCase.findUnique({
    where: { visitId: params.consultation.visitId },
    select: { id: true, status: true },
  });
  if (
    surgery &&
    (surgery.status === SurgeryStatus.IN_PROGRESS || surgery.status === SurgeryStatus.COMPLETED)
  ) {
    throw new ReclamationRefundError(
      "SURGERY_LOCKED",
      "Impossible de supprimer : l'opération est déjà en cours ou effectuée.",
    );
  }

  const paidKinds = new Set(Object.keys(parsePaidExamKindsByKind(notes)) as ExamKindSlug[]);
  const examLines: ExamRefundLine[] = buildExamSheetsByKind(notes, { billableOnly: false }).flatMap(
    (sheet) => {
      if (!paidKinds.has(sheet.kind)) return [];
      return sheet.lines.map((line) => ({
        examKind: sheet.kind,
        examLabel: line.label,
        unitPriceFcfa: line.unitPriceFcfa,
      }));
    },
  );

  let result = { clinicalNotes: notes, totalRefundedFcfa: 0 };
  if (examLines.length) {
    result = await applyExamReclamationRefund({
      tx: params.tx,
      consultation: params.consultation,
      examLines,
    });
  } else {
    let stripped = notes;
    for (const kind of paidKinds) {
      stripped = removePaidExamKindMarker(stripped, kind);
    }
    result = { clinicalNotes: stripped, totalRefundedFcfa: 0 };
    await params.tx.consultation.update({
      where: { id: params.consultation.id },
      data: { clinicalNotes: stripped, labSentToLabAt: null },
    });
  }

  await params.tx.invoice.updateMany({
    where: {
      visitId: params.consultation.visitId,
      type: InvoiceType.LAB_EXAM,
      status: { not: InvoiceStatus.CANCELLED },
    },
    data: { status: InvoiceStatus.CANCELLED },
  });

  await params.tx.consultation.update({
    where: { id: params.consultation.id },
    data: {
      labExamReductionFcfa: 0,
      labSentToLabAt: null,
      labApprovedById: null,
    },
  });

  if (
    surgery &&
    (surgery.status === SurgeryStatus.PAID || surgery.status === SurgeryStatus.AUTHORIZED)
  ) {
    await params.tx.surgeryCase.update({
      where: { id: surgery.id },
      data: {
        status: SurgeryStatus.QUOTED,
        paidAt: null,
        authorizedAt: null,
        accountantId: null,
      },
    });
  }

  const visit = await params.tx.visit.findUnique({
    where: { id: params.consultation.visitId },
    select: { notes: true, status: true },
  });
  if (isExternalPatientVisit(visit?.notes) && visit?.status !== VisitStatus.CANCELLED) {
    if (
      surgery &&
      surgery.status !== SurgeryStatus.IN_PROGRESS &&
      surgery.status !== SurgeryStatus.COMPLETED
    ) {
      await params.tx.surgeryCase.update({
        where: { id: surgery.id },
        data: {
          status: SurgeryStatus.CANCELLED,
          paidAt: null,
          authorizedAt: null,
          accountantId: null,
        },
      });
    }
    await params.tx.visit.update({
      where: { id: params.consultation.visitId },
      data: { status: VisitStatus.CANCELLED },
    });
  }

  return result;
}
