/**
 * Client HTTP vers l'agent d'impression local (ESC/POS USB).
 * Écoute uniquement sur 127.0.0.1 — un agent par poste.
 *
 * Important : l'app est servie depuis l'IP LAN du serveur (ex. 192.168.x.x:4000).
 * Chrome/Edge traite 127.0.0.1 comme plus « privé » → headers PNA + targetAddressSpace.
 */

export const PRINT_AGENT_DEFAULT_URL = 'http://127.0.0.1:19100'

const HEALTH_CACHE_MS = 8000

type HealthCache = {
  at: number
  ok: boolean
  printerName?: string | null
}

let healthCache: HealthCache | null = null
let permissionHintShown = false

export type ThermalPrintClinic = {
  shortName?: string
  nameFr?: string
  nameAr?: string
  city?: string
  phones?: string
}

export type PharmacyThermalJob = {
  type: 'pharmacy'
  invoiceNumber?: string
  date?: string
  isExternal?: boolean
  paymentMode?: string
  coveredByName?: string | null
  items: Array<{
    name: string
    quantity: number
    unitPrice: number
    lineTotal: number
  }>
  total: number
  grossTotal?: number
  reductionFcfa?: number
  reductionLabel?: string
  notes?: string
  clinic?: ThermalPrintClinic
}

export type ConsultationThermalJob = {
  type: 'consultation'
  patientCode: string
  patientName: string
  doctorName: string
  amount: number
  reduction: number
  total: number
  invoiceNumber?: string
  date: string
  processedBy?: string
  clinic?: ThermalPrintClinic
}

export type ThermalPrintJob = PharmacyThermalJob | ConsultationThermalJob

function agentBaseUrl(): string {
  try {
    const custom = localStorage.getItem('alwatan.printAgentUrl')
    if (custom && /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/i.test(custom.trim())) {
      return custom.trim().replace(/\/$/, '')
    }
  } catch {
    /* ignore */
  }
  return PRINT_AGENT_DEFAULT_URL
}

/** Prefs poste : browser (défaut). L'agent silencieux n'est plus utilisé. */
export function getThermalPrintMode(): 'auto' | 'silent' | 'browser' {
  return 'browser'
}

/** Impression des reçus = navigateur + pilote Windows uniquement. */
export function shouldTrySilentPrint(): boolean {
  return false
}

type FetchInitLocal = RequestInit & { targetAddressSpace?: 'loopback' | 'local' | 'private' | 'public' }

async function agentFetch(path: string, init?: FetchInitLocal): Promise<Response> {
  const opts: FetchInitLocal = {
    ...init,
    // Requis Chrome/Edge récents : origine LAN → loopback
    targetAddressSpace: 'loopback',
  }
  return fetch(`${agentBaseUrl()}${path}`, opts)
}

export async function checkPrintAgentHealth(options?: {
  force?: boolean
}): Promise<{ ok: boolean; printerName?: string | null; error?: string }> {
  const now = Date.now()
  if (!options?.force && healthCache && now - healthCache.at < HEALTH_CACHE_MS) {
    return { ok: healthCache.ok, printerName: healthCache.printerName }
  }

  if (getThermalPrintMode() === 'browser') {
    healthCache = { at: now, ok: false, printerName: null }
    return { ok: false, error: 'mode=browser' }
  }

  try {
    const ctrl = new AbortController()
    const timer = window.setTimeout(() => ctrl.abort(), 2000)
    const res = await agentFetch('/health', {
      method: 'GET',
      signal: ctrl.signal,
    })
    window.clearTimeout(timer)
    if (!res.ok) {
      healthCache = { at: now, ok: false }
      return { ok: false, error: `HTTP ${res.status}` }
    }
    const data = (await res.json()) as {
      ok?: boolean
      configured?: boolean
      printerName?: string | null
    }
    const ok = Boolean(data.ok && data.configured)
    healthCache = { at: now, ok, printerName: data.printerName }
    return { ok, printerName: data.printerName }
  } catch (err) {
    healthCache = { at: now, ok: false }
    const msg = err instanceof Error ? err.message : 'agent unreachable'
    if (!permissionHintShown && /Failed to fetch|NetworkError|Load failed|blocked/i.test(msg)) {
      permissionHintShown = true
      console.warn(
        '[alwatan-print] Agent injoignable. Vérifiez : 1) agent démarré sur ce poste  2) autoriser « Accès au réseau local » pour ce site dans Chrome/Edge',
      )
    }
    return { ok: false, error: msg }
  }
}

/** Précharge le statut agent (appeler au montage des écrans caisse / réception). */
export function warmPrintAgentHealth() {
  void checkPrintAgentHealth({ force: true })
}

export async function sendThermalPrintJob(
  job: ThermalPrintJob,
): Promise<{ ok: true; printerName?: string } | { ok: false; error: string }> {
  if (!shouldTrySilentPrint()) {
    return { ok: false, error: 'mode=browser' }
  }
  try {
    const ctrl = new AbortController()
    const timer = window.setTimeout(() => ctrl.abort(), 10000)
    const res = await agentFetch('/print', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(job),
      signal: ctrl.signal,
    })
    window.clearTimeout(timer)
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean
      error?: string
      printerName?: string
    }
    if (!res.ok || !data.ok) {
      return { ok: false, error: data.error || `HTTP ${res.status}` }
    }
    healthCache = { at: Date.now(), ok: true, printerName: data.printerName }
    return { ok: true, printerName: data.printerName }
  } catch (err) {
    healthCache = { at: Date.now(), ok: false }
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Impression silencieuse impossible',
    }
  }
}
