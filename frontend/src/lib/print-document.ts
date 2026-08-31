import { CLINIC, clinicTaxLine } from './clinic'
import { formatFcfa, formatFcfaShort } from './format-fcfa'
import { getAppLocale, translateUi, translateUiLocale } from '@/i18n/translate'
import { formatAppDate, formatAppTime, intlLocaleFor } from '@/i18n/locale-format'
import {
  extractBasePanelLabel,
  normalizeLabLabelKey,
} from '@/lib/lab-prescribed-panels'

const formatFcfaPrint = formatFcfa
const t = translateUi

/**
 * Libellés ticket thermique FR + AR (indépendant de la langue UI).
 * Lignes : FR à gauche · valeur au centre · AR à droite.
 */
export function thermalAr(text: string | null | undefined): string {
  if (text == null) return ''
  const fr = text.trim()
  if (!fr) return ''
  const ar = translateUiLocale(fr, 'ar').trim()
  return ar && ar !== fr ? ar : ''
}

export function thermalBi(text: string | null | undefined): string {
  if (text == null) return ''
  const fr = text.trim()
  if (!fr) return ''
  const ar = thermalAr(fr)
  if (!ar) return fr
  return `${ar} / ${fr}`
}

export function thermalBiTemplate(templateFr: string, params: Record<string, string | number>): string {
  let fr = templateFr
  for (const [key, value] of Object.entries(params)) {
    fr = fr.replaceAll(`{${key}}`, String(value))
  }
  return fr
}

export function thermalArTemplate(templateFr: string, params: Record<string, string | number>): string {
  let ar = translateUiLocale(templateFr, 'ar')
  for (const [key, value] of Object.entries(params)) {
    ar = ar.replaceAll(`{${key}}`, String(value))
  }
  return ar && ar !== templateFr ? ar : ''
}

