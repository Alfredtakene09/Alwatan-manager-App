/**
 * Seed des lits (Bed) pour les salles existantes qui n'en ont aucun.
 *
 * Règle par défaut :
 * - VIP    → 1 lit « L1 »
 * - SIMPLE → 2 lits « L1 », « L2 »
 *
 * Usage (depuis backend/) :
 *   npx tsx scripts/_migrate-beds-seed.ts
 *
 * Idempotent : ne crée rien si la salle a déjà au moins un lit.
 */
import { PrismaClient, RoomType } from "@prisma/client";

const prisma = new PrismaClient();

function defaultBedCodes(type: RoomType): string[] {
  return type === RoomType.VIP ? ["L1"] : ["L1", "L2"];
}

async function main() {
  const rooms = await prisma.room.findMany({
    include: { beds: { select: { id: true } } },
    orderBy: [{ type: "asc" }, { name: "asc" }],
  });

  let created = 0;
  let skipped = 0;

  for (const room of rooms) {
    if (room.beds.length > 0) {
      skipped += 1;
      continue;
    }

    const codes = defaultBedCodes(room.type);
    await prisma.bed.createMany({
      data: codes.map((code) => ({
        roomId: room.id,
        code,
        label: `Lit ${code}`,
        active: true,
      })),
    });
    created += codes.length;
    console.log(`Salle ${room.name} (${room.type}) → ${codes.join(", ")}`);
  }

  console.log(`OK — ${created} lit(s) créé(s), ${skipped} salle(s) déjà équipée(s).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
