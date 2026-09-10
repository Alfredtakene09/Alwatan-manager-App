import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  matchReceptionReductionPercent,
  reductionFcfaFromPercent,
  RECEPTION_PATIENT_REDUCTION_PERCENTS,
} from './reception-reduction.ts'

describe('réductions réception 10 / 15 / 20 %', () => {
  it('calcule les montants FCFA sur le tarif consultation', () => {
    assert.equal(reductionFcfaFromPercent(5000, 10), 500)
    assert.equal(reductionFcfaFromPercent(5000, 15), 750)
    assert.equal(reductionFcfaFromPercent(5000, 20), 1000)
    assert.equal(reductionFcfaFromPercent(0, 10), 0)
  })

  it('reconnaît un pourcentage quand le FCFA correspond', () => {
    assert.equal(matchReceptionReductionPercent(10_000, 1000), 10)
    assert.equal(matchReceptionReductionPercent(10_000, 1500), 15)
    assert.equal(matchReceptionReductionPercent(10_000, 2000), 20)
    assert.equal(matchReceptionReductionPercent(10_000, 300), null)
  })

  it('expose uniquement 10, 15 et 20', () => {
    assert.deepEqual([...RECEPTION_PATIENT_REDUCTION_PERCENTS], [10, 15, 20])
  })
})
