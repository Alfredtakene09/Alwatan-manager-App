export type DoctorCompensationType = 'QUOTA' | 'FIXED_SALARY'
export type ConsultationQuotaMode = 'PERCENT' | 'FIXED_AMOUNT'
export type ConsultationRenewalPolicy = 'FULL' | 'HALF'

export type DoctorOption = {
  id: string
  firstName: string
  lastName: string
  doctorCompensationType?: DoctorCompensationType
  consultationTotalFcfa?: number | null
  consultationQuotaMode?: ConsultationQuotaMode
  consultationQuotaPercent?: number | null
  consultationQuotaFcfa?: number | null
  consultationValidityDays?: number | null
  consultationRenewalPolicy?: ConsultationRenewalPolicy | null
  doctorConsultationShareFcfa?: number | null
  requiresConsultationFee?: boolean
}

export type ConsultationRenewalPreview = {
  amountFcfa: number
  baseAmountFcfa: number
  withinValidity: boolean
  renewalRequired: boolean
  daysSinceLastPaid: number | null
  validityDays: number | null
  renewalPolicy: ConsultationRenewalPolicy | null
  lastPaidAt: string | null
  message: string
}

export const CONSULTATION_VALIDITY_OPTIONS = [
  { value: 15, label: '15 jours' },
  { value: 30, label: '30 jours' },
] as const

export const CONSULTATION_RENEWAL_POLICY_OPTIONS: {
  value: ConsultationRenewalPolicy
  label: string
  hint: string
}[] = [
  {
    value: 'FULL',
    label: 'Renouvellement plein tarif',
    hint: 'Après expiration, le patient paie le prix complet',
  },
  {
    value: 'HALF',
    label: 'Renouvellement à 50 %',
    hint: 'Après expiration, le patient paie la moitié du prix',
  },
]

export const DOCTOR_COMPENSATION_OPTIONS: {
  value: DoctorCompensationType
  label: string
  hint: string
}[] = [
  {
    value: 'QUOTA',
    label: 'Quota',
    hint: 'Tarif consultation fixe + part médecin (% ou montant)',
  },
  {
    value: 'FIXED_SALARY',
    label: 'Salaire fixe',
    hint: 'Montant consultation saisi à la réception',
  },
]

export const CONSULTATION_QUOTA_MODE_OPTIONS: {
  value: ConsultationQuotaMode
  label: string
}[] = [
  { value: 'PERCENT', label: '%' },
  { value: 'FIXED_AMOUNT', label: 'Montant (FCFA)' },
]

export function doctorUsesQuotaCompensation(doctor?: DoctorOption | null) {
  return doctor?.doctorCompensationType === 'QUOTA'
}

export function doctorIsFixedSalary(doctor?: DoctorOption | null) {
  return doctor?.doctorCompensationType === 'FIXED_SALARY'
}

export function doctorRequiresConsultationFee(doctor?: DoctorOption | null) {
  if (!doctor) return true
  if (doctor.requiresConsultationFee != null) return doctor.requiresConsultationFee
  return doctorUsesQuotaCompensation(doctor)
}

/** Médecin quota avec tarif consultation configuré → affichage automatique à la réception. */
export function doctorShowsFixedConsultationPrice(doctor?: DoctorOption | null) {
  return doctorUsesQuotaCompensation(doctor) && (doctor?.consultationTotalFcfa ?? 0) > 0
}

/** Salaire fixe ou quota sans tarif → saisie manuelle du montant. */
export function doctorNeedsConsultationAmountInput(doctor?: DoctorOption | null) {
  if (doctorIsFixedSalary(doctor)) return true
  if (doctorUsesQuotaCompensation(doctor) && !(doctor?.consultationTotalFcfa ?? 0)) return true
  return false
}

/** Afficher prix fixe ou champ de saisie à la réception. */
export function showDoctorConsultationBilling(doctor?: DoctorOption | null) {
  if (!doctor) return false
  return doctorShowsFixedConsultationPrice(doctor) || doctorNeedsConsultationAmountInput(doctor)
}

