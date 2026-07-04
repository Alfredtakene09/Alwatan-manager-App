import { PatientCategory } from "@prisma/client";

export function isExemptPatient(category: PatientCategory) {
  return category === PatientCategory.ASSOCIE;
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

export function comptabiliteInvoicePatientWhere() {
  return { patient: comptabilitePatientWhere() };
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

export const PATIENT_CATEGORY_LABELS: Record<PatientCategory, string> = {
  [PatientCategory.STANDARD]: "Standard",
  [PatientCategory.ASSOCIE]: "Associé / enfant (exonéré)",
  [PatientCategory.ONG]: "Standard",
};
