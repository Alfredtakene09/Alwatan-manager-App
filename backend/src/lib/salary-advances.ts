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
  return {
    id: row.id,
    employeeId: row.employeeId,
    amountFcfa: row.amountFcfa,
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

export async function sumPendingAdvancesByEmployee(employeeIds: string[]) {
  if (!employeeIds.length) return new Map<string, number>();
  const rows = await prisma.salaryAdvance.groupBy({
    by: ["employeeId"],
    where: {
      employeeId: { in: employeeIds },
      status: SalaryAdvanceStatus.PENDING,
    },
    _sum: { amountFcfa: true },
  });
  return new Map(
    rows.map((row) => [row.employeeId, row._sum.amountFcfa ?? 0]),
  );
}

export async function deductPendingAdvancesForPayroll(
  tx: Prisma.TransactionClient,
  employeeId: string,
  year: number,
  month: number,
) {
  const pending = await tx.salaryAdvance.findMany({
    where: { employeeId, status: SalaryAdvanceStatus.PENDING },
    select: { id: true, amountFcfa: true },
  });
  if (!pending.length) return 0;

  const total = pending.reduce((sum, row) => sum + row.amountFcfa, 0);
  await tx.salaryAdvance.updateMany({
    where: { id: { in: pending.map((row) => row.id) } },
    data: {
      status: SalaryAdvanceStatus.DEDUCTED,
      payrollYear: year,
      payrollMonth: month,
    },
  });
  return total;
}
