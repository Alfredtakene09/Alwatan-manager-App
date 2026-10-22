/**
 * Ajoute des dépenses (sorties) et entrées de caisse d'exemple, liées aux indices.
 *
 *   npm run db:seed-expenses
 *
 * Prérequis : npm run db:seed-expense-indices. Idempotent (marqueur dans le commentaire).
 */
import { ClinicExpenseStatus, PaymentMethod, UserRole } from "@prisma/client";
import { prisma } from "../src/lib/db.js";
import { categoryFromIndiceName } from "../src/lib/expense-flow.js";

const MARKER = "[seed-depenses]";

/** [jours avant aujourd'hui, indice, libellé, montant FCFA] */
const ROWS: Array<[number, string, string, number]> = [
  [0, "Approvisionnement caisse", "Fonds de caisse du jour", 100000],
  [0, "Transport", "Course taxi - dépôt analyses", 3500],
  [0, "Restauration", "Collation du personnel", 6000],
  [1, "Entretien", "Produits de nettoyage", 12500],
  [1, "Fournitures médicales", "Gants et compresses", 18000],
  [2, "Maintenance", "Réparation climatiseur", 25000],
  [2, "Remboursement reçu", "Remboursement avance fournisseur", 15000],
  [3, "Carburant générateur", "Carburant groupe électrogène", 20000],
  [3, "Achat urgent", "Médicament en urgence", 8500],
  [4, "Électricité / Eau", "Facture d'eau", 14000],
  [5, "Apport de la direction", "Apport pour petites dépenses", 50000],
  [5, "Frais divers", "Photocopies et papeterie", 4000],
  [6, "Avance sur salaire", "Avance employé", 30000],
  [6, "Autre entrée", "Entrée exceptionnelle", 10000],
];

async function main() {
  const user =
    (await prisma.user.findFirst({ where: { role: UserRole.ADMIN, active: true } })) ??
    (await prisma.user.findFirst());
  if (!user) throw new Error("Aucun utilisateur en base.");

  const indices = await prisma.clinicExpenseIndice.findMany();
  const byName = new Map(indices.map((i) => [i.name, i]));
  const now = new Date();
  let created = 0;

  for (const [daysAgo, indiceName, label, amountFcfa] of ROWS) {
    const indice = byName.get(indiceName);
    if (!indice) {
      console.warn(`Indice introuvable : ${indiceName} (lancez db:seed-expense-indices)`);
      continue;
    }
    const businessDate = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo));
    const exists = await prisma.clinicExpense.findFirst({
      where: { label, businessDate, indiceId: indice.id, comment: { contains: MARKER } },
    });
    if (exists) continue;
    await prisma.clinicExpense.create({
      data: {
        businessDate,
        amountFcfa,
        label,
        flow: indice.flow,
        category: categoryFromIndiceName(indice.name),
        indiceId: indice.id,
        status: ClinicExpenseStatus.VALIDATED,
        comment: MARKER,
        paymentMethod: PaymentMethod.ESPECES,
        paidById: user.id,
        recordedById: user.id,
        validatedById: user.id,
        validatedAt: new Date(),
      },
    });
    created++;
  }
  console.log(`${created} mouvements ajoutés (utilisateur : ${user.id}).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
