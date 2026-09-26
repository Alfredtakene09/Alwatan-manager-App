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

export type DayClosureServiceLine = {
  label: string;
  qty: number;
  totalFcfa: number;
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

const DAY_CLOSURE_LABEL_ALIASES: Record<string, string> = {
  Opérations: "Chirurgie",
  Opération: "Chirurgie",
  Échographie: "Echographie",
  Écho: "Echographie",
  Echo: "Echographie",
  Consultations: "Consultations",
};

type DayClosureInvoice = {
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

export function classifyInvoiceForDayClosure(invoice: DayClosureInvoice): string {
  if (invoice.type === InvoiceType.CONSULTATION) {
    const serviceName =
      invoice.visit?.assignedClinicService?.name?.trim() ||
      invoice.visit?.patient?.service?.trim() ||
      "";
    return normalizeDayClosureLabel(serviceName || "Consultations");
  }
  if (isCollectedOperationInvoice(invoice) || invoice.type === InvoiceType.SURGERY) {
    return "Chirurgie";
  }
  if (isCollectedHospitalizationInvoice(invoice)) {
    return "Hospitalisation";
  }
  if (invoice.type === InvoiceType.LAB_EXAM) {
    return classifyLabExamForDayClosure(invoice);
  }
  return normalizeDayClosureLabel(classifyInvoiceForSettlement(invoice));
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
} satisfies Prisma.InvoiceSelect;

/**
 * Cumul ventes caissier pour le ticket de fin de journée (Produits × Qté × Total).
 * Qté = patients distincts du service (pas le nombre de factures) ;
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
      select: {
        amountFcfa: true,
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
      select: dayClosureInvoiceSelect,
    }),
  ]);

  const byInvoice = new Map<
    string,
    { invoice: DayClosureInvoice; collectedFcfa: number }
  >();

  for (const payment of payments) {
    const existing = byInvoice.get(payment.invoiceId);
    if (existing) {
      existing.collectedFcfa += Math.max(0, payment.amountFcfa);
      continue;
    }
    byInvoice.set(payment.invoiceId, {
      invoice: payment.invoice,
      collectedFcfa: Math.max(0, payment.amountFcfa),
    });
  }

  for (const invoice of legacyInvoices) {
    if (byInvoice.has(invoice.id)) continue;
    byInvoice.set(invoice.id, {
      invoice,
      collectedFcfa: collectedAmountFcfa(invoice),
    });
  }

  const grouped = new Map<string, DayClosureServiceLine & { patientIds: Set<string> }>();
  let collectedFcfa = 0;
  let reductionFcfa = 0;
  const reductionVisitIds = new Set<string>();

  for (const { invoice, collectedFcfa: paidGross } of byInvoice.values()) {
    const paidCap =
      invoice.paidAmountFcfa != null
        ? Math.max(0, invoice.paidAmountFcfa)
        : Math.max(0, invoice.amountFcfa);
    const paid = Math.min(Math.max(0, paidGross), paidCap);
    if (paid <= 0) continue;
    collectedFcfa += paid;

    const label = classifyInvoiceForDayClosure(invoice);
    const row = grouped.get(label) ?? { label, qty: 0, totalFcfa: 0, patientIds: new Set<string>() };
    const patientKey = invoice.patientId ?? invoice.id;
    if (!row.patientIds.has(patientKey)) {
      row.patientIds.add(patientKey);
      row.qty += 1;
    }
    row.totalFcfa += paid;
    grouped.set(label, row);

    // Remise consultation / hosp : une fois par facture (pas par tranche).
    const invoiceKey = invoice.id;
    if (!reductionVisitIds.has(invoiceKey)) {
      reductionVisitIds.add(invoiceKey);
      reductionFcfa += reductionForInvoice(invoice);
    }
  }

  const serviceLines = [...grouped.values()]
    .map(({ patientIds: _patientIds, ...line }) => line)
    .sort((a, b) => a.label.localeCompare(b.label, "fr", { sensitivity: "base" }));

  return {
    serviceLines,
    collectedFcfa,
    reductionFcfa,
    saleFcfa: collectedFcfa + reductionFcfa,
  };
}
