import { prisma } from "./db.js";

export type LabPanelSeedField = {
  section?: string;
  key: string;
  label: string;
  unit?: string;
  reference?: string;
  defaultValue?: string;
  type?: "text" | "textarea";
};

export type LabPanelSeed = {
  slug: string;
  label: string;
  isEntry: boolean;
  fields: LabPanelSeedField[];
};

/**
 * Définitions initiales des formulaires de résultats.
 * Reprises telles quelles depuis l'ancienne définition codée en dur du frontend,
 * afin de préserver la rétro-compatibilité du stockage (clinicalNotes) existant.
 */
export const LAB_PANELS_SEED: LabPanelSeed[] = [
  {
    slug: "routine",
    label: "Routine Investigation",
    isEntry: true,
    fields: [
      { key: "bffm", label: "B.F.F.M" },
      { key: "malaria", label: "No Malaria" },
      { key: "stoolTrypanosoma", label: "Stool for Trypanosoma" },
      { key: "typhoidIgg", label: "Typhoid IgG" },
      { key: "sikilingTest", label: "Sikiling Test" },
      { key: "hPyloria", label: "H.PYLORIA" },
      { key: "dDimer", label: "D.Dimer Test", reference: "0 - 0.5 mg/l" },
      { key: "rheumatoidFactor", label: "Rematoid Factor" },
      { key: "urineHcg", label: "Urine HCG" },
      { key: "fbg", label: "FBG", reference: "70 - 120 mg/dl" },
      { key: "rbg", label: "RBG", reference: "120 - 180 mg/dl" },
      { key: "sChlamydia", label: "S.Chlamydia Test" },
      { key: "swapChlamydia", label: "Swap Chlamydia Test" },
      { key: "esr", label: "ESR", unit: "mm1/2hour" },
      { key: "hb", label: "HB", unit: "g/dl" },
      { key: "hbPercent", label: "HB", unit: "%" },
      { key: "serumHcg", label: "Serum HCG" },
      { key: "bloodGrouping", label: "Blood Grouping" },
      { key: "crp", label: "CRP" },
      { key: "afbStain", label: "AFB Stain for M.Tuberculosis" },
      { key: "widalTyphiaO", label: "Widdall S.typhia (O) titer" },
      { key: "widalTyphiaBO", label: "S.typhia (BO) titer" },
      { key: "widalComment", label: "Comment", type: "textarea" },
      { key: "widalBrucellaA", label: "Widdall Brucelle (A) titer" },
      { key: "widalBrucellaM", label: "Brucella (M) titer" },
      { key: "brucellaComment", label: "Comment", type: "textarea" },
      { section: "Urine General — Macro Exam", key: "urineColor", label: "Color" },
      { section: "Urine General — Macro Exam", key: "urineReaction", label: "Reaction" },
      { section: "Urine General — Macro Exam", key: "urinePh", label: "PH" },
      { section: "Urine General — Macro Exam", key: "urineGlucose", label: "Glucose" },
      { section: "Urine General — Macro Exam", key: "urineSugar", label: "Sugar" },
      { section: "Urine General — Macro Exam", key: "urineAlbumin", label: "Albumin" },
      { section: "Urine General — Macro Exam", key: "urineProtein", label: "Protein" },
      { section: "Urine General — Macro Exam", key: "urineBilirubin", label: "Bilirubin" },
      { section: "Urine General — Macro Exam", key: "urineBile", label: "Bile" },
      { section: "Urine General — Macro Exam", key: "urineKetones", label: "Ketones" },
      { section: "Urine General — Macro Exam", key: "urineAcetone", label: "Acetone" },
      { section: "Urine General — Macro Exam", key: "urineBlood", label: "Blood" },
      { section: "Urine General — Macro Exam", key: "urineUrobilinogen", label: "Urobillinogen" },
      { section: "Urine General — Macro Exam", key: "urineGravity", label: "S.Grafity" },
      { section: "Urine General — Macro Exam", key: "urinePusCells", label: "Pus Cells" },
      { section: "Urine General — Macro Exam", key: "urinePus", label: "Pus" },
      { section: "Urine General — Macro Exam", key: "urineRbcs", label: "RBCs" },
      { section: "Urine General — Macro Exam", key: "urineNitrites", label: "Nitrites" },
      { section: "Urine General — Macro Exam", key: "urineEpithelial", label: "Epithelial cells" },
      { section: "Urine General — Macro Exam", key: "urineCasts", label: "Casts" },
      { section: "Urine General — Macro Exam", key: "urineCrystals", label: "Crytals" },
      { section: "Urine General — Macro Exam", key: "urineOva", label: "OVA" },
      { section: "Urine General — Macro Exam", key: "urineOthers", label: "Others" },
      { section: "Stool General — Macro Exam", key: "stoolColor", label: "Color" },
      { section: "Stool General — Macro Exam", key: "stoolConsistency", label: "Consistency" },
      { section: "Stool General — Macro Exam", key: "stoolMucus", label: "Mucus" },
      { section: "Stool General — Macro Exam", key: "stoolBlood", label: "Blood" },
      { section: "Stool General — Macro Exam", key: "stoolWorm", label: "Worm" },
      { section: "Stool General — Macro Exam", key: "stoolPh", label: "PH" },
      { section: "Stool General — Macro Exam", key: "stoolPusCells", label: "Pus Cells" },
      { section: "Stool General — Macro Exam", key: "stoolRbcs", label: "RBCs" },
      { section: "Stool General — Macro Exam", key: "stoolCysts", label: "Cysts" },
      { section: "Stool General — Macro Exam", key: "stoolTrophozoite", label: "Trophozoite" },
      { section: "Stool General — Macro Exam", key: "stoolOva", label: "OVA" },
      { section: "Stool General — Macro Exam", key: "stoolOthers", label: "Others" },
    ],
  },
  {
    slug: "hormones",
    label: "Hormones",
    isEntry: true,
    fields: [
      { key: "sTroponin", label: "S.Troponin" },
      { key: "bHcg", label: "B. HCG" },
      { key: "psa", label: "PSA" },
      { key: "aso", label: "ASO Quantitatif" },
      { key: "hormones", label: "Hormones" },
    ],
  },
  {
    slug: "biochemie",
    label: "Biochimie",
    isEntry: true,
    fields: [
      { key: "fbg", label: "FBG", unit: "mg/dl", reference: "70 - 110 mg/dl" },
      { key: "hba1c", label: "HbA1c", unit: "%", reference: "6 - 7 %" },
      { key: "bloodUrea", label: "Blood Urea", unit: "mg/dl", reference: "15 - 50 mg/dl" },
      { key: "creatinine", label: "S.Creatinine", unit: "mg/dl", reference: "0.6 - 1.1 mg/dl" },
      { key: "sodium", label: "Sodium (Na+)", unit: "mmol/L", reference: "135 - 150 mmol/L" },
      { key: "potassium", label: "Potassium (K+)", unit: "mmol/L", reference: "3.5 - 5 mmol/L" },
    ],
  },
  {
    slug: "electrolytes",
    label: "ABG + Electrolytes",
    isEntry: true,
    fields: [
      { section: "Gaz du sang", key: "ph", label: "pH", reference: "7.34 - 7.44" },
      { section: "Gaz du sang", key: "pco2", label: "PCO2", reference: "24 - 44" },
      { section: "Gaz du sang", key: "po2", label: "PO2", reference: "96 - 100" },
      { section: "Électrolytes", key: "chloride", label: "Cl-", unit: "mmol/L", reference: "95 - 107 mmol/L" },
      { section: "Électrolytes", key: "sodium", label: "Na+", unit: "mmol/L", reference: "135 - 150 mmol/L" },
      { section: "Électrolytes", key: "potassium", label: "K+", unit: "mmol/L", reference: "3.5 - 5 mmol/L" },
      { section: "Électrolytes", key: "ionizedCalcium", label: "Ionized Calcium", unit: "mmol/L", reference: "1.15 - 1.30 mmol/L" },
    ],
  },
  {
    slug: "fertility",
    label: "Fertility Hormones",
    isEntry: true,
    fields: [
      { key: "fsh", label: "FSH", unit: "mlU/ml", reference: "6 - 21 mid-cycle / 1 - 9 luteal / 22 - 153 postmenopausal" },
      { key: "prl", label: "PRL", unit: "ng/ml", reference: "5 - 35 ng/ml" },
      { key: "lh", label: "LH", unit: "mlu/ML", reference: "Follicular 1.0 - 12.0 / Ovulatory 17.0 - 77.0 / Luteal 0.0 - 15.0" },
      { key: "testosterone", label: "Testostrone Hormone", unit: "ng/ml", reference: "1.9 - 8.4 ng/ml" },
      { key: "progesterone", label: "Progestrone Hormone", unit: "ng/ml", reference: "0.7 - 1 or 2 - 25 ng/ml" },
      { key: "amh", label: "Anti-Mullerian Hormone", reference: "≤ 5" },
    ],
  },
  {
    slug: "liver",
    label: "LFT",
    isEntry: true,
    fields: [
      { key: "tProtein", label: "T.Protein", unit: "g/dl", reference: "6.0 - 7.8 g/dl" },
      { key: "albumin", label: "S.Albumin", unit: "g/dl", reference: "3.5 - 5.0 g/dl" },
      { key: "totalBilirubin", label: "T.Bilirubin", unit: "mg/dl", reference: "0.0 - 1.1 mg/dl" },
      { key: "directBilirubin", label: "D.Bilirubin", unit: "mg/dl", reference: "0.0 - 0.3 mg/dl" },
      { key: "alp", label: "ALP", unit: "U/L", reference: "0 - 115 U/L" },
      { key: "ast", label: "GOT (AST)", unit: "U/L", reference: "Up to 40 U/L" },
      { key: "alt", label: "GPT (ALT)", unit: "U/L", reference: "Up to 40 U/L" },
    ],
  },
  {
    slug: "lipid",
    label: "Lipid Profile",
    isEntry: true,
    fields: [
      { key: "tc", label: "TC", unit: "mg/dl", reference: "< 200 mg/dl" },
      { key: "hdl", label: "HDL", unit: "mg/dl", reference: "40 - 60 mg/dl" },
      { key: "ldl", label: "LDL", unit: "mg/dl", reference: "< 120 mg/dl" },
      { key: "cholesterol", label: "Cholesterol", unit: "mg/dl", reference: "< 200 mg/dl" },
      { key: "triglycerides", label: "Triglycerides", unit: "mg/dl", reference: "150 - 199 mg/dl" },
    ],
  },
  {
    slug: "screening",
    label: "Screening Test",
    isEntry: true,
    fields: [
      { key: "hivT1", label: "HIV (T1)" },
      { key: "hivT2", label: "HIV (T2)" },
      { key: "hbsAg", label: "HBsAg" },
      { key: "hcv", label: "HCV" },
      { key: "vdrl", label: "VDRL" },
      { key: "bloodGrouping", label: "Blood Grouping" },
    ],
  },
  {
    slug: "semen",
    label: "Semen Analysis",
    isEntry: true,
    fields: [
      { key: "lastEjaculation", label: "Last ejaculation before" },
      { key: "collectionTime", label: "Collection time" },
      { key: "sampleExamAfter", label: "Sample exam after" },
      { section: "Test details", key: "quantity", label: "Quantity", reference: "2.5 - 5 ml" },
      { section: "Test details", key: "colour", label: "Colour", reference: "Gray white" },
      { section: "Test details", key: "reaction", label: "Reaction", reference: "Alkaline" },
      { section: "Test details", key: "viscosity", label: "Viscosity", reference: "Moderately" },
      { section: "Test details", key: "liquefactionTime", label: "Liquefaction-Time", reference: "30 - 45 min" },
      { section: "Test details", key: "spermCount", label: "Sperm count", reference: "60 Million/ml" },
      { section: "Test details", key: "vigorous1h", label: "Vigorous (1 Hour)", unit: "%" },
      { section: "Test details", key: "sluggish1h", label: "Sluggish (1 Hour)", unit: "%" },
      { section: "Test details", key: "nonMotile1h", label: "Non-Motile (1 Hour)", unit: "%" },
      { section: "Test details", key: "vigorous2h", label: "Vigorous (2 Hour)", unit: "%" },
      { section: "Test details", key: "sluggish2h", label: "Sluggish (2 Hour)", unit: "%" },
      { section: "Test details", key: "nonMotile2h", label: "Non-Motile (2 Hour)", unit: "%" },
      { section: "Test details", key: "activeHead", label: "Active — Head", unit: "%" },
      { section: "Test details", key: "activeMiddle", label: "Active — Middle piece", unit: "%" },
      { section: "Test details", key: "activeTail", label: "Active — Tail", unit: "%" },
      { section: "Test details", key: "nonActiveHead", label: "Non Active — Head", unit: "%" },
      { section: "Test details", key: "nonActiveMiddle", label: "Non Active — Middle piece", unit: "%" },
      { section: "Test details", key: "nonActiveTail", label: "Non Active — Tail", unit: "%" },
      { section: "Test details", key: "viablePercent", label: "Viable", unit: "%" },
      { section: "Test details", key: "nonViablePercent", label: "Non-viable", unit: "%" },
      { section: "Test details", key: "pusCells", label: "Pus cells", unit: "HPF" },
      { section: "Test details", key: "rbcs", label: "RBCs", unit: "HPF" },
    ],
  },
  {
    slug: "thyroid",
    label: "Thyroid Hormones Test",
    isEntry: true,
    fields: [
      { key: "t3", label: "T3", unit: "ng/mL", reference: "1.23 - 3.07 ng/mL" },
      { key: "t4", label: "T4", unit: "nmol/L", reference: "66 - 181 nmol/L" },
      { key: "tsh", label: "TSH", unit: "Mu/mL", reference: "0.3 - 4.2 Mu/mL" },
      { key: "ft3", label: "FT3", unit: "Pmol/L", reference: "3.1 - 6.8 Pmol/L" },
      { key: "ft4", label: "FT4", unit: "Pmol/L", reference: "12 - 22 Pmol/L" },
    ],
  },
  {
    slug: "coagulation",
    label: "Coagulation Test",
    isEntry: false,
    fields: [
      { key: "inr", label: "I.N.R", reference: "MAL (0.83 - 1.35) / FEMAL (0.99 - 1.29)" },
      { key: "pt", label: "P.T", reference: "10 - 16 seconds" },
      { key: "ptt", label: "P.TT", reference: "25 - 36 seconds" },
    ],
  },
  {
    slug: "diabetic",
    label: "Diabetic Test",
    isEntry: false,
    fields: [
      { key: "fbg", label: "FBG", unit: "mg/dl", reference: "70 - 110 mg/dl" },
      { key: "postPrandial", label: "2 hour post prandial", unit: "mg/dl", reference: "< 180 mg/dl" },
      { key: "rbg", label: "RBG", unit: "mg/dl", reference: "< 180 mg/dl" },
      { key: "hba1c", label: "HbA1c", unit: "%", reference: "6%" },
    ],
  },
  {
    slug: "renal",
    label: "Renal function",
    isEntry: false,
    fields: [
      { section: "Renal function", key: "bloodUrea", label: "Blood Urea", unit: "mg/dl", reference: "15 - 50 mg/dl" },
      { section: "Renal function", key: "creatinine", label: "S.Creatinine", unit: "mg/dl", reference: "0.6 - 1.1 mg/dl" },
      { section: "Renal function", key: "uricAcid", label: "Uric Acids", unit: "mg/dl", reference: "3.7 - 7 mg/dl" },
      { section: "S.Electrolytes", key: "sodium", label: "Sodium (Na+)", unit: "nmol/L", reference: "135 - 155 nmol/L" },
      { section: "S.Electrolytes", key: "potassium", label: "Potassuim (K+)", unit: "nmol/L", reference: "3.5 - 5.5 nmol/L" },
      { section: "S.Electrolytes", key: "calcium", label: "Calcium (Ca2+)", unit: "mg/dl", reference: "8.1 - 10.1 mg/dl" },
      { section: "S.Electrolytes", key: "phosphorus", label: "Phosphoras", unit: "mg/dl", reference: "2.5 - 5.5 mg/dl" },
      { section: "S.Electrolytes", key: "ionizedCalcium", label: "Iron Calium", unit: "nmol/L", reference: "1.2 - 1.32 nmol/L" },
    ],
  },
  {
    slug: "torch",
    label: "TORCH IgG Combo Rapid Test",
    isEntry: false,
    fields: [
      { key: "toxoplasmaIgg", label: "Toxoplasma Gondi — IgG" },
      { key: "toxoplasmaIgm", label: "Toxoplasma Gondi — IgM" },
      { key: "rubellaIgg", label: "Rubella Virus — IgG" },
      { key: "rubellaIgm", label: "Rubella Virus — IgM" },
      { key: "cmvIgg", label: "Cytomegalo Virus — IgG" },
      { key: "cmvIgm", label: "Cytomegalo Virus — IgM" },
      { key: "herpesIgg", label: "Herpes Virus — IgG" },
      { key: "herpesIgm", label: "Herpes Virus — IgM" },
    ],
  },
];

/** Crée les formulaires par défaut si la table est vide (première migration). */
export async function seedLabPanelsIfEmpty() {
  const count = await prisma.labPanel.count();
  if (count > 0) return 0;

  let created = 0;
  for (let i = 0; i < LAB_PANELS_SEED.length; i += 1) {
    const seed = LAB_PANELS_SEED[i];
    await prisma.labPanel.create({
      data: {
        slug: seed.slug,
        label: seed.label,
        isEntry: seed.isEntry,
        active: true,
        sortOrder: i,
        fields: {
          create: seed.fields.map((field, index) => ({
            section: field.section ?? null,
            key: field.key,
            label: field.label,
            unit: field.unit ?? null,
            reference: field.reference ?? null,
            defaultValue: field.defaultValue ?? null,
            type: field.type ?? "text",
            sortOrder: index,
          })),
        },
      },
    });
    created += 1;
  }
  return created;
}
