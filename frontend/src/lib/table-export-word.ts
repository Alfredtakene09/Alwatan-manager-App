import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  ImageRun,
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
import { stripBidiMarks } from './format-fcfa'

const BORDER = { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' }
const BORDERS = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER }
const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
const NO_BORDERS = { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER }
const PAGE_WIDTH_DXA = 11906 - 1440
const LOGO_WIDTH_PX = 110
const LOGO_HEIGHT_PX = 110
const LOGO_COL_DXA = 1800

export type WordLogo = {
  data: Uint8Array
  type: 'jpg' | 'png' | 'gif' | 'bmp'
}

export type WordSheetDef = {
  name: string
  columns: ExportColumn<any>[]
  rows: any[]
  captionRows?: ExportCaptionRow[]
  totalsRows?: ExportCaptionRow[]
  emptyLabel?: string
  pageBreakBefore?: boolean
}

function textRun(text: string, opts?: { bold?: boolean; size?: number; color?: string; italics?: boolean }) {
  return new TextRun({
    text: stripBidiMarks(text),
    bold: opts?.bold,
    italics: opts?.italics,
    size: opts?.size ?? 26,
    font: 'Calibri',
    color: opts?.color,
  })
}

function cellParagraph(text: string, opts?: { bold?: boolean; color?: string; align?: (typeof AlignmentType)[keyof typeof AlignmentType] }) {
  return new Paragraph({
    alignment: opts?.align ?? AlignmentType.LEFT,
    spacing: { after: 0, before: 0 },
    children: [textRun(text, { bold: opts?.bold, color: opts?.color, size: 24 })],
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
    margins: { top: 60, bottom: 60, left: 90, right: 90 },
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

function clinicInfoParagraphs(headerLines: string[]): Paragraph[] {
  const lines = headerLines.filter(Boolean)
  if (!lines.length) return [new Paragraph({ children: [] })]
  return lines.map(
    (line, index) =>
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: index === 0 ? 60 : 40 },
        children: [
          textRun(line, {
            bold: index === 0,
            size: index === 0 ? 48 : index === 1 ? 34 : 28,
            color: index === 0 ? '0F172A' : '334155',
          }),
        ],
      }),
  )
}

function clinicHeaderBlocks(
  title: string,
  headerLines: string[],
  logo?: WordLogo | null,
): Array<Paragraph | Table> {
  const infoParas = clinicInfoParagraphs(headerLines)

  const header: Paragraph | Table = logo
    ? new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        columnWidths: [LOGO_COL_DXA, PAGE_WIDTH_DXA - LOGO_COL_DXA],
        rows: [
          new TableRow({
            cantSplit: true,
            children: [
              new TableCell({
                borders: NO_BORDERS,
                width: { size: LOGO_COL_DXA, type: WidthType.DXA },
                verticalAlign: VerticalAlign.CENTER,
                children: [
                  new Paragraph({
                    alignment: AlignmentType.LEFT,
                    children: [
                      new ImageRun({
                        type: logo.type,
                        data: logo.data,
                        transformation: { width: LOGO_WIDTH_PX, height: LOGO_HEIGHT_PX },
                        altText: { name: 'Logo', description: 'Logo clinique', title: 'Logo' },
                      }),
                    ],
                  }),
                ],
              }),
              new TableCell({
                borders: NO_BORDERS,
                width: { size: PAGE_WIDTH_DXA - LOGO_COL_DXA, type: WidthType.DXA },
                verticalAlign: VerticalAlign.CENTER,
                children: infoParas,
              }),
            ],
          }),
        ],
      })
    : new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        columnWidths: [PAGE_WIDTH_DXA],
        rows: [
          new TableRow({
            cantSplit: true,
            children: [
              new TableCell({
                borders: NO_BORDERS,
                width: { size: PAGE_WIDTH_DXA, type: WidthType.DXA },
                children: infoParas,
              }),
            ],
          }),
        ],
      })

  return [
    header,
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 280, after: 240 },
      children: [textRun(title, { bold: true, size: 48, color: '0F766E' })],
    }),
  ]
}

function captionParagraphs(captionRows: ExportCaptionRow[] | undefined): Paragraph[] {
  if (!captionRows?.length) return []
  return captionRows.map(
    (row) =>
      new Paragraph({
        spacing: { after: 100 },
        children: [
          textRun(`${row.label} : `, { bold: true, size: 26 }),
          textRun(row.value, { size: 26 }),
        ],
      }),
  )
}

export function buildWordDocument(
  title: string,
  sheets: WordSheetDef[],
  options?: { headerLines?: string[]; creator?: string; logo?: WordLogo | null },
): Document {
  const children: Array<Paragraph | Table> = [
    ...clinicHeaderBlocks(title, options?.headerLines ?? [], options?.logo),
  ]

  sheets.forEach((sheet, index) => {
    if (sheets.length > 1) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          pageBreakBefore: Boolean(sheet.pageBreakBefore && index > 0),
          spacing: { before: index === 0 ? 80 : 280, after: 120 },
          children: [textRun(sheet.name, { bold: true, size: 32, color: '134E4A' })],
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
                  textRun('Page ', { size: 20, color: '64748B' }),
                  new TextRun({ children: [PageNumber.CURRENT], size: 20, font: 'Calibri', color: '64748B' }),
                  textRun(' / ', { size: 20, color: '64748B' }),
                  new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 20, font: 'Calibri', color: '64748B' }),
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
