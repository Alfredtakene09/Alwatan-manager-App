import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { listEmployeeExportRows, payrollOfExportRow } from './employee-list-export.ts'

describe('listEmployeeExportRows', () => {
  it('liste un employé actif par ligne, sans regroupement, avec effectif et masse salariale', () => {
    const rows = [
      { id: '2', name: 'Béatrice', jobTitle: 'Infirmier', salaryExportValue: 200_000 },
      { id: '3', name: 'Dr Camara', jobTitle: 'Médecin', salaryExportValue: 400_000 },
      { id: '1', name: 'Ahmed', jobTitle: 'Infirmier', salaryExportValue: 150_000 },
      { id: '4', name: 'Inactif', jobTitle: 'Médecin', salaryExportValue: 400_000 },
    ]
    const employeesById = new Map([
      ['1', { active: true }],
      ['2', { active: true }],
      ['3', { active: true, user: { active: true } }],
      ['4', { active: false }],
    ])
    const list = listEmployeeExportRows(rows, employeesById)
    assert.deepEqual(
      list.rows.map((r) => r.name),
      ['Ahmed', 'Béatrice', 'Dr Camara'],
    )
    assert.equal(list.totalCount, 3)
    assert.equal(list.totalPayroll, 750_000)
  })

  it('n’exporte aucun employé inactif', () => {
    const list = listEmployeeExportRows(
      [{ id: '4', name: 'Inactif', jobTitle: 'Médecin', salaryExportValue: 400_000 }],
      new Map([['4', { active: false }]]),
    )
    assert.equal(list.rows.length, 0)
    assert.equal(list.totalCount, 0)
    assert.equal(list.totalPayroll, 0)
  })

  it('exclut du payroll un compte application désactivé', () => {
    const row = { id: '1', name: 'X', jobTitle: 'Caissier', salaryExportValue: 100_000 }
    assert.equal(payrollOfExportRow(row, { active: true, user: { active: false } }), 0)
    assert.equal(payrollOfExportRow(row, { active: true }), 100_000)
  })
})
