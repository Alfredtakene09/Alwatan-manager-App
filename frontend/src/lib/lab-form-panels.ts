export const LAB_PANEL_SLUGS = [
  'routine',
  'coagulation',
  'diabetic',
  'fertility',
  'lipid',
  'liver',
  'renal',
  'screening',
  'semen',
  'thyroid',
  'torch',
] as const

/** Ordre d'affichage des formulaires (Routine Investigation en premier). */
const LAB_PANEL_DISPLAY_ORDER: LabPanelSlug[] = [...LAB_PANEL_SLUGS]

export type LabPanelSlug = (typeof LAB_PANEL_SLUGS)[number]

export type LabFormField = {
  key: string
  label: string
  unit?: string
  reference?: string
  type?: 'text' | 'textarea'
}

export type LabFormSection = {
  title?: string
  fields: LabFormField[]
}

export type LabFormPanel = {
  slug: LabPanelSlug
  label: string
  sections: LabFormSection[]
}

const ALL_LAB_FORM_PANELS: LabFormPanel[] = [
  {
    slug: 'coagulation',
    label: 'Coagulation Test',
    sections: [
      {
        fields: [
          { key: 'inr', label: 'I.N.R', reference: 'MAL (0.83 - 1.35) / FEMAL (0.99 - 1.29)' },
          { key: 'pt', label: 'P.T', reference: '10 - 16 seconds' },
          { key: 'ptt', label: 'P.TT', reference: '25 - 36 seconds' },
        ],
      },
    ],
  },
  {
    slug: 'diabetic',
    label: 'Diabetic Test',
    sections: [
      {
        fields: [
          { key: 'fbg', label: 'FBG', unit: 'mg/dl', reference: '70 - 110 mg/dl' },
          { key: 'postPrandial', label: '2 hour post prandial', unit: 'mg/dl', reference: '< 180 mg/dl' },
          { key: 'rbg', label: 'RBG', unit: 'mg/dl', reference: '< 180 mg/dl' },
          { key: 'hba1c', label: 'HbA1c', unit: '%', reference: '6%' },
        ],
      },
    ],
  },
  {
    slug: 'fertility',
    label: 'Fertility Hormones',
    sections: [
      {
        fields: [
          { key: 'fsh', label: 'FSH', unit: 'mlU/ml', reference: '6 - 21 mid-cycle / 1 - 9 luteal / 22 - 153 postmenopausal' },
          { key: 'prl', label: 'PRL', unit: 'ng/ml', reference: '5 - 35 ng/ml' },
          { key: 'lh', label: 'LH', unit: 'mlu/ML', reference: 'Follicular 1.0 - 12.0 / Ovulatory 17.0 - 77.0 / Luteal 0.0 - 15.0' },
          { key: 'testosterone', label: 'Testostrone Hormone', unit: 'ng/ml', reference: '1.9 - 8.4 ng/ml' },
          { key: 'progesterone', label: 'Progestrone Hormone', unit: 'ng/ml', reference: '0.7 - 1 or 2 - 25 ng/ml' },
          { key: 'amh', label: 'Anti-Mullerian Hormone', reference: '≤ 5' },
        ],
      },
    ],
  },
  {
    slug: 'lipid',
    label: 'Lipid Profile',
    sections: [
      {
        fields: [
          { key: 'tc', label: 'TC', unit: 'mg/dl', reference: '< 200 mg/dl' },
          { key: 'hdl', label: 'HDL', unit: 'mg/dl', reference: '40 - 60 mg/dl' },
          { key: 'ldl', label: 'LDL', unit: 'mg/dl', reference: '< 120 mg/dl' },
          { key: 'cholesterol', label: 'Cholesterol', unit: 'mg/dl', reference: '< 200 mg/dl' },
          { key: 'triglycerides', label: 'Triglycerides', unit: 'mg/dl', reference: '150 - 199 mg/dl' },
        ],
      },
    ],
  },
  {
    slug: 'liver',
    label: 'Liver Function',
    sections: [
      {
        fields: [
          { key: 'totalBilirubin', label: 'Total Bilirubin', unit: 'mg/dl', reference: '0.2 - 1.2 mg/dl' },
          { key: 'directBilirubin', label: 'Direct Bilirubin (Conjugated)', unit: 'g/dl', reference: '< 1 g/dl' },
          { key: 'indirectBilirubin', label: 'Indirect Bilirubin (Unconjugated)', unit: 'g/dl', reference: '< 1 g/dl' },
          { key: 'tProtein', label: 'T.protein', unit: 'g/dl', reference: '6.5 - 8.5 g/dl' },
          { key: 'albumin', label: 'Albumin', unit: 'g/dl', reference: '3.5 - 5 g/dl' },
          { key: 'alt', label: 'ALT (Enzyme)', unit: 'u/l', reference: '< 35 u/l' },
          { key: 'ast', label: 'AST (Enzyme)', unit: 'u/l', reference: '< 35 u/l' },
          { key: 'alp', label: 'ALP (Enzyme)', unit: 'u/l', reference: '< 250 u/l' },
        ],
      },
    ],
  },
  {
    slug: 'renal',
    label: 'Renal function',
    sections: [
      {
        title: 'Renal function',
        fields: [
          { key: 'bloodUrea', label: 'Blood Urea', unit: 'mg/dl', reference: '15 - 50 mg/dl' },
          { key: 'creatinine', label: 'S.Creatinine', unit: 'mg/dl', reference: '0.6 - 1.1 mg/dl' },
          { key: 'uricAcid', label: 'Uric Acids', unit: 'mg/dl', reference: '3.7 - 7 mg/dl' },
        ],
      },
      {
        title: 'S.Electrolytes',
        fields: [
          { key: 'sodium', label: 'Sodium (Na+)', unit: 'nmol/L', reference: '135 - 155 nmol/L' },
          { key: 'potassium', label: 'Potassuim (K+)', unit: 'nmol/L', reference: '3.5 - 5.5 nmol/L' },
          { key: 'calcium', label: 'Calcium (Ca2+)', unit: 'mg/dl', reference: '8.1 - 10.1 mg/dl' },
          { key: 'phosphorus', label: 'Phosphoras', unit: 'mg/dl', reference: '2.5 - 5.5 mg/dl' },
          { key: 'ionizedCalcium', label: 'Iron Calium', unit: 'nmol/L', reference: '1.2 - 1.32 nmol/L' },
        ],
      },
    ],
  },
  {
    slug: 'screening',
    label: 'Screening Test',
    sections: [
      {
        fields: [
          { key: 'hivT1', label: 'HIV (T1)' },
          { key: 'hivT2', label: 'HIV (T2)' },
          { key: 'hbsAg', label: 'HBsAg' },
          { key: 'hcv', label: 'HCV' },
          { key: 'vdrl', label: 'VDRL' },
        ],
      },
    ],
  },
  {
    slug: 'thyroid',
    label: 'Thyroids Hormones Test',
    sections: [
      {
        fields: [
          { key: 't3', label: 'T3', unit: 'ng/mL', reference: '1.23 - 3.07 ng/mL' },
          { key: 't4', label: 'T4', unit: 'nmol/L', reference: '66 - 181 nmol/L' },
          { key: 'tsh', label: 'TSH', unit: 'Mu/mL', reference: '0.3 - 4.2 Mu/mL' },
          { key: 'ft3', label: 'FT3', unit: 'Pmol/L', reference: '3.1 - 6.8 Pmol/L' },
          { key: 'ft4', label: 'FT4', unit: 'Pmol/L', reference: '12 - 22 Pmol/L' },
        ],
      },
    ],
  },
  {
    slug: 'torch',
    label: 'TORCH IgG Combo Rapid Test',
    sections: [
      {
        fields: [
          { key: 'toxoplasmaIgg', label: 'Toxoplasma Gondi — IgG' },
          { key: 'toxoplasmaIgm', label: 'Toxoplasma Gondi — IgM' },
          { key: 'rubellaIgg', label: 'Rubella Virus — IgG' },
          { key: 'rubellaIgm', label: 'Rubella Virus — IgM' },
          { key: 'cmvIgg', label: 'Cytomegalo Virus — IgG' },
          { key: 'cmvIgm', label: 'Cytomegalo Virus — IgM' },
          { key: 'herpesIgg', label: 'Herpes Virus — IgG' },
          { key: 'herpesIgm', label: 'Herpes Virus — IgM' },
        ],
      },
    ],
  },
  {
    slug: 'routine',
    label: 'Routine Investigation',
    sections: [
      {
        fields: [
          { key: 'bffm', label: 'B.F.F.M' },
          { key: 'sikilingTest', label: 'Sikiling Test' },
          { key: 'hPyloria', label: 'H.PYLORIA' },
          { key: 'dDimer', label: 'D.Dimer Test', reference: '0 - 0.5 mg/l' },
          { key: 'rheumatoidFactor', label: 'Rematoid Factor' },
          { key: 'urineHcg', label: 'Urine HCG' },
          { key: 'fbg', label: 'FBG', reference: '70 - 120 mg/dl' },
          { key: 'rbg', label: 'RBG', reference: '120 - 180 mg/dl' },
          { key: 'sTroponin', label: 'S.Troponin' },
          { key: 'sChlamydia', label: 'S.Chlamydia Test' },
          { key: 'swapChlamydia', label: 'Swap Chlamydia Test' },
          { key: 'esr', label: 'ESR', unit: 'mm1/2hour' },
          { key: 'hb', label: 'HB', unit: 'g/dl' },
          { key: 'hbPercent', label: 'HB', unit: '%' },
          { key: 'serumHcg', label: 'Serum HCG' },
          { key: 'bHcg', label: 'B. HCG' },
          { key: 'bloodGrouping', label: 'Blood Grouping' },
          { key: 'crp', label: 'CRP' },
          { key: 'aso', label: 'ASO' },
          { key: 'psa', label: 'PSA' },
          { key: 'afbStain', label: 'AFB Stain for M.Tuberculosis' },
          { key: 'widalTyphiaO', label: 'Widdall S.typhia (O) titer' },
          { key: 'widalTyphiaBO', label: 'S.typhia (BO) titer' },
          { key: 'widalComment', label: 'Comment', type: 'textarea' },
          { key: 'widalBrucellaA', label: 'Widdall Brucelle (A) titer' },
          { key: 'widalBrucellaM', label: 'Brucella (M) titer' },
          { key: 'brucellaComment', label: 'Comment', type: 'textarea' },
        ],
      },
      {
        title: 'Urine General — Macro Exam',
        fields: [
          { key: 'urineColor', label: 'Color' },
          { key: 'urinePh', label: 'PH' },
          { key: 'urineGlucose', label: 'Glucose' },
          { key: 'urineBilirubin', label: 'Bilirubin' },
          { key: 'urineKetones', label: 'Ketones' },
          { key: 'urineProtein', label: 'Protein' },
          { key: 'urineUrobilinogen', label: 'Urobillinogen' },
          { key: 'urineGravity', label: 'S.Grafity' },
          { key: 'urinePusCells', label: 'Pus Cells' },
          { key: 'urineRbcs', label: 'RBCs' },
          { key: 'urineCasts', label: 'Casts' },
          { key: 'urineCrystals', label: 'Crytals' },
          { key: 'urineOva', label: 'OVA' },
          { key: 'urineOthers', label: 'Others' },
        ],
      },
      {
        title: 'Stool General — Macro Exam',
        fields: [
          { key: 'stoolColor', label: 'Color' },
          { key: 'stoolConsistency', label: 'Consistency' },
          { key: 'stoolMucus', label: 'Mucus' },
          { key: 'stoolBlood', label: 'Blood' },
          { key: 'stoolWorm', label: 'Worm' },
          { key: 'stoolPh', label: 'PH' },
          { key: 'stoolPusCells', label: 'Pus Cells' },
          { key: 'stoolRbcs', label: 'RBCs' },
          { key: 'stoolCysts', label: 'Cysts' },
          { key: 'stoolTrophozoite', label: 'Trophozoite' },
          { key: 'stoolOva', label: 'OVA' },
          { key: 'stoolOthers', label: 'Others' },
        ],
      },
    ],
  },
  {
    slug: 'semen',
    label: 'Semen Analysis',
    sections: [
      {
        fields: [
          { key: 'lastEjaculation', label: 'Last ejaculation before' },
          { key: 'collectionTime', label: 'Collection time' },
          { key: 'sampleExamAfter', label: 'Sample exam after' },
        ],
      },
      {
        title: 'Test details',
        fields: [
          { key: 'quantity', label: 'Quantity', reference: '2.5 - 5 ml' },
          { key: 'colour', label: 'Colour', reference: 'Gray white' },
          { key: 'reaction', label: 'Reaction', reference: 'Alkaline' },
          { key: 'viscosity', label: 'Viscosity', reference: 'Moderately' },
          { key: 'liquefactionTime', label: 'Liquefaction-Time', reference: '30 - 45 min' },
          { key: 'spermCount', label: 'Sperm count', reference: '60 Million/ml' },
          { key: 'vigorous1h', label: 'Vigorous (1 Hour)', unit: '%' },
          { key: 'sluggish1h', label: 'Sluggish (1 Hour)', unit: '%' },
          { key: 'nonMotile1h', label: 'Non-Motile (1 Hour)', unit: '%' },
          { key: 'vigorous2h', label: 'Vigorous (2 Hour)', unit: '%' },
          { key: 'sluggish2h', label: 'Sluggish (2 Hour)', unit: '%' },
          { key: 'nonMotile2h', label: 'Non-Motile (2 Hour)', unit: '%' },
          { key: 'activeHead', label: 'Active — Head', unit: '%' },
          { key: 'activeMiddle', label: 'Active — Middle piece', unit: '%' },
          { key: 'activeTail', label: 'Active — Tail', unit: '%' },
          { key: 'nonActiveHead', label: 'Non Active — Head', unit: '%' },
          { key: 'nonActiveMiddle', label: 'Non Active — Middle piece', unit: '%' },
          { key: 'nonActiveTail', label: 'Non Active — Tail', unit: '%' },
          { key: 'viablePercent', label: 'Viable', unit: '%' },
          { key: 'nonViablePercent', label: 'Non-viable', unit: '%' },
          { key: 'pusCells', label: 'Pus cells', unit: 'HPF' },
          { key: 'rbcs', label: 'RBCs', unit: 'HPF' },
        ],
      },
    ],
  },
]

export const LAB_FORM_PANELS: LabFormPanel[] = LAB_PANEL_DISPLAY_ORDER.map(
  (slug) => ALL_LAB_FORM_PANELS.find((panel) => panel.slug === slug)!,
)

export function getLabFormPanel(slug: LabPanelSlug) {
  return ALL_LAB_FORM_PANELS.find((panel) => panel.slug === slug)
}

export function emptyPanelValues(panel: LabFormPanel): Record<string, string> {
  const values: Record<string, string> = {}
  for (const section of panel.sections) {
    for (const field of section.fields) {
      values[field.key] = ''
    }
  }
  return values
}

export function isLabPanelFieldFilled(value: string | null | undefined) {
  return value != null && String(value).trim().length > 0
}

export type LabFormFieldWithValue = LabFormField & { value: string }

export function getFilledLabPanelSections(
  panel: LabFormPanel,
  saved?: Record<string, string> | null,
) {
  return panel.sections
    .map((section) => ({
      title: section.title,
      fields: section.fields
        .filter((field) => isLabPanelFieldFilled(saved?.[field.key]))
        .map((field) => ({ ...field, value: String(saved![field.key]).trim() })),
    }))
    .filter((section) => section.fields.length > 0)
}
