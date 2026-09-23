import {
  HospitalizationStatus,
  InvoiceStatus,
  InvoiceType,
  VisitStatus,
  type PrismaClient,
} from "@prisma/client";
import {
  HOSPITALISATION_DAYS_PREFIX,
  parsePrescribedExamsByKind,
  removePaidExamKindMarker,
  removePrescribedExamLabelsFromNotes,
} from "./lab-notes.js";

type Tx = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

function isHospitalizationInvoice(invoice: {
  type: InvoiceType;
  hospitalizationId: string | null;
  billingExamKind: string | null;
}, hospitalizationId: string) {
  if (invoice.hospitalizationId === hospitalizationId) return true;
  if (invoice.billingExamKind === "hospitalisation") return true;
  return (
    invoice.type === InvoiceType.HOSPITALIZATION_DEPOSIT ||
    invoice.type === InvoiceType.HOSPITALIZATION_FINAL
  );
}

export async function deleteHospitalizationAndRefund(
  tx: Tx,
  hospitalizationId: string,
): Promise<{ refundedFcfa: number }> {
  const hospitalization = await tx.hospitalization.findUnique({
    where: { id: hospitalizationId },
    include: {
      visit: {
        include: {
          consultation: { select: { id: true, clinicalNotes: true } },
          invoices: {
            select: {
              id: true,
              type: true,
              status: true,
              paidAmountFcfa: true,
              billingExamKind: true,
              hospitalizationId: true,
            },
          },
        },
      },
    },
  });
  if (!hospitalization) throw new Error("NOT_FOUND");

  const invoices = hospitalization.visit.invoices.filter((invoice) =>
    isHospitalizationInvoice(invoice, hospitalization.id),
  );
  const invoiceIds = invoices.map((invoice) => invoice.id);
  const refundedFcfa = invoices.reduce((sum, invoice) => {
    if (invoice.status === InvoiceStatus.CANCELLED) return sum;
    return sum + Math.max(0, invoice.paidAmountFcfa);
  }, 0);

  if (invoiceIds.length) {
    await tx.invoicePayment.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
    await tx.invoice.updateMany({
      where: { id: { in: invoiceIds } },
      data: {
        status: InvoiceStatus.CANCELLED,
        paidAmountFcfa: 0,
        paidAt: null,
      },
    });
  }

  const consultation = hospitalization.visit.consultation;
  if (consultation) {
    let notes = consultation.clinicalNotes ?? "";
    const labels = parsePrescribedExamsByKind(notes).hospitalisation ?? [];
    if (labels.length) {
      notes = removePrescribedExamLabelsFromNotes(
        notes,
        labels.map((examLabel) => ({ examKind: "hospitalisation" as const, examLabel })),
      );
    }
    notes = removePaidExamKindMarker(notes, "hospitalisation");
    notes = notes
      .split("\n")
      .filter((line) => !line.trim().startsWith(HOSPITALISATION_DAYS_PREFIX))
      .join("\n")
      .trim();
    await tx.consultation.update({
      where: { id: consultation.id },
      data: {
        needsHospitalization: false,
        clinicalNotes: notes || null,
      },
    });
  }

  await tx.hospitalization.delete({ where: { id: hospitalization.id } });

  const visitWasHosp =
    hospitalization.visit.status === VisitStatus.NEEDS_HOSPITALIZATION ||
    hospitalization.status === HospitalizationStatus.ACTIVE ||
    hospitalization.status === HospitalizationStatus.RESERVED;
  if (visitWasHosp || hospitalization.visit.status === VisitStatus.IN_TREATMENT) {
    await tx.visit.update({
      where: { id: hospitalization.visitId },
      data: {
        status: consultation ? VisitStatus.IN_TREATMENT : VisitStatus.COMPLETED,
      },
    });
  }

  return { refundedFcfa };
}
