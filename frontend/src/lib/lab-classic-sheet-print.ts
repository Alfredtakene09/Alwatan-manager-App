import { getLabFormPanel, labFieldCommentKey, type LabFormPanel } from '@/lib/lab-form-panels'

type ClassicRow = {
  key: string
  label: string
}

type Bucket = 'stoolGeneral' | 'stoolMicro' | 'urineGeneral' | 'urineDeposit'

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

const BUCKET_ROWS: Record<Bucket, ClassicRow[]> = {
  stoolGeneral: STOOL_GENERAL,
  stoolMicro: STOOL_MICROSCOPIC,
  urineGeneral: URINE_GENERAL,
  urineDeposit: URINE_DEPOSIT,
}

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

/** Clés historiques / formulaires personnalisés → champ classique. */
const KEY_ALIASES: Record<string, string[]> = {
  stoolColor: ['stool_color', 'stool_colour', 'colour', 'color'],
  stoolReaction: ['stool_reaction', 'reaction'],
  stoolConsistency: ['stool_consistency', 'consistancy', 'consistency'],
  stoolMucus: ['stool_mucus', 'mucus'],
  stoolBlood: ['stool_blood'],
  stoolWorm: ['stool_worm', 'stool_worms'],
  stoolPh: ['stool_ph'],
  stoolPusCells: ['stool_pus_cells', 'stool_pus_cels'],
  stoolRbcs: ['stool_rbcs'],
  stoolCysts: ['stool_cysts', 'cysts'],
  stoolOva: ['stool_ova'],
  stoolFlagellate: ['stool_flagellate', 'flagellate'],
  stoolGiardia: ['stool_giardia', 'gardia_l', 'giardia_l', 'giardia'],
  stoolWormsMicro: ['stool_worms_micro'],
  stoolTrophozoite: ['stool_trophozoite', 'e_hist', 'ehist'],
  stoolUndigested: ['stool_undigested', 'vdigested_food', 'undigested_food', 'udigested_food'],
  stoolYeast: ['stool_yeast', 'yeast_cells'],
  stoolOthers: ['stool_others', 'stool_other'],
  urineColor: ['urine_color', 'urine_colour'],
  urineReaction: ['urine_reaction', 'reaction_2'],
  urineAlbumin: ['urine_albumin', 'albumin'],
  urineSugar: ['urine_sugar', 'sugar'],
  urineAcetone: ['urine_acetone', 'acetone'],
  urineBile: ['urine_bile', 'bile'],
  urinePh: ['urine_ph'],
  urineGlucose: ['urine_glucose'],
  urineProtein: ['urine_protein'],
  urineBilirubin: ['urine_bilirubin'],
  urineKetones: ['urine_ketones'],
  urineBlood: ['urine_blood'],
  urineUrobilinogen: ['urine_urobilinogen'],
  urineGravity: ['urine_gravity'],
  urinePusCells: ['urine_pus_cells', 'urine_pus_cels'],
  urineRbcs: ['urine_rbcs'],
  urineEpithelial: ['urine_epithelial', 'epith_cell'],
  urineCrystals: ['urine_crystals', 'crystals'],
  urineCasts: ['urine_casts', 'casts'],
  urineOva: ['urine_ova'],
  urineTvaginalis: ['urine_tvaginalis', 't_vaginalis', 'tvaginalis'],
  urineYeast: ['urine_yeast', 'yeast'],
  urineOthers: ['urine_others', 'urine_other'],
}

const ALIAS_TO_CANONICAL = new Map<string, string>()
for (const [canonical, aliases] of Object.entries(KEY_ALIASES)) {
  ALIAS_TO_CANONICAL.set(canonical.toLowerCase(), canonical)
  for (const alias of aliases) ALIAS_TO_CANONICAL.set(alias.toLowerCase(), canonical)
}

const CANONICAL_BUCKET = new Map<string, Bucket>()
for (const [bucket, rows] of Object.entries(BUCKET_ROWS) as Array<[Bucket, ClassicRow[]]>) {
  for (const row of rows) CANONICAL_BUCKET.set(row.key, bucket)
}
for (const key of URINE_GENERAL_LEFTOVER) CANONICAL_BUCKET.set(key, 'urineGeneral')
CANONICAL_BUCKET.set('stoolPh', 'stoolGeneral')

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function toSnake(key: string) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase()
}

