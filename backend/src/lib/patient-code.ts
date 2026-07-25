import { prisma } from "./db.js";

const PATIENT_CODE_PREFIX = "PAT-";
const INVOICE_NUMBER_PREFIX = "FAC-";

function parsePatientCodeSequence(code: string) {
  const match = /^PAT-(\d+)$/.exec(code);
  return match ? Number.parseInt(match[1], 10) : 0;
}

function parseInvoiceSequence(invoiceNumber: string) {
  const match = /^FAC-(\d{3})$/.exec(invoiceNumber);
  return match ? Number.parseInt(match[1], 10) : 0;
}

export async function generatePatientCode() {
  const patients = await prisma.patient.findMany({
    where: { code: { startsWith: PATIENT_CODE_PREFIX } },
    select: { code: true },
  });
  const lastSequence = patients.reduce(
    (max, row) => Math.max(max, parsePatientCodeSequence(row.code)),
    0,
  );
  return `${PATIENT_CODE_PREFIX}${String(lastSequence + 1).padStart(3, "0")}`;
}

export async function generateInvoiceNumber() {
  const invoices = await prisma.invoice.findMany({
    where: { invoiceNumber: { startsWith: INVOICE_NUMBER_PREFIX } },
    select: { invoiceNumber: true },
  });
  const lastSequence = invoices.reduce(
    (max, row) => Math.max(max, parseInvoiceSequence(row.invoiceNumber)),
    0,
  );
  return `${INVOICE_NUMBER_PREFIX}${String(lastSequence + 1).padStart(3, "0")}`;
}

/** Numéros séquentiels uniques pour plusieurs factures créées en une seule opération. */
export async function generateInvoiceNumberBatch(count: number): Promise<string[]> {
  if (count <= 0) return [];
  const invoices = await prisma.invoice.findMany({
    where: { invoiceNumber: { startsWith: INVOICE_NUMBER_PREFIX } },
    select: { invoiceNumber: true },
  });
  const lastSequence = invoices.reduce(
    (max, row) => Math.max(max, parseInvoiceSequence(row.invoiceNumber)),
    0,
  );
  return Array.from({ length: count }, (_, index) =>
    `${INVOICE_NUMBER_PREFIX}${String(lastSequence + 1 + index).padStart(3, "0")}`,
  );
}
