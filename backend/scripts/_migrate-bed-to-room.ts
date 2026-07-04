import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function columnExists(table: string, column: string) {
  const rows = await prisma.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ${table}
        AND column_name = ${column}
    ) AS exists
  `;
  return Boolean(rows[0]?.exists);
}

async function main() {
  const hasBedId = await columnExists("Hospitalization", "bedId");
  const hasRoomId = await columnExists("Hospitalization", "roomId");

  if (!hasBedId && hasRoomId) {
    console.log("Migration déjà appliquée (roomId présent, bedId absent).");
    return;
  }

  console.log("Migration Hospitalization.bedId → roomId…");

  if (!hasRoomId) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Hospitalization" ADD COLUMN "roomId" TEXT`);
    console.log("Colonne roomId ajoutée");
  }

  if (hasBedId) {
    await prisma.$executeRawUnsafe(`
      UPDATE "Hospitalization" h
      SET "roomId" = b."roomId"
      FROM "Bed" b
      WHERE h."bedId" = b.id
        AND h."roomId" IS NULL
    `);
    console.log("roomId renseigné depuis Bed");

    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Hospitalization" DROP CONSTRAINT IF EXISTS "Hospitalization_bedId_fkey"
    `);
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Hospitalization" DROP COLUMN IF EXISTS "bedId"
    `);
    console.log("Colonne bedId supprimée");
  }

  await prisma.$executeRawUnsafe(`
    ALTER TABLE "Hospitalization" DROP CONSTRAINT IF EXISTS "Hospitalization_roomId_fkey"
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "Hospitalization"
    ADD CONSTRAINT "Hospitalization_roomId_fkey"
    FOREIGN KEY ("roomId") REFERENCES "Room"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
  `);
  console.log("FK roomId → Room créée");

  // Vérification Prisma
  const rooms = await prisma.room.findMany({ orderBy: { name: "asc" } });
  const hospitalizations = await prisma.hospitalization.findMany({
    include: {
      visit: { include: { patient: true } },
      room: true,
    },
  });
  console.log(`OK — ${rooms.length} salles, ${hospitalizations.length} hospitalisations`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
