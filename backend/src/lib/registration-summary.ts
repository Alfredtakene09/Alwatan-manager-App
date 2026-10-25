import { ConsultationQuotaMode, InvoiceStatus, InvoiceType, Prisma, UserRole } from "@prisma/client";
import { prisma } from "./db.js";
import {
  classifyInvoiceForDayClosure,
  consultationServiceName,
  type DayClosureLineGroup,
} from "./day-closure-sales.js";
import {
  computeConsultationShares,
  doctorSurgeryQuotaPercent,
  doctorUsesQuota,
  resolveAssistantPercent,
  type DoctorProfile,
} from "./doctor-compensation.js";
import { collectedAmountFcfa } from "./surgery-cost-shares.js";
import { parsePrescribedExamsByKind, registrationExamQuantity } from "./lab-notes.js";

export { registrationExamQuantity };
import { registrationSummaryInvoiceWhere } from "./reception-scope.js";
import { extractExternalPatientService } from "./visit-external.js";

import { canonicalClinicServiceName, isOrthoTraumaServiceName, ORTHO_TRAUMA_SERVICE_NAME } from "./ortho-trauma-service.js";
import { formatBusinessDate } from "./cash-shift.js";

/**
 * Cumuls déjà imprimés du 14 sept. au 10 oct. 2026, part de Faiza comprise.
 * Le calcul encaissé (sans facture impayée, part clinique = argent reçu)
 * commence le 10 oct. pour Monera, puis pour tout le monde le 11 oct.
 */
const MONERA_RECEPTIONIST_ID = "cms68f3cz00g7u9y0eo6otc4j";
const COLLECTED_RULES_FOR_MONERA_FROM = "2026-10-10";
const COLLECTED_RULES_FOR_EVERYONE_FROM = "2026-10-11";

/** Orthopédie et traumatologie (y compris la graphie « Tromatologie ») sont un seul service. */
export const ORTHO_TRAUMA_SERVICE = ORTHO_TRAUMA_SERVICE_NAME;

export type RegistrationDoctorShare = {
  name: string;
  shareFcfa: number;
  /** null quand les opérations de la ligne n'ont pas toutes le même taux pour ce médecin. */
  percent: number | null;
};

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
  /** Opération : part de chaque médecin (chirurgien, anesthésiste), dans l'ordre de doctorNames. */
  doctorShares: RegistrationDoctorShare[];
  qty: number;
  amountFcfa: number;
  doctorShareFcfa: number;
  /** Reste clinique : montant de la ligne moins la part des médecins. */
  clinicShareFcfa: number;
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
  clinicService: { select: { name: true } },
  clinicServiceLinks: {
    select: { isDefault: true, clinicService: { select: { name: true } } },
  },
} satisfies Prisma.EmployeeSelect;

const doctorSelect = {
  select: { id: true, firstName: true, lastName: true, role: true, employee: { select: compensationSelect } },
} as const;

const summaryInvoiceSelect = {
  id: true,
  patientId: true,
  type: true,
  amountFcfa: true,
  paidAmountFcfa: true,
  status: true,
  createdAt: true,
  paidAt: true,
  issuedById: true,
  billingExamKind: true,
  payments: {
    select: { amountFcfa: true, paidAt: true },
  },
  surgeryCaseId: true,
  hospitalizationId: true,
  patient: { select: { createdAt: true, createdById: true } },
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
      anesthesiologistId: true,
      anesthesiologistPercent: true,
      anesthesiologist: doctorSelect,
      interventionType: {
        select: {
          label: true,
          surgeonPercent: true,
          anesthesiologistPercent: true,
          anesthesiologistName: true,
          anesthesiologist: doctorSelect,
          clinicService: { select: { name: true } },
        },
      },
    },
  },
} satisfies Prisma.InvoiceSelect;

type SummaryInvoice = Prisma.InvoiceGetPayload<{ select: typeof summaryInvoiceSelect }>;

