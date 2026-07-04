import { CLINIC } from './clinic'
import { formatFcfa } from './format-fcfa'

const formatFcfaPrint = formatFcfa

export const CLINIC_PRINT_STYLES = `
  * { box-sizing: border-box; }
  @page { margin: 12mm; }
  @page print-a5 {
    size: A5 portrait;
    margin: 8mm;
  }
  @page print-a4 {
    size: A4 portrait;
    margin: 12mm;
  }
  body {
    font-family: 'Segoe UI', Arial, Helvetica, sans-serif;
    padding: 28px 32px;
    color: #1a1a1a;
    max-width: 720px;
    margin: 0 auto;
    background: #fff;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  body.print-a5 {
    page: print-a5;
    max-width: none;
    width: 100%;
    padding: 10px 12px;
  }
  body.print-a4 {
    page: print-a4;
    max-width: none;
    width: 100%;
    padding: 0;
    margin: 0;
  }
  .print-invoice-page {
    page-break-after: always;
    break-after: page;
  }
  .print-invoice-page:last-child {
    page-break-after: auto;
    break-after: auto;
  }
  .clinic-header {
    display: flex;
    gap: 14px;
    align-items: flex-start;
    border-bottom: 2px dashed #ccc;
    padding-bottom: 14px;
    margin-bottom: 16px;
  }
  .clinic-logo {
    width: 72px;
    height: 72px;
    object-fit: contain;
    flex-shrink: 0;
  }
  .clinic-info h1 {
    margin: 0 0 4px;
    font-size: 15px;
    line-height: 1.25;
  }
  .clinic-ar {
    margin: 0 0 6px;
    font-size: 12px;
    color: #334155;
    font-family: 'Noto Naskh Arabic', 'Amiri', 'Tahoma', 'Arial', sans-serif;
  }
  .clinic-contact {
    margin: 0 0 2px;
    font-size: 10px;
    color: #475569;
    line-height: 1.45;
  }
  .doc-title {
    margin: 10px 0 0;
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #0f766e;
  }
  .row {
    display: flex;
    justify-content: space-between;
    margin: 8px 0;
    font-size: 13px;
    gap: 12px;
  }
  .row strong { font-weight: 700; text-align: right; }
  .total {
    border-top: 2px solid #111;
    margin-top: 12px;
    padding-top: 12px;
    font-size: 16px;
    font-weight: 700;
  }
  .footer {
    text-align: center;
    margin-top: 20px;
    font-size: 10px;
    color: #666;
    line-height: 1.5;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
    margin: 10px 0;
  }
  th, td {
    border: 1px solid #e2e8f0;
    padding: 6px 8px;
    text-align: left;
  }
  th { background: #f8fafc; font-size: 11px; }
  .notes {
    margin: 10px 0 0;
    font-size: 12px;
    color: #475569;
    white-space: pre-wrap;
  }

  /* Reçu consultation — modèle PDF */
  .receipt-invoice {
    width: 100%;
  }
  .receipt-invoice__head {
    margin-bottom: 0;
  }
  .receipt-invoice__head-top {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 88px;
    margin-bottom: 10px;
    padding: 0 96px;
  }
  .receipt-invoice__logo {
    position: absolute;
    left: 0;
    top: 50%;
    transform: translateY(-50%);
    width: 88px;
    height: 88px;
    object-fit: contain;
  }
  .receipt-invoice__titles {
    text-align: center;
    width: 100%;
  }
  .receipt-invoice__clinic-name {
    margin: 0;
    font-size: 14px;
    font-weight: 800;
    color: #3e6640;
    line-height: 1.25;
    letter-spacing: 0.01em;
    text-align: center;
    white-space: nowrap;
  }
  .receipt-invoice__clinic-ar {
    margin: 0 0 6px;
    font-size: 14px;
    font-weight: 600;
    color: #c62828;
    text-align: center;
    font-family: 'Noto Naskh Arabic', 'Amiri', 'Tahoma', 'Arial', sans-serif;
  }
  .receipt-invoice__brand {
    width: 100%;
  }
  .receipt-invoice__contact-box {
    background: #f3f3f3;
    border: 1px solid #d4d4d4;
    padding: 10px 12px;
  }
  .receipt-invoice__contact {
    margin: 0 0 3px;
    font-size: 11px;
    color: #222;
    line-height: 1.45;
  }
  .receipt-invoice__contact:last-child {
    margin-bottom: 0;
  }
  .receipt-invoice__dash {
    border: 0;
    border-top: 2px dashed #888;
    margin: 16px 0;
  }
  .receipt-invoice__cols {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    margin-bottom: 0;
  }
  .receipt-invoice__box {
    border: 1px solid #bdbdbd;
    padding: 12px 14px;
    border-radius: 2px;
    background: #fff;
  }
  .receipt-invoice__field {
    margin: 0 0 6px;
    font-size: 12px;
    line-height: 1.45;
    color: #111;
  }
  .receipt-invoice__field:last-child {
    margin-bottom: 0;
  }
  .receipt-invoice__label {
    color: #3e6640;
    font-weight: 700;
  }
  .receipt-invoice__doc-title {
    margin: 18px 0 12px;
    text-align: center;
    font-size: 16px;
    font-weight: 800;
    color: #c62828;
    text-decoration: underline;
    letter-spacing: 0.02em;
  }
  .receipt-invoice__table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
    margin-bottom: 0;
  }
  .receipt-invoice__table thead th {
    background: #3e6640 !important;
    color: #ffffff !important;
    font-weight: 700;
    padding: 9px 10px;
    text-align: left;
    border: 1px solid #3e6640;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .receipt-invoice__table thead th:nth-child(2),
  .receipt-invoice__table thead th:nth-child(3),
  .receipt-invoice__table thead th:nth-child(4) {
    text-align: center;
    min-width: 95px;
  }
  .receipt-invoice__table tbody td {
    padding: 9px 10px;
    border: 1px solid #bdbdbd;
    vertical-align: middle;
    color: #111;
    background: #fff;
  }
  .receipt-invoice__table tbody td:nth-child(2),
  .receipt-invoice__table tbody td:nth-child(3),
  .receipt-invoice__table tbody td:nth-child(4) {
    text-align: center;
    white-space: nowrap;
  }
  .receipt-invoice__table .receipt-invoice__summary td {
    background: #fff;
    border: 1px solid #bdbdbd;
    font-weight: 600;
    padding: 8px 10px;
  }
  .receipt-invoice__table .receipt-invoice__summary td:first-child {
    text-align: right;
    color: #333;
  }
  .receipt-invoice__table .receipt-invoice__summary td:last-child {
    text-align: center;
    font-weight: 700;
  }
  .receipt-invoice__table .receipt-invoice__summary--discount td:last-child {
    color: #e65100;
    font-weight: 700;
  }
  .receipt-invoice__table--exams thead th:nth-child(2) {
    text-align: center;
    min-width: 120px;
  }
  .receipt-invoice__table--exams tbody td:nth-child(2),
  .receipt-invoice__table--exams .receipt-invoice__summary td:last-child {
    text-align: center;
    white-space: nowrap;
  }
  .receipt-invoice__table--exams .receipt-invoice__summary td:first-child {
    text-align: right;
    font-weight: 600;
    color: #333;
  }
  .receipt-invoice__total-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
    padding: 12px 14px;
    background: #3e6640 !important;
    color: #ffffff !important;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
    border: 1px solid #3e6640;
  }
  .receipt-invoice__total-bar span,
  .receipt-invoice__total-bar strong {
    font-size: 14px;
    font-weight: 800;
    letter-spacing: 0.02em;
    color: #ffffff !important;
    white-space: nowrap;
  }
  .receipt-invoice__total-bar strong {
    font-size: 15px;
  }
  .receipt-invoice__thanks {
    margin: 20px 0 0;
    text-align: center;
    font-size: 13px;
    font-weight: 600;
    font-style: italic;
    color: #3e6640;
  }
  .receipt-invoice__kind-comment {
    margin: 10px 0 0;
    padding: 8px 10px;
    border-radius: 8px;
    border: 1px solid #e2e8f0;
    background: #f8fafc;
    font-size: 11px;
    line-height: 1.45;
    color: #334155;
    white-space: pre-wrap;
  }
  .receipt-invoice__kind-comment strong {
    display: block;
    margin-bottom: 4px;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #64748b;
  }

  /* Facture examen — format A5 */
  .receipt-invoice--exam-a5 .receipt-invoice__head-top {
    min-height: 58px;
    margin-bottom: 6px;
    padding: 0 62px;
  }
  .receipt-invoice--exam-a5 .receipt-invoice__logo {
    width: 58px;
    height: 58px;
  }
  .receipt-invoice--exam-a5 .receipt-invoice__clinic-name {
    font-size: 11px;
  }
  .receipt-invoice--exam-a5 .receipt-invoice__clinic-ar {
    margin-bottom: 4px;
    font-size: 11px;
  }
  .receipt-invoice--exam-a5 .receipt-invoice__contact-box {
    padding: 6px 8px;
  }
  .receipt-invoice--exam-a5 .receipt-invoice__contact {
    font-size: 9px;
    line-height: 1.35;
  }
  .receipt-invoice--exam-a5 .receipt-invoice__dash {
    margin: 10px 0;
  }
  .receipt-invoice--exam-a5 .receipt-invoice__cols {
    gap: 10px;
  }
  .receipt-invoice--exam-a5 .receipt-invoice__box {
    padding: 8px 10px;
  }
  .receipt-invoice--exam-a5 .receipt-invoice__field {
    margin-bottom: 4px;
    font-size: 10px;
    line-height: 1.35;
  }
  .receipt-invoice--exam-a5 .receipt-invoice__doc-title {
    margin: 10px 0 8px;
    font-size: 13px;
  }
  .receipt-invoice--exam-a5 .receipt-invoice__table {
    font-size: 10px;
  }
  .receipt-invoice--exam-a5 .receipt-invoice__table thead th {
    padding: 6px 8px;
  }
  .receipt-invoice--exam-a5 .receipt-invoice__table tbody td,
  .receipt-invoice--exam-a5 .receipt-invoice__table .receipt-invoice__summary td {
    padding: 5px 7px;
  }
  .receipt-invoice--exam-a5 .receipt-invoice__total-bar {
    padding: 8px 10px;
  }
  .receipt-invoice--exam-a5 .receipt-invoice__total-bar span,
  .receipt-invoice--exam-a5 .receipt-invoice__total-bar strong {
    font-size: 11px;
  }
  .receipt-invoice--exam-a5 .receipt-invoice__thanks {
    margin-top: 12px;
    font-size: 11px;
  }

  /* 4+ examens */
  .receipt-invoice--exam-a5.receipt-invoice--compact .receipt-invoice__field {
    font-size: 9px;
    margin-bottom: 3px;
  }
  .receipt-invoice--exam-a5.receipt-invoice--compact .receipt-invoice__doc-title {
    margin: 8px 0 6px;
    font-size: 12px;
  }
  .receipt-invoice--exam-a5.receipt-invoice--compact .receipt-invoice__table {
    font-size: 9px;
  }
  .receipt-invoice--exam-a5.receipt-invoice--compact .receipt-invoice__table thead th,
  .receipt-invoice--exam-a5.receipt-invoice--compact .receipt-invoice__table tbody td,
  .receipt-invoice--exam-a5.receipt-invoice--compact .receipt-invoice__table .receipt-invoice__summary td {
    padding: 4px 6px;
  }

  /* 7+ examens */
  .receipt-invoice--exam-a5.receipt-invoice--dense .receipt-invoice__head-top {
    min-height: 48px;
    padding: 0 52px;
  }
  .receipt-invoice--exam-a5.receipt-invoice--dense .receipt-invoice__logo {
    width: 48px;
    height: 48px;
  }
  .receipt-invoice--exam-a5.receipt-invoice--dense .receipt-invoice__clinic-name,
  .receipt-invoice--exam-a5.receipt-invoice--dense .receipt-invoice__clinic-ar {
    font-size: 10px;
  }
  .receipt-invoice--exam-a5.receipt-invoice--dense .receipt-invoice__contact {
    font-size: 8px;
  }
  .receipt-invoice--exam-a5.receipt-invoice--dense .receipt-invoice__dash {
    margin: 8px 0;
  }
  .receipt-invoice--exam-a5.receipt-invoice--dense .receipt-invoice__box {
    padding: 6px 8px;
  }
  .receipt-invoice--exam-a5.receipt-invoice--dense .receipt-invoice__field {
    font-size: 8.5px;
    margin-bottom: 2px;
    line-height: 1.25;
  }
  .receipt-invoice--exam-a5.receipt-invoice--dense .receipt-invoice__doc-title {
    margin: 6px 0 5px;
    font-size: 11px;
  }
  .receipt-invoice--exam-a5.receipt-invoice--dense .receipt-invoice__table {
    font-size: 8.5px;
  }
  .receipt-invoice--exam-a5.receipt-invoice--dense .receipt-invoice__table thead th,
  .receipt-invoice--exam-a5.receipt-invoice--dense .receipt-invoice__table tbody td,
  .receipt-invoice--exam-a5.receipt-invoice--dense .receipt-invoice__table .receipt-invoice__summary td {
    padding: 3px 5px;
  }
  .receipt-invoice--exam-a5.receipt-invoice--dense .receipt-invoice__total-bar {
    padding: 6px 8px;
  }
  .receipt-invoice--exam-a5.receipt-invoice--dense .receipt-invoice__total-bar span,
  .receipt-invoice--exam-a5.receipt-invoice--dense .receipt-invoice__total-bar strong {
    font-size: 10px;
  }
  .receipt-invoice--exam-a5.receipt-invoice--dense .receipt-invoice__thanks {
    margin-top: 8px;
    font-size: 10px;
  }

  /* 10+ examens */
  .receipt-invoice--exam-a5.receipt-invoice--dense-xl .receipt-invoice__head-top {
    min-height: 42px;
    padding: 0 46px;
  }
  .receipt-invoice--exam-a5.receipt-invoice--dense-xl .receipt-invoice__logo {
    width: 42px;
    height: 42px;
  }
  .receipt-invoice--exam-a5.receipt-invoice--dense-xl .receipt-invoice__field {
    font-size: 8px;
  }
  .receipt-invoice--exam-a5.receipt-invoice--dense-xl .receipt-invoice__doc-title {
    font-size: 10px;
  }
  .receipt-invoice--exam-a5.receipt-invoice--dense-xl .receipt-invoice__table {
    font-size: 7.5px;
  }
  .receipt-invoice--exam-a5.receipt-invoice--dense-xl .receipt-invoice__table tbody td:first-child {
    word-break: break-word;
    line-height: 1.2;
  }
  .receipt-invoice--exam-a5.receipt-invoice--dense-xl .receipt-invoice__table thead th,
  .receipt-invoice--exam-a5.receipt-invoice--dense-xl .receipt-invoice__table tbody td,
  .receipt-invoice--exam-a5.receipt-invoice--dense-xl .receipt-invoice__table .receipt-invoice__summary td {
    padding: 2px 4px;
  }

  .receipt-invoice__type-header td {
    font-weight: 700;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    border: 1px solid #bdbdbd;
    padding: 5px 8px;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .receipt-invoice__type-header--examen td {
    background: #e8f5e9 !important;
    color: #2e7d32;
  }
  .receipt-invoice__type-header--radio td {
    background: #e3f2fd !important;
    color: #1565c0;
  }
  .receipt-invoice__type-header--echo td {
    background: #fce4ec !important;
    color: #c2185b;
  }
  .receipt-invoice__type-header--odonto td {
    background: #fff3e0 !important;
    color: #e65100;
  }
  .receipt-invoice__exam-row--examen td:first-child {
    border-left: 3px solid #2e7d32;
  }
  .receipt-invoice__exam-row--radio td:first-child {
    border-left: 3px solid #1565c0;
  }
  .receipt-invoice__exam-row--echo td:first-child {
    border-left: 3px solid #c2185b;
  }
  .receipt-invoice__exam-row--odonto td:first-child {
    border-left: 3px solid #e65100;
  }

  .receipt-invoice__doc-title--examen {
    color: #2e7d32 !important;
  }
  .receipt-invoice__doc-title--radio {
    color: #1565c0 !important;
  }
  .receipt-invoice__doc-title--echo {
    color: #c2185b !important;
  }
  .receipt-invoice__doc-title--odonto {
    color: #e65100 !important;
  }
  .receipt-invoice--kind-examen .receipt-invoice__total-bar {
    background: #2e7d32 !important;
    border-color: #2e7d32;
  }
  .receipt-invoice--kind-radio .receipt-invoice__total-bar {
    background: #1565c0 !important;
    border-color: #1565c0;
  }
  .receipt-invoice--kind-echo .receipt-invoice__total-bar {
    background: #c2185b !important;
    border-color: #c2185b;
  }
  .receipt-invoice--kind-odonto .receipt-invoice__total-bar {
    background: #e65100 !important;
    border-color: #e65100;
  }
`

