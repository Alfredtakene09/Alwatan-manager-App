import { fullName } from '@/lib/roles'
import type { PharmacyOrdonnanceLine } from '@/lib/lab-notes'
import { isPharmacyCatalogLine } from '@/lib/lab-notes'
import { buildClinicPrintHeader, openPrintDocument } from '@/lib/print-document'
import { translateUi } from '@/i18n/translate'

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export type PharmacyOrdonnancePrintInput = {
  patient: {
    code: string
    firstName: string
    lastName: string
    age?: number | null
    gender?: string | null
  }
  doctorName?: string | null
  lines: PharmacyOrdonnanceLine[]
  date?: Date | string
}

export function printPharmacyOrdonnance(input: PharmacyOrdonnancePrintInput) {
  const t = translateUi
  const lines = input.lines.filter((line) => line.name.trim() && line.quantity > 0)
  if (!lines.length) return

  const patientName = fullName(input.patient.firstName, input.patient.lastName)
  const when = input.date ? new Date(input.date) : new Date()
  const dateLabel = when.toLocaleString('fr-FR')
  const hasFreeText = lines.some((line) => !isPharmacyCatalogLine(line))

  const rows = lines
    .map((line, index) => {
      const details = [
        line.dosage?.trim(),
        line.instructions?.trim(),
        !isPharmacyCatalogLine(line) ? t('Hors stock pharmacie') : null,
      ]
        .filter(Boolean)
        .join(' · ')
      return `
      <tr>
        <td>${index + 1}</td>
        <td>
          <strong>${escapeHtml(line.name)}</strong>
          ${details ? `<div class="ordo-print__detail">${escapeHtml(details)}</div>` : ''}
        </td>
        <td>${line.quantity}</td>
      </tr>`
    })
    .join('')

  const body = `
${buildClinicPrintHeader(t('Ordonnance médicale'))}
<section class="ordo-print">
  <div class="row"><span>${t('Date')}</span><strong>${escapeHtml(dateLabel)}</strong></div>
  <div class="row"><span>${t('Patient')}</span><strong>${escapeHtml(patientName)}</strong></div>
  <div class="row"><span>${t('Matricule')}</span><strong>${escapeHtml(input.patient.code)}</strong></div>
  ${
    input.doctorName
      ? `<div class="row"><span>${t('Médecin')}</span><strong>${escapeHtml(input.doctorName)}</strong></div>`
      : ''
  }
  ${
    hasFreeText
      ? `<p class="ordo-print__note">${escapeHtml(
          t('Certains médicaments ne sont pas disponibles à la pharmacie de la clinique — à se procurer en officine.'),
        )}</p>`
      : ''
  }
  <table class="ordo-print__table">
    <thead>
      <tr>
        <th>#</th>
        <th>${t('Médicament')}</th>
        <th>${t('Qté')}</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <p class="ordo-print__sign">${escapeHtml(t('Signature du médecin'))}</p>
</section>
<style>
  .ordo-print { margin-top: 0.75rem; }
  .ordo-print__table { width: 100%; border-collapse: collapse; margin-top: 1rem; font-size: 0.95rem; }
  .ordo-print__table th, .ordo-print__table td { border-bottom: 1px solid #cbd5e1; padding: 0.55rem 0.35rem; text-align: left; vertical-align: top; }
  .ordo-print__table th { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.04em; color: #64748b; }
  .ordo-print__detail { margin-top: 0.2rem; color: #64748b; font-size: 0.85rem; }
  .ordo-print__note { margin: 0.85rem 0 0; padding: 0.55rem 0.7rem; background: #fff7ed; border: 1px solid #fdba74; border-radius: 8px; font-size: 0.85rem; color: #9a3412; }
  .ordo-print__sign { margin-top: 2.5rem; font-size: 0.9rem; color: #475569; }
</style>`

  openPrintDocument(`${t('Ordonnance')} ${input.patient.code}`, body, {
    pageSize: 'A5',
    autoPrint: true,
  })
}
