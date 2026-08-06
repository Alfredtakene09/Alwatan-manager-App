import { fullName } from '@/lib/roles'
import { buildClinicPrintHeader, openPrintDocument } from '@/lib/print-document'
import { translateUi } from '@/i18n/translate'
import type { PharmacyOrdonnanceLine } from '@/lib/lab-notes'
import type { MedicalHistoryEntry } from '@/components/dossier/PatientMedicalHistory.vue'

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatPharmacyLine(line: PharmacyOrdonnanceLine) {
  const parts = [line.name]
  if (line.dosage?.trim()) parts.push(line.dosage.trim())
  parts.push(`× ${line.quantity}`)
  if (line.instructions?.trim()) parts.push(`— ${line.instructions.trim()}`)
  return parts.join(' ')
}

export type PatientDossierPrintInput = {
  patient: {
    code: string
    firstName: string
    lastName: string
    age?: number | null
    phone?: string | null
    gender?: string | null
    category?: string | null
  }
  history: MedicalHistoryEntry[]
  doctorName?: string | null
  autoPrint?: boolean
}

function visitBlockHtml(entry: MedicalHistoryEntry, t: typeof translateUi) {
  const when = new Date(entry.date).toLocaleString('fr-FR')
  const doctor = entry.doctor
    ? `Dr ${fullName(entry.doctor.firstName, entry.doctor.lastName)}`
    : '—'
  const pharmacy = entry.pharmacyOrdonnance ?? []

  return `
  <section class="dossier-print__visit">
    <header>
      <h2>${escapeHtml(when)}</h2>
      <p>${escapeHtml(t('Médecin'))} : <strong>${escapeHtml(doctor)}</strong>
        · ${escapeHtml(t('Statut'))} : ${escapeHtml(entry.status)}</p>
    </header>
    ${
      entry.diagnosis
        ? `<div class="dossier-print__block"><h3>${escapeHtml(t('Diagnostic'))}</h3><p>${escapeHtml(entry.diagnosis)}</p></div>`
        : ''
    }
    ${
      entry.doctorComment
        ? `<div class="dossier-print__block"><h3>${escapeHtml(t('Commentaire final'))}</h3><p>${escapeHtml(entry.doctorComment)}</p></div>`
        : ''
    }
    ${
      pharmacy.length
        ? `<div class="dossier-print__block"><h3>${escapeHtml(t('Ordonnance pharmacie'))}</h3><ul>${pharmacy
            .map((line) => `<li>${escapeHtml(formatPharmacyLine(line))}</li>`)
            .join('')}</ul></div>`
        : ''
    }
    ${
      entry.prescribedExams.length
        ? `<div class="dossier-print__block"><h3>${escapeHtml(t('Examens prescrits'))}</h3><p>${escapeHtml(
            entry.prescribedExams.join(' · '),
          )}</p></div>`
        : ''
    }
    ${
      entry.labPanels.length
        ? `<div class="dossier-print__block"><h3>${escapeHtml(t('Résultats laboratoire'))}</h3>${entry.labPanels
            .map((panel) => {
              const rows = Object.entries(panel.values)
                .filter(([key, value]) => !key.endsWith('__comment') && String(value ?? '').trim())
                .map(([key, value]) => {
                  const comment = String(panel.values[`${key}__comment`] ?? '').trim()
                  return `<tr><th>${escapeHtml(key)}</th><td>${escapeHtml(String(value).trim())}${
                    comment ? `<div class="dossier-print__comment">${escapeHtml(comment)}</div>` : ''
                  }</td></tr>`
                })
                .join('')
              return `<h4>${escapeHtml(panel.label)} <span>(${panel.filledCount})</span></h4>
                <table class="dossier-print__results">${rows || `<tr><td>${escapeHtml(t('Aucune valeur'))}</td></tr>`}</table>`
            })
            .join('')}</div>`
        : ''
    }
  </section>`
}

export function printPatientDossier(input: PatientDossierPrintInput) {
  const t = translateUi
  const patientName = fullName(input.patient.firstName, input.patient.lastName)
  const meta = [
    `${t('Matricule')} : ${input.patient.code}`,
    input.patient.age != null ? `${t('Âge')} : ${input.patient.age}` : null,
    input.patient.phone ? `${t('Téléphone')} : ${input.patient.phone}` : null,
    input.patient.gender ? `${t('Sexe')} : ${input.patient.gender}` : null,
    input.doctorName ? `${t('Médecin')} : ${input.doctorName}` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  const visitsHtml = input.history.length
    ? input.history.map((entry) => visitBlockHtml(entry, t)).join('')
    : `<p class="dossier-print__empty">${escapeHtml(t('Aucune consultation enregistrée.'))}</p>`

  const body = `
${buildClinicPrintHeader(t('Dossier patient'))}
<section class="dossier-print">
  <h1>${escapeHtml(patientName)}</h1>
  <p class="dossier-print__meta">${escapeHtml(meta)}</p>
  ${visitsHtml}
</section>
<style>
  .dossier-print h1 { margin: 0 0 0.35rem; font-size: 1.35rem; }
  .dossier-print__meta { margin: 0 0 1.25rem; color: #64748b; font-size: 0.9rem; }
  .dossier-print__visit {
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    padding: 0.85rem 1rem;
    margin-bottom: 0.85rem;
    page-break-inside: avoid;
  }
  .dossier-print__visit header h2 { margin: 0 0 0.25rem; font-size: 1rem; }
  .dossier-print__visit header p { margin: 0; color: #64748b; font-size: 0.85rem; }
  .dossier-print__block { margin-top: 0.75rem; }
  .dossier-print__block h3 {
    margin: 0 0 0.3rem;
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #64748b;
  }
  .dossier-print__block p, .dossier-print__block ul { margin: 0; font-size: 0.92rem; line-height: 1.45; }
  .dossier-print__block ul { padding-left: 1.1rem; }
  .dossier-print__block h4 { margin: 0.55rem 0 0.3rem; font-size: 0.9rem; }
  .dossier-print__block h4 span { color: #64748b; font-weight: 500; }
  .dossier-print__results {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.88rem;
  }
  .dossier-print__results th,
  .dossier-print__results td {
    border: 1px solid #e2e8f0;
    padding: 0.3rem 0.45rem;
    text-align: left;
    vertical-align: top;
  }
  .dossier-print__results th {
    width: 38%;
    color: #475569;
    font-weight: 600;
    background: #f8fafc;
  }
  .dossier-print__comment { margin-top: 0.2rem; color: #64748b; font-size: 0.8rem; }
  .dossier-print__empty { color: #64748b; font-style: italic; }
</style>`

  openPrintDocument(`${t('Dossier')} ${input.patient.code}`, body, {
    pageSize: 'A4',
    autoPrint: input.autoPrint !== false,
  })
}
