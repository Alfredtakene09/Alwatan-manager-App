import { InvoiceStatus, InvoiceType, Prisma } from "@prisma/client";
import { prisma } from "./db.js";
import { classifyInvoiceForSettlement } from "./cash-settlement-breakdown.js";
import { buildExamSheetsByKind } from "./exam-billing.js";
import { EXAM_KIND_SECTION_LABELS, type ExamKindSlug } from "./lab-notes.js";
import {
  COLLECTED_INVOICE_TYPES,
  collectedAmountFcfa,
  collectedInvoicesWhere,
  isCollectedHospitalizationInvoice,
  isCollectedOperationInvoice,
} from "./revenue-stats.js";
import { comptabiliteInvoicePatientWhere } from "./patient-billing.js";

/** Famille de prestation (consultation, opération, examen…). Le ticket ne les imprime plus en sections. */
export type DayClosureLineGroup =
  | "consultation"
  | "operation"
  | "exam"
  | "hospitalization"
  | "other";

export type DayClosureServiceLine = {
  label: string;
  qty: number;
  totalFcfa: number;
  group: DayClosureLineGroup;
};

export type DayClosureSalesSummary = {
  serviceLines: DayClosureServiceLine[];
  collectedFcfa: number;
  reductionFcfa: number;
  saleFcfa: number;
};

const DAY_CLOSURE_KIND_LABEL: Partial<Record<ExamKindSlug, string>> = {
  specialty: "Spécialité",
  examen: "Laboratoire",
  radio: "Radiologie",
  echo: "Echographie",
  odonto: "Odontologie",
  operation: "Chirurgie",
  hospitalisation: "Hospitalisation",
};

/**
 * La section « Examens » est réservée au laboratoire ; « Autres prestations »
 * regroupe l'échographie et la radiologie. Spécialité et odontologie restent
 * des actes de consultation.
 */
const DAY_CLOSURE_EXAM_LABELS = new Set(["Laboratoire"]);
const DAY_CLOSURE_CONSULTATION_LABELS = new Set(["Spécialité", "Odontologie"]);

function dayClosureExamGroup(label: string): DayClosureLineGroup {
  if (DAY_CLOSURE_EXAM_LABELS.has(label)) return "exam";
  if (DAY_CLOSURE_CONSULTATION_LABELS.has(label)) return "consultation";
  return "other";
}

const DAY_CLOSURE_LABEL_ALIASES: Record<string, string> = {
  Opérations: "Chirurgie",
  Opération: "Chirurgie",
  Échographie: "Echographie",
  Écho: "Echographie",
  Echo: "Echographie",
  Consultations: "Consultations",
};

export type DayClosureInvoice = {
  id: string;
  patientId: string | null;
  type: InvoiceType;
  amountFcfa: number;
  paidAmountFcfa: number | null;
  billingExamKind: string | null;
  surgeryCaseId: string | null;
  hospitalizationId: string | null;
  visit: {
    reductionFcfa: number | null;
    consultationFeeFcfa: number | null;
    assignedClinicService: { name: string } | null;
    patient: { service: string | null } | null;
    consultation: { clinicalNotes: string | null } | null;
  } | null;
  hospitalization: { reductionFcfa: number } | null;
  surgeryCase?: {
    interventionType: { clinicService: { name: string } | null } | null;
  } | null;
};

function normalizeDayClosureLabel(label: string): string {
  const trimmed = label.trim();
  if (!trimmed) return "Autres";
  return DAY_CLOSURE_LABEL_ALIASES[trimmed] ?? trimmed;
}

function classifyLabExamForDayClosure(invoice: DayClosureInvoice): string {
  const kind = invoice.billingExamKind?.trim() as ExamKindSlug | undefined;
  if (kind && DAY_CLOSURE_KIND_LABEL[kind]) {
    return DAY_CLOSURE_KIND_LABEL[kind]!;
  }
  if (isCollectedOperationInvoice(invoice)) return "Chirurgie";
  if (isCollectedHospitalizationInvoice(invoice)) return "Hospitalisation";

  const fallback = classifyInvoiceForSettlement({
    type: invoice.type,
    amountFcfa: invoice.amountFcfa,
    paidAmountFcfa: invoice.paidAmountFcfa,
    surgeryCaseId: invoice.surgeryCaseId,
    hospitalizationId: invoice.hospitalizationId,
    visit: invoice.visit,
  });
  return normalizeDayClosureLabel(fallback);
}

