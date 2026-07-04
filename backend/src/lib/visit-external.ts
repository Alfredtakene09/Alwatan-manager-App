export const EXTERNAL_PATIENT_VISIT_NOTE = "PATIENT_EXTERNE";

export const EXTERNAL_EXAMS_PENDING_NOTE = "Patient externe — examens en attente";

/** Ancienne note de dossier ONG (données historiques uniquement). */
export const ONG_EXAMS_PENDING_NOTE = "Patient ONG — examens en attente";

export function isExternalPatientVisit(notes?: string | null): boolean {
  return !!notes?.includes(EXTERNAL_PATIENT_VISIT_NOTE);
}
