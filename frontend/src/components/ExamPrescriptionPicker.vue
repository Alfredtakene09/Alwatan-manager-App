<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { Search, ChevronDown, ShoppingBag, X, Plus, Check, ChevronRight } from '@lucide/vue'
import UiInput from '@/components/ui/UiInput.vue'
import {
  EXAM_KIND_LABELS,
  HOSPITALISATION_PRESCRIPTION_LABEL,
  examCatalogInvalidateEventName,
  getCatalogForKind,
  getSpecialtyServiceName,
  groupExamsByCategory,
  loadExamCatalog,
  type CatalogExam,
  type ExamKindSlug,
} from '@/lib/exam-catalog'
import { useAppI18n } from '@/i18n/useAppI18n'
import { translateTemplate } from '@/lib/dashboard-i18n'
import { useLabPanelsStore } from '@/stores/lab-panels'
import {
  buildCartEntriesForSelectedFields,
  countPrescriptionSelectionUnits,
  extractSelectedFieldsFromCart,
  getPrescriptionCheckGroups,
  getPrescriptionCheckItems,
  isPanelLabelExcluded,
  isPanelLabelInCart,
  normalizeLabLabelKey,
  type LabPrescriptionCheckGroup,
  type LabPrescriptionCheckItem,
} from '@/lib/lab-prescribed-panels'
import type { LabFormPanel } from '@/lib/lab-form-panels'

const props = defineProps<{
  kind: ExamKindSlug
  modelValue: string[]
  hospitalisationDays?: number | null
  /** En mode ajout : masquer les examens déjà prescrits sur le dossier. */
  excludeLabels?: string[]
  /** Filtre le catalogue selon le médecin (service + Laboratoire/Hospitalisation). */
  doctorId?: string | null
  serviceId?: string | null
  /** Filtre les examens de spécialité sur un service clinique précis. */
  clinicServiceId?: string | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string[]]
  'update:hospitalisationDays': [value: number | null]
}>()

const { uiText, examNameText, localeCode } = useAppI18n()
const labPanels = useLabPanelsStore()

const search = ref('')
const dropdownOpen = ref(false)
const rootRef = ref<HTMLElement | null>(null)
const catalogReady = ref(false)
const catalogEpoch = ref(0)
/** Panel labo dont la checklist (sections / lignes) est dépliée. */
const expandedPanelLabel = ref<string | null>(null)
/** Message si le médecin tente de cocher un champ sans tarif unitaire. */
const fieldNotice = ref('')
const catalogItems = ref(
  getCatalogForKind(props.kind, props.doctorId, props.serviceId, props.clinicServiceId),
)

const NO_UNIT_PRICE_MESSAGE =
  'Ce champ n’a pas de tarif individuel. Cochez le formulaire entier (« Tout sélectionner ») pour appliquer le tarif général.'

const NO_SECTION_PRICE_MESSAGE =
  'Cette section n’a pas de tarif. Renseignez le tarif de section dans les formulaires laboratoire.'


const cart = computed({
  get: () => props.modelValue,
  set: (value: string[]) => emit('update:modelValue', value),
})

const kindLabel = computed(() => {
  void localeCode.value
  void catalogEpoch.value
  if (props.clinicServiceId) {
    const match = catalogItems.value.find((exam) => exam.clinicServiceId === props.clinicServiceId)
    if (match?.clinicServiceName) return uiText(match.clinicServiceName)
  }
  if (props.kind === 'specialty') {
    const serviceName = getSpecialtyServiceName(props.doctorId, props.serviceId)
    if (serviceName) return uiText(serviceName)
  }
  return uiText(EXAM_KIND_LABELS[props.kind])
})

const addKindLabel = computed(() => {
  void localeCode.value
  return translateTemplate('Ajouter — {kind}', { kind: kindLabel.value })
})

/** Grille visible pour tous les types (labo, radio, écho…) — hors hospitalisation. */
const useChipGrid = computed(() => props.kind !== 'hospitalisation')

const gridTitle = computed(() => {
  void localeCode.value
  return kindLabel.value
})

const gridHint = computed(() => {
  void localeCode.value
  if (props.kind === 'examen') {
    return uiText(
      'Cochez un formulaire entier, une section (ex. Urine) ou un champ hors section.',
    )
  }
  return uiText('Cliquez un examen pour le sélectionner ou le retirer.')
})

const emptyCatalogLabel = computed(() => {
  void localeCode.value
  if (props.kind === 'examen') return uiText('Aucun examen laboratoire disponible.')
  return translateTemplate('Aucun examen {kind} disponible.', {
    kind: kindLabel.value.toLowerCase(),
  })
})

const searchPlaceholder = computed(() => {
  void localeCode.value
  if (useChipGrid.value) {
    const count = selectableExams.value.length
    return count > 0
      ? translateTemplate('Filtrer {count} examens ou formulaires…', { count: String(count) })
      : uiText('Filtrer examens ou formulaires…')
  }
  const count = availableExams.value.length
  if (props.kind === 'examen' && count > 0) {
    return translateTemplate('Rechercher parmi {count} examens…', {
      count: String(count),
    })
  }
  return translateTemplate('Rechercher un examen {kind}…', {
    kind: kindLabel.value.toLowerCase(),
  })
})

const catalog = computed(() => {
  void catalogEpoch.value
  return catalogItems.value
})

const selectableExams = computed(() =>
  catalog.value.filter((exam) => !isPanelLabelExcluded(props.excludeLabels, exam.label)),
)

const availableExams = computed(() =>
  selectableExams.value.filter((exam) => !isPanelLabelInCart(cart.value, exam.label)),
)

async function refreshCatalog(force = true) {
  catalogReady.value = false
  await Promise.all([
    loadExamCatalog({
      doctorId: props.doctorId,
      serviceId: props.serviceId,
      force,
    }),
    props.kind === 'examen' ? labPanels.fetchPanels(true) : Promise.resolve(),
  ])
  const items = getCatalogForKind(
    props.kind,
    props.doctorId,
    props.serviceId,
    props.clinicServiceId,
  )
  catalogItems.value =
    props.kind === 'examen'
      ? items.map((exam) => {
          if (exam.labPanelSlug) return exam
          const panel = resolvePanelForExam(exam)
          return panel ? { ...exam, labPanelSlug: panel.slug } : exam
        })
      : items
  catalogEpoch.value += 1
  catalogReady.value = true
}