const catalogOperationSelect = {
  label: true,
  surgeonPercent: true,
  anesthesiologistPercent: true,
  anesthesiologistName: true,
  anesthesiologist: doctorSelect,
  clinicService: { select: { name: true } },
} satisfies Prisma.InterventionTypeSelect;

type CatalogOperation = Prisma.InterventionTypeGetPayload<{ select: typeof catalogOperationSelect }>;

/** Facture d'opération hors bloc : le type d'acte porte le % anesthésiste. */
type PricedInvoice = SummaryInvoice & { catalogOperation?: CatalogOperation | null };

type RegistrationRuleInvoice = {
  type?: InvoiceType | null;
  billingExamKind?: string | null;
  createdAt?: Date | null;
  paidAt?: Date | null;
  issuedById?: string | null;
  payments?: Array<{ paidAt?: Date | null }>;
  patient?: { createdAt?: Date | null; createdById?: string | null } | null;
};

function latestPaymentAt(payments?: Array<{ paidAt?: Date | null }>): Date | null {
  return payments?.reduce<Date | null>(
    (latest, payment) =>
      payment.paidAt && (!latest || payment.paidAt > latest) ? payment.paidAt : latest,
    null,
  ) ?? null;
}

function registrationRuleDay(invoice: RegistrationRuleInvoice): string | null {
  const followsPayment =
    invoice.type === InvoiceType.SURGERY ||
    invoice.billingExamKind === "operation" ||
    invoice.billingExamKind === "examen" ||
    invoice.billingExamKind === "radio" ||
    invoice.billingExamKind === "echo" ||
    invoice.billingExamKind === "odonto";
  const paymentAt = latestPaymentAt(invoice.payments);
  const registeredAt =
    invoice.patient?.createdAt &&
    invoice.createdAt &&
    invoice.createdAt > invoice.patient.createdAt
      ? invoice.createdAt
      : invoice.patient?.createdAt ?? invoice.createdAt;
  const at = followsPayment
    ? invoice.paidAt ?? paymentAt ?? registeredAt
    : registeredAt;
  if (!at || Number.isNaN(at.getTime())) return null;
  return formatBusinessDate(at);
}

/** true : encaissement réel et part clinique = somme reçue. false : cumul déjà imprimé. */
export function usesCollectedRegistrationRules(invoice: RegistrationRuleInvoice): boolean {
  const day = registrationRuleDay(invoice);
  if (!day) return false;
  if (day >= COLLECTED_RULES_FOR_EVERYONE_FROM) return true;
  if (day < COLLECTED_RULES_FOR_MONERA_FROM) return false;
  const owner = invoice.patient?.createdById ?? "";
  const cashier = invoice.issuedById ?? "";
  return owner === MONERA_RECEPTIONIST_ID || cashier === MONERA_RECEPTIONIST_ID;
}

/**
 * Montant de la ligne.
 * À partir du 10 oct. pour Monera, puis du 11 oct. pour tous : uniquement le payé.
 * Avant : le montant facturé, comme sur les cumuls déjà imprimés.
 */