function fieldValue(values: Record<string, string>, key: string) {
  const raw = values[key]?.trim() ?? ''
  const comment = values[labFieldCommentKey(key)]?.trim() ?? ''
  if (raw && comment) return `${raw} ${comment}`
  return raw || comment
}

function humanizeKey(key: string) {
  return key
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
}

function isStoolOrUrineResultKey(key: string) {
  if (EXTRA_EXCLUDED_PREFIX_KEYS.has(key)) return false
  if (key.endsWith('__comment')) return false
  if (key.startsWith('stool') || key.startsWith('urine')) return true
  return ALIAS_TO_CANONICAL.has(key.toLowerCase())
}

export function valuesHaveClassicStoolOrUrine(values: Record<string, string>) {
  return Object.entries(values).some(
    ([key, value]) => isStoolOrUrineResultKey(key) && String(value ?? '').trim().length > 0,
  )
}

function bucketFromSectionTitle(title?: string): Bucket | null {
  const t = (title ?? '').toLowerCase()
  if (!t) return null
  if (t.includes('micro')) return 'stoolMicro'
  if (t.includes('deposit') || t.includes('diposit')) return 'urineDeposit'
  if (t.includes('stool')) return 'stoolGeneral'
  if (t.includes('urine')) return 'urineGeneral'
  return null
}

function takeValue(values: Record<string, string>, used: Set<string>, keys: string[]) {
  for (const key of keys) {
    if (!key || used.has(key)) continue
    const value = fieldValue(values, key)
    if (!value) continue
    used.add(key)
    used.add(labFieldCommentKey(key))
    return value
  }
  return ''
}

function candidatesFor(canonical: string) {
  return [canonical, toSnake(canonical), ...(KEY_ALIASES[canonical] ?? [])]
}

function panelFieldLookup(panel: LabFormPanel | undefined) {
  const byKey = new Map<string, { label: string; section?: string }>()
  for (const section of panel?.sections ?? []) {
    for (const field of section.fields) {
      byKey.set(field.key, { label: field.label, section: section.title })
    }
  }
  return byKey
}

function collectBucketRows(
  bucket: Bucket,
  values: Record<string, string>,
  used: Set<string>,
  panel: LabFormPanel | undefined,
  byKey: Map<string, { label: string; section?: string }>,
) {
  const rows: Array<{ label: string; value: string }> = []
  const defs = BUCKET_ROWS[bucket]
  const seenLabels = new Set<string>()

  for (const def of defs) {
    const value = takeValue(values, used, candidatesFor(def.key))
    if (!value) continue
    rows.push({ label: def.label, value })
    seenLabels.add(def.label.toLowerCase())
  }

  if (bucket === 'stoolGeneral') {
    const ph = takeValue(values, used, candidatesFor('stoolPh'))
    if (ph) {
      rows.push({ label: byKey.get('stoolPh')?.label ?? 'PH', value: ph })
    }
  }
  if (bucket === 'urineGeneral') {
    for (const key of URINE_GENERAL_LEFTOVER) {
      const value = takeValue(values, used, candidatesFor(key))
      if (!value) continue
      rows.push({ label: byKey.get(key)?.label ?? humanizeKey(key.replace(/^urine/, '')), value })
    }
  }

  for (const section of panel?.sections ?? []) {
    if (bucketFromSectionTitle(section.title) !== bucket) continue
    for (const field of section.fields) {
      if (EXTRA_EXCLUDED_PREFIX_KEYS.has(field.key) || used.has(field.key)) continue
      const value = takeValue(values, used, [field.key, toSnake(field.key)])
      if (!value) continue
      if (seenLabels.has(field.label.toLowerCase())) continue
      rows.push({ label: field.label, value })
      seenLabels.add(field.label.toLowerCase())
    }
  }

  for (const [key, raw] of Object.entries(values)) {
    if (used.has(key) || key.endsWith('__comment') || EXTRA_EXCLUDED_PREFIX_KEYS.has(key)) continue
    if (!String(raw ?? '').trim()) continue
    const canonical = ALIAS_TO_CANONICAL.get(key.toLowerCase()) ?? key
    let guessed: Bucket | null = CANONICAL_BUCKET.get(canonical) ?? null
    if (!guessed) guessed = bucketFromSectionTitle(byKey.get(key)?.section)
    if (!guessed && key.startsWith('stool')) guessed = key === 'stoolPh' ? 'stoolGeneral' : 'stoolMicro'
    if (!guessed && key.startsWith('urine')) {
      guessed = URINE_GENERAL_LEFTOVER.has(key) ? 'urineGeneral' : 'urineDeposit'
    }
    if (guessed !== bucket) continue
    const value = takeValue(values, used, [key])
    if (!value) continue
    const label = byKey.get(key)?.label ?? humanizeKey(key.replace(/^(stool|urine)/, ''))
    if (seenLabels.has(label.toLowerCase())) continue
    rows.push({ label, value })
    seenLabels.add(label.toLowerCase())
  }

  return rows
}

