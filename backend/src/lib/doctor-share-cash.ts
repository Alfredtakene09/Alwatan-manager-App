import {
  DoctorShareClaimStatus,
  DoctorShareKind,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";
import { prisma } from "./db.js";

type Db = PrismaClient | Prisma.TransactionClient;

/** Parts déjà réglées (espèces ou paie) sur la période métier du tableau de bord. */
export async function sumSettledDoctorSharesBetween(from: Date, toExclusive: Date) {
  const rows = await prisma.doctorShareClaim.groupBy({
    by: ["kind"],
    where: {
      status: {
        in: [DoctorShareClaimStatus.SETTLED_CASH, DoctorShareClaimStatus.SETTLED_PAYROLL],
      },
      businessDate: { gte: from, lt: toExclusive },
    },
    _sum: { amountFcfa: true },
  });

  let consultationFcfa = 0;
  let surgeryFcfa = 0;
  for (const row of rows) {
    const amount = row._sum.amountFcfa ?? 0;
    if (row.kind === DoctorShareKind.CONSULTATION) consultationFcfa += amount;
    else surgeryFcfa += amount;
  }

  return {
    totalFcfa: consultationFcfa + surgeryFcfa,
    consultationFcfa,
    surgeryFcfa,
  };
}

/** Parts médecins réglées en espèces et pas encore retenues sur un décaissement. */
export async function outstandingDoctorShareCashFcfa(db: Db = prisma) {
  const rows = await db.doctorShareClaim.findMany({
    where: { status: DoctorShareClaimStatus.SETTLED_CASH },
    select: { amountFcfa: true, cashAppliedFcfa: true },
  });
  return rows.reduce(
    (sum, row) => sum + Math.max(0, row.amountFcfa - row.cashAppliedFcfa),
    0,
  );
}

/**
 * Les parts réglées en espèces sortent d'abord de la caisse réception
 * (là où les encaissements sont encore ouverts), puis de la caisse comptable.
 */
export function deductSharesFromCashBalances(
  receptionFcfa: number,
  comptableFcfa: number,
  shareFcfa: number,
) {
  let remaining = Math.max(0, Math.round(shareFcfa));
  const receptionTake = Math.min(Math.max(receptionFcfa, 0), remaining);
  const reception = receptionFcfa - receptionTake;
  remaining -= receptionTake;
  const comptable = comptableFcfa - remaining;
  return {
    receptionFcfa: reception,
    comptableFcfa: comptable,
    totalFcfa: reception + comptable,
    receptionShareFcfa: receptionTake,
    comptableShareFcfa: remaining,
  };
}

/** Marque des parts espèces comme déjà sorties du solde, dans l'ordre de règlement. */
export async function applyDoctorShareCash(db: Db, maxFcfa: number) {
  const cap = Math.max(0, Math.round(maxFcfa));
  if (cap <= 0) return 0;

  const rows = await db.doctorShareClaim.findMany({
    where: { status: DoctorShareClaimStatus.SETTLED_CASH },
    orderBy: [{ settledAt: "asc" }, { createdAt: "asc" }],
    select: { id: true, amountFcfa: true, cashAppliedFcfa: true },
  });

  let left = cap;
  let applied = 0;
  for (const row of rows) {
    if (left <= 0) break;
    const open = Math.max(0, row.amountFcfa - row.cashAppliedFcfa);
    if (open <= 0) continue;
    const take = Math.min(open, left);
    await db.doctorShareClaim.update({
      where: { id: row.id },
      data: { cashAppliedFcfa: row.cashAppliedFcfa + take },
    });
    left -= take;
    applied += take;
  }
  return applied;
}

/**
 * Retient les parts encore dues sur un montant de caisse.
 * Le cash remis est le net ; les parts sont marquées sorties du solde.
 */
export async function withholdDoctorShares(db: Db, netFcfa: number) {
  const net = Math.max(0, Math.round(netFcfa));
  const outstanding = await outstandingDoctorShareCashFcfa(db);
  const withheldFcfa = Math.min(net, outstanding);
  if (withheldFcfa > 0) await applyDoctorShareCash(db, withheldFcfa);
  return {
    cashFcfa: net - withheldFcfa,
    withheldFcfa,
  };
}
