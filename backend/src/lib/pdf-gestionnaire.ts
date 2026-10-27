import PDFDocument from "pdfkit";
import fs from "node:fs";
import { CLINIC, clinicTaxLine, getClinicInfo } from "./clinic.js";
import { resolveClinicLogoAbsolutePath } from "./clinic-logo.js";
import { formatFcfa } from "./format-fcfa.js";

const ARABIC_FONT_PATH = process.env.PDF_ARABIC_FONT_PATH?.trim() || null;

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
