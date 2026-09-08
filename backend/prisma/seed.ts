import bcrypt from "bcryptjs";
import { DoctorCompensationType, UserRole } from "@prisma/client";
import { prisma } from "../src/lib/db.js";
import { seedDemoData } from "./seed-demo-data.js";
import { DEFAULT_STAFF_USERNAMES, seedReferenceData } from "./seed-reference.js";

const SUPERADMIN_USERNAME = "Root";
const SUPERADMIN_PASSWORD = "root@Alwatan2026";
/** Mot de passe partagé des comptes métier par défaut (gestionnaire, pharmacie). */
const DEFAULT_STAFF_PASSWORD = "Clinique2026!";

type StaffSeed = {
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  jobTitle: string;
  fixedSalaryFcfa?: number | null;
};

const DEFAULT_STAFF: StaffSeed[] = [
  {
    username: "gestionnaire",
    email: "gestionnaire@alwatan.local",
    firstName: "Mahamat",
    lastName: "Hassan",
    role: UserRole.GESTIONNAIRE,
    jobTitle: "Gestionnaire financier",
    fixedSalaryFcfa: 350000,
  },
  {
    username: "pharmacie",
    email: "pharmacie@alwatan.local",
    firstName: "Saleh",
    lastName: "Youssouf",
    role: UserRole.PHARMACIEN,
    jobTitle: "Pharmacien",
  },
];

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

async function upsertStaffMember(row: StaffSeed, passwordHash: string) {
  const existingUser = await prisma.user.findUnique({
    where: { username: row.username },
    select: { id: true, employeeId: true },
  });

  let employeeId = existingUser?.employeeId;
  if (employeeId) {
    await prisma.employee.update({
      where: { id: employeeId },
      data: {
        firstName: row.firstName,
        lastName: row.lastName,
        jobTitle: row.jobTitle,
        isMedecin: false,
        fixedSalaryFcfa: row.fixedSalaryFcfa ?? undefined,
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
        firstName: row.firstName,
        lastName: row.lastName,
        jobTitle: row.jobTitle,
        isMedecin: false,
        fixedSalaryFcfa: row.fixedSalaryFcfa ?? undefined,
        active: true,
        doctorCompensationType: DoctorCompensationType.QUOTA,
      },
    });
    employeeId = employee.id;
  }

  await prisma.user.upsert({
    where: { username: row.username },
    update: {
      email: row.email,
      passwordHash,
      firstName: row.firstName,
      lastName: row.lastName,
      role: row.role,
      employeeId,
      active: true,
    },
    create: {
      username: row.username,
      email: row.email,
      passwordHash,
      firstName: row.firstName,
      lastName: row.lastName,
      role: row.role,
      employeeId,
      active: true,
    },
  });
}

/** Désactive / supprime les comptes hors liste par défaut (historique FK conservé si nécessaire). */
async function removeOtherUsers() {
  const keep = [...DEFAULT_STAFF_USERNAMES];
  const others = await prisma.user.findMany({
    where: { username: { notIn: keep } },
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
  const rootHash = await bcrypt.hash(SUPERADMIN_PASSWORD, 10);
  const staffHash = await bcrypt.hash(DEFAULT_STAFF_PASSWORD, 10);

  await ensureSuperadmin(rootHash);
  for (const member of DEFAULT_STAFF) {
    await upsertStaffMember(member, staffHash);
  }
  const shouldPruneUsers = process.env.SEED_PRUNE_USERS === "1";
  const removed = shouldPruneUsers ? await removeOtherUsers() : null;

  await seedReferenceData();

  if (process.env.SEED_DEMO_RESET === "1") {
    await seedDemoData();
  }

  console.log("Seed terminé.");
  console.log(`  Superadmin : ${SUPERADMIN_USERNAME} (mot de passe d'installation — à changer en production)`);
  for (const member of DEFAULT_STAFF) {
    console.log(`  ${member.role} : ${member.username}`);
  }
  if (removed) {
    console.log(
      `  Autres comptes : ${removed.total} traités (${removed.deleted} supprimés, ${removed.disabled} désactivés)`,
    );
  } else {
    console.log("  Autres comptes : conservés (SEED_PRUNE_USERS=1 pour nettoyer).");
  }
  if (process.env.SEED_DEMO_RESET !== "1") {
    console.log("  Données démo non régénérées (SEED_DEMO_RESET=1 pour forcer).");
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
