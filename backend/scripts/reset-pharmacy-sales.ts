/**
 * Annule / remet a zero les ventes pharmacie.
 *
 * - Supprime prescriptions, lignes, retours, factures PHARMACY, paiements lies
 * - Remet le stock (qte nette vendue − retournee) sauf si --no-restore-stock
 * - Conserve produits, categories, formes, fournisseurs
 *
 * Usage :
 *   npx tsx scripts/reset-pharmacy-sales.ts --dry-run
 *   npx tsx scripts/reset-pharmacy-sales.ts --confirm
 *   npx tsx scripts/reset-pharmacy-sales.ts --confirm --purge-all-clients
 *   PHARMACY_SALES_RESET_CONFIRM=1 npm run db:reset-pharmacy-sales
 *
 * Options :
 *   --dry-run              Affiche les compteurs / deltas stock, aucune ecriture
 *   --confirm              Execute la suppression
 *   --no-restore-stock     N'augmente pas Product.quantity (historique seulement)
 *   --purge-clients        Supprime les clients externes orphelins
 *   --purge-all-clients    DESACTIVE : trop dangereux (effacait aussi reception / patients).
 *                          Utilisez scripts/reset-operational-data.ts pour une RAZ complete.
 */
import { prisma } from "../src/lib/db.js";
import { runWithAppDataDeleteUnlock } from "../src/lib/db-delete-guard.js";

const dryRun = process.argv.includes("--dry-run");
const confirmed =
  process.env.PHARMACY_SALES_RESET_CONFIRM === "1" || process.argv.includes("--confirm");
const restoreStock = !process.argv.includes("--no-restore-stock");
const purgeClients = process.argv.includes("--purge-clients");
const purgeAllClientsRequested = process.argv.includes("--purge-all-clients");
const purgeAllClients = false;
if (purgeAllClientsRequested) {
  console.error("");
  console.error("  REFUSE : --purge-all-clients a ete desactive.");
  console.error("  Ce flag effacait aussi les patients / visites / factures reception.");
  console.error("  Pour une RAZ operationnelle complete : npm run db:reset-operational -- --confirm");
  console.error("  Pour annuler seulement les ventes pharmacie : npm run db:reset-pharmacy-sales -- --confirm");
  console.error("");
  process.exitCode = 1;
}

type StockDelta = { productId: string; name: string; sku: string; currentQty: number; restoreQty: number };

async function collectStockDeltas(): Promise<StockDelta[]> {
  const lines = await prisma.pharmacySaleLine.groupBy({
    by: ["productId"],
    _sum: { quantity: true },
  });
  const returns = await prisma.pharmacySaleReturn.groupBy({
    by: ["productId"],
    _sum: { quantity: true },
  });
  const returnedByProduct = new Map(
    returns.map((row) => [row.productId, row._sum.quantity ?? 0] as const),
  );

  const deltas: StockDelta[] = [];
  for (const row of lines) {
    const sold = row._sum.quantity ?? 0;
    const returned = returnedByProduct.get(row.productId) ?? 0;
    const restoreQty = Math.max(0, sold - returned);
    if (restoreQty <= 0) continue;
    const product = await prisma.product.findUnique({
      where: { id: row.productId },
      select: { id: true, name: true, sku: true, quantity: true },
    });
    if (!product) continue;
    deltas.push({
      productId: product.id,
      name: product.name,
      sku: product.sku,
      currentQty: product.quantity,
      restoreQty,
    });
  }
  return deltas.sort((a, b) => a.name.localeCompare(b.name, "fr"));
}

async function countPharmacySales() {
  const pharmacyInvoiceIds = (
    await prisma.invoice.findMany({
      where: { type: "PHARMACY" },
      select: { id: true },
    })
  ).map((row) => row.id);

  const [
    prescriptions,
    saleLines,
    saleReturns,
    pharmacyInvoices,
    pharmacyPayments,
    settlementLinks,
    stockMovementsLinked,
    externalClients,
    orphanClients,
    patients,
    visits,
    allInvoices,
  ] = await Promise.all([
    prisma.prescription.count(),
    prisma.pharmacySaleLine.count(),
    prisma.pharmacySaleReturn.count(),
    prisma.invoice.count({ where: { type: "PHARMACY" } }),
    pharmacyInvoiceIds.length
      ? prisma.invoicePayment.count({ where: { invoiceId: { in: pharmacyInvoiceIds } } })
      : Promise.resolve(0),
    pharmacyInvoiceIds.length
      ? prisma.receptionCashSettlementLine.count({
          where: { invoiceId: { in: pharmacyInvoiceIds } },
        })
      : Promise.resolve(0),
    prisma.stockMovement.count({ where: { prescriptionId: { not: null } } }),
    prisma.pharmacyExternalClient.count(),
    prisma.pharmacyExternalClient.count({
      where: { prescriptions: { none: {} }, invoices: { none: {} } },
    }),
    prisma.patient.count(),
    prisma.visit.count(),
    prisma.invoice.count(),
  ]);

  return {
    prescriptions,
    saleLines,
    saleReturns,
    pharmacyInvoices,
    pharmacyPayments,
    settlementLinks,
    stockMovementsLinked,
    externalClients,
    orphanClients,
    patients,
    visits,
    allInvoices,
    pharmacyInvoiceIds,
  };
}

