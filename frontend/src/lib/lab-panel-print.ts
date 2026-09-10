import { buildClinicPrintHeader, openPrintDocument } from '@/lib/print-document'
import { fullName } from '@/lib/roles'
import { formatAppDate, formatAppDateTime } from '@/i18n/locale-format'
import { translateExamName, translateUi } from '@/i18n/translate'
import {
  getLabFormPanel,
  labFieldCommentKey,
  type LabFormPanel,
  type LabPanelSlug,
} from '@/lib/lab-form-panels'
import {
  renderClassicStoolUrineTable,
  LAB_CLASSIC_SHEET_STYLES,
  valuesHaveClassicStoolOrUrine,
} from '@/lib/lab-classic-sheet-print'
import {
  LAB_VISIT_FLOW_ARTICLE_CLASS,
  panelResultsHaveValues,
  resolveLabVisitPrintSlugs,
} from '@/lib/lab-visit-print-aggregate'

export { LAB_VISIT_FLOW_ARTICLE_CLASS }

type PrintContext = {
  patientName: string
  patientCode: string
  prescribedBy: string
  validatedBy: string
  date?: string
}

/** Hauteur utile A4 avec marges d'impression (12 mm). */
const A4_PRINTABLE_HEIGHT_MM = 273

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatFormTitle(label: string) {
  if (/glyc[eé]mie/i.test(label.trim())) return 'RBG (RBS)'
  return translateExamName(label).trim().toUpperCase()
}

type LabPanelField = LabFormPanel['sections'][number]['fields'][number]
type LabPanelSection = LabFormPanel['sections'][number]

function fieldHasEntry(field: LabPanelField, values: Record<string, string>) {
  const raw = values[field.key]?.trim() ?? ''
  const comment = field.hasComment ? values[labFieldCommentKey(field.key)]?.trim() ?? '' : ''
  return Boolean(raw || comment)
}

/** Sections et lignes avec au moins une valeur saisie (résumé d'impression). */
function getFilledSections(panel: LabFormPanel, values: Record<string, string>): LabPanelSection[] {
  return panel.sections
    .map((section) => ({
      ...section,
      fields: section.fields.filter((field) => fieldHasEntry(field, values)),
    }))
    .filter((section) => section.fields.length > 0)
}

function countFilledTableRows(sections: LabPanelSection[]) {
  const fieldCount = sections.reduce((total, section) => total + section.fields.length, 0)
  const sectionHeaders = sections.filter((section) => section.title).length
  const tables = sections.length
  return fieldCount + sectionHeaders + tables
}

function tableDensityClass(rowCount: number) {
  if (rowCount > 38) return 'lab-sheet-table--dense'
  if (rowCount > 18) return 'lab-sheet-table--compact'
  return ''
}

function initialPrintScale(rowCount: number) {
  const headerMm = 48
  const footerMm = 10
  const rowMm = rowCount > 38 ? 7.5 : rowCount > 18 ? 9 : 11
  const totalMm = headerMm + rowCount * rowMm + footerMm

  if (totalMm <= A4_PRINTABLE_HEIGHT_MM) return 1
  return Math.max(0.58, A4_PRINTABLE_HEIGHT_MM / totalMm)
}

function renderResultCell(field: LabPanelField, values: Record<string, string>) {
  const raw = values[field.key]?.trim() ?? ''
  const comment = field.hasComment ? values[labFieldCommentKey(field.key)]?.trim() ?? '' : ''
  if (!raw && !comment) return '<td class="lab-sheet-table__result">&nbsp;</td>'

  const unit = field.unit && raw ? `<span class="lab-sheet-table__unit">${escapeHtml(field.unit)}</span>` : ''
  const resultLine = raw
    ? `<div class="lab-sheet-table__result-value">${escapeHtml(raw)}${unit}</div>`
    : ''
  const commentLine = comment
    ? `<div class="lab-sheet-table__result-comment">${escapeHtml(comment)}</div>`
    : ''

  return `<td class="lab-sheet-table__result">${resultLine}${commentLine}</td>`
}

