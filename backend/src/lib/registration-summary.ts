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
import { extractExternalPatientService } from "./visit-external.js";

/** Orthopédie et traumatologie (y compris la graphie « Tromatologie ») sont un seul service. */
export const ORTHO_TRAUMA_SERVICE = "traumatologie&Orthopedie";

/** Une ligne du PDF des enregistrements : un service, ou une opération. */
export type RegistrationSummaryLine = {
  group: DayClosureLineGroup;
  /** Libellé court du ticket : « Service » ou « Service (acte) ». */
  service: string;
  /** Service seul, pour la cellule détaillée de l'export. */
  serviceName: string;
  /** Acte opératoire, absent pour les autres prestations. */
  operationName: string | null;
  /** Médecins de la ligne, sans le préfixe « Dr ». */
  doctorNames: string[];
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
  select: { firstName: true, lastName: true, role: true, employee: { select: compensationSelect } },
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
      notes: true,
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

/** Service choisi à l'enregistrement : dossier, puis note externe, puis visite. */
export function recordedRegistrationService(invoice: {
  visit?: {
    notes?: string | null;
    assignedClinicService?: { name: string } | null;
    patient?: { service: string | null } | null;
  } | null;
}): string {
  return (
    invoice.visit?.patient?.service?.trim() ||
    extractExternalPatientService(invoice.visit?.notes) ||
    invoice.visit?.assignedClinicService?.name?.trim() ||
    ""
  );
}

/**
 * Une gynécologie enregistrée ne doit pas sortir sous un autre service
 * (ex. Ophtalmologie) quand l'acte n'est que le nom de ce service.
 * Un acte réel (Trichiasis, Césarienne) garde le service de l'opération.
 */
export function exactRegistrationService(input: {
  group: DayClosureLineGroup;
  classifiedLabel: string;
  recordedService: string | null | undefined;
  operationName: string | null;
}): string {
  const recorded = input.recordedService?.trim() || "";
  if (input.group === "consultation") return recorded || input.classifiedLabel;
  const act = input.operationName?.trim() || "";
  if (
    recorded &&
    act &&
    foldServiceKey(act) === foldServiceKey(input.classifiedLabel) &&
    foldServiceKey(recorded) !== foldServiceKey(input.classifiedLabel)
  ) {
    return displayServiceName(recorded);
  }
  return input.classifiedLabel;
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

type Accumulator = Omit<RegistrationSummaryLine, "doctorNames" | "doctorPercent" | "operationPercent"> & {
  patientIds: Set<string>;
  doctorPercents: Set<number>;
  operationPercents: Set<number>;
  doctorNameSet: Set<string>;
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
  if (!name || foldServiceKey(name) === foldServiceKey(service)) return service;
  return `${service} (${name})`;
}

function doctorPlainName(
  user: { firstName?: string | null; lastName?: string | null } | null | undefined,
): string {
  return [user?.firstName, user?.lastName]
    .map((part) => part?.trim() ?? "")
    .filter(Boolean)
    .join(" ")
    .replace(/^dr\.?\s+/i, "")
    .trim();
}

function lineDoctorName(invoice: SummaryInvoice, group: DayClosureLineGroup): string {
  const user =
    group === "operation"
      ? (invoice.surgeryCase?.surgeon ??
        invoice.visit?.assignedDoctor ??
        invoice.visit?.consultation?.doctor)
      : (invoice.visit?.assignedDoctor ?? invoice.visit?.consultation?.doctor);
  return doctorPlainName(user);
}

/**
 * Consultations, examens et hospitalisations restent cumulés par service.
 * Chaque opération est une ligne « Service (acte) », sauf orthopédie et
 * traumatologie : toutes leurs opérations forment une seule ligne
 * « traumatologie&Orthopedie ». Les consultations de ces deux services
 * portent le même nom.
 */
export function registrationLineIdentity(input: {
  group: DayClosureLineGroup;
  serviceLabel: string;
  operationName: string | null;
  invoiceId: string;
}): { key: string; service: string; serviceName: string; operationName: string | null } {
  const serviceName = displayServiceName(input.serviceLabel);
  const rawOperation = input.operationName?.trim() || null;
  const operationName =
    rawOperation && foldServiceKey(rawOperation) !== foldServiceKey(serviceName) ? rawOperation : null;
  if (input.group !== "operation") {
    return { key: `${input.group}\u0000${serviceName}`, service: serviceName, serviceName, operationName: null };
  }
  const label = operationLineLabel(input.serviceLabel, operationName);
  if (isOrthoTraumaService(input.serviceLabel)) {
    return {
      key: `${input.group}\u0000${ORTHO_TRAUMA_SERVICE}`,
      service: ORTHO_TRAUMA_SERVICE,
      serviceName: ORTHO_TRAUMA_SERVICE,
      operationName: null,
    };
  }
  return { key: `${input.group}\u0000${input.invoiceId}`, service: label, serviceName, operationName };
}

/**
 * Cumul des prestations des patients enregistrés sur la période.
 * Les opérations sont listées « Service (acte) », sauf orthopédie et traumatologie,
 * réunies sous « traumatologie&Orthopedie ». Le reste suit le ticket de clôture.
 */
export type RegistrationActivityCounts = {
  consultationPatients: number;
  operationPatients: number;
  examPatients: number;
  hospitalizationPatients: number;
};

/**
 * Patients des cartes d'enregistrement.
 * Une facture annulée, un montant nul, un dossier seulement notifié ou une
 * prescription sans facture ne comptent pas. Chaque facture va dans une seule carte.
 * Radiologie et échographie restent avec le laboratoire : ce sont des examens facturés.
 */
export function registrationActivityPatientCounts(
  invoices: SummaryInvoice[],
): RegistrationActivityCounts {
  const patients = {
    consultation: new Set<string>(),
    operation: new Set<string>(),
    exam: new Set<string>(),
    hospitalization: new Set<string>(),
  };

  for (const invoice of invoices) {
    const amountFcfa = consultationTariffAmount(invoice, summaryAmountFcfa(invoice));
    if (amountFcfa <= 0 || !invoice.patientId) continue;
    const { group } = classifyInvoiceForDayClosure(invoice);
    if (group === "consultation") patients.consultation.add(invoice.patientId);
    else if (group === "operation") patients.operation.add(invoice.patientId);
    else if (group === "hospitalization") patients.hospitalization.add(invoice.patientId);
    else patients.exam.add(invoice.patientId);
  }

  return {
    consultationPatients: patients.consultation.size,
    operationPatients: patients.operation.size,
    examPatients: patients.exam.size,
    hospitalizationPatients: patients.hospitalization.size,
  };
}

async function loadRegistrationInvoices(options: RegistrationSummaryOptions) {
  const receptionistId = options.receptionistId?.trim() || "";
  return prisma.invoice.findMany({
    where: {
      type: { in: COLLECTED_INVOICE_TYPES },
      status: { not: InvoiceStatus.CANCELLED },
      patient: options.patientWhere,
      ...(receptionistId ? registrationSummaryReceptionistWhere(receptionistId) : {}),
    },
    select: summaryInvoiceSelect,
  });
}

export async function buildRegistrationReport(options: RegistrationSummaryOptions): Promise<{
  lines: RegistrationSummaryLine[];
  activity: RegistrationActivityCounts;
}> {
  const invoices = await loadRegistrationInvoices(options);
  return {
    lines: summarizeRegistrationInvoices(invoices),
    activity: registrationActivityPatientCounts(invoices),
  };
}

export async function buildRegistrationSummary(
  options: RegistrationSummaryOptions,
): Promise<RegistrationSummaryLine[]> {
  return (await buildRegistrationReport(options)).lines;
}

function summarizeRegistrationInvoices(invoices: SummaryInvoice[]): RegistrationSummaryLine[] {
  const grouped = new Map<string, Accumulator>();

  for (const invoice of invoices) {
    const collectedFcfa = summaryAmountFcfa(invoice);
    const amountFcfa = consultationTariffAmount(invoice, collectedFcfa);
    if (amountFcfa <= 0) continue;

    const { label, group } = classifyInvoiceForDayClosure(invoice);
    const operationName = group === "operation" ? operationActName(invoice) : null;
    const serviceLabel = exactRegistrationService({
      group,
      classifiedLabel: registrationServiceLabel(group, label, invoice.visit?.patient?.service),
      recordedService: recordedRegistrationService(invoice),
      operationName,
    });
    const identity = registrationLineIdentity({
      group,
      serviceLabel,
      operationName,
      invoiceId: invoice.id,
    });
    const key = identity.key;
    const row: Accumulator = grouped.get(key) ?? {
      group,
      service: identity.service,
      serviceName: identity.serviceName,
      operationName: identity.operationName,
      qty: 0,
      amountFcfa: 0,
      doctorShareFcfa: 0,
      patientIds: new Set<string>(),
      doctorPercents: new Set<number>(),
      operationPercents: new Set<number>(),
      doctorNameSet: new Set<string>(),
    };
    if (group === "operation") {
      const doctorName = lineDoctorName(invoice, group);
      if (doctorName) row.doctorNameSet.add(doctorName);
    }

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
    .map(({ patientIds: _patientIds, doctorPercents, operationPercents, doctorNameSet, ...line }) => ({
      ...line,
      doctorNames: [...doctorNameSet].sort((a, b) => a.localeCompare(b, "fr", { sensitivity: "base" })),
      doctorPercent: uniquePercent(doctorPercents),
      operationPercent: uniquePercent(operationPercents),
    }))
    .sort((a, b) => a.service.localeCompare(b.service, "fr", { sensitivity: "base" }));
}
