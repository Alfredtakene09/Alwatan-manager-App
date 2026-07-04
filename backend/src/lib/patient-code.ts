import { prisma } from "./db.js";

export async function generatePatientCode() {
  const year = new Date().getFullYear();
  const prefix = `PAT-${year}-`;
  const lastPatient = await prisma.patient.findFirst({
    where: { code: { startsWith: prefix } },
    orderBy: { code: "desc" },
    select: { code: true },
  });
  const lastSequence = lastPatient
    ? Number.parseInt(lastPatient.code.split("-")[2] ?? "0", 10)
    : 0;
  return `${prefix}${String(lastSequence + 1).padStart(5, "0")}`;
}

export async function generateInvoiceNumber() {
  const year = new Date().getFullYear();
  const prefix = `FAC-${year}-`;
  const lastInvoice = await prisma.invoice.findFirst({
    where: { invoiceNumber: { startsWith: prefix } },
    orderBy: { invoiceNumber: "desc" },
    select: { invoiceNumber: true },
  });
  const lastSequence = lastInvoice
    ? Number.parseInt(lastInvoice.invoiceNumber.split("-")[2] ?? "0", 10)
    : 0;
  return `${prefix}${String(lastSequence + 1).padStart(5, "0")}`;
}

/** Numéros séquentiels uniques pour plusieurs factures créées en une seule opération. */
export async function generateInvoiceNumberBatch(count: number): Promise<string[]> {
  if (count <= 0) return [];
  const year = new Date().getFullYear();
  const prefix = `FAC-${year}-`;
  const lastInvoice = await prisma.invoice.findFirst({
    where: { invoiceNumber: { startsWith: prefix } },
    orderBy: { invoiceNumber: "desc" },
    select: { invoiceNumber: true },
  });
  const lastSequence = lastInvoice
    ? Number.parseInt(lastInvoice.invoiceNumber.split("-")[2] ?? "0", 10)
    : 0;
  return Array.from({ length: count }, (_, index) =>
    `${prefix}${String(lastSequence + 1 + index).padStart(5, "0")}`,
  );
}