function fieldReference(field: LabPanelField) {
  return field.reference?.trim() || ''
}

function sectionsHaveReference(sections: LabPanelSection[]) {
  return sections.some((section) => section.fields.some((field) => Boolean(fieldReference(field))))
}

function renderSectionTable(
  section: LabPanelSection,
  values: Record<string, string>,
  densityClass: string,
  showNrColumn: boolean,
) {
  if (!section.fields.length) return ''

  const rows = section.fields
    .map((field) => {
      const refCell = showNrColumn
        ? `<td class="lab-sheet-table__ref">${escapeHtml(fieldReference(field) || '—')}</td>`
        : ''
      return `
      <tr>
        <td class="lab-sheet-table__test">${escapeHtml(translateExamName(field.label))}</td>
        ${renderResultCell(field, values)}
        ${refCell}
      </tr>
    `
    })
    .join('')

  const density = densityClass ? ` ${densityClass}` : ''
  const nrHeader = showNrColumn ? `<th>N.R</th>` : ''
  const tableMod = showNrColumn ? '' : ' lab-sheet-table--no-nr'

  return `
    <table class="lab-sheet-table${density}${tableMod}">
      <thead>
        <tr>
          <th>${escapeHtml(translateUi('Test'))}</th>
          <th>${escapeHtml(translateUi('Result'))}</th>
          ${nrHeader}
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `
}

function renderPanelTables(
  sections: LabPanelSection[],
  values: Record<string, string>,
  densityClass: string,
  showNrColumn: boolean,
) {
  return sections
    .map((section) => {
      const table = renderSectionTable(section, values, densityClass, showNrColumn)
      if (!table) return ''
      if (!section.title) {
        return `<div class="lab-sheet-block">${table}</div>`
      }

      return `
        <div class="lab-sheet-block">
          <div class="lab-sheet-block__heading">${escapeHtml(translateExamName(section.title).toUpperCase())}</div>
          ${table}
        </div>
      `
    })
    .filter(Boolean)
    .join('')
}

function renderPatientBand(context: PrintContext, date: string) {
  const fields = [
    { label: translateUi('Date'), value: date },
    { label: translateUi('Matricule'), value: context.patientCode },
    { label: translateUi('Nom et prénom'), value: context.patientName },
    { label: translateUi('Prescrit par'), value: context.prescribedBy },
  ]

  const cells = fields
    .map(
      (field) => `
      <div class="lab-result-print__field">
        <span class="lab-result-print__field-label">${escapeHtml(field.label)}</span>
        <span class="lab-result-print__field-value">${escapeHtml(field.value)}</span>
      </div>
    `,
    )
    .join('')

  return `<section class="lab-result-print__patient" aria-label="${escapeHtml(translateUi('Informations patient'))}">${cells}</section>`
}

function getSectionsToPrint(
  slug: LabPanelSlug,
  values: Record<string, string>,
): { formTitle: string; sections: LabPanelSection[] } | null {
  const panel = getLabFormPanel(slug)
  const filledSections = panel ? getFilledSections(panel, values) : []
  const formTitle = formatFormTitle(panel?.label ?? slug)
  const sectionsToPrint =
    filledSections.length > 0 ? filledSections : buildFallbackSectionsFromValues(values)
  if (!sectionsToPrint.length) return null
  return { formTitle, sections: sectionsToPrint }
}

function shouldPrintClassicStoolUrine(slug: LabPanelSlug, values: Record<string, string>) {
  return slug === 'routine' && valuesHaveClassicStoolOrUrine(values)
}

