import { PayrollStatus, UserRole } from "@prisma/client";
import { formatBusinessDate } from "./cash-shift.js";
import { prisma } from "./db.js";
import { ROLE_LABELS, type AppUserRole } from "./roles.js";

export const PAYROLL_EXPENSE_ID_PREFIX = "payroll:";

export function isPayrollLinkedExpenseId(id: string) {
  return id.startsWith(PAYROLL_EXPENSE_ID_PREFIX);
}

export function payrollExpenseMutationBlockedMessage() {
  return "Ce salaire payé se gère depuis la paie, pas depuis les dépenses.";
}

export function payrollExpensePeriodLabel(year: number, month: number) {
  return new Date(year, month - 1, 1).toLocaleDateString("fr-FR", {
    month: "long",
    year: "numeric",
  });
}

type PaidPayrollExpenseInput = {
  id: string;
  year: number;
  month: number;
  grossFcfa: number;
  paidAt: Date;
  employee: { firstName: string; lastName: string };
  paidBy: { firstName: string; lastName: string; role: UserRole } | null;
};

export function mapPaidPayrollToExpenseCore(row: PaidPayrollExpenseInput) {
  const fullName = `${row.employee.firstName} ${row.employee.lastName}`.trim();
  const period = payrollExpensePeriodLabel(row.year, row.month);
  const paidByRole = row.paidBy?.role as AppUserRole | undefined;
  const paidByName = row.paidBy
    ? `${row.paidBy.firstName} ${row.paidBy.lastName}`.trim()
    : null;
  return {
    id: `${PAYROLL_EXPENSE_ID_PREFIX}${row.id}`,
    source: "payroll" as const,
    date: formatBusinessDate(row.paidAt),
    amountFcfa: row.grossFcfa,
    description: `Salaire — ${fullName} (${period})`,
    category: "Salaire",
    beneficiary: fullName,
    recordedByName: paidByName,
    recordedByRole: paidByRole ?? null,
    recordedByRoleLabel: paidByRole ? ROLE_LABELS[paidByRole] : null,
    comment: `Paie versée le ${formatBusinessDate(row.paidAt)}`,
    paidAt: row.paidAt,
  };
}

export async function listPaidPayrollExpenseCores(range?: { from: Date; to: Date }) {
  const rows = await prisma.employeePayroll.findMany({
    where: {
      status: PayrollStatus.PAID,
      grossFcfa: { gt: 0 },
      paidAt: range ? { gte: range.from, lt: range.to } : { not: null },
    },
    select: {
      id: true,
      year: true,
      month: true,
      grossFcfa: true,
      paidAt: true,
      employee: { select: { firstName: true, lastName: true } },
      paidBy: { select: { firstName: true, lastName: true, role: true } },
    },
    orderBy: { paidAt: "desc" },
  });

  return rows.flatMap((row) =>
    row.paidAt ? [mapPaidPayrollToExpenseCore({ ...row, paidAt: row.paidAt })] : [],
  );
}
