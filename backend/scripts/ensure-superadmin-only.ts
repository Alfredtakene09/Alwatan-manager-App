/**
 * Crée le superadmin Root et retire tous les autres comptes de connexion.
 *
 * Usage :
 *   npm run db:superadmin-only
 */
import bcrypt from "bcryptjs";
import { DoctorCompensationType, UserRole } from "@prisma/client";
import { prisma } from "../src/lib/db.js";

const SUPERADMIN_USERNAME = "Root";
const SUPERADMIN_PASSWORD = "root@Alwatan2026";

async function main() {
  const passwordHash = await bcrypt.hash(SUPERADMIN_PASSWORD, 10);

  const existingUser = await prisma.user.findUnique({
    where: { username: SUPERADMIN_USERNAME },
    select: { id: true, employeeId: true },
  });

  let employeeId = existingUser?.employeeId ?? null;
  if (employeeId) {
    await prisma.employee.update({
      where: { id: employeeId },
      data: {
        firstName: "Root",
        lastName: "Superadmin",
        jobTitle: "Superadministrateur",
        isMedecin: false,
        active: true,
        doctorCompensationType: DoctorCompensationType.QUOTA,
      },
    });
  } else {
    const employee = await prisma.employee.create({
      data: {
        firstName: "Root",
        lastName: "Superadmin",
        jobTitle: "Superadministrateur",
        isMedecin: false,
        active: true,
        doctorCompensationType: DoctorCompensationType.QUOTA,
      },
    });
    employeeId = employee.id;
  }

  await prisma.user.upsert({
    where: { username: SUPERADMIN_USERNAME },
    update: {
      email: "root@alwatan.local",
      passwordHash,
      firstName: "Root",
      lastName: "Superadmin",
      role: UserRole.ADMIN,
      employeeId,
      active: true,
    },
    create: {
      username: SUPERADMIN_USERNAME,
      email: "root@alwatan.local",
      passwordHash,
      firstName: "Root",
      lastName: "Superadmin",
      role: UserRole.ADMIN,
      employeeId,
      active: true,
    },
  });

  const others = await prisma.user.findMany({
    where: { username: { not: SUPERADMIN_USERNAME } },
    select: { id: true, username: true },
  });

  let deleted = 0;
  let disabled = 0;
  for (const user of others) {
    try {
      await prisma.user.delete({ where: { id: user.id } });
      deleted += 1;
      console.log(`  Supprimé : ${user.username}`);
    } catch {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          active: false,
          username: `deleted_${user.id.slice(0, 10)}`,
          email: `deleted_${user.id.slice(0, 10)}@alwatan.local`,
          passwordHash: await bcrypt.hash(`disabled-${user.id}`, 10),
        },
      });
      disabled += 1;
      console.log(`  Désactivé (historique) : ${user.username}`);
    }
  }

  const active = await prisma.user.findMany({
    where: { active: true },
    select: { username: true, role: true },
    orderBy: { username: "asc" },
  });

  console.log("");
  console.log("Terminé.");
  console.log(`  Superadmin : ${SUPERADMIN_USERNAME} / ${SUPERADMIN_PASSWORD}`);
  console.log(`  Comptes retirés : ${deleted} supprimés, ${disabled} désactivés`);
  console.log(`  Comptes actifs restants : ${active.map((u) => u.username).join(", ") || "(aucun)"}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
