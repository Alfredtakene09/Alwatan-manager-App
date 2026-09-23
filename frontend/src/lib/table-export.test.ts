import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import JSZip from 'jszip'
import { Packer } from 'docx'
import { rowsToHtmlTable, rowsToMatrix, sectionsToHtml, sectionsToMatrix, uniqueExcelSheetNames, type ExportColumn } from './table-export-html.ts'
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

describe('export table sections', () => {
  it('produit un tableau HTML par groupe puis un récapitulatif', () => {
    const html = sectionsToHtml(
      [
        {
          title: 'Infirmier — 2 employés — 350 000 FCFA',
          columns,
          rows: [
            { name: 'Ahmed', price: '150000' },
            { name: 'Béatrice', price: '200000' },
          ],
        },
        {
          title: 'Récapitulatif par poste',
          columns: [
            { header: 'Poste', value: (r: { jobTitle: string }) => r.jobTitle },
            { header: 'Effectif', value: (r: { count: number }) => r.count },
          ],
          rows: [{ jobTitle: 'Infirmier', count: 2 }],
          totalsRows: [{ label: 'Total général — employés', value: '2' }],
        },
      ],
      { captionRows: [{ label: 'Filtres', value: 'Aucun filtre' }] },
    )
    assert.match(html, /Filtres/)
    assert.match(html, /report-section-title/)
    assert.match(html, /Infirmier — 2 employés/)
    assert.match(html, /Ahmed/)
    assert.match(html, /Récapitulatif par poste/)
    assert.match(html, /Total général — employés/)
    assert.equal((html.match(/class="report-data"/g) ?? []).length, 2)
  })

  it('place une section ownPage dans un bloc page dédiée', () => {
    const html = sectionsToHtml([
      {
        title: 'Récapitulatif par poste',
        ownPage: true,
        columns: [{ header: 'Poste', value: (r: { jobTitle: string }) => r.jobTitle }],
        rows: [{ jobTitle: 'Infirmier' }],
      },
      {
        title: 'Infirmier',
        columns,
        rows: [{ name: 'Ahmed', price: '1' }],
      },
    ])
    assert.match(html, /class="report-own-page"/)
    const recapPos = html.indexOf('Récapitulatif par poste')
    const groupPos = html.indexOf('Ahmed')
    assert.ok(recapPos >= 0 && recapPos < groupPos)
  })

  it('ajoute les titres de groupe dans la matrice Excel', () => {
    const matrix = sectionsToMatrix([
      {
        title: 'Médecin — 1 employés — 400000',
        columns,
        rows: [{ name: 'Dr Camara', price: '400000' }],
      },
    ])
    assert.deepEqual(matrix[0], ['Médecin — 1 employés — 400000'])
    assert.deepEqual(matrix[1], ['Médicament', 'Prix vente'])
    assert.deepEqual(matrix[2], ['Dr Camara', '400000'])
  })
})

describe('uniqueExcelSheetNames', () => {
  it('tronque à 31 caractères, retire les caractères interdits et dédoublonne', () => {
    const names = uniqueExcelSheetNames([
      'Récapitulatif par poste',
      'Infirmier',
      'Infirmier',
      'Médecin / chirurgie[bloc]',
      'A'.repeat(40),
    ])
    assert.equal(names[0], 'Récapitulatif par poste')
    assert.equal(names[1], 'Infirmier')
    assert.equal(names[2], 'Infirmier (2)')
    assert.ok(!names[3].includes('/') && !names[3].includes('['))
    assert.ok(names.every((name) => name.length <= 31))
    assert.equal(new Set(names.map((name) => name.toLowerCase())).size, names.length)
  })
})

describe('export table Word', () => {
  it('produit un .docx avec tableau, totaux une seule fois et mêmes données', async () => {
    const rows = [
      { name: 'Paracétamol', price: '500 FCFA' },
      { name: 'Amoxicilline', price: '1 200 FCFA' },
    ]
    // JPEG 1×1 minimal pour valider l’embedding du logo à gauche
    const tinyJpeg = Uint8Array.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
      0x00, 0x01, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08,
      0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
      0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20, 0x24, 0x2e, 0x27, 0x20,
      0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29, 0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27,
      0x39, 0x3d, 0x38, 0x32, 0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
      0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x1f, 0x00, 0x00, 0x01, 0x05, 0x01, 0x01,
      0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04,
      0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0xff, 0xc4, 0x00, 0xb5, 0x10, 0x00, 0x02, 0x01, 0x03,
      0x03, 0x02, 0x04, 0x03, 0x05, 0x05, 0x04, 0x04, 0x00, 0x00, 0x01, 0x7d, 0x01, 0x02, 0x03, 0x00,
      0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32,
      0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72,
      0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x34, 0x35,
      0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55,
      0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75,
      0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94,
      0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2,
      0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9,
      0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6,
      0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa, 0xff, 0xda,
      0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x7b, 0xdf, 0xff, 0xd9,
    ])
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
      {
        headerLines: ['Clinique Alwatan'],
        creator: 'Alwatan',
        logo: { data: tinyJpeg, type: 'jpg' },
      },
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
    assert.match(xml, /a:blip|pic:pic|w:drawing/)
    assert.ok(
      Object.keys(zip.files).some((name) => name.startsWith('word/media/')),
      'logo media manquant',
    )
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

  it('saute de page avant une section dédiée', async () => {
    const doc = buildWordDocument('Employés', [
      {
        name: 'Récapitulatif par poste',
        columns: [{ header: 'Poste', value: (r: { jobTitle: string }) => r.jobTitle }],
        rows: [{ jobTitle: 'Infirmier' }],
      },
      {
        name: 'Infirmier',
        pageBreakBefore: true,
        columns,
        rows: [{ name: 'Ahmed', price: '1' }],
      },
    ])
    const xml = await JSZip.loadAsync(Buffer.from(await Packer.toBuffer(doc))).then((zip) =>
      zip.file('word/document.xml')?.async('string'),
    )
    assert.ok(xml)
    assert.match(xml, /w:pageBreakBefore/)
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
