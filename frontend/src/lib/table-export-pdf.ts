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
  doc.setFontSize(9)
  doc.setTextColor(51, 65, 85)
  let cursor = y
  for (const row of captionRows) {
    doc.setFont('helvetica', 'bold')
    doc.text(`${row.label} : `, 14, cursor)
    const labelWidth = doc.getTextWidth(`${row.label} : `)
    doc.setFont('helvetica', 'normal')
    doc.text(row.value, 14 + labelWidth, cursor)
    cursor += 5
  }
  return cursor
}

function drawClinicHeader(doc: jsPDF, title: string): number {
  const pageWidth = doc.internal.pageSize.getWidth()
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.setTextColor(15, 118, 110)
  doc.text(CLINIC.nameFr, pageWidth / 2, 14, { align: 'center' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(51, 65, 85)
  let y = 20
  const lines = [CLINIC.fullAddress, CLINIC.phoneLabel, CLINIC.email ? `${translateUi('Email :')} ${CLINIC.email}` : '', clinicTaxLine(), CLINIC.printFooter].filter(
    Boolean,
  )
  for (const line of lines) {
    doc.text(line, pageWidth / 2, y, { align: 'center' })
    y += 4.2
  }
  y += 2
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.setTextColor(15, 69, 74)
  doc.text(title, pageWidth / 2, y, { align: 'center' })
  y += 8
  return y
}

function drawTable<T>(
  doc: jsPDF,
  columns: ExportColumn<T>[],
  rows: T[],
  startY: number,
  title?: string,
  totalsRows?: ExportCaptionRow[],
) {
  let y = startY
  if (title) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.setTextColor(15, 69, 74)
    doc.text(title, 14, y)
    y += 5
  }
  autoTable(doc, {
    startY: y,
    head: [head(columns)],
    body: body(columns, rows),
    styles: { font: 'helvetica', fontSize: 8, cellPadding: 1.4, overflow: 'linebreak' },
    headStyles: { fillColor: [15, 118, 110], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    margin: { left: 14, right: 14 },
  })
  const tableY = lastTableY(doc, y)
  if (!totalsRows?.length) return tableY
  autoTable(doc, {
    startY: tableY + 4,
    body: totalsRows.map((row) => [row.label, row.value]),
    theme: 'plain',
    styles: { font: 'helvetica', fontSize: 9, fontStyle: 'bold', cellPadding: 1.6 },
    columnStyles: { 0: { cellWidth: 120 }, 1: { halign: 'right' } },
    margin: { left: 14, right: 14 },
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
  },
): Promise<void> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
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

  let y = drawClinicHeader(doc, title)
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
    y = drawTable(doc, section.columns, section.rows, y, section.title || undefined, section.totalsRows) + 8
  })

  if (options?.totalsRows?.length && !options?.sections?.length) {
    /* already drawn with the single table */
  }

  drawFooter()
  const blob = doc.output('blob')
  downloadBlob(blob, `${options?.filename ?? 'export'}.pdf`)
}
