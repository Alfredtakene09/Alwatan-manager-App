import type { AppUserRole } from "./roles.js";

/** Rôles dont on peut masquer des boutons (pas Admin ni Direction). */
export const UI_ACTION_TARGET_ROLES = [
  "GESTIONNAIRE",
  "RECEPTIONNISTE",
  "MEDECIN",
  "LABORANTIN",
  "SOIGNANT",
  "PHARMACIEN",
  "LOGISTIQUE",
] as const satisfies readonly AppUserRole[];

export type UiActionTargetRole = (typeof UI_ACTION_TARGET_ROLES)[number];

export const UI_ACTION_IDS = [
  "table.create",
  "table.edit",
  "table.delete",
  "table.toggle",
  "export.pdf",
  "export.excel",
  "export.print",
  "dossier.attach",
  "reception.create_patient",
  "reception.edit_patient",
  "reception.delete_patient",
  "reception.reconsult",
  "reception.print_receipt",
  "reception.pay_consultation",
  "users.create",
  "employees.create",
  "pharmacie.catalog",
  "lab.stock",
  "lab.result_forms",
  "comptabilite.reduction",
  "comptabilite.encaissements",
  "comptabilite.journal",
  "comptabilite.depenses",
  "comptabilite.salaires",
  "comptabilite.factures",
  "comptabilite.exam_payments",
  "catalog.exam_types",
  "catalog.operation_types",
  "catalog.services",
  "hospitalisation.rooms",
] as const;

export type UiActionId = (typeof UI_ACTION_IDS)[number];

const ACTION_ID_SET = new Set<string>(UI_ACTION_IDS);
const TARGET_ROLE_SET = new Set<string>(UI_ACTION_TARGET_ROLES);

export function isUiActionId(value: string): value is UiActionId {
  return ACTION_ID_SET.has(value);
}

export function isUiActionTargetRole(value: string): value is UiActionTargetRole {
  return TARGET_ROLE_SET.has(value);
}

export type HiddenByRole = Partial<Record<UiActionTargetRole, UiActionId[]>>;

export function parseHiddenByRole(raw: unknown): HiddenByRole {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const result: HiddenByRole = {};
  for (const [role, ids] of Object.entries(raw as Record<string, unknown>)) {
    if (!isUiActionTargetRole(role) || !Array.isArray(ids)) continue;
    const cleaned = [
      ...new Set(ids.filter((id): id is string => typeof id === "string" && isUiActionId(id))),
    ] as UiActionId[];
    if (cleaned.length) result[role] = cleaned;
  }
  return result;
}

export function parseHiddenUiActionList(raw: unknown): UiActionId[] {
  if (!Array.isArray(raw)) return [];
  return [
    ...new Set(raw.filter((id): id is string => typeof id === "string" && isUiActionId(id))),
  ] as UiActionId[];
}

export function mergeHiddenUiActions(
  role: AppUserRole,
  roleHidden: readonly UiActionId[],
  userHidden: readonly UiActionId[],
): UiActionId[] {
  if (role === "ADMIN" || role === "COMPTABLE") return [];
  return [...new Set([...roleHidden, ...userHidden])];
}

export function hiddenUiActionsForRole(role: AppUserRole, hiddenByRole: HiddenByRole): UiActionId[] {
  if (role === "ADMIN" || role === "COMPTABLE") return [];
  if (!isUiActionTargetRole(role)) return [];
  return hiddenByRole[role] ?? [];
}
