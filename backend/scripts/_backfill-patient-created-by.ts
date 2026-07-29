import { prisma } from "../src/lib/db.js";

async function main() {
  const orphans = await prisma.patient.findMany({
    where: { createdById: null },
    select: { id: true },
  });

  let updated = 0;
  for (const p of orphans) {
    const invoice = await prisma.invoice.findFirst({
      where: { patientId: p.id },
      orderBy: { createdAt: "asc" },
      select: { issuedById: true },
    });
    if (!invoice) continue;
    await prisma.patient.update({
      where: { id: p.id },
      data: { createdById: invoice.issuedById },
    });
    updated += 1;
  }

  console.log(JSON.stringify({ orphans: orphans.length, updated }));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
