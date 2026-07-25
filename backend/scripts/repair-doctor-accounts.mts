/**
 * Répare les fiches médecins importées sans profil médecin / sans compte app.
 * Usage: npx tsx scripts/repair-doctor-accounts.mts
 */
import bcrypt from "bcryptjs";
import { UserRole } from "@prisma/client";
import { prisma } from "../src/lib/db.js";
import { inferIsMedecinFromJobTitle } from "../src/lib/doctor-profile.js";

const DEFAULT_PASSWORD = process.env.DOCTOR_BOOTSTRAP_PASSWORD || "Medecin@Alwatan2026";

function slugUsername(firstName: string, lastName: string) {
  const base = `${firstName}.${lastName}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 40);
  return base || "medecin";
}

async function uniqueUsername(firstName: string, lastName: string) {
  const base = slugUsername(firstName, lastName);
  let candidate = base;
  let i = 2;
  while (await prisma.user.findUnique({ where: { username: candidate } })) {
    candidate = `${base}${i}`;
    i += 1;
  }
  return candidate;
}

async function main() {
  const employees = await prisma.employee.findMany({
    where: { active: true },
    include: { user: { select: { id: true, role: true, active: true, username: true } } },
  });

  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);
  const flagged: string[] = [];
  const createdAccounts: { name: string; username: string }[] = [];

  for (const emp of employees) {
    const shouldBeDoctor = emp.isMedecin || inferIsMedecinFromJobTitle(emp.jobTitle);
    if (!shouldBeDoctor) continue;

    if (!emp.isMedecin) {
      await prisma.employee.update({
        where: { id: emp.id },
        data: { isMedecin: true },
      });
      flagged.push(`${emp.firstName} ${emp.lastName} (${emp.jobTitle})`);
    }

    if (emp.user) continue;

    const username = await uniqueUsername(emp.firstName, emp.lastName);
    const email = `${username}@alwatan.local`;
    await prisma.user.create({
      data: {
        username,
        email,
        passwordHash,
        firstName: emp.firstName,
        lastName: emp.lastName,
        role: UserRole.MEDECIN,
        employeeId: emp.id,
        active: true,
      },
    });
    createdAccounts.push({
      name: `${emp.firstName} ${emp.lastName}`,
      username,
    });
  }

  console.log(JSON.stringify({ flagged, createdAccounts, defaultPassword: DEFAULT_PASSWORD }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