export const CLINIC_PRINT_STYLES = `
  * { box-sizing: border-box; }
  /* margin 0 : évite l’en-tête/pied navigateur (date, about:blank, 1/1) */
  @page { margin: 0; }
  @page print-a5 {
    size: A5 portrait;
    margin: 0;
  }
  @page print-a4 {
    size: A4 portrait;
    margin: 0;
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
    padding: 8mm 10mm;
  }
  body.print-a4 {
    page: print-a4;
    max-width: none;
    width: 100%;
    padding: 12mm 14mm;
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
    position: relative;
    display: block;
    border-bottom: 2px dashed #ccc;
    padding: 0 88px 14px;
    margin-bottom: 16px;
    min-height: 80px;
    text-align: center;
  }
  .clinic-logo {
    position: absolute;
    left: 0;
    top: 0;
    width: 76px;
    height: 76px;
    object-fit: contain;
  }
  .clinic-logo--right {
    left: auto;
    right: 0;
  }
  .clinic-header--dual-logo {
    padding-left: 88px;
    padding-right: 88px;
  }
  .clinic-info {
    text-align: center;
  }
  .clinic-info h1 {
    margin: 0 0 4px;
    font-size: 18px;
    line-height: 1.3;
  }
  .clinic-ar {
    margin: 0 0 6px;
    font-size: 14px;
    color: #334155;
    font-family: 'Noto Naskh Arabic', 'Amiri', 'Tahoma', 'Arial', sans-serif;
  }
  .clinic-contact {
    margin: 0 0 2px;
    font-size: 12px;
    color: #475569;
    line-height: 1.45;
  }
  .doc-title {
    margin: 10px 0 0;
    font-size: 13px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #0f766e;
    text-align: center;
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
    font-size: 16px;
    font-weight: 800;
    color: #3e6640;
    line-height: 1.25;
    letter-spacing: 0.01em;
    text-align: center;
    white-space: nowrap;
  }
  .receipt-invoice__clinic-ar {
    margin: 0 0 6px;
    font-size: 15px;
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
    font-size: 12px;
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
  .receipt-invoice__meta {
    margin: 0 0 4px;
  }
  .receipt-invoice__meta-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    column-gap: 18px;
    row-gap: 4px;
  }
  .receipt-invoice__field {
    margin: 0;
    font-size: 12px;
    line-height: 1.4;
    color: #111;
  }
  .receipt-invoice__label {
    color: #3e6640;
    font-weight: 700;
  }
  .receipt-invoice__inline {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
    margin: 8px 0 0;
    padding: 6px 0;
    border-top: 1px solid #bdbdbd;
    border-bottom: 1px solid #bdbdbd;
    font-size: 11px;
    color: #111;
  }
  .receipt-invoice__inline--under-title {
    justify-content: center;
    margin: 0 0 10px;
    border-top: none;
    padding-top: 0;
  }
  .receipt-invoice__inline span {
    white-space: nowrap;
  }
  .receipt-invoice__lines {
    margin: 0 0 0;
  }
  .receipt-invoice__line {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 12px;
    padding: 7px 2px;
    border-bottom: 1px solid #cfcfcf;
    font-size: 12px;
    color: #111;
  }
  .receipt-invoice__line > span:first-child {
    flex: 1;
    min-width: 0;
  }
  .receipt-invoice__line > strong {
    flex-shrink: 0;
    white-space: nowrap;
    font-weight: 700;
    text-align: right;
  }
  .receipt-invoice__line--head {
    font-weight: 700;
    color: #fff;
    background: #3e6640 !important;
    border-bottom: 1px solid #3e6640;
    padding: 8px 10px;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .receipt-invoice__line--head > span,
  .receipt-invoice__line--head > strong {
    color: #fff !important;
  }
  .receipt-invoice__line--section {
    justify-content: center;
    font-weight: 700;
    background: #f3f3f3;
    border-bottom: 1px solid #bdbdbd;
  }
  .receipt-invoice__line--summary {
    font-weight: 600;
  }
  .receipt-invoice__line--discount > strong {
    color: #e65100;
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

  .receipt-invoice__type-header {
    font-weight: 700;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .receipt-invoice__type-header--examen {
    background: #e8f5e9 !important;
    color: #2e7d32;
  }
  .receipt-invoice__type-header--radio {
    background: #e3f2fd !important;
    color: #1565c0;
  }
  .receipt-invoice__type-header--echo {
    background: #fce4ec !important;
    color: #c2185b;
  }
  .receipt-invoice__type-header--odonto {
    background: #fff3e0 !important;
    color: #e65100;
  }
  .receipt-invoice__exam-row--examen {
    border-left: 3px solid #2e7d32;
    padding-left: 8px;
  }
  .receipt-invoice__exam-row--radio {
    border-left: 3px solid #1565c0;
    padding-left: 8px;
  }
  .receipt-invoice__exam-row--echo {
    border-left: 3px solid #c2185b;
    padding-left: 8px;
  }
  .receipt-invoice__exam-row--odonto {
    border-left: 3px solid #e65100;
    padding-left: 8px;
  }

  .receipt-invoice--exam-a5 .receipt-invoice__line {
    font-size: 11px;
    padding: 5px 2px;
  }
  .receipt-invoice--exam-a5.receipt-invoice--compact .receipt-invoice__line {
    font-size: 10px;
    padding: 4px 2px;
  }
  .receipt-invoice--exam-a5.receipt-invoice--dense .receipt-invoice__line {
    font-size: 9px;
    padding: 3px 2px;
  }
  .receipt-invoice--exam-a5.receipt-invoice--dense-xl .receipt-invoice__line {
    font-size: 8px;
    padding: 2px 2px;
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

  /* Ticket thermique 80 mm — portrait (hauteur > largeur), jamais "auto"/A4. */
  @page print-thermal {
    size: 80mm 110mm;
    margin: 0;
  }
  body.print-thermal {
    page: print-thermal;
    max-width: 80mm;
    width: 80mm;
    margin: 0 !important;
    /* Peu de marge : le papier 80 mm a déjà une zone non imprimable matérielle */
    padding: 0.5mm 1.5mm 2mm !important;
    min-height: 0 !important;
    height: auto !important;
    font-family: Arial, 'Segoe UI', Helvetica, sans-serif;
    font-size: 10px;
    font-weight: 400;
    line-height: 1.3;
    color: #000;
    overflow: visible !important;
    -webkit-font-smoothing: none;
    text-rendering: geometricPrecision;
  }
  body.print-thermal .thermal-receipt {
    width: 100%;
    margin: 0;
    padding: 0;
  }
  body.print-thermal .thermal-receipt__cut {
    display: block;
    height: 0;
    margin: 0;
    padding: 0;
    border: 0;
    overflow: hidden;
    line-height: 0;
    font-size: 0;
  }
  body.print-thermal .thermal-receipt__head {
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    text-align: left;
    margin-bottom: 2px;
  }
  body.print-thermal .thermal-receipt__brand {
    flex: 1;
    min-width: 0;
    text-align: left;
  }
  body.print-thermal .thermal-receipt__logo {
    display: block;
    width: 32px;
    height: 32px;
    object-fit: contain;
    margin: 0;
    flex-shrink: 0;
  }
  body.print-thermal .thermal-receipt__name-ar {
    margin: 0;
    font-size: 10px;
    font-weight: 600;
    font-family: 'Noto Naskh Arabic', 'Amiri', Tahoma, Arial, sans-serif;
    line-height: 1.2;
  }
  body.print-thermal .thermal-receipt__name {
    margin: 1px 0 0;
    font-size: 9px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.01em;
    line-height: 1.2;
  }
  body.print-thermal .thermal-receipt__contact {
    margin: 1px 0 0;
    font-size: 8px;
    font-weight: 400;
    line-height: 1.2;
  }
  body.print-thermal .thermal-receipt__rule {
    border: 0;
    border-top: 1px dashed #000;
    margin: 3px 0;
  }
  body.print-thermal .thermal-receipt__title-row {
    margin: 2px 0 1px;
  }
  body.print-thermal .thermal-receipt__title {
    margin: 0;
    font-size: 10px;
    font-weight: 600;
    text-align: left;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    line-height: 1.2;
  }
  body.print-thermal .thermal-receipt__subtitle {
    display: none;
  }
  body.print-thermal .thermal-receipt__datetime {
    margin: 1px 0 0;
    font-size: 9px;
    font-weight: 400;
    text-align: left;
    line-height: 1.2;
  }
  body.print-thermal .thermal-receipt__title + .thermal-receipt__subtitle + .thermal-receipt__inline,
  body.print-thermal .thermal-receipt__subtitle + .thermal-receipt__inline {
    justify-content: flex-start;
    border-top: none;
    margin-top: 2px;
    margin-bottom: 0;
    padding-bottom: 0;
  }
  body.print-thermal .thermal-receipt table {
    width: 100%;
    border-collapse: collapse;
    margin: 3px 0;
    font-size: 9px;
    font-weight: 400;
  }
  body.print-thermal .thermal-receipt th,
  body.print-thermal .thermal-receipt td {
    border: none;
    border-bottom: 1px dotted #666;
    padding: 2px 0;
    vertical-align: top;
    text-align: left;
  }
  body.print-thermal .thermal-receipt th {
    font-weight: 500;
    width: auto;
    padding-right: 0.35em;
    white-space: nowrap;
  }
  body.print-thermal .thermal-receipt td {
    text-align: left;
    white-space: normal;
  }
  body.print-thermal .print-invoice-page + .print-invoice-page {
    margin-top: 8px;
  }
  body.print-thermal .thermal-receipt__thanks {
    margin: 4px 0 0;
    text-align: center;
    font-size: 9px;
    font-weight: 500;
  }
  body.print-thermal .thermal-receipt__note {
    margin: 3px 0 0;
    font-size: 9px;
    font-weight: 400;
  }
  body.print-thermal .thermal-receipt__fields {
    margin: 3px 0;
  }
  body.print-thermal .thermal-receipt__row,
  body.print-thermal .thermal-receipt__line {
    display: flex;
    flex-direction: row;
    align-items: baseline;
    justify-content: space-between;
    gap: 4px;
    direction: ltr;
    margin: 2px 0;
    font-size: 9px;
    font-weight: 400;
    text-align: left;
    white-space: normal;
  }
  body.print-thermal .thermal-receipt__line {
    padding: 2px 0;
    border-bottom: 1px dotted #000;
  }
  body.print-thermal .thermal-receipt__label-fr {
    flex: 1 1 0;
    min-width: 0;
    text-align: left;
    direction: ltr;
    unicode-bidi: isolate;
  }
  body.print-thermal .thermal-receipt__value {
    flex: 0 1 auto;
    max-width: 42%;
    text-align: center;
    font-weight: 500;
    direction: ltr !important;
    unicode-bidi: isolate;
    white-space: nowrap;
  }
  body.print-thermal .thermal-receipt__label-ar {
    flex: 1 1 0;
    min-width: 0;
    text-align: right;
    direction: rtl;
    unicode-bidi: isolate;
    font-family: 'Noto Naskh Arabic', 'Amiri', Tahoma, Arial, sans-serif;
  }
  body.print-thermal .thermal-receipt__row--stack {
    display: flex;
  }
  body.print-thermal .thermal-receipt__inline {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 10px;
    margin: 4px 0;
    padding: 3px 0;
    border-top: 1px solid #000;
    border-bottom: 1px solid #000;
    font-size: 9px;
    font-weight: 500;
    line-height: 1.3;
    justify-content: flex-start;
    text-align: left;
  }
  body.print-thermal .thermal-receipt__inline span {
    white-space: nowrap;
  }
  body.print-thermal .thermal-receipt__lines {
    margin: 3px 0;
  }
  body.print-thermal .thermal-receipt__line--head {
    font-weight: 600;
    border-bottom: 1px solid #000;
  }
  body.print-thermal .thermal-receipt__line--section {
    font-weight: 600;
    margin-top: 3px;
    border-bottom: 1px solid #000;
  }
  body.print-thermal .thermal-receipt__line--total {
    font-weight: 600;
    border-bottom: none;
    border-top: 1px solid #000;
    margin-top: 2px;
    padding-top: 3px;
  }
  body.print-thermal .thermal-receipt__title-bi {
    display: flex;
    flex-direction: row;
    justify-content: space-between;
    align-items: baseline;
    gap: 4px;
    direction: ltr;
  }
  body.print-thermal .thermal-receipt__title--fr {
    flex: 1;
    text-align: left;
    text-transform: uppercase;
  }
  body.print-thermal .thermal-receipt__title--ar {
    flex: 1;
    text-align: right;
    text-transform: none;
    font-family: 'Noto Naskh Arabic', 'Amiri', Tahoma, Arial, sans-serif;
  }
  body.print-thermal .thermal-receipt__subtitle-no {
    margin: 1px 0 0;
    font-size: 9px;
    font-weight: 500;
    text-align: center;
    direction: ltr;
    unicode-bidi: isolate;
  }
  body.print-thermal .thermal-receipt__datetime {
    text-align: center !important;
    direction: ltr !important;
    unicode-bidi: isolate;
  }

  /* Tickets thermiques — Arial, titre + n° + logo */
  body.print-thermal .thermal-receipt--ticket {
    font-family: Arial, Helvetica, sans-serif !important;
    font-size: 11px;
    line-height: 1.3;
  }
  body.print-thermal .thermal-receipt--ticket .thermal-receipt__ticket-head {
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 2px;
  }
  body.print-thermal .thermal-receipt--ticket .thermal-receipt__ticket-head-text {
    flex: 1;
    min-width: 0;
    text-align: left;
  }
  body.print-thermal .thermal-receipt--ticket .thermal-receipt__ticket-title-line {
    display: flex;
    flex-direction: row;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 6px;
  }
  body.print-thermal .thermal-receipt--ticket .thermal-receipt__title,
  body.print-thermal .thermal-receipt--ticket .thermal-receipt__title--fr {
    font-family: Arial, Helvetica, sans-serif !important;
    font-size: 12px;
    font-weight: 700;
    margin: 0;
    text-transform: none;
    letter-spacing: 0;
  }
  body.print-thermal .thermal-receipt--ticket .thermal-receipt__subtitle-no {
    font-family: Arial, Helvetica, sans-serif !important;
    font-size: 11px;
    font-weight: 700;
    margin: 0;
  }
  body.print-thermal .thermal-receipt--ticket .thermal-receipt__contact {
    font-family: Arial, Helvetica, sans-serif !important;
    font-size: 9px;
    margin: 2px 0 0;
  }
  body.print-thermal .thermal-receipt--ticket .thermal-receipt__logo {
    width: 64px;
    height: 64px;
    flex-shrink: 0;
    object-fit: contain;
  }
  body.print-thermal .thermal-receipt--ticket .thermal-receipt__row,
  body.print-thermal .thermal-receipt--ticket .thermal-receipt__line {
    font-family: Arial, Helvetica, sans-serif !important;
    font-size: 10px;
    margin: 3px 0;
  }
  body.print-thermal .thermal-receipt--ticket .thermal-receipt__label-ar {
    font-family: Arial, Helvetica, sans-serif !important;
  }
  body.print-thermal .thermal-receipt--ticket .thermal-receipt__value {
    font-size: 10px;
    font-weight: 700;
  }
  body.print-thermal .thermal-receipt--ticket .thermal-receipt__line--total,
  body.print-thermal .thermal-receipt--ticket .thermal-receipt__row--total {
    font-size: 12px;
    font-weight: 700;
  }
  body.print-thermal .thermal-receipt--ticket .thermal-receipt__thanks {
    font-size: 11px;
    font-weight: 700;
  }
  body.print-thermal .thermal-receipt--ticket .thermal-receipt__note {
    font-size: 9px;
  }

  /* Tableau pharmacie : Produit | Qté | PU | PT + Total en pied */
  body.print-thermal .thermal-receipt__items-table {
    width: 100%;
    border-collapse: collapse;
    margin: 2px 0 0;
    font-family: Arial, Helvetica, sans-serif !important;
    font-size: 9px;
    table-layout: fixed;
  }
  body.print-thermal .thermal-receipt__items-table th,
  body.print-thermal .thermal-receipt__items-table td {
    border: none;
    padding: 2px 2px;
    vertical-align: top;
    font-family: Arial, Helvetica, sans-serif !important;
  }
  body.print-thermal .thermal-receipt__items-table thead th {
    font-weight: 700;
    white-space: nowrap;
  }
  body.print-thermal .thermal-receipt__items-table .col-product {
    width: 42%;
    text-align: left;
    word-wrap: break-word;
    overflow-wrap: anywhere;
  }
  body.print-thermal .thermal-receipt__items-table .col-qty {
    width: 12%;
    text-align: center;
    white-space: nowrap;
  }
  body.print-thermal .thermal-receipt__items-table .col-pu,
  body.print-thermal .thermal-receipt__items-table .col-pt {
    width: 23%;
    text-align: right;
    white-space: nowrap;
  }
  body.print-thermal .thermal-receipt__items-table tfoot td {
    border: none;
    font-weight: 700;
    padding-top: 3px;
  }
  body.print-thermal .thermal-receipt__items-table tfoot .col-total-label {
    text-align: left;
  }
  body.print-thermal .thermal-receipt__items-table tfoot .col-total-value {
    text-align: right;
    white-space: nowrap;
  }
  body.print-thermal .thermal-receipt__items-table tfoot tr.thermal-receipt__items-sub td {
    font-weight: 400;
  }
  body.print-thermal .thermal-receipt--pharmacy .thermal-receipt__thanks {
    margin: 3px 0 0;
    padding: 0;
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

function emptyExamLinesByKind(): Record<ExamKindSlug, LabExamInvoiceLine[]> {
  return Object.fromEntries(EXAM_KIND_ORDER.map((kind) => [kind, [] as LabExamInvoiceLine[]])) as Record<
    ExamKindSlug,
    LabExamInvoiceLine[]
  >
}

function thermalLabelWithColon(label: string) {
  const trimmed = label.trim()
  if (!trimmed) return ''
  return /[:：]\s*$/.test(trimmed) ? trimmed : `${trimmed} :`
}

/**
 * Ligne ticket : libellé FR à gauche · contenu (chiffre) au centre · libellé AR à droite.
 * `labelFr` = clé française (ex. « Montant ») — traduction AR automatique.
 */
export function thermalMetaRow(labelFr: string, value: string, labelAr?: string) {
  const fr = thermalLabelWithColon(labelFr)
  const arRaw = (labelAr ?? thermalAr(labelFr)).trim()
  const ar = arRaw ? thermalLabelWithColon(arRaw) : ''
  const arCell = ar
    ? `<span class="thermal-receipt__label-ar" dir="rtl" lang="ar">${escapeHtml(ar)}</span>`
    : `<span class="thermal-receipt__label-ar" aria-hidden="true"></span>`
  return `<div class="thermal-receipt__row">
  <span class="thermal-receipt__label-fr" dir="ltr">${escapeHtml(fr)}</span>
  <strong class="thermal-receipt__value" dir="ltr">${escapeHtml(value)}</strong>
  ${arCell}
