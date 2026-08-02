/**
 * Restaure les comptes utilisateurs désactivés/renommés et crée les comptes manquants.
 *
 * Couvre 2 cas :
 * 1) comptes "deleted_<id>" (désactivés) -> renommés proprement et réactivés
 * 2) employés actifs sans compte user -> création d'un compte
 *
 * Usage :
 *   npx tsx scripts/restore-users.ts
 */
import bcrypt from "bcryptjs";
import { UserRole } from "@prisma/client";
import { prisma } from "../src/lib/db.js";

const DEFAULT_PASSWORD = "Clinique2026!";

function slugify(input: string) {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function usernameFromNames(firstName: string, lastName: string) {
  const first = slugify(firstName).split("-")[0] || "user";
  const last = slugify(lastName) || "compte";
  return `${first}.${last}`.slice(0, 30);
}

function usernameFromEmployee(emp: { firstName: string; lastName: string; id: string }) {
  return usernameFromNames(emp.firstName, emp.lastName) || `user.${emp.id.slice(0, 8)}`;
}

function roleFromEmployee(emp: { isMedecin: boolean; clinicService?: { name: string } | null }): UserRole {
  if (emp.isMedecin) return UserRole.MEDECIN;
  const svc = (emp.clinicService?.name || "").toLowerCase();
  if (svc.includes("pharm")) return UserRole.PHARMACIEN;
  if (svc.includes("labo")) return UserRole.LABORANTIN;
  return UserRole.RECEPTIONNISTE;
}

async function buildUniqueUsername(base: string) {
  let candidate = base || "utilisateur";
  let index = 1;
  while (true) {
    const exists = await prisma.user.findUnique({ where: { username: candidate }, select: { id: true } });
    if (!exists) return candidate;
    index += 1;
    candidate = `${base}-${index}`.slice(0, 30);
  }
}

async function buildUniqueEmail(username: string) {
  let candidate = `${username}@alwatan.local`;
  let index = 1;
  while (true) {
    const exists = await prisma.user.findUnique({ where: { email: candidate }, select: { id: true } });
    if (!exists) return candidate;
    index += 1;
    candidate = `${username}-${index}@alwatan.local`;
  }
}

async function restoreDeletedUsers(passwordHash: string) {
  const deletedUsers = await prisma.user.findMany({
    where: {
      username: { startsWith: "deleted_" },
      active: false,
    },
    select: {
      id: true,
      employeeId: true,
      role: true,
      firstName: true,
      lastName: true,
      employee: { select: { firstName: true, lastName: true } },
    },
    orderBy: { updatedAt: "asc" },
  });

  let restored = 0;
  for (const user of deletedUsers) {
    const first = user.employee?.firstName || user.firstName || "User";
    const last = user.employee?.lastName || user.lastName || user.id.slice(0, 6);
    const baseUsername = usernameFromNames(first, last);
    const username = await buildUniqueUsername(baseUsername);
    const email = await buildUniqueEmail(username);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        username,
        email,
        firstName: first,
        lastName: last,
        active: true,
        passwordHash,
      },
    });
    restored += 1;
  }

  return restored;
}

async function createMissingUsers(passwordHash: string) {
  const employeesWithoutUser = await prisma.employee.findMany({
    where: { active: true, user: null },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      isMedecin: true,
      clinicService: { select: { name: true } },
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });

  let created = 0;
  for (const employee of employeesWithoutUser) {
    const baseUsername = usernameFromEmployee(employee);
    const username = await buildUniqueUsername(baseUsername);
    const email = await buildUniqueEmail(username);
    const role = roleFromEmployee(employee);

    await prisma.user.create({
      data: {
        username,
        email,
        passwordHash,
        firstName: employee.firstName,
        lastName: employee.lastName,
        role,
        active: true,
        employeeId: employee.id,
      },
    });
    created += 1;
  }
  return created;
}

async function main() {
  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);
  const restored = await restoreDeletedUsers(passwordHash);
  const created = await createMissingUsers(passwordHash);

  console.log("Restauration terminée.");
  console.log(`  Comptes réactivés (deleted_*): ${restored}`);
  console.log(`  Comptes créés (employés sans user): ${created}`);
  console.log(`  Mot de passe par défaut: ${DEFAULT_PASSWORD}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
