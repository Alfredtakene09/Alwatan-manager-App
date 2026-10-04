import {
  buildClinicPrintHeader,
  buildThermalTicketHeadHtml,
  openPrintDocument,
  thermalAr,
  thermalArTemplate,
  thermalMetaRow,
  thermalThanksBiHtml,
} from '@/lib/print-document'
import { CLINIC, clinicTaxLine } from '@/lib/clinic'
import { formatFcfa, fullName } from '@/lib/roles'
import { parsePrescribedHospitalisationDays } from '@/lib/lab-notes'
import { translateUi, translateUiLocale } from '@/i18n/translate'
import { translateTemplate } from '@/lib/dashboard-i18n'

const t = translateUi

export type HospitalizationAdmissionForm = {
  patientName: string
  patientCode?: string
  service: string
  attendingDoctor: string
  attendingDoctorId: string
  bedId: string
  startDate: string
  stayDays: number
  endDate: string
  roomType: string
  roomName: string
  dailyRateFcfa: number
  reductionFcfa: number
  doctorInstructions: string
  paymentPaid?: boolean
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
  if (typeof value === 'string') {
    const match = value.match(/^(\d{4}-\d{2}-\d{2})/)
    if (match) return match[1]
  }
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

export function todayLocalIsoDate(): string {
  return isoFromDate(new Date())
}

export function hospitalizationStayDays(hosp: {
  nightsCount?: number | null
  startDate?: string | Date | null
  endDate?: string | Date | null
}): number {
  if (hosp.nightsCount && hosp.nightsCount >= 1) return hosp.nightsCount
  const start = isoFromDate(hosp.startDate)
  const end = isoFromDate(hosp.endDate)
  if (!start || !end) return 0
  return computeHospitalizationNights(start, end)
}

/** Séjour ACTIVE dont la date de sortie prévue est aujourd’hui ou déjà passée. */
export function hospitalizationStayEnded(hosp: {
  status: string
  room?: { name?: string } | null
  startDate?: string | Date | null
  endDate?: string | Date | null
  nightsCount?: number | null
}): boolean {
  if (hosp.status !== 'ACTIVE') return false
  const start = isoFromDate(hosp.startDate)
  let end = isoFromDate(hosp.endDate)
  if (!end && start && hosp.nightsCount && hosp.nightsCount >= 1) {
    end = endDateFromStayDays(start, hosp.nightsCount)
  }
  if (!end) return false
  return end <= todayLocalIsoDate()
}

/** Temps restant jusqu'à la libération automatique (date de sortie). */
export function formatStayRemaining(endDate?: string | Date | null, now = new Date()): string {
  if (!endDate) return '—'
  const end = endDate instanceof Date ? endDate : new Date(endDate)
  if (Number.isNaN(end.getTime())) return '—'
  const ms = end.getTime() - now.getTime()
  if (ms <= 0) return '0 min'
  const totalMinutes = Math.floor(ms / 60_000)
  const days = Math.floor(totalMinutes / (60 * 24))
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60)
  const minutes = totalMinutes % 60
  if (days > 0) return hours > 0 ? `${days} j ${hours} h` : `${days} j`
  if (hours > 0) return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`
  return `${Math.max(1, minutes)} min`
}

export function stayAmountLabel(
  totalDueFcfa: number,
  paidFcfa: number,
): { kind: 'paid' | 'due'; amount: number } {
  const total = Math.max(0, totalDueFcfa || 0)
  const paid = Math.max(0, paidFcfa || 0)
  const remaining = Math.max(0, total - paid)
  if (remaining <= 0 && (paid > 0 || total > 0)) {
    return { kind: 'paid', amount: paid || total }
  }
  return { kind: 'due', amount: remaining }
}

export function defaultAdmissionForm(partial: {
  patientFirstName: string
  patientLastName: string
  patientCode?: string
  attendingDoctor?: string | null
  attendingDoctorId?: string | null
  bedId?: string | null
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
  paymentPaid?: boolean
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
    attendingDoctorId: partial.attendingDoctorId ?? '',
    bedId: partial.bedId ?? '',
    startDate,
    stayDays: normalizedStayDays,
    endDate: partial.endDate ?? endDateFromStayDays(startDate, normalizedStayDays),
    roomType: partial.roomType ?? '',
    roomName: partial.roomName ?? '',
    dailyRateFcfa: partial.dailyRateFcfa ?? 0,
    reductionFcfa: partial.reductionFcfa ?? 0,
    doctorInstructions: partial.doctorInstructions ?? '',
    paymentPaid: partial.paymentPaid !== false,
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
  attendingDoctorId?: string | null
  bedId?: string | null
  doctorInstructions?: string | null
  nightsCount?: number
  paidAt?: string | Date | null
  visit: {
    patient: { code: string; firstName: string; lastName: string }
    consultation?: {
      doctor?: { id?: string; firstName: string; lastName: string } | null
      doctorComment?: string | null
      diagnosis?: string | null
      clinicalNotes?: string | null
    } | null
    assignedDoctor?: { id?: string; firstName: string; lastName: string } | null
  }
  room?: { name: string; type?: string } | null
  attendingDoctorUser?: { id: string; firstName: string; lastName: string } | null
}): HospitalizationAdmissionForm {
  const doctor =
    hosp.attendingDoctorUser ??
    hosp.visit.consultation?.doctor ??
    hosp.visit.assignedDoctor
  const fallbackDoctor = doctor ? `Dr ${doctor.firstName} ${doctor.lastName}` : ''
  const fallbackDoctorId =
    hosp.attendingDoctorId ??
    hosp.attendingDoctorUser?.id ??
    hosp.visit.consultation?.doctor?.id ??
    hosp.visit.assignedDoctor?.id ??
    ''
  const fallbackInstructions = [hosp.visit.consultation?.diagnosis, hosp.visit.consultation?.doctorComment]
    .filter(Boolean)
    .join('\n')
  const startIso = isoFromDate(hosp.startDate) || undefined
  const endIso = isoFromDate(hosp.endDate) || undefined
  const prescribedStayDays = parsePrescribedHospitalisationDays(hosp.visit.consultation?.clinicalNotes)
  const stayDays =
    startIso && endIso
      ? stayDaysFromDates(startIso, endIso)
      : hosp.nightsCount && hosp.nightsCount >= 1
        ? hosp.nightsCount
        : prescribedStayDays ?? 1

  return defaultAdmissionForm({
    patientFirstName: hosp.visit.patient.firstName,
    patientLastName: hosp.visit.patient.lastName,
    patientCode: hosp.visit.patient.code,
    service: 'Hospitalisation',
    attendingDoctor: fallbackDoctor || hosp.attendingDoctor || '',
    attendingDoctorId: fallbackDoctorId,
    bedId: hosp.bedId ?? '',
    doctorInstructions: hosp.doctorInstructions ?? fallbackInstructions,
    roomType: hosp.roomType,
    roomName: hosp.room?.name ?? '',
    dailyRateFcfa: hosp.dailyRateFcfa,
    startDate: startIso,
    endDate: endIso,
    stayDays,
    prescribedStayDays,
    reductionFcfa: hosp.reductionFcfa ?? 0,
    paymentPaid: Boolean(hosp.paidAt),
  })
}

function formatDateFr(iso: string, compact = false) {
  if (!iso) return ''
  const [year, month, day] = iso.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  if (Number.isNaN(date.getTime())) return ''
  if (compact) {
    return `${String(day).padStart(2, '0')}-${String(month).padStart(2, '0')}-${year}`
  }
  return date.toLocaleDateString('fr-FR', {
    weekday: 'short',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  })
}

function roomTypeLabel(roomType: string) {
  if (roomType === 'VIP') return 'VIP'
  if (roomType === 'SIMPLE') return translateUiLocale('Simple', 'fr')
  return roomType || '—'
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

function instructionLinesHtml(instructions: string) {
  const trimmed = instructions.trim()
  if (!trimmed) return ''
  return trimmed
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => `<div class="hosp-adm-line">${line}</div>`)
    .join('')
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
      page-break-after: auto;
      break-after: auto;
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
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 8px 12px;
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
      min-height: 0;
    }
    .hosp-adm-line {
      border-bottom: 1px dotted #cbd5e1;
      min-height: 18px;
      margin-bottom: 3px;
      font-size: 11px;
      line-height: 1.35;
      color: #1e293b;
      white-space: pre-wrap;
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
        min-height: 0;
        height: auto;
      }
      .clinic-header {
        margin-bottom: 8px;
        padding-bottom: 8px;
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
  const instructionHtml = instructionLinesHtml(form.doctorInstructions)
  const instructionsBlock = instructionHtml
    ? `<section class="hosp-adm-instructions">
      <div class="hosp-adm-instructions__title">
        <h3>Instructions du médecin traitant</h3>
        <p dir="rtl">تعليمات الطبيب المعالج</p>
      </div>
      <div class="hosp-adm-lines">
        ${instructionHtml}
      </div>
    </section>`
    : ''

  return `
  <div class="hosp-adm-doc">
    ${buildClinicPrintHeader()}

    <div class="hosp-adm-profile-head">
    <div class="hosp-adm-title-block">
      <h2>Profil d'admission hospitalière</h2>
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

    ${instructionsBlock}

    <p class="hosp-adm-footer">
      ${CLINIC.nameFr} — ${CLINIC.fullAddress}<br />
      ${CLINIC.phoneLabel} · ${CLINIC.email}${clinicTaxLine() ? `<br />${clinicTaxLine()}` : ''}${CLINIC.printFooter ? `<br />${CLINIC.printFooter}` : ''}
    </p>
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
  const typeLabel = roomTypeLabel(form.roomType)
  const serviceLabel = form.roomName
    ? `${t('Hospitalisation')} — ${typeLabel} (${form.roomName})`
    : translateTemplate('Hospitalisation — chambre {room}', { room: typeLabel })
  const reductionRow =
    billing.reductionFcfa > 0
      ? `<tr class="receipt-invoice__summary receipt-invoice__summary--discount">
          <td colspan="3">${t('Réduction')}</td>
          <td>- ${formatFcfa(billing.reductionFcfa)}</td>
        </tr>`
      : ''

  return `
  <div class="receipt-invoice receipt-invoice--exam-a5 receipt-invoice--compact">
    ${buildClinicPrintHeader(t('Reçu hospitalisation'))}

    <div class="receipt-invoice__cols">
      <div class="receipt-invoice__box">
        ${invoiceField(t('Patient'), form.patientName)}
        ${invoiceField(t('Matricule'), form.patientCode ?? '—')}
      </div>
      <div class="receipt-invoice__box">
        ${invoiceField(t('Date d\'entrée'), formatDateFr(form.startDate, true) || '—')}
        ${invoiceField(t('Nombre de jours'), `${billing.nights}`)}
      </div>
    </div>

    <table class="receipt-invoice__table">
      <thead>
        <tr>
          <th>${t('Description')}</th>
          <th>${t('Qté')}</th>
          <th>${t('Prix / nuit')}</th>
          <th>${t('Total')}</th>
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
      <span>${t('Total à payer')}</span>
      <strong>${formatFcfa(billing.netFcfa)}</strong>
    </div>

    <p class="receipt-invoice__thanks">${t('Merci de votre confiance')}</p>
  </div>`
}

