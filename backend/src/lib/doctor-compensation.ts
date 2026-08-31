import { ConsultationQuotaMode, ConsultationRenewalPolicy, DoctorCompensationType, UserRole, type Prisma } from "@prisma/client";
import { isSurgeryAssistantJobTitle } from "./doctor-profile.js";

export type EmployeeCompensation = {
  isMedecin?: boolean;
  doctorCompensationType?: DoctorCompensationType | null;
  consultationTotalFcfa?: number | null;
  consultationQuotaMode?: ConsultationQuotaMode | null;
  consultationQuotaPercent?: number | null;
  consultationQuotaFcfa?: number | null;
  consultationValidityDays?: number | null;
  consultationRenewalPolicy?: ConsultationRenewalPolicy | null;
  surgeryQuotaPercent?: number | null;
};

export type DoctorProfile = {
  role: UserRole;
  employee?: EmployeeCompensation | null;
};

function readCompensation(profile: DoctorProfile) {
  if (!profile.employee?.isMedecin) {
    return {
      doctorCompensationType: DoctorCompensationType.FIXED_SALARY,
      consultationTotalFcfa: null as number | null,
      consultationQuotaMode: ConsultationQuotaMode.PERCENT,
      consultationQuotaPercent: null as number | null,
      consultationQuotaFcfa: null as number | null,
    };
  }
  return {
    doctorCompensationType:
      profile.employee.doctorCompensationType ?? DoctorCompensationType.QUOTA,
    consultationTotalFcfa: profile.employee.consultationTotalFcfa ?? null,
    consultationQuotaMode:
      profile.employee.consultationQuotaMode ?? ConsultationQuotaMode.PERCENT,
    consultationQuotaPercent: profile.employee.consultationQuotaPercent ?? null,
    consultationQuotaFcfa: profile.employee.consultationQuotaFcfa ?? null,
    surgeryQuotaPercent: profile.employee.surgeryQuotaPercent ?? null,
  };
}

export function isMedecin(user: DoctorProfile) {
  return user.role === UserRole.MEDECIN || Boolean(user.employee?.isMedecin);
}

/** Filtre Prisma : médecins sélectionnables (actifs) pour réception / transfert / listes. */
export const selectableDoctorWhere: Prisma.UserWhereInput = {
  active: true,
  role: { not: UserRole.ADMIN },
  employee: { is: { active: true } },
  OR: [{ role: UserRole.MEDECIN }, { employee: { is: { isMedecin: true } } }],
};

/** Alias historique — même périmètre (plus de filtre « en pause »). */
export const selectableDoctorIncludingPausedWhere: Prisma.UserWhereInput = selectableDoctorWhere;

export function selectableDoctorByIdWhere(doctorId: string) {
  return {
    id: doctorId,
    ...selectableDoctorWhere,
  };
}

export function doctorUsesQuota(user: DoctorProfile) {
  if (!isMedecin(user)) return false;
  const type = readCompensation(user).doctorCompensationType;
  return (
    type === DoctorCompensationType.QUOTA || type === DoctorCompensationType.COMBINED
  );
}

export function doctorUsesFixedSalary(user: DoctorProfile) {
  if (!isMedecin(user)) return false;
  const type = readCompensation(user).doctorCompensationType;
  return (
    type === DoctorCompensationType.FIXED_SALARY ||
    type === DoctorCompensationType.COMBINED
  );
}

/** Facturation patient : quota (toujours) ou salaire fixe dès qu’un tarif est configuré. */
export function doctorRequiresConsultationFee(user: DoctorProfile) {
  if (!isMedecin(user)) return false;
  if (doctorUsesQuota(user)) return true;
  return (readCompensation(user).consultationTotalFcfa ?? 0) > 0;
}

export function resolveDoctorConsultationAmount(
  user: DoctorProfile,
  requestedAmount?: number | null,
) {
  if (requestedAmount != null && requestedAmount > 0) return requestedAmount;
  const configured = readCompensation(user).consultationTotalFcfa ?? 0;
  if (configured > 0) return configured;
  if (!doctorRequiresConsultationFee(user)) return 0;
  return 0;
}

