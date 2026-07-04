import api from '@/api/client'
import { LAB_EXAM_CATALOG } from './lab'
import { RADIO_EXAM_CATALOG } from './radio'
import { ECHO_EXAM_CATALOG } from './echo'
import { ODONTO_EXAM_CATALOG } from './odonto'
import type { CatalogExam, ExamKindSlug, GroupedExamCatalog } from './types'

const FALLBACK_CATALOG: GroupedExamCatalog = {
  examen: LAB_EXAM_CATALOG,
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
    },
  ],
}

let catalogCache: GroupedExamCatalog | null = null
let priceCache = new Map<string, number>()
let loadPromise: Promise<GroupedExamCatalog> | null = null

function mapApiItem(item: {
  id: string
  code: string
  label: string
  category: string | null
  priceFcfa: number
}): CatalogExam {
  return {
    id: item.id,
    code: item.code,
    label: item.label,
    category: item.category ?? '—',
    priceFcfa: item.priceFcfa,
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

export async function loadExamCatalog(): Promise<GroupedExamCatalog> {
  if (catalogCache) return catalogCache
  if (loadPromise) return loadPromise

  loadPromise = api
    .get<Record<ExamKindSlug, Array<{ id: string; code: string; label: string; category: string | null; priceFcfa: number }>>>(
      '/exam-catalog',
    )
    .then(({ data }) => {
      const catalog: GroupedExamCatalog = {
        examen: (data.examen ?? []).map(mapApiItem),
        radio: (data.radio ?? []).map(mapApiItem),
        echo: (data.echo ?? []).map(mapApiItem),
        odonto: (data.odonto ?? []).map(mapApiItem),
        operation: (data.operation ?? []).map(mapApiItem),
        hospitalisation: (data.hospitalisation ?? []).map(mapApiItem),
      }
      const hasData = Object.values(catalog).some((items) => items.length > 0)
      catalogCache = hasData ? catalog : { ...FALLBACK_CATALOG }
      rebuildPriceCache(catalogCache)
      return catalogCache
    })
    .catch(() => {
      catalogCache = { ...FALLBACK_CATALOG }
      rebuildPriceCache(catalogCache)
      return catalogCache
    })
    .finally(() => {
      loadPromise = null
    })

  return loadPromise
}

export function getExamCatalogSync(): GroupedExamCatalog {
  return catalogCache ?? FALLBACK_CATALOG
}

export function getCatalogForKind(kind: ExamKindSlug): CatalogExam[] {
  return getExamCatalogSync()[kind] ?? []
}

export function getExamPriceFcfa(label: string): number {
  return priceCache.get(label) ?? 3000
}

export function invalidateExamCatalogCache() {
  catalogCache = null
  priceCache = new Map()
}
