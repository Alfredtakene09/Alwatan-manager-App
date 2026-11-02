import assert from 'node:assert/strict'
import { afterEach, before, describe, it } from 'node:test'
import { ref } from 'vue'
import {
  fcfaToInputText,
  formatFcfa,
  formatFcfaCompact,
  formatFcfaPlain,
  formatFcfaShort,
  fromDisplayAmount,
  inputTextToFcfa,
  setCurrencyLocale,
  stripBidiMarks,
  toDisplayAmount,
} from './format-fcfa.ts'
import { rowsToHtmlTable, rowsToMatrix, type ExportColumn } from './table-export-html.ts'
import { useMoneyField } from '../composables/useMoneyField.ts'
import { translateUiLocale } from '../i18n/translate.ts'
import { loadCatalog } from '../i18n/catalogs.ts'

const plain = (text: string) => stripBidiMarks(text)

afterEach(() => setCurrencyLocale('fr'))

describe('Devise selon la session : FCFA en français, rial (÷ 5) en arabe', () => {
  it('affiche les montants FCFA tels quels en français et en anglais', () => {
    for (const locale of ['fr', 'en']) {
      setCurrencyLocale(locale)
      assert.equal(plain(formatFcfa(450_000)), '450 000 FCFA')
      assert.equal(formatFcfaPlain(2_500), '2 500 FCFA')
      assert.equal(toDisplayAmount(2_500), 2_500)
    }
  })

  it('divise par 5 et affiche « ريال » en arabe', () => {
    setCurrencyLocale('ar')
    assert.equal(plain(formatFcfa(450_000)), '90 000 ريال')
    assert.equal(formatFcfaPlain(10_000), '2 000 ريال')
    assert.equal(plain(formatFcfaCompact(212_500)), '42 500')
    assert.equal(plain(formatFcfaShort(5_000)), '1 000 ريال')
    assert.equal(plain(formatFcfa(0)), '0 ريال')
  })

  it('garde les décimales utiles et le signe en rial', () => {
    setCurrencyLocale('ar')
    assert.equal(formatFcfaPlain(2_501), '500.2 ريال')
    assert.equal(formatFcfaPlain(3), '0.6 ريال')
    assert.equal(formatFcfaPlain(-7_500), '− 1 500 ريال')
  })

  it('convertit la saisie en rial vers des FCFA entiers (× 5) et inversement', () => {
    setCurrencyLocale('ar')
    assert.equal(fromDisplayAmount(2_000), 10_000)
    assert.equal(inputTextToFcfa('2000'), '10000')
    assert.equal(inputTextToFcfa('12,5'), '63')
    assert.equal(inputTextToFcfa(''), '')
    assert.equal(fcfaToInputText('10000'), '2000')
    assert.equal(fcfaToInputText(2_501), '500.2')
    assert.equal(fcfaToInputText(''), '')
    // Aller-retour sans perte pour les montants usuels.
    for (const fcfa of [5, 750, 17_500, 212_500, 1_000_000]) {
      assert.equal(inputTextToFcfa(fcfaToInputText(fcfa)), String(fcfa))
    }
  })

  it('ne convertit pas la saisie en français', () => {
    setCurrencyLocale('fr')
    assert.equal(inputTextToFcfa('2000'), '2000')
    assert.equal(fcfaToInputText('2000'), '2000')
  })
})

describe('Champ de montant (UiInput money / MoneyInput)', () => {
  function field(initialFcfa: string) {
    const model = ref(initialFcfa)
    const api = useMoneyField(() => true, () => model.value, (value) => (model.value = value))
    return { model, ...api }
  }

  it('montre des rials en arabe et enregistre des FCFA dans le formulaire', () => {
    setCurrencyLocale('ar')
    const f = field('10000')
    assert.equal(f.shownValue.value, '2000')
    f.onMoneyInput('2500')
    assert.equal(f.model.value, '12500')
    assert.equal(f.shownValue.value, '2500')
  })

  it('garde le texte tapé pendant la saisie, puis le reformate en quittant le champ', () => {
    setCurrencyLocale('ar')
    const f = field('')
    f.onMoneyInput('12.')
    assert.equal(f.shownValue.value, '12.', 'le point tapé ne disparaît pas')
    assert.equal(f.model.value, '60')
    f.onMoneyBlur()
    assert.equal(f.shownValue.value, '12')
  })

  it('laisse la valeur intacte en français', () => {
    setCurrencyLocale('fr')
    const f = field('10000')
    assert.equal(f.shownValue.value, '10000')
    f.onMoneyInput('7500')
    assert.equal(f.model.value, '7500')
  })
})

describe('Libellés « (FCFA) » selon la devise de la session', () => {
  before(async () => {
    await loadCatalog('ar')
  })

  it('remplace FCFA / فرنك par ريال quand la session est en rial', () => {
    setCurrencyLocale('ar')
    assert.equal(translateUiLocale('Montant (FCFA)', 'ar'), 'المبلغ (ريال)')
    assert.equal(translateUiLocale('Coût total (FCFA)', 'fr'), 'Coût total (ريال)')
  })

  it('garde « فرنك » sur un ticket arabe imprimé depuis une session en français (montants en FCFA)', () => {
    setCurrencyLocale('fr')
    assert.equal(translateUiLocale('Montant (FCFA)', 'ar'), 'المبلغ (فرنك)')
    assert.equal(translateUiLocale('Montant (FCFA)', 'fr'), 'Montant (FCFA)')
  })
})

describe('Rapports exportés (PDF / Excel / Word) en arabe', () => {
  type ReportRow = { label: string; amountFcfa: number }
  // Mêmes colonnes que les rapports : montants passés par formatFcfa.
  const columns: ExportColumn<ReportRow>[] = [
    { header: 'Indicateur', value: (r) => r.label },
    { header: 'Montant', value: (r) => formatFcfa(r.amountFcfa) },
  ]
  const rows: ReportRow[] = [
    { label: 'CA net', amountFcfa: 450_000 },
    { label: 'Factures fournisseur', amountFcfa: 212_500 },
    { label: 'Bénéfice période', amountFcfa: 37_505 },
  ]

  it('tableau HTML (impression / PDF) en rial', () => {
    setCurrencyLocale('ar')
    const html = rowsToHtmlTable(columns, rows)
    assert.match(html, /90 000 ريال/)
    assert.match(html, /42 500 ريال/)
    assert.match(html, /7 501 ريال/)
    assert.doesNotMatch(html, /FCFA/)
  })

  it('matrice Excel / Word en rial, sans marques de direction', () => {
    setCurrencyLocale('ar')
    const matrix = rowsToMatrix(columns, rows)
    const amounts = matrix.slice(1).map((line) => line[1])
    assert.deepEqual(amounts, ['90 000 ريال', '42 500 ريال', '7 501 ريال'])
    assert.ok(amounts.every((cell) => !/[⁦-⁩]/.test(String(cell))))
  })

  it('les mêmes exports restent en FCFA en français', () => {
    setCurrencyLocale('fr')
    const amounts = rowsToMatrix(columns, rows).slice(1).map((line) => line[1])
    assert.deepEqual(amounts, ['450 000 FCFA', '212 500 FCFA', '37 505 FCFA'])
  })
})
