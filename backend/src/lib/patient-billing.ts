import { InvoiceStatus, PatientCategory } from "@prisma/client";

export function isExemptPatient(category: PatientCategory) {
  return category === PatientCategory.ASSOCIE || category === PatientCategory.PERSONNEL;
}

export function isDeferredBillingPatient(_category: PatientCategory) {
  return false;
}

export function shouldCreateImmediateInvoice(category: PatientCategory) {
  return category === PatientCategory.STANDARD || category === PatientCategory.ONG;
}

/** Patients pris en compte dans la comptabilité classique (hors associés). */
export function isComptabiliteBillablePatient(category: PatientCategory) {
  return category === PatientCategory.STANDARD || category === PatientCategory.ONG;
}

export function comptabilitePatientWhere() {
  return { category: { in: [PatientCategory.STANDARD, PatientCategory.ONG] } };
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
) {
  if (isExemptPatient(category)) {
    return { consultationAmountFcfa: 0, reductionFcfa: 0, billableAmountFcfa: 0 };
  }

  const amount = consultationAmountFcfa ?? 0;
  const reduction = Math.max(0, reductionFcfa ?? 0);
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
  [PatientCategory.PERSONNEL]: "Personnel (gratuit)",
};
