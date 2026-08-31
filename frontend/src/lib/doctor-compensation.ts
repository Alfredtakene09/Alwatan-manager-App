import { formatFcfa } from '@/lib/format-fcfa'

export type DoctorCompensationType = 'QUOTA' | 'FIXED_SALARY' | 'COMBINED'
export type ConsultationQuotaMode = 'PERCENT' | 'FIXED_AMOUNT'
export type ConsultationRenewalPolicy = 'FULL' | 'HALF'

export type DoctorOption = {
  id: string
  firstName: string
  lastName: string
  acceptingPatients?: boolean
  specialty?: string | null
  service?: string | null
  clinicServiceId?: string | null
  clinicService?: { id: string; name: string } | null
  clinicServiceIds?: string[]
  clinicServices?: { id: string; name: string; isDefault?: boolean }[]
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
    hint: 'Salaire mensuel + prix de consultation (optionnel)',
  },
  {
    value: 'COMBINED',
    label: 'Salaire + quota',
    hint: 'Salaire mensuel et part sur les consultations',
  },
]

export function doctorUsesQuotaCompensationType(type?: DoctorCompensationType | null) {
  return type === 'QUOTA' || type === 'COMBINED'
}

export function doctorUsesSalaryCompensationType(type?: DoctorCompensationType | null) {
  return type === 'FIXED_SALARY' || type === 'COMBINED'
}

export const CONSULTATION_QUOTA_MODE_OPTIONS: {
  value: ConsultationQuotaMode
  label: string
}[] = [
  { value: 'PERCENT', label: '%' },
  { value: 'FIXED_AMOUNT', label: 'Montant (FCFA)' },
]

export function doctorUsesQuotaCompensation(doctor?: DoctorOption | null) {
  return doctorUsesQuotaCompensationType(doctor?.doctorCompensationType)
}

export function doctorIsFixedSalary(doctor?: DoctorOption | null) {
  return doctor?.doctorCompensationType === 'FIXED_SALARY'
}

export function doctorUsesSalaryCompensation(doctor?: DoctorOption | null) {
  return doctorUsesSalaryCompensationType(doctor?.doctorCompensationType)
}

export function doctorRequiresConsultationFee(doctor?: DoctorOption | null) {
  if (!doctor) return true
  if (doctor.requiresConsultationFee != null) return doctor.requiresConsultationFee
  if (doctorUsesQuotaCompensation(doctor)) return true
  // Salaire fixe : facturer dès qu’un tarif patient est renseigné
  return (doctor.consultationTotalFcfa ?? 0) > 0
}

/** Médecin avec tarif consultation configuré → affichage automatique à la réception. */
export function doctorShowsFixedConsultationPrice(doctor?: DoctorOption | null) {
  return (doctor?.consultationTotalFcfa ?? 0) > 0
}

/** Quota/salaire sans tarif → saisie manuelle du montant. */
export function doctorNeedsConsultationAmountInput(doctor?: DoctorOption | null) {
  if (!doctor) return true
  if ((doctor.consultationTotalFcfa ?? 0) > 0) return false
  return doctorIsFixedSalary(doctor) || doctorUsesQuotaCompensation(doctor)
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
    return formatFcfa(doctor.consultationQuotaFcfa)
  }
  if (doctor.consultationQuotaPercent != null) {
    return `${doctor.consultationQuotaPercent}%`
  }
  return '—'
}

/** Libellé complémentaire dans les <select> médecin — volontairement vide (nom seul). */
export function doctorSelectSuffix(_doctor: DoctorOption) {
  return ''
}

export function doctorServiceName(doctor?: DoctorOption | null) {
  return doctor?.clinicService?.name ?? doctor?.service ?? null
}

/** Noms de tous les services liés au médecin (défaut + additionnels). */
export function doctorClinicServiceNames(doctor?: DoctorOption | null): string[] {
  if (doctor?.clinicServices?.length) {
    return doctor.clinicServices.map((service) => service.name)
  }
  const single = doctorServiceName(doctor)
  return single ? [single] : []
}

export function doctorMatchesService(
  doctor: DoctorOption | null | undefined,
  serviceName: string | null | undefined,
) {
  if (!serviceName) return true
  return doctorClinicServiceNames(doctor).some((name) => name === serviceName)
}

/** Filtre médecins par id de service clinique (défaut + services liés). */
export function doctorMatchesClinicServiceId(
  doctor: DoctorOption | null | undefined,
  clinicServiceId: string | null | undefined,
) {
  if (!clinicServiceId) return true
  if (doctor?.clinicServices?.length) {
    return doctor.clinicServices.some((service) => service.id === clinicServiceId)
  }
  return doctor?.clinicServiceId === clinicServiceId || doctor?.clinicService?.id === clinicServiceId
}

/** Tri réception : A→Z. */
export function sortDoctorsForReception(doctors: DoctorOption[]) {
  return [...doctors].sort((a, b) => {
    const byLast = a.lastName.localeCompare(b.lastName, 'fr', { sensitivity: 'base' })
    if (byLast !== 0) return byLast
    return a.firstName.localeCompare(b.firstName, 'fr', { sensitivity: 'base' })
  })
}

/** Préfère le médecin courant s’il est encore dans la liste, sinon le premier. */
export function preferredDoctorId(
  doctors: DoctorOption[],
  currentId?: string | null,
) {
  if (currentId && doctors.some((doctor) => doctor.id === currentId)) return currentId
  return doctors[0]?.id ?? ''
}

export function defaultConsultationAmountForDoctor(doctor?: DoctorOption | null) {
  if (!doctor) return 0
  // Tarif patient configuré (quota, combiné ou salaire fixe)
  return Math.max(0, Number(doctor.consultationTotalFcfa) || 0)
}

export function doctorQuotaHint(doctor?: DoctorOption | null, amount?: number) {
  if (!doctor || doctorIsFixedSalary(doctor)) return null
  const total = amount && amount > 0 ? amount : doctor.consultationTotalFcfa
  if (!total) return null
  const { doctorShareFcfa, clinicShareFcfa } = computeDoctorConsultationShares(total, doctor)
  const quotaLabel = formatDoctorQuotaShare(doctor)
  return `Total ${formatFcfa(total)} — part médecin ${quotaLabel} (${formatFcfa(doctorShareFcfa)}), clinique ${formatFcfa(clinicShareFcfa)}`
}
