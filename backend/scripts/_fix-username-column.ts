import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const indexes = await prisma.$queryRaw<{ indexname: string; indexdef: string }[]>`
    SELECT indexname, indexdef FROM pg_indexes
    WHERE tablename = 'User' AND indexname ILIKE '%username%'
  `;
  console.log("Username indexes:", indexes);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_username_key";
  `);
  await prisma.$executeRawUnsafe(`
    DROP INDEX IF EXISTS "User_username_key";
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "User" ADD COLUMN IF NOT EXISTS username TEXT;
  `);
  await prisma.$executeRawUnsafe(`
    UPDATE "User"
    SET username = split_part(email, '@', 1)
    WHERE username IS NULL OR username = '';
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "User" ALTER COLUMN username SET NOT NULL;
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "User" ADD CONSTRAINT "User_username_key" UNIQUE (username);
  `);

  const cols = await prisma.$queryRaw<{ column_name: string }[]>`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'User'
    ORDER BY ordinal_position
  `;
  console.log("User columns after fix:", cols.map((c) => c.column_name).join(", "));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
