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

/** Somme qui sera déduite à la prochaine paie (tranches ou solde restant). */
export async function sumPendingAdvancesByEmployee(employeeIds: string[]) {
  if (!employeeIds.length) return new Map<string, number>();
  const rows = await prisma.salaryAdvance.findMany({
    where: {
      employeeId: { in: employeeIds },
      status: SalaryAdvanceStatus.PENDING,
      remainingFcfa: { gt: 0 },
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
) {
  const pending = await tx.salaryAdvance.findMany({
    where: {
      employeeId,
      status: SalaryAdvanceStatus.PENDING,
      remainingFcfa: { gt: 0 },
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
    const deduction =
      row.installmentFcfa != null
        ? Math.min(row.installmentFcfa, row.remainingFcfa)
        : row.remainingFcfa;
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
