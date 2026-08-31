import { prisma } from "./db.js";
import {
  hiddenUiActionsForRole,
  mergeHiddenUiActions,
  parseHiddenByRole,
  parseHiddenUiActionList,
  type HiddenByRole,
  type UiActionId,
} from "./ui-actions.js";
import type { AppUserRole } from "./roles.js";

const SETTINGS_ID = "default";

export async function ensureRoleUiSettingsRow() {
  await prisma.roleUiSettings.upsert({
    where: { id: SETTINGS_ID },
    create: { id: SETTINGS_ID, hiddenByRole: {} },
    update: {},
  });
}

export async function getHiddenByRole(): Promise<HiddenByRole> {
  const row = await prisma.roleUiSettings.findUnique({
    where: { id: SETTINGS_ID },
    select: { hiddenByRole: true },
  });
  return parseHiddenByRole(row?.hiddenByRole);
}

export async function getHiddenUiActionsForRole(role: AppUserRole): Promise<UiActionId[]> {
  const hiddenByRole = await getHiddenByRole();
  return hiddenUiActionsForRole(role, hiddenByRole);
}

export async function getEffectiveHiddenUiActions(
  role: AppUserRole,
  userHiddenRaw?: unknown,
): Promise<UiActionId[]> {
  const roleHidden = await getHiddenUiActionsForRole(role);
  const userHidden = parseHiddenUiActionList(userHiddenRaw);
  return mergeHiddenUiActions(role, roleHidden, userHidden);
}

export async function saveHiddenByRole(hiddenByRole: HiddenByRole, updatedById?: string) {
  const cleaned = parseHiddenByRole(hiddenByRole);
  await prisma.roleUiSettings.upsert({
    where: { id: SETTINGS_ID },
    create: { id: SETTINGS_ID, hiddenByRole: cleaned, updatedById: updatedById ?? null },
    update: { hiddenByRole: cleaned, updatedById: updatedById ?? null },
  });
  return cleaned;
}
