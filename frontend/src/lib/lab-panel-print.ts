import { buildClinicPrintHeader, openPrintDocument } from '@/lib/print-document'
import { fullName } from '@/lib/roles'
import { formatAppDate } from '@/i18n/locale-format'
import { translateUi } from '@/i18n/translate'
import {
  getAllLabFormPanels,
  getLabFormPanel,
  labFieldCommentKey,
  type LabFormPanel,
  type LabPanelSlug,
} from '@/lib/lab-form-panels'

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
  return translateUi(label).trim().toUpperCase()
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

function renderSectionTable(
  section: LabPanelSection,
  values: Record<string, string>,
  densityClass: string,
) {
  if (!section.fields.length) return ''

  const rows = section.fields
    .map(
      (field) => `
      <tr>
        <td class="lab-sheet-table__test">${escapeHtml(translateUi(field.label))}</td>
        ${renderResultCell(field, values)}
        <td class="lab-sheet-table__ref">${escapeHtml(field.reference ?? '—')}</td>
      </tr>
    `,
    )
    .join('')

  const density = densityClass ? ` ${densityClass}` : ''

  return `
    <table class="lab-sheet-table${density}">
      <thead>
        <tr>
          <th>${escapeHtml(translateUi('Test'))}</th>
          <th>${escapeHtml(translateUi('Result'))}</th>
          <th>N.R</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `
}

