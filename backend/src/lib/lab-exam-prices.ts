import { RoomType } from "@prisma/client";
import { prisma } from "./db.js";
import { HOSPITALISATION_PRESCRIPTION_LABEL } from "./hospitalization-referral.js";
import {
  buildExamLinesFromNotes,
  buildExamSheetsByKind,
  computeExamGrossFcfa,
} from "./exam-billing.js";
import {
  countPrescribedFieldUnits,
  extractBasePanelLabel,
  extractPrescribedFieldLabels,
  extractSelectedFormLabels,
} from "./lab-notes.js";

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
/** Clé : `panelLabel::fieldLabel` (casse / espaces normalisés côté lookup). */
let fieldPriceCache = new Map<string, number>();

function normalizePriceKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function fieldPriceLookupKey(panelLabel: string, fieldLabel: string) {
  return `${normalizePriceKey(panelLabel)}::${normalizePriceKey(fieldLabel)}`;
}

function resolveExamBasePrice(label: string): number {
  const cached = catalogPriceCache.get(label);
  if (cached != null) return cached;
  const base = extractBasePanelLabel(label);
  if (base !== label) {
    const baseCached = catalogPriceCache.get(base);
    if (baseCached != null) return baseCached;
    if (LAB_EXAM_PRICES_FCFA[base] != null) return LAB_EXAM_PRICES_FCFA[base];
  }
  return LAB_EXAM_PRICES_FCFA[label] ?? DEFAULT_EXAM_PRICE_FCFA;
}

function resolveFieldPrice(panelLabel: string, fieldLabel: string): number | null {
  const exact = fieldPriceCache.get(fieldPriceLookupKey(panelLabel, fieldLabel));
  if (exact != null && exact > 0) return exact;
  return null;
}

export async function refreshExamPriceCache() {
  try {
    const [items, interventions, rooms, fields] = await Promise.all([
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
      prisma.labPanelField.findMany({
        where: {
          priceFcfa: { not: null, gt: 0 },
          panel: { active: true },
        },
        select: {
          label: true,
          priceFcfa: true,
          panel: {
            select: {
              label: true,
              examCatalogItems: {
                where: { active: true },
                select: { label: true },
              },
            },
          },
        },
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

    const nextFieldPrices = new Map<string, number>();
    for (const field of fields) {
      if (field.priceFcfa == null || field.priceFcfa < 1) continue;
      const panelLabels = new Set<string>([
        field.panel.label,
        ...field.panel.examCatalogItems.map((item) => item.label),
      ]);
      for (const panelLabel of panelLabels) {
        if (!panelLabel.trim()) continue;
        nextFieldPrices.set(fieldPriceLookupKey(panelLabel, field.label), field.priceFcfa);
      }
    }
    fieldPriceCache = nextFieldPrices;
  } catch {
    catalogPriceCache = new Map();
    fieldPriceCache = new Map();
  }
}

/**
 * Prix d’une ligne prescrite :
 * - examen entier (« Panel ») → tarif catalogue ;
 * - champs partiels (« Panel (Section: champ) ») → somme des prix champs (sinon tarif examen / champ).
 */
export function getLabExamPriceFcfa(label: string): number {
  const trimmed = label.trim();
  if (!trimmed) return DEFAULT_EXAM_PRICE_FCFA;

  const selectedFields = extractPrescribedFieldLabels(trimmed);
  if (!selectedFields.length) {
    const units = countPrescribedFieldUnits(trimmed);
    return resolveExamBasePrice(trimmed) * units;
  }

  const base = extractBasePanelLabel(trimmed);
  let sum = 0;
  for (const fieldLabel of selectedFields) {
    const fieldPrice = resolveFieldPrice(base, fieldLabel);
    // Sans tarif unitaire : non facturable en sélection partielle (pas de repli examen).
    if (fieldPrice != null) sum += fieldPrice;
  }
  return sum;
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