export function buildLabPanelPrintHtml(
  slug: LabPanelSlug,
  values: Record<string, string>,
  context: PrintContext,
) {
  const prepared = getSectionsToPrint(slug, values)
  if (!prepared) return ''

  const date = context.date ?? formatAppDate(new Date())
  const printedAt = formatAppDateTime(new Date())
  const rowCount = countFilledTableRows(prepared.sections)
  const densityClass = tableDensityClass(rowCount)
  const scale = initialPrintScale(rowCount)
  const showNrColumn = sectionsHaveReference(prepared.sections)
  const validator = context.validatedBy?.trim() || '—'

  const useClassicTable = shouldPrintClassicStoolUrine(slug, values)
  const printScale = useClassicTable ? Math.max(scale, 0.92) : scale
  const bodyHtml = useClassicTable
    ? renderClassicStoolUrineTable(slug, values)
    : renderPanelTables(prepared.sections, values, densityClass, showNrColumn)

  if (!bodyHtml.trim()) return ''

  return `
    <article
      class="lab-result-print lab-result-print--single-page"
      style="--lab-print-scale: ${printScale.toFixed(3)}"
    >
      <div class="lab-result-print__page">
        ${buildClinicPrintHeader(undefined, { dualLogo: true })}
        ${renderPatientBand(context, date)}
        <h2 class="lab-result-print__form-name">${escapeHtml(prepared.formTitle)}</h2>
        <div class="lab-result-print__body">
          ${bodyHtml}
        </div>
        <footer class="lab-result-print__footer">
          <div class="lab-result-print__footer-print">
            <span class="lab-result-print__footer-label">${escapeHtml(translateUi('Imprimé le'))}</span>
            <strong class="lab-result-print__footer-printed-at">${escapeHtml(printedAt)}</strong>
          </div>
          <div class="lab-result-print__footer-validator">
            <span class="lab-result-print__footer-label">${escapeHtml(translateUi('Validé par'))}</span>
            <strong class="lab-result-print__footer-name">${escapeHtml(validator)}</strong>
          </div>
        </footer>
      </div>
    </article>
  `
}

function renderVisitPanelBlock(
  slug: LabPanelSlug,
  values: Record<string, string>,
  densityClass: string,
) {
  if (shouldPrintClassicStoolUrine(slug, values)) {
    const panel = getLabFormPanel(slug)
    const formTitle = formatFormTitle(panel?.label ?? slug)
    const bodyHtml = renderClassicStoolUrineTable(slug, values)
    if (!bodyHtml.trim()) return ''
    return `
      <section class="lab-result-print__panel-block lab-result-print__panel-block--classic">
        <h2 class="lab-result-print__form-name">${escapeHtml(formTitle)}</h2>
        <div class="lab-result-print__body">${bodyHtml}</div>
      </section>
    `
  }

  const prepared = getSectionsToPrint(slug, values)
  if (!prepared) return ''
  const showNrColumn = sectionsHaveReference(prepared.sections)
  const tables = renderPanelTables(prepared.sections, values, densityClass, showNrColumn)
  if (!tables.trim()) return ''
  return `
    <section class="lab-result-print__panel-block">
      <h2 class="lab-result-print__form-name">${escapeHtml(prepared.formTitle)}</h2>
      <div class="lab-result-print__body">${tables}</div>
    </section>
  `
}

/**
 * Tous les formulaires d’une même visite → un seul article HTML.
 * La pagination se fait par flux CSS (saut de page naturel), jamais par plusieurs jobs d’impression.
 */
