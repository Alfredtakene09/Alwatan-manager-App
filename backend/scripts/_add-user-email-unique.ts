import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.$executeRawUnsafe(`
    DO $$ BEGIN
      ALTER TABLE "User" ADD CONSTRAINT "User_email_key" UNIQUE (email);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `);
  console.log("Contrainte unique email ajoutée.");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
