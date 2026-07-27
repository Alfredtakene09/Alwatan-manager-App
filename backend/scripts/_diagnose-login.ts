import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/db.js";

const base = process.env.API_BASE ?? "http://127.0.0.1:4000/api";

const users = await prisma.user.findMany({
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
  orderBy: { username: "asc" },
});

console.log("=== Comptes en base ===");
for (const u of users) {
  console.log(
    `${u.active ? "ON " : "OFF"} ${u.role.padEnd(12)} ${u.username.padEnd(28)} ${u.email}`,
  );
}

async function apiLogin(username: string, password: string) {
  const res = await fetch(`${base}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: string; user?: { role: string } };
  return { status: res.status, json };
}

console.log("\n=== Test API casse ===");
for (const login of ["Root", "root", "ROOT"]) {
  const r = await apiLogin(login, "root@Alwatan2026");
  console.log(`login=${login.padEnd(6)} -> ${r.status} ${r.json.error ?? r.json.user?.role}`);
}

// Essayer quelques mots de passe courants / username comme mdp
const candidates = [
  "123456",
  "password",
  "Password1",
  "alwatan",
  "Alwatan",
  "Alwatan2026",
  "admin",
  "Admin123",
];

console.log("\n=== Test mots de passe courants sur comptes non-Root ===");
const others = users.filter((u) => u.username !== "Root" && u.active);
for (const u of others) {
  const tries = [
    ...candidates,
    u.username,
    u.username.toLowerCase(),
    `${u.username}123`,
    `${u.firstName}`,
  ];
  let found: string | null = null;
  for (const pwd of tries) {
    if (await bcrypt.compare(pwd, u.passwordHash)) {
      found = pwd;
      break;
    }
  }
  // aussi via API avec username exact
  const api = found
    ? await apiLogin(u.username, found)
    : await apiLogin(u.username.toLowerCase(), "x");
  console.log(
    `${u.username.padEnd(28)} hashMatch=${found ? `"${found}"` : "AUCUN"} api=${api.status} ${api.json.error ?? ""}`,
  );
}

await prisma.$disconnect();
