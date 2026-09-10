import {
  isNamedLabSectionTitle,
  UNTITLED_LAB_SECTION_LABEL,
  type LabFormPanel,
  type LabFormSection,
} from './lab-form-panels'
import { translateExamName } from '../i18n/translate'
import {
  billingGroupAliasTitles,
  billingGroupForSectionTitle,
  classicSectionFamily,
  collectSectionsForBillingGroup,
  resolveBillingGroupPriceFcfa,
} from './lab-routine-billing-groups'

const UNTITLED_SECTION_LABEL = UNTITLED_LAB_SECTION_LABEL

export { isNamedLabSectionTitle }

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

type TopLevelParenGroup = { start: number; end: number; inner: string }

/** Groupes `(…)` au niveau 0 (ignore les parenthèses imbriquées dans le contenu). */
function findTopLevelParenGroups(value: string): TopLevelParenGroup[] {
  const groups: TopLevelParenGroup[] = []
  let depth = 0
  let openAt = -1
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i]
    if (char === '(') {
      if (depth === 0) openAt = i
      depth += 1
      continue
    }
    if (char !== ')') continue
    if (depth <= 0) continue
    depth -= 1
    if (depth === 0 && openAt >= 0) {
      groups.push({ start: openAt, end: i, inner: value.slice(openAt + 1, i) })
      openAt = -1
    }
  }
  return groups
}

/**
 * True si le contenu entre parenthèses est un suffixe de sélection encodé
 * (`Section: champs`, section multi-mots, Routine legacy…), et non un acronyme
 * faisant partie du libellé panel (`(TFT)`, `(BHCG)`, `(NFS)`…).
 */
function looksLikeEncodedSelection(inner: string): boolean {
  const trimmed = inner.trim()
  if (!trimmed) return false
  if (trimmed.includes(':')) return true
  if (/\s·\s/.test(trimmed)) return true
  if (splitPrescribedExamList(trimmed).length > 1) return true
  if (normalizeLabLabelKey(trimmed) === normalizeLabLabelKey(UNTITLED_SECTION_LABEL)) return true
  // Sections nommées (« Urine Analysis ») ou alias Routine d’un seul mot (« Disposite »).
  if (/\s/.test(trimmed)) return true
  const family = classicSectionFamily(trimmed)
  return (
    family === 'urine-deposit' ||
    family === 'urine-general' ||
    family === 'stool-general' ||
    family === 'stool-micro'
  )
}

/**
 * Sépare « Panel » et le suffixe de sélection.
 * Gère les libellés qui contiennent déjà des parenthèses :
 * `Thyroid Hormones Test ( TFT) (Formulaire principal: T3)`.
 */
function splitPrescribedPanelAndSelection(prescribed: string): {
  base: string
  selectionInner: string | null
} {
  const trimmed = prescribed.trim()
  const groups = findTopLevelParenGroups(trimmed)
  if (!groups.length) return { base: trimmed, selectionInner: null }

  const last = groups[groups.length - 1]
  if (trimmed.slice(last.end + 1).trim() !== '') {
    return { base: trimmed, selectionInner: null }
  }

  const base = trimmed.slice(0, last.start).trim()
  const inner = last.inner.trim()
  if (!base) return { base: trimmed, selectionInner: null }

  // Plusieurs groupes de niveau 0 → le dernier est toujours la sélection.
  if (groups.length >= 2 || looksLikeEncodedSelection(inner)) {
    return { base, selectionInner: inner }
  }

  // Un seul groupe ambigu (acronyme dans le nom du panel) → pas de sélection.
  return { base: trimmed, selectionInner: null }
}

/** Libellé panel sans le suffixe « (formes cochées) ». */
export function extractBasePanelLabel(prescribed: string): string {
  return splitPrescribedPanelAndSelection(prescribed).base
}

/** Formes / lignes cochées dans « Panel (A, B) », ou null si pas de parenthèses. */
export function extractSelectedFormLabels(prescribed: string): string[] | null {
  const { selectionInner } = splitPrescribedPanelAndSelection(prescribed)
  if (selectionInner === null) return null
  if (!selectionInner) return []
  return splitPrescribedExamList(selectionInner)
}

export function encodePanelFormSelection(panelLabel: string, formLabels: string[]): string {
  const base = panelLabel.trim()
  const unique = [...new Set(formLabels.map((label) => label.trim()).filter(Boolean))]
  if (!unique.length) return base
  return `${base} (${unique.join(', ')})`
}

