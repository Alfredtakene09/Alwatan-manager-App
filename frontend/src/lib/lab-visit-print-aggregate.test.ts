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
  it('regroupe 4 examens remplis dans un seul document', () => {
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
  })

  it('reste un seul document même avec 10 examens', () => {
    const panelResults: Record<string, Record<string, string>> = {}
    for (let i = 1; i <= 10; i++) panelResults[`exam-${i}`] = { result: String(i) }
    const plan = planLabVisitPrint(panelResults)
    assert.equal(plan.slugs.length, 10)
    assert.equal(plan.documentCount, 1)
  })

  it('fonctionne avec un seul examen', () => {
    const plan = planLabVisitPrint({ diabetic: { fbg: '95' } })
    assert.deepEqual(plan.slugs, ['diabetic'])
    assert.equal(plan.documentCount, 1)
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

  it('le HTML combiné n’a qu’un article fluide, sans page forcée par examen', () => {
    const html = `
      <style>section { page-break-inside: avoid; }</style>
      <article class="lab-result-print lab-result-print--combined ${LAB_VISIT_FLOW_ARTICLE_CLASS}">
        <section class="lab-result-print__panel-block">FBG</section>
        <section class="lab-result-print__panel-block">CBC</section>
        <section class="lab-result-print__panel-block">ESR</section>
      </article>
    `
    const inspect = inspectLabVisitPrintHtml(html)
    assert.equal(inspect.articleCount, 1)
    assert.equal(inspect.hasFlowClass, true)
    assert.equal(inspect.forcedSinglePageCount, 0)
    assert.equal(inspect.panelBlockCount, 3)
    assert.equal(inspect.hasPageBreakInsideAvoid, true)
  })

  it('printLabVisitPanelResults agrège toujours via buildVisitLabResultsPrintHtml', () => {
    const src = readFileSync(join(here, 'lab-panel-print.ts'), 'utf8')
    const start = src.indexOf('export function printLabVisitPanelResults')
    const end = src.indexOf('export function printLabPanelResult')
    assert.ok(start >= 0 && end > start)
    const fn = src.slice(start, end)
    assert.match(fn, /buildVisitLabResultsPrintHtml/)
    assert.match(fn, /openPrintDocument/)
    assert.equal((fn.match(/openPrintDocument\(/g) ?? []).length, 1)
    assert.doesNotMatch(fn, /MAX_COMBINED/)
    assert.doesNotMatch(fn, /canCombinePanelsOnOnePage/)
    assert.doesNotMatch(fn, /buildLabPanelPrintHtml/)
  })

  it('le document fluide n’impose pas une hauteur A4 par formulaire', () => {
    const src = readFileSync(join(here, 'lab-panel-print.ts'), 'utf8')
    assert.match(src, /lab-result-print--flow/)
    assert.match(src, /\.lab-result-print--flow \{[\s\S]*height:\s*auto/)
    assert.match(src, /lab-result-print__panel-block \{[\s\S]*page-break-inside:\s*avoid/)
  })
})
