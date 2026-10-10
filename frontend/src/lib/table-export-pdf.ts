import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { CLINIC, clinicTaxLine } from '@/lib/clinic'
import { translateUi } from '@/i18n/translate'
import {
  cellText,
  type ExportCaptionRow,
  type ExportCell,
  type ExportColumn,
  type ExportSection,
} from '@/lib/table-export-html'
import { stripBidiMarks } from '@/lib/format-fcfa'

/** Helvetica n'a pas de glyphes arabes : police dédiée, appliquée seulement aux textes arabes. */
const ARABIC_FONT = 'NotoNaskhArabic'
const ARABIC_FONT_FILES = {
  normal: '/fonts/NotoNaskhArabic-Regular.ttf',
  bold: '/fonts/NotoNaskhArabic-Bold.ttf',
} as const
const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/

let arabicFontData: Promise<Record<keyof typeof ARABIC_FONT_FILES, string> | null> | null = null

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

function loadArabicFontData() {
  arabicFontData ??= Promise.all(
    Object.values(ARABIC_FONT_FILES).map(async (url) => {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`font ${url}: ${res.status}`)
      return arrayBufferToBase64(await res.arrayBuffer())
    }),
  )
    .then(([normal, bold]) => ({ normal, bold }))
    .catch((error) => {
      console.warn('Police arabe PDF indisponible :', error)
      arabicFontData = null
      return null
    })
  return arabicFontData
}

async function registerArabicFont(doc: jsPDF): Promise<boolean> {
  const data = await loadArabicFontData()
  if (!data) return false
  for (const style of ['normal', 'bold'] as const) {
    const file = `${ARABIC_FONT}-${style}.ttf`
    doc.addFileToVFS(file, data[style])
    doc.addFont(file, ARABIC_FONT, style)
  }
  return true
}

let arabicFontReady = false

function hasArabic(text: string): boolean {
  return ARABIC_RE.test(text)
}

function fontFor(text: string): string {
  return arabicFontReady && hasArabic(text) ? ARABIC_FONT : 'helvetica'
}

