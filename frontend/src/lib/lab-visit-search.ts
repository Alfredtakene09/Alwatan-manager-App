import { fullName } from '@/lib/roles'
import { formatLabPrescribedExamsSummary } from '@/lib/lab-notes'
import { matchesPatientSearch } from '@/lib/patient-search'

type LabVisitSearchRow = {
  patient: {
    code: string
    firstName: string
    lastName: string
    phone?: string | null
    ongName?: string | null
  }
  consultation?: {
    clinicalNotes?: string | null
    doctor?: { firstName: string; lastName: string } | null
  } | null
  assignedDoctor?: { firstName: string; lastName: string } | null
}

export function matchesLabVisitSearch(visit: LabVisitSearchRow, query: string) {
  const q = query.trim()
  if (!q) return true

  if (
    matchesPatientSearch(
      {
        code: visit.patient.code,
        firstName: visit.patient.firstName,
        lastName: visit.patient.lastName,
        phone: visit.patient.phone,
      },
      q,
    )
  ) {
    return true
  }

  const exams = formatLabPrescribedExamsSummary(visit.consultation?.clinicalNotes).toLowerCase()
  const doctor = visit.consultation?.doctor ?? visit.assignedDoctor
  const doctorName = doctor ? fullName(doctor.firstName, doctor.lastName).toLowerCase() : ''
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean)

  const haystack = [exams, doctorName, visit.patient.ongName ?? ''].join(' ').toLowerCase()
  return terms.every((term) => haystack.includes(term))
}

export function panelFormHasValues(values: Record<string, string>) {
  return Object.values(values).some((value) => value.trim().length > 0)
}