watch(
  () => [props.doctorId, props.serviceId, props.clinicServiceId, props.kind] as const,
  () => {
    void refreshCatalog()
  },
)

function textMatchesQuery(text: string, q: string) {
  if (!q) return true
  const fr = text.toLowerCase()
  const local = examNameText(text).toLowerCase()
  return fr.includes(q) || local.includes(q)
}

function examMatchesQuery(exam: CatalogExam, q: string) {
  if (!q) return true
  if (textMatchesQuery(exam.label, q) || textMatchesQuery(exam.category, q)) {
    return true
  }
  const groups = checkGroupsForExam(exam)
  return groups.some(
    (group) =>
      textMatchesQuery(group.title, q) ||
      group.fields.some((field) => textMatchesQuery(field.label, q)),
  )
}

/** Conserve les sections ; une section nommée reste entière si un champ matche. */
function filterCheckGroupsByQuery(
  groups: LabPrescriptionCheckGroup[],
  q: string,
  examMatchedByName: boolean,
): LabPrescriptionCheckGroup[] {
  if (!q || examMatchedByName) return groups
  return groups
    .map((group) => {
      if (textMatchesQuery(group.title, q)) return group
      if (group.named && group.fields.some((field) => textMatchesQuery(field.label, q))) {
        return group
      }
      const fields = group.fields.filter((field) => textMatchesQuery(field.label, q))
      if (!fields.length) return null
      return { ...group, fields }
    })
    .filter((group): group is LabPrescriptionCheckGroup => Boolean(group))
}

const filteredExams = computed(() => {
  void localeCode.value
  void labPanels.panels
  const q = search.value.trim().toLowerCase()
  return availableExams.value.filter((exam) => examMatchesQuery(exam, q))
})

/** Grille labo : tous les examens avec formulaire (y compris déjà cochés). */
const filteredSelectableExams = computed(() => {
  void localeCode.value
  void labPanels.panels
  const q = search.value.trim().toLowerCase()
  return selectableExams.value.filter((exam) => examMatchesQuery(exam, q))
})

const groupedFiltered = computed(() => groupExamsByCategory(filteredExams.value))

const groupedSelectable = computed(() => groupExamsByCategory(filteredSelectableExams.value))

/** Numérotation globale 1…N dans la liste déroulante. */
const numberedGroupedFiltered = computed(() => {
  let index = 0
  const rows: Array<{
    category: string
    exams: Array<{ id: string; label: string; number: number }>
  }> = []
  for (const [category, exams] of groupedFiltered.value) {
    rows.push({
      category,
      exams: exams.map((exam) => {
        index += 1
        return { id: exam.id, label: exam.label, number: index }
      }),
    })
  }
  return rows
})

function resolvePanelForExam(exam: CatalogExam): LabFormPanel | undefined {
  // Dépendances réactives Pinia (recalcul quand les formulaires arrivent).
  void labPanels.panels
  void labPanels.panelMatchLabels
  void catalogEpoch.value

  const slug = exam.labPanelSlug?.trim()
  if (slug) {
    const bySlug = labPanels.getPanel(slug)
    if (bySlug) return bySlug
  }

  const labelKey = normalizeLabLabelKey(exam.label)
  if (!labelKey) return undefined

  return labPanels.panels.find((panel) => {
    const candidates = [panel.label, ...(labPanels.matchLabelsFor(panel.slug) ?? [])]
    return candidates.some((label) => normalizeLabLabelKey(label) === labelKey)
  })
}

function checkGroupsForExam(exam: CatalogExam): LabPrescriptionCheckGroup[] {
  const panel = resolvePanelForExam(exam)
  if (!panel) return []
  return getPrescriptionCheckGroups(panel)
}

function checkItemsForExam(exam: CatalogExam): LabPrescriptionCheckItem[] {
  const panel = resolvePanelForExam(exam)
  if (!panel) return []
  return getPrescriptionCheckItems(panel)
}

function flattenGroupFields(groups: LabPrescriptionCheckGroup[]): LabPrescriptionCheckItem[] {
  return groups.flatMap((group) => group.fields)
}

const chipGroups = computed(() => {
  void localeCode.value
  void labPanels.panels
  const q = search.value.trim().toLowerCase()
  let index = 0
  const rows: Array<{
    category: string
    exams: Array<{
      id: string
      label: string
      number: number
      selected: boolean
      allSelected: boolean
      partialSelected: boolean
      expandable: boolean
      expanded: boolean
      displaySuffix: string
      selectedCount: number
      checkGroups: LabPrescriptionCheckGroup[]
      checkItems: LabPrescriptionCheckItem[]
      allCheckItems: LabPrescriptionCheckItem[]
      selectedForms: string[]
    }>
  }> = []
  for (const [category, exams] of groupedSelectable.value) {
    rows.push({
      category,
      exams: exams.map((exam) => {
        index += 1
        const allGroups = checkGroupsForExam(exam)
        const allCheckItems = flattenGroupFields(allGroups)
        const matchedByName =
          !q || textMatchesQuery(exam.label, q) || textMatchesQuery(exam.category, q)
        const checkGroups = filterCheckGroupsByQuery(allGroups, q, matchedByName)
        const checkItems = flattenGroupFields(checkGroups)
        const parsedFields = extractSelectedFieldsFromCart(cart.value, exam.label, allGroups)
        // Clés `item.key` (pas les libellés) — évite de cocher Colour/Blood dans plusieurs sections.
        const selectedForms = !parsedFields
          ? isPanelLabelInCart(cart.value, exam.label)
            ? allCheckItems.map((item) => item.key)
            : []
          : parsedFields
        const selected = isPanelLabelInCart(cart.value, exam.label)
        // Sans formulaires (ex. Odonto) : sélection globale = case active.
        const allSelected =
          selected &&
          (allCheckItems.length === 0 ||
            allCheckItems.every((item) => selectedForms.includes(item.key)))
        const partialSelected = selected && !allSelected && selectedForms.length > 0
        const selectedCount = countPrescriptionSelectionUnits(allGroups, selectedForms)
        const displaySuffix = selectedCount > 0 ? ` (${selectedCount})` : ''
        const forceExpand = Boolean(q) && !matchedByName && checkItems.length > 0 && !selected
        // Détail des champs uniquement si l’utilisateur déroule volontairement.
        const expanded = expandedPanelLabel.value === exam.label || forceExpand
        return {
          id: exam.id,
          label: exam.label,
          number: index,
          selected,
          allSelected,
          partialSelected,
          expandable: allCheckItems.length > 0,
          expanded,
          displaySuffix,
          selectedCount,
          checkGroups,
          checkItems,
          allCheckItems,
          selectedForms,
        }
      }),
    })
  }
  return rows
})

