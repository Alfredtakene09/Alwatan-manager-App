import { ReceptionShiftSlot, UserRole } from "@prisma/client";

/**
 * Source de vérité — créneaux du compte rendu caisse (ReceptionCashSettlement.shiftSlot).
 *
 * Fuseau : heure LOCALE du processus Node (Date.setHours). Vérifier TZ du serveur en production.
 *
 * | Plage              | shiftSlot | Décaissement caissier |
 * |--------------------|-----------|------------------------|
 * | 07:00 – 14:00      | MORNING   | Oui                    |
 * | 14:00 – 16:00      | —         | NON (trou volontaire)  |
 * | 16:00 – 21:00      | EVENING   | Oui                    |
 * | 21:00 – 06:00 (+1) | NIGHT     | Oui (chevauche minuit) |
 * | 06:00 – 07:00      | —         | NON (trou volontaire)  |
 *
 * « Recettes du jour » (revenue-stats) couvre 00:00–24:00 : l'écart jour vs créneau = hors créneau.
 */

/** Rôles autorisés à encaisser au comptoir (compte rendu caisse). */
export const CASH_COLLECTOR_ROLES: UserRole[] = [
  UserRole.RECEPTIONNISTE,
  UserRole.COMPTABLE,
  UserRole.ADMIN,
];

export const CASH_COLLECTOR_ROLE_LABELS: Partial<Record<UserRole, string>> = {
  [UserRole.RECEPTIONNISTE]: "Réception",
  [UserRole.COMPTABLE]: "Comptabilité",
  [UserRole.ADMIN]: "Administration",
};

export const ALL_SHIFT_SLOTS: ReceptionShiftSlot[] = [
  ReceptionShiftSlot.MORNING,
  ReceptionShiftSlot.EVENING,
  ReceptionShiftSlot.NIGHT,
];

export const SHIFT_SLOT_LABELS: Record<ReceptionShiftSlot, string> = {
  MORNING: "Matin (7h – 14h)",
  EVENING: "Soir (16h – 21h)",
  NIGHT: "Nuit (21h – 6h)",
};

/**
 * [startHour, endHour) — borne supérieure exclusive.
 * Pour NIGHT, endHour < startHour indique un créneau qui traverse minuit
 * (21h jour J → 6h jour J+1).
 */
export const SHIFT_WINDOWS: Record<ReceptionShiftSlot, { startHour: number; endHour: number }> = {
  MORNING: { startHour: 7, endHour: 14 },
  EVENING: { startHour: 16, endHour: 21 },
  NIGHT: { startHour: 21, endHour: 6 },
};

export function parseBusinessDate(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function formatBusinessDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function startOfLocalDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Fenêtre [from, to) du créneau sur une date métier (heure locale serveur). */
export function getShiftWindow(businessDate: Date, slot: ReceptionShiftSlot) {
  const window = SHIFT_WINDOWS[slot];
  const from = new Date(businessDate);
  from.setHours(window.startHour, 0, 0, 0);

  if (slot === ReceptionShiftSlot.NIGHT) {
    const to = new Date(businessDate);
    to.setDate(to.getDate() + 1);
    to.setHours(window.endHour, 0, 0, 0);
    return { from, to };
  }

  const to = new Date(businessDate);
  to.setHours(window.endHour, 0, 0, 0);
  return { from, to };
}

export function formatShiftWindowLabel(businessDate: Date, slot: ReceptionShiftSlot) {
  const { from, to } = getShiftWindow(businessDate, slot);
  const dateLabel = businessDate.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const fromTime = from.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const toTime = to.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  return `${dateLabel} · ${fromTime} – ${toTime}`;
}

export function shiftHoursLabel(slot: ReceptionShiftSlot) {
  const w = SHIFT_WINDOWS[slot];
  return `${w.startHour}h–${w.endHour}h`;
}

export function isValidBusinessDate(iso: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) && !Number.isNaN(parseBusinessDate(iso).getTime());
}

export function parseShiftSlot(value: string): ReceptionShiftSlot | null {
  if (value === "MORNING" || value === "EVENING" || value === "NIGHT") return value;
  return null;
}

/** Créneau d'encaissement selon l'heure locale (null = trou 6h–7h ou 14h–16h). */
export function inferShiftSlotFromDate(date: Date): ReceptionShiftSlot | null {
  const hour = date.getHours();
  if (hour >= 7 && hour < 14) return ReceptionShiftSlot.MORNING;
  if (hour >= 16 && hour < 21) return ReceptionShiftSlot.EVENING;
  if (hour >= 21 || hour < 6) return ReceptionShiftSlot.NIGHT;
  return null;
}

/**
 * Date métier du créneau pour un encaissement.
 * La nuit 00h–6h appartient au créneau nuit de la veille.
 */
export function businessDateForCollectedAt(collectedAt: Date): Date {
  const slot = inferShiftSlotFromDate(collectedAt);
  const day = startOfLocalDay(collectedAt);
  if (slot === ReceptionShiftSlot.NIGHT && collectedAt.getHours() < 6) {
    day.setDate(day.getDate() - 1);
  }
  return day;
}