/**
 * Une opération, au bloc (dossier chirurgie) comme prescrite en consultation,
 * va dans la section « Opérations ».
 */
function isDayClosureOperation(invoice: DayClosureInvoice): boolean {
  return (
    invoice.type === InvoiceType.SURGERY ||
    Boolean(invoice.surgeryCaseId) ||
    invoice.billingExamKind?.trim() === "operation"
  );
}

/**
 * Consultation et opération partagent souvent le même service (Orthopédie).
 * Le reçu des cumuls le dit dans le libellé, sans le nom du patient.
 */
function cumulServiceLabel(group: DayClosureLineGroup, serviceLabel: string): string {
  if (group === "consultation") return `Consultation — ${serviceLabel}`;
  if (group === "operation") return `Opération — ${serviceLabel}`;
  return serviceLabel;
}

/** Service ayant réalisé l'opération : type d'intervention, sinon service de la visite. */

function operationServiceLabel(invoice: DayClosureInvoice): string {
  const serviceName =
    invoice.surgeryCase?.interventionType?.clinicService?.name?.trim() ||
    invoice.visit?.assignedClinicService?.name?.trim() ||
    invoice.visit?.patient?.service?.trim() ||
    "";
  return serviceName ? normalizeDayClosureLabel(serviceName) : "Chirurgie";
}

export type DayClosureClassification = {
  label: string;
  group: DayClosureLineGroup;
};

export function classifyInvoiceForDayClosure(
  invoice: DayClosureInvoice,
): DayClosureClassification {
  if (invoice.type === InvoiceType.CONSULTATION) {
    const serviceName =
      invoice.visit?.assignedClinicService?.name?.trim() ||
      invoice.visit?.patient?.service?.trim() ||
      "";
    return {
      label: normalizeDayClosureLabel(serviceName || "Consultations"),
      group: "consultation",
    };
  }
  if (isDayClosureOperation(invoice)) {
    return { label: operationServiceLabel(invoice), group: "operation" };
  }
  if (isCollectedHospitalizationInvoice(invoice)) {
    return { label: "Hospitalisation", group: "hospitalization" };
  }
  if (invoice.type === InvoiceType.LAB_EXAM) {
    const label = classifyLabExamForDayClosure(invoice);
    return { label, group: dayClosureExamGroup(label) };
  }
  return { label: normalizeDayClosureLabel(classifyInvoiceForSettlement(invoice)), group: "other" };
}

/**
 * Montant retenu dans le cumul du jour.
 * Une facture soldée avec paidAmountFcfa à 0 (hospitalisation encaissée
 * sans ligne de versement) compte quand même son montant facturé.
 */
export function dayClosureCountedFcfa(
  invoice: { amountFcfa: number; paidAmountFcfa?: number | null },
  paidGross: number,
) {
  const cap = collectedAmountFcfa(invoice);
  return Math.min(Math.max(0, paidGross), cap);
}

function reductionForInvoice(invoice: DayClosureInvoice): number {
  if (invoice.type === InvoiceType.CONSULTATION) {
    return Math.max(0, Number(invoice.visit?.reductionFcfa) || 0);
  }
  if (isCollectedHospitalizationInvoice(invoice)) {
    return Math.max(0, Number(invoice.hospitalization?.reductionFcfa) || 0);
  }
  if (invoice.type === InvoiceType.LAB_EXAM) {
    const notes = invoice.visit?.consultation?.clinicalNotes;
    const kind = invoice.billingExamKind?.trim() as ExamKindSlug | undefined;
    if (notes && kind && kind in EXAM_KIND_SECTION_LABELS) {
      const sheet = buildExamSheetsByKind(notes).find((row) => row.kind === kind);
      if (sheet) {
        return Math.max(0, sheet.grossFcfa - Math.max(0, Number(invoice.amountFcfa) || 0));
      }
    }
  }
  return 0;
}

const dayClosureInvoiceSelect = {
  id: true,
  patientId: true,
  type: true,
  amountFcfa: true,
  paidAmountFcfa: true,
  billingExamKind: true,
  surgeryCaseId: true,
  hospitalizationId: true,
  visit: {
    select: {
      reductionFcfa: true,
      consultationFeeFcfa: true,
      assignedClinicService: { select: { name: true } },
      patient: { select: { service: true } },
      consultation: { select: { clinicalNotes: true } },
    },
  },
  hospitalization: { select: { reductionFcfa: true } },
  surgeryCase: {
    select: {
      interventionType: { select: { clinicService: { select: { name: true } } } },
    },
  },
} satisfies Prisma.InvoiceSelect;

