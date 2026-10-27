import {
  DoctorOvertimeStatus,
  DoctorShareClaimStatus,
  DoctorShareKind,
  PayrollStatus,
  Prisma,
  SalaryAdvanceStatus,
} from "@prisma/client";
import { payrollPeriodBounds } from "./admin-payroll.js";
import { prisma } from "./db.js";

type AdvanceCandidate = {
  id: string;
  amountFcfa: number;
  remainingFcfa: number;
  status: SalaryAdvanceStatus;
  payrollYear: number | null;
  payrollMonth: number | null;
  businessDate: Date;
  createdAt: Date;
};

export type AdvanceRestoration = {
  id: string;
  restoreFcfa: number;
  nextRemainingFcfa: number;
  /** L'avance était soldée : elle repasse en attente. */
  reopen: boolean;
};

/**
 * Répartit la retenue d'avances à rendre lors de l'annulation d'une paie.
 * La paie déduit les avances des plus anciennes aux plus récentes : on rend donc
 * d'abord aux avances soldées sur ce mois, puis aux plus récentes entamées.
 */
export function planAdvanceRestoration(
  advances: AdvanceCandidate[],
  year: number,
  month: number,
  totalFcfa: number,
): AdvanceRestoration[] {
  if (totalFcfa <= 0) return [];
  const newestFirst = (a: AdvanceCandidate, b: AdvanceCandidate) =>
    b.businessDate.getTime() - a.businessDate.getTime() ||
    b.createdAt.getTime() - a.createdAt.getTime();
  const deducted = advances.filter((row) => row.amountFcfa - row.remainingFcfa > 0);
  const settledThisMonth = deducted
    .filter(
      (row) =>
        row.status === SalaryAdvanceStatus.DEDUCTED &&
        row.payrollYear === year &&
        row.payrollMonth === month,
    )
    .sort(newestFirst);
  const partial = deducted
    .filter((row) => row.status === SalaryAdvanceStatus.PENDING)
    .sort(newestFirst);
  const otherSettled = deducted
    .filter(
      (row) =>
        row.status === SalaryAdvanceStatus.DEDUCTED && !settledThisMonth.includes(row),
    )
    .sort(newestFirst);

  const plan: AdvanceRestoration[] = [];
  let left = totalFcfa;
  for (const row of [...settledThisMonth, ...partial, ...otherSettled]) {
    if (left <= 0) break;
    const restoreFcfa = Math.min(left, row.amountFcfa - row.remainingFcfa);
    left -= restoreFcfa;
    plan.push({
      id: row.id,
      restoreFcfa,
      nextRemainingFcfa: row.remainingFcfa + restoreFcfa,
      reopen: row.status === SalaryAdvanceStatus.DEDUCTED,
    });
  }
  return plan;
}

/**
 * Annule une paie versée : la fiche repasse non payée (la dépense « Salaire » dérivée
 * disparaît, donc la somme revient en caisse) et les primes / retenues appliquées
 * au paiement sont rendues (heures supp., parts médecin, avances).
 */
export async function cancelPayrollPayment(
  tx: Prisma.TransactionClient,
  row: { id: string; employeeId: string; year: number; month: number; advanceDeductionFcfa: number },
) {
  const { year, month, employeeId } = row;

  await tx.doctorOvertimeEntry.updateMany({
    where: {
      employeeId,
      status: DoctorOvertimeStatus.PAID,
      payrollYear: year,
      payrollMonth: month,
    },
    data: {
      status: DoctorOvertimeStatus.VALIDATED,
      payrollYear: null,
      payrollMonth: null,
      paidAt: null,
      paidById: null,
    },
  });

  const claims = await tx.doctorShareClaim.findMany({
    where: {
      employeeId,
      status: DoctorShareClaimStatus.SETTLED_PAYROLL,
      payrollYear: year,
      payrollMonth: month,
    },
    select: { id: true, kind: true, surgeryCaseId: true },
  });
  if (claims.length) {
    await tx.doctorShareClaim.updateMany({
      where: { id: { in: claims.map((claim) => claim.id) } },
      data: {
        status: DoctorShareClaimStatus.PENDING_PAYROLL,
        settledAt: null,
        settledById: null,
      },
    });
    for (const claim of claims) {
      if (!claim.surgeryCaseId) continue;
      if (claim.kind === DoctorShareKind.OPERATION_SURGEON) {
        await tx.surgeryCase.update({
          where: { id: claim.surgeryCaseId },
          data: { surgeonPaidAt: null, surgeonPaidById: null, surgeonPaidMethod: null },
        });
      }
      if (claim.kind === DoctorShareKind.OPERATION_ASSISTANT) {
        await tx.surgeryCase.update({
          where: { id: claim.surgeryCaseId },
          data: { assistantPaidAt: null, assistantPaidById: null, assistantPaidMethod: null },
        });
      }
    }
  }

  if (row.advanceDeductionFcfa > 0) {
    const advances = await tx.salaryAdvance.findMany({
      where: {
        employeeId,
        status: { in: [SalaryAdvanceStatus.PENDING, SalaryAdvanceStatus.DEDUCTED] },
      },
      select: {
        id: true,
        amountFcfa: true,
        remainingFcfa: true,
        status: true,
        payrollYear: true,
        payrollMonth: true,
        businessDate: true,
        createdAt: true,
      },
    });
    for (const step of planAdvanceRestoration(advances, year, month, row.advanceDeductionFcfa)) {
      await tx.salaryAdvance.update({
        where: { id: step.id },
        data: {
          remainingFcfa: step.nextRemainingFcfa,
          ...(step.reopen
            ? { status: SalaryAdvanceStatus.PENDING, payrollYear: null, payrollMonth: null }
            : {}),
        },
      });
    }
  }

  const isLate = Date.now() >= payrollPeriodBounds(year, month).end.getTime();
  return tx.employeePayroll.update({
    where: { id: row.id },
    data: {
      status: isLate ? PayrollStatus.LATE : PayrollStatus.PENDING,
      paidAt: null,
      paidById: null,
      paymentMethod: null,
      remarks: null,
      primeFcfa: 0,
      advanceDeductionFcfa: 0,
    },
  });
}

/** Annulation depuis l'historique (admin / gestionnaire), avec trace d'audit. */
export async function cancelPaidPayrollById(id: string, userId: string) {
  const row = await prisma.employeePayroll.findUnique({
    where: { id },
    include: { employee: { select: { firstName: true, lastName: true } } },
  });
  if (!row) return { status: 404 as const, error: "Fiche de paie introuvable" };
  if (row.status !== PayrollStatus.PAID) {
    return { status: 409 as const, error: "Cette paie n'est pas (ou plus) payée." };
  }

  const netFcfa = Math.max(0, row.grossFcfa + row.primeFcfa - row.advanceDeductionFcfa);
  await prisma.$transaction((tx) => cancelPayrollPayment(tx, row));
  await prisma.auditLog.create({
    data: {
      userId,
      action: "CANCEL_PAY",
      entity: "EmployeePayroll",
      entityId: row.id,
      metadata: {
        employeeName: `${row.employee.firstName} ${row.employee.lastName}`.trim(),
        year: row.year,
        month: row.month,
        grossFcfa: row.grossFcfa,
        primeFcfa: row.primeFcfa,
        advanceDeductionFcfa: row.advanceDeductionFcfa,
        netFcfa,
        paidAt: row.paidAt?.toISOString() ?? null,
      },
    },
  });
  return { status: 200 as const, year: row.year, month: row.month };
}
