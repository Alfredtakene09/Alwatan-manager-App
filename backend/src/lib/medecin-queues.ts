import { PatientCategory, VisitStatus, type Prisma } from "@prisma/client";
import { EXAMS_PRESCRIBED_PREFIX } from "./lab-notes.js";
import { resolveDoctorClinicServices } from "./clinic-service-exam.js";

/** Patient assigné à la réception / transféré, ou déjà pris en charge en consultation. */
export function medecinMatchWhere(
  doctorId: string,
  clinicServiceIds: string[] = [],
): Prisma.VisitWhereInput {
  const or: Prisma.VisitWhereInput[] = [
    { assignedDoctorId: doctorId },
    { consultation: { is: { doctorId } } },
  ];

  // File partagée d’un service : visible tant qu’aucun médecin n’a démarré (assignedDoctorId null).
  if (clinicServiceIds.length > 0) {
    or.push({
      assignedDoctorId: null,
      assignedClinicServiceId: { in: clinicServiceIds },
      status: VisitStatus.WAITING_CONSULTATION,
    });
  }

  return { OR: or };
}

export function visitBelongsToDoctor(
  visit: {
    assignedDoctorId: string | null;
    assignedClinicServiceId?: string | null;
    status?: VisitStatus | string | null;
    consultation?: { doctorId: string | null } | null;
  },
  doctorId: string,
  clinicServiceIds: string[] = [],
): boolean {
  if (visit.assignedDoctorId === doctorId || visit.consultation?.doctorId === doctorId) {
    return true;
  }

  // Patient en attente sur un service du médecin (pas encore pris en charge).
  return (
    visit.status === VisitStatus.WAITING_CONSULTATION &&
    !visit.assignedDoctorId &&
    Boolean(visit.assignedClinicServiceId) &&
    clinicServiceIds.includes(visit.assignedClinicServiceId!)
  );
}

export async function resolveDoctorQueueContext(doctorId: string) {
  const services = await resolveDoctorClinicServices(doctorId);
  return {
    doctorId,
    clinicServiceIds: services?.ids ?? [],
  };
}

export function medecinPatientWhere(doctorId: string, patientId: string): Prisma.VisitWhereInput {
  return {
    patientId,
    ...medecinMatchWhere(doctorId),
  };
}

const prescribedConsultationWhere: Prisma.ConsultationWhereInput = {
  clinicalNotes: { contains: EXAMS_PRESCRIBED_PREFIX },
};

/**
 * File « Déjà consulté » (compteur / file paiement) :
 * examens prescrits, paiement réception en attente (labSentToLabAt null).
 */
export function medecinDejaConsulteVisitWhere(doctorId: string): Prisma.VisitWhereInput {
  return {
    status: { notIn: [VisitStatus.COMPLETED, VisitStatus.CANCELLED] },
    AND: [
      medecinMatchWhere(doctorId),
      {
        patient: { category: { in: [PatientCategory.STANDARD, PatientCategory.ONG] } },
        consultation: {
          is: {
            ...prescribedConsultationWhere,
            labSentToLabAt: null,
          },
        },
      },
    ],
  };
}

/**
 * Liste page « Déjà consulté » :
 * — en attente de paiement (comme ci-dessus)
 * — + consultations clôturées aujourd'hui (ex. acte « Consultation » seule)
 */
export function medecinDejaConsulteListVisitWhere(
  doctorId: string,
  startOfToday: Date,
): Prisma.VisitWhereInput {
  return {
    AND: [
      medecinMatchWhere(doctorId),
      {
        patient: { category: { in: [PatientCategory.STANDARD, PatientCategory.ONG] } },
        OR: [
          {
            status: { notIn: [VisitStatus.COMPLETED, VisitStatus.CANCELLED] },
            consultation: {
              is: {
                ...prescribedConsultationWhere,
                labSentToLabAt: null,
              },
            },
          },
          {
            status: VisitStatus.COMPLETED,
            consultation: {
              is: {
                doctorId,
                completedAt: { gte: startOfToday },
              },
            },
          },
        ],
      },
    ],
  };
}

/** Consultations avec prescription effectuées aujourd'hui par le médecin. */
export function medecinPrescribedTodayVisitWhere(
  doctorId: string,
  startOfToday: Date,
): Prisma.VisitWhereInput {
  return {
    AND: [
      medecinMatchWhere(doctorId),
      {
        consultation: {
          is: {
            updatedAt: { gte: startOfToday },
            ...prescribedConsultationWhere,
          },
        },
      },
    ],
  };
}

/** File de consultation — patients assignés, ou en attente sur un service du médecin. */
export function medecinPendingConsultationVisitWhere(
  doctorId: string,
  clinicServiceIds: string[] = [],
): Prisma.VisitWhereInput {
  return {
    status: { in: [VisitStatus.WAITING_CONSULTATION, VisitStatus.IN_CONSULTATION] },
    NOT: {
      consultation: {
        clinicalNotes: { contains: EXAMS_PRESCRIBED_PREFIX },
      },
    },
    AND: [medecinMatchWhere(doctorId, clinicServiceIds)],
  };
}
