import { stripBidiMarks } from './format-fcfa'

export type ExportCell = string | number | boolean | null | undefined

export type ExportColumn<T> = {
  header: string
  value: (row: T) => ExportCell
}

export type ExportCaptionRow = { label: string; value: string }

/** Bloc d’export (ex. employés d’un poste) avec son propre tableau. */
export type ExportSection<T = any> = {
  title: string
  columns: ExportColumn<T>[]
  rows: T[]
  totalsRows?: ExportCaptionRow[]
  /** Ligne de total en pied de tableau PDF, une cellule par colonne. */
  footRow?: ExportCell[]
  /** Page / feuille dédiée (récapitulatif, etc.). */
  ownPage?: boolean
}

export function cellText(value: ExportCell): string {
  if (value == null) return ''
  if (typeof value === 'boolean') return value ? 'Oui' : 'Non'
  return stripBidiMarks(String(value))
}

/** Patient, examen ou autre ligne désactivée / supprimée : hors exports. */
export function isExportableRow(row: unknown): boolean {
  if (row == null || typeof row !== 'object') return true
  const record = row as Record<string, unknown>
  if (record.active === false || record.isActive === false) return false
  if (record.deleted === true) return false
  if (record.deletedAt != null && record.deletedAt !== '') return false
  return true
}

export function exportableRows<T>(rows: T[]): T[] {
  return rows.filter(isExportableRow)
}

export function escapeHtml(value: ExportCell): string {
  return cellText(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Totaux en fin de feuille / document — jamais répétés en en-tête de page. */
export function totalsToMatrix(totalsRows: ExportCaptionRow[] | undefined): string[][] {
  if (!totalsRows?.length) return []
  return [[], ...totalsRows.map((row) => [row.label, row.value])]
}

export function rowsToMatrix<T>(
  columns: ExportColumn<T>[],
  rows: T[],
  extras?: { totalsRows?: ExportCaptionRow[] },
): string[][] {
  const header = columns.map((c) => c.header)
  const body = exportableRows(rows).map((row) => columns.map((c) => cellText(c.value(row))))
  return [header, ...body, ...totalsToMatrix(extras?.totalsRows)]
}

/**
 * Tableau HTML d’export. Les totaux sont un tableau séparé *après* les données
 * (pas un `<tfoot>`) pour n’apparaître qu’en fin de dernière page à l’impression.
 */
function captionHtml(captionRows: ExportCaptionRow[] | undefined): string {
  return (captionRows ?? [])
    .map((r) => `<div class="row"><span>${escapeHtml(r.label)}</span><strong>${escapeHtml(r.value)}</strong></div>`)
    .join('')
}

function totalsHtml(totalsRows: ExportCaptionRow[] | undefined): string {
  if (!totalsRows?.length) return ''
  const rows = totalsRows
    .map(
      (r) =>
        `<tr class="report-total"><th>${escapeHtml(r.label)}</th><td>${escapeHtml(r.value)}</td></tr>`,
    )
    .join('')
  return `<table class="report-totals">
  <tbody>${rows}</tbody>
</table>`
}

export function rowsToHtmlTable<T>(
  columns: ExportColumn<T>[],
  rows: T[],
  extras?: {
    captionRows?: ExportCaptionRow[]
    totalsRows?: ExportCaptionRow[]
    emptyLabel?: string
  },
): string {
  const head = columns.map((c) => `<th>${escapeHtml(c.header)}</th>`).join('')
  const body = exportableRows(rows)
    .map((row, index) => {
      const cells = columns.map((c) => `<td>${escapeHtml(c.value(row))}</td>`).join('')
      return `<tr><td>${index + 1}</td>${cells}</tr>`
    })
    .join('')
  const colCount = columns.length + 1
  const emptyLabel = extras?.emptyLabel ?? 'Aucune donnée'
  return `${captionHtml(extras?.captionRows)}
<table class="report-data">
  <thead><tr><th>#</th>${head}</tr></thead>
  <tbody>${body || `<tr><td colspan="${colCount}">${escapeHtml(emptyLabel)}</td></tr>`}</tbody>
</table>
${totalsHtml(extras?.totalsRows)}`
}

/** Plusieurs tableaux (groupes) + totaux généraux en fin de document. */
export function sectionsToHtml(
  sections: ExportSection[],
  extras?: {
    captionRows?: ExportCaptionRow[]
    totalsRows?: ExportCaptionRow[]
    emptyLabel?: string
  },
): string {
  const emptyLabel = extras?.emptyLabel ?? 'Aucune donnée'
  const blocks = sections
    .map((section) => {
      const title = section.title
        ? `<h2 class="report-section-title">${escapeHtml(section.title)}</h2>`
        : ''
      const inner = `${title}${rowsToHtmlTable(section.columns, section.rows, {
        totalsRows: section.totalsRows,
        emptyLabel,
      })}`
      return section.ownPage ? `<div class="report-own-page">${inner}</div>` : inner
    })
    .join('')
  return `${captionHtml(extras?.captionRows)}${blocks}${totalsHtml(extras?.totalsRows)}`
}

/** Nom d’onglet Excel : 31 caractères, sans : \ / ? * [ ], unique dans le classeur. */
export function uniqueExcelSheetName(desired: string, used: Set<string>): string {
  const cleaned =
    stripBidiMarks(desired)
      .replace(/[:\\/?*[\]]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || 'Feuille'
  const take = (base: string, extra: string) => `${base.slice(0, Math.max(1, 31 - extra.length))}${extra}`
  let name = cleaned.slice(0, 31)
  let n = 2
  while (used.has(name.toLowerCase())) {
    name = take(cleaned, ` (${n})`)
    n += 1
  }
  used.add(name.toLowerCase())
  return name
}

export function uniqueExcelSheetNames(names: string[]): string[] {
  const used = new Set<string>()
  return names.map((name) => uniqueExcelSheetName(name, used))
}

export function sectionsToMatrix(
  sections: ExportSection[],
  extras?: { totalsRows?: ExportCaptionRow[] },
): string[][] {
  const matrix: string[][] = []
  for (const section of sections) {
    if (matrix.length) matrix.push([])
    if (section.title) matrix.push([section.title])
    matrix.push(...rowsToMatrix(section.columns, section.rows, { totalsRows: section.totalsRows }))
  }
  matrix.push(...totalsToMatrix(extras?.totalsRows))
  return matrix
}
