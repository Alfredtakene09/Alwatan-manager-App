export type ExportCell = string | number | boolean | null | undefined

export type ExportColumn<T> = {
  header: string
  value: (row: T) => ExportCell
}

export type ExportCaptionRow = { label: string; value: string }

export function cellText(value: ExportCell): string {
  if (value == null) return ''
  if (typeof value === 'boolean') return value ? 'Oui' : 'Non'
  return String(value)
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
  const body = rows.map((row) => columns.map((c) => cellText(c.value(row))))
  return [header, ...body, ...totalsToMatrix(extras?.totalsRows)]
}

/**
 * Tableau HTML d’export. Les totaux sont un tableau séparé *après* les données
 * (pas un `<tfoot>`) pour n’apparaître qu’en fin de dernière page à l’impression.
 */
export function rowsToHtmlTable<T>(
  columns: ExportColumn<T>[],
  rows: T[],
  extras?: {
    captionRows?: ExportCaptionRow[]
    totalsRows?: ExportCaptionRow[]
    emptyLabel?: string
  },
): string {
  const caption = (extras?.captionRows ?? [])
    .map((r) => `<div class="row"><span>${escapeHtml(r.label)}</span><strong>${escapeHtml(r.value)}</strong></div>`)
    .join('')
  const head = columns.map((c) => `<th>${escapeHtml(c.header)}</th>`).join('')
  const body = rows
    .map((row, index) => {
      const cells = columns.map((c) => `<td>${escapeHtml(c.value(row))}</td>`).join('')
      return `<tr><td>${index + 1}</td>${cells}</tr>`
    })
    .join('')
  const colCount = columns.length + 1
  const emptyLabel = extras?.emptyLabel ?? 'Aucune donnée'
  const totals = (extras?.totalsRows ?? [])
    .map(
      (r) =>
        `<tr class="report-total"><th>${escapeHtml(r.label)}</th><td>${escapeHtml(r.value)}</td></tr>`,
    )
    .join('')
  const totalsTable = totals
    ? `<table class="report-totals">
  <tbody>${totals}</tbody>
</table>`
    : ''
  return `${caption}
<table class="report-data">
  <thead><tr><th>#</th>${head}</tr></thead>
  <tbody>${body || `<tr><td colspan="${colCount}">${escapeHtml(emptyLabel)}</td></tr>`}</tbody>
</table>
${totalsTable}`
}
