import { InvoiceType } from "@prisma/client";
import { buildExamSheetsByKind } from "./exam-billing.js";
import { EXAM_KIND_SECTION_LABELS, type ExamKindSlug } from "./lab-notes.js";
import { INVOICE_TYPE_LABELS } from "./revenue-stats.js";

export type SettlementBreakdownLine = {
  label: string;
  count: number;
  totalFcfa: number;
};

const CATEGORY_ORDER = [
  "Consultations",
  "Laboratoire",
  "Radiologie",
  "Échographie",
  "Odontologie",
  "Opérations",
  "Hospitalisation",
] as const;

const KIND_TO_LABEL: Record<ExamKindSlug, string> = {
  examen: "Laboratoire",
  radio: "Radiologie",
  echo: "Échographie",
  odonto: "Odontologie",
  operation: "Opérations",
  hospitalisation: "Hospitalisation",
};

type InvoiceForBreakdown = {
  type: InvoiceType;
  amountFcfa: number;
  surgeryCaseId: string | null;
  hospitalizationId: string | null;
  visit?: { consultation: { clinicalNotes: string | null } | null } | null;
};

function labelFromExamKind(kind: ExamKindSlug) {
  return KIND_TO_LABEL[kind] ?? EXAM_KIND_SECTION_LABELS[kind];
}

function classifyLabExamInvoice(invoice: InvoiceForBreakdown): string {
  if (invoice.surgeryCaseId) return "Opérations";
  if (invoice.hospitalizationId) return "Hospitalisation";

  const notes = invoice.visit?.consultation?.clinicalNotes;
  if (!notes) return INVOICE_TYPE_LABELS[InvoiceType.LAB_EXAM];

  const labKinds: ExamKindSlug[] = ["examen", "radio", "echo", "odonto"];
  const sheets = buildExamSheetsByKind(notes).filter((sheet) => labKinds.includes(sheet.kind));

  if (sheets.length === 1) {
    return labelFromExamKind(sheets[0]!.kind);
  }

  const exact = sheets.find((sheet) => sheet.grossFcfa === invoice.amountFcfa);
  if (exact) return labelFromExamKind(exact.kind);

  const closest = sheets
    .map((sheet) => ({ sheet, diff: Math.abs(sheet.grossFcfa - invoice.amountFcfa) }))
    .sort((a, b) => a.diff - b.diff)[0];
  if (closest && closest.diff <= 500) {
    return labelFromExamKind(closest.sheet.kind);
  }

  return "Laboratoire";
}

export function classifyInvoiceForSettlement(invoice: InvoiceForBreakdown): string {
  switch (invoice.type) {
    case InvoiceType.CONSULTATION:
      return "Consultations";
    case InvoiceType.SURGERY:
      return "Opérations";
    case InvoiceType.HOSPITALIZATION_DEPOSIT:
    case InvoiceType.HOSPITALIZATION_FINAL:
      return "Hospitalisation";
    case InvoiceType.LAB_EXAM:
      return classifyLabExamInvoice(invoice);
    default:
      return INVOICE_TYPE_LABELS[invoice.type] ?? invoice.type;
  }
}

export function buildSettlementBreakdown(invoices: InvoiceForBreakdown[]): SettlementBreakdownLine[] {
  const grouped = new Map<string, SettlementBreakdownLine>();

  for (const invoice of invoices) {
    const label = classifyInvoiceForSettlement(invoice);
    const row = grouped.get(label) ?? { label, count: 0, totalFcfa: 0 };
    row.count += 1;
    row.totalFcfa += invoice.amountFcfa;
    grouped.set(label, row);
  }

  const rows = [...grouped.values()];
  rows.sort((a, b) => {
    const ai = CATEGORY_ORDER.indexOf(a.label as (typeof CATEGORY_ORDER)[number]);
    const bi = CATEGORY_ORDER.indexOf(b.label as (typeof CATEGORY_ORDER)[number]);
    const aOrder = ai === -1 ? 99 : ai;
    const bOrder = bi === -1 ? 99 : bi;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return a.label.localeCompare(b.label, "fr");
  });

  return rows;
}
