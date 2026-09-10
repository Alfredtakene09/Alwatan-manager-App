import api from '@/api/client'
import {
  ROUTINE_BILLING_GROUPS,
  billingGroupAliasTitles,
  collectSectionsForBillingGroup,
  resolveBillingGroupPriceFcfa,
} from '@/lib/lab-routine-billing-groups'
import { RADIO_EXAM_CATALOG } from './radio'
import { ECHO_EXAM_CATALOG } from './echo'
import { ODONTO_EXAM_CATALOG } from './odonto'
import type { CatalogExam, ExamKindSlug, GroupedExamCatalog } from './types'



const FALLBACK_CATALOG: GroupedExamCatalog = {

  specialty: [],

  examen: [],

  radio: RADIO_EXAM_CATALOG,

  echo: ECHO_EXAM_CATALOG,

  odonto: ODONTO_EXAM_CATALOG,

  operation: [],

  hospitalisation: [

    {

      id: 'hospitalisation-orientation',

      code: 'HOSP',

      label: 'Hospitalisation',

      category: 'Orientation — salle à la réception',

      priceFcfa: 25_000,

      clinicServiceName: 'Hospitalisation',

    },

  ],

}



type CatalogCacheKey = string



type CatalogApiResponse = Record<
  ExamKindSlug,
  Array<{
    id: string
    code: string
    label: string
    category: string | null
    priceFcfa: number
    clinicServiceId?: string | null
    clinicServiceName?: string | null
    labPanelId?: string | null
    labPanelSlug?: string | null
    anesthesiologistPercent?: number
    anesthesiologistId?: string | null
    anesthesiologistName?: string | null
    hasAssistant?: boolean
  }>
> & {
  specialtyServiceName?: string | null
  specialtyServices?: Array<{
    id: string
    name: string
    hasExams?: boolean
    hasOperations?: boolean
  }>
}

type LabPanelApiRow = {
  id: string
  slug: string
  label: string
  isEntry: boolean
  active: boolean
  sortOrder?: number
  fields?: Array<{
    id?: string
    key?: string
    label?: string
    section?: string | null
    priceFcfa?: number | null
  }>
  examCatalogItems?: Array<{
    id: string
    code: string
    label: string
    priceFcfa: number
    active: boolean
  }>
}

export type SpecialtyServiceInfo = {
  id: string
  name: string
  hasExams: boolean
  hasOperations: boolean
}

let catalogCache = new Map<CatalogCacheKey, GroupedExamCatalog>()
let specialtyNameCache = new Map<CatalogCacheKey, string | null>()
let specialtyServicesCache = new Map<CatalogCacheKey, SpecialtyServiceInfo[]>()
let priceCache = new Map<string, number>()
/** Clé : `panelLabel::fieldLabel` normalisée. */
let fieldPriceCache = new Map<string, number>()
let loadPromises = new Map<CatalogCacheKey, Promise<GroupedExamCatalog>>()

function normalizePriceKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
}

function fieldPriceLookupKey(panelLabel: string, fieldLabel: string) {
  return `${normalizePriceKey(panelLabel)}::${normalizePriceKey(fieldLabel)}`
}

