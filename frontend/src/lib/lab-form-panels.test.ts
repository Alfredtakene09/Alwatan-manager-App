import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  deriveNamedSectionPriceFcfa,
  isNamedLabSectionTitle,
} from './lab-form-panels.ts'

describe('sections laboratoire', () => {
  it('reconnaît une section nommée (urine) et ignore le formulaire principal', () => {
    assert.equal(isNamedLabSectionTitle('Urine General'), true)
    assert.equal(isNamedLabSectionTitle('Formulaire principal'), false)
    assert.equal(isNamedLabSectionTitle(''), false)
    assert.equal(isNamedLabSectionTitle(undefined), false)
  })

  it('dérive le tarif de section : un seul prix, ou la somme des prix hérités', () => {
    assert.equal(deriveNamedSectionPriceFcfa([{ priceFcfa: 4000 }, { priceFcfa: null }]), 4000)
    assert.equal(deriveNamedSectionPriceFcfa([{ priceFcfa: 1500 }, { priceFcfa: 2500 }]), 4000)
    assert.equal(deriveNamedSectionPriceFcfa([{ priceFcfa: 0 }, {}]), undefined)
  })
})
