import type { Prisma } from "@prisma/client";
import { prisma } from "./db.js";

const PATIENT_CODE_PREFIX = "PAT-";
const INVOICE_NUMBER_PREFIX = "FAC-";

export type SequenceClient = {
  $executeRaw: Prisma.TransactionClient["$executeRaw"];
  invoice: { findMany: Prisma.TransactionClient["invoice"]["findMany"] };
  patient: { findMany: Prisma.TransactionClient["patient"]["findMany"] };
};

export function parsePatientCodeSequence(code: string) {
  const match = /^PAT-(\d+)$/.exec(code);
  return match ? Number.parseInt(match[1], 10) : 0;
}

export function parseInvoiceSequence(invoiceNumber: string) {
  const match = /^FAC-(\d+)$/.exec(invoiceNumber);
  return match ? Number.parseInt(match[1], 10) : 0;
}

export function formatInvoiceNumber(sequence: number) {
  const width = sequence >= 1000 ? 6 : 3;
  return `${INVOICE_NUMBER_PREFIX}${String(sequence).padStart(width, "0")}`;
}

export function formatPatientCode(sequence: number) {
  return `${PATIENT_CODE_PREFIX}${String(sequence).padStart(3, "0")}`;
}

async function lockSequence(db: SequenceClient, key: string) {
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
}

async function nextPatientCode(db: SequenceClient) {
  await lockSequence(db, "alwatan_patient_code");
  const patients = await db.patient.findMany({
    where: { code: { startsWith: PATIENT_CODE_PREFIX } },
    select: { code: true },
  });
  const lastSequence = patients.reduce(
    (max, row) => Math.max(max, parsePatientCodeSequence(row.code)),
    0,
  );
  return formatPatientCode(lastSequence + 1);
}

async function nextInvoiceNumbers(db: SequenceClient, count: number) {
  if (count <= 0) return [];
  await lockSequence(db, "alwatan_invoice_number");
  const invoices = await db.invoice.findMany({
    where: { invoiceNumber: { startsWith: INVOICE_NUMBER_PREFIX } },
    select: { invoiceNumber: true },
  });
  const lastSequence = invoices.reduce(
    (max, row) => Math.max(max, parseInvoiceSequence(row.invoiceNumber)),
    0,
  );
  return Array.from({ length: count }, (_, index) => formatInvoiceNumber(lastSequence + 1 + index));
}

/**
 * Génère le prochain code patient.
 * Passer le client de transaction (`tx`) lorsque l'insert est dans la même `$transaction`.
 */
export async function generatePatientCode(db: SequenceClient = prisma) {
  if ("$transaction" in db) {
    return (db as typeof prisma).$transaction((tx) => nextPatientCode(tx));
  }
  return nextPatientCode(db);
}

/**
 * Génère le prochain numéro de facture (FAC-001 … FAC-999 puis FAC-001000).
 * Passer `tx` pour rester dans la même transaction que l'INSERT (verrou advisory).
 */
export async function generateInvoiceNumber(db: SequenceClient = prisma) {
  const [number] = await generateInvoiceNumberBatch(1, db);
  return number!;
}

export async function generateInvoiceNumberBatch(
  count: number,
  db: SequenceClient = prisma,
): Promise<string[]> {
  if (count <= 0) return [];
  if ("$transaction" in db) {
    return (db as typeof prisma).$transaction((tx) => nextInvoiceNumbers(tx, count));
  }
  return nextInvoiceNumbers(db, count);
}
