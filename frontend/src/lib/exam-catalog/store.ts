import api from '@/api/client'

import { LAB_EXAM_CATALOG } from './lab'

import { RADIO_EXAM_CATALOG } from './radio'

import { ECHO_EXAM_CATALOG } from './echo'

import { ODONTO_EXAM_CATALOG } from './odonto'

import type { CatalogExam, ExamKindSlug, GroupedExamCatalog } from './types'



const FALLBACK_CATALOG: GroupedExamCatalog = {

  specialty: [],

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

  }>

> & {

  specialtyServiceName?: string | null

}



let catalogCache = new Map<CatalogCacheKey, GroupedExamCatalog>()

let specialtyNameCache = new Map<CatalogCacheKey, string | null>()

let priceCache = new Map<string, number>()

let loadPromises = new Map<CatalogCacheKey, Promise<GroupedExamCatalog>>()



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

}): CatalogExam {

  return {

    id: item.id,

    code: item.code,

    label: item.label,

    category: item.category ?? '—',

    priceFcfa: item.priceFcfa,

    clinicServiceId: item.clinicServiceId ?? null,

    clinicServiceName: item.clinicServiceName ?? null,

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

  const pending = loadPromises.get(key)

  if (pending) return pending



  const params: Record<string, string> = {}

  if (options.doctorId?.trim()) params.doctorId = options.doctorId.trim()

  else if (options.serviceId?.trim()) params.serviceId = options.serviceId.trim()



  const promise = api

    .get<CatalogApiResponse>('/exam-catalog', { params })

    .then(({ data }) => {

      const catalog: GroupedExamCatalog = {

        specialty: (data.specialty ?? []).map(mapApiItem),

        examen: (data.examen ?? []).map(mapApiItem),

        radio: (data.radio ?? []).map(mapApiItem),

        echo: (data.echo ?? []).map(mapApiItem),

        odonto: (data.odonto ?? []).map(mapApiItem),

        operation: (data.operation ?? []).map(mapApiItem),

        hospitalisation: (data.hospitalisation ?? []).map(mapApiItem),

      }

      const hasData = Object.values(catalog).some((items) => items.length > 0)

      const resolved = hasData ? catalog : { ...FALLBACK_CATALOG }

      catalogCache.set(key, resolved)

      specialtyNameCache.set(

        key,

        typeof data.specialtyServiceName === 'string' && data.specialtyServiceName.trim()

          ? data.specialtyServiceName.trim()

          : null,

      )

      rebuildPriceCache(resolved)

      return resolved

    })

    .catch(() => {

      const fallback = { ...FALLBACK_CATALOG }

      catalogCache.set(key, fallback)

      specialtyNameCache.set(key, null)

      rebuildPriceCache(fallback)

      return fallback

    })

    .finally(() => {

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



export function getCatalogForKind(

  kind: ExamKindSlug,

  doctorId?: string | null,

  serviceId?: string | null,

): CatalogExam[] {

  return getExamCatalogSync(doctorId, serviceId)[kind] ?? []

}



export function getExamPriceFcfa(label: string): number {

  return priceCache.get(label) ?? 3000

}



export function invalidateExamCatalogCache() {

  catalogCache = new Map()

  specialtyNameCache = new Map()

  priceCache = new Map()

  loadPromises = new Map()

}