const hasResults = computed(() => numberedGroupedFiltered.value.length > 0)

const hasChipResults = computed(() => chipGroups.value.length > 0)

const selectedCountLabel = computed(() => {
  void localeCode.value
  const n = cart.value.length
  if (n === 0) return uiText('Aucun examen sélectionné')
  if (n === 1) return uiText('1 examen sélectionné')
  return translateTemplate('{n} examens sélectionnés', { n: String(n) })
})

function addExam(label: string) {
  if (isPanelLabelInCart(cart.value, label)) return
  // Formulaires labo : tous les champs = 1 ligne tarif général ; partiel = 1 ligne / champ.
  if (props.kind === 'examen') {
    const catalogExam =
      catalogItems.value.find((item) => item.label === label) ??
      ({ id: label, code: '', label, category: 'Laboratoire', priceFcfa: 0 } as CatalogExam)
    const allItems = checkItemsForExam(catalogExam)
    if (allItems.length > 0) {
      setPanelForms(
        label,
        allItems.map((item) => item.label),
      )
      if (!useChipGrid.value) search.value = ''
      return
    }
  }
  cart.value = [...cart.value, label]
  if (!useChipGrid.value) search.value = ''
}

function toggleExam(label: string) {
  if (isPanelLabelInCart(cart.value, label)) {
    removeExam(label)
  } else {
    addExam(label)
  }
}

async function onChipExpand(exam: {
  label: string
  expandable: boolean
  expanded: boolean
}) {
  fieldNotice.value = ''
  if (exam.expandable) {
    expandedPanelLabel.value = exam.expanded ? null : exam.label
    return
  }

  // Formulaires pas encore résolus : recharger les panels puis réessayer.
  if (props.kind === 'examen') {
    await ensureLabPanelsReady()
    const catalogExam =
      catalogItems.value.find((item) => item.label === exam.label) ??
      ({ id: exam.label, code: '', label: exam.label, category: 'Laboratoire', priceFcfa: 0 } as CatalogExam)
    if (checkItemsForExam(catalogExam).length > 0) {
      expandedPanelLabel.value = exam.label
      return
    }
  }

  toggleExam(exam.label)
}

/** Coche le formulaire entier (tous les champs) ou le retire. */
function togglePanelAll(exam: {
  label: string
  expandable: boolean
  allSelected: boolean
  allCheckItems: LabPrescriptionCheckItem[]
}) {
  if (!exam.expandable || exam.allCheckItems.length === 0) {
    toggleExam(exam.label)
    return
  }
  if (exam.allSelected) {
    clearAllForms(exam.label)
    return
  }
  selectAllForms(exam.label, exam.allCheckItems)
  // Replier le détail : la carte ne garde que le nom + compteur.
  if (expandedPanelLabel.value === exam.label) {
    expandedPanelLabel.value = null
  }
}

/** Coche / décoche une section nommée (tous les champs) ou les champs tarifés d’une section sans titre. */
function toggleSectionForms(panelLabel: string, section: LabPrescriptionCheckGroup) {
  const sectionFields = section.fields
  if (!sectionFields.length) return
  const catalogExam =
    catalogItems.value.find((item) => item.label === panelLabel) ??
    ({
      id: panelLabel,
      code: '',
      label: panelLabel,
      category: 'Laboratoire',
      priceFcfa: 0,
    } as CatalogExam)
  const allItems = checkItemsForExam(catalogExam)
  const current = currentSelectedFields(panelLabel, allItems)

  if (section.named) {
    if (!section.hasUnitPrice) {
      fieldNotice.value = uiText(NO_SECTION_PRICE_MESSAGE)
      return
    }
    const sectionKeys = sectionFields.map((item) => item.key)
    const allSelected = sectionKeys.every((key) => current.includes(key))
    fieldNotice.value = ''
    if (allSelected) {
      setPanelForms(
        panelLabel,
        current.filter((key) => !sectionKeys.includes(key)),
      )
      return
    }
    setPanelForms(panelLabel, [...new Set([...current, ...sectionKeys])])
    return
  }

  const pricedSection = sectionFields.filter((item) => item.hasUnitPrice)
  const sectionKeys = sectionFields.map((item) => item.key)
  const pricedKeys = pricedSection.map((item) => item.key)

  if (!pricedKeys.length) {
    fieldNotice.value = uiText(NO_UNIT_PRICE_MESSAGE)
    return
  }

  const allPricedSelected = pricedKeys.every((key) => current.includes(key))
  if (allPricedSelected) {
    fieldNotice.value = ''
    setPanelForms(
      panelLabel,
      current.filter((key) => !sectionKeys.includes(key)),
    )
    return
  }

  if (pricedKeys.length < sectionFields.length) {
    fieldNotice.value = uiText(NO_UNIT_PRICE_MESSAGE)
  } else {
    fieldNotice.value = ''
  }
  const merged = new Set([...current, ...pricedKeys])
  setPanelForms(panelLabel, [...merged])
}

function isSectionFullySelected(
  selectedForms: string[],
  section: LabPrescriptionCheckGroup,
) {
  if (!section.fields.length) return false
  if (section.named) {
    return section.fields.every((item) => selectedForms.includes(item.key))
  }
  const priced = section.fields.filter((item) => item.hasUnitPrice)
  const pool = priced.length ? priced : section.fields
  return pool.every((item) => selectedForms.includes(item.key))
}

function isSectionPartiallySelected(
  selectedForms: string[],
  section: LabPrescriptionCheckGroup,
) {
  if (!section.fields.length) return false
  const pool = section.named
    ? section.fields
    : (() => {
        const priced = section.fields.filter((item) => item.hasUnitPrice)
        return priced.length ? priced : section.fields
      })()
  const count = pool.filter((item) => selectedForms.includes(item.key)).length
  return count > 0 && count < pool.length
}

