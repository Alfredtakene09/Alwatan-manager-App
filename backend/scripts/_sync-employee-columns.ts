import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const statements = [
  `ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "fixedSalaryFcfa" INTEGER`,
  `ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "birthDate" DATE`,
  `ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS address TEXT`,
  `ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS service TEXT`,
  `ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "hiredAt" DATE`,
  `ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "bonusFcfa" INTEGER`,
  `ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "photoPath" TEXT`,
  `UPDATE "User" SET username = split_part(email, '@', 1) WHERE username IS NULL OR username = ''`,
];

async function main() {
  for (const sql of statements) {
    await prisma.$executeRawUnsafe(sql);
    console.log("OK:", sql.slice(0, 60) + "...");
  }
  console.log("Migration terminée.");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
