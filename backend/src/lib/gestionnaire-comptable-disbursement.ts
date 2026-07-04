import { formatBusinessDate } from "./cash-shift.js";
import { startOfDay } from "./revenue-stats.js";

/** Début du créneau matin. */
export const COMPTABLE_DAY_START_HOUR = 7;
/** Fin du créneau nuit (lendemain 6h) — après quoi la collecte est attendue. */
export const COMPTABLE_DAY_END_HOUR = 6;
/** Fenêtre matinale habituelle si le passage de nuit n'a pas eu lieu. */
export const COMPTABLE_MORNING_COLLECT_UNTIL_HOUR = 12;

export type ComptableDisbursementPhase =
  | "ok"
  | "during_day"
  | "evening_due"
  | "morning_due"
  | "carry_over";

export type ComptableDisbursementSchedule = {
  overdue: boolean;
  phase: ComptableDisbursementPhase;
  statusLabel: string;
  scheduleHint: string;
};

export const COMPTABLE_DISBURSEMENT_WORKFLOW_HINT =
  "Décaissement journalier : vous récupérez la tirelire comptable (créneaux matin 7h–14h, soir 16h–21h, nuit 21h–6h), en général après la nuit ou le lendemain matin.";

function isAfterDailyClosing(hour: number) {
  // Après la fin de la nuit (6h), hors créneau nuit en cours (21h–6h)
  return hour >= COMPTABLE_DAY_END_HOUR && hour < 21;
}

/**
 * Rythme métier : collecte quotidienne par le gestionnaire, pas un seuil fixe en heures.
 * - Pendant les créneaux (matin / soir / nuit) : solde en cours.
 * - Après 6h (fin nuit) : collecte due.
 * - Matin (7h–12h) : report veille → collecte matinale due.
 */
export function assessComptableDisbursementSchedule(params: {
  pendingFcfa: number;
  lastDisbursementAt: Date | null;
  oldestPendingBusinessDate: Date | null;
  now?: Date;
}): ComptableDisbursementSchedule {
  const now = params.now ?? new Date();

  if (params.pendingFcfa <= 0) {
    return {
      overdue: false,
      phase: "ok",
      statusLabel: "À jour",
      scheduleHint: COMPTABLE_DISBURSEMENT_WORKFLOW_HINT,
    };
  }

  const todayStart = startOfDay(now);
  const hour = now.getHours();
  const disbursedToday =
    params.lastDisbursementAt != null && params.lastDisbursementAt >= todayStart;

  if (disbursedToday) {
    return {
      overdue: false,
      phase: "ok",
      statusLabel: "Collecte du jour effectuée",
      scheduleHint: COMPTABLE_DISBURSEMENT_WORKFLOW_HINT,
    };
  }

  const oldest = params.oldestPendingBusinessDate
    ? startOfDay(params.oldestPendingBusinessDate)
    : todayStart;
  const oldestIsBeforeToday = oldest.getTime() < todayStart.getTime();
  const afterClosing = isAfterDailyClosing(hour);
  const morningWindow =
    hour >= COMPTABLE_DAY_START_HOUR && hour < COMPTABLE_MORNING_COLLECT_UNTIL_HOUR;
  const oldestLabel = formatBusinessDate(oldest);

  if (oldestIsBeforeToday) {
    if (morningWindow) {
      return {
        overdue: true,
        phase: "morning_due",
        statusLabel: "Collecte matinale due",
        scheduleHint: `Report du ${oldestLabel} non récupéré — passage possible le matin (avant ${COMPTABLE_MORNING_COLLECT_UNTIL_HOUR}h).`,
      };
    }
    if (afterClosing) {
      return {
        overdue: true,
        phase: "evening_due",
        statusLabel: "Collecte du soir due",
        scheduleHint: `Solde comptable depuis le ${oldestLabel} — récupération attendue après ${COMPTABLE_DAY_END_HOUR}h.`,
      };
    }
    return {
      overdue: true,
      phase: "carry_over",
      statusLabel: "Report non récupéré",
      scheduleHint: `Fonds depuis le ${oldestLabel} en attente — à récupérer ce soir (après ${COMPTABLE_DAY_END_HOUR}h) ou demain matin.`,
    };
  }

  if (afterClosing) {
    return {
      overdue: true,
      phase: "evening_due",
      statusLabel: "Collecte du soir due",
      scheduleHint: `Compte rendu du jour (${COMPTABLE_DAY_START_HOUR}h–${COMPTABLE_DAY_END_HOUR}h) clôturé — récupérez la tirelire comptable.`,
    };
  }

  return {
    overdue: false,
    phase: "during_day",
    statusLabel: "Journée en cours",
    scheduleHint: `Solde en cours (${COMPTABLE_DAY_START_HOUR}h–${COMPTABLE_DAY_END_HOUR}h) — collecte prévue ce soir après ${COMPTABLE_DAY_END_HOUR}h ou demain matin.`,
  };
}