export function buildHospitalizationThermalReceiptHtml(form: HospitalizationAdmissionForm): string {
  const billing = computeHospitalizationBilling(
    form.startDate,
    form.stayDays,
    form.dailyRateFcfa,
    form.reductionFcfa,
  )
  const typeLabel = roomTypeLabel(form.roomType)
  const roomValue = form.roomName ? `${typeLabel} — ${form.roomName}` : typeLabel
  const lineFr = `Hospitalisation — chambre ${typeLabel}`
  const lineAr = thermalArTemplate('Hospitalisation — chambre {room}', { room: typeLabel })
  const titleFr = translateUiLocale('Reçu hospitalisation', 'fr')
  const titleAr = thermalAr('Reçu hospitalisation')

  const metaRows = [
    thermalMetaRow('Patient', form.patientName),
    ...(form.patientCode ? [thermalMetaRow('Matricule', form.patientCode)] : []),
    ...(form.attendingDoctor ? [thermalMetaRow('Médecin', form.attendingDoctor)] : []),
    thermalMetaRow("Date d'entrée", formatDateFr(form.startDate, true) || '—'),
    thermalMetaRow('Chambre', roomValue),
    thermalMetaRow('Nombre de jours', String(billing.nights)),
    thermalMetaRow(
      'Paiement',
      form.paymentPaid === false ? 'En attente de paiement' : 'Payé',
    ),
  ].join('')

  const amountRows = [
    thermalMetaRow(lineFr, formatFcfa(billing.grossFcfa), lineAr || undefined),
    ...(billing.reductionFcfa > 0
      ? [thermalMetaRow('Réduction', `- ${formatFcfa(billing.reductionFcfa)}`)]
      : []),
    thermalMetaRow('Total à payer', formatFcfa(billing.netFcfa)).replace(
      'class="thermal-receipt__row"',
      'class="thermal-receipt__row thermal-receipt__row--total"',
    ),
  ].join('')

  return `
<div class="thermal-receipt thermal-receipt--ticket thermal-receipt--hospitalization">
  ${buildThermalTicketHeadHtml({ title: titleFr, titleAr, number: form.patientCode || undefined })}
  <hr class="thermal-receipt__rule" />
  <div class="thermal-receipt__fields">
    ${metaRows}
  </div>
  <hr class="thermal-receipt__rule" />
  <div class="thermal-receipt__fields">
    ${amountRows}
  </div>
  <hr class="thermal-receipt__rule" />
  ${thermalThanksBiHtml()}
</div>`
}

