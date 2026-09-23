import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildClassicStoolUrineModel,
  renderClassicStoolUrineTable,
  LAB_CLASSIC_SHEET_STYLES,
} from './lab-classic-sheet-print.ts'

const urineAndStool: Record<string, string> = {
  urineColor: 'Yellow',
  urineReaction: 'Acidic',
  urineAlbumin: 'NIL',
  urineSugar: 'NIL',
  urinePusCells: '4--6',
  urineRbcs: '3--5',
  urineCrystals: 'A.Urate ++++',
  stoolColor: 'Brown',
  stoolReaction: 'Acidic',
  stoolConsistency: 'Soft',
  stoolMucus: 'Absent',
  stoolPusCells: '2--4',
  stoolYeast: 'Absent',
  stoolUndigested: 'Absent',
  hb: '10.4',
  crp: 'Positive (+ve)',
  fbg: '95',
  urineHcg: 'Positive',
}

describe('feuille classique selles/urines — 2 colonnes', () => {
  it('produit exactement 2 colonnes (urine à gauche, selles à droite)', () => {
    const model = buildClassicStoolUrineModel('routine', urineAndStool)
    assert.equal(model.columns.length, 2)
    assert.equal(model.columns[0]?.key, 'urine')
    assert.equal(model.columns[1]?.key, 'stool')
    assert.equal(model.columns[0]?.sections[0]?.title, 'Urine Analysis')
    assert.equal(model.columns[1]?.sections[0]?.title, 'Stool General')
    assert.ok(model.columns[0]?.sections.some((section) => section.title === 'Diposite'))
    assert.ok(model.columns[1]?.sections.some((section) => section.title === 'Microscopic'))
  })

  it('place Reaction, Pus cels et RBCs en tête ; Urine HCG dans les extras', () => {
    const model = buildClassicStoolUrineModel('routine', urineAndStool)
    const urine = model.columns[0]?.sections.find((section) => section.title === 'Urine Analysis')
    const deposit = model.columns[0]?.sections.find((section) => section.title === 'Diposite')
    const micro = model.columns[1]?.sections.find((section) => section.title === 'Microscopic')
    assert.equal(urine?.rows[0]?.label, 'Reaction')
    assert.deepEqual(
      deposit?.rows.slice(0, 2).map((row) => row.label),
      ['Pus cels', 'RBCs'],
    )
    assert.deepEqual(
      micro?.rows.slice(0, 2).map((row) => row.label),
      ['Pus cels', 'RBCs'],
    )
    assert.equal(deposit?.rows.find((row) => /hcg/i.test(row.label)), undefined)
    assert.ok(model.extras.some((row) => /urine\s*hcg/i.test(row.label)))
    assert.equal(model.extras.find((row) => /urine\s*hcg/i.test(row.label))?.value, 'Positive')
    assert.ok(deposit?.rows.some((row) => row.label === 'Crystals'))
    assert.equal(
      micro?.rows.find((row) => /food/i.test(row.label))?.label,
      'Undigested Food',
    )
  })

  it('inclut Pus et Nitrites dans le dépôt urinaire', () => {
    const model = buildClassicStoolUrineModel('routine', {
      urineColor: 'Yellow',
      urinePus: 'Present',
      urineNitrites: 'Positive',
      urinePusCells: '2--4',
    })
    const deposit = model.columns[0]?.sections.find((section) => section.title === 'Diposite')
    assert.ok(deposit?.rows.some((row) => row.label === 'Pus' && row.value === 'Present'))
    assert.ok(deposit?.rows.some((row) => row.label === 'Nitrites' && row.value === 'Positive'))
  })

  it('place T Vaginals (clé clinic t_vaginals) dans Diposite', () => {
    const model = buildClassicStoolUrineModel('routine', {
      urineColor: 'Yellow',
      t_vaginals: 'Seen',
      urinePusCells: '1--2',
    })
    const deposit = model.columns[0]?.sections.find((section) => section.title === 'Diposite')
    assert.ok(deposit?.rows.some((row) => row.label === 'T.Vaginalis' && row.value === 'Seen'))
    assert.equal(model.extras.find((row) => /vaginal/i.test(row.label)), undefined)
  })

  it('affiche RBG (RBS) à la place de Glycémie / FBG', () => {
    const model = buildClassicStoolUrineModel('routine', urineAndStool)
    assert.ok(model.extras.some((row) => row.label === 'RBG (RBS)'))
    assert.equal(model.extras.find((row) => /glyc/i.test(row.label)), undefined)
    assert.equal(model.extras.find((row) => row.label === 'FBG'), undefined)
  })

  it('place HB / CRP sous le tableau, pas dans une 3e colonne', () => {
    const model = buildClassicStoolUrineModel('routine', urineAndStool)
    assert.ok(model.extras.some((row) => row.label === 'HB'))
    assert.ok(model.extras.some((row) => row.label === 'CRP'))
    const html = renderClassicStoolUrineTable('routine', urineAndStool)
    assert.match(html, /data-classic-cols="2"/)
    assert.match(html, /lab-classic-sheet__eq-sign/)
    assert.match(html, /10\.4 g\/dl/)
    const extrasIndex = html.indexOf('lab-classic-sheet__extras')
    const tableIndex = html.indexOf('lab-classic-sheet__table')
    assert.ok(tableIndex >= 0 && extrasIndex > tableIndex)
  })

  it('reste lisible avec un seul côté rempli (1 colonne)', () => {
    const model = buildClassicStoolUrineModel('routine', {
      urineColor: 'Yellow',
      urineSugar: 'NIL',
    })
    assert.equal(model.columns.length, 1)
    assert.equal(model.columns[0]?.key, 'urine')
    assert.equal(model.columns[0]?.sections[0]?.rows[0]?.label, 'Reaction')
    const html = renderClassicStoolUrineTable('routine', { urineColor: 'Yellow' })
    assert.match(html, /data-classic-cols="1"/)
    assert.match(html, /lab-classic-sheet__col--full/)
  })

  it('évite de couper une ligne au milieu d’une page', () => {
    assert.match(LAB_CLASSIC_SHEET_STYLES, /\.lab-classic-sheet__row \{[\s\S]*page-break-inside:\s*avoid/)
    assert.doesNotMatch(LAB_CLASSIC_SHEET_STYLES, /width:\s*33\.33%/)
  })
})