</div>`
}

export type PharmacyTicketLine = {
  name: string
  quantity: number
  unitPriceFcfa: number
  lineTotalFcfa: number
}

/** Tableau ticket pharmacie : Produit, Qté, PU, PT + Total (et réductions éventuelles) en pied. */
export function buildPharmacyTicketItemsTableHtml(options: {
  lines: PharmacyTicketLine[]
  totalFcfa: number
  grossTotalFcfa?: number
  reductionFcfa?: number
  reductionLabel?: string
}) {
  const fmt = formatFcfaShort
  const rows = options.lines
    .map(
      (line) => `<tr>
  <td class="col-product" dir="ltr">${escapeHtml(line.name)}</td>
  <td class="col-qty" dir="ltr">${escapeHtml(String(line.quantity))}</td>
  <td class="col-pu" dir="ltr">${escapeHtml(fmt(line.unitPriceFcfa))}</td>
  <td class="col-pt" dir="ltr">${escapeHtml(fmt(line.lineTotalFcfa))}</td>
</tr>`,
    )
    .join('')

  const reductionFcfa = options.reductionFcfa ?? 0
  const grossTotal = options.grossTotalFcfa ?? options.totalFcfa
  const reductionLabel = options.reductionLabel?.trim() || 'Réduction'
  const subRows =
    reductionFcfa > 0
      ? `<tr class="thermal-receipt__items-sub">
  <td class="col-total-label" colspan="3" dir="ltr">Sous-total</td>
  <td class="col-total-value" dir="ltr">${escapeHtml(fmt(grossTotal))}</td>