export function computeConsultationShares(
  totalFcfa: number,
  quotaPercent: number,
  quotaFcfa: number | null | undefined,
  quotaMode: ConsultationQuotaMode,
  doctor: DoctorProfile,
) {
  if (!doctorUsesQuota(doctor) || totalFcfa <= 0) {
    return { doctorShareFcfa: 0, clinicShareFcfa: totalFcfa };
  }
  if (
    quotaMode === ConsultationQuotaMode.FIXED_AMOUNT &&
    quotaFcfa != null &&
    quotaFcfa >= 0
  ) {
    const doctorShareFcfa = Math.min(quotaFcfa, totalFcfa);
    return {
      doctorShareFcfa,
      clinicShareFcfa: totalFcfa - doctorShareFcfa,
    };
  }
  const doctorShareFcfa = Math.round((totalFcfa * quotaPercent) / 100);
  return {
    doctorShareFcfa,
    clinicShareFcfa: totalFcfa - doctorShareFcfa,
  };
}

export function computeSurgeryShares(
  totalCostFcfa: number,
  surgeonPercent: number,
  surgeon: DoctorProfile,
) {
  if (!doctorUsesQuota(surgeon)) {
    return { surgeonShareFcfa: 0, clinicShareFcfa: totalCostFcfa };
  }
  const percent = surgeon.employee?.surgeryQuotaPercent ?? surgeonPercent;
  const surgeonShareFcfa = Math.round((totalCostFcfa * percent) / 100);
  return {
    surgeonShareFcfa,
    clinicShareFcfa: totalCostFcfa - surgeonShareFcfa,
  };
}

export function resolveSurgeonPercent(
  interventionSurgeonPercent: number,
  surgeon: DoctorProfile,
) {
  if (!doctorUsesQuota(surgeon)) return 0;
  return surgeon.employee?.surgeryQuotaPercent ?? interventionSurgeonPercent;
}

export const DOCTOR_COMPENSATION_LABELS: Record<DoctorCompensationType, string> = {
  [DoctorCompensationType.QUOTA]: "Quota (consultations & chirurgies)",
  [DoctorCompensationType.FIXED_SALARY]: "Salaire fixe",
  [DoctorCompensationType.COMBINED]: "Salaire + quota",
};

export function serializeDoctorFields(user: DoctorProfile) {
  const comp = readCompensation(user);
  const total = comp.consultationTotalFcfa;
  const shares =
    total != null && total > 0
      ? computeConsultationShares(
          total,
          comp.consultationQuotaPercent ?? 0,
          comp.consultationQuotaFcfa,
          comp.consultationQuotaMode,
          user,
        )
      : null;

  return {
    doctorCompensationType: comp.doctorCompensationType,
    consultationTotalFcfa: total,
    consultationQuotaMode: comp.consultationQuotaMode,
    consultationQuotaPercent: comp.consultationQuotaPercent,
    consultationQuotaFcfa: comp.consultationQuotaFcfa,
    consultationValidityDays: user.employee?.consultationValidityDays ?? null,
    consultationRenewalPolicy:
      user.employee?.consultationRenewalPolicy ?? ConsultationRenewalPolicy.FULL,
    doctorConsultationShareFcfa: shares?.doctorShareFcfa ?? null,
    requiresConsultationFee: doctorRequiresConsultationFee(user),
  };
}

type CompensationBody = {
  jobTitle?: string | null;
  doctorCompensationType?: DoctorCompensationType;
  consultationTotalFcfa?: number | null;
  consultationQuotaMode?: ConsultationQuotaMode;
  consultationQuotaPercent?: number | null;
  consultationQuotaFcfa?: number | null;
  consultationValidityDays?: number | null;
  consultationRenewalPolicy?: ConsultationRenewalPolicy;
  surgeryQuotaPercent?: number | null;
  fixedSalaryFcfa?: number | null;
};

