import { Prisma, SalaryAdvanceStatus } from "@prisma/client";
import { prisma } from "./db.js";
import { formatBusinessDate } from "./cash-shift.js";
import { mapEmployeeService } from "./admin-payroll.js";

export const salaryAdvanceInclude = {
  employee: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      jobTitle: true,
      isMedecin: true,
      user: { select: { role: true } },
    },
  },
  recordedBy: {
    select: { firstName: true, lastName: true },
  },
} satisfies Prisma.SalaryAdvanceInclude;

export type SalaryAdvanceRow = Prisma.SalaryAdvanceGetPayload<{
  include: typeof salaryAdvanceInclude;
}>;

const STATUS_LABELS: Record<SalaryAdvanceStatus, string> = {
  PENDING: "En attente de déduction",
  DEDUCTED: "Déduite en paie",
  CANCELLED: "Annulée",
};

export function serializeSalaryAdvance(row: SalaryAdvanceRow) {
  const employee = row.employee;
  const remainingFcfa = row.remainingFcfa;
  const installmentFcfa = row.installmentFcfa;
  const nextDeductionFcfa =
    row.status === SalaryAdvanceStatus.PENDING
      ? installmentFcfa != null
        ? Math.min(installmentFcfa, remainingFcfa)
        : remainingFcfa
      : 0;

  return {
    id: row.id,
    employeeId: row.employeeId,
    amountFcfa: row.amountFcfa,
    remainingFcfa,
    installmentFcfa,
    nextDeductionFcfa,
    businessDate: formatBusinessDate(row.businessDate),
    comment: row.comment,
    status: row.status,
    statusLabel: STATUS_LABELS[row.status],
    payrollYear: row.payrollYear,
    payrollMonth: row.payrollMonth,
    recordedByName: `${row.recordedBy.firstName} ${row.recordedBy.lastName}`.trim(),
    createdAt: row.createdAt.toISOString(),
    employee: {
      id: employee.id,
      fullName: `${employee.firstName} ${employee.lastName}`.trim(),
      jobTitle: employee.jobTitle,
      service: mapEmployeeService(employee),
    },
  };
}

/**
 * Une avance se retient à partir de la paie du mois suivant celui où elle a été prise :
 * avance d'octobre → salaire de novembre. Elle n'apparaît pas sur septembre ni octobre.
 */
export function advanceDeductibleBefore(year: number, month: number) {
  // businessDate est une date pure (minuit UTC) : on compare au 1er du mois de paie en UTC.
  return new Date(Date.UTC(year, month - 1, 1));
}

export function advancesDeductibleForPayrollWhere(
  year: number,
  month: number,
): Prisma.SalaryAdvanceWhereInput {
  return {
    status: SalaryAdvanceStatus.PENDING,
    remainingFcfa: { gt: 0 },
    businessDate: { lt: advanceDeductibleBefore(year, month) },
  };
}

/**
 * Somme prévue à la paie (tranches ou solde restant), avant plafonnement au salaire.
 * Avec une période : seules les avances prises avant ce mois de paie comptent.
 */
export async function sumPendingAdvancesByEmployee(
  employeeIds: string[],
  period?: { year: number; month: number },
) {
  if (!employeeIds.length) return new Map<string, number>();
  const rows = await prisma.salaryAdvance.findMany({
    where: {
      employeeId: { in: employeeIds },
      ...(period
        ? advancesDeductibleForPayrollWhere(period.year, period.month)
        : { status: SalaryAdvanceStatus.PENDING, remainingFcfa: { gt: 0 } }),
    },
    select: {
      employeeId: true,
      remainingFcfa: true,
      installmentFcfa: true,
    },
  });

  const map = new Map<string, number>();
  for (const row of rows) {
    const next =
      row.installmentFcfa != null
        ? Math.min(row.installmentFcfa, row.remainingFcfa)
        : row.remainingFcfa;
    map.set(row.employeeId, (map.get(row.employeeId) ?? 0) + next);
  }
  return map;
}

/**
 * Déduit une tranche (ou le solde) de chaque avance PENDING à la paie.
 * Si installmentFcfa est null → tout le reste d'un coup.
 */
export async function deductPendingAdvancesForPayroll(
  tx: Prisma.TransactionClient,
  employeeId: string,
  year: number,
  month: number,
  /** Plafond : on ne retient jamais plus que ce que l'employé doit toucher. */
  maxFcfa = Number.POSITIVE_INFINITY,
) {
  const pending = await tx.salaryAdvance.findMany({
    where: {
      employeeId,
      ...advancesDeductibleForPayrollWhere(year, month),
    },
    orderBy: [{ businessDate: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      remainingFcfa: true,
      installmentFcfa: true,
    },
  });
  if (!pending.length) return 0;

  let total = 0;
  for (const row of pending) {
    const planned =
      row.installmentFcfa != null
        ? Math.min(row.installmentFcfa, row.remainingFcfa)
        : row.remainingFcfa;
    // Le reste non retenu ce mois-ci reste dû sur la paie suivante.
    const deduction = Math.min(planned, Math.max(0, maxFcfa - total));
    if (deduction <= 0) continue;

    const nextRemaining = row.remainingFcfa - deduction;
    total += deduction;

    await tx.salaryAdvance.update({
      where: { id: row.id },
      data: {
        remainingFcfa: nextRemaining,
        ...(nextRemaining <= 0
          ? {
              status: SalaryAdvanceStatus.DEDUCTED,
              payrollYear: year,
              payrollMonth: month,
            }
          : {}),
      },
    });
  }

  return total;
}