</tr>
<tr class="thermal-receipt__items-sub">
  <td class="col-total-label" colspan="3" dir="ltr">${escapeHtml(reductionLabel)}</td>
  <td class="col-total-value" dir="ltr">- ${escapeHtml(fmt(reductionFcfa))}</td>
</tr>`
      : ''

  return `<table class="thermal-receipt__items-table" dir="ltr">
  <thead>
    <tr>
      <th class="col-product">Produit</th>
      <th class="col-qty">Qté</th>
      <th class="col-pu">PU</th>
      <th class="col-pt">PT</th>
    </tr>
  </thead>
  <tbody>
    ${rows}
  </tbody>
  <tfoot>
    ${subRows}
    <tr>
      <td class="col-total-label" colspan="3" dir="ltr">Total</td>
      <td class="col-total-value" dir="ltr">${escapeHtml(fmt(options.totalFcfa))}</td>
    </tr>
  </tfoot>
</table>`
}

/** En-tête ticket : titre + n° à gauche, logo à droite. */
export function buildThermalTicketHeadHtml(options: {
  title: string
  number?: string | null
  contact?: string
  logo?: string
}) {
  const title = options.title.trim()
  const number = (options.number ?? '').trim()
  const contact = options.contact ?? `${CLINIC.city} · ${CLINIC.phones}`
  const logo = options.logo ?? CLINIC.logo
  return `<header class="thermal-receipt__ticket-head">
  <div class="thermal-receipt__ticket-head-text">
    <div class="thermal-receipt__ticket-title-line">
      <h1 class="thermal-receipt__title thermal-receipt__title--fr" dir="ltr">${escapeHtml(title)}</h1>
      ${number ? `<p class="thermal-receipt__subtitle-no" dir="ltr">${escapeHtml(number)}</p>` : ''}
    </div>
    <p class="thermal-receipt__contact" dir="ltr">${escapeHtml(contact)}</p>
  </div>
  <img src="${logo}" alt="" class="thermal-receipt__logo" />
</header>`
}

/** En-tête compact : infos à gauche, logo à droite (moins de papier). */
export function buildThermalClinicHeaderHtml(options?: {
  name?: string
  nameAr?: string
  contact?: string
  logo?: string
}) {
  const name = options?.name ?? CLINIC.shortName
  const nameAr = options?.nameAr ?? CLINIC.nameAr
  const contact = options?.contact ?? `${CLINIC.city} · ${CLINIC.phones}`
  const logo = options?.logo ?? CLINIC.logo
  return `<header class="thermal-receipt__head">
  <div class="thermal-receipt__brand">
    <p class="thermal-receipt__name-ar" dir="rtl" lang="ar">${escapeHtml(nameAr)}</p>
    <p class="thermal-receipt__name" dir="ltr">${escapeHtml(name)}</p>
    <p class="thermal-receipt__contact" dir="ltr">${escapeHtml(contact)}</p>
  </div>
  <img src="${logo}" alt="${escapeHtml(CLINIC.nameFr)}" class="thermal-receipt__logo" />
</header>`
}

function buildGroupedExamInvoiceRows(examLines: LabExamInvoiceLine[]) {
  const summaryLines = summarizeExamLinesByPanel(examLines)
  const renderRow = (line: LabExamInvoiceLine, kind: ExamKindSlug) => `
      <div class="receipt-invoice__line receipt-invoice__exam-row receipt-invoice__exam-row--${kind}">
        <span>${escapeHtml(t(line.label))}</span>
        <strong>${formatFcfaPrint(line.amountFcfa)}</strong>
      </div>`

  if (summaryLines.length === 1) {
    const line = summaryLines[0]
    return renderRow(line, line.kind ?? 'examen')
  }

  const kinds = new Set(summaryLines.map((line) => line.kind ?? 'examen'))
  if (kinds.size === 1) {
    const kind = [...kinds][0] as ExamKindSlug
    return summaryLines.map((line) => renderRow(line, kind)).join('')
  }

  const grouped = emptyExamLinesByKind()
  for (const line of summaryLines) {
    grouped[line.kind ?? 'examen'].push(line)
  }

  return EXAM_KIND_ORDER.flatMap((kind) => {
    const lines = grouped[kind]
    if (!lines.length) return []
    const header = `
      <div class="receipt-invoice__line receipt-invoice__line--section receipt-invoice__type-header receipt-invoice__type-header--${kind}">
        <span>${escapeHtml(t(EXAM_KIND_LABELS[kind]))}</span>
      </div>`
    return header + lines.map((line) => renderRow(line, kind)).join('')
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
  processedBy?: string
}

function patientAgeLabel(age?: number | null, ageUnit?: PatientAgeUnit | null) {
  return formatPatientAge(age, normalizePatientAgeUnit(ageUnit ?? undefined))
}

function formatGender(gender?: string | null) {
  if (gender === 'F') return t('Féminin')
  if (gender === 'M') return t('Masculin')
  return null
}

function parseReceiptDateTime(dateStr: string, shortDate = false) {
  const match = dateStr.match(
    /(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/,
  )
  const parsed = match
    ? new Date(
        Number(match[3]),
        Number(match[2]) - 1,
        Number(match[1]),
        Number(match[4] ?? 0),
        Number(match[5] ?? 0),
        Number(match[6] ?? 0),
      )
    : new Date(dateStr)
  const date = Number.isNaN(parsed.getTime()) ? new Date() : parsed
  const locale = intlLocaleFor()

  return {
    date: shortDate
      ? formatAppDate(date)
      : date.toLocaleDateString(locale, {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        }),
    shortDate: formatAppDate(date),
    time: formatAppTime(date, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }),
    timeShort: formatAppTime(date, {
      hour: '2-digit',
      minute: '2-digit',
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
  return `<p class="receipt-invoice__field"><span class="receipt-invoice__label">${escapeHtml(t(label))} :</span> ${escapeHtml(value)}</p>`
}

function translateStatus(status: string) {
  return t(status)
}

export function buildConsultationReceiptHtml(data: ConsultationReceiptData): string {
  const { shortDate, timeShort } = parseReceiptDateTime(data.date, true)
  const consultNo = data.invoiceNumber ?? '—'
  const dateLabel = `${shortDate} ${timeShort}`
  const grossFcfa = data.amount > 0 ? data.amount : data.total + Math.max(0, data.reduction)
  const reductionFcfa = Math.max(0, data.reduction)
  const netFcfa = data.total > 0 ? data.total : Math.max(0, grossFcfa - reductionFcfa)

  const metaRows = [
    thermalMetaRow('Date', dateLabel, ''),
    thermalMetaRow('Patient', data.patientName, ''),
    thermalMetaRow('Médecin', data.doctorName, ''),
    ...(data.processedBy ? [thermalMetaRow('Par', data.processedBy, '')] : []),
  ].join('')

  const priceRows = [
    thermalMetaRow('Prix consultation', formatFcfaPrint(grossFcfa), ''),
    ...(reductionFcfa > 0 ? [thermalMetaRow('Réduction', `- ${formatFcfaPrint(reductionFcfa)}`, '')] : []),
    thermalMetaRow('Net payé', formatFcfaPrint(netFcfa), ''),
  ].join('')

  return `
