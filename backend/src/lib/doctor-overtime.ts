import {
  DoctorOvertimeStatus,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";
import { prisma } from "./db.js";

export type DbClient = PrismaClient | Prisma.TransactionClient;

const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;

export function parseHhMmToMinutes(value: string): number | null {
  if (!timeRegex.test(value)) return null;
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}

export function minutesBetweenTimes(startTime: string, endTime: string): number | null {
  const start = parseHhMmToMinutes(startTime);
  const end = parseHhMmToMinutes(endTime);
  if (start == null || end == null) return null;
  // Autorise le passage minuit (ex. 22:00 → 01:00)
  const diff = end > start ? end - start : end + 24 * 60 - start;
  return diff > 0 ? diff : null;
}

export function computeOvertimeAmountFcfa(minutesWorked: number, hourlyRateFcfa: number): number {
  if (minutesWorked <= 0 || hourlyRateFcfa <= 0) return 0;
  return Math.round((minutesWorked / 60) * hourlyRateFcfa);
}

export function formatMinutesAsHours(minutesWorked: number): number {
  return Math.round((minutesWorked / 60) * 100) / 100;
}

export const doctorOvertimeInclude = {
  employee: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      specialty: true,
      overtimeHourlyRateFcfa: true,
      isMedecin: true,
    },
  },
  recordedBy: { select: { id: true, firstName: true, lastName: true } },
  validatedBy: { select: { id: true, firstName: true, lastName: true } },
  paidBy: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.DoctorOvertimeEntryInclude;

export type DoctorOvertimeRow = Prisma.DoctorOvertimeEntryGetPayload<{
  include: typeof doctorOvertimeInclude;
}>;

export function serializeDoctorOvertime(row: DoctorOvertimeRow) {
  return {
    id: row.id,
    employeeId: row.employeeId,
    businessDate: row.businessDate.toISOString().slice(0, 10),
    startTime: row.startTime,
    endTime: row.endTime,
    minutesWorked: row.minutesWorked,
    hoursWorked: formatMinutesAsHours(row.minutesWorked),
    hourlyRateFcfa: row.hourlyRateFcfa,
    amountFcfa: row.amountFcfa,
    comment: row.comment,
    status: row.status,
    payrollYear: row.payrollYear,
    payrollMonth: row.payrollMonth,
    rejectionReason: row.rejectionReason,
    recordedAt: row.createdAt.toISOString(),
    validatedAt: row.validatedAt?.toISOString() ?? null,
    paidAt: row.paidAt?.toISOString() ?? null,
    employee: {
      id: row.employee.id,
      firstName: row.employee.firstName,
      lastName: row.employee.lastName,
      specialty: row.employee.specialty,
      overtimeHourlyRateFcfa: row.employee.overtimeHourlyRateFcfa,
    },
    recordedBy: row.recordedBy
      ? {
          id: row.recordedBy.id,
          firstName: row.recordedBy.firstName,
          lastName: row.recordedBy.lastName,
        }
      : null,
    validatedBy: row.validatedBy
      ? {
          id: row.validatedBy.id,
          firstName: row.validatedBy.firstName,
          lastName: row.validatedBy.lastName,
        }
      : null,
    paidBy: row.paidBy
      ? {
          id: row.paidBy.id,
          firstName: row.paidBy.firstName,
          lastName: row.paidBy.lastName,
        }
      : null,
  };
}

export async function sumValidatedOvertimeByEmployee(
  employeeIds: string[],
  year: number,
  month: number,
): Promise<Map<string, number>> {
  if (!employeeIds.length) return new Map();
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 1);
  const rows = await prisma.doctorOvertimeEntry.groupBy({
    by: ["employeeId"],
    where: {
      employeeId: { in: employeeIds },
      status: DoctorOvertimeStatus.VALIDATED,
      businessDate: { gte: start, lt: end },
    },
    _sum: { amountFcfa: true },
  });
  return new Map(rows.map((row) => [row.employeeId, row._sum.amountFcfa ?? 0]));
}

/**
 * Inclut les HS validées du mois dans la paie (primeFcfa) et les marque PAID.
 */
export async function applyValidatedOvertimeToPayroll(
  tx: DbClient,
  input: {
    employeeId: string;
    year: number;
    month: number;
    paidById: string;
    paidAt?: Date;
  },
): Promise<number> {
  const start = new Date(input.year, input.month - 1, 1);
  const end = new Date(input.year, input.month, 1);
  const entries = await tx.doctorOvertimeEntry.findMany({
    where: {
      employeeId: input.employeeId,
      status: DoctorOvertimeStatus.VALIDATED,
      businessDate: { gte: start, lt: end },
    },
    select: { id: true, amountFcfa: true },
  });
  if (!entries.length) return 0;

  const total = entries.reduce((sum, row) => sum + row.amountFcfa, 0);
  await tx.doctorOvertimeEntry.updateMany({
    where: { id: { in: entries.map((row) => row.id) } },
    data: {
      status: DoctorOvertimeStatus.PAID,
      payrollYear: input.year,
      payrollMonth: input.month,
      paidAt: input.paidAt ?? new Date(),
      paidById: input.paidById,
    },
  });
  return total;
}

export async function countPendingDoctorOvertime(): Promise<number> {
  return prisma.doctorOvertimeEntry.count({
    where: { status: DoctorOvertimeStatus.PENDING },
  });
}
