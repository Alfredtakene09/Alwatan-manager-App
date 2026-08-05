import api from '@/api/client'
import { parseLabResultsCompletedAt } from '@/lib/lab-notes'
import type { LabPanelSlug } from '@/lib/lab-form-panels'
import {
  buildPrescribedByLabel,
  printLabVisitPanelResults,
  resolveLabReceptionist,
  type PrescribedByPerson,
} from '@/lib/lab-panel-print'
import { fullName, type SessionUser } from '@/lib/roles'
import { formatAppDate } from '@/i18n/locale-format'
import { translateRole, translateUi } from '@/i18n/translate'

type DossierResponse = {
  panelResults: Partial<Record<LabPanelSlug, Record<string, string>>>
}

type PrintableLabVisit = {
  id: string
  patient: {
    firstName: string
    lastName: string
    code: string
    createdBy?: PrescribedByPerson | null
  }
  consultation?: {
    clinicalNotes?: string | null
    doctor?: PrescribedByPerson | null
    labApprovedBy?: PrescribedByPerson | null
  } | null
  assignedDoctor?: PrescribedByPerson | null
  invoices?: Array<{ issuedBy?: PrescribedByPerson | null }> | null
}

export type LabPrintApiSource = 'laboratoire' | 'medecin'

function dossierApiPath(visitId: string, source: LabPrintApiSource) {
  return source === 'medecin'
    ? `/consultations/labs-resultats/${visitId}`
    : `/laboratoire/visits/${visitId}`
}

export async function fetchAndPrintLabVisitResults(
  visit: PrintableLabVisit,
  authUser: SessionUser | null,
  source: LabPrintApiSource = 'laboratoire',
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { data } = await api.get<DossierResponse>(dossierApiPath(visit.id, source))
    const panelCount = Object.keys(data.panelResults).length

    if (!panelCount) {
      return { ok: false, error: translateUi('Aucun formulaire enregistré pour ce dossier.') }
    }

    const completedAt = parseLabResultsCompletedAt(visit.consultation?.clinicalNotes)
    const validatorLabel = authUser
      ? `${fullName(authUser.firstName, authUser.lastName)} — ${translateRole(authUser.role)}`
      : translateUi('Laboratoire')

    const printed = printLabVisitPanelResults(data.panelResults, {
      patientName: fullName(visit.patient.firstName, visit.patient.lastName),
      patientCode: visit.patient.code,
      prescribedBy: buildPrescribedByLabel(
        visit.consultation?.doctor ?? visit.assignedDoctor ?? null,
        resolveLabReceptionist(visit),
      ),
      validatedBy: validatorLabel,
      date: formatAppDate(completedAt ?? new Date()),
    })

    if (!printed) {
      return { ok: false, error: translateUi('Impossible de générer les formulaires à imprimer.') }
    }

    return { ok: true }
  } catch {
    return { ok: false, error: translateUi("Impossible d'imprimer les résultats.") }
  }
}
