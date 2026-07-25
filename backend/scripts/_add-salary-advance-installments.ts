import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "SalaryAdvance"
    ADD COLUMN IF NOT EXISTS "remainingFcfa" INTEGER;
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "SalaryAdvance"
    ADD COLUMN IF NOT EXISTS "installmentFcfa" INTEGER;
  `);
  await prisma.$executeRawUnsafe(`
    UPDATE "SalaryAdvance"
    SET "remainingFcfa" = CASE
      WHEN status = 'PENDING' THEN "amountFcfa"
      ELSE 0
    END
    WHERE "remainingFcfa" IS NULL;
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "SalaryAdvance"
    ALTER COLUMN "remainingFcfa" SET NOT NULL;
  `);
  console.log("SalaryAdvance.remainingFcfa / installmentFcfa ajoutés.");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
