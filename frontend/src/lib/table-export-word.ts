import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from 'docx'
import { cellText, type ExportCaptionRow, type ExportColumn } from './table-export-html'

const BORDER = { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' }
const BORDERS = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER }
const PAGE_WIDTH_DXA = 11906 - 1440

export type WordSheetDef = {
  name: string
  columns: ExportColumn<any>[]
  rows: any[]
  captionRows?: ExportCaptionRow[]
  totalsRows?: ExportCaptionRow[]
  emptyLabel?: string
}

function textRun(text: string, opts?: { bold?: boolean; size?: number; color?: string; italics?: boolean }) {
  return new TextRun({
    text,
    bold: opts?.bold,
    italics: opts?.italics,
    size: opts?.size ?? 20,
    font: 'Calibri',
    color: opts?.color,
  })
}

function cellParagraph(text: string, opts?: { bold?: boolean; color?: string; align?: (typeof AlignmentType)[keyof typeof AlignmentType] }) {
  return new Paragraph({
    alignment: opts?.align ?? AlignmentType.LEFT,
    spacing: { after: 0, before: 0 },
    children: [textRun(text, { bold: opts?.bold, color: opts?.color, size: 18 })],
  })
}

function makeCell(
  text: string,
  options?: {
    bold?: boolean
    fill?: string
    color?: string
    widthPct?: number
    align?: (typeof AlignmentType)[keyof typeof AlignmentType]
  },
) {
  return new TableCell({
    borders: BORDERS,
    verticalAlign: VerticalAlign.CENTER,
    width: options?.widthPct
      ? { size: Math.round(options.widthPct * 50), type: WidthType.PERCENTAGE }
      : undefined,
    shading: options?.fill ? { type: ShadingType.CLEAR, fill: options.fill } : undefined,
    margins: { top: 40, bottom: 40, left: 80, right: 80 },
    children: [cellParagraph(text, { bold: options?.bold, color: options?.color, align: options?.align })],
  })
}

function dataTable<T>(columns: ExportColumn<T>[], rows: T[], emptyLabel: string): Table {
  const colCount = columns.length + 1
  const widthPct = 100 / colCount
  const header = new TableRow({
    tableHeader: true,
    cantSplit: true,
    children: [
      makeCell('#', { bold: true, fill: '0F766E', color: 'FFFFFF', widthPct }),
      ...columns.map((col) =>
        makeCell(col.header, { bold: true, fill: '0F766E', color: 'FFFFFF', widthPct }),
      ),
    ],
  })

  const body =
    rows.length === 0
      ? [
          new TableRow({
            cantSplit: true,
            children: [
              new TableCell({
                borders: BORDERS,
                columnSpan: colCount,
                children: [cellParagraph(emptyLabel, { align: AlignmentType.CENTER })],
              }),
            ],
          }),
        ]
      : rows.map((row, index) => {
          const fill = index % 2 === 1 ? 'F8FAFC' : 'FFFFFF'
          return new TableRow({
            cantSplit: true,
            children: [
              makeCell(String(index + 1), { fill, widthPct, align: AlignmentType.CENTER }),
              ...columns.map((col) => makeCell(cellText(col.value(row)), { fill, widthPct })),
            ],
          })
        })

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: Array.from({ length: colCount }, () => Math.round(PAGE_WIDTH_DXA / colCount)),
    rows: [header, ...body],
  })
}

function totalsTable(totalsRows: ExportCaptionRow[]): Table {
  const rows = totalsRows.map(
    (row, index) =>
      new TableRow({
        cantSplit: true,
        children: [
          makeCell(row.label, {
            bold: true,
            fill: index % 2 === 0 ? 'E2E8F0' : 'FFFFFF',
            widthPct: 70,
          }),
          makeCell(row.value, {
            bold: true,
            fill: index % 2 === 0 ? 'E2E8F0' : 'FFFFFF',
            widthPct: 30,
            align: AlignmentType.RIGHT,
          }),
        ],
      }),
  )
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: [Math.round(PAGE_WIDTH_DXA * 0.7), Math.round(PAGE_WIDTH_DXA * 0.3)],
    rows,
  })
}

function clinicHeaderParagraphs(title: string, headerLines: string[]): Paragraph[] {
  return [
    ...headerLines.filter(Boolean).map(
      (line, index) =>
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: index === 0 ? 40 : 20 },
          children: [textRun(line, { bold: index === 0, size: index === 0 ? 28 : 18 })],
        }),
    ),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 200, after: 200 },
      children: [textRun(title, { bold: true, size: 28, color: '0F766E' })],
    }),
  ]
}

function captionParagraphs(captionRows: ExportCaptionRow[] | undefined): Paragraph[] {
  if (!captionRows?.length) return []
  return captionRows.map(
    (row) =>
      new Paragraph({
        spacing: { after: 80 },
        children: [textRun(`${row.label} : `, { bold: true }), textRun(row.value)],
      }),
  )
}

export function buildWordDocument(
  title: string,
  sheets: WordSheetDef[],
  options?: { headerLines?: string[]; creator?: string },
): Document {
  const children: Array<Paragraph | Table> = [
    ...clinicHeaderParagraphs(title, options?.headerLines ?? []),
  ]

  sheets.forEach((sheet, index) => {
    if (sheets.length > 1) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          spacing: { before: index === 0 ? 80 : 280, after: 120 },
          children: [textRun(sheet.name, { bold: true, size: 24, color: '134E4A' })],
        }),
      )
    }
    children.push(...captionParagraphs(sheet.captionRows))
    children.push(new Paragraph({ spacing: { after: 80 }, children: [] }))
    children.push(dataTable(sheet.columns, sheet.rows, sheet.emptyLabel ?? 'Aucune donnée'))
    if (sheet.totalsRows?.length) {
      children.push(
        new Paragraph({
          spacing: { before: 200, after: 80 },
          children: [],
        }),
      )
      children.push(totalsTable(sheet.totalsRows))
    }
  })

  return new Document({
    creator: options?.creator || 'Alwatan',
    title,
    description: title,
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: { top: 720, right: 720, bottom: 720, left: 720 },
          },
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  textRun('Page ', { size: 16, color: '64748B' }),
                  new TextRun({ children: [PageNumber.CURRENT], size: 16, font: 'Calibri', color: '64748B' }),
                  textRun(' / ', { size: 16, color: '64748B' }),
                  new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, font: 'Calibri', color: '64748B' }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  })
}

export async function packWordBlob(doc: Document): Promise<Blob> {
  return Packer.toBlob(doc)
}