<div class="thermal-receipt thermal-receipt--ticket">
  ${buildThermalTicketHeadHtml({ title: 'Reçu de consultation', number: consultNo })}
  <hr class="thermal-receipt__rule" />

  <div class="thermal-receipt__fields">
    ${metaRows}
  </div>

  <hr class="thermal-receipt__rule" />
  <div class="thermal-receipt__fields">
    ${priceRows}
  </div>

  <hr class="thermal-receipt__rule" />
  <p class="thermal-receipt__thanks" style="font-weight:700;">Payé</p>
  <p class="thermal-receipt__thanks">Merci</p>
</div>`
}

export type DayClosureReceiptData = {
  businessDate: string
  closedAt: string
  receptionistName: string
  shiftLabel?: string | null
  collectedFcfa: number
  expensesFcfa: number
  netFcfa: number
  visitsToday: number
  registeredToday: number
  consultationsFcfa?: number
  examsFcfa?: number
  surgeryFcfa?: number
  hospitalizationFcfa?: number
}

export function buildDayClosureReceiptHtml(data: DayClosureReceiptData): string {
  const closed = parseReceiptDateTime(data.closedAt)
  const dateShort = new Date(`${data.businessDate}T12:00:00`).toLocaleDateString('fr-FR')

  const metaRows = [
    thermalMetaRow('Date', dateShort, ''),
    thermalMetaRow('Clôturé', `${closed.shortDate} ${closed.timeShort}`, ''),
    thermalMetaRow('Par', data.receptionistName, ''),
    ...(data.shiftLabel ? [thermalMetaRow('Créneau', data.shiftLabel, '')] : []),
    thermalMetaRow('Inscriptions', String(data.registeredToday), ''),
    thermalMetaRow('Passages', String(data.visitsToday), ''),
  ].join('')

  const detailRows = [
    data.consultationsFcfa != null && data.consultationsFcfa > 0
      ? thermalMetaRow('Consultations', formatFcfaPrint(data.consultationsFcfa), '')
      : '',
    data.examsFcfa != null && data.examsFcfa > 0
      ? thermalMetaRow('Examens', formatFcfaPrint(data.examsFcfa), '')
      : '',
    data.surgeryFcfa != null && data.surgeryFcfa > 0
      ? thermalMetaRow('Chirurgie', formatFcfaPrint(data.surgeryFcfa), '')
      : '',
    data.hospitalizationFcfa != null && data.hospitalizationFcfa > 0
      ? thermalMetaRow('Hospitalisation', formatFcfaPrint(data.hospitalizationFcfa), '')
      : '',
  ]
    .filter(Boolean)
    .join('')

  return `
<div class="thermal-receipt thermal-receipt--ticket">
  ${buildThermalTicketHeadHtml({ title: 'Clinique Alwatan Clôture', number: dateShort })}
  <hr class="thermal-receipt__rule" />

  <div class="thermal-receipt__fields">
    ${metaRows}
  </div>

  ${detailRows ? `<hr class="thermal-receipt__rule" /><div class="thermal-receipt__fields">${detailRows}</div>` : ''}

  <hr class="thermal-receipt__rule" />
  <div class="thermal-receipt__fields">
    ${thermalMetaRow('Encaissements', formatFcfaPrint(data.collectedFcfa), '')}
    ${thermalMetaRow('Dépenses', formatFcfaPrint(data.expensesFcfa), '')}
    ${thermalMetaRow('Net', formatFcfaPrint(data.netFcfa), '')}
  </div>

  <hr class="thermal-receipt__rule" />
  <p class="thermal-receipt__thanks">Remettre à la comptabilité</p>
</div>`
}

export type LabExamInvoiceLine = {
  label: string
  amountFcfa: number
  kind?: ExamKindSlug
}

/**
 * Ticket / facture : une ligne par examen principal (Biochimie, NFS…),
 * sans détail des formulaires, montants additionnés.
 */
export function summarizeExamLinesByPanel(examLines: LabExamInvoiceLine[]): LabExamInvoiceLine[] {
  const order: string[] = []
  const map = new Map<string, LabExamInvoiceLine>()
  for (const line of examLines) {
    const base = extractBasePanelLabel(line.label).trim() || line.label.trim()
    if (!base) continue
    const kind = line.kind ?? 'examen'
    const key = `${kind}::${normalizeLabLabelKey(base)}`
    const existing = map.get(key)
    if (!existing) {
      map.set(key, { label: base, amountFcfa: Math.max(0, Number(line.amountFcfa) || 0), kind })
      order.push(key)
      continue
    }
    existing.amountFcfa += Math.max(0, Number(line.amountFcfa) || 0)
  }
  return order.map((key) => map.get(key)!)
}

export type LabExamInvoiceData = {
  patientCode: string
  patientName: string
  prescribedBy: string
  examLines: LabExamInvoiceLine[]
  grossFcfa: number
  reductionFcfa: number
  totalFcfa: number
  /** Montant cumulé déjà encaissé (paiements par tranche). */
  paidFcfa?: number
  /** Solde restant après encaissement. */
  remainingFcfa?: number
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

function resolveLabExamDocTitle(data: LabExamInvoiceData) {
  const raw =
    data.docTitle ??
    resolveLabExamInvoiceDocTitle(
      data.examLines.map((line) => ({
        label: line.label,
        unitPriceFcfa: line.amountFcfa,
        kind: line.kind,
      })),
    )
  return t(raw)
}

/** Ticket thermique 80 mm (Xprinter) — encaissements examens réception */
export function buildLabExamThermalReceiptHtml(data: LabExamInvoiceData): string {
  const { shortDate, timeShort } = parseReceiptDateTime(data.date, true)
  const hasReduction = data.reductionFcfa > 0
  const invoiceNo = data.invoiceNumber ?? '—'
  const paidFcfa = Math.max(0, Number(data.paidFcfa) || 0)
  const remainingFcfa = Math.max(0, Number(data.remainingFcfa) || 0)
  const hasPartialPayment =
    data.paidFcfa != null && (remainingFcfa > 0 || (paidFcfa > 0 && paidFcfa < data.totalFcfa))
  const status = data.status ?? (hasPartialPayment ? 'Payé partiellement' : 'Payé')
  const totalLabel = hasPartialPayment
    ? 'Total dû'
    : status === 'Payé'
      ? 'TOTAL'
      : 'À payer'
  const dateLabel = `${shortDate} ${timeShort}`

  const metaRows = [
    thermalMetaRow('Date', dateLabel, ''),
    thermalMetaRow('Patient', data.patientName, ''),
    thermalMetaRow('Paiement', status, ''),
    ...(data.processedBy ? [thermalMetaRow('Par', data.processedBy, '')] : []),
  ].join('')

  const kindComment = data.kindComment?.trim()
  const kindCommentBlock = kindComment
    ? `<p class="thermal-receipt__note" dir="ltr">${escapeHtml(kindComment)}</p>`
    : ''

  const examRows = summarizeExamLinesByPanel(data.examLines)
    .map((line) => thermalMetaRow(line.label, formatFcfaPrint(line.amountFcfa), ''))
    .join('')

  const totalsRows = [
    ...(hasReduction
      ? [
          thermalMetaRow('Sous-total', formatFcfaPrint(data.grossFcfa), ''),
          thermalMetaRow('Réduction', `- ${formatFcfaPrint(data.reductionFcfa)}`, ''),
        ]
      : []),
    thermalMetaRow(totalLabel, formatFcfaPrint(data.totalFcfa), ''),
    ...(hasPartialPayment
      ? [
          thermalMetaRow('Encaissé', formatFcfaPrint(paidFcfa), ''),
          thermalMetaRow('Reste', formatFcfaPrint(remainingFcfa), ''),
        ]
      : []),
  ].join('')

  return `
