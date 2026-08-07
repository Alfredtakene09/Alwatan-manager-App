import type { LabFormPanel, LabFormSection } from '@/lib/lab-form-panels'

const UNTITLED_SECTION_LABEL = 'Formulaire principal'

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

/**
 * Découpe une liste d’examens séparés par des virgules,
 * sans couper à l’intérieur de parenthèses (formes cochéés).
 */
export function splitPrescribedExamList(raw: string): string[] {
  const items: string[] = []
  let current = ''
  let depth = 0
  for (const char of raw) {
    if (char === '(') depth += 1
    if (char === ')') depth = Math.max(0, depth - 1)
    if (char === ',' && depth === 0) {
      const trimmed = current.trim()
      if (trimmed) items.push(trimmed)
      current = ''
      continue
    }
    current += char
  }
  const last = current.trim()
  if (last) items.push(last)
  return items
}

/** Libellé panel sans le suffixe « (formes cochées) ». */
export function extractBasePanelLabel(prescribed: string): string {
  const trimmed = prescribed.trim()
  const match = trimmed.match(/^(.*?)\s*\((.*)\)\s*$/)
  if (!match) return trimmed
  return match[1].trim() || trimmed
}

/** Formes / lignes cochées dans « Panel (A, B) », ou null si pas de parenthèses. */
export function extractSelectedFormLabels(prescribed: string): string[] | null {
  const trimmed = prescribed.trim()
  const match = trimmed.match(/^(.*?)\s*\((.*)\)\s*$/)
  if (!match) return null
  const inner = match[2].trim()
  if (!inner) return []
  return splitPrescribedExamList(inner)
}

export function encodePanelFormSelection(panelLabel: string, formLabels: string[]): string {
  const base = panelLabel.trim()
  const unique = [...new Set(formLabels.map((label) => label.trim()).filter(Boolean))]
  if (!unique.length) return base
  return `${base} (${unique.join(', ')})`
}

export type LabPrescriptionCheckItem = {
  /** Clé stable pour l’UI (field:…). */
  key: string
  /** Libellé affiché / stocké entre parenthèses. */
  label: string
}

export type LabPrescriptionCheckGroup = {
  key: string
  /** Titre de section (toujours affiché s’il y a des sections). */
  title: string
  fields: LabPrescriptionCheckItem[]
}

function sectionTitle(section: LabFormSection): string {
  return section.title?.trim() || UNTITLED_SECTION_LABEL
}

/**
 * Groupes (sections conservées) + champs cochables.
 * Les sections restent visibles comme titres ; seules les lignes sont cochables.
 */
export function getPrescriptionCheckGroups(panel: LabFormPanel): LabPrescriptionCheckGroup[] {
  return panel.sections
    .filter((section) => section.fields.length > 0)
    .map((section, index) => {
      const title = sectionTitle(section)
      return {
        key: `section:${section.title?.trim() || `__untitled_${index}`}`,
        title,
        fields: section.fields.map((field) => ({
          key: `field:${field.key}`,
          label: field.label.trim() || field.key,
        })),
      }
    })
}

/** Liste plate des champs cochables (pour recherche / compteurs). */
export function getPrescriptionCheckItems(panel: LabFormPanel): LabPrescriptionCheckItem[] {
  return getPrescriptionCheckGroups(panel).flatMap((group) => group.fields)
}

export function findCartEntriesForPanel(cart: string[], panelLabel: string): string[] {
  const baseKey = normalizeLabLabelKey(panelLabel)
  return cart.filter((item) => normalizeLabLabelKey(extractBasePanelLabel(item)) === baseKey)
}

export function findCartEntryForPanel(cart: string[], panelLabel: string): string | undefined {
  return findCartEntriesForPanel(cart, panelLabel)[0]
}

export function isPanelLabelInCart(cart: string[], panelLabel: string): boolean {
  return findCartEntriesForPanel(cart, panelLabel).length > 0
}

export function isPanelLabelExcluded(excludeLabels: string[] | undefined, panelLabel: string): boolean {
  if (!excludeLabels?.length) return false
  const baseKey = normalizeLabLabelKey(panelLabel)
  return excludeLabels.some(
    (label) => normalizeLabLabelKey(extractBasePanelLabel(label)) === baseKey,
  )
}

/** Une ligne facturable par section : « Panel (Section: champ1 · champ2) ». */
export function encodePanelSectionLine(
  panelLabel: string,
  sectionHeading: string,
  fieldLabels: string[],
): string {
  const fields = [...new Set(fieldLabels.map((label) => label.trim()).filter(Boolean))]
  const section = sectionHeading.trim() || UNTITLED_SECTION_LABEL
  if (!fields.length) return encodePanelFormSelection(panelLabel, [section])
  return encodePanelFormSelection(panelLabel, [`${section}: ${fields.join(' · ')}`])
}

/**
 * Construit les lignes panier (1 prix = 1 section touchée).
 * Plusieurs champs d’une même section → une seule ligne.
 */
export function buildCartEntriesForSelectedFields(
  panelLabel: string,
  groups: LabPrescriptionCheckGroup[],
  fieldLabels: string[],
): string[] {
  const selected = new Set(fieldLabels.map((label) => label.trim()).filter(Boolean))
  if (!selected.size) return []
  const lines: string[] = []
  for (const group of groups) {
    const picked = group.fields
      .map((field) => field.label)
      .filter((label) => selected.has(label))
    if (!picked.length) continue
    lines.push(encodePanelSectionLine(panelLabel, group.title, picked))
  }
  const known = new Set(groups.flatMap((group) => group.fields.map((field) => field.label)))
  const orphans = [...selected].filter((label) => !known.has(label))
  if (orphans.length) {
    lines.push(encodePanelFormSelection(panelLabel, orphans))
  }
  return lines
}

/** Décode les champs cochés depuis une ou plusieurs lignes panier du même panel. */
export function extractSelectedFieldsFromCart(
  cart: string[],
  panelLabel: string,
): string[] | null {
  const entries = findCartEntriesForPanel(cart, panelLabel)
  if (!entries.length) return null

  // Panel prescrit entier (sans parenthèses) = tous les champs.
  if (entries.some((entry) => extractSelectedFormLabels(entry) === null)) {
    return null
  }

  const fields: string[] = []
  for (const entry of entries) {
    const forms = extractSelectedFormLabels(entry) ?? []
    for (const form of forms) {
      const colon = form.indexOf(':')
      if (colon >= 0) {
        const rest = form.slice(colon + 1).trim()
        if (!rest) continue
        fields.push(
          ...rest
            .split(/\s*·\s*/)
            .map((part) => part.trim())
            .filter(Boolean),
        )
      } else {
        fields.push(form)
      }
    }
  }
  return [...new Set(fields)]
}

export type LabPanelMatchSource = {
  slug: string
  label: string
  matchLabels?: string[]
}

/**
 * Formulaire lié à au moins un des examens prescrits (libellé panel ou examen catalogue).
 * Accepte aussi « Panel (forme1, forme2) ».
 */
export function panelMatchesPrescribedExam(
  panel: LabPanelMatchSource,
  prescribedLabels: string[],
): boolean {
  if (!prescribedLabels.length) return false
  const keys = new Set(
    prescribedLabels.map((label) => normalizeLabLabelKey(extractBasePanelLabel(label))).filter(Boolean),
  )
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
