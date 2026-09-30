/**
 * Renseigne Visit.createdById pour les visites antérieures au champ :
 * réceptionniste ayant émis la facture de consultation, sinon créateur du dossier patient.
 *
 * Usage (depuis backend/) : npx tsx scripts/backfill-visit-created-by.ts
 */
import { InvoiceType } from "@prisma/client";
import { prisma } from "../src/lib/db.js";

async function main() {
  const visits = await prisma.visit.findMany({
    where: { createdById: null },
    select: {
      id: true,
      patient: { select: { createdById: true } },
      invoices: {
        where: { type: InvoiceType.CONSULTATION, issuedBy: { role: "RECEPTIONNISTE" } },
        select: { issuedById: true },
        orderBy: { createdAt: "asc" },
        take: 1,
      },
    },
  });

  let updated = 0;
  for (const visit of visits) {
    const createdById = visit.invoices[0]?.issuedById ?? visit.patient.createdById;
    if (!createdById) continue;
    await prisma.visit.update({ where: { id: visit.id }, data: { createdById } });
    updated += 1;
  }
  console.log(`${updated} / ${visits.length} visite(s) mises à jour.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
