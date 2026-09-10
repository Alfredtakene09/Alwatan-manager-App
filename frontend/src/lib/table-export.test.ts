import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import JSZip from 'jszip'
import { Packer } from 'docx'
import { rowsToHtmlTable, rowsToMatrix, type ExportColumn } from './table-export-html.ts'
import { buildWordDocument } from './table-export-word.ts'
import { isUiActionAllowed } from './ui-actions.ts'

type Row = { name: string; price: string }

const columns: ExportColumn<Row>[] = [
  { header: 'Médicament', value: (r) => r.name },
  { header: 'Prix vente', value: (r) => r.price },
]

const totalsRows = [
  { label: 'Nombre de fiches', value: '61' },
  { label: 'Total brut', value: '19 680 000 FCFA' },
  { label: 'Total avances', value: '0 FCFA' },
  { label: 'Total net', value: '19 680 000 FCFA' },
]

describe('export table PDF HTML', () => {
  it('inclut en-tête, toutes les lignes et totaux une seule fois après le tableau', () => {
    const rows = Array.from({ length: 120 }, (_, i) => ({
      name: `Produit ${i + 1}`,
      price: `${(i + 1) * 100} FCFA`,
    }))
    const html = rowsToHtmlTable(columns, rows, {
      captionRows: [
        { label: 'Date de génération', value: '09/09/2026 15:00' },
        { label: 'Périmètre', value: 'Catalogue complet' },
      ],
      totalsRows: [
        { label: 'Valeur stock (prix vente)', value: '1 000 FCFA' },
        { label: 'Nombre de lignes', value: String(rows.length) },
      ],
    })
    assert.match(html, /Date de génération/)
    assert.match(html, /Catalogue complet/)
    assert.match(html, /Produit 1/)
    assert.match(html, /Produit 120/)
    assert.equal((html.match(/<tr><td>/g) ?? []).length, 120)
    assert.doesNotMatch(html, /<tfoot>/)
    assert.match(html, /class="report-totals"/)
    assert.equal((html.match(/Valeur stock \(prix vente\)/g) ?? []).length, 1)
    assert.match(html, /1 000 FCFA/)
    const dataTableEnd = html.indexOf('</table>')
    const totalsPos = html.indexOf('class="report-totals"')
    assert.ok(dataTableEnd >= 0 && totalsPos > dataTableEnd)
  })

  it('affiche une ligne vide unique si aucune donnée', () => {
    const html = rowsToHtmlTable(columns, [])
    assert.match(html, /Aucune donnée/)
    assert.match(html, /colspan="3"/)
  })
})

describe('export table Excel matrix', () => {
  it('ajoute les totaux uniquement en fin de feuille', () => {
    const rows = [
      { name: 'Produit 1', price: '100 FCFA' },
      { name: 'Produit 2', price: '200 FCFA' },
    ]
    const matrix = rowsToMatrix(columns, rows, { totalsRows })
    assert.deepEqual(matrix[0], ['Médicament', 'Prix vente'])
    assert.deepEqual(matrix[1], ['Produit 1', '100 FCFA'])
    assert.deepEqual(matrix.at(-1), ['Total net', '19 680 000 FCFA'])
    assert.deepEqual(matrix.at(-4), ['Nombre de fiches', '61'])
    assert.equal(matrix.filter((row) => row[0] === 'Nombre de fiches').length, 1)
  })
})

describe('export table Word', () => {
  it('produit un .docx avec tableau, totaux une seule fois et mêmes données', async () => {
    const rows = [
      { name: 'Paracétamol', price: '500 FCFA' },
      { name: 'Amoxicilline', price: '1 200 FCFA' },
    ]
    const doc = buildWordDocument(
      'Produits pharmacie',
      [
        {
          name: 'Produits pharmacie',
          columns,
          rows,
          captionRows: [{ label: 'Périmètre', value: 'Catalogue complet' }],
          totalsRows,
        },
      ],
      { headerLines: ['Clinique Alwatan'], creator: 'Alwatan' },
    )
    const buffer = Buffer.from(await Packer.toBuffer(doc))
    assert.equal(buffer.subarray(0, 2).toString(), 'PK')
    const zip = await JSZip.loadAsync(buffer)
    const xml = await zip.file('word/document.xml')?.async('string')
    assert.ok(xml, 'document.xml manquant')
    assert.match(xml, /Produits pharmacie/)
    assert.match(xml, /Paracétamol/)
    assert.match(xml, /Amoxicilline/)
    assert.match(xml, /Catalogue complet/)
    assert.equal((xml.match(/Nombre de fiches/g) ?? []).length, 1)
    assert.equal((xml.match(/Total brut/g) ?? []).length, 1)
    assert.equal((xml.match(/Total net/g) ?? []).length, 1)
    assert.match(xml, /19 680 000 FCFA/)
    const paracetamolPos = xml.indexOf('Paracétamol')
    const totalsPos = xml.indexOf('Nombre de fiches')
    assert.ok(paracetamolPos >= 0 && totalsPos > paracetamolPos)
  })

  it('supporte un équivalent multi-feuilles (plusieurs sections)', async () => {
    const doc = buildWordDocument('Rapport logistique', [
      { name: 'KPI', columns: [{ header: 'Indicateur', value: (r: { label: string }) => r.label }], rows: [{ label: 'Articles' }] },
      { name: 'Catégories', columns: [{ header: 'Catégorie', value: (r: { name: string }) => r.name }], rows: [{ name: 'Consommables' }] },
    ])
    const xml = await JSZip.loadAsync(Buffer.from(await Packer.toBuffer(doc))).then((zip) =>
      zip.file('word/document.xml')?.async('string'),
    )
    assert.ok(xml)
    assert.match(xml, /KPI/)
    assert.match(xml, /Catégories/)
    assert.match(xml, /Consommables/)
  })
})

describe('accès export.word', () => {
  it('a les mêmes rôles par défaut que PDF/Excel : masquable, Admin toujours autorisé', () => {
    assert.equal(isUiActionAllowed({ role: 'ADMIN' }, 'export.word'), true)
    assert.equal(isUiActionAllowed({ role: 'GESTIONNAIRE' }, 'export.word'), true)
    assert.equal(isUiActionAllowed({ role: 'GESTIONNAIRE', hiddenUiActions: ['export.word'] }, 'export.word'), false)
    assert.equal(isUiActionAllowed({ role: 'GESTIONNAIRE', hiddenUiActions: ['export.pdf'] }, 'export.word'), true)
    assert.equal(isUiActionAllowed({ role: 'PHARMACIEN', hiddenUiActions: ['export.word'] }, 'export.excel'), true)
    assert.equal(isUiActionAllowed(null, 'export.word'), false)
  })
})
