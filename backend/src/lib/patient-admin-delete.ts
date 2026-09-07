import fs from "node:fs/promises";
import { prisma } from "./db.js";
import { deleteDocumentFile, patientUploadDir } from "./patient-dossier.js";

/**
 * Suppression admin : enlève le dossier même après consultation
 * (visites, factures, prescriptions, documents).
 */
export async function forceDeletePatientCascade(patientId: string): Promise<void> {
  const documents = await prisma.patientDocument.findMany({
    where: { patientId },
    select: { storagePath: true },
  });

  await prisma.$transaction(
    async (tx) => {
      const visits = await tx.visit.findMany({
        where: { patientId },
        select: { id: true },
      });
      const visitIds = visits.map((visit) => visit.id);

      const [surgeries, hospitalizations] = visitIds.length
        ? await Promise.all([
            tx.surgeryCase.findMany({
              where: { visitId: { in: visitIds } },
              select: { id: true },
            }),
            tx.hospitalization.findMany({
              where: { visitId: { in: visitIds } },
              select: { id: true },
            }),
          ])
        : [[], []];

      const surgeryIds = surgeries.map((row) => row.id);
      const hospitalizationIds = hospitalizations.map((row) => row.id);

      const prescriptions = await tx.prescription.findMany({
        where: {
          OR: [
            { patientId },
            ...(visitIds.length ? [{ visitId: { in: visitIds } }] : []),
          ],
        },
        select: { id: true },
      });
      const prescriptionIds = prescriptions.map((row) => row.id);

      if (prescriptionIds.length) {
        await tx.stockMovement.updateMany({
          where: { prescriptionId: { in: prescriptionIds } },
          data: { prescriptionId: null },
        });
        await tx.prescription.deleteMany({ where: { id: { in: prescriptionIds } } });
      }

      const invoices = await tx.invoice.findMany({
        where: {
          OR: [
            { patientId },
            ...(visitIds.length ? [{ visitId: { in: visitIds } }] : []),
            ...(surgeryIds.length ? [{ surgeryCaseId: { in: surgeryIds } }] : []),
            ...(hospitalizationIds.length
              ? [{ hospitalizationId: { in: hospitalizationIds } }]
              : []),
          ],
        },
        select: { id: true },
      });
      const invoiceIds = invoices.map((row) => row.id);

      if (invoiceIds.length) {
        await tx.pharmacySaleLine.updateMany({
          where: { invoiceId: { in: invoiceIds } },
          data: { invoiceId: null },
        });
        await tx.receptionCashSettlementLine.deleteMany({
          where: { invoiceId: { in: invoiceIds } },
        });
        await tx.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
      }

      await tx.patient.delete({ where: { id: patientId } });
    },
    { timeout: 60_000 },
  );

  for (const document of documents) {
    await deleteDocumentFile(document.storagePath);
  }
  try {
    await fs.rm(patientUploadDir(patientId), { recursive: true, force: true });
  } catch {
    // Dossier d’upload déjà absent
  }
}
