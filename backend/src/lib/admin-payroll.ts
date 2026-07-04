import {
  DoctorCompensationType,
  PayrollStatus,
  Prisma,
} from "@prisma/client";
import { prisma } from "./db.js";
import { dedupeEmployeesForSelection } from "./employee.js";

export function currentPayrollPeriod(now = new Date()) {
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

export function payrollPeriodBounds(year: number, month: number) {
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 1);
  return { start, end };
}

export function employeeGrossSalary(employee: {
  isMedecin: boolean;
  doctorCompensationType: DoctorCompensationType;
  fixedSalaryFcfa: number | null;
}): number | null {
  if (employee.fixedSalaryFcfa != null && employee.fixedSalaryFcfa > 0) {
    return employee.fixedSalaryFcfa;
  }
  if (
    employee.isMedecin &&
    employee.doctorCompensationType === DoctorCompensationType.FIXED_SALARY
  ) {
    return employee.fixedSalaryFcfa ?? 0;
  }
  return null;
}

const payrollEmployeeSelect = {
  id: true,
  firstName: true,
  lastName: true,
  updatedAt: true,
  isMedecin: true,
  doctorCompensationType: true,
  fixedSalaryFcfa: true,
  user: { select: { id: true } },
} as const;

export function listEligiblePayrollEmployees(
  employees: Prisma.EmployeeGetPayload<{ select: typeof payrollEmployeeSelect }>[],
) {
  return dedupeEmployeesForSelection(employees)
    .map((employee) => ({
      employeeId: employee.id,
      grossFcfa: employeeGrossSalary(employee),
    }))
    .filter((row): row is { employeeId: string; grossFcfa: number } =>
      row.grossFcfa != null && row.grossFcfa > 0,
    );
}

export async function ensurePayrollForMonth(year: number, month: number) {
  const employees = await prisma.employee.findMany({
    where: { active: true },
    select: payrollEmployeeSelect,
  });

  const eligible = listEligiblePayrollEmployees(employees);

  if (!eligible.length) return { created: 0, total: 0 };

  const { end } = payrollPeriodBounds(year, month);
  const isLate = Date.now() >= end.getTime();

  await prisma.$transaction(
    eligible.map((row) =>
      prisma.employeePayroll.upsert({
        where: {
          employeeId_year_month: {
            employeeId: row.employeeId,
            year,
            month,
          },
        },
        create: {
          employeeId: row.employeeId,
          year,
          month,
          grossFcfa: row.grossFcfa,
          status: isLate ? PayrollStatus.LATE : PayrollStatus.PENDING,
        },
        update: {},
      }),
    ),
  );

  return { created: eligible.length, total: eligible.length };
}

export async function countEligiblePayrollEmployees() {
  const employees = await prisma.employee.findMany({
    where: { active: true },
    select: payrollEmployeeSelect,
  });
  return listEligiblePayrollEmployees(employees).length;
}

export async function getPayrollPeriodSummaries() {
  const rows = await prisma.employeePayroll.groupBy({
    by: ["year", "month", "status"],
    _count: { _all: true },
  });

  const byPeriod = new Map<
    string,
    { year: number; month: number; total: number; paid: number; unpaid: number }
  >();

  for (const row of rows) {
    const key = `${row.year}-${row.month}`;
    const entry = byPeriod.get(key) ?? {
      year: row.year,
      month: row.month,
      total: 0,
      paid: 0,
      unpaid: 0,
    };
    entry.total += row._count._all;
    if (row.status === PayrollStatus.PAID) {
      entry.paid += row._count._all;
    } else {
      entry.unpaid += row._count._all;
    }
    byPeriod.set(key, entry);
  }

  return [...byPeriod.values()].sort((a, b) =>
    b.year !== a.year ? b.year - a.year : b.month - a.month,
  );
}

export async function fetchPayrollRowsForMonth(year: number, month: number) {
  const rows = await prisma.employeePayroll.findMany({
    where: { year, month },
    include: employeePayrollInclude,
    orderBy: [{ status: "asc" }, { employee: { lastName: "asc" } }],
  });
  return rows;
}

export function mapEmployeeService(employee: {
  isMedecin: boolean;
  jobTitle: string | null;
  user: { role: string } | null;
}): string {
  const role = employee.user?.role ?? "";
  const title = (employee.jobTitle ?? "").toLowerCase();
  if (employee.isMedecin || role === "MEDECIN") return "Médecins";
  if (role === "LABORANTIN" || title.includes("labo")) return "Labo";
  if (role === "RECEPTIONNISTE" || title.includes("réception") || title.includes("reception")) {
    return "Réception";
  }
  if (role === "ADMIN" || title.includes("admin")) return "Admin";
  if (role === "SOIGNANT" || title.includes("infirm")) return "Infirmiers";
  return "Autres";
}

export const employeePayrollInclude = {
  employee: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      jobTitle: true,
      isMedecin: true,
      fixedSalaryFcfa: true,
      bonusFcfa: true,
      user: { select: { role: true } },
    },
  },
} satisfies Prisma.EmployeePayrollInclude;

export function serializePayrollRow(
  row: Prisma.EmployeePayrollGetPayload<{
    include: typeof employeePayrollInclude;
  }>,
  options?: { pendingAdvancesFcfa?: number },
) {
  const employee = row.employee;
  const advances =
    row.status === "PAID"
      ? row.advanceDeductionFcfa
      : (options?.pendingAdvancesFcfa ?? 0);
  const netBeforeAdvances = row.grossFcfa;
  return {
    id: row.id,
    year: row.year,
    month: row.month,
    grossFcfa: row.grossFcfa,
    primeFcfa: 0,
    pendingAdvancesFcfa: advances,
    advanceDeductionFcfa: row.advanceDeductionFcfa,
    netFcfa: Math.max(0, netBeforeAdvances - advances),
    netBeforeAdvancesFcfa: netBeforeAdvances,
    status: row.status,
    paymentMethod: row.paymentMethod,
    remarks: row.remarks,
    paidAt: row.paidAt?.toISOString() ?? null,
    employee: {
      id: employee.id,
      fullName: `${employee.firstName} ${employee.lastName}`.trim(),
      jobTitle: employee.jobTitle,
      service: mapEmployeeService(employee),
    },
  };
}
