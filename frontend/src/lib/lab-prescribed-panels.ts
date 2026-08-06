/** Normalise un libellé examen/formulaire pour comparaison (accents, espaces…). */
export function normalizeLabLabelKey(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export type LabPanelMatchSource = {
  slug: string
  label: string
  matchLabels?: string[]
}

/**
 * Formulaire lié à au moins un des examens prescrits (libellé panel ou examen catalogue).
 */
export function panelMatchesPrescribedExam(
  panel: LabPanelMatchSource,
  prescribedLabels: string[],
): boolean {
  if (!prescribedLabels.length) return false
  const keys = new Set(prescribedLabels.map(normalizeLabLabelKey).filter(Boolean))
  const candidates = [panel.label, ...(panel.matchLabels ?? [])]
  return candidates.some((label) => keys.has(normalizeLabLabelKey(label)))
}

export function filterPanelsForPrescribedExams<T extends LabPanelMatchSource>(
  panels: T[],
  prescribedLabels: string[],
): T[] {
  if (!prescribedLabels.length) return []
  return panels.filter((panel) => panelMatchesPrescribedExam(panel, prescribedLabels))
}
