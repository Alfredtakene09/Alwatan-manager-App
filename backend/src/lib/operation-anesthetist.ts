/**
 * Anesthésiste obligatoire (avec son %) pour toute opération enregistrée,
 * sauf en Ophtalmologie et en Odontologie.
 */

const ANESTHETIST_OPTIONAL_SERVICE_KEYS = ["ophtalm", "odonto"];

function foldServiceName(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

export function isAnesthetistOptionalService(serviceName: string | null | undefined) {
  const folded = foldServiceName(serviceName);
  return ANESTHETIST_OPTIONAL_SERVICE_KEYS.some((key) => folded.includes(key));
}

export type OperationAnesthetistInput = {
  anesthesiologistId?: string | null;
  anesthesiologistName?: string | null;
  anesthesiologistPercent?: number | null;
} | null | undefined;

/** Une personne choisie (compte ou employé) et un % entre 1 et 99. */
export function hasOperationAnesthetist(assistant: OperationAnesthetistInput) {
  if (!assistant) return false;
  const who = !!assistant.anesthesiologistId?.trim() || !!assistant.anesthesiologistName?.trim();
  const percent = assistant.anesthesiologistPercent ?? 0;
  return who && percent >= 1 && percent <= 99;
}

export const OPERATION_ANESTHETIST_REQUIRED_MESSAGE =
  "Choisissez l'anesthésiste et son % (obligatoire, sauf Ophtalmologie et Odontologie).";

/** Null si tout va bien, sinon le message d'erreur à renvoyer. */
export function operationAnesthetistError(
  serviceName: string | null | undefined,
  assistant: OperationAnesthetistInput,
) {
  if (isAnesthetistOptionalService(serviceName)) return null;
  return hasOperationAnesthetist(assistant) ? null : OPERATION_ANESTHETIST_REQUIRED_MESSAGE;
}
