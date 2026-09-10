import * as XLSX from 'xlsx'
import { buildClinicPrintHeader, openPrintDocument } from '@/lib/print-document'
import { formatAppDateTime } from '@/i18n/locale-format'
import { translateUi } from '@/i18n/translate'
import { CLINIC, clinicTaxLine } from '@/lib/clinic'
import {
  escapeHtml,
  rowsToHtmlTable,
  rowsToMatrix,
  type ExportCaptionRow,
  type ExportCell,
  type ExportColumn,
} from '@/lib/table-export-html'
import { buildWordDocument, packWordBlob, type WordSheetDef } from '@/lib/table-export-word'

export { escapeHtml, rowsToHtmlTable, rowsToMatrix }
export type { ExportCaptionRow, ExportCell, ExportColumn }

export type TableExportOptions = {
  captionRows?: ExportCaptionRow[]
  totalsRows?: ExportCaptionRow[]
  filename?: string
  sheetName?: string
  autoPrint?: boolean
  generatedAt?: Date
}

export type WorkbookSheetDef<T = any> = {
  name: string
  columns: ExportColumn<T>[]
  rows: T[]
  totalsRows?: ExportCaptionRow[]
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

/** Date de génération + filtres appliqués (en-tête du PDF / Word). */
export function defaultReportCaptionRows(
  extra: ExportCaptionRow[] = [],
  generatedAt = new Date(),
): ExportCaptionRow[] {
  return [
    { label: translateUi('Date de génération'), value: formatAppDateTime(generatedAt) },
    ...extra,
  ]
}

function clinicHeaderLines(): string[] {
  const tax = clinicTaxLine()
  return [
    CLINIC.nameFr,
    CLINIC.nameAr,
    CLINIC.fullAddress,
    CLINIC.phoneLabel,
    CLINIC.email ? `${translateUi('Email :')} ${CLINIC.email}` : '',
    tax,
    CLINIC.printFooter,
  ].filter(Boolean)
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function excelColWidths<T>(columns: ExportColumn<T>[], rows: T[]) {
  return columns.map((col) => {
    const headerLen = col.header.length
    const maxCell = rows.reduce((max, row) => Math.max(max, String(col.value(row) ?? '').length), 0)
    return { wch: Math.min(48, Math.max(10, headerLen, maxCell) + 2) }
  })
}

/** Ouvre l’aperçu impression / Enregistrer en PDF. Totaux uniquement en fin de dernière page. */
export function exportTablePdf<T>(
  title: string,
  columns: ExportColumn<T>[],
  rows: T[],
  options?: TableExportOptions,
): void {
  const captionRows = defaultReportCaptionRows(options?.captionRows, options?.generatedAt)
  const body = `${buildClinicPrintHeader(title)}
${rowsToHtmlTable(columns, rows, {
  captionRows,
  totalsRows: options?.totalsRows,
  emptyLabel: translateUi('Aucune donnée'),
})}`
  openPrintDocument(title, body, {
    pageSize: 'A4',
    tableReport: true,
    autoPrint: options?.autoPrint !== false,
  })
}

/** Télécharge un fichier Excel (.xlsx). Les totaux sont ajoutés en bas de feuille, une seule fois. */
export function exportTableExcel<T>(
  title: string,
  columns: ExportColumn<T>[],
  rows: T[],
  options?: TableExportOptions,
): void {
  const matrix = rowsToMatrix(columns, rows, { totalsRows: options?.totalsRows })
  const sheet = XLSX.utils.aoa_to_sheet(matrix)
  sheet['!cols'] = excelColWidths(columns, rows)

  const workbook = XLSX.utils.book_new()
  const sheetName = (options?.sheetName ?? 'Export').slice(0, 31)
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName)
  XLSX.writeFile(workbook, `${options?.filename ?? exportBasename(title)}.xlsx`)
}

/** Plusieurs feuilles dans un seul classeur. Totaux en bas de chaque feuille si fournis. */
export function exportWorkbook(filename: string, sheets: WorkbookSheetDef[]): void {
  const workbook = XLSX.utils.book_new()
  for (const sheetDef of sheets) {
    const matrix = rowsToMatrix(sheetDef.columns, sheetDef.rows, { totalsRows: sheetDef.totalsRows })
    const sheet = XLSX.utils.aoa_to_sheet(matrix)
    XLSX.utils.book_append_sheet(workbook, sheet, sheetDef.name.slice(0, 31) || 'Feuille')
  }
  const base = filename.endsWith('.xlsx') ? filename.slice(0, -5) : filename
  XLSX.writeFile(workbook, `${base}.xlsx`)
}

/** Télécharge un fichier Word (.docx) équivalent au PDF/Excel (mêmes colonnes, filtres et totaux). */
export async function exportTableWord<T>(
  title: string,
  columns: ExportColumn<T>[],
  rows: T[],
  options?: TableExportOptions,
): Promise<void> {
  const captionRows = defaultReportCaptionRows(options?.captionRows, options?.generatedAt)
  const doc = buildWordDocument(
    title,
    [
      {
        name: options?.sheetName ?? title,
        columns,
        rows,
        captionRows,
        totalsRows: options?.totalsRows,
        emptyLabel: translateUi('Aucune donnée'),
      },
    ],
    { headerLines: clinicHeaderLines(), creator: CLINIC.shortName },
  )
  const blob = await packWordBlob(doc)
  downloadBlob(blob, `${options?.filename ?? exportBasename(title)}.docx`)
}

/** Plusieurs sections (équivalent multi-feuilles Excel) dans un seul document Word. */
export async function exportWorkbookWord(filename: string, sheets: WorkbookSheetDef[]): Promise<void> {
  const doc = buildWordDocument(
    filename.replace(/\.docx$/i, ''),
    sheets.map(
      (sheet): WordSheetDef => ({
        name: sheet.name,
        columns: sheet.columns,
        rows: sheet.rows,
        totalsRows: sheet.totalsRows,
        emptyLabel: translateUi('Aucune donnée'),
      }),
    ),
    { headerLines: clinicHeaderLines(), creator: CLINIC.shortName },
  )
  const blob = await packWordBlob(doc)
  const base = filename.replace(/\.docx$/i, '').replace(/\.xlsx$/i, '')
  downloadBlob(blob, `${base}.docx`)
}
