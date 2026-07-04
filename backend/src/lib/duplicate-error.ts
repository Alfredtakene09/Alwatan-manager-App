/** Réponse HTTP standardisée lorsqu'un doublon métier est détecté. */
export type DuplicateEntity =
  | "patient"
  | "intervention"
  | "exam_catalog"
  | "surgery_case"
  | "visit"
  | "product"
  | "room"
  | "user";

export type DuplicateErrorBody = {
  error: string;
  code: "DUPLICATE";
  entity: DuplicateEntity;
  existing: Record<string, unknown>;
};

export function duplicateErrorResponse(
  entity: DuplicateEntity,
  message: string,
  existing: Record<string, unknown>,
): DuplicateErrorBody {
  return {
    error: message,
    code: "DUPLICATE",
    entity,
    existing,
  };
}

export function isDuplicateErrorBody(value: unknown): value is DuplicateErrorBody {
  if (!value || typeof value !== "object") return false;
  const body = value as Record<string, unknown>;
  return body.code === "DUPLICATE" && typeof body.entity === "string" && typeof body.error === "string";
}
