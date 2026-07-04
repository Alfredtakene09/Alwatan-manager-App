import { buildClinicPrintHeader, openPrintDocument } from '@/lib/print-document'
import { CLINIC } from '@/lib/clinic'
import { formatFcfa, fullName } from '@/lib/roles'
import { parsePrescribedHospitalisationDays } from '@/lib/lab-notes'

export type HospitalizationAdmissionForm = {
  patientName: string
  patientCode?: string
  service: string
  attendingDoctor: string
  startDate: string
  stayDays: number
  endDate: string
  roomType: string
  roomName: string
  dailyRateFcfa: number
  reductionFcfa: number
  doctorInstructions: string
}

export function endDateFromStayDays(startDate: string, stayDays: number): string {
  const nights = Math.max(1, Math.floor(stayDays))
  return addDaysIso(startDate, nights)
}

export function stayDaysFromDates(startDate: string, endDate: string): number {
  return computeHospitalizationNights(startDate, endDate)
}

export function computeHospitalizationNights(startDate: string, endDate: string): number {
  const [sy, sm, sd] = startDate.split('-').map(Number)
  const [ey, em, ed] = endDate.split('-').map(Number)
  const start = new Date(sy, sm - 1, sd)
  const end = new Date(ey, em - 1, ed)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return 0
  return Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)))
}

export function computeHospitalizationBilling(
  _startDate: string,
  stayDays: number,
  dailyRateFcfa: number,
  reductionFcfa: number,
) {
  const nights = Math.max(1, Math.floor(stayDays))
  const grossFcfa = nights * dailyRateFcfa
  const reduction = Math.min(Math.max(0, Number(reductionFcfa) || 0), grossFcfa)
  const netFcfa = Math.max(0, grossFcfa - reduction)
  return { nights, grossFcfa, reductionFcfa: reduction, netFcfa }
}