function rememberFieldPricesFromPanels(panels: LabPanelApiRow[]) {
  fieldPriceCache = new Map()
  for (const panel of panels) {
    const panelLabels = new Set<string>([
      panel.label,
      ...(panel.examCatalogItems ?? []).map((item) => item.label),
    ])
    const sectionSums = new Map<string, number>()
    const sectionsByTitle = new Map<string, { title: string; priceFcfa?: number; fields: NonNullable<LabPanelApiRow['fields']> }>()

    for (const field of panel.fields ?? []) {
      const fieldLabel = String(field.label || '').trim()
      const price = field.priceFcfa
      const sectionTitle = String(field.section || '').trim()
      if (sectionTitle && sectionTitle.toLowerCase() !== 'formulaire principal') {
        const existing = sectionsByTitle.get(sectionTitle) ?? {
          title: sectionTitle,
          fields: [] as NonNullable<LabPanelApiRow['fields']>,
        }
        existing.fields.push(field)
        if (price != null && price > 0) {
          existing.priceFcfa = (existing.priceFcfa ?? 0) + price
        }
        sectionsByTitle.set(sectionTitle, existing)
      }
      if (!fieldLabel || price == null || price < 1) continue
      for (const panelLabel of panelLabels) {
        if (!String(panelLabel || '').trim()) continue
        fieldPriceCache.set(fieldPriceLookupKey(panelLabel, fieldLabel), price)
        if (sectionTitle && sectionTitle.toLowerCase() !== 'formulaire principal') {
          const sectionKey = fieldPriceLookupKey(panelLabel, sectionTitle)
          sectionSums.set(sectionKey, (sectionSums.get(sectionKey) ?? 0) + price)
        }
      }
    }

    for (const [sectionKey, sum] of sectionSums) {
      fieldPriceCache.set(sectionKey, sum)
    }

    // Groupes Routine : un seul tarif partagé sous tous les alias de section.
    const formSections = [...sectionsByTitle.values()].map((section) => ({
      title: section.title,
      priceFcfa: section.priceFcfa,
      fields: section.fields.map((field) => ({
        key: String(field.key || ''),
        label: String(field.label || ''),
        priceFcfa: field.priceFcfa ?? undefined,
      })),
    }))
    for (const groupDef of ROUTINE_BILLING_GROUPS) {
      const linked = collectSectionsForBillingGroup(formSections, groupDef)
      if (!linked.length) continue
      const groupPrice = resolveBillingGroupPriceFcfa(linked)
      if (groupPrice == null) continue
      const aliases = billingGroupAliasTitles(formSections, groupDef)
      for (const panelLabel of panelLabels) {
        if (!String(panelLabel || '').trim()) continue
        for (const alias of aliases) {
          fieldPriceCache.set(fieldPriceLookupKey(panelLabel, alias), groupPrice)
        }
      }
    }
  }
}



function cacheKey(doctorId?: string | null, serviceId?: string | null): CatalogCacheKey {

  if (doctorId?.trim()) return `doctor:${doctorId.trim()}`

  if (serviceId?.trim()) return `service:${serviceId.trim()}`

  return 'all'

}



function mapApiItem(item: {
  id: string
  code: string
  label: string
  category: string | null
  priceFcfa: number
  clinicServiceId?: string | null
  clinicServiceName?: string | null
  labPanelId?: string | null
  labPanelSlug?: string | null
  anesthesiologistPercent?: number
  anesthesiologistId?: string | null
  anesthesiologistName?: string | null
  hasAssistant?: boolean
  surgeonPercent?: number
}): CatalogExam {
  return {
    id: item.id,
    code: item.code,
    label: item.label,
    category: item.category ?? '—',
    priceFcfa: item.priceFcfa,
    clinicServiceId: item.clinicServiceId ?? null,
    clinicServiceName: item.clinicServiceName ?? null,
    labPanelId: item.labPanelId ?? null,
    labPanelSlug: item.labPanelSlug ?? null,
    anesthesiologistPercent: item.anesthesiologistPercent,
    anesthesiologistId: item.anesthesiologistId ?? null,
    anesthesiologistName: item.anesthesiologistName ?? null,
    hasAssistant: item.hasAssistant ?? (item.anesthesiologistPercent ?? 0) > 0,
    surgeonPercent: item.surgeonPercent,
  }
}



function rebuildPriceCache(catalog: GroupedExamCatalog) {
  priceCache = new Map()
  for (const exams of Object.values(catalog)) {
    for (const exam of exams) {
      priceCache.set(exam.label, exam.priceFcfa)
    }
  }
}

function buildSpecialtyServicesList(
  catalog: GroupedExamCatalog,
  fromApi: Array<{
    id: string
    name: string
    hasExams?: boolean
    hasOperations?: boolean
  }> | undefined,
): SpecialtyServiceInfo[] {
  const byId = new Map<string, SpecialtyServiceInfo>()

  for (const s of fromApi ?? []) {
    if (!s?.id || !s?.name) continue
    byId.set(String(s.id), {
      id: String(s.id),
      name: String(s.name),
      hasExams: Boolean(s.hasExams),
      hasOperations: Boolean(s.hasOperations),
    })
  }

  // Repli : déduire depuis examens & opérations liés (Tromatologie = ops seulement).
  for (const exam of catalog.specialty) {
    const id = exam.clinicServiceId?.trim()
    if (!id) continue
    const prev = byId.get(id)
    byId.set(id, {
      id,
      name: exam.clinicServiceName?.trim() || prev?.name || 'Spécialité',
      hasExams: true,
      hasOperations: prev?.hasOperations ?? false,
    })
  }
  for (const op of catalog.operation) {
    const id = op.clinicServiceId?.trim()
    if (!id) continue
    const prev = byId.get(id)
    byId.set(id, {
      id,
      name: op.clinicServiceName?.trim() || prev?.name || 'Opération',
      hasExams: prev?.hasExams ?? false,
      hasOperations: true,
    })
  }

  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr'))
}

