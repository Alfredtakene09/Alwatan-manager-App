import { InvoiceStatus, PatientCategory } from "@prisma/client";

export function isExemptPatient(category: PatientCategory) {
  return category === PatientCategory.ASSOCIE;
}

/** Réduction appliquée par défaut à tout le parcours d'un patient personnel. */
export const DEFAULT_STAFF_DISCOUNT_PERCENT = 20;

type DiscountablePatient = {
  category: PatientCategory;
  discountPercent?: number | null;
};

/** % de réduction du patient : celui de sa fiche, sinon 20 % pour le personnel, 0 sinon. */
export function patientDiscountPercent(patient: DiscountablePatient | null | undefined) {
  if (!patient || patient.category !== PatientCategory.PERSONNEL) return 0;
  const percent = patient.discountPercent ?? DEFAULT_STAFF_DISCOUNT_PERCENT;
  return Math.min(100, Math.max(0, Math.round(percent)));
}

/** Montant de la réduction personnel sur un montant brut. */
export function patientDiscountFcfa(
  patient: DiscountablePatient | null | undefined,
  grossFcfa: number,
) {
  const percent = patientDiscountPercent(patient);
  if (percent <= 0 || grossFcfa <= 0) return 0;
  return Math.round((grossFcfa * percent) / 100);
}

/**
 * Réduction effective : jamais moins que la réduction personnel (idempotent si le montant
 * déjà réduit est renvoyé), une réduction manuelle plus forte reste possible.
 */
export function withPatientDiscount(
  patient: DiscountablePatient | null | undefined,
  grossFcfa: number,
  requestedReductionFcfa: number,
) {
  const gross = Math.max(0, grossFcfa);
  const requested = Math.max(0, requestedReductionFcfa || 0);
  return Math.min(gross, Math.max(requested, patientDiscountFcfa(patient, gross)));
}

export function isDeferredBillingPatient(_category: PatientCategory) {
  return false;
}

/** Catégories facturées (le personnel paie avec sa réduction ; seuls les associés sont exonérés). */
const BILLABLE_CATEGORIES: PatientCategory[] = [
  PatientCategory.STANDARD,
  PatientCategory.ONG,
  PatientCategory.PERSONNEL,
];

export function shouldCreateImmediateInvoice(category: PatientCategory) {
  return BILLABLE_CATEGORIES.includes(category);
}

/** Patients pris en compte dans la comptabilité classique (hors associés). */
export function isComptabiliteBillablePatient(category: PatientCategory) {
  return BILLABLE_CATEGORIES.includes(category);
}

export function comptabilitePatientWhere() {
  return { category: { in: [...BILLABLE_CATEGORIES] } };
}

/** Dossiers actifs : les compteurs de patients ignorent les dossiers désactivés. */
export function countedPatientWhere(extra?: { service?: string }) {
  return {
    ...comptabilitePatientWhere(),
    active: true,
    ...(extra?.service ? { service: extra.service } : {}),
  };
}

/**
 * Recettes et solde de caisse.
 * Un dossier désactivé sort des montants non encaissés, mais sa somme déjà
 * encaissée reste. Une suppression de dossier retire aussi ses encaissements.
 */
export function comptabiliteInvoicePatientWhere() {
  const billable = comptabilitePatientWhere();
  const collected = {
    OR: [{ paidAmountFcfa: { gt: 0 } }, { status: InvoiceStatus.PAID }],
  };
  return {
    OR: [
      { patientId: null, ...collected },
      { patient: { ...billable, active: true } },
      { patient: { ...billable, active: false }, ...collected },
    ],
  };
}

export function resolveConsultationBilling(
  category: PatientCategory,
  consultationAmountFcfa?: number,
  reductionFcfa?: number,
  discountPercent?: number | null,
) {
  if (isExemptPatient(category)) {
    return { consultationAmountFcfa: 0, reductionFcfa: 0, billableAmountFcfa: 0 };
  }

  const amount = consultationAmountFcfa ?? 0;
  const reduction = withPatientDiscount({ category, discountPercent }, amount, reductionFcfa ?? 0);
  const billableAmountFcfa = Math.max(0, amount - reduction);

  return {
    consultationAmountFcfa: amount,
    reductionFcfa: reduction,
    billableAmountFcfa: shouldCreateImmediateInvoice(category) ? billableAmountFcfa : 0,
  };
}

/**
 * Changement de médecin à la réception : l'ancien montant est retiré.
 * On reprend le tarif de la nouvelle fiche, sauf si un autre montant a été saisi.
 */
export function resolveEditedConsultationAmount(input: {
  doctorChanged: boolean;
  configuredAmount: number;
  requestedAmount?: number | null;
  previousFee: number;
}): number | undefined {
  const requested =
    input.requestedAmount == null ? undefined : Math.max(0, Math.round(input.requestedAmount));
  if (!input.doctorChanged) return requested;
  const previous = Math.max(0, Math.round(input.previousFee || 0));
  const stale = requested == null || requested === previous;
  const configured = Math.max(0, Math.round(input.configuredAmount || 0));
  if (stale && configured > 0) return configured;
  return requested;
}

export const PATIENT_CATEGORY_LABELS: Record<PatientCategory, string> = {
  [PatientCategory.STANDARD]: "Standard",
  [PatientCategory.ASSOCIE]: "Associé / enfant (exonéré)",
  [PatientCategory.ONG]: "Standard",
  [PatientCategory.PERSONNEL]: "Personnel (réduction)",
};