function pdfText(value: string): string {
  return stripBidiMarks(value).replace(/[\u202f\u00a0]/g, ' ')
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

function head(columns: ExportColumn<any>[]): string[] {
  return ['#', ...columns.map((col) => col.header)]
}

function body<T>(columns: ExportColumn<T>[], rows: T[], compactLines = false): string[][] {
  if (!rows.length) return [[translateUi('Aucune donnée')]]
  return rows.map((row, index) => [
    String(index + 1),
    ...columns.map((col) => {
      const text = cellText(col.value(row))
      return compactLines ? text.replace(/\s*\n\s*/g, ' · ') : text
    }),
  ])
}

function drawCaptions(doc: jsPDF, captionRows: ExportCaptionRow[], y: number, density: PdfDensity): number {
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(density.caption)
  doc.setTextColor(51, 65, 85)
  let cursor = y
  for (const row of captionRows) {
    const label = `${pdfText(row.label)} : `
    const value = pdfText(row.value)
    doc.setFont(fontFor(label), 'bold')
    doc.text(label, 14, cursor)
    const labelWidth = doc.getTextWidth(label)
    doc.setFont(fontFor(value), 'normal')
    doc.text(value, 14 + labelWidth, cursor)
    cursor += density.captionStep
  }
  return cursor
}

type PdfLogo = { dataUrl: string; width: number; height: number }

const LOGO_MAX_MM = 26

type PdfDensity = {
  fontSize: number
  padding: number
  sectionTitle: number
  headerTitle: number
  clinicName: number
  caption: number
  captionStep: number
  sectionGap: number
  lineStep: number
  compactLines: boolean
  logoMm: number
}

const PDF_DENSITY: PdfDensity = {
  fontSize: 9.5,
  padding: 1.8,
  sectionTitle: 12.5,
  headerTitle: 14,
  clinicName: 16,
  caption: 10.5,
  captionStep: 5.8,
  sectionGap: 8,
  lineStep: 5,
  compactLines: false,
  logoMm: LOGO_MAX_MM,
}

/** Plus le cumul déborde, plus on resserre pour rester sur une page A4. */
const PDF_DENSITIES: PdfDensity[] = [
  PDF_DENSITY,
  { fontSize: 8, padding: 1.1, sectionTitle: 10.5, headerTitle: 12, clinicName: 13, caption: 8.5, captionStep: 4.2, sectionGap: 4, lineStep: 3.8, compactLines: true, logoMm: 18 },
  { fontSize: 7, padding: 0.7, sectionTitle: 9, headerTitle: 10.5, clinicName: 11, caption: 7.5, captionStep: 3.4, sectionGap: 2.5, lineStep: 3.2, compactLines: true, logoMm: 14 },
  { fontSize: 6.2, padding: 0.45, sectionTitle: 8, headerTitle: 9.5, clinicName: 10, caption: 7, captionStep: 3, sectionGap: 1.5, lineStep: 2.8, compactLines: true, logoMm: 12 },
]

/** Passe par un canvas pour obtenir un PNG quel que soit le format source (jpeg, webp…). */
async function loadClinicLogo(): Promise<PdfLogo | null> {
  const raw = String(CLINIC.logo || '').trim()
  if (!raw || typeof document === 'undefined') return null
  try {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.src = raw.startsWith('data:') ? raw : new URL(raw, window.location.origin).href
    await img.decode()
    if (!img.naturalWidth || !img.naturalHeight) return null
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(img, 0, 0)
    return { dataUrl: canvas.toDataURL('image/png'), width: img.naturalWidth, height: img.naturalHeight }
  } catch {
    return null
  }
}

function drawClinicHeader(doc: jsPDF, title: string, logo: PdfLogo | null, density: PdfDensity): number {
  const pageWidth = doc.internal.pageSize.getWidth()
  let logoBottom = 0
  if (logo) {
    const ratio = logo.width / logo.height
    const w = ratio >= 1 ? density.logoMm : density.logoMm * ratio
    const h = ratio >= 1 ? density.logoMm / ratio : density.logoMm
    doc.addImage(logo.dataUrl, 'PNG', 14, 8, w, h)
    logoBottom = 8 + h
  }
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(density.clinicName)
  doc.setTextColor(15, 118, 110)
  doc.text(CLINIC.nameFr, pageWidth / 2, 15, { align: 'center' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(Math.max(7, density.caption - 0.5))
  doc.setTextColor(51, 65, 85)
  let y = 22
  const lines = [
    CLINIC.fullAddress,
    CLINIC.phoneLabel,
    density.compactLines ? '' : CLINIC.email ? `${translateUi('Email :')} ${CLINIC.email}` : '',
    density.compactLines ? '' : clinicTaxLine(),
    density.compactLines ? '' : CLINIC.printFooter,
  ].filter(Boolean)
  for (const line of lines) {
    doc.text(line, pageWidth / 2, y, { align: 'center' })
    y += density.lineStep
  }
  y = Math.max(y + 2, logoBottom + 4)
  const cleanTitle = pdfText(title)
  doc.setFont(fontFor(cleanTitle), 'bold')
  doc.setFontSize(density.headerTitle)
  doc.setTextColor(15, 69, 74)
  doc.text(cleanTitle, pageWidth / 2, y, { align: 'center' })
  y += density.compactLines ? 5 : 9
  return y
}

function applyCellFont(
  data: {
    section?: string
    column?: { index: number }
    cell: {
      raw?: unknown
      text: string[]
      styles: { font?: string; fontSize?: number; valign?: string }
    }
  },
  columns?: ExportColumn<any>[],
) {
  const text = data.cell.text.join(' ')
  if (arabicFontReady && hasArabic(text)) data.cell.styles.font = ARABIC_FONT
  const column =
    data.section === 'body' ? columns?.[Math.max(0, (data.column?.index ?? 0) - 1)] : undefined
  const raw = typeof data.cell.raw === 'string' ? data.cell.raw : text
  if (column?.fontSize && (data.cell.text.length > 1 || raw.includes('\n'))) {
    data.cell.styles.fontSize = column.fontSize
    data.cell.styles.valign = 'top'
  }
}

function drawTable<T>(
  doc: jsPDF,
  columns: ExportColumn<T>[],
  rows: T[],
  startY: number,
  title?: string,
  totalsRows?: ExportCaptionRow[],
  gridLines = false,
  footRow?: ExportCell[],
  columnWidths?: number[],
  density: PdfDensity = PDF_DENSITY,
) {
  let y = startY
  if (title) {
    const cleanTitle = pdfText(title)
    doc.setFont(fontFor(cleanTitle), 'bold')
    doc.setFontSize(density.sectionTitle)
    doc.setTextColor(15, 69, 74)
    doc.text(cleanTitle, 14, y)
    y += density.compactLines ? 4.2 : 6
  }
  const tableBody = body(columns, rows, density.compactLines)
  if (footRow?.length && density.compactLines) {
    footRow = footRow.map((cell) => (typeof cell === 'string' ? cell.replace(/\s*\n\s*/g, ' · ') : cell))
  }
  autoTable(doc, {
    startY: y,
    head: [head(columns)],
    body: tableBody,
    ...(footRow?.length
      ? { foot: [['', ...footRow.map((cell) => pdfText(cellText(cell)))]], showFoot: 'lastPage' as const }
      : {}),
    theme: gridLines ? 'grid' : 'striped',
    styles: {
      font: 'helvetica',
      fontSize: density.fontSize,
      cellPadding: density.padding,
      overflow: 'linebreak',
      ...(gridLines ? { lineColor: [100, 116, 139], lineWidth: 0.2, textColor: [30, 41, 59] } : {}),
    },
    headStyles: { fillColor: [15, 118, 110], textColor: 255, fontStyle: 'bold' },
    footStyles: { fillColor: [226, 232, 240], textColor: [15, 23, 42], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    margin: { left: 14, right: 14, bottom: 16 },
    ...(columnWidths?.length
      ? {
          columnStyles: Object.fromEntries(columnWidths.map((cellWidth, index) => [index, { cellWidth }])),
        }
      : {}),
    didParseCell: (data) => applyCellFont(data, columns),
  })
  const tableY = lastTableY(doc, y)
  if (!totalsRows?.length) return tableY
  autoTable(doc, {
    startY: tableY + 4,
    body: totalsRows.map((row) => [pdfText(row.label), pdfText(row.value)]),
    theme: 'plain',
    styles: { font: 'helvetica', fontSize: density.caption, fontStyle: 'bold', cellPadding: density.padding },
    tableWidth: 130,
    columnStyles: { 0: { cellWidth: 72 }, 1: { cellWidth: 58, halign: 'right' } },
    margin: { left: 14, right: 14, bottom: 16 },
    didParseCell: applyCellFont,
  })
  return lastTableY(doc, tableY)
}

function lastTableY(doc: jsPDF, fallback: number): number {
  const ext = doc as jsPDF & { lastAutoTable?: { finalY?: number } }
  return ext.lastAutoTable?.finalY ?? fallback
}

function renderReportPdf(
  doc: jsPDF,
  title: string,
  columns: ExportColumn<any>[],
  rows: any[],
  options: {
    captionRows?: ExportCaptionRow[]
    footerLabel?: string
    totalsRows?: ExportCaptionRow[]
    sections?: ExportSection[]
    orientation?: 'portrait' | 'landscape'
    gridLines?: boolean
  } | undefined,
  logo: PdfLogo | null,
  density: PdfDensity,
): jsPDF {
  const pageHeight = doc.internal.pageSize.getHeight()
  const footerLabel = pdfText(options?.footerLabel ?? '')

  let y = drawClinicHeader(doc, title, logo, density)
  if (options?.captionRows?.length) {
    y = drawCaptions(doc, options.captionRows, y, density) + (density.compactLines ? 1.5 : 3)
  }

  const sections = options?.sections?.length
    ? options.sections
    : [{ title: '', columns, rows, totalsRows: options?.totalsRows }]

  sections.forEach((section, index) => {
    const previous = index > 0 ? sections[index - 1] : undefined
    if (index > 0 && (section.ownPage || previous?.ownPage)) {
      doc.addPage()
      y = 16
    } else if (index > 0 && y > pageHeight - (density.compactLines ? 24 : 40)) {
      doc.addPage()
      y = 16
    }
    y =
      drawTable(
        doc,
        section.columns,
        section.rows,
        y,
        section.title || undefined,
        section.totalsRows,
        options?.gridLines,
        section.footRow,
        section.columnWidths,
        density,
      ) + density.sectionGap
  })

  const total = doc.getNumberOfPages()
  for (let i = 1; i <= total; i++) {
    doc.setPage(i)
    doc.setFontSize(density.compactLines ? 7 : 8)
    doc.setTextColor(100, 116, 139)
    if (footerLabel) {
      doc.setFont(fontFor(footerLabel), 'normal')
      doc.text(footerLabel, 14, pageHeight - 8)
    }
    doc.setFont('helvetica', 'normal')
    doc.text(`${i} / ${total}`, doc.internal.pageSize.getWidth() - 14, pageHeight - 8, { align: 'right' })
  }
  return doc
}

export async function createReportPdf(
  title: string,
  columns: ExportColumn<any>[],
  rows: any[],
  options?: {
    captionRows?: ExportCaptionRow[]
    /** Date de génération, affichée en pied de page (les filtres restent en en-tête). */
    footerLabel?: string
    totalsRows?: ExportCaptionRow[]
    sections?: ExportSection[]
    orientation?: 'portrait' | 'landscape'
    gridLines?: boolean
    fitSinglePage?: boolean
  },
): Promise<jsPDF> {
  const logo = await loadClinicLogo()
  const densities = options?.fitSinglePage ? PDF_DENSITIES : [PDF_DENSITY]
  let doc!: jsPDF
  for (const density of densities) {
    doc = new jsPDF({ orientation: options?.orientation ?? 'portrait', unit: 'mm', format: 'a4' })
    arabicFontReady = await registerArabicFont(doc)
    renderReportPdf(doc, title, columns, rows, options, logo, density)
    if (!options?.fitSinglePage || doc.getNumberOfPages() <= 1) break
  }
  return doc
}

export async function saveReportPdfFile(
  title: string,
  columns: ExportColumn<any>[],
  rows: any[],
  options?: {
    captionRows?: ExportCaptionRow[]
    footerLabel?: string
    totalsRows?: ExportCaptionRow[]
    sections?: ExportSection[]
    filename?: string
    orientation?: 'portrait' | 'landscape'
    gridLines?: boolean
    fitSinglePage?: boolean
  },
): Promise<void> {
  const doc = await createReportPdf(title, columns, rows, options)
  const blob = doc.output('blob')
  downloadBlob(blob, `${options?.filename ?? 'export'}.pdf`)
}