<div class="thermal-receipt thermal-receipt--ticket">
  ${buildThermalTicketHeadHtml({ title: 'Clinique Alwatan Examens', number: invoiceNo })}
  <hr class="thermal-receipt__rule" />

  <div class="thermal-receipt__fields">
    ${metaRows}
  </div>

  <hr class="thermal-receipt__rule" />
  <div class="thermal-receipt__fields">
    ${examRows}
    ${totalsRows}
  </div>

  ${kindCommentBlock}

  <hr class="thermal-receipt__rule" />
  <p class="thermal-receipt__thanks">Merci</p>
</div>`
}

export function buildLabExamInvoiceHtml(data: LabExamInvoiceData): string {
  const examCount = data.examLines.length
  const density = labExamDensityClass(examCount)
  const { shortDate, timeShort } = parseReceiptDateTime(data.date, true)
  const genderLabel = formatGender(data.gender)
  const hasReduction = data.reductionFcfa > 0
  const invoiceNo = data.invoiceNumber ?? '—'
  const paidFcfa = Math.max(0, Number(data.paidFcfa) || 0)
  const remainingFcfa = Math.max(0, Number(data.remainingFcfa) || 0)
  const hasPartialPayment =
    data.paidFcfa != null && (remainingFcfa > 0 || (paidFcfa > 0 && paidFcfa < data.totalFcfa))
  const resolvedStatus = data.status ?? (hasPartialPayment ? 'Payé partiellement' : 'Payé')
  const status = translateStatus(resolvedStatus)
  const docTitle = resolveLabExamDocTitle(data)
  const totalLabel = hasPartialPayment
    ? t('Total dû')
    : resolvedStatus === 'Payé'
      ? t('Total payé')
      : t('Total à payer')
  const invoiceKinds = new Set(data.examLines.map((line) => line.kind ?? 'examen'))
  const singleKind = invoiceKinds.size === 1 ? [...invoiceKinds][0] : null
  const kindClass = singleKind ? ` receipt-invoice--kind-${singleKind}` : ''
  const docTitleClass = singleKind ? `receipt-invoice__doc-title--${singleKind}` : 'receipt-invoice__doc-title--mixed'
  const ageLabel = data.age != null ? patientAgeLabel(data.age, data.ageUnit) : null

  const leftFields = [
    receiptField('Patient', data.patientName),
    ...(ageLabel ? [receiptField('Âge', ageLabel)] : []),
    receiptField('Matricule', data.patientCode),
    ...(genderLabel ? [receiptField('Sexe', genderLabel)] : []),
    ...(data.phone ? [receiptField('Tél.', data.phone)] : []),
  ].join('')

  const rightFields = [
    receiptField('N° facture', invoiceNo),
    receiptField('Statut', status),
    receiptField('Prescrit par', data.prescribedBy),
    ...(data.processedBy ? [receiptField('Encaissé par', data.processedBy)] : []),
  ].join('')

  const datetimeLine = [
    `${t('Date')} ${shortDate}`,
    `${t('Heure')} ${timeShort}`,
  ]
    .map((part) => `<span>${escapeHtml(part)}</span>`)
    .join('')

  const examRows = buildGroupedExamInvoiceRows(data.examLines)

  const reductionRow = hasReduction
    ? `<div class="receipt-invoice__line receipt-invoice__line--summary receipt-invoice__line--discount">
        <span>${escapeHtml(t('Réduction'))}</span>
        <strong>- ${formatFcfaPrint(data.reductionFcfa)}</strong>
      </div>`
    : ''

  const partialTotals = hasPartialPayment
    ? `<div class="receipt-invoice__total-bar receipt-invoice__total-bar--sub">
        <span>${escapeHtml(t('Encaissé'))}</span>
        <strong>${formatFcfaPrint(paidFcfa)}</strong>
      </div>
      <div class="receipt-invoice__total-bar">
        <span>${escapeHtml(t('Reste à payer'))}</span>
        <strong>${formatFcfaPrint(remainingFcfa)}</strong>
      </div>`
    : ''

  const kindComment = data.kindComment?.trim()
  const kindCommentBlock = kindComment
    ? `<div class="receipt-invoice__kind-comment"><strong>${escapeHtml(t('Commentaire médecin'))}</strong>${escapeHtml(kindComment)}</div>`
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
        <p class="receipt-invoice__contact">${escapeHtml(t('Email :'))} ${escapeHtml(CLINIC.email)}</p>
        ${clinicTaxLine() ? `<p class="receipt-invoice__contact">${escapeHtml(clinicTaxLine())}</p>` : ''}
        ${CLINIC.printFooter ? `<p class="receipt-invoice__contact">${escapeHtml(CLINIC.printFooter)}</p>` : ''}
      </div>
    </div>
  </header>

  <hr class="receipt-invoice__dash" />

  <div class="receipt-invoice__meta">
    <div class="receipt-invoice__meta-grid">
      <div>${leftFields}</div>
      <div>${rightFields}</div>
    </div>
  </div>

  <h2 class="receipt-invoice__doc-title ${docTitleClass}">${escapeHtml(docTitle)}</h2>
  <div class="receipt-invoice__inline receipt-invoice__inline--under-title">${datetimeLine}</div>

  <div class="receipt-invoice__lines">
    <div class="receipt-invoice__line receipt-invoice__line--head">
      <span>${escapeHtml(t('Examen'))}</span>
      <strong>${escapeHtml(t('Montant'))}</strong>
    </div>
    ${examRows}
    ${reductionRow}
  </div>

  <div class="receipt-invoice__total-bar${hasPartialPayment ? ' receipt-invoice__total-bar--sub' : ''}">
    <span>${escapeHtml(totalLabel)}</span>
    <strong>${formatFcfaPrint(data.totalFcfa)}</strong>
  </div>
  ${partialTotals}

  ${kindCommentBlock}

  <p class="receipt-invoice__thanks">${escapeHtml(t('Merci de votre confiance'))}</p>
</div>`
}