async function ensureLabPanelsReady() {
  if (props.kind !== 'examen') return
  await labPanels.fetchPanels(true)
  catalogItems.value = catalogItems.value.map((exam) => {
    if (exam.labPanelSlug) return exam
    const panel = resolvePanelForExam(exam)
    return panel ? { ...exam, labPanelSlug: panel.slug } : exam
  })
  catalogEpoch.value += 1
}

function setPanelForms(panelLabel: string, fieldKeys: string[]) {
  const catalogExam =
    catalogItems.value.find((item) => item.label === panelLabel) ??
    ({
      id: panelLabel,
      code: '',
      label: panelLabel,
      category: 'Laboratoire',
      priceFcfa: 0,
    } as CatalogExam)
  const groups = checkGroupsForExam(catalogExam)
  const allItems = flattenGroupFields(groups)
  const selected = new Set(fieldKeys.map((key) => key.trim()).filter(Boolean))
  const allKnown = allItems.map((item) => item.key)
  const knownSet = new Set(allKnown)
  const allFormFieldsSelected =
    allKnown.length > 0 &&
    allKnown.every((key) => selected.has(key)) &&
    [...selected].every((key) => knownSet.has(key))

  const namedSectionFieldKeys = new Set<string>()
  for (const group of groups) {
    if (!group.named) continue
    const keys = group.fields.map((field) => field.key)
    if (keys.length && keys.every((key) => selected.has(key))) {
      for (const key of keys) namedSectionFieldKeys.add(key)
    }
  }

  let keys = [...selected]
  if (!allFormFieldsSelected) {
    const blocked = keys.filter((key) => {
      if (namedSectionFieldKeys.has(key)) return false
      const item = allItems.find((entry) => entry.key === key)
      return item ? !item.hasUnitPrice : false
    })
    keys = keys.filter((key) => {
      if (namedSectionFieldKeys.has(key)) return true
      const item = allItems.find((entry) => entry.key === key)
      return item?.hasUnitPrice === true
    })
    if (blocked.length) {
      fieldNotice.value = uiText(NO_UNIT_PRICE_MESSAGE)
    } else {
      fieldNotice.value = ''
    }
  } else {
    fieldNotice.value = ''
  }

  const nextEntries = buildCartEntriesForSelectedFields(panelLabel, groups, keys)
  const without = cart.value.filter((item) => !isPanelLabelInCart([item], panelLabel))
  cart.value = [...without, ...nextEntries]
  // Garder le panneau ouvert pour cocher plusieurs champs sans re-développer.
}

function currentSelectedFields(panelLabel: string, allItems: LabPrescriptionCheckItem[]): string[] {
  const catalogExam =
    catalogItems.value.find((item) => item.label === panelLabel) ??
    ({
      id: panelLabel,
      code: '',
      label: panelLabel,
      category: 'Laboratoire',
      priceFcfa: 0,
    } as CatalogExam)
  const groups = checkGroupsForExam(catalogExam)
  const parsed = extractSelectedFieldsFromCart(cart.value, panelLabel, groups)
  if (parsed === null) {
    return isPanelLabelInCart(cart.value, panelLabel)
      ? allItems.map((item) => item.key)
      : []
  }
  return parsed
}

function toggleFormItem(panelLabel: string, item: LabPrescriptionCheckItem) {
  const catalogExam =
    catalogItems.value.find((entry) => entry.label === panelLabel) ??
    ({
      id: panelLabel,
      code: '',
      label: panelLabel,
      category: 'Laboratoire',
      priceFcfa: 0,
    } as CatalogExam)
  const allItems = checkItemsForExam(catalogExam)
  const current = currentSelectedFields(panelLabel, allItems)
  if (current.includes(item.key)) {
    fieldNotice.value = ''
    setPanelForms(
      panelLabel,
      current.filter((key) => key !== item.key),
    )
    return
  }
  if (!item.hasUnitPrice) {
    fieldNotice.value = uiText(NO_UNIT_PRICE_MESSAGE)
    return
  }
  fieldNotice.value = ''
  setPanelForms(panelLabel, [...current, item.key])
}

function onUnpricedFieldClick(item: LabPrescriptionCheckItem) {
  if (item.hasUnitPrice) return
  fieldNotice.value = uiText(NO_UNIT_PRICE_MESSAGE)
}

function selectAllForms(
  panelLabel: string,
  visibleItems: LabPrescriptionCheckItem[],
) {
  const catalogExam =
    catalogItems.value.find((item) => item.label === panelLabel) ??
    ({
      id: panelLabel,
      code: '',
      label: panelLabel,
      category: 'Laboratoire',
      priceFcfa: 0,
    } as CatalogExam)
  const allItems = checkItemsForExam(catalogExam)
  const current = currentSelectedFields(panelLabel, allItems)
  const visibleSet = new Set(visibleItems.map((item) => item.key))
  const kept = current.filter((key) => !visibleSet.has(key))
  setPanelForms(panelLabel, [...kept, ...visibleItems.map((item) => item.key)])
}

function selectAllFormsAndCollapse(
  panelLabel: string,
  visibleItems: LabPrescriptionCheckItem[],
) {
  selectAllForms(panelLabel, visibleItems)
  if (expandedPanelLabel.value === panelLabel) {
    expandedPanelLabel.value = null
  }
}

function clearAllForms(
  panelLabel: string,
  visibleItems?: LabPrescriptionCheckItem[],
) {
  if (!visibleItems?.length) {
    setPanelForms(panelLabel, [])
    return
  }
  const catalogExam =
    catalogItems.value.find((item) => item.label === panelLabel) ??
    ({
      id: panelLabel,
      code: '',
      label: panelLabel,
      category: 'Laboratoire',
      priceFcfa: 0,
    } as CatalogExam)
  const allItems = checkItemsForExam(catalogExam)
  const current = currentSelectedFields(panelLabel, allItems)
  const visibleSet = new Set(visibleItems.map((item) => item.key))
  setPanelForms(
    panelLabel,
    current.filter((key) => !visibleSet.has(key)),
  )
}

const isHospitalisationKind = computed(() => props.kind === 'hospitalisation')

const hospitalisationPrescribed = computed(() =>
  cart.value.includes(HOSPITALISATION_PRESCRIPTION_LABEL),
)

const hospitalisationDays = computed(() => props.hospitalisationDays)

function removeExam(label: string) {
  cart.value = cart.value.filter((item) => !isPanelLabelInCart([item], label))
  if (expandedPanelLabel.value === label) expandedPanelLabel.value = null
}

