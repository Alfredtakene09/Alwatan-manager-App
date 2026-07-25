import { InvoiceStatus, InvoiceType, Prisma } from "@prisma/client";
import { prisma } from "./db.js";
import { EXAM_KIND_SECTION_LABELS, type ExamKindSlug } from "./lab-notes.js";

const EXAM_KIND_LABELS: Record<string, string> = {
  examen: "Examens",
  radio: "Radiologie",
  echo: "Échographie",
  odonto: "Odontologie",
  operation: "Opération",
  hospitalisation: "Hospitalisation",
};

const INVOICE_TYPE_LABELS: Record<InvoiceType, string> = {
  CONSULTATION: "Consultation",
  LAB_EXAM: "Examens / actes",
  SURGERY: "Opération",
  HOSPITALIZATION_DEPOSIT: "Acompte hospitalisation",
  HOSPITALIZATION_FINAL: "Solde hospitalisation",
  PHARMACY: "Pharmacie",
};

type Tx = Prisma.TransactionClient;

export function resolveInvoiceGroupLabel(invoice: {
  type: InvoiceType;
  billingExamKind: string | null;
  visit?: { createdAt: Date } | null;
}) {
  if (invoice.billingExamKind) {
    const kindLabel =
      EXAM_KIND_LABELS[invoice.billingExamKind] ??
      EXAM_KIND_SECTION_LABELS[invoice.billingExamKind as ExamKindSlug] ??
      invoice.billingExamKind;
    return kindLabel;
  }
  return INVOICE_TYPE_LABELS[invoice.type] ?? invoice.type;
}

export async function recordInvoiceInstallment(
  tx: Tx,
  params: {
    invoiceId: string;
    amountFcfa: number;
    recordedById: string;
    note?: string;
  },
) {
  const invoice = await tx.invoice.findUniqueOrThrow({
    where: { id: params.invoiceId },
    select: { id: true, amountFcfa: true, paidAmountFcfa: true, status: true },
  });

  if (invoice.status === InvoiceStatus.PAID || invoice.status === InvoiceStatus.CANCELLED) {
    throw new Error("INVOICE_NOT_PAYABLE");
  }

  const remainingFcfa = Math.max(0, invoice.amountFcfa - invoice.paidAmountFcfa);
  if (params.amountFcfa <= 0 || params.amountFcfa > remainingFcfa) {
    throw new Error("INVALID_INSTALLMENT_AMOUNT");
  }

  const payment = await tx.invoicePayment.create({
    data: {
      invoiceId: invoice.id,
      amountFcfa: params.amountFcfa,
      recordedById: params.recordedById,
      note: params.note,
    },
  });

  const paidAmountFcfa = invoice.paidAmountFcfa + params.amountFcfa;
  const isFullyPaid = paidAmountFcfa >= invoice.amountFcfa;
  const updated = await tx.invoice.update({
    where: { id: invoice.id },
    data: {
      paidAmountFcfa,
      status: isFullyPaid ? InvoiceStatus.PAID : InvoiceStatus.PARTIALLY_PAID,
      paidAt: isFullyPaid ? new Date() : null,
      issuedById: params.recordedById,
    },
  });

  return { payment, invoice: updated, isFullyPaid, remainingFcfa: Math.max(0, invoice.amountFcfa - paidAmountFcfa) };
}