async function resetPharmacySales(pharmacyInvoiceIds: string[], deltas: StockDelta[]) {
  await prisma.$transaction(
    async (tx) => {
      if (purgeAllClients) {
        // Caisse / clôtures (factures patients + pharmacie)
        await tx.receptionDayClosure.updateMany({ data: { settlementId: null } });
        await tx.receptionCashSettlementLine.deleteMany();
        await tx.receptionCashSettlement.deleteMany();
        await tx.receptionDayClosure.deleteMany();
        await tx.cashChangeTransfer.deleteMany();
        await tx.doctorShareClaim.deleteMany();
      } else if (pharmacyInvoiceIds.length) {
        await tx.receptionCashSettlementLine.deleteMany({
          where: { invoiceId: { in: pharmacyInvoiceIds } },
        });
        await tx.invoicePayment.deleteMany({
          where: { invoiceId: { in: pharmacyInvoiceIds } },
        });
        await tx.doctorShareClaim.deleteMany({
          where: { invoiceId: { in: pharmacyInvoiceIds } },
        });
      }

      if (restoreStock) {
        for (const delta of deltas) {
          await tx.product.update({
            where: { id: delta.productId },
            data: { quantity: { increment: delta.restoreQty } },
          });
        }
      }

      await tx.pharmacySaleReturn.deleteMany();
      await tx.pharmacySaleLine.deleteMany();
      await tx.stockMovement.deleteMany({ where: { prescriptionId: { not: null } } });
      await tx.prescription.deleteMany();

      if (purgeAllClients) {
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
        await tx.pharmacyExternalClient.deleteMany();
      } else {
        if (pharmacyInvoiceIds.length) {
          await tx.invoice.deleteMany({ where: { id: { in: pharmacyInvoiceIds } } });
        }
        if (purgeClients) {
          await tx.pharmacyExternalClient.deleteMany({
            where: { prescriptions: { none: {} }, invoices: { none: {} } },
          });
        }
      }
    },
    { timeout: 300_000 },
  );
}

async function main() {
  const before = await countPharmacySales();
  const deltas = restoreStock ? await collectStockDeltas() : [];
  const unitsToRestore = deltas.reduce((sum, row) => sum + row.restoreQty, 0);

  console.log("");
  console.log("  Clinique Alwatan — Annulation / remise a zero des ventes pharmacie");
  console.log("");
  console.log("  A supprimer :");
  console.log(`    prescriptions          : ${before.prescriptions}`);
  console.log(`    lignes de vente        : ${before.saleLines}`);
  console.log(`    retours                : ${before.saleReturns}`);
  console.log(`    factures PHARMACY      : ${before.pharmacyInvoices}`);
  console.log(`    paiements lies         : ${before.pharmacyPayments}`);
  console.log(`    liens caisse reception : ${before.settlementLinks}`);
  console.log(`    mouvements stock lies  : ${before.stockMovementsLinked}`);
  if (purgeAllClients) {
    console.log(`    patients (internes)    : ${before.patients}`);
    console.log(`    visites                : ${before.visits}`);
    console.log(`    toutes factures        : ${before.allInvoices}`);
    console.log(`    clients externes       : ${before.externalClients}`);
  }
  console.log("");
  console.log("  Conserve :");
  console.log("    produits, categories, formes, fournisseurs, utilisateurs");
  if (!purgeAllClients) {
    console.log(
      purgeClients
        ? `    (clients externes orphelins a purger : ${before.orphanClients})`
        : `    clients externes (${before.externalClients}) / patients (${before.patients})`,
    );
  }
  console.log("");

  if (restoreStock) {
    console.log(`  Stock a restaurer : ${unitsToRestore} unite(s) sur ${deltas.length} produit(s)`);
    for (const row of deltas.slice(0, 25)) {
      console.log(
        `    ${row.sku}  ${row.name}  ${row.currentQty} → ${row.currentQty + row.restoreQty}  (+${row.restoreQty})`,
      );
    }
    if (deltas.length > 25) {
      console.log(`    … et ${deltas.length - 25} autre(s) produit(s)`);
    }
  } else {
    console.log("  Stock : NON restaure (--no-restore-stock)");
  }
  console.log("");

  if (dryRun) {
    console.log("  Mode --dry-run : aucune modification.");
    console.log("");
    return;
  }

  if (!confirmed) {
    console.error("Annulation refusee — confirmation requise.");
    console.error("");
    console.error("  Simulation :  npm run db:reset-pharmacy-sales -- --dry-run");
    console.error("  Execution  :  npm run db:reset-pharmacy-sales -- --confirm");
    console.error("  + clients  :  npm run db:reset-pharmacy-sales -- --confirm --purge-all-clients");
    console.error("");
    process.exitCode = 1;
    return;
  }

  const nothingToDo =
    before.prescriptions === 0 &&
    before.saleLines === 0 &&
    before.pharmacyInvoices === 0 &&
    before.stockMovementsLinked === 0 &&
    (!purgeAllClients || (before.patients === 0 && before.externalClients === 0));

  if (nothingToDo) {
    console.log("Rien a supprimer — deja a zero.");
    console.log("");
    return;
  }

  console.log("Execution en cours…");
  await runWithAppDataDeleteUnlock("script", async () => {
    await resetPharmacySales(before.pharmacyInvoiceIds, deltas);
  });
  const after = await countPharmacySales();

  console.log("");
  console.log("  Termine.");
  console.log(`    prescriptions restantes : ${after.prescriptions}`);
  console.log(`    lignes restantes        : ${after.saleLines}`);
  console.log(`    factures PHARMACY       : ${after.pharmacyInvoices}`);
  console.log(`    patients restants       : ${after.patients}`);
  console.log(`    clients externes        : ${after.externalClients}`);
  if (restoreStock) {
    console.log(`    unites remises en stock : ${unitsToRestore}`);
  }
  console.log("");
}

main()
  .catch((error) => {
    console.error("Echec reset ventes pharmacie :", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