import { EXAM_KIND_LABELS, EXAM_KIND_ORDER, type ExamKindSlug } from '@/lib/exam-catalog/types'
import { formatPatientAge, normalizePatientAgeUnit, type PatientAgeUnit } from '@/lib/patient-age'
import { resolveLabExamInvoiceDocTitle } from '@/lib/lab-exam-pending'

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function buildGroupedExamInvoiceRows(examLines: LabExamInvoiceLine[]) {
  const renderRow = (line: LabExamInvoiceLine, kind: ExamKindSlug) => `
      <tr class="receipt-invoice__exam-row receipt-invoice__exam-row--${kind}">
        <td>${escapeHtml(line.label)}</td>
        <td>${formatFcfaPrint(line.amountFcfa)}</td>
      </tr>`

  if (examLines.length === 1) {
    const line = examLines[0]
    return renderRow(line, line.kind ?? 'examen')
  }

  const kinds = new Set(examLines.map((line) => line.kind ?? 'examen'))
  if (kinds.size === 1) {
    const kind = [...kinds][0]
    return examLines.map((line) => renderRow(line, kind)).join('')
  }

  const grouped: Record<ExamKindSlug, LabExamInvoiceLine[]> = {
    examen: [],
    radio: [],
    echo: [],
    odonto: [],
    operation: [],
    hospitalisation: [],
  }
  for (const line of examLines) {
    grouped[line.kind ?? 'examen'].push(line)
  }

  return EXAM_KIND_ORDER.flatMap((kind) => {
    const lines = grouped[kind]
    if (!lines.length) return []
    const header = `
      <tr class="receipt-invoice__type-header receipt-invoice__type-header--${kind}">
        <td colspan="2">${escapeHtml(EXAM_KIND_LABELS[kind])}</td>
      </tr>`
    const rows = lines
      .map(
        (line) => `
      <tr class="receipt-invoice__exam-row receipt-invoice__exam-row--${kind}">
        <td>${escapeHtml(line.label)}</td>
        <td>${formatFcfaPrint(line.amountFcfa)}</td>
      </tr>`,
      )
      .join('')
    return header + rows
  }).join('')
}