export function buildVisitLabResultsPrintHtml(
  slugs: LabPanelSlug[],
  panelResults: Partial<Record<LabPanelSlug, Record<string, string>>>,
  context: PrintContext,
) {
  const blocks = slugs.flatMap((slug) => {
    const values = panelResults[slug]
    if (!values || !panelResultsHaveValues(values)) return []
    return [{ slug, values }]
  })

  if (!blocks.length) return ''

  const date = context.date ?? formatAppDate(new Date())
  const printedAt = formatAppDateTime(new Date())
  const rowCount = blocks.reduce((sum, block) => {
    const prepared = getSectionsToPrint(block.slug, block.values)
    return sum + 2 + (prepared ? countFilledTableRows(prepared.sections) : 0)
  }, 0)
  const densityClass = tableDensityClass(Math.max(rowCount, 12))
  const validator = context.validatedBy?.trim() || '—'

  const bodyBlocks = blocks
    .map((block) => renderVisitPanelBlock(block.slug, block.values, densityClass))
    .filter(Boolean)
    .join('')

  if (!bodyBlocks.trim()) return ''

  return `
    <article class="lab-result-print lab-result-print--combined ${LAB_VISIT_FLOW_ARTICLE_CLASS}">
      <div class="lab-result-print__page">
        ${buildClinicPrintHeader(undefined, { dualLogo: true })}
        ${renderPatientBand(context, date)}
        ${bodyBlocks}
        <footer class="lab-result-print__footer">
          <div class="lab-result-print__footer-print">
            <span class="lab-result-print__footer-label">${escapeHtml(translateUi('Imprimé le'))}</span>
            <strong class="lab-result-print__footer-printed-at">${escapeHtml(printedAt)}</strong>
          </div>
          <div class="lab-result-print__footer-validator">
            <span class="lab-result-print__footer-label">${escapeHtml(translateUi('Validé par'))}</span>
            <strong class="lab-result-print__footer-name">${escapeHtml(validator)}</strong>
          </div>
        </footer>
      </div>
    </article>
  `
}

/** @deprecated Alias de buildVisitLabResultsPrintHtml — un document unique pour toute la visite. */
export function buildCombinedLabPanelsPrintHtml(
  slugs: LabPanelSlug[],
  panelResults: Partial<Record<LabPanelSlug, Record<string, string>>>,
  context: PrintContext,
) {
  return buildVisitLabResultsPrintHtml(slugs, panelResults, context)
}

function buildFallbackSectionsFromValues(values: Record<string, string>): LabPanelSection[] {
  const fields: LabPanelField[] = Object.entries(values)
    .filter(([key, value]) => !key.endsWith('__comment') && String(value ?? '').trim())
    .map(([key]) => ({
      key,
      label: humanizeFieldKey(key),
      type: 'text' as const,
    }))

  if (!fields.length) return []
  return [{ title: undefined, fields }]
}

function humanizeFieldKey(key: string) {
  if (key === 'bloodGrouping') return translateExamName('Blood Grouping')
  const spaced = key
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim()
  return spaced || key
}

