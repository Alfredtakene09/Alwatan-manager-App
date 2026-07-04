import { ExamCatalogKind } from "@prisma/client";

export type ExamCatalogSeedRow = {
  code: string;
  label: string;
  category?: string;
  priceFcfa: number;
  sortOrder?: number;
};

export const EXAM_CATALOG_SEED: Record<ExamCatalogKind, ExamCatalogSeedRow[]> = {
  [ExamCatalogKind.EXAMEN]: [
    { code: "nfs", label: "Numération formule sanguine (NFS)", category: "Hématologie", priceFcfa: 5000, sortOrder: 1 },
    { code: "groupage", label: "Groupage sanguin", category: "Hématologie", priceFcfa: 4000, sortOrder: 2 },
    { code: "glycemie", label: "Glycémie", category: "Biochimie", priceFcfa: 2500, sortOrder: 3 },
    { code: "creatinine", label: "Créatininémie", category: "Biochimie", priceFcfa: 3500, sortOrder: 4 },
    { code: "uree", label: "Urée sanguine", category: "Biochimie", priceFcfa: 3500, sortOrder: 5 },
    { code: "hepatique", label: "Bilan hépatique", category: "Biochimie", priceFcfa: 12000, sortOrder: 6 },
    { code: "lipidique", label: "Bilan lipidique", category: "Biochimie", priceFcfa: 10000, sortOrder: 7 },
    { code: "ionogramme", label: "Ionogramme sanguin", category: "Biochimie", priceFcfa: 6000, sortOrder: 8 },
    { code: "crp", label: "CRP", category: "Biochimie", priceFcfa: 4500, sortOrder: 9 },
    { code: "ecbu", label: "ECBU", category: "Urinaire", priceFcfa: 4000, sortOrder: 10 },
    { code: "proteinurie", label: "Protéinurie des 24 h", category: "Urinaire", priceFcfa: 5000, sortOrder: 11 },
    { code: "vih", label: "Sérologie VIH", category: "Sérologie", priceFcfa: 5000, sortOrder: 12 },
    { code: "hbs", label: "Ag HBs", category: "Sérologie", priceFcfa: 4500, sortOrder: 13 },
    { code: "hcv", label: "Sérologie HCV", category: "Sérologie", priceFcfa: 4500, sortOrder: 14 },
    { code: "paludisme", label: "Test paludisme (TDR)", category: "Parasitologie", priceFcfa: 3000, sortOrder: 15 },
    { code: "grossesse", label: "Test de grossesse (BHCG)", category: "Biologie", priceFcfa: 3500, sortOrder: 16 },
  ],
  [ExamCatalogKind.RADIO]: [
    { code: "radiographie", label: "Radiographie", category: "Imagerie", priceFcfa: 15000, sortOrder: 1 },
    { code: "scanner", label: "Scanner", category: "Imagerie", priceFcfa: 80000, sortOrder: 2 },
    { code: "irm", label: "IRM", category: "Imagerie", priceFcfa: 120000, sortOrder: 3 },
  ],
  [ExamCatalogKind.ECHO]: [
    { code: "echographie", label: "Échographie", category: "Imagerie", priceFcfa: 25000, sortOrder: 1 },
    { code: "echo-cardiaque", label: "Échographie cardiaque", category: "Cardiologie", priceFcfa: 35000, sortOrder: 2 },
    { code: "ecg", label: "ECG", category: "Cardiologie", priceFcfa: 8000, sortOrder: 3 },
  ],
  [ExamCatalogKind.ODONTO]: [
    { code: "consultation-odonto", label: "Consultation dentaire", category: "Soins", priceFcfa: 5000, sortOrder: 1 },
    { code: "detartrage", label: "Détartrage", category: "Soins", priceFcfa: 8000, sortOrder: 2 },
    { code: "extraction-simple", label: "Extraction simple", category: "Chirurgie", priceFcfa: 12000, sortOrder: 3 },
    { code: "extraction-chirurgicale", label: "Extraction chirurgicale", category: "Chirurgie", priceFcfa: 25000, sortOrder: 4 },
    { code: "obturation", label: "Obturation (plombage)", category: "Soins", priceFcfa: 15000, sortOrder: 5 },
    { code: "devitalisation", label: "Dévitalisation", category: "Soins", priceFcfa: 35000, sortOrder: 6 },
    { code: "prothese", label: "Prothèse dentaire", category: "Prothèse", priceFcfa: 80000, sortOrder: 7 },
  ],
};

export const EXAM_CATALOG_KIND_SLUGS = {
  examen: ExamCatalogKind.EXAMEN,
  odonto: ExamCatalogKind.ODONTO,
  radio: ExamCatalogKind.RADIO,
  echo: ExamCatalogKind.ECHO,
} as const;

export type ExamCatalogKindSlug = keyof typeof EXAM_CATALOG_KIND_SLUGS;

export function parseExamCatalogKindSlug(slug: string): ExamCatalogKind | null {
  if (slug in EXAM_CATALOG_KIND_SLUGS) {
    return EXAM_CATALOG_KIND_SLUGS[slug as ExamCatalogKindSlug];
  }
  return null;
}
