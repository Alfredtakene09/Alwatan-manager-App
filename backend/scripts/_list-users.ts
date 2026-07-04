import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({
    select: { email: true, username: true, firstName: true, lastName: true },
    orderBy: { email: "asc" },
  });
  console.table(users);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
