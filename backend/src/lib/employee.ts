import { DoctorCompensationType, ConsultationQuotaMode, ConsultationRenewalPolicy, EmployeeContractStatus, ContractType } from "@prisma/client";
import { DOCTOR_COMPENSATION_LABELS } from "./doctor-compensation.js";

export type EmployeeRecord = {
  id: string;
  firstName: string;
  lastName: string;
  phone?: string | null;
  jobTitle?: string | null;
  isMedecin: boolean;
  doctorCompensationType: DoctorCompensationType;
  consultationTotalFcfa?: number | null;
  consultationQuotaMode?: ConsultationQuotaMode | null;
  consultationQuotaPercent?: number | null;
  consultationQuotaFcfa?: number | null;
  consultationValidityDays?: number | null;
  consultationRenewalPolicy?: ConsultationRenewalPolicy | null;
  surgeryQuotaPercent?: number | null;
  fixedSalaryFcfa?: number | null;
  service?: string | null;
  contractType?: ContractType | null;
  contractStatus?: EmployeeContractStatus;
  bonusFcfa?: number | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
  user?: {
    id: string;
    email: string;
    role: string;
    active: boolean;
  } | null;
};

export function serializeEmployee(employee: EmployeeRecord) {
  return {
    id: employee.id,
    firstName: employee.firstName,
    lastName: employee.lastName,
    phone: employee.phone,
    jobTitle: employee.jobTitle,
    isMedecin: employee.isMedecin,
    doctorCompensationType: employee.doctorCompensationType,
    consultationTotalFcfa: employee.consultationTotalFcfa,
    consultationQuotaMode: employee.consultationQuotaMode,
    consultationQuotaPercent: employee.consultationQuotaPercent,
    consultationQuotaFcfa: employee.consultationQuotaFcfa,
    consultationValidityDays: employee.consultationValidityDays,
    consultationRenewalPolicy: employee.consultationRenewalPolicy,
    surgeryQuotaPercent: employee.surgeryQuotaPercent,
    fixedSalaryFcfa: employee.fixedSalaryFcfa,
    service: employee.service ?? null,
    contractType: employee.contractType ?? null,
    contractStatus: employee.contractStatus ?? "ACTIF",
    bonusFcfa: employee.bonusFcfa ?? null,
    compensationLabel: employee.isMedecin
      ? DOCTOR_COMPENSATION_LABELS[employee.doctorCompensationType]
      : null,
    active: employee.active,
    hasUserAccount: Boolean(employee.user),
    user: employee.user
      ? {
          id: employee.user.id,
          email: employee.user.email,
          role: employee.user.role,
          active: employee.user.active,
        }
      : null,
    createdAt: employee.createdAt,
    updatedAt: employee.updatedAt,
  };
}

function employeeNameKey(firstName: string, lastName: string) {
  return `${firstName} ${lastName}`.trim().toLowerCase();
}

/** Une entrée par nom — garde la fiche liée à un compte utilisateur si doublon en base. */
export function dedupeEmployeesForSelection<
  T extends {
    id: string;
    firstName: string;
    lastName: string;
    user?: unknown | null;
    hasUserAccount?: boolean;
    updatedAt?: Date | string;
  },
>(rows: T[]): T[] {
  const byName = new Map<string, T>();

  for (const row of rows) {
    const key = employeeNameKey(row.firstName, row.lastName);
    const existing = byName.get(key);
    if (!existing) {
      byName.set(key, row);
      continue;
    }

    const rowHasUser = Boolean(row.hasUserAccount ?? row.user);
    const existingHasUser = Boolean(existing.hasUserAccount ?? existing.user);
    if (rowHasUser && !existingHasUser) {
      byName.set(key, row);
      continue;
    }
    if (!rowHasUser && existingHasUser) continue;

    const rowUpdated = row.updatedAt ? new Date(row.updatedAt).getTime() : 0;
    const existingUpdated = existing.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
    if (rowUpdated >= existingUpdated) {
      byName.set(key, row);
    }
  }

  return [...byName.values()].sort((a, b) =>
    employeeNameKey(a.lastName, a.firstName).localeCompare(
      employeeNameKey(b.lastName, b.firstName),
      "fr",
    ),
  );
}

export const employeeSelect = {
  id: true,
  firstName: true,
  lastName: true,
  phone: true,
  jobTitle: true,
  isMedecin: true,
  doctorCompensationType: true,
  consultationTotalFcfa: true,
  consultationQuotaMode: true,
  consultationQuotaPercent: true,
  consultationQuotaFcfa: true,
  consultationValidityDays: true,
  consultationRenewalPolicy: true,
  surgeryQuotaPercent: true,
  fixedSalaryFcfa: true,
  service: true,
  contractType: true,
  contractStatus: true,
  bonusFcfa: true,
  active: true,
  createdAt: true,
  updatedAt: true,
  user: {
    select: {
      id: true,
      email: true,
      role: true,
      active: true,
    },
  },
} as const;