const LAB_PANEL_PRINT_STYLES = `
  .lab-result-print--single-page {
    --lab-print-scale: 1;
    width: 100%;
    height: ${A4_PRINTABLE_HEIGHT_MM}mm;
    max-height: ${A4_PRINTABLE_HEIGHT_MM}mm;
    overflow: hidden;
    box-sizing: border-box;
    page-break-inside: avoid;
    break-inside: avoid;
  }
  .lab-result-print--single-page:not(:last-of-type) {
    page-break-after: always;
    break-after: page;
  }
  .lab-result-print--single-page:last-of-type {
    page-break-after: auto;
    break-after: auto;
  }
  /* Visite complète : un document continu. Saut de page naturel si le contenu déborde. */
  .lab-result-print--flow {
    width: 100%;
    height: auto;
    max-height: none;
    overflow: visible;
    box-sizing: border-box;
  }
  .lab-result-print--flow .lab-result-print__page {
    transform: none;
    width: 100%;
    min-height: ${A4_PRINTABLE_HEIGHT_MM}mm;
    height: auto;
  }
  .lab-result-print--flow .clinic-header,
  .lab-result-print--flow .lab-result-print__patient {
    page-break-after: avoid;
    break-after: avoid;
  }
  .lab-result-print--flow .lab-result-print__footer {
    page-break-inside: avoid;
    break-inside: avoid;
  }
  .lab-result-print__page {
    transform: scale(var(--lab-print-scale, 1));
    transform-origin: top left;
    width: calc(100% / var(--lab-print-scale, 1));
    min-height: ${A4_PRINTABLE_HEIGHT_MM}mm;
    box-sizing: border-box;
    color: #0f172a;
    direction: ltr;
    text-align: left;
    display: flex;
    flex-direction: column;
  }
  .lab-result-print .clinic-header {
    margin-bottom: 14px;
    padding: 0 148px 12px;
    min-height: 138px;
    border-bottom: 1px solid #94a3b8;
  }
  .lab-result-print .clinic-logo {
    width: 132px;
    height: 132px;
  }
  .lab-result-print .clinic-logo--right {
    left: auto;
    right: 0;
  }
  .lab-result-print .clinic-info h1 {
    font-size: 34px;
    line-height: 1.2;
    margin-bottom: 4px;
    font-weight: 700;
    color: #0f172a;
  }
  .lab-result-print .clinic-ar {
    margin-bottom: 3px;
    font-size: 24px;
    color: #334155;
  }
  .lab-result-print .clinic-contact {
    font-size: 16px;
    line-height: 1.45;
    margin-bottom: 2px;
    color: #475569;
  }
  .lab-result-print__patient {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px 28px;
    margin: 0 0 16px;
    padding: 4px 0 12px;
    border: none;
    border-radius: 0;
    border-bottom: 1px solid #e2e8f0;
    background: transparent;
  }
  .lab-result-print__field {
    display: flex;
    align-items: baseline;
    gap: 8px;
    font-size: 19px;
    line-height: 1.4;
  }
  .lab-result-print__field-label {
    flex-shrink: 0;
    min-width: 112px;
    color: #64748b;
    font-weight: 500;
    text-transform: none;
    letter-spacing: 0;
    font-size: 17px;
  }
  .lab-result-print__field-label::after {
    content: ' :';
  }
  .lab-result-print__field-value {
    flex: 1;
    font-weight: 600;
    color: #0f172a;
  }
  .lab-result-print__form-name {
    margin: 0 0 16px;
    padding: 0 0 8px;
    text-align: center;
    font-size: 24px;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #0f172a;
    background: transparent;
    border: none;
    border-bottom: 1px solid #0f172a;
  }
  .lab-result-print--combined .lab-result-print__panel-block {
    page-break-inside: avoid;
    break-inside: avoid;
  }
  .lab-result-print--combined .lab-result-print__panel-block + .lab-result-print__panel-block {
    margin-top: 0.75rem;
    padding-top: 0.55rem;
    border-top: 1px solid #cbd5e1;
  }
  .lab-result-print--combined .lab-result-print__form-name {
    margin: 0 0 10px;
    padding-bottom: 6px;
    font-size: 18px;
    letter-spacing: 0.08em;
  }
  .lab-result-print__body {
    display: flex;
    flex-direction: column;
    gap: 18px;
    flex: 1 1 auto;
  }
  .lab-sheet-block {
    margin: 0;
    page-break-inside: avoid;
    break-inside: avoid;
  }
  .lab-sheet-block__heading {
    margin: 0 0 8px;
    padding: 0 0 4px;
    background: transparent;
    border: none;
    border-bottom: 1px solid #cbd5e1;
    font-size: 19px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #334155;
  }
  .lab-sheet-table {
    width: 100%;
    border-collapse: collapse;
    border-spacing: 0;
    table-layout: fixed;
    font-size: 18px;
    border: none;
    border-radius: 0;
    overflow: visible;
    margin: 0;
  }
  .lab-sheet-table thead th {
    background: transparent;
    color: #64748b;
    padding: 8px 4px 10px;
    font-size: 14.5px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    text-align: left;
    border: none;
    border-bottom: 1.5px solid #0f172a;
  }
  .lab-sheet-table thead th:nth-child(2) {
    text-align: center;
    width: 28%;
  }
  .lab-sheet-table thead th:nth-child(1) { width: 40%; }
  .lab-sheet-table thead th:nth-child(3) { width: 32%; }
  .lab-sheet-table--no-nr thead th:nth-child(1) { width: 55%; }
  .lab-sheet-table--no-nr thead th:nth-child(2) { width: 45%; }
  .lab-sheet-table tbody td {
    padding: 11px 4px;
    vertical-align: middle;
    border: none;
    border-bottom: 1px solid #e2e8f0;
    line-height: 1.4;
    word-wrap: break-word;
    overflow-wrap: anywhere;
    background: transparent;
  }
  .lab-sheet-table tbody tr:last-child td {
    border-bottom: 1px solid #94a3b8;
  }
  .lab-sheet-table tbody tr:nth-child(even) td {
    background: transparent;
  }
  .lab-sheet-table tbody tr:nth-child(even) td.lab-sheet-table__result {
    background: transparent;
  }
  .lab-sheet-table__test {
    font-weight: 600;
    color: #1e293b;
  }
  .lab-sheet-table__result {
    text-align: center;
    font-weight: 700;
    color: #0f172a;
    background: transparent !important;
    border-left: none;
    border-right: none;
  }
  .lab-sheet-table__result-value {
    line-height: 1.4;
  }
  .lab-sheet-table__result-comment {
    margin-top: 3px;
    font-size: 15.5px;
    font-weight: 400;
    color: #64748b;
    text-align: left;
    white-space: pre-wrap;
    line-height: 1.35;
  }
  .lab-sheet-table__unit {
    display: inline-block;
    margin-left: 4px;
    font-weight: 400;
    color: #64748b;
    font-size: 15.5px;
  }
  .lab-sheet-table__ref {
    font-size: 15.5px;
    color: #64748b;
    line-height: 1.35;
    font-style: normal;
  }
  .lab-sheet-table--compact {
    font-size: 16.5px;
  }
  .lab-sheet-table--compact thead th {
    padding: 7px 4px 9px;
    font-size: 13.5px;
  }
  .lab-sheet-table--compact tbody td {
    padding: 9px 4px;
  }
  .lab-sheet-table--compact .lab-sheet-table__ref {
    font-size: 14.5px;
  }
  .lab-sheet-table--dense {
    font-size: 15.5px;
  }
  .lab-sheet-table--dense thead th {
    padding: 6px 3px 8px;
    font-size: 13px;
  }
  .lab-sheet-table--dense tbody td {
    padding: 8px 3px;
  }
  .lab-sheet-table--dense .lab-sheet-table__ref {
    font-size: 14px;
    line-height: 1.25;
  }
  .lab-result-print__footer {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 16px;
    margin-top: auto;
    padding-top: 16px;
    border-top: 1px solid #e2e8f0;
    font-size: 18px;
  }
  .lab-result-print__footer-print,
  .lab-result-print__footer-validator {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
  }
  .lab-result-print__footer-validator {
    margin-left: auto;
    justify-content: flex-end;
    text-align: right;
  }
  .lab-result-print__footer-label {
    color: #64748b;
    font-weight: 500;
    text-transform: none;
    font-size: 15px;
    letter-spacing: 0;
    white-space: nowrap;
  }
  .lab-result-print__footer-label::after {
    content: ' :';
  }
  .lab-result-print__footer-name,
  .lab-result-print__footer-printed-at {
    color: #0f172a;
    font-size: 18px;
    font-weight: 700;
  }
  .lab-result-print__footer-printed-at {
    font-size: 16px;
    font-variant-numeric: tabular-nums;
  }
  @media print {
    .lab-result-print--single-page {
      height: ${A4_PRINTABLE_HEIGHT_MM}mm;
      max-height: ${A4_PRINTABLE_HEIGHT_MM}mm;
      overflow: hidden;
    }
    .lab-result-print--flow {
      height: auto !important;
      max-height: none !important;
      overflow: visible !important;
    }
  }
`

