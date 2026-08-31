import { InvoiceType, type Prisma } from "@prisma/client";
import { EXAMS_PRESCRIBED_PREFIX } from "./lab-notes.js";

/** Patients ayant au moins un examen prescrit, envoyé au labo, ou facturé. */
export function patientsWhoReceivedExamsWhere(
  patientWhere: Prisma.PatientWhereInput = {},
): Prisma.PatientWhereInput {
  return {
    ...patientWhere,
    visits: {
      some: {
        OR: [
          { invoices: { some: { type: InvoiceType.LAB_EXAM } } },
          {
            consultation: {
              OR: [
                { clinicalNotes: { contains: EXAMS_PRESCRIBED_PREFIX } },
                { labSentToLabAt: { not: null } },
              ],
            },
          },
        ],
      },
    },
  };
}
