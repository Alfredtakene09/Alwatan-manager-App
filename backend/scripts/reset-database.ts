/**
 * Réinitialise la base : supprime toutes les données opérationnelles et les comptes
 * non par défaut, puis restaure les catalogues de référence (sans données démo).
 *
 * Usage :
 *   RESET_DB_CONFIRM=1 npm run db:reset
 *   npm run db:reset -- --confirm
 */
import { prisma } from "../src/lib/db.js";
import { DEFAULT_STAFF_USERNAMES, seedReferenceData } from "../prisma/seed-reference.js";

const confirmed =
  process.env.RESET_DB_CONFIRM === "1" || process.argv.includes("--confirm");

async function purgeDatabase(keptEmployeeIds: string[]) {
  await prisma.$transaction(
    async (tx) => {
      await tx.receptionCashSettlementLine.deleteMany();
      await tx.receptionCashSettlement.deleteMany();
      await tx.pharmacySaleLine.deleteMany();
      await tx.stockMovement.deleteMany();
      await tx.prescription.deleteMany();
      await tx.examReclamation.deleteMany();
      await tx.invoicePayment.deleteMany();
      await tx.invoice.deleteMany();
      await tx.hospitalization.deleteMany();
      await tx.surgeryCase.deleteMany();
      await tx.consultation.deleteMany();
      await tx.vitalSign.deleteMany();
      await tx.visit.deleteMany();
      await tx.patientDocument.deleteMany();
      await tx.patientDossier.deleteMany();
      await tx.patient.deleteMany();
      await tx.labPanelField.deleteMany();
      await tx.labPanel.deleteMany();
      await tx.employeePayroll.deleteMany();
      await tx.salaryAdvance.deleteMany();
      await tx.clinicExpense.deleteMany();
      await tx.cashChangeTransfer.deleteMany();
      await tx.auditLog.deleteMany();
      await tx.pharmacyExternalClient.deleteMany();
      await tx.logisticsRequestLine.deleteMany();
      await tx.logisticsRequest.deleteMany();
      await tx.logisticsStockMovement.deleteMany();
      await tx.logisticsItem.deleteMany();
      await tx.logisticsSupplier.deleteMany();
      await tx.logisticsCategory.deleteMany();
      await tx.product.deleteMany();
      await tx.productCategory.deleteMany();
      await tx.pharmacySupplier.deleteMany();
      await tx.room.deleteMany();
      await tx.interventionType.deleteMany();
      await tx.examCatalogItem.deleteMany();
      await tx.employeeJobTitle.deleteMany();
      await tx.clinicExpenseIndice.deleteMany();
      await tx.expenseCategory.deleteMany();

      await tx.user.deleteMany({
        where: { username: { notIn: [...DEFAULT_STAFF_USERNAMES] } },
      });

      if (keptEmployeeIds.length) {
        await tx.employee.deleteMany({
          where: { id: { notIn: keptEmployeeIds } },
        });
      } else {
        await tx.employee.deleteMany();
      }
    },
    { timeout: 120_000 },
  );
}

async function main() {
  if (!confirmed) {
    console.error("Réinitialisation annulée — confirmation requise.");
    console.error("");
    console.error("  RESET_DB_CONFIRM=1 npm run db:reset");
    console.error("  npm run db:reset -- --confirm");
    process.exit(1);
  }

  const defaultUsers = await prisma.user.findMany({
    where: { username: { in: [...DEFAULT_STAFF_USERNAMES] } },
    select: { username: true, employeeId: true },
    orderBy: { username: "asc" },
  });

  const foundUsernames = new Set(defaultUsers.map((user) => user.username));
  const missing = DEFAULT_STAFF_USERNAMES.filter((username) => !foundUsernames.has(username));
  if (missing.length) {
    console.warn(`Utilisateurs par défaut manquants : ${missing.join(", ")}`);
    console.warn("Exécutez d'abord « npm run db:seed » pour créer les comptes.");
  }

  const keptEmployeeIds = defaultUsers.map((user) => user.employeeId);

  console.log("Suppression de toutes les données (sauf utilisateurs par défaut)…");
  await purgeDatabase(keptEmployeeIds);

  console.log("Restauration des catalogues de référence…");
  await seedReferenceData();

  console.log("");
  console.log("Réinitialisation terminée.");
  console.log(`  Utilisateurs conservés : ${defaultUsers.length}/${DEFAULT_STAFF_USERNAMES.length}`);
  console.log("  Patients, visites, factures, paie, dépenses : supprimés");
  console.log("  Catalogues (examens, chambres, stocks initiaux) : restaurés");
}

main()
  .catch((error) => {
    console.error("Erreur lors de la réinitialisation :", error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
