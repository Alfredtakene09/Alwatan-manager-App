export type PatientSearchFields = {
  code?: string
  firstName?: string
  lastName?: string
  phone?: string | null
}

/** Filtre local : matricule, nom, prénom, téléphone (plusieurs mots acceptés). */
export function matchesPatientSearch(fields: PatientSearchFields, query: string): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return true

  const haystack = [
    fields.code,
    fields.firstName,
    fields.lastName,
    `${fields.firstName ?? ''} ${fields.lastName ?? ''}`.trim(),
    fields.phone,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  return terms.every((term) => haystack.includes(term))
}
