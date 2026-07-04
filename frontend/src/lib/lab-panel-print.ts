import { buildClinicPrintHeader, openPrintDocument } from '@/lib/print-document'
import { fullName } from '@/lib/roles'
import { getLabFormPanel, LAB_FORM_PANELS, type LabFormPanel, type LabPanelSlug } from '@/lib/lab-form-panels'

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
  return label.trim().toUpperCase()
}

function countPanelFields(panel: LabFormPanel) {
  return panel.sections.reduce((total, section) => total + section.fields.length, 0)
}

function countTableRows(panel: LabFormPanel) {
  const sectionHeaders = panel.sections.filter((section) => section.title).length
  const tables = panel.sections.length
  return countPanelFields(panel) + sectionHeaders + tables
}

function tableDensityClass(panel: LabFormPanel) {
  const rows = countTableRows(panel)
  if (rows > 38) return 'lab-sheet-table--dense'
  if (rows > 18) return 'lab-sheet-table--compact'
  return ''
}

function initialPrintScale(panel: LabFormPanel) {
  const rows = countTableRows(panel)
  const headerMm = 42
  const footerMm = 6
  const rowMm = rows > 38 ? 2.7 : rows > 18 ? 3.1 : 3.6
  const totalMm = headerMm + rows * rowMm + footerMm

  if (totalMm <= A4_PRINTABLE_HEIGHT_MM) return 1
  return Math.max(0.58, A4_PRINTABLE_HEIGHT_MM / totalMm)
}

function renderResultCell(field: LabFormPanel['sections'][number]['fields'][number], values: Record<string, string>) {
  const raw = values[field.key]?.trim() ?? ''
  if (!raw) return '<td class="lab-sheet-table__result">&nbsp;</td>'

  const unit = field.unit ? `<span class="lab-sheet-table__unit">${escapeHtml(field.unit)}</span>` : ''
  const multiline = field.type === 'textarea' ? ' lab-sheet-table__result--multiline' : ''

  return `<td class="lab-sheet-table__result${multiline}">${escapeHtml(raw)}${unit}</td>`
}

