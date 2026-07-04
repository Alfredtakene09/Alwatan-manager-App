/** Postes sans compte application (registre + paie uniquement). */
export function employeeNeedsAppAccount(jobTitle?: string | null): boolean {
  const title = jobTitle?.trim().toLowerCase() ?? ''
  if (!title) return true
  return !title.includes('soignant') && !title.includes('infirm')
}
