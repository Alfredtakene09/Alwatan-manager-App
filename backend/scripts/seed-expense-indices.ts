/**
 * Ajoute / met à jour les indices (motifs) du module Dépenses, entrées et sorties.
 *
 *   npx tsx scripts/seed-expense-indices.ts
 *   npm run db:seed-expense-indices
 *
 * Idempotent : upsert sur le nom, aucune dépense existante n'est modifiée.
 */
import { prisma } from "../src/lib/db.js";
import { DEFAULT_EXPENSE_INDICES } from "../src/lib/expense-indices-seed.js";

async function main() {
  const all = DEFAULT_EXPENSE_INDICES;
  for (const [index, item] of all.entries()) {
    await prisma.clinicExpenseIndice.upsert({
      where: { name: item.name },
      update: { description: item.description, flow: item.flow, sortOrder: index, active: true },
      create: {
        name: item.name,
        description: item.description,
        flow: item.flow,
        sortOrder: index,
        active: true,
      },
    });
  }
  const total = await prisma.clinicExpenseIndice.count();
  console.log(`${all.length} indices synchronisés (${total} au total en base).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
