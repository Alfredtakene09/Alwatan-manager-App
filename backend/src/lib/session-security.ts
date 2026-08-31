/** Délai d'inactivité avant déconnexion forcée (30 minutes). */
export const SESSION_IDLE_MS = 30 * 60 * 1000;

/** Fréquence max. de mise à jour de lastActivityAt en base. */
export const SESSION_ACTIVITY_TOUCH_MS = 60 * 1000;

/** Échecs avant verrouillage : avertissement à la 4e, verrouillage à la 5e. */
export const MAX_FAILED_LOGIN_ATTEMPTS = 5;
export const LAST_ATTEMPT_WARNING_AT = 4;

export function isSessionIdle(lastActivityAt: Date | null | undefined, now = Date.now()): boolean {
  if (!lastActivityAt) return false;
  return now - lastActivityAt.getTime() > SESSION_IDLE_MS;
}

export function hasActiveConcurrentSession(
  sessionTokenId: string | null | undefined,
  lastActivityAt: Date | null | undefined,
  now = Date.now(),
): boolean {
  if (!sessionTokenId || !lastActivityAt) return false;
  return !isSessionIdle(lastActivityAt, now);
}

export function isAccountLocked(lockedAt: Date | null | undefined): boolean {
  return Boolean(lockedAt);
}
