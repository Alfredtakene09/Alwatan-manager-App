import { prisma } from "../src/lib/db.js";

async function main() {
  const patients = await prisma.patient.findMany({
    where: { code: { in: ["PAT-098", "PAT-099", "PAT-98", "PAT-99"] } },
    include: {
      visits: {
        include: {
          invoices: {
            include: {
              payments: true,
              cashSettlementLine: { select: { id: true } },
              doctorShareClaims: { select: { id: true } },
            },
          },
          consultation: {
            select: { id: true, clinicalNotes: true, labSentToLabAt: true, createdAt: true },
          },
          assignedDoctor: { select: { firstName: true, lastName: true } },
        },
      },
      invoices: {
        include: {
          payments: true,
          cashSettlementLine: { select: { id: true } },
        },
      },
    },
  });

  const nearby = await prisma.patient.findMany({
    where: { code: { startsWith: "PAT-09" } },
    select: { code: true, firstName: true, lastName: true, createdAt: true },
    orderBy: { code: "asc" },
  });

  console.log(JSON.stringify({ patients, nearby }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
