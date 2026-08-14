import type { LabFormPanel, LabFormSection } from '@/lib/lab-form-panels'
import { translateUi } from '@/i18n/translate'

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
  /** true si un tarif unitaire (> 0) est défini sur le champ. */
  hasUnitPrice: boolean
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
          hasUnitPrice: field.priceFcfa != null && field.priceFcfa > 0,
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

/** Une ligne facturable pour un champ : « Panel (Section: champ) ». */
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

/** Champs individuels dans « Panel (Section: A · B) » ou « Panel (champ) ». */
export function extractPrescribedFieldLabels(prescribed: string): string[] {
  const forms = extractSelectedFormLabels(prescribed)
  if (forms === null || !forms.length) return []
  const fields: string[] = []
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
  return fields
}

/**
 * Nombre d’unités tarifaires dans un libellé prescrit.
 * - « Panel » seul → 1
 * - « Panel (Section: A · B) » → 2 (legacy multi-champs)
 * - « Panel (champ) » ou « Panel (Section: champ) » → 1
 */
export function countPrescribedFieldUnits(prescribed: string): number {
  const fields = extractPrescribedFieldLabels(prescribed)
  if (!fields.length) return 1
  return Math.max(1, fields.length)
}

/**
 * Libellé court pour un chip / détail UI :
 * - « Panel (Section: champ) » → nom de la section
 * - « Panel (Formulaire) » → nom du formulaire
 * - « Panel » seul → libellé panel
 */
export function formatPrescribedChipLabel(prescribed: string): string {
  const forms = extractSelectedFormLabels(prescribed)
  if (!forms?.length) return extractBasePanelLabel(prescribed).trim() || prescribed.trim()
  const parts: string[] = []
  for (const form of forms) {
    const colon = form.indexOf(':')
    if (colon >= 0) {
      const section = form.slice(0, colon).trim()
      if (section) {
        parts.push(section)
        continue
      }
      const rest = form.slice(colon + 1).trim()
      if (rest) {
        parts.push(
          ...rest
            .split(/\s*·\s*/)
            .map((part) => part.trim())
            .filter(Boolean),
        )
      }
      continue
    }
    parts.push(form)
  }
  // Une ligne panier peut contenir plusieurs champs de la même section → une seule entrée.
  return [...new Set(parts)].join(' · ') || extractBasePanelLabel(prescribed)
}

export type PrescribedPanelChipGroup = {
  panel: string
  items: { raw: string; chip: string }[]
}

/** Regroupe les lignes panier par formulaire parent pour l’affichage résumé. */
export function groupPrescribedByPanel(labels: string[]): PrescribedPanelChipGroup[] {
  const order: string[] = []
  const map = new Map<string, { raw: string; chip: string }[]>()
  for (const raw of labels) {
    const panel = extractBasePanelLabel(raw).trim() || raw.trim()
    if (!map.has(panel)) {
      map.set(panel, [])
      order.push(panel)
    }
    map.get(panel)!.push({ raw, chip: formatPrescribedChipLabel(raw) })
  }
  return order.map((panel) => ({ panel, items: map.get(panel)! }))
}

/** Affichage résumé : « Biochimie (3) ». */
export function formatPanelGroupSummaryLabel(
  group: PrescribedPanelChipGroup,
  t: (label: string) => string = translateUi,
): string {
  return `${t(group.panel)} (${group.items.length})`
}

/** Noms des formulaires / sections sélectionnés (détail / tooltip), sans doublons. */
export function formatPanelGroupDetails(
  group: PrescribedPanelChipGroup,
  t: (label: string) => string = translateUi,
): string {
  const names = group.items.map((item) => item.chip.trim()).filter(Boolean)
  const meaningful = names.filter((name) => {
    const key = normalizeLabLabelKey(name)
    if (!key) return false
    // Ne pas répéter le nom du panel ni le libellé générique « Formulaire principal ».
    if (key === normalizeLabLabelKey(group.panel)) return false
    if (key === normalizeLabLabelKey(UNTITLED_SECTION_LABEL)) return false
    return true
  })
  const unique: string[] = []
  const seen = new Set<string>()
  for (const name of meaningful) {
    const key = normalizeLabLabelKey(name)
    if (!key || seen.has(key)) continue
    seen.add(key)
    unique.push(t(name))
  }
  return unique.join(' · ')
}

/** Liste compacte : « Biochimie (2) », « NFS (1) ». */
export function formatGroupedPrescribedLabels(
  labels: string[],
  t: (label: string) => string = translateUi,
): string[] {
  return groupPrescribedByPanel(labels).map((group) => formatPanelGroupSummaryLabel(group, t))
}

export function formatGroupedPrescribedSummary(
  labels: string[],
  t: (label: string) => string = translateUi,
): string {
  const parts = formatGroupedPrescribedLabels(labels, t)
  return parts.length ? parts.join(', ') : '—'
}

/**
 * Détail pour tooltip :
 * « Biochimie (2): Enzymes · NFS (1) ».
 */
export function formatGroupedPrescribedDetails(
  labels: string[],
  t: (label: string) => string = translateUi,
): string {
  const groups = groupPrescribedByPanel(labels)
  if (!groups.length) return '—'
  return groups
    .map((group) => {
      const details = formatPanelGroupDetails(group, t)
      const head = formatPanelGroupSummaryLabel(group, t)
      if (
        !details ||
        normalizeLabLabelKey(details) === normalizeLabLabelKey(group.panel)
      ) {
        return head
      }
      return `${head}: ${details}`
    })
    .join(' · ')
}

export function countGroupedPrescribedPanels(labels: string[]): number {
  return groupPrescribedByPanel(labels).length
}

/**
 * Construit les lignes panier.
 * - Tous les champs cochés → une ligne « Panel » (tarif général de l’examen).
 * - Sélection partielle → une ligne facturable par champ (prix du champ si défini).
 */
export function buildCartEntriesForSelectedFields(
  panelLabel: string,
  groups: LabPrescriptionCheckGroup[],
  fieldLabels: string[],
): string[] {
  const selected = new Set(fieldLabels.map((label) => label.trim()).filter(Boolean))
  if (!selected.size) return []

  const allKnown = groups.flatMap((group) => group.fields.map((field) => field.label.trim()))
  const knownSet = new Set(allKnown)
  const allFormFieldsSelected =
    allKnown.length > 0 &&
    allKnown.every((label) => selected.has(label)) &&
    [...selected].every((label) => knownSet.has(label))

  if (allFormFieldsSelected) {
    return [panelLabel.trim()]
  }

  const lines: string[] = []
  for (const group of groups) {
    for (const field of group.fields) {
      if (!selected.has(field.label)) continue
      lines.push(encodePanelSectionLine(panelLabel, group.title, [field.label]))
    }
  }
  for (const label of selected) {
    if (knownSet.has(label)) continue
    lines.push(encodePanelFormSelection(panelLabel, [label]))
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