const LAB_PANEL_FIT_SCRIPT = `
<script>
window.onload = function () {
  var pages = document.querySelectorAll('.lab-result-print--single-page');
  if (!pages.length) {
    window.print();
    window.close();
    return;
  }

  var minScale = 0.58;
  var step = 0.015;

  pages.forEach(function (wrap) {
    var page = wrap.querySelector('.lab-result-print__page');
    if (!page) return;

    var scale = parseFloat(getComputedStyle(wrap).getPropertyValue('--lab-print-scale')) || 1;

    function apply(nextScale) {
      wrap.style.setProperty('--lab-print-scale', String(nextScale));
    }

    apply(scale);

    var guard = 0;
    while (page.getBoundingClientRect().height > wrap.getBoundingClientRect().height + 0.5 && scale > minScale && guard < 50) {
      scale = Math.max(minScale, scale - step);
      apply(scale);
      guard++;
    }
  });

  window.print();
  window.close();
};
<\/script>
`

export function printLabVisitPanelResults(
  panelResults: Partial<Record<LabPanelSlug, Record<string, string>>>,
  context: PrintContext,
  options?: { preferSlugs?: LabPanelSlug[] },
) {
  const slugs = resolveLabVisitPrintSlugs(panelResults, options?.preferSlugs)
  if (!slugs.length) return false

  // Un seul openPrintDocument : tous les formulaires de la visite, y compris s’ils
  // occupent plusieurs pages physiques. Les panneaux vides (en attente) sont omis.
  const body = buildVisitLabResultsPrintHtml(slugs, panelResults, context)
  if (!body) return false

  const title =
    slugs.length === 1
      ? `${getLabFormPanel(slugs[0])?.label ?? 'Résultat'} — ${context.patientCode}`
      : `Résultats laboratoire — ${context.patientCode}`

  openPrintDocument(
    title,
    `<style>${LAB_PANEL_PRINT_STYLES}${LAB_CLASSIC_SHEET_STYLES}</style>${body}${LAB_PANEL_FIT_SCRIPT}`,
    { pageSize: 'A4', autoPrint: false, forceLtr: true },
  )

  return true
}

