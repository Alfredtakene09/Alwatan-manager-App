import {
  ClinicExpenseFlow,
  ClinicExpenseStatus,
  DoctorShareClaimStatus,
  DoctorShareKind,
  SharePaymentMethod,
} from "@prisma/client";
import { prisma } from "./db.js";
import { toBusinessDateBound } from "./cash-shift.js";
import { sumPayrollOutflowBetween } from "./payroll-outflow.js";
import { aggregateCollectedBetween, aggregatePharmacyBetween } from "./revenue-stats.js";
import { computePharmacyProfit } from "./pharmacy-profit.js";
import { effectiveSurgeryAssistant, resolveAssistantPercent } from "./doctor-compensation.js";

/** Module Dépenses : sorties validées (dépenses) et entrées validées (ajoutées au solde). */
export async function sumValidatedExpensesBetween(from: Date, to: Date) {
  const rows = await prisma.clinicExpense.findMany({
    where: {
      status: ClinicExpenseStatus.VALIDATED,
      businessDate: { gte: toBusinessDateBound(from), lt: toBusinessDateBound(to) },
    },
    select: { id: true, amountFcfa: true, category: true, flow: true },
  });
  const outflows = rows.filter((row) => row.flow !== ClinicExpenseFlow.ENTREE);
  const entriesFcfa = rows.reduce(
    (sum, row) => sum + (row.flow === ClinicExpenseFlow.ENTREE ? row.amountFcfa : 0),
    0,
  );
  const purchaseLogs = outflows.length
    ? await prisma.auditLog.findMany({
        where: { entity: "PharmacyPurchase", action: "CREATE", entityId: { in: outflows.map((row) => row.id) } },
        select: { entityId: true },
      })
    : [];
  const purchaseIds = new Set(purchaseLogs.map((row) => row.entityId));
  const pharmacyPurchasesFcfa = outflows.reduce(
    (sum, row) => sum + (purchaseIds.has(row.id) ? row.amountFcfa : 0),
    0,
  );
  return {
    totalFcfa: outflows.reduce((sum, row) => sum + row.amountFcfa, 0),
    entriesFcfa,
    pharmacyPurchasesFcfa,
    rows: outflows,
  };
}

/**
 * Parts médecins versées en espèces : elles sortent de la caisse sans passer par le module
 * Dépenses. Les parts versées sur la paie sont déjà dans le net de paie.
 */
export async function sumDoctorSharesCashBetween(from: Date, to: Date) {
  const [consultations, surgeries] = await Promise.all([
    prisma.doctorShareClaim.aggregate({
      where: {
        kind: DoctorShareKind.CONSULTATION,
        status: DoctorShareClaimStatus.SETTLED_CASH,
        settledAt: { gte: from, lt: to },
      },
      _sum: { amountFcfa: true },
    }),
    prisma.surgeryCase.findMany({
      where: {
        OR: [
          { surgeonPaidAt: { gte: from, lt: to }, surgeonPaidMethod: { not: SharePaymentMethod.PAYROLL } },
          { assistantPaidAt: { gte: from, lt: to }, assistantPaidMethod: { not: SharePaymentMethod.PAYROLL } },
          { surgeonPaidAt: { gte: from, lt: to }, surgeonPaidMethod: null },
          { assistantPaidAt: { gte: from, lt: to }, assistantPaidMethod: null },
        ],
      },
      include: {
        interventionType: true,
        doctorShareClaims: {
          where: { status: DoctorShareClaimStatus.SETTLED_CASH },
          select: { kind: true, amountFcfa: true, settledAt: true },
        },
      },
    }),
  ]);
  let total = consultations._sum.amountFcfa ?? 0;
  let estimatedCount = 0;
  for (const surgery of surgeries) {
    const inRange = (date: Date | null) => date != null && date >= from && date < to;
    if (inRange(surgery.surgeonPaidAt) && surgery.surgeonPaidMethod !== SharePaymentMethod.PAYROLL) {
      const claim = surgery.doctorShareClaims.find((item) => item.kind === DoctorShareKind.OPERATION_SURGEON);
      total += claim?.amountFcfa ?? surgery.surgeonShareFcfa;
      if (!claim?.settledAt || Math.abs(claim.settledAt.getTime() - surgery.surgeonPaidAt!.getTime()) > 60_000) estimatedCount += 1;
    }
    if (inRange(surgery.assistantPaidAt) && surgery.assistantPaidMethod !== SharePaymentMethod.PAYROLL) {
      const assistant = effectiveSurgeryAssistant(surgery);
      if (assistant.id) {
        const claim = surgery.doctorShareClaims.find((item) => item.kind === DoctorShareKind.OPERATION_ASSISTANT);
        total += claim?.amountFcfa ?? Math.round(surgery.totalCostFcfa * resolveAssistantPercent(assistant.percent, null) / 100);
        if (!claim?.settledAt || Math.abs(claim.settledAt.getTime() - surgery.assistantPaidAt!.getTime()) > 60_000) estimatedCount += 1;
      }
    }
  }
  return { totalFcfa: total, estimatedCount };
}

export function calculateNetPeriodFinance(input: {
  revenueFcfa: number;
  entriesFcfa: number;
  expensesFcfa: number;
  pharmacyPurchasesFcfa: number;
  pharmacyCostFcfa: number;
  payrollFcfa: number;
  doctorSharesCashFcfa: number;
}) {
  return input.revenueFcfa + input.entriesFcfa - (input.expensesFcfa - input.pharmacyPurchasesFcfa)
    - input.pharmacyCostFcfa - input.payrollFcfa - input.doctorSharesCashFcfa;
}

/**
 * Bénéfice net d'une période, commun à tous les tableaux de bord :
 * recettes (prestations + pharmacie) + entrées du module Dépenses
 * − dépenses hors achats de stock pharmacie − coût des produits vendus
 * − salaires et avances versés − parts médecins effectivement réglées en espèces.
 */
export async function sumPeriodFinance(from: Date, to: Date) {
  const [collected, pharmacy, expenses, payroll, doctorShares, pharmacyProfit] = await Promise.all([
    aggregateCollectedBetween(from, to),
    aggregatePharmacyBetween(from, to),
    sumValidatedExpensesBetween(from, to),
    sumPayrollOutflowBetween(from, to),
    sumDoctorSharesCashBetween(from, to),
    computePharmacyProfit(from, to),
  ]);
  const doctorSharesCashFcfa = doctorShares.totalFcfa;
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
    pharmacyCostFcfa: pharmacyProfit.periodCostFcfa,
    pharmacyPurchasesFcfa: expenses.pharmacyPurchasesFcfa,
    incompleteCostLinesCount: pharmacyProfit.excludedLinesCount,
    estimatedCostLinesCount: pharmacyProfit.estimatedCostLinesCount,
    estimatedDoctorSharesCount: doctorShares.estimatedCount,
    outflowsFcfa,
    netFcfa: calculateNetPeriodFinance({
      revenueFcfa,
      entriesFcfa: expenses.entriesFcfa,
      expensesFcfa: expenses.totalFcfa,
      pharmacyPurchasesFcfa: expenses.pharmacyPurchasesFcfa,
      pharmacyCostFcfa: pharmacyProfit.periodCostFcfa,
      payrollFcfa: payroll.totalFcfa,
      doctorSharesCashFcfa,
    }),
  };
}

export type PeriodFinance = Awaited<ReturnType<typeof sumPeriodFinance>>;
