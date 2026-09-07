import { getLabFormPanel, labFieldCommentKey, type LabFormPanel } from '@/lib/lab-form-panels'

type ClassicRow = {
  key: string
  label: string
}

const STOOL_GENERAL: ClassicRow[] = [
  { key: 'stoolColor', label: 'Colour' },
  { key: 'stoolReaction', label: 'Reaction' },
  { key: 'stoolConsistency', label: 'Consistancy' },
  { key: 'stoolMucus', label: 'Mucus' },
  { key: 'stoolBlood', label: 'Blood' },
  { key: 'stoolWorm', label: 'Worms' },
]

const STOOL_MICROSCOPIC: ClassicRow[] = [
  { key: 'stoolPusCells', label: 'Pus cels' },
  { key: 'stoolRbcs', label: 'RBCs' },
  { key: 'stoolCysts', label: 'Cysts' },
  { key: 'stoolOva', label: 'Ova' },
  { key: 'stoolFlagellate', label: 'Flagellate' },
  { key: 'stoolGiardia', label: 'Gardia.L' },
  { key: 'stoolWormsMicro', label: 'Worms' },
  { key: 'stoolTrophozoite', label: 'E.Hist' },
  { key: 'stoolUndigested', label: 'Udigested Food' },
  { key: 'stoolYeast', label: 'Yeast cells' },
  { key: 'stoolOthers', label: 'Other' },
]

const URINE_GENERAL: ClassicRow[] = [
  { key: 'urineColor', label: 'Colour' },
  { key: 'urineReaction', label: 'Reaction' },
  { key: 'urineAlbumin', label: 'Albumin' },
  { key: 'urineSugar', label: 'Sugar' },
  { key: 'urineAcetone', label: 'Acetone' },
  { key: 'urineBile', label: 'Bile' },
]

const URINE_DEPOSIT: ClassicRow[] = [
  { key: 'urinePusCells', label: 'Pus cels' },
  { key: 'urineRbcs', label: 'RBCs' },
  { key: 'urineEpithelial', label: 'Epith.cell' },
  { key: 'urineCrystals', label: 'Crystals' },
  { key: 'urineCasts', label: 'Casts' },
  { key: 'urineOva', label: 'Ova' },
  { key: 'urineTvaginalis', label: 'T.Vaginalis' },
  { key: 'urineYeast', label: 'Yeast' },
  { key: 'urineOthers', label: 'Other' },
]

const ALL_CLASSIC_KEYS = new Set(
  [...STOOL_GENERAL, ...STOOL_MICROSCOPIC, ...URINE_GENERAL, ...URINE_DEPOSIT].map((row) => row.key),
)

const EXTRA_EXCLUDED_PREFIX_KEYS = new Set(['urineHcg', 'stoolTrypanosoma'])

const URINE_GENERAL_LEFTOVER = new Set([
  'urinePh',
  'urineGlucose',
  'urineProtein',
  'urineBilirubin',
  'urineKetones',
  'urineBlood',
  'urineUrobilinogen',
  'urineGravity',
])

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function fieldValue(values: Record<string, string>, key: string) {
  const raw = values[key]?.trim() ?? ''
  const comment = values[labFieldCommentKey(key)]?.trim() ?? ''
  if (raw && comment) return `${raw} ${comment}`
  return raw || comment
}

function isStoolOrUrineResultKey(key: string) {
  if (EXTRA_EXCLUDED_PREFIX_KEYS.has(key)) return false
  if (key.endsWith('__comment')) return false
  return key.startsWith('stool') || key.startsWith('urine')
}

export function valuesHaveClassicStoolOrUrine(values: Record<string, string>) {
  return Object.entries(values).some(
    ([key, value]) => isStoolOrUrineResultKey(key) && String(value ?? '').trim().length > 0,
  )
}

function leftoverRows(
  values: Record<string, string>,
  prefix: 'stool' | 'urine',
  panel: LabFormPanel | undefined,
  intoGeneral: boolean,
) {
  const labelByKey = new Map(
    (panel?.sections.flatMap((section) => section.fields) ?? []).map((field) => [field.key, field.label]),
  )
  return Object.entries(values)
    .filter(([key, value]) => {
      if (!key.startsWith(prefix) || ALL_CLASSIC_KEYS.has(key) || EXTRA_EXCLUDED_PREFIX_KEYS.has(key)) {
        return false
      }
      if (key.endsWith('__comment')) return false
      if (!String(value ?? '').trim()) return false
      const isGeneral = prefix === 'stool' ? key === 'stoolPh' : URINE_GENERAL_LEFTOVER.has(key)
      return intoGeneral ? isGeneral : !isGeneral
    })
    .map(([key, value]) => ({
      label: labelByKey.get(key) ?? key.replace(prefix, '').replace(/([A-Z])/g, ' $1').trim(),
      value: String(value).trim(),
    }))
}

function extraFilledRows(panel: LabFormPanel | undefined, values: Record<string, string>) {
  const fields = panel?.sections.flatMap((section) => section.fields) ?? []
  const byKey = new Map(fields.map((field) => [field.key, field]))
  const seen = new Set<string>()
  const rows: Array<{ label: string; value: string }> = []

  const pushKey = (key: string, label: string) => {
    if (seen.has(key) || ALL_CLASSIC_KEYS.has(key) || isStoolOrUrineResultKey(key)) return
    const value = fieldValue(values, key)
    if (!value) return
    seen.add(key)
    rows.push({ label, value })
  }

  for (const field of fields) {
    pushKey(field.key, field.label)
  }
  for (const [key] of Object.entries(values)) {
    if (key.endsWith('__comment')) continue
    pushKey(key, byKey.get(key)?.label ?? key)
  }
  return rows
}

