import api from '@/api/client'
import { parseLabResultsCompletedAt } from '@/lib/lab-notes'
import type { LabPanelSlug } from '@/lib/lab-form-panels'
import {
  buildPrescribedByLabel,
  printLabVisitPanelResults,
} from '@/lib/lab-panel-print'
import { fullName, ROLE_LABELS, type SessionUser } from '@/lib/roles'

type DossierResponse = {
  panelResults: Partial<Record<LabPanelSlug, Record<string, string>>>
}

type PrintableLabVisit = {
  id: string
  patient: {
    firstName: string
    lastName: string
    code: string
  }
  consultation?: {
    clinicalNotes?: string | null
    doctor?: { firstName: string; lastName: string } | null
  } | null
  assignedDoctor?: { firstName: string; lastName: string } | null
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
      return { ok: false, error: 'Aucun formulaire enregistré pour ce dossier.' }
    }

    const completedAt = parseLabResultsCompletedAt(visit.consultation?.clinicalNotes)
    const validatorLabel = authUser
      ? `${fullName(authUser.firstName, authUser.lastName)} — ${ROLE_LABELS[authUser.role]}`
      : 'Laboratoire'

    const printed = printLabVisitPanelResults(data.panelResults, {
      patientName: fullName(visit.patient.firstName, visit.patient.lastName),
      patientCode: visit.patient.code,
      prescribedBy: buildPrescribedByLabel(
        visit.consultation?.doctor ?? visit.assignedDoctor ?? null,
      ),
      validatedBy: validatorLabel,
      date: completedAt?.toLocaleDateString('fr-FR') ?? new Date().toLocaleDateString('fr-FR'),
    })

    if (!printed) {
      return { ok: false, error: 'Impossible de générer les formulaires à imprimer.' }
    }

    return { ok: true }
  } catch {
    return { ok: false, error: 'Impossible d\'imprimer les résultats.' }
  }
}
