import bcrypt from "bcryptjs";
import { DoctorCompensationType, UserRole } from "@prisma/client";
import { prisma } from "../src/lib/db.js";
import { seedDemoData } from "./seed-demo-data.js";
import { seedReferenceData } from "./seed-reference.js";

const SUPERADMIN_USERNAME = "Root";
const SUPERADMIN_PASSWORD = "root@Alwatan2026";

async function ensureSuperadmin(passwordHash: string) {
  const existingUser = await prisma.user.findUnique({
    where: { username: SUPERADMIN_USERNAME },
    select: { id: true, employeeId: true },
  });

  let employeeId = existingUser?.employeeId;
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
        consultationTotalFcfa: null,
        consultationQuotaPercent: null,
        surgeryQuotaPercent: null,
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
}

/** Désactive / supprime tous les comptes sauf Root (historique FK conservé si nécessaire). */
async function removeOtherUsers() {
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
    }
  }

  return { deleted, disabled, total: others.length };
}

async function main() {
  const passwordHash = await bcrypt.hash(SUPERADMIN_PASSWORD, 10);

  await ensureSuperadmin(passwordHash);
  const removed = await removeOtherUsers();

  await seedReferenceData();

  if (process.env.SEED_DEMO_RESET === "1") {
    await seedDemoData();
  }

  console.log("Seed terminé.");
  console.log(`  Superadmin : ${SUPERADMIN_USERNAME} / ${SUPERADMIN_PASSWORD}`);
  console.log(
    `  Autres comptes : ${removed.total} traités (${removed.deleted} supprimés, ${removed.disabled} désactivés)`,
  );
  if (process.env.SEED_DEMO_RESET !== "1") {
    console.log("  Données démo non régénérées (SEED_DEMO_RESET=1 pour forcer).");
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