function mappedRows(defs: ClassicRow[], values: Record<string, string>, extras: Array<{ label: string; value: string }>) {
  return [
    ...defs.map((row) => ({ label: row.label, value: fieldValue(values, row.key) })),
    ...extras,
  ].filter((row) => row.value.trim().length > 0)
}

function renderRows(rows: Array<{ label: string; value: string }>) {
  return rows
    .map(
      (row) => `
      <div class="lab-classic-sheet__row">
        <span class="lab-classic-sheet__label">${escapeHtml(row.label)}</span>
        <span class="lab-classic-sheet__colon">:</span>
        <span class="lab-classic-sheet__value">${escapeHtml(row.value)}</span>
      </div>`,
    )
    .join('')
}

function renderSection(title: string, rows: Array<{ label: string; value: string }>, sub = false) {
  if (!rows.length) return ''
  const titleClass = sub
    ? 'lab-classic-sheet__title lab-classic-sheet__title--sub'
    : 'lab-classic-sheet__title'
  return `
    <div class="lab-classic-sheet__section">
      <div class="${titleClass}">${escapeHtml(title)}</div>
      <div class="lab-classic-sheet__group">${renderRows(rows)}</div>
    </div>
  `
}

export const LAB_CLASSIC_SHEET_STYLES = `
  .lab-classic-sheet {
    width: 100%;
    color: #0f172a;
    background: transparent;
  }
  .lab-classic-sheet__extras {
    margin: 0 0 10px;
    font-size: 16px;
    line-height: 1.45;
  }
  .lab-classic-sheet__extra-line {
    margin: 0 0 3px;
    font-weight: 600;
  }
  .lab-classic-sheet__table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    border: 1.5px solid #0f172a;
    background: #fff;
  }
  .lab-classic-sheet__table td {
    width: calc(100% / var(--classic-cols, 3));
    vertical-align: top;
    padding: 8px 10px 10px;
    border: 1.5px solid #0f172a;
    background: #fff;
  }
  .lab-classic-sheet__title {
    margin: 0 0 8px;
    text-align: center;
    font-size: 16px;
    font-weight: 700;
    letter-spacing: 0.04em;
  }
  .lab-classic-sheet__title--sub {
    margin: 10px 0 8px;
    padding-top: 8px;
    border-top: 1px solid #94a3b8;
    font-size: 15px;
  }
  .lab-classic-sheet__group {
    display: grid;
    gap: 3px;
  }
  .lab-classic-sheet__row {
    display: grid;
    grid-template-columns: 1.2fr 8px 1fr;
    align-items: baseline;
    column-gap: 4px;
    font-size: 13.5px;
    line-height: 1.35;
  }
  .lab-classic-sheet__label {
    font-weight: 600;
    color: #1e293b;
  }
  .lab-classic-sheet__colon {
    text-align: center;
    font-weight: 700;
  }
  .lab-classic-sheet__value {
    font-weight: 600;
    min-height: 1em;
    color: #0f172a;
  }
`

/** BFFM et autres tests isolés au-dessus, puis 4 sections dans 3 cellules. */
export function renderClassicStoolUrineTable(slug: string, values: Record<string, string>) {
  const panel = getLabFormPanel(slug)
  const extras = extraFilledRows(panel, values)

  const stoolGeneral = mappedRows(
    STOOL_GENERAL,
    values,
    leftoverRows(values, 'stool', panel, true),
  )
  const stoolMicro = mappedRows(
    STOOL_MICROSCOPIC,
    values,
    leftoverRows(values, 'stool', panel, false),
  )
  const urineGeneral = mappedRows(
    URINE_GENERAL,
    values,
    leftoverRows(values, 'urine', panel, true),
  )
  const urineDeposit = mappedRows(
    URINE_DEPOSIT,
    values,
    leftoverRows(values, 'urine', panel, false),
  )

  const extrasHtml = extras.length
    ? `<div class="lab-classic-sheet__extras">${extras
        .map(
          (row) =>
            `<p class="lab-classic-sheet__extra-line">${escapeHtml(row.label)} = ${escapeHtml(row.value)}</p>`,
        )
        .join('')}</div>`
    : ''

  const urineGeneralHtml = renderSection('Urine General', urineGeneral)
  const columns = [
    renderSection('Stool General', stoolGeneral),
    renderSection('Microscopic', stoolMicro),
    [urineGeneralHtml, renderSection('Diposite', urineDeposit, Boolean(urineGeneralHtml))]
      .filter(Boolean)
      .join(''),
  ].filter(Boolean)

  const tableHtml = columns.length
    ? `<table class="lab-classic-sheet__table" style="--classic-cols: ${columns.length}">
        <tr>
          ${columns.map((html) => `<td>${html}</td>`).join('')}
        </tr>
      </table>`
    : ''

  return `
    <div class="lab-classic-sheet">
      ${extrasHtml}
      ${tableHtml}
    </div>
  `
}