export type LabPrescriptionCheckItem = {
  /**
   * Identité stable unique dans le panel (`field:…`).
   * À utiliser pour la sélection — les libellés peuvent se répéter entre sections
   * (ex. Colour / Blood dans Urine et Stool).
   */
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
  /** true = section nommée (ex. Urine General) : seule la section est cochable. */
  named: boolean
  /** Tarif de section (si named) ou au moins un champ tarifé (sinon). */
  hasUnitPrice: boolean
  fields: LabPrescriptionCheckItem[]
  /** Titres équivalents (groupes liés Routine) pour décoder d’anciennes lignes panier. */
  aliasTitles?: string[]
}

function sectionTitle(section: LabFormSection): string {
  return section.title?.trim() || UNTITLED_SECTION_LABEL
}

/**
 * Groupes (sections conservées) + champs.
 * Section nommée : coche atomique (tous les champs). Sinon : coche champ par champ.
 * Routine : Urine Analysis + Disposite (et Stool + Micro) = un seul groupe / un seul tarif.
 */
export function getPrescriptionCheckGroups(panel: LabFormPanel): LabPrescriptionCheckGroup[] {
  const sections = panel.sections.filter((section) => section.fields.length > 0)
  const consumed = new Set<number>()
  const groups: LabPrescriptionCheckGroup[] = []

  for (let index = 0; index < sections.length; index += 1) {
    if (consumed.has(index)) continue
    const section = sections[index]
    const title = sectionTitle(section)
    const named = isNamedLabSectionTitle(section.title)
    const billingGroup = named ? billingGroupForSectionTitle(section.title) : null

    if (billingGroup) {
      const linked = collectSectionsForBillingGroup(sections, billingGroup)
      const linkedIndexes = linked
        .map((item) => sections.indexOf(item))
        .filter((i) => i >= 0)
      for (const linkedIndex of linkedIndexes) consumed.add(linkedIndex)

      const fields = linked.flatMap((item) =>
        item.fields.map((field) => ({
          key: `field:${field.key}`,
          label: field.label.trim() || field.key,
          hasUnitPrice: false,
        })),
      )
      const groupPrice = resolveBillingGroupPriceFcfa(linked)
      const aliases = billingGroupAliasTitles(sections, billingGroup)
      groups.push({
        key: `billing:${billingGroup.id}`,
        title: billingGroup.label,
        named: true,
        hasUnitPrice: groupPrice != null,
        fields,
        // aliases utilisés à l’extraction panier (rétrocompat titres Disposite / Urine General…)
        aliasTitles: aliases,
      })
      continue
    }

    consumed.add(index)
    const fields = section.fields.map((field) => ({
      key: `field:${field.key}`,
      label: field.label.trim() || field.key,
      hasUnitPrice: named ? false : field.priceFcfa != null && field.priceFcfa > 0,
    }))
    const sectionPrice = named
      ? section.priceFcfa != null && section.priceFcfa > 0
        ? section.priceFcfa
        : undefined
      : undefined
    groups.push({
      key: `section:${section.title?.trim() || `__untitled_${index}`}`,
      title,
      named,
      hasUnitPrice: named ? sectionPrice != null : fields.some((field) => field.hasUnitPrice),
      fields,
    })
  }

  return groups
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
      const rest = form.slice(colon + 1).trim()
      // Section nommée → chip = section ; « Formulaire principal » → noms des champs (T3…).
      if (section && isNamedLabSectionTitle(section)) {
        parts.push(section)
        continue
      }
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
  t: (label: string) => string = translateExamName,
): string {
  return `${t(group.panel)} (${group.items.length})`
}

/** Noms des formulaires / sections sélectionnés (détail / tooltip), sans doublons. */
export function formatPanelGroupDetails(
  group: PrescribedPanelChipGroup,
  t: (label: string) => string = translateExamName,
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
  t: (label: string) => string = translateExamName,
): string[] {
  return groupPrescribedByPanel(labels).map((group) => formatPanelGroupSummaryLabel(group, t))
}

export function formatGroupedPrescribedSummary(
  labels: string[],
  t: (label: string) => string = translateExamName,
): string {
  const parts = formatGroupedPrescribedLabels(labels, t)
  return parts.length ? parts.join(', ') : '—'
}