function summaryAmountFcfa(invoice: SummaryInvoice): number {
  const billed = Math.max(0, invoice.amountFcfa ?? 0);
  if (!usesCollectedRegistrationRules(invoice)) return billed;
  const paid = Math.max(0, invoice.paidAmountFcfa ?? 0);
  if (invoice.status === InvoiceStatus.CANCELLED) return 0;
  if (
    invoice.type === InvoiceType.LAB_EXAM &&
    invoice.billingExamKind &&
    invoice.payments.length > 0
  ) {
    const paymentAmount = invoice.payments.reduce((sum, payment) => sum + payment.amountFcfa, 0);
    if (paymentAmount > 0) return paymentAmount;
  }
  if (
    invoice.status === InvoiceStatus.PENDING ||
    invoice.status === InvoiceStatus.PARTIALLY_PAID
  ) {
    return paid;
  }
  return billed > 0 ? billed : paid;
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

type ExamCountInvoice = {
  id: string;
  patientId?: string | null;
  billingExamKind?: string | null;
  paidAt?: Date | null;
  createdAt?: Date | null;
  payments?: Array<{ paidAt?: Date | null }>;
  visit?: { consultation?: { clinicalNotes?: string | null } | null } | null;
};

/** Une seule facture porte la quantité quand plusieurs encaissements partagent les mêmes examens. */
export function examCountCarrierIds(invoices: ExamCountInvoice[]): Set<string> {
  const carriers = new Map<string, { id: string; at: number }>();
  for (const invoice of invoices) {
    if (registrationExamQuantity(invoice) == null) continue;
    const key = [
      invoice.patientId ?? invoice.id,
      invoice.billingExamKind ?? "",
      invoice.visit?.consultation?.clinicalNotes ?? "",
    ].join("\u0000");
    const at =
      latestPaymentAt(invoice.payments)?.getTime() ??
      invoice.paidAt?.getTime() ??
      invoice.createdAt?.getTime() ??
      0;
    const current = carriers.get(key);
    if (!current || at >= current.at) carriers.set(key, { id: invoice.id, at });
  }
  return new Set([...carriers.values()].map((row) => row.id));
}

function isCollectedExamInvoice(invoice: {
  status?: InvoiceStatus | null;
  paidAmountFcfa?: number | null;
  amountFcfa?: number | null;
}): boolean {
  if (invoice.status == null) return true;
  if (invoice.status === InvoiceStatus.PAID) return Math.max(0, invoice.amountFcfa ?? 0) > 0;
  if (invoice.status === InvoiceStatus.PARTIALLY_PAID) {
    return Math.max(0, invoice.paidAmountFcfa ?? 0) > 0;
  }
  return false;
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

/** Reste après la part des médecins. Les deux parts totalisent le montant. */
export function clinicRemainderFcfa(amountFcfa: number, doctorShareFcfa: number): number {
  return Math.max(0, amountFcfa - Math.max(0, doctorShareFcfa));
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
function surgeonOperationShare(invoice: PricedInvoice, amountFcfa: number): ShareResult {
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

  const catalogPercent =
    invoice.surgeryCase?.interventionType?.surgeonPercent ??
    invoice.catalogOperation?.surgeonPercent ??
    0;
  if (catalogPercent > 0) {
    return {
      shareFcfa: Math.round((amountFcfa * catalogPercent) / 100),
      percent: catalogPercent,
    };
  }
  return NO_SHARE;
}

/** Part anesthésiste (ex. AWAD 11 %), ajoutée à la part des médecins. */
function assistantOperationShare(invoice: PricedInvoice, amountFcfa: number): ShareResult {
  if (amountFcfa <= 0) return NO_SHARE;
  const surgery = invoice.surgeryCase;
  const type = surgery?.interventionType ?? invoice.catalogOperation ?? null;
  if (!type) return NO_SHARE;
  const recorded =
    surgery?.anesthesiologistPercent != null
      ? surgery.anesthesiologistPercent
      : type.anesthesiologistPercent;
  const profile =
    surgery?.anesthesiologistPercent != null ? surgery.anesthesiologist : type.anesthesiologist;
  const percent = resolveAssistantPercent(recorded, profile);
  if (percent <= 0) return NO_SHARE;
  return {
    shareFcfa: Math.round((amountFcfa * percent) / 100),
    percent,
  };
}

/**
 * Part des médecins sur une opération : chirurgien + anesthésiste.
 * La clinique conserve le reste.
 */
export function operationShare(invoice: PricedInvoice, amountFcfa: number): ShareResult {
  const surgeon = surgeonOperationShare(invoice, amountFcfa);
  const assistant = assistantOperationShare(invoice, amountFcfa);
  if (assistant.shareFcfa <= 0) return surgeon;
  const percent = (surgeon.percent ?? 0) + (assistant.percent ?? 0);
  return {
    shareFcfa: surgeon.shareFcfa + assistant.shareFcfa,
    percent: percent > 0 ? percent : null,
  };
}

function invoiceShare(
  invoice: PricedInvoice,
  group: DayClosureLineGroup,
  amountFcfa: number,
): ShareResult {
  if (group === "consultation") return consultationShare(invoice, amountFcfa);
  if (group === "operation") return operationShare(invoice, amountFcfa);
  return NO_SHARE;
}

type Accumulator = Omit<
  RegistrationSummaryLine,
  "doctorNames" | "doctorShares" | "doctorPercent" | "operationPercent"
> & {
  patientIds: Set<string>;
  doctorPercents: Set<number>;
  operationPercents: Set<number>;
  doctorNameSet: Set<string>;
  doctorShareMap: Map<string, { shareFcfa: number; percents: Set<number> }>;
};

function addDoctorShare(row: Accumulator, name: string, share: ShareResult) {
  if (!name || share.shareFcfa <= 0) return;
  const entry = row.doctorShareMap.get(name) ?? { shareFcfa: 0, percents: new Set<number>() };
  entry.shareFcfa += share.shareFcfa;
  if (share.percent != null) entry.percents.add(share.percent);
  row.doctorShareMap.set(name, entry);
}

/** Un seul taux dans la ligne : on l'affiche ; sinon la colonne reste vide. */
function uniquePercent(percents: Set<number>): number | null {
  return percents.size === 1 ? [...percents][0] : null;
}

export type RegistrationSummaryOptions = {
  /** Périmètre patients déjà calculé par l'appelant (dates, service, recherche). */
  patientWhere: Prisma.PatientWhereInput;
  /** Une réception : ses factures seulement, sans reprendre celles d'une autre caisse. */
  receptionistId?: string | null;
  /**
   * Jour exporté. Les opérations encaissées par une réception y entrent
   * à la date du paiement, pas à la date d'ouverture du dossier.
   */
  period?: { from: Date; to: Date } | null;
};

function foldServiceKey(label: string): string {
  return label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function isOrthoTraumaService(label: string): boolean {
  return isOrthoTraumaServiceName(label);
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
  return canonicalClinicServiceName(serviceLabel);
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
 * « Orthopédie & Tromatologie ». Les consultations de ces deux services
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
 * réunies sous « Orthopédie & Tromatologie ». Le reste suit le ticket de clôture.
 */
export type RegistrationActivityCounts = {
  consultationPatients: number;
  operationPatients: number;
  examPatients: number;
  hospitalizationPatients: number;
  radioPatients: number;
  echoPatients: number;
};

type RegistrationActivityKey = keyof RegistrationActivityPatientIds;

/** Radiologie et échographie ont leur propre carte ; le reste des examens va au laboratoire. */
function examActivityKey(label: string): "exam" | "radio" | "echo" {
  if (label === "Radiologie") return "radio";
  if (label === "Echographie") return "echo";
  return "exam";
}

function registrationActivityGroups(invoices: SummaryInvoice[]) {
  const patients: Record<RegistrationActivityKey, Set<string>> = {
    consultation: new Set<string>(),
    operation: new Set<string>(),
    exam: new Set<string>(),
    hospitalization: new Set<string>(),
    radio: new Set<string>(),
    echo: new Set<string>(),
  };
  const amounts: Record<RegistrationActivityKey, number> = {
    consultation: 0,
    operation: 0,
    exam: 0,
    hospitalization: 0,
    radio: 0,
    echo: 0,
  };

  for (const invoice of invoices) {
    const amountFcfa = consultationTariffAmount(invoice, summaryAmountFcfa(invoice));
    if (amountFcfa <= 0 || !invoice.patientId) continue;
    const { group, label } = classifyInvoiceForDayClosure(invoice);
    let key: RegistrationActivityKey;
    if (group === "consultation") key = "consultation";
    else if (group === "operation") key = "operation";
    else if (group === "hospitalization") key = "hospitalization";
    else if (isCollectedExamInvoice(invoice)) key = examActivityKey(label);
    else continue;
    patients[key].add(invoice.patientId);
    amounts[key] += amountFcfa;
  }

  return { patients, amounts };
}

/**
 * Patients des cartes d'enregistrement.
 * Une facture annulée, un montant nul, un dossier seulement notifié ou une
 * prescription sans facture ne comptent pas. Chaque facture va dans une seule carte.
 * Radiologie et échographie ont chacune leur carte, hors laboratoire.
 * Seuls les examens payés entrent dans ces cartes.
 */
function activityCounts(patients: Record<RegistrationActivityKey, Set<string>>): RegistrationActivityCounts {
  return {
    consultationPatients: patients.consultation.size,
    operationPatients: patients.operation.size,
    examPatients: patients.exam.size,
    hospitalizationPatients: patients.hospitalization.size,
    radioPatients: patients.radio.size,
    echoPatients: patients.echo.size,
  };
}

export function registrationActivityPatientCounts(
  invoices: SummaryInvoice[],
): RegistrationActivityCounts {
  return activityCounts(registrationActivityGroups(invoices).patients);
}

function catalogServiceMatches(recorded: string, typeService: string) {
  if (!recorded || !typeService) return false;
  if (foldServiceKey(recorded) === foldServiceKey(typeService)) return true;
  return isOrthoTraumaServiceName(recorded) && isOrthoTraumaServiceName(typeService);
}

function pickCatalogOperation(matches: CatalogOperation[], serviceName: string): CatalogOperation | null {
  if (!matches.length) return null;
  const linked = serviceName
    ? matches.filter((item) => catalogServiceMatches(serviceName, item.clinicService?.name ?? ""))
    : [];
  if (linked.length === 1) return linked[0]!;
  if (matches.length === 1) return matches[0]!;
  const withAssistant = (linked.length ? linked : matches).filter(
    (item) => (item.anesthesiologistPercent ?? 0) > 0 || item.anesthesiologist,
  );
  return withAssistant.length === 1 ? withAssistant[0]! : null;
}

/**
 * Opération facturée sans dossier bloc : le % anesthésiste est sur le type d'acte
 * (ex. Fracture de la Jambe, 11 %), pas sur une fiche chirurgie.
 */
async function withCatalogOperations(invoices: SummaryInvoice[]): Promise<PricedInvoice[]> {
  const labels = new Set<string>();
  for (const invoice of invoices) {
    if (invoice.surgeryCase?.interventionType || invoice.billingExamKind !== "operation") continue;
    const name = operationActName(invoice)?.trim();
    if (name) labels.add(name);
  }
  if (!labels.size) return invoices;

  const types = await prisma.interventionType.findMany({
    where: {
      OR: [...labels].map((label) => ({ label: { equals: label, mode: "insensitive" as const } })),
    },
    select: catalogOperationSelect,
  });

  return invoices.map((invoice) => {
    if (invoice.surgeryCase?.interventionType || invoice.billingExamKind !== "operation") return invoice;
    const name = operationActName(invoice)?.trim();
    if (!name) return invoice;
    const folded = foldServiceKey(name);
    const matches = types.filter((item) => foldServiceKey(item.label) === folded);
    const serviceName =
      invoice.visit?.assignedClinicService?.name?.trim() || recordedRegistrationService(invoice);
    const catalogOperation = pickCatalogOperation(matches, serviceName);
    return catalogOperation ? { ...invoice, catalogOperation } : invoice;
  });
}

async function loadRegistrationInvoices(options: RegistrationSummaryOptions) {
  const receptionistId = options.receptionistId?.trim() || "";
  const paymentWhere: Prisma.InvoicePaymentWhereInput = {
    recordedBy: { role: UserRole.RECEPTIONNISTE },
    ...(options.period
      ? { paidAt: { gte: options.period.from, lt: options.period.to } }
      : {}),
    ...(receptionistId ? { recordedById: receptionistId } : {}),
  };
  return prisma.invoice.findMany({
    where: registrationSummaryInvoiceWhere(options),
    select: {
      ...summaryInvoiceSelect,
      payments: {
        where: paymentWhere,
        select: { amountFcfa: true, paidAt: true },
      },
    },
  });
}

export type RegistrationActivityPatientIds = {
  consultation: string[];
  operation: string[];
  exam: string[];
  hospitalization: string[];
  radio: string[];
  echo: string[];
};

/** Montant encaissé de chaque carte d'enregistrement. */
export type RegistrationActivityAmounts = Record<keyof RegistrationActivityPatientIds, number>;

export async function buildRegistrationReport(options: RegistrationSummaryOptions): Promise<{
  lines: RegistrationSummaryLine[];
  activity: RegistrationActivityCounts;
  activityPatientIds: RegistrationActivityPatientIds;
  activityAmountsFcfa: RegistrationActivityAmounts;
}> {
  const invoices = await withCatalogOperations(await loadRegistrationInvoices(options));
  const { patients: groups, amounts } = registrationActivityGroups(invoices);
  return {
    lines: summarizeRegistrationInvoices(invoices),
    activity: activityCounts(groups),
    activityPatientIds: {
      consultation: [...groups.consultation],
      operation: [...groups.operation],
      exam: [...groups.exam],
      hospitalization: [...groups.hospitalization],
      radio: [...groups.radio],
      echo: [...groups.echo],
    },
    activityAmountsFcfa: amounts,
  };
}

export async function buildRegistrationSummary(
  options: RegistrationSummaryOptions,
): Promise<RegistrationSummaryLine[]> {
  return (await buildRegistrationReport(options)).lines;
}

function operationAssistantName(invoice: PricedInvoice): string {
  const surgery = invoice.surgeryCase;
  if (surgery?.anesthesiologistPercent != null) return doctorPlainName(surgery.anesthesiologist);
  return (
    doctorPlainName(surgery?.interventionType?.anesthesiologist) ||
    surgery?.interventionType?.anesthesiologistName?.trim() ||
    doctorPlainName(invoice.catalogOperation?.anesthesiologist) ||
    invoice.catalogOperation?.anesthesiologistName?.trim() ||
    ""
  );
}

/**
 * Avant le 11 oct. (et le 10 oct. hors Monera), une seconde consultation du
 * même médecin dans le même service ne s'ajoute pas : on garde la plus récente,
 * comme sur les feuilles déjà imprimées.
 */
function consultationsForSummary(invoices: PricedInvoice[]): PricedInvoice[] {
  const best = new Map<string, PricedInvoice>();
  const others: PricedInvoice[] = [];
  for (const invoice of invoices) {
    if (invoice.type !== InvoiceType.CONSULTATION || usesCollectedRegistrationRules(invoice)) {
      others.push(invoice);
      continue;
    }
    const service = consultationServiceName(invoice);
    const doctorId = invoice.visit?.assignedDoctor?.id ?? invoice.visit?.consultation?.doctor?.id ?? "";
    const key = `${invoice.patientId ?? invoice.id}\0${service}\0${doctorId}`;
    const current = best.get(key);
    const at = invoice.createdAt?.getTime() ?? 0;
    if (!current || at >= (current.createdAt?.getTime() ?? -1)) best.set(key, invoice);
  }
  return [...others, ...best.values()];
}

/** Regroupe les factures en lignes du cumul (exporté pour les tests). */
export function summarizeRegistrationInvoices(invoices: PricedInvoice[]): RegistrationSummaryLine[] {
  const grouped = new Map<string, Accumulator>();
  const rows = consultationsForSummary(invoices);
  const examCarriers = examCountCarrierIds(rows);

  for (const invoice of rows) {
    const collectedFcfa = summaryAmountFcfa(invoice);
    const amountFcfa = consultationTariffAmount(invoice, collectedFcfa);
    if (amountFcfa <= 0) continue;

    const { label, group } = classifyInvoiceForDayClosure(invoice);
    const isExamLine =
      group === "exam" || (group === "other" && invoice.type === InvoiceType.LAB_EXAM);
    if (isExamLine && !isCollectedExamInvoice(invoice)) continue;
    const operationName = group === "operation" ? operationActName(invoice) : null;
    const serviceLabel =
      group === "consultation"
        ? displayServiceName(consultationServiceName(invoice) || label)
        : exactRegistrationService({
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
      clinicShareFcfa: 0,
      patientIds: new Set<string>(),
      doctorPercents: new Set<number>(),
      operationPercents: new Set<number>(),
      doctorNameSet: new Set<string>(),
      doctorShareMap: new Map(),
    };
    const surgeonName = group === "operation" ? lineDoctorName(invoice, group) : "";
    const assistantName = group === "operation" ? operationAssistantName(invoice) : "";
    // Consultation : le médecin affiché est celui dont la part est calculée.
    const consultationDoctorName =
      group === "consultation" ? lineDoctorName(invoice, group) : "";
    if (surgeonName) row.doctorNameSet.add(surgeonName);
    if (assistantName) row.doctorNameSet.add(assistantName);
    if (consultationDoctorName) row.doctorNameSet.add(consultationDoctorName);

    const examQty = registrationExamQuantity(invoice);
    if (examQty != null) {
      if (examCarriers.has(invoice.id)) row.qty += examQty;
    } else {
      const patientKey = group === "operation" ? invoice.id : (invoice.patientId ?? invoice.id);
      if (!row.patientIds.has(patientKey)) {
        row.patientIds.add(patientKey);
        row.qty += 1;
      }
    }
    row.amountFcfa += amountFcfa;

    const shareBase =
      group === "operation"
        ? collectedAmountFcfa({
            paidAmountFcfa: invoice.paidAmountFcfa,
            amountFcfa,
            status: invoice.status,
          })
        : amountFcfa;
    const share = invoiceShare(invoice, group, shareBase);
    row.doctorShareFcfa += share.shareFcfa;
    if (group === "operation") {
      addDoctorShare(row, surgeonName, surgeonOperationShare(invoice, shareBase));
      addDoctorShare(row, assistantName, assistantOperationShare(invoice, shareBase));
    } else if (group === "consultation") {
      addDoctorShare(row, consultationDoctorName, share);
    }
    // Reste clinique : part médecins + part clinique = montant de la ligne.
    row.clinicShareFcfa += clinicRemainderFcfa(amountFcfa, share.shareFcfa);
    if (share.percent != null) {
      if (group === "operation") row.operationPercents.add(share.percent);
      else row.doctorPercents.add(share.percent);
    }

    grouped.set(key, row);
  }

  return [...grouped.values()]
    .map(
      ({
        patientIds: _patientIds,
        doctorPercents,
        operationPercents,
        doctorNameSet,
        doctorShareMap,
        ...line
      }) => {
        const doctorNames = [...doctorNameSet].sort((a, b) =>
          a.localeCompare(b, "fr", { sensitivity: "base" }),
        );
        return {
          ...line,
          doctorNames,
          doctorShares: doctorNames.flatMap((name) => {
            const entry = doctorShareMap.get(name);
            return entry
              ? [{ name, shareFcfa: entry.shareFcfa, percent: uniquePercent(entry.percents) }]
              : [];
          }),
          doctorPercent: uniquePercent(doctorPercents),
          operationPercent: uniquePercent(operationPercents),
        };
      },
    )
    .sort((a, b) => a.service.localeCompare(b.service, "fr", { sensitivity: "base" }));
}
