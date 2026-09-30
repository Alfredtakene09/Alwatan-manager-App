import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { CLINIC, clinicTaxLine } from '@/lib/clinic'
import { translateUi } from '@/i18n/translate'
import {
  cellText,
  type ExportCaptionRow,
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

function body<T>(columns: ExportColumn<T>[], rows: T[]): string[][] {
  if (!rows.length) return [[translateUi('Aucune donnée')]]
  return rows.map((row, index) => [String(index + 1), ...columns.map((col) => cellText(col.value(row)))])
}

function drawCaptions(doc: jsPDF, captionRows: ExportCaptionRow[], y: number): number {
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10.5)
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
    cursor += 5.8
  }
  return cursor
}

type PdfLogo = { dataUrl: string; width: number; height: number }

const LOGO_MAX_MM = 26

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

function drawClinicHeader(doc: jsPDF, title: string, logo: PdfLogo | null): number {
  const pageWidth = doc.internal.pageSize.getWidth()
  let logoBottom = 0
  if (logo) {
    const ratio = logo.width / logo.height
    const w = ratio >= 1 ? LOGO_MAX_MM : LOGO_MAX_MM * ratio
    const h = ratio >= 1 ? LOGO_MAX_MM / ratio : LOGO_MAX_MM
    doc.addImage(logo.dataUrl, 'PNG', 14, 8, w, h)
    logoBottom = 8 + h
  }
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.setTextColor(15, 118, 110)
  doc.text(CLINIC.nameFr, pageWidth / 2, 15, { align: 'center' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10.5)
  doc.setTextColor(51, 65, 85)
  let y = 22
  const lines = [CLINIC.fullAddress, CLINIC.phoneLabel, CLINIC.email ? `${translateUi('Email :')} ${CLINIC.email}` : '', clinicTaxLine(), CLINIC.printFooter].filter(
    Boolean,
  )
  for (const line of lines) {
    doc.text(line, pageWidth / 2, y, { align: 'center' })
    y += 5
  }
  y = Math.max(y + 3, logoBottom + 6)
  const cleanTitle = pdfText(title)
  doc.setFont(fontFor(cleanTitle), 'bold')
  doc.setFontSize(14)
  doc.setTextColor(15, 69, 74)
  doc.text(cleanTitle, pageWidth / 2, y, { align: 'center' })
  y += 9
  return y
}

function applyCellFont(data: { cell: { text: string[]; styles: { font?: string } } }) {
  const text = data.cell.text.join(' ')
  if (arabicFontReady && hasArabic(text)) data.cell.styles.font = ARABIC_FONT
}

function drawTable<T>(
  doc: jsPDF,
  columns: ExportColumn<T>[],
  rows: T[],
  startY: number,
  title?: string,
  totalsRows?: ExportCaptionRow[],
  gridLines = false,
) {
  let y = startY
  if (title) {
    const cleanTitle = pdfText(title)
    doc.setFont(fontFor(cleanTitle), 'bold')
    doc.setFontSize(12.5)
    doc.setTextColor(15, 69, 74)
    doc.text(cleanTitle, 14, y)
    y += 6
  }
  autoTable(doc, {
    startY: y,
    head: [head(columns)],
    body: body(columns, rows),
    theme: gridLines ? 'grid' : 'striped',
    styles: {
      font: 'helvetica',
      fontSize: 9.5,
      cellPadding: 1.8,
      overflow: 'linebreak',
      ...(gridLines ? { lineColor: [100, 116, 139], lineWidth: 0.2, textColor: [30, 41, 59] } : {}),
    },
    headStyles: { fillColor: [15, 118, 110], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    margin: { left: 14, right: 14 },
    didParseCell: applyCellFont,
  })
  const tableY = lastTableY(doc, y)
  if (!totalsRows?.length) return tableY
  autoTable(doc, {
    startY: tableY + 4,
    body: totalsRows.map((row) => [pdfText(row.label), pdfText(row.value)]),
    theme: 'plain',
    styles: { font: 'helvetica', fontSize: 10.5, fontStyle: 'bold', cellPadding: 1.8 },
    columnStyles: { 0: { cellWidth: 120 }, 1: { halign: 'right' } },
    margin: { left: 14, right: 14 },
    didParseCell: applyCellFont,
  })
  return lastTableY(doc, tableY)
}

function lastTableY(doc: jsPDF, fallback: number): number {
  const ext = doc as jsPDF & { lastAutoTable?: { finalY?: number } }
  return ext.lastAutoTable?.finalY ?? fallback
}

export async function saveReportPdfFile(
  title: string,
  columns: ExportColumn<any>[],
  rows: any[],
  options?: {
    captionRows?: ExportCaptionRow[]
    totalsRows?: ExportCaptionRow[]
    sections?: ExportSection[]
    filename?: string
    orientation?: 'portrait' | 'landscape'
    gridLines?: boolean
  },
): Promise<void> {
  const doc = new jsPDF({ orientation: options?.orientation ?? 'portrait', unit: 'mm', format: 'a4' })
  const [fontReady, logo] = await Promise.all([registerArabicFont(doc), loadClinicLogo()])
  arabicFontReady = fontReady
  const pageHeight = doc.internal.pageSize.getHeight()
  const pageCount = () => doc.getNumberOfPages()
  const drawFooter = () => {
    const total = pageCount()
    for (let i = 1; i <= total; i++) {
      doc.setPage(i)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      doc.setTextColor(100, 116, 139)
      doc.text(`${i} / ${total}`, doc.internal.pageSize.getWidth() - 14, pageHeight - 8, { align: 'right' })
    }
  }

  let y = drawClinicHeader(doc, title, logo)
  if (options?.captionRows?.length) {
    y = drawCaptions(doc, options.captionRows, y) + 3
  }

  const sections = options?.sections?.length
    ? options.sections
    : [{ title: '', columns, rows, totalsRows: options?.totalsRows }]

  sections.forEach((section, index) => {
    const previous = index > 0 ? sections[index - 1] : undefined
    if (index > 0 && (section.ownPage || previous?.ownPage)) {
      doc.addPage()
      y = 16
    } else if (index > 0 && y > pageHeight - 40) {
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
      ) + 8
  })

  if (options?.totalsRows?.length && !options?.sections?.length) {
    /* already drawn with the single table */
  }

  drawFooter()
  const blob = doc.output('blob')
  downloadBlob(blob, `${options?.filename ?? 'export'}.pdf`)
}