type ExistingCompensation = {
  doctorCompensationType?: DoctorCompensationType | null;
  consultationTotalFcfa?: number | null;
  consultationQuotaMode?: ConsultationQuotaMode | null;
  consultationQuotaPercent?: number | null;
  consultationQuotaFcfa?: number | null;
  consultationValidityDays?: number | null;
  consultationRenewalPolicy?: ConsultationRenewalPolicy | null;
  surgeryQuotaPercent?: number | null;
  fixedSalaryFcfa?: number | null;
};

function pickCompensationField<T>(
  bodyValue: T | undefined,
  existingValue: T | null | undefined,
  fallback: T | null = null,
): T | null {
  if (bodyValue !== undefined) return bodyValue as T | null;
  if (existingValue !== undefined && existingValue !== null) return existingValue;
  return fallback;
}

export function employeeCompensationData(
  isMedecin: boolean,
  body: CompensationBody,
  existing?: ExistingCompensation | null,
) {
  const keepSurgeryPercent =
    isSurgeryAssistantJobTitle(body.jobTitle) || isMedecin;
  if (!isMedecin) {
    return {
      doctorCompensationType: DoctorCompensationType.QUOTA,
      consultationTotalFcfa: null,
      consultationQuotaMode: ConsultationQuotaMode.PERCENT,
      consultationQuotaPercent: null,
      consultationQuotaFcfa: null,
      consultationValidityDays: null,
      consultationRenewalPolicy: ConsultationRenewalPolicy.FULL,
      surgeryQuotaPercent: keepSurgeryPercent
        ? pickCompensationField(body.surgeryQuotaPercent, existing?.surgeryQuotaPercent)
        : null,
      fixedSalaryFcfa: pickCompensationField(body.fixedSalaryFcfa, existing?.fixedSalaryFcfa),
    };
  }
  const type =
    body.doctorCompensationType ??
    existing?.doctorCompensationType ??
    DoctorCompensationType.QUOTA;
  const usesQuota =
    type === DoctorCompensationType.QUOTA || type === DoctorCompensationType.COMBINED;
  const usesSalary =
    type === DoctorCompensationType.FIXED_SALARY ||
    type === DoctorCompensationType.COMBINED;
  const quotaMode =
    body.consultationQuotaMode ??
    existing?.consultationQuotaMode ??
    ConsultationQuotaMode.PERCENT;
  // Tarif patient : utile aussi en salaire fixe (préremplissage réception).
  const consultationTotalFcfa =
    usesQuota || type === DoctorCompensationType.FIXED_SALARY
      ? pickCompensationField(body.consultationTotalFcfa, existing?.consultationTotalFcfa)
      : null;
  return {
    doctorCompensationType: type,
    consultationTotalFcfa,
    consultationQuotaMode: usesQuota ? quotaMode : ConsultationQuotaMode.PERCENT,
    consultationQuotaPercent:
      !usesQuota || quotaMode !== ConsultationQuotaMode.PERCENT
        ? null
        : pickCompensationField(
            body.consultationQuotaPercent,
            existing?.consultationQuotaPercent,
          ),
    consultationQuotaFcfa:
      !usesQuota || quotaMode !== ConsultationQuotaMode.FIXED_AMOUNT
        ? null
        : pickCompensationField(body.consultationQuotaFcfa, existing?.consultationQuotaFcfa),
    consultationValidityDays: usesQuota
      ? pickCompensationField(
          body.consultationValidityDays,
          existing?.consultationValidityDays,
        )
      : null,
    consultationRenewalPolicy: usesQuota
      ? body.consultationRenewalPolicy ??
        existing?.consultationRenewalPolicy ??
        ConsultationRenewalPolicy.FULL
      : ConsultationRenewalPolicy.FULL,
    surgeryQuotaPercent:
      usesQuota || isSurgeryAssistantJobTitle(body.jobTitle)
        ? pickCompensationField(body.surgeryQuotaPercent, existing?.surgeryQuotaPercent)
        : null,
    fixedSalaryFcfa: usesSalary
      ? pickCompensationField(body.fixedSalaryFcfa, existing?.fixedSalaryFcfa)
      : null,
  };
}
