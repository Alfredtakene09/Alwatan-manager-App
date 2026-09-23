import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  inspectLabVisitPrintHtml,
  LAB_VISIT_FLOW_ARTICLE_CLASS,
  planLabVisitPrint,
} from './lab-visit-print-aggregate.ts'

const here = dirname(fileURLToPath(import.meta.url))

describe('agrégation impression résultats labo (même visite)', () => {
  it('planifie 4 examens : condensé hors Routine + feuille Routine séparée', () => {
    const plan = planLabVisitPrint({
      diabetic: { fbg: '95' },
      routine: { bffm: 'Negative', esr: '12' },
      cbc: { twbc: '6200' },
      esrPanel: { esr: '20' },
    })
    assert.equal(plan.slugs.length, 4)
    assert.equal(plan.documentCount, 1)
    assert.equal(plan.articleClass, LAB_VISIT_FLOW_ARTICLE_CLASS)
    assert.equal(plan.skippedEmpty.length, 0)
    assert.deepEqual(plan.routineSlugs, ['routine'])
    assert.equal(plan.condensedSlugs.length, 3)
    assert.equal(plan.expectedSheetCount, 2)
  })

  it('reste un seul job et une seule feuille condensée avec 10 examens (sans Routine)', () => {
    const panelResults: Record<string, Record<string, string>> = {}
    for (let i = 1; i <= 10; i++) panelResults[`exam-${i}`] = { result: String(i) }
    const plan = planLabVisitPrint(panelResults)
    assert.equal(plan.slugs.length, 10)
    assert.equal(plan.documentCount, 1)
    assert.equal(plan.expectedSheetCount, 1)
    assert.equal(plan.routineSlugs.length, 0)
  })

  it('fonctionne avec un seul examen', () => {
    const plan = planLabVisitPrint({ diabetic: { fbg: '95' } })
    assert.deepEqual(plan.slugs, ['diabetic'])
    assert.equal(plan.documentCount, 1)
    assert.equal(plan.expectedSheetCount, 1)
  })

  it('Routine seule → une seule feuille (pas de condensé)', () => {
    const plan = planLabVisitPrint({ routine: { esr: '12' } })
    assert.deepEqual(plan.slugs, ['routine'])
    assert.deepEqual(plan.routineSlugs, ['routine'])
    assert.deepEqual(plan.condensedSlugs, [])
    assert.equal(plan.expectedSheetCount, 1)
  })

  it('omet les panneaux vides (en attente) sans bloquer l’impression', () => {
    const plan = planLabVisitPrint({
      diabetic: { fbg: '95' },
      liver: { ast: '' },
      lipid: {},
    })
    assert.deepEqual(plan.slugs, ['diabetic'])
    assert.ok(plan.skippedEmpty.includes('liver'))
    assert.ok(plan.skippedEmpty.includes('lipid'))
  })

  it('n’inclut que les slugs fournis (une visite) — pas de fusion inter-dossiers', () => {
    const visitA = planLabVisitPrint({ diabetic: { fbg: '95' } })
    const visitB = planLabVisitPrint({ liver: { ast: '32' } })
    assert.deepEqual(visitA.slugs, ['diabetic'])
    assert.deepEqual(visitB.slugs, ['liver'])
    assert.ok(!visitA.slugs.includes('liver'))
  })

  it('le HTML condensé utilise panel-block ; Routine reste un article séparé', () => {
    const html = `
      <style>.lab-result-print:not(:last-of-type) { page-break-after: always; }</style>
      <article class="lab-result-print lab-result-print--combined lab-result-print--flow">
        <section class="lab-result-print__panel-block">FBG</section>
        <section class="lab-result-print__panel-block">CBC</section>
      </article>
      <article class="lab-result-print lab-result-print--flow">ROUTINE</article>
    `
    const inspect = inspectLabVisitPrintHtml(html)
    assert.equal(inspect.articleCount, 2)
    assert.equal(inspect.panelBlockCount, 2)
    assert.equal(inspect.hasCombinedClass, true)
    assert.equal(inspect.hasPageBreakAfterAlways, true)
  })

  it('printLabVisitPanelResults condense hors Routine via buildVisitLabResultsPrintHtml', () => {
    const src = readFileSync(join(here, 'lab-panel-print.ts'), 'utf8')
    const start = src.indexOf('export function printLabVisitPanelResults')
    const end = src.indexOf('export function printLabPanelResult')
    assert.ok(start >= 0 && end > start)
    const fn = src.slice(start, end)
    assert.match(fn, /buildVisitLabResultsPrintHtml/)
    assert.match(fn, /openPrintDocument/)
    assert.equal((fn.match(/openPrintDocument\(/g) ?? []).length, 1)

    const buildStart = src.indexOf('export function buildVisitLabResultsPrintHtml')
    const buildEnd = src.indexOf('export function buildCombinedLabPanelsPrintHtml')
    assert.ok(buildStart >= 0 && buildEnd > buildStart)
    const buildFn = src.slice(buildStart, buildEnd)
    assert.match(buildFn, /planVisitPrintSheets/)
    assert.match(buildFn, /buildCondensedLabPanelsPrintHtml/)
    assert.match(buildFn, /isRoutinePanelSlug|kind === 'routine'/)
    assert.match(buildFn, /pageIndex/)
    assert.match(buildFn, /pageTotal/)
    assert.match(src, /lab-result-print--combined/)
    assert.match(src, /lab-result-print__panel-block/)
  })

  it('affiche la numérotation pageIndex/pageTotal dans le pied de page', () => {
    const src = readFileSync(join(here, 'lab-panel-print.ts'), 'utf8')
    assert.match(src, /lab-result-print__footer-page/)
    assert.match(src, /pageIndex: index \+ 1/)
    assert.match(src, /\$\{paging\.pageIndex\}\/\$\{paging\.pageTotal\}/)
  })

  it('force un saut de page entre feuille condensée et Routine', () => {
    const src = readFileSync(join(here, 'lab-panel-print.ts'), 'utf8')
    assert.match(
      src,
      /\.lab-result-print:not\(:last-of-type\)\s*\{[\s\S]*page-break-after:\s*always/,
    )
  })
})