/**
 * Construit la liste Labo à partir des formulaires actifs (source de vérité).
 * Remplace le seed / catalogue partiel dès qu’au moins un formulaire existe.
 */
async function buildExamenFromLabPanels(): Promise<CatalogExam[] | null> {
  try {
    const { data } = await api.get<LabPanelApiRow[]>('/lab-panels')
    const panels = Array.isArray(data) ? data : []
    rememberFieldPricesFromPanels(panels)
    const active = panels
      .filter(
        (panel) =>
          panel?.id &&
          panel.active !== false &&
          panel.isEntry !== false &&
          Array.isArray(panel.fields) &&
          panel.fields.length > 0,
      )
      .sort((a, b) => {
        const orderA = Number(a.sortOrder ?? 0)
        const orderB = Number(b.sortOrder ?? 0)
        if (orderA !== orderB) return orderA - orderB
        return String(a.label || '').localeCompare(String(b.label || ''), 'fr')
      })

    if (!active.length) return null

    return active.map((panel) => {
      const linked = panel.examCatalogItems?.[0]
      const label = (linked?.label || panel.label || '').trim()
      return {
        id: linked?.id ?? `lab-panel:${panel.id}`,
        code: linked?.code || panel.slug || panel.id,
        label,
        category: 'Laboratoire',
        priceFcfa: linked?.priceFcfa ?? 0,
        clinicServiceId: null,
        clinicServiceName: 'Laboratoire',
        labPanelId: panel.id,
        labPanelSlug: panel.slug,
      }
    })
  } catch {
    return null
  }
}

/**
 * Onglet Labo = uniquement les formulaires de saisie actifs.
 * Les examens catalogue sans formulaire ne sont pas proposés.
 */
async function mergeActiveLabPanelsIntoExamen(examen: CatalogExam[]): Promise<CatalogExam[]> {
  const fromPanels = await buildExamenFromLabPanels()
  if (fromPanels?.length) return fromPanels
  // API panels indisponible (ex. 403) : garder le catalogue déjà chargé.
  return examen
}



export type LoadExamCatalogOptions = {

  doctorId?: string | null

  serviceId?: string | null

  /** Force un rechargement même si le cache existe. */

  force?: boolean

}



export async function loadExamCatalog(

  options: LoadExamCatalogOptions = {},

): Promise<GroupedExamCatalog> {

  const key = cacheKey(options.doctorId, options.serviceId)

  if (!options.force && catalogCache.has(key)) return catalogCache.get(key)!

  // Un force ne doit pas réutiliser une requête en cours (souvent un 1er chargement tombé en fallback).
  if (options.force) {
    loadPromises.delete(key)
  } else {
    const pending = loadPromises.get(key)
    if (pending) return pending
  }



  const params: Record<string, string> = {}

  if (options.doctorId?.trim()) params.doctorId = options.doctorId.trim()

  else if (options.serviceId?.trim()) params.serviceId = options.serviceId.trim()



  const promise = (async () => {
    let catalog: GroupedExamCatalog = {
      specialty: [],
      examen: [],
      radio: [],
      echo: [],
      odonto: [],
      operation: [],
      hospitalisation: [],
    }
    let specialtyServiceName: string | null = null
    let specialtyServicesFromApi: CatalogApiResponse['specialtyServices']

    try {
      const { data } = await api.get<CatalogApiResponse>('/exam-catalog', { params })
      catalog = {
        specialty: (data.specialty ?? []).map(mapApiItem),
        examen: (data.examen ?? []).map(mapApiItem),
        radio: (data.radio ?? []).map(mapApiItem),
        echo: (data.echo ?? []).map(mapApiItem),
        odonto: (data.odonto ?? []).map(mapApiItem),
        operation: (data.operation ?? []).map(mapApiItem),
        hospitalisation: (data.hospitalisation ?? []).map(mapApiItem),
      }
      specialtyServiceName =
        typeof data.specialtyServiceName === 'string' && data.specialtyServiceName.trim()
          ? data.specialtyServiceName.trim()
          : null
      specialtyServicesFromApi = data.specialtyServices
    } catch (error) {
      console.warn('[exam-catalog] API indisponible, repli partiel + formulaires labo', error)
      // Ne pas figer le seed labo : on complète via /lab-panels juste après.
      catalog = {
        specialty: [],
        examen: [],
        radio: RADIO_EXAM_CATALOG,
        echo: ECHO_EXAM_CATALOG,
        odonto: ODONTO_EXAM_CATALOG,
        operation: [],
        hospitalisation: FALLBACK_CATALOG.hospitalisation,
      }
    }

    catalog.examen = await mergeActiveLabPanelsIntoExamen(catalog.examen)
    // Pas de repli seed : sans formulaire labo, rien n’est proposé.

    catalogCache.set(key, catalog)
    specialtyNameCache.set(key, specialtyServiceName)
    specialtyServicesCache.set(key, buildSpecialtyServicesList(catalog, specialtyServicesFromApi))
    rebuildPriceCache(catalog)
    return catalog
  })().finally(() => {
    loadPromises.delete(key)
  })



  loadPromises.set(key, promise)

  return promise

}



