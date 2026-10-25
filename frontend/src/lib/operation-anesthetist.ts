import { getExamCatalogSync } from '@/lib/exam-catalog/store'

/**
 * Anesthésiste obligatoire (avec son %) pour toute opération enregistrée,
 * sauf en Ophtalmologie et en Odontologie. Même règle que le serveur.
 */

const ANESTHETIST_OPTIONAL_SERVICE_KEYS = ['ophtalm', 'odonto']

function foldServiceName(value: string | null | undefined) {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

export function isAnesthetistOptionalService(serviceName: string | null | undefined) {
  const folded = foldServiceName(serviceName)
  return ANESTHETIST_OPTIONAL_SERVICE_KEYS.some((key) => folded.includes(key))
}

export type OperationAnesthetistValue = {
  anesthesiologistId?: string | null
  anesthesiologistName?: string | null
  anesthesiologistPercent?: number | null
} | null | undefined

/** Une personne choisie et un % entre 1 et 99. */
export function hasOperationAnesthetist(assistant: OperationAnesthetistValue) {
  if (!assistant) return false
  const who = !!assistant.anesthesiologistId?.trim() || !!assistant.anesthesiologistName?.trim()
  const percent = assistant.anesthesiologistPercent ?? 0
  return who && percent >= 1 && percent <= 99
}

/** Service de l'opération : service choisi, sinon celui de l'opération du catalogue. */
export function resolveOperationServiceName(input: {
  serviceId?: string | null
  serviceName?: string | null
  operationLabel?: string | null
}) {
  if (input.serviceName?.trim()) return input.serviceName.trim()
  const catalog = getExamCatalogSync().operation
  const serviceId = input.serviceId?.trim()
  if (serviceId) {
    const byService = catalog.find((item) => item.clinicServiceId === serviceId && item.clinicServiceName)
    if (byService?.clinicServiceName) return byService.clinicServiceName
  }
  const label = input.operationLabel?.trim().toLowerCase()
  if (label) {
    const byLabel = catalog.find((item) => item.label.trim().toLowerCase() === label)
    if (byLabel?.clinicServiceName) return byLabel.clinicServiceName
  }
  return input.operationLabel ?? null
}

/** Vrai si l'anesthésiste n'est pas exigé, ou s'il est bien renseigné. */
export function operationAnesthetistReady(
  serviceName: string | null | undefined,
  assistant: OperationAnesthetistValue,
) {
  return isAnesthetistOptionalService(serviceName) || hasOperationAnesthetist(assistant)
}
