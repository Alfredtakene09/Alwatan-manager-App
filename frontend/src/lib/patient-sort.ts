type SortablePatient = {
  createdAt?: string | Date | null
  code?: string
}

function patSequence(code?: string): number {
  if (!code) return 0
  const match = code.match(/(\d+)\s*$/)
  return match ? Number(match[1]) : 0
}

function createdAtMs(value?: string | Date | null): number {
  if (!value) return 0
  const ms = new Date(value).getTime()
  return Number.isFinite(ms) ? ms : 0
}

/** Dernier inscrit en premier — tri par date d'inscription puis matricule. */
export function sortPatientsNewestFirst<T extends SortablePatient>(patients: T[]): T[] {
  return [...patients].sort((a, b) => {
    const byDate = createdAtMs(b.createdAt) - createdAtMs(a.createdAt)
    if (byDate !== 0) return byDate
    return patSequence(b.code) - patSequence(a.code)
  })
}

type VisitWithPatient = {
  patient: SortablePatient
}

export function sortVisitsByPatientNewestFirst<T extends VisitWithPatient>(visits: T[]): T[] {
  return [...visits].sort((a, b) => {
    const byDate = createdAtMs(b.patient.createdAt) - createdAtMs(a.patient.createdAt)
    if (byDate !== 0) return byDate
    return patSequence(b.patient.code) - patSequence(a.patient.code)
  })
}

/** Dernier enregistrement en premier (visites, factures, etc.). */
export function sortByCreatedAtNewestFirst<T extends { createdAt?: string | Date | null }>(
  items: T[],
): T[] {
  return [...items].sort((a, b) => createdAtMs(b.createdAt) - createdAtMs(a.createdAt))
}
