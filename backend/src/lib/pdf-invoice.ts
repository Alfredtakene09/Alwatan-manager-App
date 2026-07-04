import PDFDocument from "pdfkit";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Invoice, Patient, User } from "@prisma/client";
import { CLINIC } from "./clinic.js";
import { formatPatientAge } from "./patient-age.js";

type InvoiceWithRelations = Invoice & {
  patient: Patient | null;
  externalClient?: {
    code: string;
    firstName: string;
    lastName: string;
    phone?: string | null;
  } | null;
  issuedBy: Pick<User, "firstName" | "lastName">;
};

const TYPE_LABELS: Record<string, string> = {
  SURGERY: "Chirurgie",
  HOSPITALIZATION_DEPOSIT: "Caution hospitalisation",
  HOSPITALIZATION_FINAL: "Régularisation hospitalisation",
  PHARMACY: "Pharmacie",
  CONSULTATION: "Consultation",
  LAB_EXAM: "Examens laboratoire",
};

const LOGO_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "../assets/logo-alwatan.jpeg");
const ARABIC_FONT_PATH = process.env.PDF_ARABIC_FONT_PATH?.trim() || null;

function drawArabicClinicName(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  width: number,
): boolean {
  if (!ARABIC_FONT_PATH || !fs.existsSync(ARABIC_FONT_PATH)) return false;
  try {
    doc.font(ARABIC_FONT_PATH).fontSize(9).fillColor("#334155").text(CLINIC.nameAr, x, y, {
      width,
      align: "right",
    });
    doc.font("Helvetica");
    return true;
  } catch {
    doc.font("Helvetica");
    return false;
  }
}

function drawClinicHeader(doc: PDFKit.PDFDocument, docTitle: string) {
  const leftX = 50;
  let headerBottom = 50;

  if (fs.existsSync(LOGO_PATH)) {
    doc.image(LOGO_PATH, leftX, 45, { width: 58 });
    headerBottom = 115;
  }

  const textX = fs.existsSync(LOGO_PATH) ? leftX + 68 : leftX;
  doc
    .fillColor("#0f766e")
    .fontSize(14)
    .font("Helvetica-Bold")
    .text(CLINIC.nameFr, textX, 48, { width: 430 });
  doc.fillColor("#334155").fontSize(9).font("Helvetica");
  const arabicY = doc.y + 2;
  const arabicDrawn = drawArabicClinicName(doc, textX, arabicY, 430);
  doc.font("Helvetica").fillColor("#334155");
  doc.text(CLINIC.fullAddress, textX, doc.y + (arabicDrawn ? 4 : 2), { width: 430 });
  doc.text(CLINIC.phoneLabel, textX, doc.y + 2, { width: 430 });
  doc.text(`Email : ${CLINIC.email}`, textX, doc.y + 2, { width: 430 });

  doc
    .fillColor("#0f172a")
    .fontSize(12)
    .font("Helvetica-Bold")
    .text(docTitle.toUpperCase(), textX, doc.y + 8, { width: 430 });

  doc.y = Math.max(doc.y + 10, headerBottom);
  doc.moveDown(0.5);
  doc
    .strokeColor("#cbd5e1")
    .moveTo(leftX, doc.y)
    .lineTo(545, doc.y)
    .stroke();
  doc.moveDown(1);
}

export function generateInvoicePdf(invoice: InvoiceWithRelations): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: "A4" });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    drawClinicHeader(doc, "Facture officielle");

    const leftX = 50;
    doc.fillColor("#0f172a").fontSize(10).font("Helvetica");
    doc.text(`N° Facture : ${invoice.invoiceNumber}`, leftX);
    doc.text(`Date : ${new Date(invoice.createdAt).toLocaleDateString("fr-FR")}`);
    doc.text(`Type : ${TYPE_LABELS[invoice.type] ?? invoice.type}`);
    doc.text(`Statut : ${invoice.status === "PAID" ? "PAYÉE" : invoice.status}`);
    doc.moveDown(1);

    if (invoice.patient) {
      doc.font("Helvetica-Bold").text("Patient");
      doc.font("Helvetica");
      doc.text(`${invoice.patient.firstName} ${invoice.patient.lastName}`);
      doc.text(`Code dossier : ${invoice.patient.code}`);
      if (invoice.patient.phone) doc.text(`Téléphone : ${invoice.patient.phone}`);
      if (invoice.patient.age != null) {
        const ageLabel = formatPatientAge(invoice.patient.age, invoice.patient.ageUnit);
        if (ageLabel) doc.text(`Âge : ${ageLabel}`);
      }
    } else if (invoice.externalClient) {
      doc.font("Helvetica-Bold").text("Client externe");
      doc.font("Helvetica");
      doc.text(`${invoice.externalClient.firstName} ${invoice.externalClient.lastName}`);
      doc.text(`Code : ${invoice.externalClient.code}`);
      if (invoice.externalClient.phone) doc.text(`Téléphone : ${invoice.externalClient.phone}`);
    } else {
      doc.font("Helvetica-Bold").text("Client");
      doc.font("Helvetica");
      doc.text("Client externe");
    }
    doc.moveDown(1);

    doc
      .rect(leftX, doc.y, 495, 60)
      .fillAndStroke("#f0fdfa", "#14b8a6");
    const amountY = doc.y + 15;
    doc
      .fillColor("#0f766e")
      .fontSize(12)
      .font("Helvetica-Bold")
      .text("MONTANT TOTAL", leftX + 20, amountY);
    doc
      .fontSize(20)
      .text(`${invoice.amountFcfa.toLocaleString("fr-FR")} FCFA`, leftX + 20, amountY + 20);

    doc.y = amountY + 70;
    doc.fillColor("#0f172a").fontSize(10).font("Helvetica");
    doc.text(
      `Émis par : ${invoice.issuedBy.firstName} ${invoice.issuedBy.lastName}`,
      leftX,
    );
    if (invoice.paidAt) {
      doc.text(`Payé le : ${new Date(invoice.paidAt).toLocaleDateString("fr-FR")}`);
    }

    doc.moveDown(2);
    doc
      .fillColor("#94a3b8")
      .fontSize(8)
      .text(`${CLINIC.fullAddress} — ${CLINIC.phoneLabel}`, { align: "center" });
    doc.text(`Email : ${CLINIC.email}`, { align: "center" });

    doc.end();
  });
}
