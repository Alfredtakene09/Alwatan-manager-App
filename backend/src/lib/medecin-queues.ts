import { PatientCategory, VisitStatus, type Prisma } from "@prisma/client";
import { EXAMS_PRESCRIBED_PREFIX } from "./lab-notes.js";

/** Patient assigné à la réception / transféré, ou déjà pris en charge en consultation. */
export function medecinMatchWhere(doctorId: string): Prisma.VisitWhereInput {
  return {
    OR: [{ assignedDoctorId: doctorId }, { consultation: { is: { doctorId } } }],
  };
}

export function visitBelongsToDoctor(
  visit: {
    assignedDoctorId: string | null;
    consultation?: { doctorId: string | null } | null;
  },
  doctorId: string,
): boolean {
  return visit.assignedDoctorId === doctorId || visit.consultation?.doctorId === doctorId;
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
 * File « Déjà consulté » :
 * patients avec examens prescrits, paiement réception en attente (labSentToLabAt null)
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

/** File de consultation — uniquement les patients assignés ou transférés au médecin. */
export function medecinPendingConsultationVisitWhere(doctorId: string): Prisma.VisitWhereInput {
  return {
    status: { in: [VisitStatus.WAITING_CONSULTATION, VisitStatus.IN_CONSULTATION] },
    NOT: {
      consultation: {
        clinicalNotes: { contains: EXAMS_PRESCRIBED_PREFIX },
      },
    },
    AND: [medecinMatchWhere(doctorId)],
  };
}
