export const EXTERNAL_PATIENT_VISIT_NOTE = "PATIENT_EXTERNE";
export const EXTERNAL_PATIENT_SERVICE_PREFIX = "SERVICE_EXTERNE:";

export const EXTERNAL_EXAMS_PENDING_NOTE = "Patient externe — examens en attente";

/** Ancienne note de dossier ONG (données historiques uniquement). */
export const ONG_EXAMS_PENDING_NOTE = "Patient ONG — examens en attente";

export function isExternalPatientVisit(notes?: string | null): boolean {
  return !!notes?.includes(EXTERNAL_PATIENT_VISIT_NOTE);
}

export function buildExternalPatientVisitNote(service?: string | null): string {
  const normalizedService = service?.trim();
  if (!normalizedService) return EXTERNAL_PATIENT_VISIT_NOTE;
  return `${EXTERNAL_PATIENT_VISIT_NOTE}\n${EXTERNAL_PATIENT_SERVICE_PREFIX}${normalizedService}`;
}

export function extractExternalPatientService(notes?: string | null): string | null {
  if (!notes) return null;
  const line = notes
    .split("\n")
    .map((item) => item.trim())
    .find((item) => item.startsWith(EXTERNAL_PATIENT_SERVICE_PREFIX));
  if (!line) return null;
  const value = line.slice(EXTERNAL_PATIENT_SERVICE_PREFIX.length).trim();
  return value || null;
}
