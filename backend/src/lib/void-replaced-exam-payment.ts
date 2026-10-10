import {
  DoctorShareClaimStatus,
  HospitalizationStatus,
  InvoiceStatus,
  InvoiceType,
  SurgeryStatus,
  VisitStatus,
  type Prisma,
} from "@prisma/client";
import { formatBusinessDate, parseBusinessDate } from "./cash-shift.js";

type Tx = Prisma.TransactionClient;

const REPLACED_INVOICE_TYPES: InvoiceType[] = [
  InvoiceType.LAB_EXAM,
  InvoiceType.SURGERY,
  InvoiceType.HOSPITALIZATION_DEPOSIT,
  InvoiceType.HOSPITALIZATION_FINAL,
];

/**
 * Annule les encaissements d’examens d’une visite dont le médecin remplace la prescription.
 * Le montant déjà encaissé sort du solde (factures, versements, clôture de caisse encore enregistrée).
 */
export async function voidReplacedExamPayments(
  tx: Tx,
  params: { visitId: string; userId: string },
): Promise<{ removedFromBalanceFcfa: number }> {
  const surgery = await tx.surgeryCase.findUnique({
    where: { visitId: params.visitId },
    select: { id: true, status: true },
  });
  if (
    surgery &&
    (surgery.status === SurgeryStatus.IN_PROGRESS || surgery.status === SurgeryStatus.COMPLETED)
  ) {
    throw new Error("SURGERY_LOCKED");
  }

  const hospitalization = await tx.hospitalization.findUnique({
    where: { visitId: params.visitId },
    select: { id: true, status: true },
  });
  if (
    hospitalization &&
    (hospitalization.status === HospitalizationStatus.ACTIVE ||
      hospitalization.status === HospitalizationStatus.DISCHARGED)
  ) {
    throw new Error("HOSPITALIZATION_LOCKED");
  }

  const invoices = await tx.invoice.findMany({
    where: {
      visitId: params.visitId,
      type: { in: REPLACED_INVOICE_TYPES },
      status: { not: InvoiceStatus.CANCELLED },
    },
    select: {
      id: true,
      amountFcfa: true,
      paidAmountFcfa: true,
      status: true,
      issuedById: true,
      paidAt: true,
      createdAt: true,
      payments: {
        select: { amountFcfa: true, recordedById: true, paidAt: true },
        orderBy: { paidAt: "asc" },
      },
    },
  });

  const adjustments = new Map<string, { cashierId: string; businessDate: Date; amountFcfa: number }>();
  const addAdjustment = (cashierId: string | null | undefined, at: Date | null | undefined, amount: number) => {
    if (!cashierId || !at || amount <= 0) return;
    const businessDate = parseBusinessDate(formatBusinessDate(at));
    const key = `${cashierId}|${businessDate.toISOString()}`;
    const current = adjustments.get(key) ?? { cashierId, businessDate, amountFcfa: 0 };
    current.amountFcfa += amount;
    adjustments.set(key, current);
  };

  let removedFromBalanceFcfa = 0;
  for (const invoice of invoices) {
    const net =
      invoice.paidAmountFcfa > 0
        ? invoice.paidAmountFcfa
        : invoice.status === InvoiceStatus.PAID
          ? Math.max(0, invoice.amountFcfa)
          : 0;
    removedFromBalanceFcfa += net;
    if (net <= 0) continue;
    if (!invoice.payments.length) {
      addAdjustment(invoice.issuedById, invoice.paidAt ?? invoice.createdAt, net);
      continue;
    }
    let remaining = net;
    for (const payment of invoice.payments) {
      if (remaining <= 0) break;
      const take = Math.min(Math.max(0, payment.amountFcfa), remaining);
      remaining -= take;
      addAdjustment(payment.recordedById, payment.paidAt, take);
    }
  }

  const invoiceIds = invoices.map((invoice) => invoice.id);
  if (invoiceIds.length) {
    await tx.invoicePayment.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
    await tx.invoice.updateMany({
      where: { id: { in: invoiceIds } },
      data: { status: InvoiceStatus.CANCELLED, paidAmountFcfa: 0, paidAt: null },
    });
    await tx.doctorShareClaim.updateMany({
      where: {
        invoiceId: { in: invoiceIds },
        status: DoctorShareClaimStatus.PENDING_PAYROLL,
      },
      data: { status: DoctorShareClaimStatus.CANCELLED },
    });
  }

  if (
    surgery &&
    (surgery.status === SurgeryStatus.PAID ||
      surgery.status === SurgeryStatus.AUTHORIZED ||
      surgery.status === SurgeryStatus.QUOTED ||
      surgery.status === SurgeryStatus.NOTIFIED)
  ) {
    await tx.surgeryCase.update({
      where: { id: surgery.id },
      data: {
        status: SurgeryStatus.NOTIFIED,
        paidAt: null,
        authorizedAt: null,
        accountantId: null,
      },
    });
    await tx.doctorShareClaim.updateMany({
      where: {
        surgeryCaseId: surgery.id,
        status: DoctorShareClaimStatus.PENDING_PAYROLL,
      },
      data: { status: DoctorShareClaimStatus.CANCELLED },
    });
  }

  if (hospitalization && hospitalization.status === HospitalizationStatus.RESERVED) {
    await tx.hospitalization.update({
      where: { id: hospitalization.id },
      data: { status: HospitalizationStatus.REQUESTED, paidAt: null },
    });
  }

  const visit = await tx.visit.findUnique({
    where: { id: params.visitId },
    select: { status: true },
  });
  if (visit?.status === VisitStatus.IN_TREATMENT) {
    await tx.visit.update({
      where: { id: params.visitId },
      data: { status: VisitStatus.IN_CONSULTATION },
    });
  }

  for (const adjustment of adjustments.values()) {
    const closure = await tx.receptionDayClosure.findUnique({
      where: {
        receptionistId_businessDate: {
          receptionistId: adjustment.cashierId,
          businessDate: adjustment.businessDate,
        },
      },
    });
    if (!closure) continue;
    const collectedFcfa = Math.max(0, closure.collectedFcfa - adjustment.amountFcfa);
    const netFcfa = Math.max(0, collectedFcfa - closure.expensesFcfa);
    if (collectedFcfa === closure.collectedFcfa && netFcfa === closure.netFcfa) continue;
    await tx.receptionDayClosure.update({
      where: { id: closure.id },
      data: { collectedFcfa, netFcfa },
    });
  }

  if (removedFromBalanceFcfa > 0 || invoiceIds.length) {
    await tx.auditLog.create({
      data: {
        userId: params.userId,
        action: "EXAM_PRESCRIPTION_REPLACED",
        entity: "Visit",
        entityId: params.visitId,
        metadata: {
          voidedInvoiceIds: invoiceIds,
          removedFromBalanceFcfa,
        },
      },
    });
  }

  return { removedFromBalanceFcfa };
}
