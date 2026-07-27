/**
 * Réinitialise les mots de passe des comptes actifs (sauf Root) vers un mot de passe temporaire.
 * Usage:
 *   npx tsx scripts/reset-staff-passwords.ts
 *   npx tsx scripts/reset-staff-passwords.ts --password "MonMotDePasseTemp"
 *   npx tsx scripts/reset-staff-passwords.ts --user HAMID
 */
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/db.js";

const args = process.argv.slice(2);
function argValue(flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

const TEMP_PASSWORD = argValue("--password") ?? "Alwatan2026!";
const onlyUser = argValue("--user");
const base = process.env.API_BASE ?? "http://127.0.0.1:4000/api";

if (TEMP_PASSWORD.length < 6) {
  console.error("Le mot de passe temporaire doit contenir au moins 6 caractères.");
  process.exit(1);
}

const users = await prisma.user.findMany({
  where: {
    active: true,
    username: { not: "Root" },
    ...(onlyUser
      ? { username: { equals: onlyUser, mode: "insensitive" as const } }
      : {}),
  },
  select: { id: true, username: true, role: true, firstName: true, lastName: true },
  orderBy: { username: "asc" },
});

if (!users.length) {
  console.log("Aucun compte à réinitialiser.");
  await prisma.$disconnect();
  process.exit(0);
}

const passwordHash = await bcrypt.hash(TEMP_PASSWORD, 10);

console.log(`Réinitialisation de ${users.length} compte(s) → mot de passe temporaire défini.`);
for (const u of users) {
  await prisma.user.update({ where: { id: u.id }, data: { passwordHash } });
  console.log(`  OK ${u.username.padEnd(28)} (${u.role}) ${u.firstName} ${u.lastName}`);
}

console.log("\nVérification API…");
let ok = 0;
for (const u of users) {
  const res = await fetch(`${base}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: u.username, password: TEMP_PASSWORD }),
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (res.status === 200) {
    ok += 1;
    console.log(`  LOGIN OK  ${u.username}`);
  } else {
    console.log(`  LOGIN FAIL ${u.username} -> ${res.status} ${body.error ?? ""}`);
  }
}

console.log(`\nRésultat : ${ok}/${users.length} connexions OK`);
console.log(`Mot de passe temporaire : ${TEMP_PASSWORD}`);
console.log("Demandez aux utilisateurs de le changer dans Mon compte après connexion.");

await prisma.$disconnect();