export type ConsultationReceiptData = {
  patientCode: string
  patientName: string
  doctorName: string
  amount: number
  reduction: number
  total: number
  invoiceNumber?: string
  date: string
  age?: number | null
  ageUnit?: PatientAgeUnit | null
  gender?: string | null
  phone?: string | null
}

function patientAgeLabel(age?: number | null, ageUnit?: PatientAgeUnit | null) {
  return formatPatientAge(age, normalizePatientAgeUnit(ageUnit ?? undefined))
}

function formatGender(gender?: string | null) {
  if (gender === 'F') return 'Féminin'
  if (gender === 'M') return 'Masculin'
  return null
}

function parseReceiptDateTime(dateStr: string, shortDate = false) {
  const match = dateStr.match(
    /(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/,
  )
  const date = match
    ? new Date(
        Number(match[3]),
        Number(match[2]) - 1,
        Number(match[1]),
        Number(match[4] ?? 0),
        Number(match[5] ?? 0),
        Number(match[6] ?? 0),
      )
    : new Date()

  return {
    date: shortDate
      ? date.toLocaleDateString('fr-FR')
      : date.toLocaleDateString('fr-FR', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        }),
    time: date.toLocaleTimeString('fr-FR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }),
  }
}

function labExamDensityClass(examCount: number) {
  if (examCount >= 10) return 'receipt-invoice--dense-xl'
  if (examCount >= 7) return 'receipt-invoice--dense'
  if (examCount >= 4) return 'receipt-invoice--compact'
  return ''
}

function receiptField(label: string, value: string) {
  return `<p class="receipt-invoice__field"><span class="receipt-invoice__label">${escapeHtml(label)} :</span> ${escapeHtml(value)}</p>`
}

export function buildConsultationReceiptHtml(data: ConsultationReceiptData): string {
  const { date, time } = parseReceiptDateTime(data.date)
  const genderLabel = formatGender(data.gender)
  const hasReduction = data.reduction > 0
  const consultNo = data.invoiceNumber ?? '—'

  const patientFields = [
    receiptField('Patient', data.patientName),
    receiptField('Matricule', data.patientCode),
    ...(genderLabel ? [receiptField('Sexe', genderLabel)] : []),
    ...(data.age != null ? [receiptField('Âge', patientAgeLabel(data.age, data.ageUnit) ?? '')] : []),
    ...(data.phone ? [receiptField('Tél.', data.phone)] : []),
  ].join('')

  const consultFields = [
    receiptField('Date', date),
    receiptField('Heure', time),
    receiptField('N° Consult', consultNo),
    receiptField('Statut', 'Payé'),
    receiptField('Nom de Médecin', data.doctorName),
  ].join('')

  const reductionRow = hasReduction
    ? `<tr class="receipt-invoice__summary receipt-invoice__summary--discount">
        <td colspan="3">Réduction</td>
        <td>- ${formatFcfaPrint(data.reduction)}</td>
      </tr>`
    : ''

  const serviceDescription = `Consultation médicale — ${data.doctorName}`

  return `
<div class="receipt-invoice">
  <header class="receipt-invoice__head">
    <div class="receipt-invoice__head-top">
      <img src="${CLINIC.logo}" alt="${escapeHtml(CLINIC.nameFr)}" class="receipt-invoice__logo" />
      <div class="receipt-invoice__titles">
        <p class="receipt-invoice__clinic-ar" dir="rtl" lang="ar">${escapeHtml(CLINIC.nameAr)}</p>
        <p class="receipt-invoice__clinic-name">${escapeHtml(CLINIC.nameFr)}</p>
      </div>
    </div>
    <div class="receipt-invoice__brand">
      <div class="receipt-invoice__contact-box">
        <p class="receipt-invoice__contact">${escapeHtml(CLINIC.fullAddress)}</p>
        <p class="receipt-invoice__contact">${escapeHtml(CLINIC.phones)}</p>
        <p class="receipt-invoice__contact">Email : ${escapeHtml(CLINIC.email)}</p>
      </div>
    </div>
  </header>

  <hr class="receipt-invoice__dash" />

  <div class="receipt-invoice__cols">
    <div class="receipt-invoice__box">${patientFields}</div>
    <div class="receipt-invoice__box">${consultFields}</div>
  </div>

  <h2 class="receipt-invoice__doc-title">Reçu de consultation</h2>

  <table class="receipt-invoice__table">
    <thead>
      <tr>
        <th>Description du service</th>
        <th>Qté</th>
        <th>Prix unitaire</th>
        <th>Total</th>
      </tr>
    </thead>
    <tbody>
      <tr class="receipt-invoice__service">
        <td>${escapeHtml(serviceDescription)}</td>
        <td>1</td>
        <td>${formatFcfaPrint(data.amount)}</td>
        <td>${formatFcfaPrint(data.amount)}</td>
      </tr>
      ${reductionRow}
    </tbody>
  </table>

  <div class="receipt-invoice__total-bar">
    <span>Total payé</span>
    <strong>${formatFcfaPrint(data.total)}</strong>
  </div>

  <p class="receipt-invoice__thanks">Merci de votre confiance</p>
</div>`
}

export type LabExamInvoiceLine = {
  label: string
  amountFcfa: number
  kind?: ExamKindSlug
}

export type LabExamInvoiceData = {
  patientCode: string
  patientName: string
  prescribedBy: string
  examLines: LabExamInvoiceLine[]
  grossFcfa: number
  reductionFcfa: number
  totalFcfa: number
  invoiceNumber?: string
  date: string
  status?: string
  docTitle?: string
  age?: number | null
  ageUnit?: PatientAgeUnit | null
  gender?: string | null
  phone?: string | null
  kindComment?: string
  processedBy?: string
}

export function buildLabExamInvoiceHtml(data: LabExamInvoiceData): string {
  const examCount = data.examLines.length
  const density = labExamDensityClass(examCount)
  const shortDate = examCount >= 4
  const { date, time } = parseReceiptDateTime(data.date, shortDate)
  const genderLabel = formatGender(data.gender)
  const hasReduction = data.reductionFcfa > 0
  const invoiceNo = data.invoiceNumber ?? '—'
  const status = data.status ?? 'Payé'
  const docTitle =
    data.docTitle ??
    resolveLabExamInvoiceDocTitle(
      data.examLines.map((line) => ({
        label: line.label,
        unitPriceFcfa: line.amountFcfa,
        kind: line.kind,
      })),
    )
  const totalLabel = status === 'Payé' ? 'Total payé' : 'Total à payer'
  const invoiceKinds = new Set(data.examLines.map((line) => line.kind ?? 'examen'))
  const singleKind = invoiceKinds.size === 1 ? [...invoiceKinds][0] : null
  const kindClass = singleKind ? ` receipt-invoice--kind-${singleKind}` : ''
  const docTitleClass = singleKind ? `receipt-invoice__doc-title--${singleKind}` : 'receipt-invoice__doc-title--mixed'

  const patientFields = [
    receiptField('Patient', data.patientName),
    receiptField('Matricule', data.patientCode),
    ...(genderLabel ? [receiptField('Sexe', genderLabel)] : []),
    ...(data.age != null ? [receiptField('Âge', patientAgeLabel(data.age, data.ageUnit) ?? '')] : []),
    ...(data.phone ? [receiptField('Tél.', data.phone)] : []),
  ].join('')

  const invoiceFields = [
    receiptField('Date', date),
    receiptField('Heure', time),
    receiptField('N° facture', invoiceNo),
    receiptField('Statut', status),
    receiptField('Prescrit par', data.prescribedBy),
    ...(data.processedBy ? [receiptField('Encaissé par', data.processedBy)] : []),
  ].join('')

  const examRows = buildGroupedExamInvoiceRows(data.examLines)

  const reductionRow = hasReduction
    ? `<tr class="receipt-invoice__summary receipt-invoice__summary--discount">
        <td>Réduction</td>
        <td>- ${formatFcfaPrint(data.reductionFcfa)}</td>
      </tr>`
    : ''

  const kindComment = data.kindComment?.trim()
  const kindCommentBlock = kindComment
    ? `<div class="receipt-invoice__kind-comment"><strong>Commentaire médecin</strong>${escapeHtml(kindComment)}</div>`
    : ''

  return `
<div class="receipt-invoice receipt-invoice--exam-a5 ${density}${kindClass}">
  <header class="receipt-invoice__head">
    <div class="receipt-invoice__head-top">
      <img src="${CLINIC.logo}" alt="${escapeHtml(CLINIC.nameFr)}" class="receipt-invoice__logo" />
      <div class="receipt-invoice__titles">
        <p class="receipt-invoice__clinic-ar" dir="rtl" lang="ar">${escapeHtml(CLINIC.nameAr)}</p>
        <p class="receipt-invoice__clinic-name">${escapeHtml(CLINIC.nameFr.toUpperCase())}</p>
      </div>
    </div>
    <div class="receipt-invoice__brand">
      <div class="receipt-invoice__contact-box">
        <p class="receipt-invoice__contact">${escapeHtml(CLINIC.fullAddress)}</p>
        <p class="receipt-invoice__contact">${escapeHtml(CLINIC.phones)}</p>
        <p class="receipt-invoice__contact">Email : ${escapeHtml(CLINIC.email)}</p>
      </div>
    </div>
  </header>

  <hr class="receipt-invoice__dash" />

  <div class="receipt-invoice__cols">
    <div class="receipt-invoice__box">${patientFields}</div>
    <div class="receipt-invoice__box">${invoiceFields}</div>
  </div>

  <h2 class="receipt-invoice__doc-title ${docTitleClass}">${escapeHtml(docTitle)}</h2>

  <table class="receipt-invoice__table receipt-invoice__table--exams">
    <thead>
      <tr>
        <th>Examen</th>
        <th>Montant</th>
      </tr>
    </thead>
    <tbody>
      ${examRows}
      ${reductionRow}
    </tbody>
  </table>

  <div class="receipt-invoice__total-bar">
    <span>${escapeHtml(totalLabel)}</span>
    <strong>${formatFcfaPrint(data.totalFcfa)}</strong>
  </div>

  ${kindCommentBlock}

  <p class="receipt-invoice__thanks">Merci de votre confiance</p>
</div>`
}

export function buildClinicPrintHeader(docTitle?: string): string {
  const title = docTitle ? `<p class="doc-title">${docTitle}</p>` : ''
  return `
  <div class="clinic-header">
    <img src="${CLINIC.logo}" alt="${CLINIC.nameFr}" class="clinic-logo" />
    <div class="clinic-info">
      <h1>${CLINIC.nameFr}</h1>
      <p class="clinic-ar" dir="rtl" lang="ar">${CLINIC.nameAr}</p>
      <p class="clinic-contact">${CLINIC.fullAddress}</p>
      <p class="clinic-contact">${CLINIC.phoneLabel}</p>
      <p class="clinic-contact">Email : ${CLINIC.email}</p>
      ${title}
    </div>
  </div>`
}

export type OpenPrintOptions = {
  autoPrint?: boolean
  pageSize?: 'A5' | 'A4'
}

export function openPrintDocument(
  title: string,
  bodyHtml: string,
  autoPrintOrOptions: boolean | OpenPrintOptions = true,
) {
  const options: OpenPrintOptions =
    typeof autoPrintOrOptions === 'boolean'
      ? { autoPrint: autoPrintOrOptions }
      : { autoPrint: true, ...autoPrintOrOptions }

  const isA5 = options.pageSize === 'A5'
  const isA4 = options.pageSize === 'A4'
  const bodyClass = isA5 ? ' class="print-a5"' : isA4 ? ' class="print-a4"' : ''
  const windowSize = isA5 ? 'width=520,height=740' : isA4 ? 'width=850,height=1100' : 'width=820,height=900'
  const printWindow = window.open('', '_blank', windowSize)
  if (!printWindow) return

  const script =
    options.autoPrint !== false
      ? `<script>window.onload = () => { window.print(); window.close(); }<\/script>`
      : ''

  printWindow.document.write(`<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"><title>${title}</title>
<style>${CLINIC_PRINT_STYLES}</style></head><body${bodyClass}>
${bodyHtml}
${script}
</body></html>`)
  printWindow.document.close()
}
