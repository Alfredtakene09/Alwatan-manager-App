import * as XLSX from 'xlsx'
import { formatAppDateTime } from '@/i18n/locale-format'
import { translateUi } from '@/i18n/translate'
import { CLINIC, clinicTaxLine } from '@/lib/clinic'
import {
  escapeHtml,
  rowsToHtmlTable,
  rowsToMatrix,
  sectionsToHtml,
  sectionsToMatrix,
  uniqueExcelSheetNames,
  type ExportCaptionRow,
  type ExportCell,
  type ExportColumn,
  type ExportSection,
} from '@/lib/table-export-html'
import {
  buildWordDocument,
  packWordBlob,
  type WordLogo,
  type WordSheetDef,
} from '@/lib/table-export-word'

export { escapeHtml, rowsToHtmlTable, rowsToMatrix, sectionsToHtml, sectionsToMatrix, uniqueExcelSheetNames }
export type { ExportCaptionRow, ExportCell, ExportColumn, ExportSection }

export type TableExportOptions = {
  captionRows?: ExportCaptionRow[]
  totalsRows?: ExportCaptionRow[]
  /** Si défini, remplace le tableau unique (groupes / récapitulatif). */
  sections?: ExportSection[]
  filename?: string
  sheetName?: string
  autoPrint?: boolean
  generatedAt?: Date
  /** PDF uniquement. */
  orientation?: 'portrait' | 'landscape'
  /** PDF uniquement : bordures visibles sur toutes les cellules. */
  gridLines?: boolean
}

