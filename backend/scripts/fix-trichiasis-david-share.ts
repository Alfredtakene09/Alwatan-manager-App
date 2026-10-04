/**
 * Trichiasis 50 000 F (PAT-1016) : pas de dossier bloc, donc 0 % médecin à l'export.
 * David (fiche 30 %) a réalisé l'acte : on rattache le dossier et on calcule sa part.
 */
import { SurgeryStatus } from "@prisma/client";
import { prisma } from "../src/lib/db.js";
import { syncPaidOperationSurgeonCashShare } from "../src/lib/doctor-share-claims.js";

const INVOICE_ID = "cmuqsumbc2u2cu9msl83iasvt";

async function main() {
  const david = await prisma.user.findFirst({
    where: {
      firstName: { equals: "BAKELET", mode: "insensitive" },
      lastName: { contains: "DAVID", mode: "insensitive" },
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      employee: { select: { surgeryQuotaPercent: true } },
    },
  });
  if (!david) throw new Error("Médecin David introuvable.");
  const percent = david.employee?.surgeryQuotaPercent ?? 0;
  if (percent < 1 || percent > 99) {
    throw new Error("Le % chirurgie de David est absent ou invalide.");
  }

  const invoice = await prisma.invoice.findUnique({
    where: { id: INVOICE_ID },
    select: {
      id: true,
      visitId: true,
      amountFcfa: true,
      paidAmountFcfa: true,
      billingExamKind: true,
      surgeryCaseId: true,
      payments: { orderBy: { paidAt: "desc" }, take: 1, select: { paidAt: true } },
      visit: {
        select: {
          surgeryCase: { select: { id: true } },
          consultation: { select: { clinicalNotes: true } },
        },
      },
    },
  });
  if (!invoice?.visitId) throw new Error("Facture Trichiasis introuvable.");
  if (invoice.billingExamKind !== "operation") throw new Error("La facture n'est pas une opération.");
  const notes = invoice.visit?.consultation?.clinicalNotes ?? "";
  if (!/trichiasis/i.test(notes)) throw new Error("La facture ne correspond pas au Trichiasis.");

  const intervention = await prisma.interventionType.findFirst({
    where: { label: { equals: "Trichiasis", mode: "insensitive" }, active: true },
    select: { id: true, label: true },
  });
  if (!intervention) throw new Error("Type d'intervention Trichiasis introuvable.");

  const amount = Math.max(invoice.paidAmountFcfa ?? 0, invoice.amountFcfa);
  const surgeonShareFcfa = Math.round((amount * percent) / 100);
  const clinicShareFcfa = amount - surgeonShareFcfa;
  const paidAt = invoice.payments[0]?.paidAt ?? new Date();
  const existingId = invoice.surgeryCaseId ?? invoice.visit?.surgeryCase?.id ?? null;

  const caseId = await prisma.$transaction(async (tx) => {
    const data = {
      interventionTypeId: intervention.id,
      surgeonId: david.id,
      totalCostFcfa: amount,
      surgeonPercent: percent,
      surgeonShareFcfa,
      clinicShareFcfa,
      status: SurgeryStatus.PAID,
      paidAt,
    };
    const saved = existingId
      ? await tx.surgeryCase.update({ where: { id: existingId }, data, select: { id: true } })
      : await tx.surgeryCase.create({
          data: { visitId: invoice.visitId!, ...data },
          select: { id: true },
        });
    if (invoice.surgeryCaseId !== saved.id) {
      await tx.invoice.update({
        where: { id: invoice.id },
        data: { surgeryCaseId: saved.id },
      });
    }
    return saved.id;
  });

  const claim = await prisma.$transaction((tx) =>
    syncPaidOperationSurgeonCashShare(tx, invoice.id, david.id),
  );

  console.log(
    JSON.stringify(
      {
        caseId,
        surgeon: `${david.firstName} ${david.lastName}`,
        operation: intervention.label,
        percent,
        amountFcfa: amount,
        surgeonShareFcfa,
        clinicShareFcfa,
        cashShareFcfa: claim?.amountFcfa ?? 0,
        cashShareStatus: claim?.status ?? null,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
