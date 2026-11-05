import { prisma } from "../src/lib/db.js";
import { syncPaidOperationSurgeonCashShare } from "../src/lib/doctor-share-claims.js";
const apply = process.env.APPLY === "1";
const inv = await prisma.invoice.findMany({ where: { surgeryCase: { visit: { patient: { code: { in: ["PAT-1784", "PAT-2408"] } } } } }, select: { id: true, invoiceNumber: true, surgeryCaseId: true } });
class Rollback extends Error {}
for (const i of inv) {
  const claim = await prisma.doctorShareClaim.findFirst({ where: { surgeryCaseId: i.surgeryCaseId!, kind: "OPERATION_SURGEON" } });
  try {
    await prisma.$transaction(async (tx) => {
      const r = await syncPaidOperationSurgeonCashShare(tx, i.id, claim!.settledById ?? claim!.requestedById);
      console.log(i.invoiceNumber, "avant:", claim!.amountFcfa, "après:", r?.amountFcfa, r?.status, apply ? "ENREGISTRÉ" : "(simulation)");
      if (!apply) throw new Rollback();
    });
  } catch (e) { if (!(e instanceof Rollback)) throw e; }
}
await prisma.$disconnect();
