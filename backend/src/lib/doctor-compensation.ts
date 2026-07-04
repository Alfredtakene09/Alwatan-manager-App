import { ConsultationQuotaMode, ConsultationRenewalPolicy, DoctorCompensationType, UserRole } from "@prisma/client";

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
  if (profile.role !== UserRole.MEDECIN || !profile.employee?.isMedecin) {
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
  return user.role === UserRole.MEDECIN;
}

export function doctorUsesQuota(user: DoctorProfile) {
  if (!isMedecin(user)) return false;
  const comp = readCompensation(user);
  return comp.doctorCompensationType !== DoctorCompensationType.FIXED_SALARY;
}

export function doctorRequiresConsultationFee(user: DoctorProfile) {
  return doctorUsesQuota(user);
}

export function resolveDoctorConsultationAmount(
  user: DoctorProfile,
  requestedAmount?: number | null,
) {
  if (!doctorRequiresConsultationFee(user)) return 0;
  if (requestedAmount != null && requestedAmount > 0) return requestedAmount;
  return readCompensation(user).consultationTotalFcfa ?? 0;
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

export function employeeCompensationData(
  isMedecin: boolean,
  body: {
    doctorCompensationType?: DoctorCompensationType;
    consultationTotalFcfa?: number;
    consultationQuotaMode?: ConsultationQuotaMode;
    consultationQuotaPercent?: number;
    consultationQuotaFcfa?: number;
    consultationValidityDays?: number;
    consultationRenewalPolicy?: ConsultationRenewalPolicy;
    surgeryQuotaPercent?: number;
    fixedSalaryFcfa?: number;
  },
) {
  if (!isMedecin) {
    return {
      doctorCompensationType: DoctorCompensationType.QUOTA,
      consultationTotalFcfa: null,
      consultationQuotaMode: ConsultationQuotaMode.PERCENT,
      consultationQuotaPercent: null,
      consultationQuotaFcfa: null,
      consultationValidityDays: null,
      consultationRenewalPolicy: ConsultationRenewalPolicy.FULL,
      surgeryQuotaPercent: null,
      fixedSalaryFcfa: body.fixedSalaryFcfa ?? null,
    };
  }
  const type = body.doctorCompensationType ?? DoctorCompensationType.QUOTA;
  const isSalary = type === DoctorCompensationType.FIXED_SALARY;
  const quotaMode = body.consultationQuotaMode ?? ConsultationQuotaMode.PERCENT;
  return {
    doctorCompensationType: type,
    consultationTotalFcfa: isSalary ? null : body.consultationTotalFcfa ?? null,
    consultationQuotaMode: isSalary ? ConsultationQuotaMode.PERCENT : quotaMode,
    consultationQuotaPercent:
      isSalary || quotaMode !== ConsultationQuotaMode.PERCENT
        ? null
        : body.consultationQuotaPercent ?? null,
    consultationQuotaFcfa:
      isSalary || quotaMode !== ConsultationQuotaMode.FIXED_AMOUNT
        ? null
        : body.consultationQuotaFcfa ?? null,
    consultationValidityDays: isSalary ? null : body.consultationValidityDays ?? null,
    consultationRenewalPolicy: isSalary
      ? ConsultationRenewalPolicy.FULL
      : body.consultationRenewalPolicy ?? ConsultationRenewalPolicy.FULL,
    surgeryQuotaPercent: isSalary ? null : body.surgeryQuotaPercent ?? null,
    fixedSalaryFcfa: isSalary ? body.fixedSalaryFcfa ?? null : null,
  };
}