/**
 * Cumul ventes caissier pour le ticket de fin de journée (Produits × Qté × Total).
 * Une ligne par prestation, sans nom de patient :
 * « Consultation — Orthopédie », « Opération — Orthopédie » (qté = nombre d'actes).
 * Total = sommes des versements du caissier sur la période.
 */
export async function buildDayClosureSalesSummary(
  cashierId: string,
  from: Date,
  to: Date,
): Promise<DayClosureSalesSummary> {
  const invoiceWhere: Prisma.InvoiceWhereInput = {
    type: { in: COLLECTED_INVOICE_TYPES },
    status: { not: InvoiceStatus.CANCELLED },
    ...comptabiliteInvoicePatientWhere(),
  };

  const [payments, legacyInvoices] = await Promise.all([
    prisma.invoicePayment.findMany({
      where: {
        paidAt: { gte: from, lt: to },
        recordedById: cashierId,
        invoice: invoiceWhere,
      },
      orderBy: { paidAt: "asc" },
      select: {
        amountFcfa: true,
        paidAt: true,
        invoiceId: true,
        invoice: { select: dayClosureInvoiceSelect },
      },
    }),
    prisma.invoice.findMany({
      where: {
        ...collectedInvoicesWhere(from, to),
        payments: { none: {} },
        issuedById: cashierId,
      },
      orderBy: { createdAt: "asc" },
      select: { ...dayClosureInvoiceSelect, createdAt: true },
    }),
  ]);

  const byInvoice = new Map<
    string,
    { invoice: DayClosureInvoice; collectedFcfa: number; sortAt: number }
  >();

  for (const payment of payments) {
    const sortAt = payment.paidAt.getTime();
    const existing = byInvoice.get(payment.invoiceId);
    if (existing) {
      existing.collectedFcfa += Math.max(0, payment.amountFcfa);
      existing.sortAt = Math.min(existing.sortAt, sortAt);
      continue;
    }
    byInvoice.set(payment.invoiceId, {
      invoice: payment.invoice,
      collectedFcfa: Math.max(0, payment.amountFcfa),
      sortAt,
    });
  }

  for (const invoice of legacyInvoices) {
    if (byInvoice.has(invoice.id)) continue;
    byInvoice.set(invoice.id, {
      invoice,
      collectedFcfa: collectedAmountFcfa(invoice),
      sortAt: invoice.createdAt.getTime(),
    });
  }

  const entries = [...byInvoice.values()].sort((a, b) => a.sortAt - b.sortAt);
  return assembleDayClosureReceiptLines(entries);
}

/** Lignes du reçu : cumul par prestation, sans nom de patient. */
export function assembleDayClosureReceiptLines(
  entries: { invoice: DayClosureInvoice; collectedFcfa: number }[],
): DayClosureSalesSummary {
  const grouped = new Map<string, DayClosureServiceLine>();
  let collectedFcfa = 0;
  let reductionFcfa = 0;
  const reductionVisitIds = new Set<string>();

  for (const { invoice, collectedFcfa: paidGross } of entries) {
    const paid = dayClosureCountedFcfa(invoice, paidGross);
    if (paid <= 0) continue;
    collectedFcfa += paid;

    const { label, group } = classifyInvoiceForDayClosure(invoice);
    const key = `${group}\u0000${label}`;
    const row = grouped.get(key) ?? {
      label: cumulServiceLabel(group, label),
      group,
      qty: 0,
      totalFcfa: 0,
    };
    row.qty += 1;
    row.totalFcfa += paid;
    grouped.set(key, row);

    // Remise consultation / hosp : une fois par facture (pas par tranche).
    const invoiceKey = invoice.id;
    if (!reductionVisitIds.has(invoiceKey)) {
      reductionVisitIds.add(invoiceKey);
      reductionFcfa += reductionForInvoice(invoice);
    }
  }

  const serviceLines = [...grouped.values()];

  return {
    serviceLines,
    collectedFcfa,
    reductionFcfa,
    saleFcfa: collectedFcfa + reductionFcfa,
  };
}
