/** Delai d'inactivite avant deconnexion forcee (12 h — journee clinique + veille PC). */
export const SESSION_IDLE_MS = 12 * 60 * 60 * 1000;

/** Frequence max. de mise a jour de lastActivityAt en base. */
export const SESSION_ACTIVITY_TOUCH_MS = 60 * 1000;

/** Echecs avant verrouillage : avertissement a la 4e, verrouillage a la 5e. */
export const MAX_FAILED_LOGIN_ATTEMPTS = 5;
export const LAST_ATTEMPT_WARNING_AT = 4;

export function isSessionIdle(lastActivityAt: Date | null | undefined, now = Date.now()): boolean {
  if (!lastActivityAt) return false;
  return now - lastActivityAt.getTime() > SESSION_IDLE_MS;
}

export function isAccountLocked(lockedAt: Date | null | undefined): boolean {
  return Boolean(lockedAt);
}
