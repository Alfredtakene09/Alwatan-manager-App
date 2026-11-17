import {
  ClinicExpenseFlow,
  ClinicExpenseStatus,
  DoctorShareClaimStatus,
} from "@prisma/client";
import { prisma } from "./db.js";
import { toBusinessDateBound } from "./cash-shift.js";
import { sumPayrollOutflowBetween } from "./payroll-outflow.js";
import { aggregateCollectedBetween, aggregatePharmacyBetween } from "./revenue-stats.js";

/** Module Dépenses : sorties validées (dépenses) et entrées validées (ajoutées au solde). */
export async function sumValidatedExpensesBetween(from: Date, to: Date) {
  const rows = await prisma.clinicExpense.findMany({
    where: {
      status: ClinicExpenseStatus.VALIDATED,
      businessDate: { gte: toBusinessDateBound(from), lt: toBusinessDateBound(to) },
    },
    select: { amountFcfa: true, category: true, flow: true },
  });
  const outflows = rows.filter((row) => row.flow !== ClinicExpenseFlow.ENTREE);
  const entriesFcfa = rows.reduce(
    (sum, row) => sum + (row.flow === ClinicExpenseFlow.ENTREE ? row.amountFcfa : 0),
    0,
  );
  return {
    totalFcfa: outflows.reduce((sum, row) => sum + row.amountFcfa, 0),
    entriesFcfa,
    rows: outflows,
  };
}

/**
 * Parts médecins versées en espèces : elles sortent de la caisse sans passer par le module
 * Dépenses. Les parts versées sur la paie sont déjà dans le net de paie.
 */
export async function sumDoctorSharesCashBetween(from: Date, to: Date) {
  const result = await prisma.doctorShareClaim.aggregate({
    where: {
      status: DoctorShareClaimStatus.SETTLED_CASH,
      businessDate: { gte: toBusinessDateBound(from), lt: toBusinessDateBound(to) },
    },
    _sum: { amountFcfa: true },
  });
  return result._sum.amountFcfa ?? 0;
}

/**
 * Bénéfice net d'une période, commun à tous les tableaux de bord :
 * recettes (prestations + pharmacie) + entrées du module Dépenses
 * − sorties du module Dépenses − salaires et avances versés − parts médecins en espèces.
 */
export async function sumPeriodFinance(from: Date, to: Date) {
  const [collected, pharmacy, expenses, payroll, doctorSharesCashFcfa] = await Promise.all([
    aggregateCollectedBetween(from, to),
    aggregatePharmacyBetween(from, to),
    sumValidatedExpensesBetween(from, to),
    sumPayrollOutflowBetween(from, to),
    sumDoctorSharesCashBetween(from, to),
  ]);
  const revenueFcfa = collected.totalFcfa + pharmacy.totalFcfa;
  const outflowsFcfa = expenses.totalFcfa + payroll.totalFcfa + doctorSharesCashFcfa;
  return {
    collected,
    pharmacyFcfa: pharmacy.totalFcfa,
    revenueFcfa,
    entriesFcfa: expenses.entriesFcfa,
    chargesFcfa: expenses.totalFcfa,
    expenseRows: expenses.rows,
    payrollFcfa: payroll.totalFcfa,
    payrollSalariesFcfa: payroll.salariesFcfa,
    payrollAdvancesFcfa: payroll.advancesFcfa,
    doctorSharesCashFcfa,
    outflowsFcfa,
    netFcfa: revenueFcfa + expenses.entriesFcfa - outflowsFcfa,
  };
}

export type PeriodFinance = Awaited<ReturnType<typeof sumPeriodFinance>>;
