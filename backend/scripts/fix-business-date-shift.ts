/**
 * Répare les dates métier (colonnes SQL date) enregistrées la veille (J-1)
 * avant la correction du fuseau horaire : minuit local était envoyé à Prisma,
 * qui le tronquait en date UTC du jour précédent.
 *
 * Sans argument : simulation (affiche ce qui serait corrigé).
 * Avec --apply : applique les corrections, une seule fois (marqueur dans AuditLog).
 *
 *   npx tsx scripts/fix-business-date-shift.ts
 *   npx tsx scripts/fix-business-date-shift.ts --apply
 */
import { prisma } from "../src/lib/db.js";
import { toBusinessDateBound } from "../src/lib/cash-shift.js";

const APPLY = process.argv.includes("--apply");
const MARKER_ENTITY = "BusinessDateShiftFix";
const DAY_MS = 24 * 60 * 60 * 1000;

type Fix = { table: string; id: string; from: Date; to: Date };

const iso = (d: Date) => d.toISOString().slice(0, 10);
const isOneDayBefore = (stored: Date, expected: Date) =>
  expected.getTime() - stored.getTime() === DAY_MS;

async function pharmacyClosureFixes(): Promise<Fix[]> {
  // La clôture porte toujours sur le jour où elle a été faite.
  const rows = await prisma.pharmacyDayClosure.findMany({
    select: { id: true, businessDate: true, createdAt: true },
  });
  return rows
    .map((row) => ({ row, expected: toBusinessDateBound(row.createdAt) }))
    .filter(({ row, expected }) => isOneDayBefore(row.businessDate, expected))
    .map(({ row, expected }) => ({ table: "pharmacyDayClosure", id: row.id, from: row.businessDate, to: expected }));
}

async function overtimeFixes(): Promise<Fix[]> {
  // Seule voie d'écriture : la route heures sup, qui enregistrait toujours J-1.
  const rows = await prisma.doctorOvertimeEntry.findMany({
    select: { id: true, businessDate: true },
  });
  return rows.map((row) => ({
    table: "doctorOvertimeEntry",
    id: row.id,
    from: row.businessDate,
    to: new Date(row.businessDate.getTime() + DAY_MS),
  }));
}

async function shareClaimFixes(): Promise<Fix[]> {
  const rows = await prisma.doctorShareClaim.findMany({
    select: {
      id: true,
      businessDate: true,
      invoice: { select: { paidAt: true, createdAt: true } },
      surgeryCase: {
        select: { completedAt: true, invoice: { select: { paidAt: true, createdAt: true } } },
      },
    },
  });
  const fixes: Fix[] = [];
  for (const row of rows) {
    const candidates = [
      row.invoice?.paidAt,
      row.invoice?.createdAt,
      row.surgeryCase?.completedAt,
      row.surgeryCase?.invoice?.paidAt,
      row.surgeryCase?.invoice?.createdAt,
    ].filter((d): d is Date => !!d);
    const days = candidates.map((d) => toBusinessDateBound(d));
    // Si une date source correspond déjà exactement, la ligne est juste.
    if (days.some((d) => d.getTime() === row.businessDate.getTime())) continue;
    const expected = days.find((d) => isOneDayBefore(row.businessDate, d));
    if (!expected) continue;
    fixes.push({ table: "doctorShareClaim", id: row.id, from: row.businessDate, to: expected });
  }
  return fixes;
}

async function applyFix(fix: Fix) {
  const data = { businessDate: fix.to };
  switch (fix.table) {
    case "pharmacyDayClosure":
      return prisma.pharmacyDayClosure.update({ where: { id: fix.id }, data });
    case "doctorOvertimeEntry":
      return prisma.doctorOvertimeEntry.update({ where: { id: fix.id }, data });
    case "doctorShareClaim":
      return prisma.doctorShareClaim.update({ where: { id: fix.id }, data });
  }
}

const already = await prisma.auditLog.findFirst({ where: { entity: MARKER_ENTITY } });
if (already) {
  console.log(`Correction déjà appliquée le ${already.createdAt.toLocaleString("fr-FR")} — rien à faire.`);
  await prisma.$disconnect();
  process.exit(0);
}

const fixes = [
  ...(await pharmacyClosureFixes()),
  ...(await overtimeFixes()),
  ...(await shareClaimFixes()),
];

// Les plus récentes d'abord, pour éviter les collisions de clés uniques (J → J+1).
fixes.sort((a, b) => b.from.getTime() - a.from.getTime());

for (const fix of fixes) {
  console.log(`${fix.table} ${fix.id} : ${iso(fix.from)} → ${iso(fix.to)}`);
}
console.log(`${fixes.length} ligne(s) à corriger.`);

if (!APPLY) {
  console.log("Simulation uniquement. Relancer avec --apply pour corriger.");
} else {
  let done = 0;
  for (const fix of fixes) {
    try {
      await applyFix(fix);
      done++;
    } catch (error) {
      console.warn(`Ignoré ${fix.table} ${fix.id} :`, (error as Error).message);
    }
  }
  await prisma.auditLog.create({
    data: { action: "FIX", entity: MARKER_ENTITY, metadata: { corrected: done, total: fixes.length } },
  });
  console.log(`${done}/${fixes.length} ligne(s) corrigée(s).`);
}

await prisma.$disconnect();
