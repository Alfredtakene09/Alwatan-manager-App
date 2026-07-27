import { UserRole } from "@prisma/client";
import { prisma } from "./db.js";

export const LAST_ACTIVE_ADMIN_ERROR =
  "Impossible : il doit rester au moins un administrateur actif dans le système.";

export async function countOtherActiveAdmins(excludeUserId: string): Promise<number> {
  return prisma.user.count({
    where: {
      role: UserRole.ADMIN,
      active: true,
      id: { not: excludeUserId },
    },
  });
}

/** Bloque si la modification retirerait le dernier administrateur actif. */
export async function assertMaintainsActiveAdmin(params: {
  existing: { id: string; role: UserRole; active: boolean };
  nextRole?: UserRole;
  nextActive?: boolean;
}): Promise<string | null> {
  const { existing } = params;
  const nextRole = params.nextRole ?? existing.role;
  const nextActive = params.nextActive ?? existing.active;

  const wasActiveAdmin = existing.role === UserRole.ADMIN && existing.active;
  const willBeActiveAdmin = nextRole === UserRole.ADMIN && nextActive;

  if (wasActiveAdmin && !willBeActiveAdmin) {
    const others = await countOtherActiveAdmins(existing.id);
    if (others === 0) return LAST_ACTIVE_ADMIN_ERROR;
  }
  return null;
}

export async function canHardDeleteUser(user: {
  id: string;
  role: UserRole;
  active: boolean;
}, currentUserId: string, relatedDataCount: number): Promise<boolean> {
  if (user.id === currentUserId || relatedDataCount > 0) return false;
  if (user.role === UserRole.ADMIN && user.active) {
    const others = await countOtherActiveAdmins(user.id);
    if (others === 0) return false;
  }
  return true;
}