function toggleHospitalisation() {
  if (hospitalisationPrescribed.value) {
    cart.value = []
    emit('update:hospitalisationDays', null)
  } else {
    cart.value = [HOSPITALISATION_PRESCRIPTION_LABEL]
    if (props.hospitalisationDays == null || props.hospitalisationDays < 1) {
      emit('update:hospitalisationDays', 1)
    }
  }
}

function onHospitalisationDaysInput(value: string | number) {
  const parsed = Number.parseInt(String(value), 10)
  emit('update:hospitalisationDays', Number.isFinite(parsed) && parsed >= 1 ? parsed : null)
}

async function toggleDropdown() {
  dropdownOpen.value = !dropdownOpen.value
  if (dropdownOpen.value) {
    search.value = ''
    if (props.kind === 'examen') await refreshCatalog(true)
  }
}

async function onSearchFocus() {
  dropdownOpen.value = true
  if (props.kind === 'examen') await refreshCatalog(true)
}

function onClickOutside(event: MouseEvent) {
  if (!rootRef.value?.contains(event.target as Node)) {
    dropdownOpen.value = false
  }
}

onMounted(async () => {
  document.addEventListener('click', onClickOutside)
  window.addEventListener(examCatalogInvalidateEventName(), onCatalogInvalidate)
  await refreshCatalog()
})

onUnmounted(() => {
  document.removeEventListener('click', onClickOutside)
  window.removeEventListener(examCatalogInvalidateEventName(), onCatalogInvalidate)
})

function onCatalogInvalidate() {
  void refreshCatalog(true)
}
</script>

