/**
 * Efface les données opérationnelles :
 *   A — patients (+ visites, consultations, factures liées, dossiers…)
 *   B — clôtures réception + règlements / encaissements caisse
 *   C — ventes pharmacie (lignes + prescriptions + historique mouvements)
 *       + dépenses clinique
 *
 * Conservé :
 *   - catalogues (examens, opérations, chambres, formulaires labo…)
 *   - comptes utilisateurs & employés (+ paie / avances)
 *   - articles pharmacie & quantités de stock actuelles
 *   - catégories / indices de dépenses (pas les dépenses elles-mêmes)
 *   - clients externes pharmacie (fiches), sans leurs ventes
 *
 * Usage (quand vous serez prêts) :
 *   PURGE_PATIENTS_EXPENSES_CONFIRM=1 npm run db:purge-patients-expenses
 *   npm run db:purge-patients-expenses -- --confirm
 */
import { prisma } from "../src/lib/db.js";

const confirmed =
  process.env.PURGE_PATIENTS_EXPENSES_CONFIRM === "1" ||
  process.argv.includes("--confirm");

async function countSnapshot() {
  const [
    patients,
    visits,
    invoices,
    clinicExpenses,
    dayClosures,
    settlements,
    pharmacyLines,
    prescriptions,
  ] = await Promise.all([
    prisma.patient.count(),
    prisma.visit.count(),
    prisma.invoice.count(),
    prisma.clinicExpense.count(),
    prisma.receptionDayClosure.count(),
    prisma.receptionCashSettlement.count(),
    prisma.pharmacySaleLine.count(),
    prisma.prescription.count(),
  ]);
  return {
    patients,
    visits,
    invoices,
    clinicExpenses,
    dayClosures,
    settlements,
    pharmacyLines,
    prescriptions,
  };
}

async function purge() {
  await prisma.$transaction(
    async (tx) => {
      // --- B : caisse réception / clôtures (avant factures) ---
      await tx.receptionDayClosure.updateMany({ data: { settlementId: null } });
      await tx.receptionCashSettlementLine.deleteMany();
      await tx.receptionCashSettlement.deleteMany();
      await tx.receptionDayClosure.deleteMany();
      await tx.cashChangeTransfer.deleteMany();

      // --- Parts médecin liées aux factures / opérations patient ---
      await tx.doctorShareClaim.deleteMany();

      // --- C : ventes pharmacie (stock produit inchangé) ---
      await tx.pharmacySaleLine.deleteMany();
      await tx.stockMovement.deleteMany();
      await tx.prescription.deleteMany();

      // --- A : parcours patient + facturation ---
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

      // --- Dépenses clinique ---
      await tx.clinicExpense.deleteMany();

      // Journal d’audit opérationnel (pas les comptes)
      await tx.auditLog.deleteMany();
    },
    { timeout: 180_000 },
  );
}

async function main() {
  if (!confirmed) {
    console.error("Purge annulée — confirmation requise.");
    console.error("");
    console.error("Ce script va SUPPRIMER :");
    console.error("  • tous les patients et dossiers cliniques associés");
    console.error("  • visites, consultations, opérations, hospitalisations");
    console.error("  • factures & paiements liés");
    console.error("  • dépenses clinique");
    console.error("  • clôtures réception & règlements caisse");
    console.error("  • ventes / prescriptions pharmacie (+ historique mouvements)");
    console.error("");
    console.error("Conservé : catalogues, utilisateurs, employés, stock (quantités), formulaires labo.");
    console.error("");
    console.error("Pour exécuter :");
    console.error("  PURGE_PATIENTS_EXPENSES_CONFIRM=1 npm run db:purge-patients-expenses");
    console.error("  npm run db:purge-patients-expenses -- --confirm");
    process.exit(1);
  }

  const before = await countSnapshot();
  console.log("Avant purge :");
  console.log(`  Patients           : ${before.patients}`);
  console.log(`  Visites            : ${before.visits}`);
  console.log(`  Factures           : ${before.invoices}`);
  console.log(`  Dépenses clinique  : ${before.clinicExpenses}`);
  console.log(`  Clôtures réception : ${before.dayClosures}`);
  console.log(`  Règlements caisse  : ${before.settlements}`);
  console.log(`  Lignes vente pharma: ${before.pharmacyLines}`);
  console.log(`  Prescriptions      : ${before.prescriptions}`);
  console.log("");
  console.log("Suppression en cours…");

  await purge();

  const after = await countSnapshot();
  console.log("");
  console.log("Purge terminée.");
  console.log(`  Patients           : ${after.patients}`);
  console.log(`  Visites            : ${after.visits}`);
  console.log(`  Factures           : ${after.invoices}`);
  console.log(`  Dépenses clinique  : ${after.clinicExpenses}`);
  console.log(`  Clôtures réception : ${after.dayClosures}`);
  console.log(`  Règlements caisse  : ${after.settlements}`);
  console.log(`  Lignes vente pharma: ${after.pharmacyLines}`);
  console.log(`  Prescriptions      : ${after.prescriptions}`);
  console.log("");
  console.log("Catalogues, comptes, employés et quantités de stock : conservés.");
}

main()
  .catch((error) => {
    console.error("Erreur lors de la purge :", error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
