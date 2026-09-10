import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { LabFormPanel } from './lab-form-panels.ts'
import {
  buildCartEntriesForSelectedFields,
  extractBasePanelLabel,
  extractPrescribedFieldLabels,
  extractSelectedFieldsFromCart,
  extractSelectedFormLabels,
  formatPrescribedChipLabel,
  getPrescriptionCheckGroups,
} from './lab-prescribed-panels.ts'

const routinePanel: LabFormPanel = {
  slug: 'routine',
  label: 'Routine Investigation',
  sections: [
    {
      fields: [
        { key: 'crp', label: 'CRP', priceFcfa: 1500 },
        { key: 'hb', label: 'HB', priceFcfa: 1000 },
      ],
    },
    {
      title: 'Urine Analysis',
      priceFcfa: 4000,
      fields: [
        { key: 'urineColor', label: 'Colour' },
        { key: 'urineAlbumin', label: 'Albumin' },
      ],
    },
    {
      title: 'Disposite',
      fields: [
        { key: 'urinePusCells', label: 'Pus cells' },
        { key: 'urineRbcs', label: 'RBCs' },
      ],
    },
    {
      title: 'Stool General',
      priceFcfa: 3500,
      fields: [
        { key: 'stoolColor', label: 'Colour' },
        { key: 'stoolBlood', label: 'Blood' },
      ],
    },
    {
      title: 'Miscroscopic',
      fields: [
        { key: 'stoolPusCells', label: 'Pus cells' },
        { key: 'stoolOva', label: 'Ova' },
      ],
    },
  ],
}

describe('prescription labo groupes Routine liés', () => {
  const groups = getPrescriptionCheckGroups(routinePanel)

  it('fusionne Urine Analysis + Disposite en un seul groupe tarifé', () => {
    const urine = groups.find((group) => group.title === 'Urine Analysis')
    assert.ok(urine)
    assert.equal(urine.named, true)
    assert.equal(urine.hasUnitPrice, true)
    assert.equal(urine.fields.length, 4)
    assert.ok(urine.aliasTitles?.some((alias) => /disposit/i.test(alias)))
    assert.equal(groups.filter((group) => group.title === 'Disposite').length, 0)
  })

  it('fusionne Stool General + Miscroscopic en un seul groupe tarifé', () => {
    const stool = groups.find((group) => group.title === 'Stool General')
    assert.ok(stool)
    assert.equal(stool.hasUnitPrice, true)
    assert.equal(stool.fields.length, 4)
    assert.equal(groups.filter((group) => /miscro|micro/i.test(group.title)).length, 0)
  })

  it('encode le groupe urine comme une seule ligne panier', () => {
    const urine = groups.find((group) => group.title === 'Urine Analysis')
    assert.ok(urine)
    const lines = buildCartEntriesForSelectedFields(
      'Routine Investigation',
      groups,
      urine.fields.map((field) => field.key),
    )
    assert.deepEqual(lines, ['Routine Investigation (Urine Analysis)'])
    assert.equal(formatPrescribedChipLabel(lines[0]), 'Urine Analysis')
  })

  it('ré-étend Disposite (ancien libellé) vers tous les champs urine+deposit', () => {
    const urine = groups.find((group) => group.title === 'Urine Analysis')
    assert.ok(urine)
    const fields = extractSelectedFieldsFromCart(
      ['Routine Investigation (Disposite)'],
      'Routine Investigation',
      groups,
    )
    assert.deepEqual(fields, urine.fields.map((field) => field.key))
  })

  it('conserve le panel entier pour le tarif général Routine', () => {
    const allKeys = groups.flatMap((group) => group.fields.map((field) => field.key))
    const lines = buildCartEntriesForSelectedFields('Routine Investigation', groups, allKeys)
    assert.deepEqual(lines, ['Routine Investigation'])
  })

  it('laisse les champs hors section cochables un par un', () => {
    const main = groups.find((group) => group.title === 'Formulaire principal')
    assert.ok(main)
    assert.equal(main.named, false)
    assert.ok(main.fields.some((field) => field.hasUnitPrice))
  })
})

describe('libellés panel avec parenthèses (TFT, BHCG…)', () => {
  it('ne confond pas (TFT) avec une sélection de champs', () => {
    assert.equal(extractBasePanelLabel('Thyroid Hormones Test ( TFT)'), 'Thyroid Hormones Test ( TFT)')
    assert.equal(extractSelectedFormLabels('Thyroid Hormones Test ( TFT)'), null)
    assert.deepEqual(extractPrescribedFieldLabels('Thyroid Hormones Test ( TFT)'), [])
  })

  it('extrait T3/T4 après un libellé panel qui contient déjà des parenthèses', () => {
    const line = 'Thyroid Hormones Test ( TFT) (Formulaire principal: T3)'
    assert.equal(extractBasePanelLabel(line), 'Thyroid Hormones Test ( TFT)')
    assert.deepEqual(extractSelectedFormLabels(line), ['Formulaire principal: T3'])
    assert.deepEqual(extractPrescribedFieldLabels(line), ['T3'])
    assert.equal(formatPrescribedChipLabel(line), 'T3')
  })

  it('conserve Test de grossesse (BHCG) comme examen entier', () => {
    assert.equal(extractBasePanelLabel('Test de grossesse (BHCG)'), 'Test de grossesse (BHCG)')
    assert.equal(extractSelectedFormLabels('Test de grossesse (BHCG)'), null)
  })

  it('encode une sélection partielle thyroid sans casser le base label', () => {
    const thyroidPanel: LabFormPanel = {
      slug: 'thyroid',
      label: 'Thyroid Hormones Test ( TFT)',
      sections: [
        {
          fields: [
            { key: 't3', label: 'T3', priceFcfa: 10000 },
            { key: 't4', label: 'T4', priceFcfa: 10000 },
          ],
        },
      ],
    }
    const groups = getPrescriptionCheckGroups(thyroidPanel)
    const lines = buildCartEntriesForSelectedFields(
      'Thyroid Hormones Test ( TFT)',
      groups,
      ['field:t3'],
    )
    assert.deepEqual(lines, ['Thyroid Hormones Test ( TFT) (Formulaire principal: T3)'])
    assert.equal(extractBasePanelLabel(lines[0]), 'Thyroid Hormones Test ( TFT)')
    assert.deepEqual(extractPrescribedFieldLabels(lines[0]), ['T3'])
  })
})
