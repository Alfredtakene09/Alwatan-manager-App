import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.$executeRawUnsafe(`
    DO $$ BEGIN
      CREATE TYPE "EmployeeContractStatus" AS ENUM ('ACTIF', 'EN_CONGE', 'INACTIF');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `);
  await prisma.$executeRawUnsafe(`
    DO $$ BEGIN
      CREATE TYPE "ContractType" AS ENUM ('CDI', 'CDD', 'PRESTATION', 'AUTRE');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "contractType" "ContractType";
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "contractStatus" "EmployeeContractStatus" NOT NULL DEFAULT 'ACTIF';
  `);
  console.log("contractType / contractStatus ajoutés.");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
