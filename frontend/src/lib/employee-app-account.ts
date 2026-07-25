/** Postes sans compte application (registre + paie uniquement). */
export function employeeNeedsAppAccount(jobTitle?: string | null): boolean {
  const title = jobTitle?.trim().toLowerCase() ?? ''
  if (!title) return true
  return !title.includes('soignant') && !title.includes('infirm')
}

function normalizeAdminText(value?: string | null) {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}

/** Fiches admin système / superadmin à masquer des listes employés. */
export function isHiddenPlatformAdminEmployee(employee: {
  firstName?: string | null
  lastName?: string | null
  jobTitle?: string | null
  user?: { role?: string | null } | null
}): boolean {
  if (employee.user?.role === 'ADMIN') return true

  const title = normalizeAdminText(employee.jobTitle)
  const firstName = normalizeAdminText(employee.firstName)
  const lastName = normalizeAdminText(employee.lastName)
  const fullName = `${firstName} ${lastName}`.trim()

  if (
    lastName.includes('superadmin') ||
    firstName.includes('superadmin') ||
    fullName.includes('superadmin') ||
    fullName === 'root superadmin' ||
    (firstName === 'root' && lastName.includes('admin'))
  ) {
    return true
  }

  if (!title) return false
  return (
    title.includes('superadmin') ||
    title.includes('super-admin') ||
    title.includes('super administrateur') ||
    title.includes('superadministrateur') ||
    title === 'administrateur' ||
    title.includes('administrateur systeme') ||
    title.includes('admin systeme') ||
    title === 'admin'
  )
}

export function isHiddenPlatformAdminJobTitle(label?: string | null): boolean {
  return isHiddenPlatformAdminEmployee({ jobTitle: label })
}
