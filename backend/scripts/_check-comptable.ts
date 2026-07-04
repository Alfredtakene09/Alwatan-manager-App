import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({
    where: {
      OR: [
        { username: { contains: "direction", mode: "insensitive" } },
        { email: { contains: "direction", mode: "insensitive" } },
        { username: { contains: "comptable", mode: "insensitive" } },
        { role: "COMPTABLE" },
      ],
    },
    select: {
      id: true,
      username: true,
      email: true,
      role: true,
      active: true,
      passwordHash: true,
      firstName: true,
      lastName: true,
    },
  });

  console.log("Comptes trouvés:", users.length);
  for (const u of users) {
    const ok = await bcrypt.compare("Clinique2026!", u.passwordHash);
    console.log({
      username: u.username,
      email: u.email,
      role: u.role,
      active: u.active,
      name: `${u.firstName} ${u.lastName}`,
      passwordMatchesDemo: ok,
    });
  }

  const byUsername = await prisma.user.findUnique({ where: { username: "direction" } });
  console.log("findUnique username=direction:", byUsername ? "OK" : "ABSENT");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