export type WorkbookSheetDef<T = any> = {
  name: string
  columns?: ExportColumn<T>[]
  rows?: T[]
  /** Feuille déjà assemblée (plusieurs groupes sur la même feuille). */
  matrix?: string[][]
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

function logoMimeToType(url: string, contentType: string | null): WordLogo['type'] {
  const mime = (contentType || '').toLowerCase()
  const path = url.toLowerCase()
  if (mime.includes('png') || path.includes('.png')) return 'png'
  if (mime.includes('gif') || path.includes('.gif')) return 'gif'
  if (mime.includes('bmp') || path.includes('.bmp')) return 'bmp'
  return 'jpg'
}

/** Charge le logo clinique pour l’export Word (ignore les échecs). */
async function fetchClinicLogo(): Promise<WordLogo | null> {
  const raw = String(CLINIC.logo || '').trim()
  if (!raw) return null
  try {
    const href =
      raw.startsWith('http://') || raw.startsWith('https://') || raw.startsWith('data:')
        ? raw
        : new URL(raw, typeof window !== 'undefined' ? window.location.origin : 'http://localhost').href
    const res = await fetch(href)
    if (!res.ok) return null
    const data = new Uint8Array(await res.arrayBuffer())
    if (!data.length) return null
    return { data, type: logoMimeToType(href, res.headers.get('content-type')) }
  } catch {
    return null
  }
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

function excelMatrixColWidths(matrix: string[][]) {
  const colCount = matrix.reduce((max, row) => Math.max(max, row.length), 1)
  return Array.from({ length: colCount }, (_, index) => {
    const maxCell = matrix.reduce((max, row) => Math.max(max, String(row[index] ?? '').length), 0)
    return { wch: Math.min(48, Math.max(10, maxCell) + 2) }
  })
}

/** Télécharge un fichier PDF (A4). Totaux en fin de section ; `ownPage` = page dédiée. */
export function exportTablePdf<T>(
  title: string,
  columns: ExportColumn<T>[],
  rows: T[],
  options?: TableExportOptions,
): void {
  const captionRows = defaultReportCaptionRows(options?.captionRows, options?.generatedAt)
  void import('@/lib/table-export-pdf').then(({ saveReportPdfFile }) =>
    saveReportPdfFile(title, columns, rows, {
      captionRows,
      totalsRows: options?.totalsRows,
      sections: options?.sections,
      filename: options?.filename ?? exportBasename(title),
      orientation: options?.orientation,
      gridLines: options?.gridLines,
    }),
  )
}

/** Télécharge un fichier Excel (.xlsx). Les totaux sont ajoutés en bas de feuille, une seule fois. */
export function exportTableExcel<T>(
  title: string,
  columns: ExportColumn<T>[],
  rows: T[],
  options?: TableExportOptions,
): void {
  const matrix = options?.sections?.length
    ? sectionsToMatrix(options.sections, { totalsRows: options?.totalsRows })
    : rowsToMatrix(columns, rows, { totalsRows: options?.totalsRows })
  const sheet = XLSX.utils.aoa_to_sheet(matrix)
  sheet['!cols'] = options?.sections?.length ? excelMatrixColWidths(matrix) : excelColWidths(columns, rows)

  const workbook = XLSX.utils.book_new()
  const sheetName = (options?.sheetName ?? 'Export').slice(0, 31)
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName)
  XLSX.writeFile(workbook, `${options?.filename ?? exportBasename(title)}.xlsx`)
}

/** Plusieurs feuilles dans un seul classeur. Totaux en bas de chaque feuille si fournis. */
export function exportWorkbook(filename: string, sheets: WorkbookSheetDef[]): void {
  const workbook = XLSX.utils.book_new()
  const sheetNames = uniqueExcelSheetNames(sheets.map((sheet) => sheet.name))
  sheets.forEach((sheetDef, index) => {
    const matrix =
      sheetDef.matrix ??
      rowsToMatrix(sheetDef.columns ?? [], sheetDef.rows ?? [], { totalsRows: sheetDef.totalsRows })
    const sheet = XLSX.utils.aoa_to_sheet(matrix)
    sheet['!cols'] = sheetDef.columns?.length
      ? excelColWidths(sheetDef.columns, sheetDef.rows ?? [])
      : excelMatrixColWidths(matrix)
    XLSX.utils.book_append_sheet(workbook, sheet, sheetNames[index] || 'Feuille')
  })
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
  const logo = await fetchClinicLogo()
  const emptyLabel = translateUi('Aucune donnée')
  const sheets: WordSheetDef[] = options?.sections?.length
    ? options.sections.map((section, index) => {
        const previous = index > 0 ? options.sections![index - 1] : undefined
        return {
          name: section.title || options?.sheetName || title,
          columns: section.columns,
          rows: section.rows,
          captionRows: index === 0 ? captionRows : undefined,
          totalsRows:
            index === options.sections!.length - 1
              ? [...(section.totalsRows ?? []), ...(options?.totalsRows ?? [])]
              : section.totalsRows,
          emptyLabel,
          pageBreakBefore: Boolean(index > 0 && (section.ownPage || previous?.ownPage)),
        }
      })
    : [
        {
          name: options?.sheetName ?? title,
          columns,
          rows,
          captionRows,
          totalsRows: options?.totalsRows,
          emptyLabel,
        },
      ]
  const doc = buildWordDocument(title, sheets, {
    headerLines: clinicHeaderLines(),
    creator: CLINIC.shortName,
    logo,
  })
  const blob = await packWordBlob(doc)
  downloadBlob(blob, `${options?.filename ?? exportBasename(title)}.docx`)
}

/** Plusieurs sections (équivalent multi-feuilles Excel) dans un seul document Word. */
export async function exportWorkbookWord(filename: string, sheets: WorkbookSheetDef[]): Promise<void> {
  const logo = await fetchClinicLogo()
  const doc = buildWordDocument(
    filename.replace(/\.docx$/i, ''),
    sheets.map(
      (sheet): WordSheetDef => ({
        name: sheet.name,
        columns: sheet.columns ?? [],
        rows: sheet.rows ?? [],
        totalsRows: sheet.totalsRows,
        emptyLabel: translateUi('Aucune donnée'),
      }),
    ),
    { headerLines: clinicHeaderLines(), creator: CLINIC.shortName, logo },
  )
  const blob = await packWordBlob(doc)
  const base = filename.replace(/\.docx$/i, '').replace(/\.xlsx$/i, '')
  downloadBlob(blob, `${base}.docx`)
}
