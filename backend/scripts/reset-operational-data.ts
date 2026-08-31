/**
 * Remise a zero — script permanent pour reinitialiser les donnees operationnelles.
 *
 * Conserve :
 *   - utilisateurs & employes (+ postes, services clinique)
 *   - catalogues examens, types d'operation, salles/lits, formulaires labo
 *   - produits pharmacie (+ categories, formes, fournisseurs) et quantites en stock
 *   - articles logistique (+ categories, fournisseurs) et quantites en stock
 *   - stock laboratoire (articles + quantites)
 *   - indices / categories de depenses (pas les depenses elles-memes)
 *   - parametres clinique, droits UI
 *
 * Windows (avec confirmation) :
 *   scripts\reinitialiser-a-zero.cmd
 *
 * Ligne de commande :
 *   RESET_OPERATIONAL_CONFIRM=1 npm run db:reset-operational
 *   npm run db:reset-operational -- --confirm
 */
import { prisma } from "../src/lib/db.js";

const confirmed =
  process.env.RESET_OPERATIONAL_CONFIRM === "1" || process.argv.includes("--confirm");

async function countOperational() {
  const counts = await Promise.all([
    prisma.patient.count(),
    prisma.visit.count(),
    prisma.invoice.count(),
    prisma.pharmacySaleLine.count(),
    prisma.prescription.count(),
    prisma.clinicExpense.count(),
    prisma.receptionDayClosure.count(),
    prisma.employeePayroll.count(),
    prisma.salaryAdvance.count(),
    prisma.logisticsRequest.count(),
    prisma.stockMovement.count(),
    prisma.logisticsStockMovement.count(),
    prisma.labStockMovement.count(),
  ]);
  return {
    patients: counts[0],
    visits: counts[1],
    invoices: counts[2],
    pharmacyLines: counts[3],
    prescriptions: counts[4],
    clinicExpenses: counts[5],
    dayClosures: counts[6],
    payrolls: counts[7],
    salaryAdvances: counts[8],
    logisticsRequests: counts[9],
    pharmacyMovements: counts[10],
    logisticsMovements: counts[11],
    labMovements: counts[12],
  };
}

async function purgeOperationalData() {
  await prisma.$transaction(
    async (tx) => {
      // --- Caisse / réception ---
      await tx.receptionDayClosure.updateMany({ data: { settlementId: null } });
      await tx.receptionCashSettlementLine.deleteMany();
      await tx.receptionCashSettlement.deleteMany();
      await tx.receptionDayClosure.deleteMany();
      await tx.cashChangeTransfer.deleteMany();

      // --- Paie / parts médecin ---
      await tx.doctorShareClaim.deleteMany();
      await tx.doctorOvertimeEntry.deleteMany();
      await tx.salaryAdvance.deleteMany();
      await tx.employeePayroll.deleteMany();

      // --- Pharmacie (historique ventes / mouvements, pas les produits) ---
      await tx.pharmacySaleLine.deleteMany();
      await tx.stockMovement.deleteMany();
      await tx.prescription.deleteMany();
      await tx.pharmacyExternalClient.deleteMany();

      // --- Logistique (demandes + historique mouvements) ---
      await tx.logisticsRequestLine.deleteMany();
      await tx.logisticsRequest.deleteMany();
      await tx.logisticsStockMovement.deleteMany();

      // --- Labo stock (historique mouvements) ---
      await tx.labStockMovement.deleteMany();

      // --- Parcours patient & facturation ---
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

      // --- Dépenses & audit ---
      await tx.clinicExpense.deleteMany();
      await tx.auditLog.deleteMany();
    },
    { timeout: 300_000 },
  );
}

async function main() {
  if (!confirmed) {
    console.error("Réinitialisation annulée — confirmation requise.");
    console.error("");
    console.error("Ce script va SUPPRIMER toutes les données opérationnelles :");
    console.error("  • patients, visites, consultations, opérations, hospitalisations");
    console.error("  • factures, paiements, réclamations examens");
    console.error("  • ventes / prescriptions pharmacie, clients externes");
    console.error("  • historique mouvements stock (pharmacie, logistique, labo)");
    console.error("  • dépenses, clôtures réception, paie, avances, heures sup.");
    console.error("  • demandes logistique");
    console.error("");
    console.error("Conservé : utilisateurs, employés, catalogues, salles, examens,");
    console.error("types d'opération, produits/stocks actuels (quantités).");
    console.error("");
    console.error("Pour exécuter :");
    console.error("  RESET_OPERATIONAL_CONFIRM=1 npm run db:reset-operational");
    console.error("  npm run db:reset-operational -- --confirm");
    process.exit(1);
  }

  const before = await countOperational();
  console.log("Avant réinitialisation :");
  console.log(`  Patients              : ${before.patients}`);
  console.log(`  Visites               : ${before.visits}`);
  console.log(`  Factures              : ${before.invoices}`);
  console.log(`  Ventes pharmacie      : ${before.pharmacyLines}`);
  console.log(`  Prescriptions         : ${before.prescriptions}`);
  console.log(`  Dépenses              : ${before.clinicExpenses}`);
  console.log(`  Clôtures réception    : ${before.dayClosures}`);
  console.log(`  Fiches de paie        : ${before.payrolls}`);
  console.log(`  Avances salaire       : ${before.salaryAdvances}`);
  console.log(`  Demandes logistique   : ${before.logisticsRequests}`);
  console.log(`  Mouv. stock pharma    : ${before.pharmacyMovements}`);
  console.log(`  Mouv. stock logistique: ${before.logisticsMovements}`);
  console.log(`  Mouv. stock labo      : ${before.labMovements}`);
  console.log("");
  console.log("Suppression en cours…");

  await purgeOperationalData();

  const [
    users,
    employees,
    products,
    logisticsItems,
    labItems,
    rooms,
    examItems,
    operationTypes,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.employee.count(),
    prisma.product.count(),
    prisma.logisticsItem.count(),
    prisma.labStockItem.count(),
    prisma.room.count(),
    prisma.examCatalogItem.count(),
    prisma.interventionType.count(),
  ]);

  const after = await countOperational();
  console.log("");
  console.log("Réinitialisation terminée.");
  console.log(`  Patients              : ${after.patients}`);
  console.log(`  Visites               : ${after.visits}`);
  console.log(`  Factures              : ${after.invoices}`);
  console.log(`  Ventes pharmacie      : ${after.pharmacyLines}`);
  console.log("");
  console.log("Données conservées :");
  console.log(`  Utilisateurs          : ${users}`);
  console.log(`  Employés              : ${employees}`);
  console.log(`  Produits pharmacie    : ${products}`);
  console.log(`  Articles logistique   : ${logisticsItems}`);
  console.log(`  Articles stock labo   : ${labItems}`);
  console.log(`  Salles                : ${rooms}`);
  console.log(`  Examens (catalogue)   : ${examItems}`);
  console.log(`  Types d'opération     : ${operationTypes}`);
  console.log("");
  console.log("Prochains numéros : PAT-001, FAC-001 (compteurs remis à zéro).");
}

main()
  .catch((error) => {
    console.error("Erreur lors de la réinitialisation :", error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
