import { ConsultationQuotaMode, InvoiceStatus, InvoiceType, Prisma } from "@prisma/client";
import { prisma } from "./db.js";
import {
  classifyInvoiceForDayClosure,
  type DayClosureLineGroup,
} from "./day-closure-sales.js";
import {
  computeConsultationShares,
  doctorSurgeryQuotaPercent,
  doctorUsesQuota,
  type DoctorProfile,
} from "./doctor-compensation.js";
import { parsePrescribedExamsByKind, type ExamKindSlug } from "./lab-notes.js";
import { registrationSummaryReceptionistWhere } from "./reception-scope.js";
import { COLLECTED_INVOICE_TYPES } from "./revenue-stats.js";

/** Orthopédie et traumatologie (y compris la graphie « Tromatologie ») sont un seul service. */
export const ORTHO_TRAUMA_SERVICE = "Traumatologie & Orthopédie";

/** Une ligne du PDF des enregistrements : un service, ou une opération. */
export type RegistrationSummaryLine = {
  group: DayClosureLineGroup;
  service: string;
  qty: number;
  amountFcfa: number;
  doctorShareFcfa: number;
  /** null quand les factures de la ligne n'ont pas toutes le même taux. */
  doctorPercent: number | null;
  operationPercent: number | null;
};

const compensationSelect = {
  isMedecin: true,
  doctorCompensationType: true,
  consultationTotalFcfa: true,
  consultationQuotaMode: true,
  consultationQuotaPercent: true,
  consultationQuotaFcfa: true,
  surgeryQuotaPercent: true,
} satisfies Prisma.EmployeeSelect;

const doctorSelect = {
  select: { role: true, employee: { select: compensationSelect } },
} as const;

const summaryInvoiceSelect = {
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
      assignedDoctor: doctorSelect,
      patient: { select: { service: true } },
      consultation: { select: { clinicalNotes: true, doctor: doctorSelect } },
    },
  },
  hospitalization: { select: { reductionFcfa: true } },
  surgeryCase: {
    select: {
      surgeonShareFcfa: true,
      surgeonPercent: true,
      totalCostFcfa: true,
      surgeon: doctorSelect,
      interventionType: {
        select: {
          label: true,
          surgeonPercent: true,
          clinicService: { select: { name: true } },
        },
      },
    },
  },
} satisfies Prisma.InvoiceSelect;

type SummaryInvoice = Prisma.InvoiceGetPayload<{ select: typeof summaryInvoiceSelect }>;

/** Montant actuel de la ligne : le prix facturé, pas un encaissement antérieur. */
function summaryAmountFcfa(invoice: SummaryInvoice): number {
  return Math.max(0, invoice.amountFcfa);
}

/**
 * Consultation : le montant saisi sur la ligne (après réduction).
 * Sans montant de ligne, on reprend le prix actuel de la fiche médecin.
 */
export function consultationTariffAmount(invoice: SummaryInvoice, collectedFcfa: number): number {
  if (collectedFcfa <= 0 || invoice.type !== InvoiceType.CONSULTATION) return collectedFcfa;
  const reduction = Math.max(0, invoice.visit?.reductionFcfa ?? 0);
  const lineFee = invoice.visit?.consultationFeeFcfa ?? 0;
  if (lineFee > 0) return Math.max(0, lineFee - reduction);
  const price = invoiceDoctor(invoice)?.employee?.consultationTotalFcfa ?? 0;
  if (price <= 0) return collectedFcfa;
  return Math.max(0, price - reduction);
}

/** Le médecin actuellement affecté à la ligne prime sur celui de l'ancienne consultation. */
function invoiceDoctor(invoice: SummaryInvoice): DoctorProfile | null {
  return invoice.visit?.assignedDoctor ?? invoice.visit?.consultation?.doctor ?? null;
}

/** Types dont la quantité du cumul est le nombre d'examens, pas le nombre de lignes. */
const EXAM_QUANTITY_KINDS = new Set<ExamKindSlug>(["examen", "radio", "echo", "odonto"]);

/**
 * Nombre d'examens facturés sur la ligne (Cheville + Pied = 2).
 * null pour une consultation, une opération ou une hospitalisation : on compte alors la ligne.
 */
export function registrationExamQuantity(invoice: {
  billingExamKind?: string | null;
  visit?: { consultation?: { clinicalNotes?: string | null } | null } | null;
}): number | null {
  const kind = invoice.billingExamKind?.trim() as ExamKindSlug | undefined;
  if (!kind || !EXAM_QUANTITY_KINDS.has(kind)) return null;
  const labels = (parsePrescribedExamsByKind(invoice.visit?.consultation?.clinicalNotes)[kind] ?? [])
    .map((label) => label.trim())
    .filter(Boolean);
  return Math.max(1, labels.length);
}

