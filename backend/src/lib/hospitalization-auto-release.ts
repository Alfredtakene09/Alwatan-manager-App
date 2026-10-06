import { HospitalizationStatus, InvoiceStatus } from "@prisma/client";
import { prisma } from "./db.js";

const SCHEDULER_INTERVAL_MS = 10 * 60 * 1000;
const THROTTLE_MS = 60 * 1000;

let lastRunAt = 0;
let inFlight: Promise<number> | null = null;
let schedulerTimer: NodeJS.Timeout | null = null;

/** Minuit du lendemain : un séjour qui se termine aujourd'hui est déjà terminé. */
function startOfTomorrow(now = new Date()): Date {
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  day.setDate(day.getDate() + 1);
  return day;
}

export type AutoReleaseCandidate = {
  endDate: Date | null;
  totalDueFcfa: number;
  paidAt: Date | null;
  /** Factures du dossier déjà encaissées (status PAID). */
  invoices: { paidAmountFcfa: number }[];
};

/** Soldé : encaissement enregistré sur le dossier, factures réglées, ou rien à payer. */
function isSettled(hospitalization: AutoReleaseCandidate): boolean {
  const dueFcfa = Math.max(0, hospitalization.totalDueFcfa);
  if (dueFcfa <= 0) return true;
  if (hospitalization.paidAt) return true;
  const paidFcfa = hospitalization.invoices.reduce(
    (sum, invoice) => sum + invoice.paidAmountFcfa,
    0,
  );
  return paidFcfa >= dueFcfa;
}

/** Séjour payé dont le dernier jour est atteint : la salle n'a plus à être réservée. */
export function isReadyForAutoRelease(
  hospitalization: AutoReleaseCandidate,
  now = new Date(),
): boolean {
  if (!hospitalization.endDate) return false;
  if (hospitalization.endDate >= startOfTomorrow(now)) return false;
  return isSettled(hospitalization);
}

/**
 * Sortie automatique des séjours soldés dont la date de fin est atteinte :
 * la salle et le lit redeviennent disponibles sans intervention manuelle.
 */
export async function releaseSettledHospitalizations(): Promise<number> {
  const candidates = await prisma.hospitalization.findMany({
    where: {
      status: HospitalizationStatus.ACTIVE,
      endDate: { lt: startOfTomorrow() },
      OR: [{ roomId: { not: null } }, { bedId: { not: null } }],
    },
    select: {
      id: true,
      endDate: true,
      totalDueFcfa: true,
      paidAt: true,
      invoices: {
        where: { status: InvoiceStatus.PAID },
        select: { paidAmountFcfa: true },
      },
    },
  });

  const ids = candidates
    .filter((hospitalization) => isReadyForAutoRelease(hospitalization))
    .map((hospitalization) => hospitalization.id);
  if (!ids.length) return 0;

  const { count } = await prisma.hospitalization.updateMany({
    where: { id: { in: ids }, status: HospitalizationStatus.ACTIVE },
    data: {
      status: HospitalizationStatus.DISCHARGED,
      dischargedAt: new Date(),
      roomId: null,
      bedId: null,
    },
  });
  return count;
}

async function runRelease(): Promise<number> {
  try {
    const released = await releaseSettledHospitalizations();
    if (released > 0) {
      console.log(`[hospitalisation] ${released} salle(s) libérée(s) automatiquement`);
    }
    return released;
  } catch (error) {
    console.error("[hospitalisation] libération automatique impossible", error);
    return 0;
  }
}

/** Passe opportuniste depuis les écrans salles : au plus une fois par minute. */
export function releaseSettledHospitalizationsThrottled(): Promise<number> {
  if (inFlight) return inFlight;
  if (Date.now() - lastRunAt < THROTTLE_MS) return Promise.resolve(0);
  lastRunAt = Date.now();
  inFlight = runRelease().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

export function startHospitalizationReleaseScheduler(): void {
  if (schedulerTimer) return;
  void runRelease();
  schedulerTimer = setInterval(() => {
    void runRelease();
  }, SCHEDULER_INTERVAL_MS);
  if (typeof schedulerTimer.unref === "function") {
    schedulerTimer.unref();
  }
}

export function stopHospitalizationReleaseScheduler(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
}
