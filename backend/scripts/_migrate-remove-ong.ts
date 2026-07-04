import { PrismaClient, PatientCategory } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const result = await prisma.patient.updateMany({
    where: { category: PatientCategory.ONG },
    data: { category: PatientCategory.STANDARD, ongName: null },
  });
  console.log(`Patients ONG convertis en Standard: ${result.count}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
