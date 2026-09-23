/**
 * `prisma db push` peut exécuter des DROP (colonnes/tables).
 * Ce wrapper désactive temporairement le verrou DDL, pousse le schéma, puis le réactive.
 *
 * Usage (depuis backend/) :
 *   npx tsx scripts/db-push-safe.ts
 */
import { spawnSync } from "node:child_process";
import { prismaRaw } from "../src/lib/db.js";
import { ensureDbDeleteGuard } from "../src/lib/db-delete-guard.js";

async function main() {
  console.log("Désactivation temporaire du verrou DROP…");
  try {
    await prismaRaw.$executeRawUnsafe(
      `ALTER EVENT TRIGGER alwatan_block_sql_drop DISABLE`,
    );
  } catch {
    // Trigger pas encore créé : ok
  }

  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(npmCmd, ["exec", "--", "prisma", "db", "push", ...process.argv.slice(2)], {
    stdio: "inherit",
    shell: true,
    env: process.env,
  });

  console.log("Réactivation du verrou anti-suppression…");
  try {
    await prismaRaw.$executeRawUnsafe(
      `ALTER EVENT TRIGGER alwatan_block_sql_drop ENABLE`,
    );
  } catch {
    /* ignore */
  }
  await ensureDbDeleteGuard(prismaRaw);

  await prismaRaw.$disconnect();
  process.exit(result.status ?? 1);
}

main().catch(async (err) => {
  console.error(err);
  try {
    await ensureDbDeleteGuard(prismaRaw);
  } catch {
    /* ignore */
  }
  await prismaRaw.$disconnect();
  process.exit(1);
});
