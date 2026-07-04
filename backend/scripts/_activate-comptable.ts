import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.update({
    where: { username: "direction" },
    data: { active: true, email: "direction@alwatan.local" },
    select: { username: true, email: true, active: true, role: true },
  });
  console.log("Compte réactivé:", user);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
