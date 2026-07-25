/**
 * Migration proposée — champs médecin (spécialité + disponibilités).
 * À exécuter après déploiement du schéma : npx tsx scripts/_migrate-doctor-fields.ts
 * Ne modifie pas les données métier existantes (ADD COLUMN IF NOT EXISTS uniquement).
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const statements = [
  `ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS specialty TEXT`,
  `ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "availabilitySlots" JSONB`,
];

async function main() {
  for (const sql of statements) {
    await prisma.$executeRawUnsafe(sql);
    console.log("OK:", sql);
  }
  console.log("Migration médecin terminée.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
