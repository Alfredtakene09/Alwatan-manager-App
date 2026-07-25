import * as XLSX from 'xlsx'
import { buildClinicPrintHeader, openPrintDocument } from '@/lib/print-document'

export type ExportCell = string | number | boolean | null | undefined

export type ExportColumn<T> = {
  header: string
  value: (row: T) => ExportCell
}

function cellText(value: ExportCell): string {
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

function stamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

/** Nom de fichier sûr sans extension. */
export function exportBasename(title: string): string {
  const slug = title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
  return `${slug || 'export'}-${stamp()}`
}

export function rowsToMatrix<T>(columns: ExportColumn<T>[], rows: T[]): string[][] {
  const header = columns.map((c) => c.header)
  const body = rows.map((row) => columns.map((c) => cellText(c.value(row))))
  return [header, ...body]
}

export function rowsToHtmlTable<T>(
  columns: ExportColumn<T>[],
  rows: T[],
  extras?: { captionRows?: Array<{ label: string; value: string }> },
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
  return `${caption}
<table>
  <thead><tr><th>#</th>${head}</tr></thead>
  <tbody>${body || `<tr><td colspan="${columns.length + 1}">Aucune donnée</td></tr>`}</tbody>
</table>`
}

/** Ouvre l’aperçu impression / Enregistrer en PDF. */
export function exportTablePdf<T>(
  title: string,
  columns: ExportColumn<T>[],
  rows: T[],
  options?: {
    captionRows?: Array<{ label: string; value: string }>
    autoPrint?: boolean
  },
): void {
  const body = `${buildClinicPrintHeader(title)}
${rowsToHtmlTable(columns, rows, { captionRows: options?.captionRows })}`
  openPrintDocument(title, body, { pageSize: 'A4', autoPrint: options?.autoPrint !== false })
}

/** Télécharge un fichier Excel (.xlsx). */
export function exportTableExcel<T>(
  title: string,
  columns: ExportColumn<T>[],
  rows: T[],
  options?: { sheetName?: string; filename?: string },
): void {
  const matrix = rowsToMatrix(columns, rows)
  const sheet = XLSX.utils.aoa_to_sheet(matrix)
  const colWidths = columns.map((col) => {
    const headerLen = col.header.length
    const maxCell = rows.reduce((max, row) => Math.max(max, cellText(col.value(row)).length), 0)
    return { wch: Math.min(48, Math.max(10, headerLen, maxCell) + 2) }
  })
  sheet['!cols'] = colWidths

  const workbook = XLSX.utils.book_new()
  const sheetName = (options?.sheetName ?? 'Export').slice(0, 31)
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName)
  XLSX.writeFile(workbook, `${options?.filename ?? exportBasename(title)}.xlsx`)
}

/** Plusieurs feuilles dans un seul classeur. */
export function exportWorkbook(
  filename: string,
  sheets: Array<{ name: string; columns: ExportColumn<any>[]; rows: any[] }>,
): void {
  const workbook = XLSX.utils.book_new()
  for (const sheetDef of sheets) {
    const matrix = rowsToMatrix(sheetDef.columns, sheetDef.rows)
    const sheet = XLSX.utils.aoa_to_sheet(matrix)
    XLSX.utils.book_append_sheet(workbook, sheet, sheetDef.name.slice(0, 31) || 'Feuille')
  }
  const base = filename.endsWith('.xlsx') ? filename.slice(0, -5) : filename
  XLSX.writeFile(workbook, `${base}.xlsx`)
}
