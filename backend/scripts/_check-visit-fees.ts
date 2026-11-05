import { prisma } from "../src/lib/db.js";

const visits = await prisma.visit.findMany({
  where: { createdAt: { gte: new Date(Date.now() - 3 * 86400000) } },
  orderBy: { createdAt: "desc" },
  take: 300,
  select: {
    id: true,
    status: true,
    consultationFeeFcfa: true,
    reductionFcfa: true,
    patient: { select: { code: true, service: true, updatedAt: true, createdAt: true } },
    assignedDoctor: {
      select: { firstName: true, lastName: true, employee: { select: { consultationTotalFcfa: true } } },
    },
    invoices: {
      where: { type: "CONSULTATION" },
      select: { amountFcfa: true, status: true, paidAmountFcfa: true },
    },
  },
});

for (const v of visits) {
  const price = v.assignedDoctor?.employee?.consultationTotalFcfa ?? null;
  const inv = v.invoices[0];
  const edited = v.patient.updatedAt.getTime() - v.patient.createdAt.getTime() > 60000;
  if (price && v.consultationFeeFcfa !== price) {
    console.log(
      v.patient.code,
      v.status,
      v.patient.service,
      `Dr ${v.assignedDoctor?.lastName}`,
      "tarif", price,
      "visite", v.consultationFeeFcfa,
      "facture", inv?.amountFcfa, inv?.status,
      edited ? "MODIFIE" : "",
    );
  }
}
await prisma.$disconnect();
