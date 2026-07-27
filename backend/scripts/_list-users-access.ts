import { prisma } from "../src/lib/db.js";

const users = await prisma.user.findMany({
  select: {
    username: true,
    role: true,
    active: true,
    email: true,
    firstName: true,
    lastName: true,
    passwordHash: true,
    employee: { select: { active: true } },
  },
  orderBy: [{ active: "desc" }, { role: "asc" }, { username: "asc" }],
});

for (const u of users) {
  const hashOk = Boolean(u.passwordHash && u.passwordHash.length > 20);
  console.log(
    [
      u.active ? "ACTIVE  " : "INACTIVE",
      u.role.padEnd(14),
      u.username.padEnd(28),
      `emp=${u.employee?.active ? "ok " : "OFF"}`,
      `hash=${hashOk ? "ok" : "BAD"}`,
      `${u.firstName} ${u.lastName}`,
    ].join(" | "),
  );
}
console.log(
  "TOTAL",
  users.length,
  "inactive",
  users.filter((u) => !u.active).length,
);
await prisma.$disconnect();
