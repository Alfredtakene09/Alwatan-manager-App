import { RoomType } from "@prisma/client";
import { prisma } from "./db.js";
import { HOSPITALISATION_PRESCRIPTION_LABEL } from "./hospitalization-referral.js";
import {
  buildExamLinesFromNotes,
  buildExamSheetsByKind,
  computeExamGrossFcfa,
} from "./exam-billing.js";

const DEFAULT_EXAM_PRICE_FCFA = 3000;

export const LAB_EXAM_PRICES_FCFA: Record<string, number> = {
  "Numération formule sanguine (NFS)": 5000,
  "Groupage sanguin": 4000,
  "Glycémie": 2500,
  "Créatininémie": 3500,
  "Urée sanguine": 3500,
  "Bilan hépatique": 12000,
  "Bilan lipidique": 10000,
  "Ionogramme sanguin": 6000,
  "CRP": 4500,
  "ECBU": 4000,
  "Protéinurie des 24 h": 5000,
  "Radiographie": 15000,
  "Échographie": 25000,
  "Scanner": 80000,
  "IRM": 120000,
  "ECG": 8000,
  "Échographie cardiaque": 35000,
  "Sérologie VIH": 5000,
  "Ag HBs": 4500,
  "Sérologie HCV": 4500,
  "Test paludisme (TDR)": 3000,
  "Test de grossesse (BHCG)": 3500,
};

let catalogPriceCache = new Map<string, number>();

export async function refreshExamPriceCache() {
  try {
    const [items, interventions, rooms] = await Promise.all([
      prisma.examCatalogItem.findMany({
        where: { active: true },
        select: { label: true, priceFcfa: true },
      }),
      prisma.interventionType.findMany({
        where: { active: true },
        select: { label: true, totalCostFcfa: true },
      }),
      prisma.room.findMany({
        where: { active: true },
        select: { name: true, dailyRateFcfa: true, type: true },
      }),
    ]);
    const simpleRoom =
      rooms.find((room) => room.type === RoomType.SIMPLE) ?? rooms[0];
    const hospitalisationRateFcfa = simpleRoom?.dailyRateFcfa ?? 25_000;
    catalogPriceCache = new Map([
      ...items.map((item) => [item.label, item.priceFcfa] as const),
      ...interventions.map((item) => [item.label, item.totalCostFcfa] as const),
      ...rooms.map((room) => [room.name, room.dailyRateFcfa] as const),
      [HOSPITALISATION_PRESCRIPTION_LABEL, hospitalisationRateFcfa] as const,
    ]);
  } catch {
    catalogPriceCache = new Map();
  }
}

export function getLabExamPriceFcfa(label: string): number {
  const cached = catalogPriceCache.get(label);
  if (cached != null) return cached;
  return LAB_EXAM_PRICES_FCFA[label] ?? DEFAULT_EXAM_PRICE_FCFA;
}

/** @deprecated Utiliser buildExamLinesFromNotes depuis exam-billing */
export function buildLabExamLines(notes?: string | null) {
  return buildExamLinesFromNotes(notes);
}

export function computeLabExamsGrossFcfa(notes?: string | null): number {
  return computeExamGrossFcfa(notes);
}

export function computeGrossFcfaFromExamLabels(exams: string[]): number {
  return exams.reduce((sum, label) => sum + getLabExamPriceFcfa(label), 0);
}

export { buildExamSheetsByKind, buildExamsByKindPayload } from "./exam-billing.js";