export function getExamCatalogSync(doctorId?: string | null, serviceId?: string | null): GroupedExamCatalog {

  return catalogCache.get(cacheKey(doctorId, serviceId)) ?? FALLBACK_CATALOG

}



export function getSpecialtyServiceName(
  doctorId?: string | null,
  serviceId?: string | null,
): string | null {
  return specialtyNameCache.get(cacheKey(doctorId, serviceId)) ?? null
}

export function getSpecialtyServices(
  doctorId?: string | null,
  serviceId?: string | null,
): SpecialtyServiceInfo[] {
  return specialtyServicesCache.get(cacheKey(doctorId, serviceId)) ?? []
}

export function getCatalogForKind(
  kind: ExamKindSlug,
  doctorId?: string | null,
  serviceId?: string | null,
  clinicServiceId?: string | null,
): CatalogExam[] {
  const items = getExamCatalogSync(doctorId, serviceId)[kind] ?? []
  const filterId = clinicServiceId?.trim()
  if (!filterId) return items
  if (kind === 'specialty' || kind === 'operation') {
    return items.filter((exam) => exam.clinicServiceId === filterId)
  }
  return items
}







import {
  countPrescribedFieldUnits,
  extractBasePanelLabel,
  extractPrescribedFieldLabels,
} from '@/lib/lab-prescribed-panels'

function resolveExamBasePrice(label: string): number {
  const direct = priceCache.get(label)
  if (direct != null) return direct
  const base = extractBasePanelLabel(label)
  if (base !== label) {
    const byBase = priceCache.get(base)
    if (byBase != null) return byBase
  }
  return 3000
}

/**
 * Prix d’une ligne prescrite :
 * - examen entier → tarif catalogue ;
 * - section nommée (« Panel (Urine General) ») → tarif de section ;
 * - champs hors section → somme des prix champs.
 */
export function getExamPriceFcfa(label: string): number {
  const trimmed = label.trim()
  if (!trimmed) return 3000

  const selectedFields = extractPrescribedFieldLabels(trimmed)
  if (!selectedFields.length) {
    return resolveExamBasePrice(trimmed) * countPrescribedFieldUnits(trimmed)
  }

  // Filet : libellé catalogue entier (ex. acronyme entre parenthèses) déjà en cache.
  const exact = priceCache.get(trimmed)
  if (exact != null) return exact

  const base = extractBasePanelLabel(trimmed)
  let sum = 0
  for (const fieldLabel of selectedFields) {
    const fieldPrice = fieldPriceCache.get(fieldPriceLookupKey(base, fieldLabel))
    // Sans tarif unitaire : non facturable en sélection partielle (pas de repli examen).
    if (fieldPrice != null && fieldPrice > 0) sum += fieldPrice
  }
  return sum
}



export function invalidateExamCatalogCache() {
  catalogCache = new Map()
  specialtyNameCache = new Map()
  specialtyServicesCache = new Map()
  priceCache = new Map()
  fieldPriceCache = new Map()
  loadPromises = new Map()
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('exam-catalog-invalidate'))
  }
}

export function examCatalogInvalidateEventName() {
  return 'exam-catalog-invalidate'
}
