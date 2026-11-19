import { UserRole } from "@prisma/client";
import { prisma } from "./db.js";
import { formatLocalDay } from "./local-day.js";

export type ReceptionShiftLabel = "Matin" | "Soir" | "Matin et soir";

/** L'activité avant 8 h ne compte pas pour désigner le poste du matin. */
const MORNING_START_HOUR = 8;

/**
 * Poste d'une réceptionniste d'après l'ordre d'arrivée de chaque jour :
 * la 1re réceptionniste active (connexion ou facture) à partir de 8 h est du matin, les suivantes du soir.
 */
export function shiftLabelFromLogins(
  logins: { userId: string; at: Date }[],
  userId: string,
): ReceptionShiftLabel | null {
  const firstByDay = new Map<string, string>();
  const userDays = new Set<string>();
  for (const login of [...logins].sort((a, b) => a.at.getTime() - b.at.getTime())) {
    if (login.at.getHours() < MORNING_START_HOUR) continue;
    const day = formatLocalDay(login.at);
    if (!firstByDay.has(day)) firstByDay.set(day, login.userId);
    if (login.userId === userId) userDays.add(day);
  }
  let morning = false;
  let evening = false;
  for (const day of userDays) {
    if (firstByDay.get(day) === userId) morning = true;
    else evening = true;
  }
  if (morning && evening) return "Matin et soir";
  if (morning) return "Matin";
  if (evening) return "Soir";
  return null;
}

/**
 * Poste de la réceptionniste sur la période. Connexions du journal d'audit (purgé après 2 mois)
 * + factures émises, pour que les anciennes périodes réimprimées aient aussi leur poste.
 */
export async function receptionistShiftLabel(userId: string, from: Date, toExclusive: Date) {
  const range = { gte: from, lt: toExclusive };
  const [logins, invoices] = await Promise.all([
    prisma.auditLog.findMany({
      where: { action: "LOGIN", createdAt: range, user: { role: UserRole.RECEPTIONNISTE } },
      select: { userId: true, createdAt: true },
    }),
    prisma.invoice.findMany({
      where: { createdAt: range, issuedBy: { role: UserRole.RECEPTIONNISTE } },
      select: { issuedById: true, createdAt: true },
    }),
  ]);
  return shiftLabelFromLogins(
    [
      ...logins.flatMap((row) => (row.userId ? [{ userId: row.userId, at: row.createdAt }] : [])),
      ...invoices.map((row) => ({ userId: row.issuedById, at: row.createdAt })),
    ],
    userId,
  );
}