/** Le service modifié sur le dossier prime sur le service figé de la visite. */
export function registrationServiceLabel(
  group: DayClosureLineGroup,
  classifiedLabel: string,
  patientService: string | null | undefined,
): string {
  if (group !== "consultation") return classifiedLabel;
  const edited = patientService?.trim();
  return edited || classifiedLabel;
}

type ShareResult = { shareFcfa: number; percent: number | null };

const NO_SHARE: ShareResult = { shareFcfa: 0, percent: null };

/** Part consultation : le % actuel de la fiche (ex. 50 %), pas celui figé à l'encaissement. */
export function consultationShare(invoice: SummaryInvoice, amountFcfa: number): ShareResult {
  const doctor = invoiceDoctor(invoice);
  if (!doctor || amountFcfa <= 0) return NO_SHARE;

  const quotaMode = doctor.employee?.consultationQuotaMode ?? ConsultationQuotaMode.PERCENT;
  const quotaPercent = doctor.employee?.consultationQuotaPercent ?? 0;
  if (quotaMode === ConsultationQuotaMode.PERCENT && quotaPercent > 0) {
    return {
      shareFcfa: Math.round((amountFcfa * quotaPercent) / 100),
      percent: quotaPercent,
    };
  }
  if (!doctorUsesQuota(doctor)) return NO_SHARE;

  const { doctorShareFcfa } = computeConsultationShares(
    amountFcfa,
    quotaPercent,
    doctor.employee?.consultationQuotaFcfa,
    quotaMode,
    doctor,
  );
  return { shareFcfa: doctorShareFcfa, percent: null };
}

function operationSurgeon(invoice: SummaryInvoice): DoctorProfile | null {
  return invoice.surgeryCase?.surgeon ?? invoiceDoctor(invoice);
}

/**
 * Part du chirurgien sur le montant exporté.
 * Le % associé à l'opération prime, puis le % de la fiche du médecin.
 */
export function operationShare(invoice: SummaryInvoice, amountFcfa: number): ShareResult {
  if (amountFcfa <= 0) return NO_SHARE;

  const associated = invoice.surgeryCase?.surgeonPercent ?? 0;
  if (associated > 0) {
    return {
      shareFcfa: Math.round((amountFcfa * associated) / 100),
      percent: associated,
    };
  }

  const fichePercent = doctorSurgeryQuotaPercent(operationSurgeon(invoice));
  if (fichePercent != null) {
    return {
      shareFcfa: Math.round((amountFcfa * fichePercent) / 100),
      percent: fichePercent,
    };
  }

  const stored = invoice.surgeryCase?.surgeonShareFcfa ?? 0;
  const total = invoice.surgeryCase?.totalCostFcfa ?? 0;
  if (stored > 0 && total > 0) {
    const percent = Math.round((stored * 100) / total);
    return {
      shareFcfa: Math.round((amountFcfa * stored) / total),
      percent,
    };
  }

  const catalogPercent = invoice.surgeryCase?.interventionType?.surgeonPercent ?? 0;
  if (catalogPercent > 0) {
    return {
      shareFcfa: Math.round((amountFcfa * catalogPercent) / 100),
      percent: catalogPercent,
    };
  }
  return NO_SHARE;
}

function invoiceShare(
  invoice: SummaryInvoice,
  group: DayClosureLineGroup,
  amountFcfa: number,
): ShareResult {
  if (group === "consultation") return consultationShare(invoice, amountFcfa);
  if (group === "operation") return operationShare(invoice, amountFcfa);
  return NO_SHARE;
}

type Accumulator = RegistrationSummaryLine & {
  patientIds: Set<string>;
  doctorPercents: Set<number>;
  operationPercents: Set<number>;
};

/** Un seul taux dans la ligne : on l'affiche ; sinon la colonne reste vide. */
function uniquePercent(percents: Set<number>): number | null {
  return percents.size === 1 ? [...percents][0] : null;
}

export type RegistrationSummaryOptions = {
  /** Périmètre patients déjà calculé par l'appelant (dates, service, recherche). */
  patientWhere: Prisma.PatientWhereInput;
  /** Une réception : ses factures seulement, sans reprendre celles d'une autre caisse. */
  receptionistId?: string | null;
};

