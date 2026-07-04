import {
  ConsultationRenewalPolicy,
  InvoiceStatus,
  InvoiceType,
  PatientCategory,
  UserRole,
} from "@prisma/client";
import { prisma } from "./db.js";
import {
  doctorRequiresConsultationFee,
  resolveDoctorConsultationAmount,
  type DoctorProfile,
} from "./doctor-compensation.js";
import { isExemptPatient } from "./patient-billing.js";

export type ConsultationRenewalResult = {
  amountFcfa: number;
  baseAmountFcfa: number;
  withinValidity: boolean;
  renewalRequired: boolean;
  daysSinceLastPaid: number | null;
  validityDays: number | null;
  renewalPolicy: ConsultationRenewalPolicy | null;
  lastPaidAt: string | null;
  message: string;
};

function startOfLocalDay(date: Date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function daysBetween(from: Date, to: Date) {
  const start = startOfLocalDay(from).getTime();
  const end = startOfLocalDay(to).getTime();
  return Math.floor((end - start) / (24 * 60 * 60 * 1000));
}

export async function findLastPaidConsultationDate(patientId: string, doctorId: string) {
  const invoice = await prisma.invoice.findFirst({
    where: {
      type: InvoiceType.CONSULTATION,
      status: InvoiceStatus.PAID,
      patientId,
      visit: {
        OR: [{ assignedDoctorId: doctorId }, { consultation: { is: { doctorId } } }],
      },
    },
    orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
    select: { paidAt: true, createdAt: true },
  });

  if (!invoice) return null;
  return invoice.paidAt ?? invoice.createdAt;
}

export function renewalAmountFromBase(
  baseAmountFcfa: number,
  policy: ConsultationRenewalPolicy,
) {
  if (baseAmountFcfa <= 0) return 0;
  if (policy === ConsultationRenewalPolicy.HALF) {
    return Math.round(baseAmountFcfa / 2);
  }
  return baseAmountFcfa;
}

export function computeConsultationRenewalFee(input: {
  category: PatientCategory;
  doctor: DoctorProfile & {
    employee?: {
      consultationValidityDays?: number | null;
      consultationRenewalPolicy?: ConsultationRenewalPolicy | null;
    } | null;
  };
  requestedAmount?: number | null;
  lastPaidAt?: Date | null;
  now?: Date;
}): ConsultationRenewalResult {
  const now = input.now ?? new Date();
  const validityDays = input.doctor.employee?.consultationValidityDays ?? null;
  const renewalPolicy =
    input.doctor.employee?.consultationRenewalPolicy ?? ConsultationRenewalPolicy.FULL;

  const baseAmountFcfa = doctorRequiresConsultationFee(input.doctor)
    ? resolveDoctorConsultationAmount(input.doctor, input.requestedAmount)
    : Math.max(0, input.requestedAmount ?? 0);

  if (isExemptPatient(input.category)) {
    return {
      amountFcfa: 0,
      baseAmountFcfa: 0,
      withinValidity: false,
      renewalRequired: false,
      daysSinceLastPaid: null,
      validityDays,
      renewalPolicy,
      lastPaidAt: null,
      message: "Patient exonéré",
    };
  }

  if (!doctorRequiresConsultationFee(input.doctor) || !validityDays || validityDays <= 0) {
    return {
      amountFcfa: baseAmountFcfa,
      baseAmountFcfa,
      withinValidity: false,
      renewalRequired: baseAmountFcfa > 0,
      daysSinceLastPaid: null,
      validityDays,
      renewalPolicy,
      lastPaidAt: input.lastPaidAt?.toISOString() ?? null,
      message:
        baseAmountFcfa > 0
          ? `Consultation ${baseAmountFcfa.toLocaleString("fr-FR")} FCFA`
          : "Montant à saisir à la réception",
    };
  }

  if (!input.lastPaidAt) {
    return {
      amountFcfa: baseAmountFcfa,
      baseAmountFcfa,
      withinValidity: false,
      renewalRequired: true,
      daysSinceLastPaid: null,
      validityDays,
      renewalPolicy,
      lastPaidAt: null,
      message: `Première consultation — ${baseAmountFcfa.toLocaleString("fr-FR")} FCFA`,
    };
  }

  const daysSinceLastPaid = daysBetween(input.lastPaidAt, now);

  if (daysSinceLastPaid < validityDays) {
    const remaining = validityDays - daysSinceLastPaid;
    return {
      amountFcfa: 0,
      baseAmountFcfa,
      withinValidity: true,
      renewalRequired: false,
      daysSinceLastPaid,
      validityDays,
      renewalPolicy,
      lastPaidAt: input.lastPaidAt.toISOString(),
      message: `Consultation encore valide (${remaining} jour(s) restant(s))`,
    };
  }

  const amountFcfa = renewalAmountFromBase(baseAmountFcfa, renewalPolicy);
  const policyLabel =
    renewalPolicy === ConsultationRenewalPolicy.HALF
      ? "renouvellement à 50 %"
      : "renouvellement plein tarif";

  return {
    amountFcfa,
    baseAmountFcfa,
    withinValidity: false,
    renewalRequired: true,
    daysSinceLastPaid,
    validityDays,
    renewalPolicy,
    lastPaidAt: input.lastPaidAt.toISOString(),
    message: `Validité expirée (${daysSinceLastPaid} j) — ${policyLabel} : ${amountFcfa.toLocaleString("fr-FR")} FCFA`,
  };
}

export async function resolveConsultationFeeForPatientDoctor(input: {
  patientId: string;
  doctorId: string;
  requestedAmount?: number | null;
}) {
  const [patient, doctor] = await Promise.all([
    prisma.patient.findUnique({
      where: { id: input.patientId },
      select: { id: true, category: true },
    }),
    prisma.user.findFirst({
      where: { id: input.doctorId, role: UserRole.MEDECIN, active: true },
      select: {
        role: true,
        employee: {
          select: {
            isMedecin: true,
            doctorCompensationType: true,
            consultationTotalFcfa: true,
            consultationQuotaMode: true,
            consultationQuotaPercent: true,
            consultationQuotaFcfa: true,
            consultationValidityDays: true,
            consultationRenewalPolicy: true,
          },
        },
      },
    }),
  ]);

  if (!patient) {
    throw new Error("PATIENT_NOT_FOUND");
  }
  if (!doctor) {
    throw new Error("DOCTOR_NOT_FOUND");
  }

  const lastPaidAt = await findLastPaidConsultationDate(input.patientId, input.doctorId);

  return computeConsultationRenewalFee({
    category: patient.category,
    doctor,
    requestedAmount: input.requestedAmount,
    lastPaidAt,
  });
}
