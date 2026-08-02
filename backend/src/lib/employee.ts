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
  clinicServiceId?: string | null;
  clinicService?: { id: string; name: string } | null;
  clinicServiceLinks?: {
    clinicServiceId: string;
    isDefault: boolean;
    clinicService: { id: string; name: string };
  }[];
  contractType?: ContractType | null;
  contractStatus?: EmployeeContractStatus;
  bonusFcfa?: number | null;
  specialty?: string | null;
  availabilitySlots?: unknown;
  photoPath?: string | null;
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
  const clinicServices = (employee.clinicServiceLinks ?? [])
    .map((link) => ({
      id: link.clinicService.id,
      name: link.clinicService.name,
      isDefault: link.isDefault,
    }))
    .sort((a, b) => {
      if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
      return a.name.localeCompare(b.name, "fr");
    });

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
    service: employee.clinicService?.name ?? employee.service ?? null,
    clinicServiceId: employee.clinicServiceId ?? employee.clinicService?.id ?? null,
    clinicService: employee.clinicService
      ? { id: employee.clinicService.id, name: employee.clinicService.name }
      : null,
    clinicServiceIds: clinicServices.map((s) => s.id),
    clinicServices,
    contractType: employee.contractType ?? null,
    contractStatus: employee.contractStatus ?? "ACTIF",
    bonusFcfa: employee.bonusFcfa ?? null,
    specialty: employee.isMedecin ? (employee.specialty ?? null) : null,
    availabilitySlots: employee.isMedecin ? (employee.availabilitySlots ?? null) : null,
    photoPath: employee.photoPath ?? null,
    hasPhoto: Boolean(employee.photoPath),
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
    employeeNameKey(a.firstName, a.lastName).localeCompare(
      employeeNameKey(b.firstName, b.lastName),
      "fr",
      { sensitivity: "base", numeric: true },
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
  clinicServiceId: true,
  clinicService: {
    select: {
      id: true,
      name: true,
    },
  },
  clinicServiceLinks: {
    select: {
      clinicServiceId: true,
      isDefault: true,
      clinicService: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  },
  contractType: true,
  contractStatus: true,
  bonusFcfa: true,
  specialty: true,
  availabilitySlots: true,
  photoPath: true,
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

/** Comptes / fiches admin & superadmin à masquer des listes métier. */
export function isHiddenPlatformAdminEmployee(employee: {
  firstName?: string | null;
  lastName?: string | null;
  jobTitle?: string | null;
  user?: { role?: string | null } | null;
}): boolean {
  if (employee.user?.role === "ADMIN") return true;

  const title = normalizeAdminText(employee.jobTitle);
  const firstName = normalizeAdminText(employee.firstName);
  const lastName = normalizeAdminText(employee.lastName);
  const fullName = `${firstName} ${lastName}`.trim();

  if (
    lastName.includes("superadmin") ||
    firstName.includes("superadmin") ||
    fullName.includes("superadmin") ||
    fullName === "root superadmin" ||
    (firstName === "root" && lastName.length > 0 && lastName.includes("admin"))
  ) {
    return true;
  }

  if (!title) return false;
  return (
    title.includes("superadmin") ||
    title.includes("super-admin") ||
    title.includes("super administrateur") ||
    title.includes("superadministrateur") ||
    title === "administrateur" ||
    title.includes("administrateur systeme") ||
    title.includes("admin systeme") ||
    title === "admin"
  );
}

function normalizeAdminText(value?: string | null) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

/** Clause Prisma pour exclure admin système / superadmin des listes employés. */
export const hiddenPlatformAdminEmployeeWhere = {
  NOT: {
    OR: [
      { user: { is: { role: "ADMIN" as const } } },
      { lastName: { contains: "Superadmin", mode: "insensitive" as const } },
      { firstName: { contains: "Superadmin", mode: "insensitive" as const } },
      { jobTitle: { contains: "Superadmin", mode: "insensitive" as const } },
      { jobTitle: { contains: "Superadministrateur", mode: "insensitive" as const } },
      { jobTitle: { contains: "Super administrateur", mode: "insensitive" as const } },
      { jobTitle: { contains: "Administrateur système", mode: "insensitive" as const } },
      { jobTitle: { contains: "Administrateur systeme", mode: "insensitive" as const } },
      { jobTitle: { contains: "Admin système", mode: "insensitive" as const } },
      { jobTitle: { contains: "Admin systeme", mode: "insensitive" as const } },
      { jobTitle: { equals: "Administrateur", mode: "insensitive" as const } },
      { jobTitle: { equals: "Admin", mode: "insensitive" as const } },
    ],
  },
};