/** @deprecated Utiliser buildHospitalizationAdmissionPrintHtml */
export function buildHospitalizationAdmissionHtml(form: HospitalizationAdmissionForm): string {
  return buildHospitalizationAdmissionPrintHtml(form)
}

export function printHospitalizationAdmission(
  form: HospitalizationAdmissionForm,
  options?: { autoPrint?: boolean; pages?: 'receipt' | 'both' | 'profile' | 'invoice' },
) {
  const pages = options?.pages ?? 'receipt'
  let bodyHtml: string
  let pageSize: '80mm' | 'A4' = '80mm'
  let title = `${t('Reçu hospitalisation')} — ${form.patientName}`

  if (pages === 'profile') {
    bodyHtml = buildHospitalizationProfileHtml(form)
    pageSize = 'A4'
    title = `${t('Admission')} — ${form.patientName}`
  } else if (pages === 'invoice') {
    bodyHtml = `${HOSP_ADMISSION_PRINT_STYLES}${buildHospitalizationInvoiceHtml(form)}`
    pageSize = 'A4'
    title = `${t('Facture hospitalisation')} — ${form.patientName}`
  } else if (pages === 'both') {
    bodyHtml = buildHospitalizationAdmissionPrintHtml(form)
    pageSize = 'A4'
    title = `${t('Admission')} — ${form.patientName}`
  } else {
    bodyHtml = buildHospitalizationThermalReceiptHtml(form)
  }

  openPrintDocument(title, bodyHtml, {
    pageSize,
    autoPrint: options?.autoPrint !== false,
    thermalTight: pageSize === '80mm',
  })
}

export const HOSPITALIZATION_STATUS_LABELS: Record<string, string> = {
  REQUESTED: 'En attente d\'admission',
  RESERVED: 'Payé — en attente de salle',
  ACTIVE: 'Hospitalisé',
  DISCHARGED: 'Sorti',
  CANCELLED: 'Annulé',
}
