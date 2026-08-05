import { reactive } from 'vue'
import api from '@/api/client'

/** Valeurs d’usine — fallback hors ligne / avant chargement API. */
export const DEFAULT_CLINIC = {
  nameFr: 'Clinique Alwatan pour la médecine moderne',
  nameAr: 'مستوصف الوطن الطبي',
  shortName: 'Al-Watan',
  logo: '/logo-alwatan.jpeg',
  city: 'Abéché, Tchad',
  address: 'Kamina I Avenue Maréchal IDRISS DEBY ITNO',
  fullAddress: 'Abéché, Tchad, Kamina I Avenue Maréchal IDRISS DEBY ITNO',
  phones: '+235 93 93 86 51 – 63 01 94 22',
  phoneLabel: 'Tel : +235 93 93 86 51 – 63 01 94 22',
  email: 'cabinetmedicalalwatan@gmail.com',
  nif: '',
  rc: '',
  printFooter: '',
} as const

export type ClinicInfo = {
  [K in keyof typeof DEFAULT_CLINIC]: string
}

/** État réactif partagé — impressions et UI lisent toujours les valeurs à jour. */
export const CLINIC = reactive<ClinicInfo>({ ...DEFAULT_CLINIC })

export function clinicTaxLine(info: ClinicInfo = CLINIC): string {
  const parts: string[] = []
  if (info.nif) parts.push(`NIF : ${info.nif}`)
  if (info.rc) parts.push(`RC : ${info.rc}`)
  return parts.join(' · ')
}

export function applyClinicInfo(raw: Partial<ClinicInfo> | null | undefined) {
  if (!raw || typeof raw !== 'object') return CLINIC
  const phones = String(raw.phones ?? CLINIC.phones).trim() || DEFAULT_CLINIC.phones
  const city = String(raw.city ?? CLINIC.city).trim() || DEFAULT_CLINIC.city
  const address = String(raw.address ?? CLINIC.address).trim() || DEFAULT_CLINIC.address
  const fullAddress =
    String(raw.fullAddress ?? '').trim() ||
    [city, address].filter(Boolean).join(', ') ||
    DEFAULT_CLINIC.fullAddress
  const phoneLabel =
    String(raw.phoneLabel ?? '').trim() || `Tel : ${phones}` || DEFAULT_CLINIC.phoneLabel

  Object.assign(CLINIC, {
    nameFr: String(raw.nameFr ?? CLINIC.nameFr).trim() || DEFAULT_CLINIC.nameFr,
    nameAr: String(raw.nameAr ?? CLINIC.nameAr).trim() || DEFAULT_CLINIC.nameAr,
    shortName: String(raw.shortName ?? CLINIC.shortName).trim() || DEFAULT_CLINIC.shortName,
    logo: String(raw.logo ?? CLINIC.logo).trim() || DEFAULT_CLINIC.logo,
    city,
    address,
    fullAddress,
    phones,
    phoneLabel,
    email: String(raw.email ?? CLINIC.email).trim() || DEFAULT_CLINIC.email,
    nif: String(raw.nif ?? '').trim(),
    rc: String(raw.rc ?? '').trim(),
    printFooter: String(raw.printFooter ?? '').trim(),
  })
  return CLINIC
}

let loadPromise: Promise<ClinicInfo> | null = null

export async function loadClinicInfo(options?: { force?: boolean }): Promise<ClinicInfo> {
  if (loadPromise && !options?.force) return loadPromise
  loadPromise = (async () => {
    try {
      const { data } = await api.get<Partial<ClinicInfo>>('/clinic-info')
      applyClinicInfo(data)
    } catch {
      /* garde les valeurs en cache / défaut */
    }
    return CLINIC
  })()
  try {
    return await loadPromise
  } finally {
    if (options?.force) loadPromise = null
  }
}

export async function saveClinicInfo(payload: Partial<ClinicInfo>): Promise<ClinicInfo> {
  const { data } = await api.put<Partial<ClinicInfo>>('/clinic-info', payload)
  applyClinicInfo(data)
  loadPromise = null
  return CLINIC
}

export async function uploadClinicLogo(file: File): Promise<ClinicInfo> {
  const body = new FormData()
  body.append('logo', file)
  const { data } = await api.post<Partial<ClinicInfo>>('/clinic-info/logo', body)
  applyClinicInfo(data)
  loadPromise = null
  return CLINIC
}