function addDaysIso(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  date.setDate(date.getDate() + days)
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function isoFromDate(value?: string | Date | null): string {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

export function defaultAdmissionForm(partial: {
  patientFirstName: string
  patientLastName: string
  patientCode?: string
  attendingDoctor?: string | null
  doctorInstructions?: string | null
  service?: string | null
  roomType?: string
  roomName?: string
  dailyRateFcfa?: number
  startDate?: string
  endDate?: string
  stayDays?: number
  prescribedStayDays?: number | null
  reductionFcfa?: number
}): HospitalizationAdmissionForm {
  const today = new Date().toISOString().slice(0, 10)
  const startDate = partial.startDate ?? today
  const stayDays = partial.stayDays ?? partial.prescribedStayDays ?? 1
  const normalizedStayDays = Math.max(1, Math.floor(stayDays))
  return {
    patientName: fullName(partial.patientFirstName, partial.patientLastName),
    patientCode: partial.patientCode,
    service: partial.service?.trim() || 'Hospitalisation',
    attendingDoctor: partial.attendingDoctor ?? '',
    startDate,
    stayDays: normalizedStayDays,
    endDate: partial.endDate ?? endDateFromStayDays(startDate, normalizedStayDays),
    roomType: partial.roomType ?? '',
    roomName: partial.roomName ?? '',
    dailyRateFcfa: partial.dailyRateFcfa ?? 0,
    reductionFcfa: partial.reductionFcfa ?? 0,
    doctorInstructions: partial.doctorInstructions ?? '',
  }
}

export function admissionFormFromHospitalization(hosp: {
  roomType: string
  dailyRateFcfa: number
  reductionFcfa?: number
  startDate?: string | Date | null
  endDate?: string | Date | null
  service?: string | null
  attendingDoctor?: string | null
  doctorInstructions?: string | null
  visit: {
    patient: { code: string; firstName: string; lastName: string }
    consultation?: {
      doctor?: { firstName: string; lastName: string } | null
      doctorComment?: string | null
      diagnosis?: string | null
      clinicalNotes?: string | null
    } | null
    assignedDoctor?: { firstName: string; lastName: string } | null
  }
  room?: { name: string; type?: string } | null
}): HospitalizationAdmissionForm {
  const doctor = hosp.visit.consultation?.doctor ?? hosp.visit.assignedDoctor
  const fallbackDoctor = doctor ? `Dr ${doctor.firstName} ${doctor.lastName}` : ''
  const fallbackInstructions = [hosp.visit.consultation?.diagnosis, hosp.visit.consultation?.doctorComment]
    .filter(Boolean)
    .join('\n')
  const startIso = isoFromDate(hosp.startDate) || undefined
  const endIso = isoFromDate(hosp.endDate) || undefined
  const prescribedStayDays = parsePrescribedHospitalisationDays(hosp.visit.consultation?.clinicalNotes)
  const stayDays =
    startIso && endIso
      ? stayDaysFromDates(startIso, endIso)
      : prescribedStayDays ?? 1

  return defaultAdmissionForm({
    patientFirstName: hosp.visit.patient.firstName,
    patientLastName: hosp.visit.patient.lastName,
    patientCode: hosp.visit.patient.code,
    service: 'Hospitalisation',
    attendingDoctor: fallbackDoctor || hosp.attendingDoctor || '—',
    doctorInstructions: hosp.doctorInstructions ?? fallbackInstructions,
    roomType: hosp.roomType,
    roomName: hosp.room?.name ?? '',
    dailyRateFcfa: hosp.dailyRateFcfa,
    startDate: startIso,
    endDate: endIso,
    stayDays,
    prescribedStayDays,
    reductionFcfa: hosp.reductionFcfa ?? 0,
  })
}

function formatDateFr(iso: string) {
  if (!iso) return ''
  const [year, month, day] = iso.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString('fr-FR', {
        weekday: 'short',
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      })
}

function fieldRow(labelFr: string, labelAr: string, value: string) {
  return `
    <div class="hosp-adm-field">
      <div class="hosp-adm-field__labels">
        <span class="hosp-adm-field__fr">${labelFr}</span>
        <span class="hosp-adm-field__ar" dir="rtl">${labelAr}</span>
      </div>
      <div class="hosp-adm-field__value">${value || '&nbsp;'}</div>
    </div>`
}

function instructionLinesHtml(instructions: string, minLineCount = 36) {
  const trimmed = instructions.trim()
  const blankLine = () => '<div class="hosp-adm-line hosp-adm-line--blank">&nbsp;</div>'
  if (trimmed) {
    const lines = trimmed
      .split('\n')
      .map((line) => `<div class="hosp-adm-line">${line || '&nbsp;'}</div>`)
    while (lines.length < minLineCount) {
      lines.push(blankLine())
    }
    return lines.join('')
  }
  return Array.from({ length: minLineCount }, blankLine).join('')
}

const HOSP_ADMISSION_PRINT_STYLES = `
  <style>
    .hosp-adm-doc {
      font-family: 'Segoe UI', Arial, sans-serif;
      color: #1e293b;
      display: flex;
      flex-direction: column;
      padding: 0 4px 0;
      box-sizing: border-box;
    }
    .hosp-adm-doc.print-invoice-page {
      page-break-after: always;
      break-after: page;
      min-height: 200vh;
    }
    .hosp-adm-profile-head {
      page-break-inside: avoid;
      break-inside: avoid;
    }
    .hosp-adm-title-block {
      text-align: center;
      margin: 0 0 14px;
      padding: 12px 12px 14px;
      border: 2px solid #b91c1c;
      border-radius: 10px;
      background: linear-gradient(180deg, #fff8f8 0%, #ffffff 100%);
    }
    .hosp-adm-title-block h2 {
      margin: 0;
      font-size: 16px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: #991b1b;
    }
    .hosp-adm-title-block p {
      margin: 5px 0 0;
      font-size: 13px;
      color: #b91c1c;
      font-weight: 700;
    }
    .hosp-adm-vip {
      display: inline-block;
      margin-top: 8px;
      padding: 3px 14px;
      border: 2px solid #b91c1c;
      border-radius: 6px;
      color: #b91c1c;
      font-weight: 800;
      font-size: 11px;
      letter-spacing: 0.18em;
      background: #fff;
    }
    .hosp-adm-fields {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px 18px;
      margin-bottom: 14px;
    }
    .hosp-adm-field { min-width: 0; }
    .hosp-adm-field__labels {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      font-size: 10px;
      margin-bottom: 3px;
    }
    .hosp-adm-field__fr {
      color: #991b1b;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }
    .hosp-adm-field__ar { color: #991b1b; font-weight: 700; }
    .hosp-adm-field__value {
      border-bottom: 1.5px dotted #94a3b8;
      min-height: 22px;
      font-size: 12px;
      font-weight: 600;
      padding: 2px 0 4px;
      color: #0f172a;
      line-height: 1.35;
    }
    .hosp-adm-instructions {
      display: flex;
      flex-direction: column;
      flex: 1 1 auto;
      min-height: 78vh;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 12px 14px 10px;
      background: #fafcfd;
    }
    .hosp-adm-instructions__title {
      text-align: center;
      margin: 0 0 10px;
      padding-bottom: 8px;
      border-bottom: 1px dashed #cbd5e1;
      page-break-after: avoid;
      break-after: avoid;
    }
    .hosp-adm-instructions__title h3 {
      margin: 0;
      font-size: 11px;
      color: #991b1b;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .hosp-adm-instructions__title p {
      margin: 3px 0 0;
      font-size: 11px;
      color: #b91c1c;
      font-weight: 700;
    }
    .hosp-adm-lines {
      flex: 1 1 auto;
      min-height: 72vh;
    }
    .hosp-adm-line {
      border-bottom: 1px dotted #cbd5e1;
      min-height: 24px;
      margin-bottom: 5px;
      font-size: 11px;
      line-height: 1.45;
      color: #1e293b;
      white-space: pre-wrap;
    }
    .hosp-adm-line--blank {
      min-height: 24px;
      margin-bottom: 4px;
    }
    .hosp-adm-footer {
      margin-top: 10px;
      padding-top: 8px;
      border-top: 1px dashed #cbd5e1;
      text-align: center;
      font-size: 9px;
      color: #64748b;
      line-height: 1.45;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    .hosp-adm-wave {
      margin-top: 8px;
      height: 20px;
      background: linear-gradient(180deg, transparent 42%, #b91c1c 42%, #b91c1c 76%, #ca8a04 76%);
      border-radius: 0 0 8px 8px;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    @media print {
      .hosp-adm-doc.print-invoice-page {
        min-height: 528mm;
        height: auto;
      }
      .hosp-adm-instructions {
        min-height: 400mm;
      }
      .hosp-adm-lines {
        min-height: 370mm;
      }
      .clinic-header {
        margin-bottom: 10px;
        padding-bottom: 10px;
      }
    }
  </style>`

export function buildHospitalizationAdmissionPrintHtml(
  form: HospitalizationAdmissionForm,
  options?: { includeInvoice?: boolean },
) {
  const includeInvoice = options?.includeInvoice !== false && form.dailyRateFcfa > 0
  const styles = HOSP_ADMISSION_PRINT_STYLES
  if (!includeInvoice) {
    return `${styles}${buildHospitalizationProfileBodyHtml(form)}`
  }
  return `${styles}${buildHospitalizationProfileBodyHtml(form)}${buildHospitalizationInvoiceHtml(form)}`
}

function buildHospitalizationProfileBodyHtml(form: HospitalizationAdmissionForm): string {
  const isVip = form.roomType === 'VIP'
  const titleAr = isVip ? 'ملف دخول عنبر VIP' : 'ملف دخول عنبر'

  return `
  <div class="hosp-adm-doc print-invoice-page">
    ${buildClinicPrintHeader()}

    <div class="hosp-adm-profile-head">
    <div class="hosp-adm-title-block">
      <h2>Profil d'entrée en paroisse</h2>
      <p dir="rtl">${titleAr}</p>
      ${isVip ? '<div class="hosp-adm-vip">VIP</div>' : ''}
    </div>

    <div class="hosp-adm-fields">
      ${fieldRow('Nom du patient', 'اسم المريض', form.patientName)}
      ${fieldRow('Matricule', 'رقم الملف', form.patientCode ?? '')}
      ${fieldRow('Service', 'القسم', form.service)}
      ${fieldRow('Le médecin traitant', 'الطبيب المعالج', form.attendingDoctor)}
    </div>
    </div>

    <section class="hosp-adm-instructions">
      <div class="hosp-adm-instructions__title">
        <h3>Instructions du médecin traitant</h3>
        <p dir="rtl">تعليمات الطبيب المعالج</p>
      </div>
      <div class="hosp-adm-lines">
        ${instructionLinesHtml(form.doctorInstructions)}
      </div>
    </section>

    <p class="hosp-adm-footer">
      ${CLINIC.nameFr} — ${CLINIC.fullAddress}<br />
      ${CLINIC.phoneLabel} · ${CLINIC.email}
    </p>

    <div class="hosp-adm-wave"></div>
  </div>`
}

export function buildHospitalizationProfileHtml(form: HospitalizationAdmissionForm): string {
  return `${HOSP_ADMISSION_PRINT_STYLES}${buildHospitalizationProfileBodyHtml(form)}`
}

function escapeHtmlPrint(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function invoiceField(label: string, value: string) {
  return `<p class="receipt-invoice__field"><span class="receipt-invoice__label">${escapeHtmlPrint(label)} :</span> ${escapeHtmlPrint(value)}</p>`
}

export function buildHospitalizationInvoiceHtml(form: HospitalizationAdmissionForm): string {
  const billing = computeHospitalizationBilling(
    form.startDate,
    form.stayDays,
    form.dailyRateFcfa,
    form.reductionFcfa,
  )
  const isVip = form.roomType === 'VIP'
  const roomTypeLabel = isVip ? 'VIP' : form.roomType === 'SIMPLE' ? 'Simple' : form.roomType || '—'
  const serviceLabel = `Hospitalisation — chambre ${roomTypeLabel}`
  const reductionRow =
    billing.reductionFcfa > 0
      ? `<tr class="receipt-invoice__summary receipt-invoice__summary--discount">
          <td colspan="3">Réduction</td>
          <td>- ${formatFcfa(billing.reductionFcfa)}</td>
        </tr>`
      : ''

  const patientFields = [
    invoiceField('Patient', form.patientName),
    invoiceField('Matricule', form.patientCode ?? '—'),
    invoiceField('Médecin', form.attendingDoctor || '—'),
  ].join('')

  const stayFields = [
    invoiceField('Date d\'entrée', formatDateFr(form.startDate) || '—'),
    invoiceField('Nombre de jours', `${billing.nights}`),
    invoiceField('Chambre', roomTypeLabel),
  ].join('')

  return `
  <div class="receipt-invoice print-invoice-page">
    ${buildClinicPrintHeader('Facture — Hospitalisation')}

    <div class="receipt-invoice__cols">
      <div class="receipt-invoice__box">${patientFields}</div>
      <div class="receipt-invoice__box">${stayFields}</div>
    </div>

    <h2 class="receipt-invoice__doc-title">Facture d'hospitalisation</h2>

    <table class="receipt-invoice__table">
      <thead>
        <tr>
          <th>Description</th>
          <th>Qté</th>
          <th>Prix / nuit</th>
          <th>Total</th>
        </tr>
      </thead>
      <tbody>
        <tr class="receipt-invoice__service">
          <td>${escapeHtmlPrint(serviceLabel)}</td>
          <td>${billing.nights}</td>
          <td>${formatFcfa(form.dailyRateFcfa)}</td>
          <td>${formatFcfa(billing.grossFcfa)}</td>
        </tr>
        ${reductionRow}
      </tbody>
    </table>

    <div class="receipt-invoice__total-bar">
      <span>Total à payer</span>
      <strong>${formatFcfa(billing.netFcfa)}</strong>
    </div>

    <p class="receipt-invoice__thanks">Merci de votre confiance</p>
  </div>`
}

/** @deprecated Utiliser buildHospitalizationAdmissionPrintHtml */
export function buildHospitalizationAdmissionHtml(form: HospitalizationAdmissionForm): string {
  return buildHospitalizationAdmissionPrintHtml(form)
}

export function printHospitalizationAdmission(
  form: HospitalizationAdmissionForm,
  options?: { autoPrint?: boolean; pages?: 'both' | 'profile' | 'invoice' },
) {
  const pages = options?.pages ?? 'both'
  let bodyHtml: string
  if (pages === 'profile') {
    bodyHtml = buildHospitalizationProfileHtml(form)
  } else if (pages === 'invoice') {
    bodyHtml = `${HOSP_ADMISSION_PRINT_STYLES}${buildHospitalizationInvoiceHtml(form)}`
  } else {
    bodyHtml = buildHospitalizationAdmissionPrintHtml(form)
  }

  openPrintDocument(
    pages === 'invoice'
      ? `Facture hospitalisation — ${form.patientName}`
      : `Admission — ${form.patientName}`,
    bodyHtml,
    { pageSize: 'A4', autoPrint: options?.autoPrint !== false },
  )
}

export const HOSPITALIZATION_STATUS_LABELS: Record<string, string> = {
  REQUESTED: 'Prescrit par le médecin',
  RESERVED: 'Payé — en attente de salle',
  ACTIVE: 'Hospitalisé',
  DISCHARGED: 'Sorti',
  CANCELLED: 'Annulé',
}