export function buildClinicPrintHeader(
  docTitle?: string,
  options?: { dualLogo?: boolean },
): string {
  const title = docTitle ? `<p class="doc-title">${escapeHtml(t(docTitle))}</p>` : ''
  const rightLogo = options?.dualLogo
    ? `<img src="${CLINIC.logo}" alt="" class="clinic-logo clinic-logo--right" aria-hidden="true" />`
    : ''
  return `
  <div class="clinic-header${options?.dualLogo ? ' clinic-header--dual-logo' : ''}">
    <img src="${CLINIC.logo}" alt="${CLINIC.nameFr}" class="clinic-logo" />
    ${rightLogo}
    <div class="clinic-info">
      <h1>${CLINIC.nameFr}</h1>
      <p class="clinic-ar" dir="rtl" lang="ar">${CLINIC.nameAr}</p>
      <p class="clinic-contact">${CLINIC.fullAddress}</p>
      <p class="clinic-contact">${CLINIC.phoneLabel}</p>
      <p class="clinic-contact">${escapeHtml(t('Email :'))} ${CLINIC.email}</p>
      ${clinicTaxLine() ? `<p class="clinic-contact">${escapeHtml(clinicTaxLine())}</p>` : ''}
      ${CLINIC.printFooter ? `<p class="clinic-contact">${escapeHtml(CLINIC.printFooter)}</p>` : ''}
      ${title}
    </div>
  </div>`
}

export type OpenPrintOptions = {
  autoPrint?: boolean
  pageSize?: 'A5' | 'A4' | '80mm'
  /** Force LTR même si la session est en arabe (ex. feuilles de résultats labo). */
  forceLtr?: boolean
  /** Ticket court (pharmacie) : hauteur page serrée après le contenu. */
  thermalTight?: boolean
}

/** Hauteur page thermique (mm) — toujours portrait (> 80 mm de largeur). */
function measureThermalPageHeightMm(doc: Document, tight = false): number {
  const receipt = doc.querySelector('.thermal-receipt') as HTMLElement | null
  let px = 0

  if (receipt) {
    const probe = receipt.cloneNode(true) as HTMLElement
    probe.style.cssText =
      'position:absolute;left:-10000px;top:0;width:80mm;max-width:80mm;height:auto;min-height:0;margin:0;padding:0;visibility:hidden;pointer-events:none;'
    doc.body.appendChild(probe)
    px = Math.ceil(Math.max(probe.scrollHeight, probe.offsetHeight, 1))
    probe.remove()
  } else {
    for (const child of Array.from(doc.body.children)) {
      const el = child as HTMLElement
      if (!el?.offsetHeight || el.classList?.contains('thermal-receipt__cut')) continue
      px += Math.ceil(el.offsetHeight)
    }
  }

  // CSS px → mm (+ marge coupe)
  let mm = Math.ceil((px * 25.4) / 96) + (tight ? 2 : 8)
  // Portrait obligatoire : si hauteur ≤ largeur, Chrome part en paysage et le rouleau se vide
  mm = Math.max(mm, tight ? 81 : 92)
  // Plafond anti-A4 (~297 mm)
  mm = Math.min(mm, 170)
  return mm
}

function applyThermalPageSize(doc: Document, heightMm: number, tight = false) {
  doc.querySelectorAll('style[data-thermal-fit]').forEach((el) => el.remove())
  const style = doc.createElement('style')
  style.setAttribute('data-thermal-fit', '1')
  style.textContent = `
@page {
  size: 80mm ${heightMm}mm;
  margin: 0;
}
@page print-thermal {
  size: 80mm ${heightMm}mm;
  margin: 0;
}
@media print {
  @page {
    size: 80mm ${heightMm}mm;
    margin: 0 !important;
  }
  html, body {
    width: 80mm !important;
    max-width: 80mm !important;
    height: auto !important;
    min-height: 0 !important;
    margin: 0 !important;
    padding: 0 !important;
    overflow: hidden !important;
  }
  body.print-thermal {
    width: 80mm !important;
    max-width: 80mm !important;
    height: auto !important;
    min-height: 0 !important;
    padding: 0.5mm 1.5mm 2mm !important;
    margin: 0 !important;
  }
  body.print-thermal .thermal-receipt__cut {
    display: none !important;
    height: 0 !important;
  }
  ${
    tight
      ? `
  body.print-thermal {
    padding: 0.5mm 1.5mm 0 !important;
  }
  body.print-thermal .thermal-receipt--pharmacy .thermal-receipt__thanks {
    margin: 3px 0 0 !important;
    padding: 0 !important;
  }`
      : ''
  }
}`
  doc.head.appendChild(style)
  // Reflow pour que @page soit pris en compte avant print()
  void doc.body.offsetHeight
}

function printHtmlInHiddenFrame(
  html: string,
  onBeforePrint?: (doc: Document) => void,
  frameOpts?: { widthPx?: number; heightPx?: number; delayMs?: number; waitImages?: boolean },
): boolean {
  // Dimensions réelles hors écran : iframe 0×0 → print() souvent ignoré sous Edge/Chrome --app
  // Thermique : largeur 80 mm et hauteur minime — sinon documentElement.scrollHeight = viewport (~A4)
  const widthPx = frameOpts?.widthPx ?? 800
  const heightPx = frameOpts?.heightPx ?? 1200
  const delayMs = frameOpts?.delayMs ?? 250
  const waitImages = frameOpts?.waitImages === true

  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.setAttribute('title', 'print')
  iframe.style.cssText =
    `position:fixed;left:-10000px;top:0;width:${widthPx}px;height:${heightPx}px;border:0;opacity:0;pointer-events:none;`
  document.body.appendChild(iframe)

  const frameDoc = iframe.contentDocument
  const frameWin = iframe.contentWindow
  if (!frameDoc || !frameWin) {
    iframe.remove()
    return false
  }

  frameDoc.open()
  frameDoc.write(html)
  frameDoc.close()

  let cleaned = false
  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    try {
      iframe.remove()
    } catch {
      /* ignore */
    }
  }

  let printed = false
  const doPrint = () => {
    if (printed) return
    printed = true

    const run = () => {
      try {
        onBeforePrint?.(frameDoc)
      } catch {
        /* ignore */
      }
      try {
        frameWin.focus()
        frameWin.addEventListener('afterprint', cleanup, { once: true })
        frameWin.print()
      } catch {
        cleanup()
        return
      }
      // Repli si afterprint n’arrive pas (certains modes --app)
      setTimeout(cleanup, 60_000)
    }

    if (!waitImages) {
      run()
      return
    }

    const imgs = Array.from(frameDoc.images)
    if (!imgs.length) {
      run()
      return
    }
    let pending = imgs.length
    let finished = false
    const finish = () => {
      if (finished) return
      finished = true
      run()
    }
    const done = () => {
      pending -= 1
      if (pending <= 0) finish()
    }
    for (const img of imgs) {
      if (img.complete) {
        done()
        continue
      }
      img.addEventListener('load', done, { once: true })
      img.addEventListener('error', done, { once: true })
    }
    // Sécurité si un événement image ne part jamais
    setTimeout(finish, 1500)
  }

  // Laisser le moteur peindre le contenu avant print()
  setTimeout(doPrint, delayMs)
  return true
}