<template>
  <div ref="rootRef" class="exam-picker">
    <template v-if="isHospitalisationKind">
      <label class="exam-picker__label">{{ uiText('Orientation hospitalisation') }}</label>
      <p class="exam-picker__hosp-hint">
        {{
          uiText(
            "Le médecin oriente le patient vers l'hospitalisation. Le choix de la salle, la disponibilité des salles et le paiement se font à la réception.",
          )
        }}
      </p>
      <button
        type="button"
        class="exam-picker__hosp-toggle"
        :class="{ 'exam-picker__hosp-toggle--active': hospitalisationPrescribed }"
        :disabled="!catalogReady"
        @click="toggleHospitalisation"
      >
        {{
          hospitalisationPrescribed
            ? uiText('Hospitalisation prescrite')
            : uiText('Prescrire une hospitalisation')
        }}
      </button>
      <div v-if="hospitalisationPrescribed" class="exam-picker__cart exam-picker__cart--inline">
        <div class="exam-picker__cart-head">
          <ShoppingBag :size="16" />
          <span>{{ uiText('Hospitalisation') }}</span>
          <strong>1</strong>
        </div>
        <ul class="exam-picker__cart-list">
          <li class="exam-picker__cart-item">
            <span class="exam-picker__cart-num">1</span>
            <span class="exam-picker__cart-label">{{
              uiText(HOSPITALISATION_PRESCRIPTION_LABEL)
            }}</span>
            <button
              type="button"
              class="exam-picker__cart-remove"
              :aria-label="uiText('Retirer')"
              @click="toggleHospitalisation"
            >
              <X :size="14" />
            </button>
          </li>
        </ul>
      </div>
      <UiInput
        v-if="hospitalisationPrescribed"
        :model-value="hospitalisationDays ?? 1"
        label="Nombre de jours d'hospitalisation"
        type="number"
        min="1"
        max="365"
        required
        @update:model-value="onHospitalisationDaysInput"
      />
    </template>

    <template v-else-if="useChipGrid">
      <div class="exam-picker__chip-toolbar">
        <label class="exam-picker__label">{{ gridTitle }}</label>
        <span
          class="exam-picker__chip-count"
          :class="{ 'exam-picker__chip-count--active': cart.length }"
        >
          {{ selectedCountLabel }}
        </span>
      </div>
      <p class="exam-picker__chip-hint">{{ gridHint }}</p>

      <div class="exam-picker__search-wrap exam-picker__search-wrap--static">
        <div class="exam-picker__trigger">
          <Search :size="16" class="exam-picker__search-icon" />
          <input
            v-model="search"
            type="search"
            class="exam-picker__search-input"
            :placeholder="searchPlaceholder"
          />
        </div>
      </div>

      <p v-if="!catalogReady" class="exam-picker__empty">{{ uiText('Chargement du catalogue…') }}</p>
      <div
        v-else-if="hasChipResults"
        class="exam-picker__chip-board"
        role="listbox"
        aria-multiselectable="true"
      >
        <section
          v-for="group in chipGroups"
          :key="group.category"
          class="exam-picker__chip-group"
        >
          <h4 class="exam-picker__chip-group-label">{{ examNameText(group.category) }}</h4>
          <div class="exam-picker__chip-stack">
            <div
              v-for="exam in group.exams"
              :key="exam.id"
              class="exam-picker__chip-block"
              :class="{ 'exam-picker__chip-block--expanded': exam.expanded }"
            >
              <div
                class="exam-picker__chip"
                :class="{
                  'exam-picker__chip--selected': exam.selected,
                  'exam-picker__chip--partial': exam.partialSelected,
                  'exam-picker__chip--expanded': exam.expanded,
                }"
                role="option"
                :aria-selected="exam.selected"
              >
                <button
                  type="button"
                  class="exam-picker__chip-check"
                  :class="{
                    'exam-picker__chip-check--on': exam.allSelected,
                    'exam-picker__chip-check--partial': exam.partialSelected,
                  }"
                  :title="
                    exam.expandable
                      ? uiText('Tout sélectionner / tout retirer')
                      : uiText('Sélectionner')
                  "
                  :aria-label="
                    exam.expandable
                      ? `${examNameText(exam.label)} — ${uiText('Tout sélectionner / tout retirer')}`
                      : examNameText(exam.label)
                  "
                  @click="togglePanelAll(exam)"
                >
                  <Check v-if="exam.allSelected" :size="12" />
                  <span v-else-if="exam.partialSelected" class="exam-picker__chip-dash" />
                </button>
                <button
                  type="button"
                  class="exam-picker__chip-main"
                  :aria-expanded="exam.expandable ? exam.expanded : undefined"
                  @click="onChipExpand(exam)"
                >
                  <span class="exam-picker__chip-label">{{ examNameText(exam.label) }}</span>
                  <span
                    v-if="exam.selectedCount > 0"
                    class="exam-picker__chip-count-badge"
                    :title="translateTemplate('{n} éléments sélectionnés', { n: String(exam.selectedCount) })"
                  >
                    {{ exam.selectedCount }}
                  </span>
                  <ChevronRight
                    v-if="exam.expandable"
                    :size="12"
                    class="exam-picker__chip-chevron"
                    :class="{ 'exam-picker__chip-chevron--open': exam.expanded }"
                  />
                </button>
              </div>

              <div v-if="exam.expanded" class="exam-picker__forms" @click.stop>
                <div class="exam-picker__forms-toolbar">
                  <span class="exam-picker__forms-title">{{
                    exam.checkGroups.some((section) => section.named)
                      ? uiText('Sections et champs à cocher')
                      : uiText('Champs à cocher')
                  }}</span>
                  <div class="exam-picker__forms-actions">
                    <button
                      type="button"
                      class="exam-picker__forms-link"
                      @click="selectAllFormsAndCollapse(exam.label, exam.checkItems)"
                    >
                      {{ uiText('Tout sélectionner') }}
                    </button>
                    <button
                      type="button"
                      class="exam-picker__forms-link"
                      @click="clearAllForms(exam.label, exam.checkItems)"
                    >
                      {{ uiText('Tout retirer') }}
                    </button>
                  </div>
                </div>
                <p v-if="fieldNotice" class="exam-picker__field-notice" role="status">
                  {{ fieldNotice }}
                </p>
                <div class="exam-picker__forms-groups">
                  <div
                    v-for="section in exam.checkGroups"
                    :key="section.key"
                    class="exam-picker__forms-group"
                  >
                    <label class="exam-picker__forms-section">
                      <input
                        type="checkbox"
                        :checked="isSectionFullySelected(exam.selectedForms, section)"
                        :indeterminate="isSectionPartiallySelected(exam.selectedForms, section)"
                        @change="toggleSectionForms(exam.label, section)"
                      />
                      <span>{{ examNameText(section.title) }}</span>
                    </label>
                    <ul
                      v-if="section.named"
                      class="exam-picker__forms-preview"
                    >
                      <li v-for="item in section.fields" :key="item.key">
                        {{ examNameText(item.label) }}
                      </li>
                    </ul>
                    <ul v-else class="exam-picker__forms-list">
                      <li v-for="item in section.fields" :key="item.key">
                        <label
                          class="exam-picker__form-row"
                          :class="{ 'exam-picker__form-row--blocked': !item.hasUnitPrice }"
                          :title="
                            item.hasUnitPrice
                              ? undefined
                              : uiText(NO_UNIT_PRICE_MESSAGE)
                          "
                          @click="onUnpricedFieldClick(item)"
                        >
                          <input
                            type="checkbox"
                            :checked="exam.selectedForms.includes(item.key)"
                            :disabled="!item.hasUnitPrice"
                            @change="toggleFormItem(exam.label, item)"
                          />
                          <span>{{ examNameText(item.label) }}</span>
                        </label>
                      </li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
      <p v-else class="exam-picker__empty">
        {{
          selectableExams.length === 0
            ? emptyCatalogLabel
            : uiText('Aucun examen trouvé.')
        }}
      </p>
    </template>

    <template v-else>
      <label class="exam-picker__label">{{ addKindLabel }}</label>

      <div class="exam-picker__search-wrap">
        <button
          type="button"
          class="exam-picker__trigger"
          :class="{ 'exam-picker__trigger--open': dropdownOpen }"
          aria-haspopup="listbox"
          :aria-expanded="dropdownOpen"
          @click.stop="toggleDropdown"
        >
          <Search :size="16" class="exam-picker__search-icon" />
          <input
            v-model="search"
            type="search"
            class="exam-picker__search-input"
            :placeholder="searchPlaceholder"
            @focus="onSearchFocus"
            @click.stop
            @keydown.escape="dropdownOpen = false"
          />
          <ChevronDown
            :size="16"
            class="exam-picker__chevron"
            :class="{ 'exam-picker__chevron--open': dropdownOpen }"
          />
        </button>

        <div v-if="dropdownOpen" class="exam-picker__dropdown" role="listbox">
          <p v-if="!catalogReady" class="exam-picker__empty">
            {{ uiText('Chargement du catalogue…') }}
          </p>
          <template v-else-if="hasResults">
            <div
              v-for="group in numberedGroupedFiltered"
              :key="group.category"
              class="exam-picker__group"
            >
              <div class="exam-picker__group-label">{{ examNameText(group.category) }}</div>
              <button
                v-for="exam in group.exams"
                :key="exam.id"
                type="button"
                class="exam-picker__option"
                role="option"
                @click="addExam(exam.label)"
              >
                <span class="exam-picker__option-main">
                  <span class="exam-picker__option-num">{{ exam.number }}</span>
                  <span class="exam-picker__option-label">{{ examNameText(exam.label) }}</span>
                </span>
                <Plus :size="15" />
              </button>
            </div>
          </template>
          <p v-else class="exam-picker__empty">
            {{
              availableExams.length === 0
                ? uiText('Tous les examens sont déjà sélectionnés.')
                : uiText('Aucun examen trouvé.')
            }}
          </p>
        </div>
      </div>

      <div v-if="cart.length" class="exam-picker__cart exam-picker__cart--inline">
        <div class="exam-picker__cart-head">
          <ShoppingBag :size="16" />
          <span>{{ kindLabel }}</span>
          <strong>{{ cart.length }}</strong>
        </div>
        <ul class="exam-picker__cart-list">
          <li v-for="(exam, index) in cart" :key="exam" class="exam-picker__cart-item">
            <span class="exam-picker__cart-num">{{ index + 1 }}</span>
            <span class="exam-picker__cart-label">{{ examNameText(exam) }}</span>
            <button
              type="button"
              class="exam-picker__cart-remove"
              :aria-label="uiText('Retirer')"
              @click="removeExam(exam)"
            >
              <X :size="14" />
            </button>
          </li>
        </ul>
      </div>
    </template>
  </div>
</template>

<style scoped>
.exam-picker {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.exam-picker__label {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-muted);
}

.exam-picker__search-wrap {
  position: relative;
}

