import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const cols = await prisma.$queryRaw<{ column_name: string }[]>`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Employee'
    ORDER BY ordinal_position
  `;
  console.log("Employee columns:", cols.map((c) => c.column_name).join(", "));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