function printHtmlInNewWindow(
  html: string,
  windowSize: string,
  onBeforePrint?: (doc: Document) => void,
): boolean {
  const printWindow = window.open('', '_blank', windowSize)
  if (!printWindow) return false
  printWindow.document.open()
  printWindow.document.write(html)
  printWindow.document.close()
  setTimeout(() => {
    try {
      onBeforePrint?.(printWindow.document)
    } catch {
      /* ignore */
    }
    try {
      printWindow.focus()
      printWindow.print()
    } catch {
      /* ignore */
    }
  }, 300)
  return true
}

export function openPrintDocument(
  _title: string,
  bodyHtml: string,
  autoPrintOrOptions: boolean | OpenPrintOptions = true,
) {
  const options: OpenPrintOptions =
    typeof autoPrintOrOptions === 'boolean'
      ? { autoPrint: autoPrintOrOptions }
      : { autoPrint: true, ...autoPrintOrOptions }

  const isA5 = options.pageSize === 'A5'
  const isA4 = options.pageSize === 'A4'
  const isThermal = options.pageSize === '80mm'
  const locale = getAppLocale()
  // Thermique : layout LTR (FR gauche · valeur centre · AR droite), chiffres non inversés.
  const isRtl = isThermal ? false : !options.forceLtr && locale === 'ar'
  const lang = isThermal
    ? 'fr'
    : options.forceLtr
      ? 'fr'
      : locale === 'ar'
        ? 'ar'
        : locale === 'en'
          ? 'en'
          : 'fr'
  const dir = isRtl ? 'rtl' : 'ltr'
  const bodyClassParts = [
    isA5 ? 'print-a5' : '',
    isA4 ? 'print-a4' : '',
    isThermal ? 'print-thermal' : '',
    isRtl ? 'print-rtl' : '',
    options.forceLtr && !isThermal ? 'print-ltr-forced' : '',
  ].filter(Boolean)
  const bodyClass = bodyClassParts.length ? ` class="${bodyClassParts.join(' ')}"` : ''

  const printTitle = '\u200b'
  const thermalOverrides = isThermal
    ? `
  /* Toujours portrait (110 > 80). "auto" ou hauteur < 80 mm → paysage + trop de papier. */
  @page { size: 80mm 110mm; margin: 0; }
  @media print {
    @page { size: 80mm 110mm; margin: 0 !important; }
    html {
      width: 80mm !important;
      max-width: 80mm !important;
      height: auto !important;
      min-height: 0 !important;
      margin: 0 !important;
      padding: 0 !important;
    }
    html, body {
      height: auto !important;
      min-height: 0 !important;
      overflow: hidden !important;
    }
    body.print-thermal {
      width: 80mm !important;
      max-width: 80mm !important;
      height: auto !important;
      min-height: 0 !important;
      padding: 0.5mm 1.5mm 2mm !important;
      margin: 0 !important;
    }
  }`
    : `
  @media print {
    @page { margin: 0 !important; }
  }`

  const contentHtml = isThermal
    ? `${bodyHtml}<div class="thermal-receipt__cut" aria-hidden="true"></div>`
    : bodyHtml

  const html = `<!DOCTYPE html>
<html lang="${lang}" dir="${dir}"><head><meta charset="UTF-8"><title>${printTitle}</title>
<style>${CLINIC_PRINT_STYLES}
  body.print-rtl { direction: rtl; }
  body.print-rtl th, body.print-rtl td { text-align: right; }
  /* Thermique : FR gauche · valeur centre · AR droite (direction LTR du document) */
  body.print-thermal {
    direction: ltr;
    text-align: left;
  }
  body.print-thermal .thermal-receipt__name-ar {
    direction: rtl;
    text-align: right;
    unicode-bidi: isolate;
  }
  body.print-thermal .thermal-receipt__value,
  body.print-thermal [dir="ltr"].thermal-receipt__value {
    direction: ltr !important;
    unicode-bidi: isolate;
    text-align: center;
  }
  /* A4/A5 en arabe (non thermique) : valeurs collées à gauche après le libellé */
  body.print-rtl:not(.print-thermal) .row strong,
  body.print-rtl:not(.print-thermal) .receipt-invoice__line strong,
  body.print-rtl:not(.print-thermal) .receipt-invoice__field { text-align: left; }
  body.print-rtl:not(.print-thermal) .receipt-invoice__label { margin-left: 0.35rem; margin-right: 0; }
  body.print-ltr-forced {
    direction: ltr !important;
    text-align: left;
  }
  /* Garder le nom arabe de la clinique en RTL sans inverser tout le document */
  body.print-ltr-forced .clinic-ar,
  body.print-ltr-forced [lang="ar"][dir="rtl"] {
    direction: rtl !important;
    unicode-bidi: isolate;
  }
  ${thermalOverrides}
</style></head><body${bodyClass}>
${contentHtml}
</body></html>`

  const runThermalFit = (doc: Document) => {
    const tight = Boolean(options.thermalTight)
    try {
      applyThermalPageSize(doc, measureThermalPageHeightMm(doc, tight), tight)
    } catch {
      try {
        applyThermalPageSize(doc, tight ? 81 : 110, tight)
      } catch {
        /* ignore */
      }
    }
  }

  const autoPrint = options.autoPrint !== false

  const windowSize = isA5
    ? 'width=520,height=740'
    : isA4
      ? 'width=850,height=1100'
      : isThermal
        ? 'width=320,height=520'
        : 'width=820,height=900'

  if (autoPrint && typeof document !== 'undefined') {
    const beforePrint = isThermal ? runThermalFit : undefined
    const printed = printHtmlInHiddenFrame(
      html,
      beforePrint,
      isThermal
        ? { widthPx: 302, heightPx: 1200, delayMs: 450, waitImages: true }
        : undefined,
    )
    if (!printed) {
      printHtmlInNewWindow(html, windowSize, beforePrint)
    }
    return
  }

  const printWindow = window.open('', '_blank', windowSize)
  if (!printWindow) return
  printWindow.document.write(html)
  printWindow.document.close()
  if (isThermal) {
    printWindow.onload = () => runThermalFit(printWindow.document)
  }
}
