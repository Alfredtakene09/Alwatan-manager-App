import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const result = await prisma.user.updateMany({
  data: { sessionTokenId: null, lastActivityAt: null },
});
process.stdout.write(`Sessions invalidees: ${result.count}\n`);
await prisma.$disconnect();