export function resolveConsultationAmountForDoctor(
  doctor: DoctorOption | null | undefined,
  enteredAmount: number,
) {
  if (doctorShowsFixedConsultationPrice(doctor)) {
    return defaultConsultationAmountForDoctor(doctor)
  }
  return enteredAmount
}

export function doctorConsultationBillingValid(
  doctor: DoctorOption | null | undefined,
  enteredAmount: number,
) {
  if (!showDoctorConsultationBilling(doctor)) return true
  return resolveConsultationAmountForDoctor(doctor, enteredAmount) > 0
}

export function doctorCompensationLabel(type?: DoctorCompensationType) {
  return (
    DOCTOR_COMPENSATION_OPTIONS.find((item) => item.value === type)?.label ??
    DOCTOR_COMPENSATION_OPTIONS[0].label
  )
}

export function computeDoctorConsultationShares(
  totalFcfa: number,
  doctor: Pick<
    DoctorOption,
    'consultationQuotaMode' | 'consultationQuotaPercent' | 'consultationQuotaFcfa'
  >,
) {
  if (totalFcfa <= 0) {
    return { doctorShareFcfa: 0, clinicShareFcfa: 0 }
  }
  if (
    doctor.consultationQuotaMode === 'FIXED_AMOUNT' &&
    doctor.consultationQuotaFcfa != null &&
    doctor.consultationQuotaFcfa >= 0
  ) {
    const doctorShareFcfa = Math.min(doctor.consultationQuotaFcfa, totalFcfa)
    return {
      doctorShareFcfa,
      clinicShareFcfa: totalFcfa - doctorShareFcfa,
    }
  }
  const quota = doctor.consultationQuotaPercent ?? 0
  const doctorShareFcfa = Math.round((totalFcfa * quota) / 100)
  return {
    doctorShareFcfa,
    clinicShareFcfa: totalFcfa - doctorShareFcfa,
  }
}

export function formatDoctorQuotaShare(doctor: DoctorOption) {
  if (doctor.consultationQuotaMode === 'FIXED_AMOUNT' && doctor.consultationQuotaFcfa != null) {
    return `${doctor.consultationQuotaFcfa.toLocaleString('fr-FR')} FCFA`
  }
  if (doctor.consultationQuotaPercent != null) {
    return `${doctor.consultationQuotaPercent}%`
  }
  return '—'
}

export function doctorSelectSuffix(doctor: DoctorOption) {
  if (doctorIsFixedSalary(doctor)) return ' — salaire fixe'
  const total = doctor.consultationTotalFcfa
  const validity =
    doctor.consultationValidityDays != null
      ? ` · val. ${doctor.consultationValidityDays}j`
      : ''
  if (total && total > 0) {
    const share =
      doctor.doctorConsultationShareFcfa ??
      computeDoctorConsultationShares(total, doctor).doctorShareFcfa
    const quotaLabel = formatDoctorQuotaShare(doctor)
    return ` — ${total.toLocaleString('fr-FR')} FCFA (part ${quotaLabel} · ${share.toLocaleString('fr-FR')} FCFA)${validity}`
  }
  return ` — quota${validity}`
}

export function defaultConsultationAmountForDoctor(doctor?: DoctorOption | null) {
  if (!doctor || doctorIsFixedSalary(doctor)) return 0
  return doctor.consultationTotalFcfa ?? 0
}

export function doctorQuotaHint(doctor?: DoctorOption | null, amount?: number) {
  if (!doctor || doctorIsFixedSalary(doctor)) return null
  const total = amount && amount > 0 ? amount : doctor.consultationTotalFcfa
  if (!total) return null
  const { doctorShareFcfa, clinicShareFcfa } = computeDoctorConsultationShares(total, doctor)
  const quotaLabel = formatDoctorQuotaShare(doctor)
  return `Total ${total.toLocaleString('fr-FR')} FCFA — part médecin ${quotaLabel} (${doctorShareFcfa.toLocaleString('fr-FR')} FCFA), clinique ${clinicShareFcfa.toLocaleString('fr-FR')} FCFA`
}