.exam-picker__trigger {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.55rem 0.75rem;
  border: 1.5px solid var(--border);
  border-radius: var(--radius-sm);
  background: #fff;
  cursor: text;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.exam-picker__trigger--open,
.exam-picker__trigger:focus-within {
  border-color: var(--primary-400);
  box-shadow: 0 0 0 3px var(--focus-ring-sm);
}

.exam-picker__search-icon {
  color: var(--text-light);
  flex-shrink: 0;
}

.exam-picker__search-input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  font-family: var(--font);
  font-size: 0.875rem;
  color: var(--text);
  outline: none;
}

.exam-picker__search-input::placeholder {
  color: var(--text-light);
}

.exam-picker__chevron {
  color: var(--text-light);
  flex-shrink: 0;
  transition: transform 0.2s;
}

.exam-picker__chevron--open {
  transform: rotate(180deg);
}

.exam-picker__dropdown {
  position: absolute;
  top: calc(100% + 0.35rem);
  left: 0;
  right: 0;
  z-index: 20;
  max-height: min(28rem, 60vh);
  overflow-y: auto;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-md);
  padding: 0.35rem;
}

.exam-picker__group + .exam-picker__group {
  margin-top: 0.35rem;
  padding-top: 0.35rem;
  border-top: 1px solid var(--border);
}

.exam-picker__group-label {
  padding: 0.35rem 0.5rem 0.25rem;
  font-size: 0.625rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-light);
}

.exam-picker__option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  width: 100%;
  padding: 0.55rem 0.6rem;
  border: 0;
  border-radius: 8px;
  background: transparent;
  font-family: var(--font);
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--text);
  text-align: left;
  cursor: pointer;
  transition: background 0.12s;
}

.exam-picker__option-main {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  min-width: 0;
}

