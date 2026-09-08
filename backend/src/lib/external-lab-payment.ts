import { Prisma, SurgeryStatus } from "@prisma/client";
import {
  appendPaidExamKindMarker,
  CASHIER_PAYMENT_QUEUE_KINDS,
  getUnpaidCashierQueueKinds,
  LAB_QUEUE_EXAM_KINDS,
  parsePrescribedExamsByKind,
  prescriptionRequiresLabWork,
  type ExamKindSlug,
} from "./lab-notes.js";
import {
  buildExamSheetsByKind,
  normalizeExamReductionsByKind,
} from "./exam-billing.js";
import { applyExamKindPayment } from "./patient-invoice-payments.js";
import { generateInvoiceNumberBatch } from "./patient-code.js";

type Tx = Prisma.TransactionClient;

export type ExternalLabPaymentResult = {
  invoice: { invoiceNumber: string; amountFcfa: number } | null;
  notes: string;
  sendToLab: boolean;
  paidKinds: ExamKindSlug[];
};

/**
 * Encaissement immédiat à la réception pour un patient externe.
 * Crée les factures LAB_EXAM soldées (hors hospitalisation) et marque les types payés.
 */
export async function collectExternalLabOrderPayment(
  tx: Tx,
  params: {
    visitId: string;
    patientId: string;
    recordedById: string;
    clinicalNotes: string;
    examReduction: number;
    surgeryCaseId?: string | null;
  },
): Promise<ExternalLabPaymentResult> {
  const sheets = buildExamSheetsByKind(params.clinicalNotes, { billableOnly: false }).filter(
    (sheet) => (CASHIER_PAYMENT_QUEUE_KINDS as readonly ExamKindSlug[]).includes(sheet.kind),
  );
  const reductions = normalizeExamReductionsByKind(sheets, undefined, params.examReduction);
  const payable = sheets
    .map((sheet) => ({
      sheet,
      netFcfa: Math.max(0, sheet.grossFcfa - (reductions[sheet.kind] ?? 0)),
    }))
    .filter((row) => row.netFcfa > 0);

  const invoiceNumbers = await generateInvoiceNumberBatch(payable.length, tx);
  const paidAt = new Date();
  let notes = params.clinicalNotes;
  let primaryInvoice: ExternalLabPaymentResult["invoice"] = null;
  const paidKinds: ExamKindSlug[] = [];

  for (let index = 0; index < payable.length; index++) {
    const { sheet, netFcfa } = payable[index]!;
    const { invoice, isFullyPaid } = await applyExamKindPayment(tx, {
      kind: sheet.kind,
      sheetNetFcfa: netFcfa,
      paymentAmountFcfa: netFcfa,
      visitId: params.visitId,
      patientId: params.patientId,
      recordedById: params.recordedById,
      surgeryCaseId: sheet.kind === "operation" ? params.surgeryCaseId ?? undefined : undefined,
      invoiceNumber: invoiceNumbers[index],
    });
    if (!primaryInvoice) {
      primaryInvoice = {
        invoiceNumber: invoice.invoiceNumber,
        amountFcfa: invoice.paidAmountFcfa,
      };
    }
    if (isFullyPaid) {
      paidKinds.push(sheet.kind);
      notes = appendPaidExamKindMarker(notes, sheet.kind, paidAt);
    }
  }

  // Types à 0 F CFA ou déjà soldés : marquer payé pour ne jamais alimenter la notif / file.
  for (const kind of getUnpaidCashierQueueKinds(notes)) {
    paidKinds.push(kind);
    notes = appendPaidExamKindMarker(notes, kind, paidAt);
  }

  const sendToLab =
    paidKinds.some((kind) => (LAB_QUEUE_EXAM_KINDS as readonly ExamKindSlug[]).includes(kind)) &&
    prescriptionRequiresLabWork(parsePrescribedExamsByKind(notes));

  if (paidKinds.includes("operation") && params.surgeryCaseId) {
    await tx.surgeryCase.update({
      where: { id: params.surgeryCaseId },
      data: {
        accountantId: params.recordedById,
        status: SurgeryStatus.PAID,
        paidAt,
        authorizedAt: paidAt,
      },
    });
  }

  return { invoice: primaryInvoice, notes, sendToLab, paidKinds };
}
