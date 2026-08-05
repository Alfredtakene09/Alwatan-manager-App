import PDFDocument from "pdfkit";
import fs from "node:fs";
import { CLINIC, clinicTaxLine, getClinicInfo } from "./clinic.js";
import { resolveClinicLogoAbsolutePath } from "./clinic-logo.js";
import type { JournalDaySummary, JournalMonthDailySummary } from "./gestionnaire-journal.js";

const ARABIC_FONT_PATH = process.env.PDF_ARABIC_FONT_PATH?.trim() || null;
const PAGE_LEFT = 36;
const PAGE_RIGHT = 806;
const PAGE_BOTTOM = 552;

function clinicLogoPath() {
  return resolveClinicLogoAbsolutePath(CLINIC.logo);
}

function drawArabicClinicName(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  width: number,
  align: "left" | "center" | "right" = "center",
): boolean {
  if (!ARABIC_FONT_PATH || !fs.existsSync(ARABIC_FONT_PATH)) return false;
  try {
    doc.font(ARABIC_FONT_PATH).fontSize(10).fillColor("#475569").text(CLINIC.nameAr, x, y, {
      width,
      align,
    });
    doc.font("Helvetica");
    return true;
  } catch {
    doc.font("Helvetica");
    return false;
  }
}

function collectPdf(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

function drawHeader(doc: PDFKit.PDFDocument, title: string) {
  const leftX = 50;
  const contentWidth = doc.page.width - leftX * 2;
  doc
    .fillColor("#b45309")
    .fontSize(16)
    .font("Helvetica-Bold")
    .text(CLINIC.nameFr, leftX, 45, { width: contentWidth, align: "center" });
  doc
    .fillColor("#334155")
    .fontSize(11)
    .font("Helvetica")
    .text(CLINIC.fullAddress, leftX, doc.y + 4, { width: contentWidth, align: "center" });
  doc
    .fillColor("#0f172a")
    .fontSize(13)
    .font("Helvetica-Bold")
    .text(title, leftX, doc.y + 12, { width: contentWidth, align: "center" });
  doc.moveDown();
}

function drawJournalLetterhead(
  doc: PDFKit.PDFDocument,
  docTitle: string,
  periodLabel?: string,
  filtersLabel?: string,
) {
  const contentWidth = PAGE_RIGHT - PAGE_LEFT;
  let headerBottom = 42;

  const logoPath = clinicLogoPath();
  if (logoPath && fs.existsSync(logoPath)) {
    doc.image(logoPath, PAGE_LEFT, 36, { width: 56 });
    headerBottom = 102;
  }

  doc
    .fillColor("#0f766e")
    .fontSize(15)
    .font("Helvetica-Bold")
    .text(CLINIC.nameFr, PAGE_LEFT, 40, { width: contentWidth, align: "center" });
  doc
    .fillColor("#475569")
    .fontSize(10)
    .font("Helvetica");
  const arabicDrawn = drawArabicClinicName(doc, PAGE_LEFT, doc.y + 2, contentWidth, "center");
  doc.font("Helvetica").fillColor("#475569").fontSize(10);
  doc.text(CLINIC.fullAddress, PAGE_LEFT, doc.y + (arabicDrawn ? 3 : 2), {
    width: contentWidth,
    align: "center",
  });
  doc.text(`${CLINIC.phoneLabel} · ${CLINIC.email}`, PAGE_LEFT, doc.y + 2, {
    width: contentWidth,
    align: "center",
  });
  const taxLine = clinicTaxLine();
  if (taxLine) {
    doc.text(taxLine, PAGE_LEFT, doc.y + 2, { width: contentWidth, align: "center" });
  }

  doc
    .fillColor("#78350f")
    .fontSize(12)
    .font("Helvetica-Bold")
    .text(docTitle.toUpperCase(), PAGE_LEFT, doc.y + 8, { width: contentWidth, align: "center" });

  if (periodLabel) {
    doc
      .fillColor("#334155")
      .fontSize(10)
      .font("Helvetica")
      .text(`Période : ${periodLabel}`, PAGE_LEFT, doc.y + 4, {
        width: contentWidth,
        align: "center",
      });
  }

  if (filtersLabel) {
    doc
      .fillColor("#64748b")
      .fontSize(9)
      .font("Helvetica-Oblique")
      .text(`Filtres : ${filtersLabel}`, PAGE_LEFT, doc.y + 2, {
        width: contentWidth,
        align: "center",
      });
  }

  doc.y = Math.max(doc.y + 8, headerBottom);
  doc
    .strokeColor("#fde68a")
    .lineWidth(2)
    .moveTo(PAGE_LEFT, doc.y)
    .lineTo(PAGE_RIGHT, doc.y)
    .stroke();
  doc.moveDown(0.8);
}

import { formatFcfa, formatFcfaDigits } from "./format-fcfa.js";

function drawJournalKpiStrip(
  doc: PDFKit.PDFDocument,
  totals: { inflowsFcfa: number; outflowsFcfa: number; balanceFcfa: number },
) {
  const cards = [
    { label: "Total entrées", value: totals.inflowsFcfa, fill: "#ecfdf5", stroke: "#86efac", text: "#166534" },
    { label: "Total sorties", value: totals.outflowsFcfa, fill: "#fff1f2", stroke: "#fda4af", text: "#9f1239" },
    {
      label: "Solde période",
      value: totals.balanceFcfa,
      fill: totals.balanceFcfa >= 0 ? "#eff6ff" : "#fff1f2",
      stroke: totals.balanceFcfa >= 0 ? "#93c5fd" : "#fda4af",
      text: totals.balanceFcfa >= 0 ? "#1d4ed8" : "#9f1239",
    },
  ];

  const gap = 12;
  const cardWidth = (PAGE_RIGHT - PAGE_LEFT - gap * 2) / 3;
  const y = doc.y;
  const height = 42;

  cards.forEach((card, index) => {
    const x = PAGE_LEFT + index * (cardWidth + gap);
    doc.save();
    doc.roundedRect(x, y, cardWidth, height, 6).fillAndStroke(card.fill, card.stroke);
    doc.restore();
    doc
      .fillColor("#64748b")
      .fontSize(7)
      .font("Helvetica-Bold")
      .text(card.label.toUpperCase(), x + 10, y + 8, { width: cardWidth - 20 });
    doc
      .fillColor(card.text)
      .fontSize(11)
      .font("Helvetica-Bold")
      .text(formatFcfa(card.value), x + 10, y + 20, { width: cardWidth - 20 });
  });

  doc.y = y + height + 14;
}

const JOURNAL_TABLE_COLS = {
  day: 82,
  libelle: 300,
  in: 108,
  out: 108,
  net: 108,
};

function journalTableWidth() {
  const cols = JOURNAL_TABLE_COLS;
  return cols.day + cols.libelle + cols.in + cols.out + cols.net;
}

function journalColX(index: number) {
  const widths = [
    JOURNAL_TABLE_COLS.day,
    JOURNAL_TABLE_COLS.libelle,
    JOURNAL_TABLE_COLS.in,
    JOURNAL_TABLE_COLS.out,
    JOURNAL_TABLE_COLS.net,
  ];
  return PAGE_LEFT + widths.slice(0, index).reduce((sum, width) => sum + width, 0);
}

function ensureJournalPageSpace(doc: PDFKit.PDFDocument, minY: number) {
  if (doc.y > minY) {
    doc.addPage({ size: "A4", layout: "landscape", margin: 36 });
    doc.y = 48;
  }
}

function drawJournalTableHead(doc: PDFKit.PDFDocument, monthLabel: string, monthTotals?: {
  inflowsFcfa: number;
  outflowsFcfa: number;
  balanceFcfa: number;
}) {
  ensureJournalPageSpace(doc, 500);

  doc
    .fillColor("#78350f")
    .fontSize(10)
    .font("Helvetica-Bold")
    .text(monthLabel, PAGE_LEFT, doc.y + 2);

  if (monthTotals) {
    doc
      .fillColor("#92400e")
      .fontSize(8)
      .font("Helvetica")
      .text(
        `Entrées ${formatFcfa(monthTotals.inflowsFcfa)} · Sorties ${formatFcfa(monthTotals.outflowsFcfa)} · Solde ${formatFcfa(monthTotals.balanceFcfa)}`,
        PAGE_LEFT + 180,
        doc.y - 10,
        { width: 520, align: "right" },
      );
  }

  doc.y += 14;

  const y = doc.y;
  const tableWidth = journalTableWidth();
  doc.save();
  doc.roundedRect(PAGE_LEFT, y, tableWidth, 18, 4).fill("#fffbeb");
  doc.restore();

  const headers = ["Jour", "Libellé", "Entrées", "Sorties", "Solde jour"];
  headers.forEach((header, index) => {
    doc
      .fillColor("#92400e")
      .fontSize(7.5)
      .font("Helvetica-Bold")
      .text(header, journalColX(index) + 6, y + 5, {
        width: (index === 0 ? JOURNAL_TABLE_COLS.day : index === 1 ? JOURNAL_TABLE_COLS.libelle : 108) - 12,
        align: index >= 2 ? "right" : "left",
      });
  });

  doc.y = y + 20;
}

function dayLibelleLines(day: JournalDaySummary): string[] {
  if (!day.lines.length) return ["Aucun mouvement"];
  return day.lines.map((line) => {
    if (line.variant === "item" && line.amountFcfa > 0) {
      return `  — ${line.label} (${formatFcfa(line.amountFcfa)})`;
    }
    return line.label;
  });
}

function drawJournalDayRow(doc: PDFKit.PDFDocument, day: JournalDaySummary, rowIndex: number) {
  const libelleLines = dayLibelleLines(day);
  const rowHeight = Math.max(22, 12 + libelleLines.length * 10);
  ensureJournalPageSpace(doc, PAGE_BOTTOM - rowHeight - 20);

  const y = doc.y;
  const tableWidth = journalTableWidth();

  if (rowIndex % 2 === 0) {
    doc.save();
    doc.rect(PAGE_LEFT, y, tableWidth, rowHeight).fill("#fafafa");
    doc.restore();
  }

  doc
    .strokeColor("#e2e8f0")
    .lineWidth(0.5)
    .moveTo(PAGE_LEFT, y + rowHeight)
    .lineTo(PAGE_LEFT + tableWidth, y + rowHeight)
    .stroke();

  doc
    .fillColor("#0f172a")
    .fontSize(8)
    .font("Helvetica-Bold")
    .text(day.label, journalColX(0) + 6, y + 6, { width: JOURNAL_TABLE_COLS.day - 12 });

  doc
    .font("Helvetica")
    .fontSize(7.5)
    .fillColor("#334155")
    .text(libelleLines.join("\n"), journalColX(1) + 6, y + 5, {
      width: JOURNAL_TABLE_COLS.libelle - 12,
      lineGap: 1,
    });

  const amounts = [
    day.inflowsFcfa ? formatFcfa(day.inflowsFcfa) : "—",
    day.outflowsFcfa ? formatFcfa(day.outflowsFcfa) : "—",
    day.inflowsFcfa || day.outflowsFcfa ? formatFcfa(day.balanceFcfa) : "—",
  ];
  const amountColors = ["#166534", "#9f1239", day.balanceFcfa >= 0 ? "#1d4ed8" : "#9f1239"];

  amounts.forEach((value, index) => {
    doc
      .fillColor(amountColors[index])
      .fontSize(8)
      .font(index === 2 ? "Helvetica-Bold" : "Helvetica")
      .text(value, journalColX(index + 2) + 6, y + 6, {
        width: 96,
        align: "right",
      });
  });

  doc.y = y + rowHeight + 1;
}

function drawJournalMonthFooter(doc: PDFKit.PDFDocument, month: JournalMonthDailySummary) {
  ensureJournalPageSpace(doc, PAGE_BOTTOM - 24);
  const y = doc.y + 4;
  const tableWidth = journalTableWidth();

  doc.save();
  doc.rect(PAGE_LEFT, y, tableWidth, 18).fill("#f8fafc");
  doc.restore();

  doc
    .fillColor("#0f172a")
    .fontSize(8)
    .font("Helvetica-Bold")
    .text(`Total ${month.monthLabel}`, journalColX(0) + 6, y + 5, { width: JOURNAL_TABLE_COLS.day + JOURNAL_TABLE_COLS.libelle - 12 });

  const footerAmounts = [
    formatFcfa(month.inflowsFcfa),
    formatFcfa(month.outflowsFcfa),
    formatFcfa(month.balanceFcfa),
  ];
  footerAmounts.forEach((value, index) => {
    doc.text(value, journalColX(index + 2) + 6, y + 5, { width: 96, align: "right" });
  });

  doc.y = y + 26;
}

function drawJournalDocumentFooter(doc: PDFKit.PDFDocument) {
  ensureJournalPageSpace(doc, PAGE_BOTTOM - 40);
  doc
    .strokeColor("#cbd5e1")
    .moveTo(PAGE_LEFT, doc.y)
    .lineTo(PAGE_RIGHT, doc.y)
    .stroke();
  doc
    .fillColor("#64748b")
    .fontSize(7.5)
    .font("Helvetica")
    .text(
      `${CLINIC.nameFr} — Livre journal · Document généré le ${new Date().toLocaleString("fr-FR")}`,
      PAGE_LEFT,
      doc.y + 8,
      { width: PAGE_RIGHT - PAGE_LEFT, align: "center" },
    );
}

export async function generatePayslipPdf(params: {
  employeeName: string;
  jobTitle: string | null;
  year: number;
  month: number;
  grossFcfa: number;
  advanceDeductionFcfa?: number;
  netFcfa: number;
  gestionnaireName: string;
}) {
  await getClinicInfo();
  const doc = new PDFDocument({ margin: 50, size: "A4" });
  const monthLabel = new Date(params.year, params.month - 1, 1).toLocaleDateString("fr-FR", {
    month: "long",
    year: "numeric",
  });
  const pageWidth = doc.page.width;
  const contentWidth = pageWidth - 100;
  const leftX = 50;
  const rightX = leftX + contentWidth;
  const logoPath = clinicLogoPath();
  const hasLogo = Boolean(logoPath && fs.existsSync(logoPath));

  // En-tête clinique (logo à gauche, infos centrées)
  const headerH = 98;
  doc.save();
  doc.roundedRect(leftX, 36, contentWidth, headerH, 10).fill("#fffdf8");
  doc.restore();
  doc
    .strokeColor("#fde68a")
    .lineWidth(1)
    .roundedRect(leftX, 36, contentWidth, headerH, 10)
    .stroke();

  if (hasLogo && logoPath) {
    doc.image(logoPath, leftX + 12, 52, { width: 54 });
  }
  const centerTextWidth = contentWidth - 160;
  doc
    .fillColor("#0f766e")
    .fontSize(14)
    .font("Helvetica-Bold")
    .text(CLINIC.nameFr, leftX, 48, { width: centerTextWidth, align: "center" });
  doc
    .fillColor("#475569")
    .fontSize(10)
    .font("Helvetica");
  const payslipArabicDrawn = drawArabicClinicName(
    doc,
    leftX,
    doc.y + 1,
    centerTextWidth,
    "center",
  );
  doc.font("Helvetica").fillColor("#475569").fontSize(10);
  doc.text(CLINIC.fullAddress, leftX, doc.y + (payslipArabicDrawn ? 2 : 1), {
    width: centerTextWidth,
    align: "center",
  });
  doc.text(`${CLINIC.phoneLabel} · ${CLINIC.email}`, leftX, doc.y + 1, {
    width: centerTextWidth,
    align: "center",
  });
  {
    const taxLine = clinicTaxLine();
    if (taxLine) {
      doc.text(taxLine, leftX, doc.y + 1, { width: centerTextWidth, align: "center" });
    }
  }

  doc
    .fillColor("#78350f")
    .fontSize(11)
    .font("Helvetica-Bold")
    .text("FICHE DE PAIE", rightX - 160, 50, { width: 145, align: "right" });
  doc
    .fillColor("#64748b")
    .fontSize(9)
    .font("Helvetica")
    .text(`Période : ${monthLabel}`, rightX - 160, 68, { width: 145, align: "right" });
  doc
    .fillColor("#94a3b8")
    .fontSize(8)
    .font("Helvetica")
    .text(`Date : ${new Date().toLocaleDateString("fr-FR")}`, rightX - 160, 82, {
      width: 145,
      align: "right",
    });

  // Bloc employé
  const employeeBoxY = 150;
  const employeeBoxH = 78;
  doc.save();
  doc.roundedRect(leftX, employeeBoxY, contentWidth, employeeBoxH, 8).fillAndStroke("#f8fafc", "#e2e8f0");
  doc.restore();

  doc.fillColor("#475569").fontSize(8).font("Helvetica-Bold").text("INFORMATIONS EMPLOYE", leftX + 12, employeeBoxY + 9);
  doc.fillColor("#0f172a").fontSize(10).font("Helvetica");
  doc.text(`Nom complet : ${params.employeeName}`, leftX + 12, employeeBoxY + 28, { width: contentWidth - 24 });
  doc.text(`Poste : ${params.jobTitle ?? "—"}`, leftX + 12, employeeBoxY + 46, { width: contentWidth - 24 });

  // Tableau des montants
  const tableX = leftX;
  const tableY = employeeBoxY + employeeBoxH + 22;
  const col1 = Math.round(contentWidth * 0.62);
  const col2 = contentWidth - col1;
  const rowH = 30;
  const hasAdvance = Boolean(params.advanceDeductionFcfa && params.advanceDeductionFcfa > 0);
  const rows = [
    { label: "Salaire brut", value: formatFcfa(params.grossFcfa), strong: false },
    ...(hasAdvance
      ? [
          {
            label: "Avances deduites",
            value: `-${formatFcfa(params.advanceDeductionFcfa ?? 0)}`,
            strong: false,
          },
        ]
      : []),
    { label: "Net a payer", value: formatFcfa(params.netFcfa), strong: true },
  ];

  doc.fillColor("#92400e").fontSize(8).font("Helvetica-Bold").text("DETAIL PAIE", tableX, tableY - 14);

  rows.forEach((row, index) => {
    const y = tableY + index * rowH;
    const isEven = index % 2 === 0;
    doc.save();
    doc
      .rect(tableX, y, contentWidth, rowH)
      .fill(isEven ? "#ffffff" : "#f8fafc")
      .stroke("#e2e8f0");
    doc.restore();

    doc
      .fillColor(row.strong ? "#0f172a" : "#334155")
      .fontSize(9)
      .font(row.strong ? "Helvetica-Bold" : "Helvetica")
      .text(row.label, tableX + 10, y + 10, { width: col1 - 16 });

    doc
      .fillColor(row.strong ? "#166534" : "#0f172a")
      .fontSize(9.5)
      .font(row.strong ? "Helvetica-Bold" : "Helvetica")
      .text(row.value, tableX + col1, y + 10, { width: col2 - 10, align: "right" });
  });

  const tableBottom = tableY + rows.length * rowH;
  doc
    .strokeColor("#e2e8f0")
    .moveTo(tableX + col1, tableY)
    .lineTo(tableX + col1, tableBottom)
    .stroke();

  // Signature / validation
  const signY = tableBottom + 30;
  doc
    .fillColor("#334155")
    .fontSize(9)
    .font("Helvetica")
    .text(`Valide par : ${params.gestionnaireName}`, leftX, signY);
  doc
    .text(`Date d'edition : ${new Date().toLocaleDateString("fr-FR")}`, leftX, signY + 14);
  doc
    .fillColor("#94a3b8")
    .fontSize(7.5)
    .font("Helvetica-Oblique")
    .text(
      "Document interne clinique - a conserver avec les pieces de paie.",
      leftX,
      signY + 34,
      { width: contentWidth },
    );

  return collectPdf(doc);
}

export async function generateJournalPdf(
  title: string,
  entries: Array<{
    sequence: number;
    occurredAt: string;
    label: string;
    categoryLabel: string;
    inflowFcfa: number;
    outflowFcfa: number;
    runningBalanceFcfa: number;
    reference: string;
  }>,
  totals: { inflowsFcfa: number; outflowsFcfa: number; balanceFcfa: number },
) {
  await getClinicInfo();
  const doc = new PDFDocument({ margin: 40, size: "A4", layout: "landscape" });
  drawHeader(doc, title);

  doc.fontSize(8).font("Helvetica-Bold");
  const cols = [30, 110, 250, 90, 70, 70, 70, 80];
  const headers = ["N°", "Date", "Libellé", "Catégorie", "Entrée", "Sortie", "Solde", "Réf."];
  let y = doc.y;
  headers.forEach((header, i) => {
    const x = 40 + cols.slice(0, i).reduce((s, w) => s + w, 0);
    doc.text(header, x, y, { width: cols[i] });
  });
  y += 14;
  doc.font("Helvetica");

  for (const row of entries.slice(0, 80)) {
    if (y > 520) {
      doc.addPage();
      y = 50;
    }
    const values = [
      String(row.sequence),
      new Date(row.occurredAt).toLocaleString("fr-FR"),
      row.label.slice(0, 40),
      row.categoryLabel,
      row.inflowFcfa ? formatFcfaDigits(row.inflowFcfa) : "",
      row.outflowFcfa ? formatFcfaDigits(row.outflowFcfa) : "",
      formatFcfaDigits(row.runningBalanceFcfa),
      row.reference,
    ];
    values.forEach((value, i) => {
      const x = 40 + cols.slice(0, i).reduce((s, w) => s + w, 0);
      doc.text(value, x, y, { width: cols[i] });
    });
    y += 12;
  }

  doc.moveDown();
  doc.font("Helvetica-Bold").text(
    `Totaux — Entrées : ${formatFcfa(totals.inflowsFcfa)} | Sorties : ${formatFcfa(totals.outflowsFcfa)} | Solde : ${formatFcfa(totals.balanceFcfa)}`,
  );

  return collectPdf(doc);
}

export async function generateJournalDailyPdf(
  title: string,
  dailyByMonth: JournalMonthDailySummary[],
  totals: { inflowsFcfa: number; outflowsFcfa: number; balanceFcfa: number },
  options?: { periodLabel?: string; filtersLabel?: string },
) {
  await getClinicInfo();
  const doc = new PDFDocument({ margin: 36, size: "A4", layout: "landscape" });

  drawJournalLetterhead(doc, title, options?.periodLabel, options?.filtersLabel);
  drawJournalKpiStrip(doc, totals);

  if (!dailyByMonth.length) {
    doc
      .fillColor("#64748b")
      .fontSize(10)
      .font("Helvetica")
      .text("Aucun mouvement sur la période sélectionnée.", PAGE_LEFT, doc.y);
  }

  for (const month of dailyByMonth) {
    drawJournalTableHead(doc, month.monthLabel, {
      inflowsFcfa: month.inflowsFcfa,
      outflowsFcfa: month.outflowsFcfa,
      balanceFcfa: month.balanceFcfa,
    });

    month.days.forEach((day, index) => {
      drawJournalDayRow(doc, day, index);
    });

    drawJournalMonthFooter(doc, month);
    doc.moveDown(0.4);
  }

  drawJournalDocumentFooter(doc);

  return collectPdf(doc);
}
