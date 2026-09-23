export type EmployeeExportSource = {
  id: string
  name: string
  jobTitle: string
  salaryExportValue: number | ''
}

export type EmployeePayrollGuard = {
  active?: boolean
  user?: { active?: boolean } | null
}

export type EmployeeJobGroup<T extends EmployeeExportSource = EmployeeExportSource> = {
  jobTitle: string
  rows: T[]
  count: number
  payroll: number
}

export function employeeIncludedInExport(employee: EmployeePayrollGuard | undefined): boolean {
  return Boolean(employee?.active)
}

export function salaryCountsTowardPayroll(employee: EmployeePayrollGuard | undefined): boolean {
  if (!employeeIncludedInExport(employee)) return false
  if (employee?.user && !employee.user.active) return false
  return true
}

export function payrollOfExportRow(
  row: EmployeeExportSource,
  employee: EmployeePayrollGuard | undefined,
): number {
  if (!salaryCountsTowardPayroll(employee)) return 0
  return typeof row.salaryExportValue === 'number' ? row.salaryExportValue : 0
}

/** Regroupe la liste exportée par poste : effectif, masse (salaires fixes actifs), ordre alphabétique. */
export function groupEmployeeExportRows<T extends EmployeeExportSource>(
  rows: T[],
  employeesById: Map<string, EmployeePayrollGuard>,
): { groups: EmployeeJobGroup<T>[]; totalCount: number; totalPayroll: number } {
  const byTitle = new Map<string, T[]>()
  for (const row of rows) {
    if (!employeeIncludedInExport(employeesById.get(row.id))) continue
    const key = row.jobTitle.trim() || '—'
    const list = byTitle.get(key)
    if (list) list.push(row)
    else byTitle.set(key, [row])
  }

  const groups = [...byTitle.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'fr', { sensitivity: 'base' }))
    .map(([jobTitle, groupRows]) => {
      const sorted = [...groupRows].sort((a, b) =>
        a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }),
      )
      const payroll = sorted.reduce(
        (sum, row) => sum + payrollOfExportRow(row, employeesById.get(row.id)),
        0,
      )
      return { jobTitle, rows: sorted, count: sorted.length, payroll }
    })

  return {
    groups,
    totalCount: groups.reduce((sum, group) => sum + group.count, 0),
    totalPayroll: groups.reduce((sum, group) => sum + group.payroll, 0),
  }
}