function extraFilledRows(
  panel: LabFormPanel | undefined,
  values: Record<string, string>,
  used: Set<string>,
) {
  const rows: Array<{ label: string; value: string }> = []
  const seen = new Set<string>()

  for (const section of panel?.sections ?? []) {
    if (bucketFromSectionTitle(section.title)) continue
    for (const field of section.fields) {
      if (seen.has(field.key) || used.has(field.key)) continue
      const value = fieldValue(values, field.key)
      if (!value) continue
      const fallback = field.defaultValue?.trim() ?? ''
      if (fallback && value === fallback) continue
      seen.add(field.key)
      used.add(field.key)
      used.add(labFieldCommentKey(field.key))
      rows.push({ label: field.label, value })
    }
  }
  return rows
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
  const titleClass = sub
    ? 'lab-classic-sheet__title lab-classic-sheet__title--sub'
    : 'lab-classic-sheet__title'
  const body = rows.length
    ? `<div class="lab-classic-sheet__group">${renderRows(rows)}</div>`
    : ''
  return `
    <div class="lab-classic-sheet__section">
      <div class="${titleClass}">${escapeHtml(title)}</div>
      ${body}
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
    margin: 0 0 14px;
    padding: 8px 12px 10px;
    border: 1.5px solid #0f172a;
    background: #fff;
  }
  .lab-classic-sheet__extra-line {
    margin: 0 0 4px;
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
    width: 33.33%;
    vertical-align: top;
    padding: 10px 12px 12px;
    border: 1.5px solid #0f172a;
    background: #fff;
  }
  .lab-classic-sheet__title {
    margin: 0 0 10px;
    text-align: center;
    font-size: 18px;
    font-weight: 700;
    letter-spacing: 0.04em;
  }
  .lab-classic-sheet__title--sub {
    margin: 12px 0 10px;
    padding-top: 10px;
    border-top: 1px solid #94a3b8;
    font-size: 17px;
  }
  .lab-classic-sheet__group {
    display: grid;
    gap: 5px;
  }
  .lab-classic-sheet__row {
    display: grid;
    grid-template-columns: 1.25fr 10px 1fr;
    align-items: baseline;
    column-gap: 6px;
    font-size: 16px;
    line-height: 1.4;
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

/** Tests hors selles/urines au-dessus, puis 4 sections dans 3 colonnes. */
export function renderClassicStoolUrineTable(slug: string, values: Record<string, string>) {
  const panel = getLabFormPanel(slug)
  const byKey = panelFieldLookup(panel)
  const used = new Set<string>()

  const stoolGeneral = collectBucketRows('stoolGeneral', values, used, panel, byKey)
  const stoolMicro = collectBucketRows('stoolMicro', values, used, panel, byKey)
  const urineGeneral = collectBucketRows('urineGeneral', values, used, panel, byKey)
  const urineDeposit = collectBucketRows('urineDeposit', values, used, panel, byKey)
  const extras = extraFilledRows(panel, values, used)

  const extrasHtml = extras.length
    ? `<div class="lab-classic-sheet__extras">${renderSection('Investigations', extras)}</div>`
    : ''

  return `
    <div class="lab-classic-sheet">
      ${extrasHtml}
      <table class="lab-classic-sheet__table">
        <tr>
          <td>${renderSection('Stool General', stoolGeneral)}</td>
          <td>${renderSection('Microscopic', stoolMicro)}</td>
          <td>
            ${renderSection('Urine General', urineGeneral)}
            ${renderSection('Diposite', urineDeposit, true)}
          </td>
        </tr>
      </table>
    </div>
  `
}