function renderSectionTable(
  section: LabFormPanel['sections'][number],
  values: Record<string, string>,
  densityClass: string,
) {
  const rows = section.fields
    .map(
      (field) => `
      <tr>
        <td class="lab-sheet-table__test">${escapeHtml(field.label)}</td>
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
          <th>Test</th>
          <th>Result</th>
          <th>N.R</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `
}

function renderPanelTables(panel: LabFormPanel, values: Record<string, string>) {
  const densityClass = tableDensityClass(panel)

  return panel.sections
    .map((section) => {
      const table = renderSectionTable(section, values, densityClass)
      if (!section.title) {
        return `<div class="lab-sheet-block">${table}</div>`
      }

      return `
        <div class="lab-sheet-block">
          <div class="lab-sheet-block__heading">${escapeHtml(section.title.toUpperCase())}</div>
          ${table}
        </div>
      `
    })
    .join('')
}

function renderPatientBand(context: PrintContext, date: string) {
  const fields = [
    { label: 'Date', value: date },
    { label: 'Matricule', value: context.patientCode },
    { label: 'Nom et prénom', value: context.patientName },
    { label: 'Prescrit par', value: context.prescribedBy },
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

  return `<section class="lab-result-print__patient" aria-label="Informations patient">${cells}</section>`
}

export function buildLabPanelPrintHtml(
  slug: LabPanelSlug,
  values: Record<string, string>,
  context: PrintContext,
) {
  const panel = getLabFormPanel(slug)
  if (!panel) return ''

  const date = context.date ?? new Date().toLocaleDateString('fr-FR')
  const scale = initialPrintScale(panel)
  const formTitle = formatFormTitle(panel.label)

  return `
    <article
      class="lab-result-print lab-result-print--single-page"
      style="--lab-print-scale: ${scale.toFixed(3)}"
    >
      <div class="lab-result-print__page">
        ${buildClinicPrintHeader()}
        ${renderPatientBand(context, date)}
        <h2 class="lab-result-print__form-name">${escapeHtml(formTitle)}</h2>
        <div class="lab-result-print__body">
          ${renderPanelTables(panel, values)}
        </div>
        <footer class="lab-result-print__footer">
          <span class="lab-result-print__footer-label">Validé par</span>
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
    margin-bottom: 6px;
    padding-bottom: 7px;
    gap: 10px;
    border-bottom: 1.5px solid #0f766e;
  }
  .lab-result-print .clinic-logo {
    width: 54px;
    height: 54px;
  }
  .lab-result-print .clinic-info h1 {
    font-size: 12px;
    margin-bottom: 2px;
  }
  .lab-result-print .clinic-ar {
    margin-bottom: 3px;
    font-size: 10px;
  }
  .lab-result-print .clinic-contact {
    font-size: 8.5px;
    line-height: 1.3;
    margin-bottom: 1px;
  }
  .lab-result-print__patient {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px 28px;
    margin: 0 0 8px;
    padding: 7px 10px;
    border: 1px solid #cbd5e1;
    border-radius: 4px;
    background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
  }
  .lab-result-print__field {
    display: flex;
    align-items: baseline;
    gap: 6px;
    font-size: 8.5px;
    line-height: 1.35;
  }
  .lab-result-print__field-label {
    flex-shrink: 0;
    min-width: 68px;
    color: #64748b;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    font-size: 7.5px;
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
    margin: 0 0 9px;
    padding: 7px 10px;
    text-align: center;
    font-size: 12px;
    font-weight: 800;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: #0f172a;
    background: #fff;
    border-top: 2px solid #0f766e;
    border-bottom: 2px solid #0f766e;
    box-shadow: inset 0 1px 0 #ecfdf5;
  }
  .lab-result-print__body {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .lab-sheet-block {
    margin: 0;
  }
  .lab-sheet-block__heading {
    margin: 0 0 3px;
    padding: 3px 8px;
    background: #ecfdf5;
    border-left: 3px solid #0d9488;
    font-size: 7.5px;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #0f766e;
  }
  .lab-sheet-table {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0;
    table-layout: fixed;
    font-size: 8.5px;
    border: 1px solid #0d9488;
    border-radius: 4px;
    overflow: hidden;
    margin: 0;
  }
  .lab-sheet-table thead th {
    background: linear-gradient(180deg, #0f766e 0%, #0d9488 100%);
    color: #fff;
    padding: 4px 6px;
    font-size: 7.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    text-align: left;
    border: none;
  }
  .lab-sheet-table thead th:nth-child(2) {
    text-align: center;
    width: 22%;
  }
  .lab-sheet-table thead th:nth-child(1) { width: 28%; }
  .lab-sheet-table thead th:nth-child(3) { width: 50%; }
  .lab-sheet-table tbody td {
    padding: 2px 6px;
    vertical-align: middle;
    border-top: 1px solid #e2e8f0;
    line-height: 1.2;
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
  .lab-sheet-table__result--multiline {
    text-align: left;
    white-space: pre-wrap;
  }
  .lab-sheet-table__unit {
    display: inline-block;
    margin-left: 3px;
    font-weight: 500;
    color: #64748b;
    font-size: 7.5px;
  }
  .lab-sheet-table__ref {
    font-size: 7.5px;
    color: #475569;
    line-height: 1.15;
    font-style: italic;
  }
  .lab-sheet-table--compact {
    font-size: 7.5px;
  }
  .lab-sheet-table--compact thead th {
    padding: 3px 5px;
    font-size: 7px;
  }
  .lab-sheet-table--compact tbody td {
    padding: 1.5px 4px;
  }
  .lab-sheet-table--compact .lab-sheet-table__ref {
    font-size: 7px;
  }
  .lab-sheet-table--dense {
    font-size: 7px;
  }
  .lab-sheet-table--dense thead th {
    padding: 2px 4px;
    font-size: 6.5px;
  }
  .lab-sheet-table--dense tbody td {
    padding: 1px 3px;
  }
  .lab-sheet-table--dense .lab-sheet-table__ref {
    font-size: 6.5px;
    line-height: 1.08;
  }
  .lab-result-print__footer {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 6px;
    margin-top: 6px;
    padding-top: 5px;
    border-top: 1px solid #cbd5e1;
    font-size: 8.5px;
  }
  .lab-result-print__footer-label {
    color: #64748b;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-size: 7.5px;
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
  const slugs = LAB_FORM_PANELS.map((panel) => panel.slug).filter((slug) => panelResults[slug])
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
