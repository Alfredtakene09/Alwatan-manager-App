import { PayrollStatus, SalaryAdvanceStatus, type Prisma } from "@prisma/client";
import { toBusinessDateBound } from "./cash-shift.js";
import { prisma } from "./db.js";

/**
 * Mois de paie rattachés à une période du tableau de bord : ceux dont le 1er jour
 * (heure locale) tombe dans [from, to). Un mois complet ou une plage de mois les prend tous.
 */
export function payrollMonthsStartingIn(from: Date, to: Date): { year: number; month: number }[] {
  const months: { year: number; month: number }[] = [];
  const cursor = new Date(from.getFullYear(), from.getMonth(), 1);
  if (cursor < from) cursor.setMonth(cursor.getMonth() + 1);
  while (cursor < to) {
    months.push({ year: cursor.getFullYear(), month: cursor.getMonth() + 1 });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return months;
}

/** Net réellement versé à la paie : salaire + primes − avances retenues. */
export function paidPayrollNetFcfa(row: {
  grossFcfa: number;
  primeFcfa: number;
  advanceDeductionFcfa: number;
}) {
  return Math.max(0, row.grossFcfa + row.primeFcfa - row.advanceDeductionFcfa);
}

export function paidPayrollWhereBetween(from: Date, to: Date): Prisma.EmployeePayrollWhereInput {
  return { status: PayrollStatus.PAID, paidAt: { gte: from, lt: to } };
}

/**
 * Sorties liées aux salaires sur la période, pour le bénéfice net :
 * - paies versées, au net, à leur date effective de paiement ;
 * - avances, au mois où elles ont été versées (sinon elles ne sortaient de la caisse qu'à la retenue).
 * L'avance retenue est déjà déduite du net de paie : elle n'est pas comptée deux fois.
 */
export async function sumPayrollOutflowBetween(from: Date, to: Date) {
  const [payrolls, advances] = await Promise.all([
    prisma.employeePayroll.findMany({
      where: paidPayrollWhereBetween(from, to),
      select: { grossFcfa: true, primeFcfa: true, advanceDeductionFcfa: true },
    }),
    prisma.salaryAdvance.aggregate({
      where: {
        status: { not: SalaryAdvanceStatus.CANCELLED },
        businessDate: { gte: toBusinessDateBound(from), lt: toBusinessDateBound(to) },
      },
      _sum: { amountFcfa: true },
    }),
  ]);
  const salariesFcfa = payrolls.reduce((sum, row) => sum + paidPayrollNetFcfa(row), 0);
  const advancesFcfa = advances._sum.amountFcfa ?? 0;
  return { salariesFcfa, advancesFcfa, totalFcfa: salariesFcfa + advancesFcfa };
}