.exam-picker__option-num {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.55rem;
  height: 1.55rem;
  padding: 0 0.3rem;
  border-radius: 6px;
  background: var(--primary-50, #eff6ff);
  color: var(--primary-700, #1d4ed8);
  font-size: 0.6875rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.exam-picker__option-label {
  min-width: 0;
  overflow-wrap: anywhere;
}

.exam-picker__option:hover {
  background: var(--primary-50);
  color: var(--primary-800);
}

.exam-picker__option svg {
  color: var(--primary-600);
  flex-shrink: 0;
  opacity: 0.7;
}

.exam-picker__empty {
  margin: 0;
  padding: 1rem 0.75rem;
  font-size: 0.8125rem;
  color: var(--text-muted);
  text-align: center;
}

.exam-picker__cart--inline {
  border: 1px solid var(--primary-100);
  border-radius: var(--radius-sm);
  background: #fff;
  padding: 0.65rem 0.75rem;
}

.exam-picker__cart-head {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  margin-bottom: 0.55rem;
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--primary-800);
}

.exam-picker__cart-head strong {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.5rem;
  height: 1.5rem;
  padding: 0 0.4rem;
  border-radius: 999px;
  background: var(--primary-600);
  color: #fff;
  font-size: 0.75rem;
}

.exam-picker__cart-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  max-height: 8rem;
  overflow-y: auto;
}

.exam-picker__cart-item {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.45rem 0.5rem;
  background: var(--brand-red-50, #fdecea);
  border: 1px solid var(--brand-red-100, #f9c7c5);
  border-radius: 8px;
}

.exam-picker__cart-num {
  width: 1.35rem;
  height: 1.35rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  background: var(--brand-red-100, #f9c7c5);
  color: var(--brand-red-800, #8e1515);
  font-size: 0.6875rem;
  font-weight: 700;
  flex-shrink: 0;
}

.exam-picker__cart-label {
  flex: 1;
  min-width: 0;
  font-size: 0.8125rem;
  font-weight: 700;
  line-height: 1.3;
  color: var(--brand-red-700, #b71c1c);
}

.exam-picker__cart-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.65rem;
  height: 1.65rem;
  border: 0;
  border-radius: 6px;
  background: #fee2e2;
  color: var(--danger);
  cursor: pointer;
  flex-shrink: 0;
}

.exam-picker__hosp-hint {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--text-muted);
  line-height: 1.45;
}

.exam-picker__hosp-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  padding: 0.7rem 1rem;
  border: 1.5px solid var(--primary-200);
  border-radius: var(--radius-sm);
  background: #fff;
  color: var(--primary-800);
  font-family: inherit;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}

.exam-picker__hosp-toggle:hover:not(:disabled) {
  background: var(--primary-50);
}

.exam-picker__hosp-toggle--active {
  background: var(--primary-600);
  border-color: var(--primary-600);
  color: #fff;
}

.exam-picker__hosp-toggle:disabled {
  opacity: 0.6;
  cursor: wait;
}

.exam-picker__chip-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.exam-picker__chip-toolbar .exam-picker__label {
  margin: 0;
}

.exam-picker__chip-count {
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--text-muted);
}

.exam-picker__chip-count--active {
  color: var(--primary-700, #1d4ed8);
}

.exam-picker__chip-hint {
  margin: -0.35rem 0 0;
  font-size: 0.75rem;
  color: var(--text-muted);
}

.exam-picker__search-wrap--static {
  position: relative;
}

.exam-picker__chip-board {
  max-height: min(28rem, 52vh);
  overflow-y: auto;
  padding: 0.1rem;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

.exam-picker__chip-group-label {
  margin: 0 0 0.3rem;
  font-size: 0.625rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-light);
}

.exam-picker__chip-stack {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(9.25rem, 1fr));
  gap: 0.35rem;
  align-items: start;
}

.exam-picker__chip-block {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  min-width: 0;
}

.exam-picker__chip-block--expanded {
  grid-column: 1 / -1;
}

.exam-picker__chip {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  width: 100%;
  max-width: 100%;
  min-height: 2rem;
  padding: 0.2rem 0.3rem 0.2rem 0.25rem;
  border: 1.5px solid var(--border);
  border-radius: 8px;
  background: #fff;
  color: var(--text);
  font-family: inherit;
  font-size: 0.75rem;
  font-weight: 600;
  text-align: left;
  transition: background 0.12s, border-color 0.12s, color 0.12s, box-shadow 0.12s;
}

.exam-picker__chip:hover {
  border-color: var(--primary-300);
  background: var(--primary-50);
}

.exam-picker__chip--selected,
.exam-picker__chip--selected:hover {
  border-color: var(--brand-red, #c62828);
  background: var(--brand-red-50, #fdecea);
  color: var(--brand-red-800, #8e1515);
  box-shadow: 0 0 0 1px rgba(198, 40, 40, 0.18);
}

.exam-picker__chip--partial:not(.exam-picker__chip--selected),
.exam-picker__chip--partial:not(.exam-picker__chip--selected):hover {
  border-color: var(--brand-red, #c62828);
  background: var(--brand-red-50, #fdecea);
  color: var(--brand-red-800, #8e1515);
}

.exam-picker__chip--expanded:not(.exam-picker__chip--selected):not(.exam-picker__chip--partial) {
  border-color: var(--primary-400);
  box-shadow: 0 0 0 2px var(--focus-ring-sm);
}

.exam-picker__chip--selected.exam-picker__chip--expanded,
.exam-picker__chip--partial.exam-picker__chip--expanded {
  box-shadow: 0 0 0 1px rgba(198, 40, 40, 0.22), 0 0 0 3px rgba(198, 40, 40, 0.1);
}

.exam-picker__chip-check {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.1rem;
  height: 1.1rem;
  padding: 0;
  border-radius: 999px;
  border: 1.5px solid var(--border);
  background: #fff;
  flex-shrink: 0;
  color: #fff;
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s;
}

.exam-picker__chip-check:hover {
  border-color: var(--brand-red, #c62828);
}

.exam-picker__chip-check--on {
  border-color: var(--brand-red, #c62828);
  background: var(--brand-red, #c62828);
}

.exam-picker__chip-check--partial {
  border-color: var(--brand-red, #c62828);
  background: #fff;
}

.exam-picker__chip-dash {
  display: block;
  width: 0.45rem;
  height: 2px;
  border-radius: 1px;
  background: var(--brand-red, #c62828);
}

.exam-picker__chip-main {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  flex: 1;
  min-width: 0;
  min-height: 1.6rem;
  padding: 0.15rem 0.25rem 0.15rem 0.1rem;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  border-radius: 6px;
}

.exam-picker__chip-main:hover {
  background: rgba(15, 23, 42, 0.04);
}

.exam-picker__chip--selected .exam-picker__chip-main:hover,
.exam-picker__chip--partial .exam-picker__chip-main:hover {
  background: rgba(198, 40, 40, 0.08);
}

.exam-picker__chip-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.2;
}

.exam-picker__chip-count-badge {
  flex-shrink: 0;
  min-width: 1.1rem;
  height: 1.1rem;
  padding: 0 0.28rem;
  border-radius: 999px;
  background: var(--primary-600);
  color: #fff;
  font-size: 0.625rem;
  font-weight: 800;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.exam-picker__chip--partial .exam-picker__chip-count-badge,
.exam-picker__chip--selected .exam-picker__chip-count-badge {
  background: var(--brand-red, #c62828);
}

.exam-picker__chip-chevron {
  flex-shrink: 0;
  color: var(--text-light);
  transition: transform 0.15s;
}

.exam-picker__chip-chevron--open {
  transform: rotate(90deg);
  color: var(--primary-600);
}

.exam-picker__chip--selected .exam-picker__chip-chevron,
.exam-picker__chip--partial .exam-picker__chip-chevron {
  color: var(--brand-red, #c62828);
}

.exam-picker__forms {
  margin-inline-start: 0;
  padding: 0.65rem 0.75rem;
  border: 1px solid var(--primary-100);
  border-radius: 10px;
  background: linear-gradient(180deg, #f8fbff, #fff);
}

.exam-picker__forms-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.4rem;
  margin-bottom: 0.55rem;
}

.exam-picker__forms-title {
  font-size: 0.6875rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}

.exam-picker__forms-actions {
  display: flex;
  gap: 0.65rem;
}

.exam-picker__forms-link {
  border: 0;
  background: transparent;
  padding: 0;
  font-family: inherit;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--primary-700);
  cursor: pointer;
}

.exam-picker__forms-link:hover {
  text-decoration: underline;
}

.exam-picker__forms-groups {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  max-height: min(18rem, 40vh);
  overflow-y: auto;
}

.exam-picker__forms-group {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.exam-picker__forms-section {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.2rem 0.3rem;
  font-size: 0.6875rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--primary-700, #1d4ed8);
  cursor: pointer;
  user-select: none;
}

.exam-picker__forms-section input {
  width: 0.9rem;
  height: 0.9rem;
  accent-color: var(--brand-red, #c62828);
  cursor: pointer;
}

.exam-picker__forms-preview {
  list-style: none;
  margin: 0;
  padding: 0 0 0 1.3rem;
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
}

.exam-picker__forms-preview li {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-muted);
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0.15rem 0.4rem;
  line-height: 1.3;
}

.exam-picker__forms-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(10.5rem, 1fr));
  gap: 0.3rem 0.45rem;
}

.exam-picker__form-row {
  display: flex;
  align-items: flex-start;
  gap: 0.45rem;
  min-height: 2.25rem;
  padding: 0.4rem 0.45rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--text);
  cursor: pointer;
}

.exam-picker__form-row--blocked {
  opacity: 0.65;
  cursor: not-allowed;
  background: #f8fafc;
}

.exam-picker__form-row--blocked:hover {
  background: #f8fafc;
  border-color: var(--border);
}

.exam-picker__field-notice {
  margin: 0.35rem 0 0.55rem;
  padding: 0.5rem 0.65rem;
  border: 1px solid #fcd34d;
  border-radius: 8px;
  background: #fffbeb;
  color: #92400e;
  font-size: 0.8125rem;
  line-height: 1.35;
}

.exam-picker__form-row:hover {
  background: rgba(27, 79, 156, 0.06);
  border-color: var(--primary-200);
}

.exam-picker__form-row input {
  margin-top: 0.15rem;
  flex-shrink: 0;
  accent-color: var(--primary-600);
}

.exam-picker__form-row span {
  min-width: 0;
  overflow-wrap: anywhere;
  line-height: 1.3;
}

@media (max-width: 520px) {
  .exam-picker__chip-stack {
    grid-template-columns: repeat(auto-fill, minmax(8rem, 1fr));
  }

  .exam-picker__forms-list {
    grid-template-columns: 1fr;
  }
}
</style>