export function printLabPanelResult(
  slug: LabPanelSlug,
  values: Record<string, string>,
  context: PrintContext,
) {
  const body = buildLabPanelPrintHtml(slug, values, context)
  if (!body) return

  const panel = getLabFormPanel(slug)
  openPrintDocument(
    `${panel?.label ?? 'Résultat'} — ${context.patientCode}`,
    `<style>${LAB_PANEL_PRINT_STYLES}${LAB_CLASSIC_SHEET_STYLES}</style>${body}${LAB_PANEL_FIT_SCRIPT}`,
    { pageSize: 'A4', autoPrint: false, forceLtr: true },
  )
}

export type PrescribedByPerson = {
  firstName: string
  lastName: string
  employee?: { firstName: string; lastName: string } | null
}

/** Nom puis prénom, en privilégiant la fiche employé liée. */
function personNomPrenom(person: PrescribedByPerson) {
  const firstName = person.employee?.firstName?.trim() || person.firstName
  const lastName = person.employee?.lastName?.trim() || person.lastName
  return `${lastName} ${firstName}`.trim()
}

function personPrenomNom(person: PrescribedByPerson) {
  const firstName = person.employee?.firstName?.trim() || person.firstName
  const lastName = person.employee?.lastName?.trim() || person.lastName
  return fullName(firstName, lastName)
}

/** Réceptionniste ayant enregistré / envoyé l’examen (employé lié si disponible). */
export function resolveLabReceptionist(visit?: {
  consultation?: { labApprovedBy?: PrescribedByPerson | null } | null
  invoices?: Array<{ issuedBy?: PrescribedByPerson | null }> | null
  patient?: { createdBy?: PrescribedByPerson | null } | null
} | null): PrescribedByPerson | null {
  if (!visit) return null
  return (
    visit.consultation?.labApprovedBy ??
    visit.invoices?.find((invoice) => invoice.issuedBy)?.issuedBy ??
    visit.patient?.createdBy ??
    null
  )
}

export function buildPrescribedByLabel(
  doctor?: PrescribedByPerson | null,
  receptionist?: PrescribedByPerson | null,
) {
  if (doctor) return `Dr ${personPrenomNom(doctor)}`
  if (receptionist) return personNomPrenom(receptionist)
  return 'Réception'
}

