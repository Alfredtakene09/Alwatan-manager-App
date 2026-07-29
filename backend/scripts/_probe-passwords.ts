import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/db.js";

const base = process.env.API_BASE ?? "http://127.0.0.1:4000/api";
const pwds = [
  "Clinique2026!",
  "root@Alwatan2026",
  "Alwatan@2026",
  "alwatan2026",
  "Hamid123",
  "hamid123",
  "Fatime123",
  "Ousman123",
  "12345678",
  "password123",
  "Alwatan",
  "alwatan",
];

const users = await prisma.user.findMany({
  where: { username: { not: "Root" } },
  select: { username: true, email: true, passwordHash: true, role: true, active: true },
});

console.log("=== Hash / mots de passe connus ===");
for (const u of users) {
  const hits: string[] = [];
  for (const p of pwds) {
    if (await bcrypt.compare(p, u.passwordHash)) hits.push(p);
  }
  const prefix = u.passwordHash?.slice(0, 4) ?? "null";
  console.log(
    `${u.username.padEnd(28)} active=${u.active} hash=${prefix}… matches=${hits.length ? hits.join("|") : "NONE"}`,
  );
}

console.log("\n=== Health + login Root ===");
const health = await fetch(`${base}/health`);
console.log("health", health.status, await health.text());

const login = await fetch(`${base}/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username: "fatime", password: "Clinique2026!" }),
});
console.log("fatime/Clinique2026!", login.status, await login.text());

const login2 = await fetch(`${base}/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username: "HAMID", password: "Clinique2026!" }),
});
console.log("HAMID/Clinique2026!", login2.status, await login2.text());

await prisma.$disconnect();
