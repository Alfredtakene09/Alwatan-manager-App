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

/** Liste exportée : un employé actif par ligne (ordre alphabétique), effectif et masse (salaires fixes actifs). */
export function listEmployeeExportRows<T extends EmployeeExportSource>(
  rows: T[],
  employeesById: Map<string, EmployeePayrollGuard>,
): { rows: T[]; totalCount: number; totalPayroll: number } {
  const sorted = rows
    .filter((row) => employeeIncludedInExport(employeesById.get(row.id)))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }))
  return {
    rows: sorted,
    totalCount: sorted.length,
    totalPayroll: sorted.reduce(
      (sum, row) => sum + payrollOfExportRow(row, employeesById.get(row.id)),
      0,
    ),
  }
}
