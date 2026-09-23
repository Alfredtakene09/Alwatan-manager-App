import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { formatFcfa, formatFcfaPlain, stripBidiMarks } from './format-fcfa.ts'
import { cellText } from './table-export-html.ts'

describe('formatFcfa export', () => {
  it('formatFcfa isole LTR pour l’écran, formatFcfaPlain et cellText restent lisibles dans Excel/Word', () => {
    const isolated = formatFcfa(450_000)
    assert.match(isolated, /\u2066/)
    assert.match(isolated, /\u2069/)
    assert.equal(stripBidiMarks(isolated), '450 000 FCFA')
    assert.equal(formatFcfaPlain(450_000), '450 000 FCFA')
    assert.equal(cellText(isolated), '450 000 FCFA')
    assert.doesNotMatch(cellText(isolated), /\u2066|\u2069/)
  })
})