/** Résumé compact : uniquement les noms de champs cochés (sans répéter le formulaire parent). */
export function summarizePrescribedExamFieldNames(
  labels: string[],
  t: (label: string) => string = translateExamName,
): string {
  const seen = new Set<string>()
  const parts: string[] = []
  for (const raw of labels) {
    const fields = extractPrescribedFieldLabels(raw)
    if (fields.length) {
      for (const field of fields) {
        const key = normalizeLabLabelKey(field)
        if (!key || key === normalizeLabLabelKey(UNTITLED_SECTION_LABEL) || seen.has(key)) continue
        seen.add(key)
        parts.push(t(field.trim()))
      }
      continue
    }
    const base = extractBasePanelLabel(raw).trim() || raw.trim()
    const key = normalizeLabLabelKey(base)
    if (!key || seen.has(key)) continue
    seen.add(key)
    parts.push(t(base))
  }
  return parts.length ? parts.join(', ') : '—'
}

/**
 * Pour une ligne prescrite : nom de section s’il y en a une, sinon nom complet de l’examen.
 * « Panel (Hématologie: WBC) » → Hématologie
 * « Panel (WBC) » ou « Panel » → Panel
 */
function prescribedSectionOrExamNames(prescribed: string): string[] {
  const panel = extractBasePanelLabel(prescribed).trim() || prescribed.trim()
  const untitledKey = normalizeLabLabelKey(UNTITLED_SECTION_LABEL)
  const forms = extractSelectedFormLabels(prescribed)
  if (!forms?.length) return panel ? [panel] : []

  const names: string[] = []
  for (const form of forms) {
    const colon = form.indexOf(':')
    if (colon >= 0) {
      const section = form.slice(0, colon).trim()
      if (section && normalizeLabLabelKey(section) !== untitledKey) {
        names.push(section)
        continue
      }
    }
    if (panel) names.push(panel)
  }
  return names.length ? names : panel ? [panel] : []
}

/** Premier nom compact d’une ligne prescrite (section ou examen). */
export function primaryPrescribedSectionOrExamName(prescribed: string): string {
  return (
    prescribedSectionOrExamNames(prescribed)[0] ||
    extractBasePanelLabel(prescribed).trim() ||
    prescribed.trim()
  )
}

/** Noms uniques : section si présente, sinon nom complet de l’examen. */
export function extractPrescribedSectionOrExamNames(
  labels: string[],
  t: (label: string) => string = translateExamName,
): string[] {
  const seen = new Set<string>()
  const parts: string[] = []
  for (const raw of labels) {
    for (const name of prescribedSectionOrExamNames(raw)) {
      const trimmed = name.trim()
      const key = normalizeLabLabelKey(trimmed)
      if (!key || seen.has(key)) continue
      seen.add(key)
      parts.push(t(trimmed))
    }
  }
  return parts
}

/** Résumé compact tableaux : sections ou noms d’examens (pas la liste des champs). */
export function summarizePrescribedExamSectionOrName(
  labels: string[],
  t: (label: string) => string = translateExamName,
): string {
  const parts = extractPrescribedSectionOrExamNames(labels, t)
  return parts.length ? parts.join(', ') : '—'
}

/**
 * Détail pour tooltip :
 * « Biochimie (2): Enzymes · NFS (1) ».
 */
