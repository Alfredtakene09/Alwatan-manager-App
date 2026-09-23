import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { groupEmployeeExportRows, payrollOfExportRow } from './employee-list-export.ts'

describe('groupEmployeeExportRows', () => {
  it('regroupe par poste les actifs seulement, masse salariale, puis total général', () => {
    const rows = [
      { id: '2', name: 'Béatrice', jobTitle: 'Infirmier', salaryExportValue: 200_000 },
      { id: '1', name: 'Ahmed', jobTitle: 'Infirmier', salaryExportValue: 150_000 },
      { id: '3', name: 'Dr Camara', jobTitle: 'Médecin', salaryExportValue: 400_000 },
      { id: '4', name: 'Inactif', jobTitle: 'Médecin', salaryExportValue: 400_000 },
    ]
    const employeesById = new Map([
      ['1', { active: true }],
      ['2', { active: true }],
      ['3', { active: true, user: { active: true } }],
      ['4', { active: false }],
    ])
    const grouped = groupEmployeeExportRows(rows, employeesById)
    assert.equal(grouped.groups.length, 2)
    assert.equal(grouped.groups[0].jobTitle, 'Infirmier')
    assert.deepEqual(
      grouped.groups[0].rows.map((r) => r.name),
      ['Ahmed', 'Béatrice'],
    )
    assert.equal(grouped.groups[0].count, 2)
    assert.equal(grouped.groups[0].payroll, 350_000)
    assert.equal(grouped.groups[1].jobTitle, 'Médecin')
    assert.equal(grouped.groups[1].count, 1)
    assert.deepEqual(
      grouped.groups[1].rows.map((r) => r.name),
      ['Dr Camara'],
    )
    assert.equal(grouped.groups[1].payroll, 400_000)
    assert.equal(grouped.totalCount, 3)
    assert.equal(grouped.totalPayroll, 750_000)
  })

  it('n’exporte pas un poste dont tous les employés sont inactifs', () => {
    const grouped = groupEmployeeExportRows(
      [{ id: '4', name: 'Inactif', jobTitle: 'Médecin', salaryExportValue: 400_000 }],
      new Map([['4', { active: false }]]),
    )
    assert.equal(grouped.groups.length, 0)
    assert.equal(grouped.totalCount, 0)
    assert.equal(grouped.totalPayroll, 0)
  })

  it('exclut du payroll un compte application désactivé', () => {
    const row = { id: '1', name: 'X', jobTitle: 'Caissier', salaryExportValue: 100_000 }
    assert.equal(payrollOfExportRow(row, { active: true, user: { active: false } }), 0)
    assert.equal(payrollOfExportRow(row, { active: true }), 100_000)
  })
})
