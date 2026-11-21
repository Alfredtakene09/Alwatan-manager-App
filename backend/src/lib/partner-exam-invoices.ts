import { InvoiceStatus, InvoiceType, type Prisma } from "@prisma/client";
import { buildExamSheetsByKind } from "./exam-billing.js";
import { generateInvoiceNumber } from "./patient-code.js";

type KindInvoice = { id: string; amountFcfa: number; paidAmountFcfa: number; status: InvoiceStatus };

export type PartnerExamInvoicePlan =
  | { action: "none" }
  | { action: "create"; amountFcfa: number }
  | { action: "update"; invoiceId: string; amountFcfa: number };

/**
 * Facture « en attente » d'un type d'examen pour un patient ONG : le partenaire règle plus tard.
 * On ne facture que l'écart entre le prescrit et ce qui est déjà facturé pour ce type.
 */
export function partnerExamInvoicePlan(grossFcfa: number, existing: KindInvoice[]): PartnerExamInvoicePlan {
  const billed = existing.reduce((sum, invoice) => sum + invoice.amountFcfa, 0);
  const delta = grossFcfa - billed;
  if (delta === 0) return { action: "none" };
  const open = existing.find((invoice) => invoice.status !== InvoiceStatus.PAID);
  if (open) {
    // Jamais en dessous de ce qui a déjà été réglé sur cette facture.
    const amountFcfa = Math.max(open.paidAmountFcfa, open.amountFcfa + delta);
    return amountFcfa === open.amountFcfa ? { action: "none" } : { action: "update", invoiceId: open.id, amountFcfa };
  }
  return delta > 0 ? { action: "create", amountFcfa: delta } : { action: "none" };
}

/** Crée / ajuste les factures examens en attente d'un parcours ONG d'après la prescription. */
export async function syncPartnerExamInvoices(
  tx: Prisma.TransactionClient,
  params: { visitId: string; patientId: string; notes: string | null; issuedById: string },
) {
  for (const sheet of buildExamSheetsByKind(params.notes, { billableOnly: true })) {
    const existing = await tx.invoice.findMany({
      where: {
        visitId: params.visitId,
        type: InvoiceType.LAB_EXAM,
        billingExamKind: sheet.kind,
        status: { not: InvoiceStatus.CANCELLED },
      },
      select: { id: true, amountFcfa: true, paidAmountFcfa: true, status: true },
    });
    const plan = partnerExamInvoicePlan(sheet.grossFcfa, existing);
    if (plan.action === "update") {
      const invoice = existing.find((row) => row.id === plan.invoiceId)!;
      const fullyPaid = invoice.paidAmountFcfa >= plan.amountFcfa;
      await tx.invoice.update({
        where: { id: plan.invoiceId },
        data: {
          amountFcfa: plan.amountFcfa,
          status: fullyPaid
            ? InvoiceStatus.PAID
            : invoice.paidAmountFcfa > 0
              ? InvoiceStatus.PARTIALLY_PAID
              : InvoiceStatus.PENDING,
        },
      });
    } else if (plan.action === "create") {
      await tx.invoice.create({
        data: {
          invoiceNumber: await generateInvoiceNumber(tx),
          patientId: params.patientId,
          visitId: params.visitId,
          type: InvoiceType.LAB_EXAM,
          billingExamKind: sheet.kind,
          amountFcfa: plan.amountFcfa,
          paidAmountFcfa: 0,
          status: InvoiceStatus.PENDING,
          issuedById: params.issuedById,
        },
      });
    }
  }
}