export function formatGroupedPrescribedDetails(
  labels: string[],
  t: (label: string) => string = translateExamName,
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

function groupFieldsFullySelected(
  group: LabPrescriptionCheckGroup,
  selected: Set<string>,
): boolean {
  return group.fields.length > 0 && group.fields.every((field) => selected.has(field.key))
}

function resolveFieldKeysByLabels(
  groups: LabPrescriptionCheckGroup[],
  labels: string[],
  sectionTitle?: string,
): string[] {
  const wanted = new Set(labels.map((label) => label.trim()).filter(Boolean))
  if (!wanted.size) return []
  const sectionKey = sectionTitle ? normalizeLabLabelKey(sectionTitle) : ''
  const scoped = sectionKey
    ? groups.filter((group) => normalizeLabLabelKey(group.title) === sectionKey)
    : groups
  const pool = scoped.length ? scoped : groups
  const keys: string[] = []
  for (const group of pool) {
    for (const field of group.fields) {
      if (wanted.has(field.label.trim())) keys.push(field.key)
    }
  }
  return keys
}

/**
 * Construit les lignes panier.
 * - Tous les champs cochés → une ligne « Panel » (tarif général de l’examen).
 * - Section nommée complète → une ligne « Panel (Section) » (tarif de section).
 * - Hors section / héritage → une ligne par champ.
 *
 * `selectedFieldKeys` : identités `LabPrescriptionCheckItem.key` (pas les libellés).
 */
export function buildCartEntriesForSelectedFields(
  panelLabel: string,
  groups: LabPrescriptionCheckGroup[],
  selectedFieldKeys: string[],
): string[] {
  const selected = new Set(selectedFieldKeys.map((key) => key.trim()).filter(Boolean))
  if (!selected.size) return []

  const allKnown = groups.flatMap((group) => group.fields.map((field) => field.key))
  const knownSet = new Set(allKnown)
  const allFormFieldsSelected =
    allKnown.length > 0 &&
    allKnown.every((key) => selected.has(key)) &&
    [...selected].every((key) => knownSet.has(key))

  if (allFormFieldsSelected) {
    return [panelLabel.trim()]
  }

  const lines: string[] = []
  const accounted = new Set<string>()
  for (const group of groups) {
    const selectedInGroup = group.fields.filter((field) => selected.has(field.key))
    if (!selectedInGroup.length) continue
    if (group.named && groupFieldsFullySelected(group, selected)) {
      lines.push(encodePanelFormSelection(panelLabel, [group.title]))
      for (const field of group.fields) accounted.add(field.key)
      continue
    }
    for (const field of selectedInGroup) {
      accounted.add(field.key)
      lines.push(encodePanelSectionLine(panelLabel, group.title, [field.label]))
    }
  }
  for (const key of selected) {
    if (knownSet.has(key) || accounted.has(key)) continue
    // Clé inconnue : conserver tel quel (compat / saisie libre).
    const bare = key.startsWith('field:') ? key.slice('field:'.length) : key
    lines.push(encodePanelFormSelection(panelLabel, [bare]))
  }
  return lines
}

/** Décode un fragment « Section » / « Section: champ » / « champ » vers des clés de champs. */
function expandFormLabelToFieldKeys(
  form: string,
  groups: LabPrescriptionCheckGroup[] | undefined,
): string[] {
  if (!groups?.length) {
    const colon = form.indexOf(':')
    if (colon >= 0) {
      const rest = form.slice(colon + 1).trim()
      if (!rest) return []
      return rest
        .split(/\s*·\s*/)
        .map((part) => part.trim())
        .filter(Boolean)
        .map((label) => `field:${label}`)
    }
    return form.trim() ? [`field:${form.trim()}`] : []
  }

  const colon = form.indexOf(':')
  if (colon >= 0) {
    const section = form.slice(0, colon).trim()
    const rest = form.slice(colon + 1).trim()
    if (!rest) return []
    const labels = rest
      .split(/\s*·\s*/)
      .map((part) => part.trim())
      .filter(Boolean)
    return resolveFieldKeysByLabels(groups, labels, section || undefined)
  }

  const formKey = normalizeLabLabelKey(form)
  const namedGroup = groups.find((group) => {
    if (!group.named) return false
    if (normalizeLabLabelKey(group.title) === formKey) return true
    return (group.aliasTitles ?? []).some(
      (alias) => normalizeLabLabelKey(alias) === formKey,
    )
  })
  if (namedGroup) {
    return namedGroup.fields.map((field) => field.key)
  }
  return resolveFieldKeysByLabels(groups, [form])
}

/**
 * Décode les champs cochés depuis une ou plusieurs lignes panier du même panel.
 * Retourne les clés `LabPrescriptionCheckItem.key` (pas les libellés).
 */
export function extractSelectedFieldsFromCart(
  cart: string[],
  panelLabel: string,
  groups?: LabPrescriptionCheckGroup[],
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
      fields.push(...expandFormLabelToFieldKeys(form, groups))
    }
  }
  return [...new Set(fields)]
}

/** Unités affichées : 1 par section nommée (même partielle), 1 par champ hors section. */
export function countPrescriptionSelectionUnits(
  groups: LabPrescriptionCheckGroup[],
  selectedFieldKeys: string[],
): number {
  const selected = new Set(selectedFieldKeys.map((key) => key.trim()).filter(Boolean))
  let count = 0
  for (const group of groups) {
    if (group.named) {
      if (group.fields.some((field) => selected.has(field.key))) count += 1
      continue
    }
    count += group.fields.filter((field) => selected.has(field.key)).length
  }
  return count
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