function renderPanelTables(sections: LabPanelSection[], values: Record<string, string>, densityClass: string) {
  return sections
    .map((section) => {
      const table = renderSectionTable(section, values, densityClass)
      if (!table) return ''
      if (!section.title) {
        return `<div class="lab-sheet-block">${table}</div>`
      }

      return `
        <div class="lab-sheet-block">
          <div class="lab-sheet-block__heading">${escapeHtml(translateUi(section.title).toUpperCase())}</div>
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

export function buildLabPanelPrintHtml(
  slug: LabPanelSlug,
  values: Record<string, string>,
  context: PrintContext,
) {
  const panel = getLabFormPanel(slug)
  if (!panel) return ''

  const filledSections = getFilledSections(panel, values)
  if (!filledSections.length) return ''

  const date = context.date ?? formatAppDate(new Date())
  const rowCount = countFilledTableRows(filledSections)
  const densityClass = tableDensityClass(rowCount)
  const scale = initialPrintScale(rowCount)
  const formTitle = formatFormTitle(panel.label)

  return `
    <article
      class="lab-result-print lab-result-print--single-page"
      style="--lab-print-scale: ${scale.toFixed(3)}"
    >
      <div class="lab-result-print__page">
        ${buildClinicPrintHeader(undefined, { dualLogo: true })}
        ${renderPatientBand(context, date)}
        <h2 class="lab-result-print__form-name">${escapeHtml(formTitle)}</h2>
        <div class="lab-result-print__body">
          ${renderPanelTables(filledSections, values, densityClass)}
        </div>
        <footer class="lab-result-print__footer">
          <span class="lab-result-print__footer-label">${escapeHtml(translateUi('Validé par'))}</span>
          <strong>${escapeHtml(context.validatedBy)}</strong>
        </footer>
      </div>
    </article>
  `
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
  .lab-result-print__page {
    transform: scale(var(--lab-print-scale));
    transform-origin: top left;
    width: calc(100% / var(--lab-print-scale));
    box-sizing: border-box;
    color: #0f172a;
  }
  .lab-result-print .clinic-header {
    margin-bottom: 10px;
    padding: 0 96px 10px;
    min-height: 88px;
    border-bottom: 2px solid #0f766e;
  }
  .lab-result-print .clinic-logo {
    width: 88px;
    height: 88px;
  }
  .lab-result-print .clinic-logo--right {
    left: auto;
    right: 0;
  }
  .lab-result-print .clinic-info h1 {
    font-size: 26px;
    margin-bottom: 3px;
  }
  .lab-result-print .clinic-ar {
    margin-bottom: 4px;
    font-size: 22px;
  }
  .lab-result-print .clinic-contact {
    font-size: 16px;
    line-height: 1.4;
    margin-bottom: 2px;
  }
  .lab-result-print__patient {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px 24px;
    margin: 0 0 14px;
    padding: 10px 14px;
    border: 1.5px solid #cbd5e1;
    border-radius: 6px;
    background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
  }
  .lab-result-print__field {
    display: flex;
    align-items: baseline;
    gap: 8px;
    font-size: 16px;
    line-height: 1.35;
  }
  .lab-result-print__field-label {
    flex-shrink: 0;
    min-width: 110px;
    color: #64748b;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    font-size: 13px;
  }
  .lab-result-print__field-label::after {
    content: ' :';
  }
  .lab-result-print__field-value {
    flex: 1;
    font-weight: 700;
    color: #0f172a;
  }
  .lab-result-print__form-name {
    margin: 0 0 14px;
    padding: 12px 14px;
    text-align: center;
    font-size: 32px;
    font-weight: 800;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: #0f172a;
    background: #fff;
    border-top: 3px solid #0f766e;
    border-bottom: 3px solid #0f766e;
    box-shadow: inset 0 1px 0 #ecfdf5;
  }
  .lab-result-print__body {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .lab-sheet-block {
    margin: 0;
  }
  .lab-sheet-block__heading {
    margin: 0 0 8px;
    padding: 8px 12px;
    background: #ecfdf5;
    border-left: 5px solid #0d9488;
    font-size: 22.5px;
    font-weight: 800;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #0f766e;
  }
  .lab-sheet-table {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0;
    table-layout: fixed;
    font-size: 25.5px;
    border: 1.5px solid #0d9488;
    border-radius: 6px;
    overflow: hidden;
    margin: 0;
  }
  .lab-sheet-table thead th {
    background: linear-gradient(180deg, #0f766e 0%, #0d9488 100%);
    color: #fff;
    padding: 10px 12px;
    font-size: 22.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    text-align: left;
    border: none;
  }
  .lab-sheet-table thead th:nth-child(2) {
    text-align: center;
    width: 22%;
  }
  .lab-sheet-table thead th:nth-child(1) { width: 36%; }
  .lab-sheet-table thead th:nth-child(3) { width: 42%; }
  .lab-sheet-table tbody td {
    padding: 10px 12px;
    vertical-align: middle;
    border-top: 1px solid #e2e8f0;
    line-height: 1.3;
    word-wrap: break-word;
    overflow-wrap: anywhere;
  }
  .lab-sheet-table tbody tr:nth-child(even) td {
    background: #f8fafc;
  }
  .lab-sheet-table tbody tr:nth-child(even) td.lab-sheet-table__result {
    background: #ecfdf5;
  }
  .lab-sheet-table__test {
    font-weight: 600;
    color: #1e293b;
  }
  .lab-sheet-table__result {
    text-align: center;
    font-weight: 700;
    color: #0f172a;
    background: #f0fdfa !important;
    border-left: 1px solid #ccfbf1;
    border-right: 1px solid #ccfbf1;
  }
  .lab-sheet-table__result-value {
    line-height: 1.3;
  }
  .lab-sheet-table__result-comment {
    margin-top: 4px;
    font-size: 21px;
    font-weight: 500;
    color: #475569;
    text-align: left;
    white-space: pre-wrap;
    line-height: 1.3;
  }
  .lab-sheet-table__unit {
    display: inline-block;
    margin-left: 6px;
    font-weight: 500;
    color: #64748b;
    font-size: 22.5px;
  }
  .lab-sheet-table__ref {
    font-size: 22.5px;
    color: #475569;
    line-height: 1.25;
    font-style: italic;
  }
  .lab-sheet-table--compact {
    font-size: 22.5px;
  }
  .lab-sheet-table--compact thead th {
    padding: 8px 10px;
    font-size: 21px;
  }
  .lab-sheet-table--compact tbody td {
    padding: 7px 10px;
  }
  .lab-sheet-table--compact .lab-sheet-table__ref {
    font-size: 21px;
  }
  .lab-sheet-table--dense {
    font-size: 21px;
  }
  .lab-sheet-table--dense thead th {
    padding: 6px 8px;
    font-size: 19.5px;
  }
  .lab-sheet-table--dense tbody td {
    padding: 5px 8px;
  }
  .lab-sheet-table--dense .lab-sheet-table__ref {
    font-size: 19.5px;
    line-height: 1.15;
  }
  .lab-result-print__footer {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 10px;
    margin-top: 16px;
    padding-top: 12px;
    border-top: 1.5px solid #cbd5e1;
    font-size: 25.5px;
  }
  .lab-result-print__footer-label {
    color: #64748b;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-size: 22.5px;
    font-weight: 600;
  }
  .lab-result-print__footer-label::after {
    content: ' :';
  }
  @media print {
    .lab-result-print--single-page {
      height: ${A4_PRINTABLE_HEIGHT_MM}mm;
      max-height: ${A4_PRINTABLE_HEIGHT_MM}mm;
      overflow: hidden;
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
) {
  const slugs = getAllLabFormPanels().map((panel) => panel.slug).filter((slug) => panelResults[slug])
  if (!slugs.length) return false

  const body = slugs
    .map((slug) => buildLabPanelPrintHtml(slug, panelResults[slug]!, context))
    .filter(Boolean)
    .join('')

  if (!body) return false

  const title =
    slugs.length === 1
      ? `${getLabFormPanel(slugs[0])?.label ?? 'Résultat'} — ${context.patientCode}`
      : `Résultats laboratoire — ${context.patientCode}`

  openPrintDocument(
    title,
    `<style>${LAB_PANEL_PRINT_STYLES}</style>${body}${LAB_PANEL_FIT_SCRIPT}`,
    { pageSize: 'A4', autoPrint: false },
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
    `<style>${LAB_PANEL_PRINT_STYLES}</style>${body}${LAB_PANEL_FIT_SCRIPT}`,
    { pageSize: 'A4', autoPrint: false },
  )
}

export function buildPrescribedByLabel(doctor?: { firstName: string; lastName: string } | null) {
  return doctor ? `Dr ${fullName(doctor.firstName, doctor.lastName)}` : 'Réception'
}