export async function applyExamKindPayment(
  tx: Tx,
  params: {
    kind: ExamKindSlug;
    sheetNetFcfa: number;
    paymentAmountFcfa: number;
    visitId: string;
    patientId: string;
    recordedById: string;
    surgeryCaseId?: string;
    hospitalizationId?: string;
    existingInvoice?: {
      id: string;
      amountFcfa: number;
      paidAmountFcfa: number;
      status: InvoiceStatus;
    } | null;
    invoiceNumber?: string;
  },
) {
  const paymentAmountFcfa = Math.min(
    params.paymentAmountFcfa,
    params.sheetNetFcfa,
  );
  if (paymentAmountFcfa <= 0) {
    throw new Error("INVALID_INSTALLMENT_AMOUNT");
  }

  if (params.existingInvoice) {
    const remainingFcfa = Math.max(
      0,
      params.existingInvoice.amountFcfa - params.existingInvoice.paidAmountFcfa,
    );
    if (paymentAmountFcfa > remainingFcfa) {
      throw new Error("INVALID_INSTALLMENT_AMOUNT");
    }
    const result = await recordInvoiceInstallment(tx, {
      invoiceId: params.existingInvoice.id,
      amountFcfa: paymentAmountFcfa,
      recordedById: params.recordedById,
    });
    return {
      invoice: result.invoice,
      isFullyPaid: result.isFullyPaid,
      paymentAmountFcfa,
    };
  }

  const isFullyPaid = paymentAmountFcfa >= params.sheetNetFcfa;
  const invoice = await tx.invoice.create({
    data: {
      invoiceNumber: params.invoiceNumber!,
      patientId: params.patientId,
      visitId: params.visitId,
      surgeryCaseId: params.surgeryCaseId,
      hospitalizationId: params.hospitalizationId,
      type: InvoiceType.LAB_EXAM,
      amountFcfa: params.sheetNetFcfa,
      paidAmountFcfa: paymentAmountFcfa,
      billingExamKind: params.kind,
      status: isFullyPaid ? InvoiceStatus.PAID : InvoiceStatus.PARTIALLY_PAID,
      issuedById: params.recordedById,
      paidAt: isFullyPaid ? new Date() : null,
      payments: {
        create: {
          amountFcfa: paymentAmountFcfa,
          recordedById: params.recordedById,
        },
      },
    },
  });

  return { invoice, isFullyPaid, paymentAmountFcfa };
}

export async function buildPatientPaymentHistory(patientId: string) {
  const invoices = await prisma.invoice.findMany({
    where: {
      patientId,
      status: { in: [InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.PAID, InvoiceStatus.PENDING] },
      amountFcfa: { gt: 0 },
    },
    include: {
      payments: {
        orderBy: { paidAt: "asc" },
        include: {
          recordedBy: { select: { firstName: true, lastName: true } },
        },
      },
      visit: { select: { id: true, createdAt: true } },
    },
    orderBy: [{ createdAt: "desc" }],
  });

  const groups = invoices
    .filter((invoice) => invoice.payments.length > 0 || invoice.paidAmountFcfa > 0)
    .map((invoice) => {
      const label = resolveInvoiceGroupLabel(invoice);
      const visitDate = invoice.visit?.createdAt
        ? invoice.visit.createdAt.toLocaleDateString("fr-FR", {
            day: "numeric",
            month: "short",
            year: "numeric",
          })
        : null;
      return {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        type: invoice.type,
        billingExamKind: invoice.billingExamKind,
        label,
        visitId: invoice.visitId,
        visitDate,
        groupTitle: visitDate ? `${label} — ${visitDate}` : label,
        totalFcfa: invoice.amountFcfa,
        paidFcfa: invoice.paidAmountFcfa,
        remainingFcfa: Math.max(0, invoice.amountFcfa - invoice.paidAmountFcfa),
        status: invoice.status,
        payments: invoice.payments.map((payment) => ({
          id: payment.id,
          amountFcfa: payment.amountFcfa,
          paidAt: payment.paidAt.toISOString(),
          recordedByName: `${payment.recordedBy.firstName} ${payment.recordedBy.lastName}`.trim(),
          note: payment.note,
        })),
      };
    });

  const totals = groups.reduce(
    (acc, group) => {
      acc.totalFcfa += group.totalFcfa;
      acc.paidFcfa += group.paidFcfa;
      acc.remainingFcfa += group.remainingFcfa;
      return acc;
    },
    { totalFcfa: 0, paidFcfa: 0, remainingFcfa: 0 },
  );

  return { groups, totals };
}