function foldServiceKey(label: string): string {
  return label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function isOrthoTraumaService(label: string): boolean {
  const key = foldServiceKey(label);
  return key === "orthopedie" || key === "traumatologie" || key === "tromatologie";
}

/** Nom de l'acte (catalogue ou prescription), pas le service clinique. */
export function operationActName(invoice: SummaryInvoice): string | null {
  const named = invoice.surgeryCase?.interventionType?.label?.trim();
  if (named) return named;
  const prescribed = parsePrescribedExamsByKind(invoice.visit?.consultation?.clinicalNotes)
    .operation.map((item) => item.trim())
    .filter(Boolean);
  return prescribed.length > 0 ? prescribed.join(", ") : null;
}

function displayServiceName(serviceLabel: string): string {
  return isOrthoTraumaService(serviceLabel) ? ORTHO_TRAUMA_SERVICE : serviceLabel;
}

/** « Gynécologie (Césarienne) » : le service, puis l'acte entre parenthèses. */
export function operationLineLabel(serviceLabel: string, operationName: string | null): string {
  const service = displayServiceName(serviceLabel);
  const name = operationName?.trim();
  return name ? `${service} (${name})` : service;
}

/**
 * Consultations, examens et hospitalisations restent cumulés par service.
 * Chaque opération est une ligne « Service (acte) ». Orthopédie et traumatologie
 * partagent le libellé « Traumatologie & Orthopédie », y compris pour les consultations.
 */
export function registrationLineIdentity(input: {
  group: DayClosureLineGroup;
  serviceLabel: string;
  operationName: string | null;
  invoiceId: string;
}): { key: string; service: string } {
  const service = displayServiceName(input.serviceLabel);
  if (input.group !== "operation") {
    return { key: `${input.group}\u0000${service}`, service };
  }
  const label = operationLineLabel(input.serviceLabel, input.operationName);
  if (isOrthoTraumaService(input.serviceLabel)) {
    const act = foldServiceKey(input.operationName?.trim() || service);
    return { key: `${input.group}\u0000${ORTHO_TRAUMA_SERVICE}\u0000${act}`, service: label };
  }
  return { key: `${input.group}\u0000${input.invoiceId}`, service: label };
}

/**
 * Cumul des prestations des patients enregistrés sur la période.
 * Les opérations sont listées « Service (acte) ». Orthopédie et traumatologie
 * portent le même nom, consultations comprises. Le reste suit le ticket de clôture.
 */
export async function buildRegistrationSummary(
  options: RegistrationSummaryOptions,
): Promise<RegistrationSummaryLine[]> {
  const receptionistId = options.receptionistId?.trim() || "";
  const invoices = await prisma.invoice.findMany({
    where: {
      type: { in: COLLECTED_INVOICE_TYPES },
      status: { not: InvoiceStatus.CANCELLED },
      patient: options.patientWhere,
      ...(receptionistId ? registrationSummaryReceptionistWhere(receptionistId) : {}),
    },
    select: summaryInvoiceSelect,
  });

  const grouped = new Map<string, Accumulator>();

  for (const invoice of invoices) {
    const collectedFcfa = summaryAmountFcfa(invoice);
    const amountFcfa = consultationTariffAmount(invoice, collectedFcfa);
    if (amountFcfa <= 0) continue;

    const { label, group } = classifyInvoiceForDayClosure(invoice);
    const serviceLabel = registrationServiceLabel(group, label, invoice.visit?.patient?.service);
    const identity = registrationLineIdentity({
      group,
      serviceLabel,
      operationName: group === "operation" ? operationActName(invoice) : null,
      invoiceId: invoice.id,
    });
    const key = identity.key;
    const row: Accumulator = grouped.get(key) ?? {
      group,
      service: identity.service,
      qty: 0,
      amountFcfa: 0,
      doctorShareFcfa: 0,
      doctorPercent: null,
      operationPercent: null,
      patientIds: new Set<string>(),
      doctorPercents: new Set<number>(),
      operationPercents: new Set<number>(),
    };

    const examQty = registrationExamQuantity(invoice);
    if (examQty != null) {
      row.qty += examQty;
    } else {
      const patientKey = group === "operation" ? invoice.id : (invoice.patientId ?? invoice.id);
      if (!row.patientIds.has(patientKey)) {
        row.patientIds.add(patientKey);
        row.qty += 1;
      }
    }
    row.amountFcfa += amountFcfa;

    const share = invoiceShare(invoice, group, amountFcfa);
    row.doctorShareFcfa += share.shareFcfa;
    if (share.percent != null) {
      if (group === "operation") row.operationPercents.add(share.percent);
      else row.doctorPercents.add(share.percent);
    }

    grouped.set(key, row);
  }

  return [...grouped.values()]
    .map(({ patientIds: _patientIds, doctorPercents, operationPercents, ...line }) => ({
      ...line,
      doctorPercent: uniquePercent(doctorPercents),
      operationPercent: uniquePercent(operationPercents),
    }))
    .sort((a, b) => a.service.localeCompare(b.service, "fr", { sensitivity: "base" }));
}
