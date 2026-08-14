import { onMounted, onUnmounted, ref } from 'vue'
import { registerSW } from 'virtual:pwa-register'

const BUILD_KEY = 'alwatan-app-build-id'
const AUTO_APPLIED_BUILD_KEY = 'alwatan-auto-applied-build-id'
const needRefresh = ref(false)
let updateServiceWorker: ((reloadPage?: boolean) => Promise<void>) | null = null
let started = false
let applying = false

async function fetchServerBuildId(): Promise<string | null> {
  try {
    const res = await fetch(`/api/app-version?_=${Date.now()}`, {
      credentials: 'omit',
      cache: 'no-store',
    })
    if (!res.ok) return null
    const data = (await res.json()) as { buildId?: string }
    return data.buildId?.trim() || null
  } catch {
    return null
  }
}

async function requestServiceWorkerUpdate() {
  if (!('serviceWorker' in navigator)) return
  try {
    const reg = await navigator.serviceWorker.getRegistration()
    if (!reg) return
    await reg.update()
    if (reg.waiting) {
      reg.waiting.postMessage({ type: 'SKIP_WAITING' })
    }
  } catch {
    /* ignore */
  }
}

async function clearAppCaches() {
  if (!('caches' in window)) return
  try {
    const keys = await caches.keys()
    await Promise.all(keys.map((key) => caches.delete(key)))
  } catch {
    /* ignore */
  }
}

function hardReload(buildId?: string | null) {
  const url = new URL(window.location.href)
  url.searchParams.set('v', buildId || String(Date.now()))
  // replace évite de garder l’ancienne entrée d’historique / bfcache
  window.location.replace(url.toString())
}

function hasAlreadyAutoApplied(buildId: string) {
  try {
    return sessionStorage.getItem(AUTO_APPLIED_BUILD_KEY) === buildId
  } catch {
    return false
  }
}

function markAutoApplied(buildId: string) {
  try {
    sessionStorage.setItem(AUTO_APPLIED_BUILD_KEY, buildId)
  } catch {
    /* ignore */
  }
}

async function autoApplyUpdate(buildId: string) {
  if (applying || hasAlreadyAutoApplied(buildId)) return
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
  if (typeof navigator !== 'undefined' && !navigator.onLine) return

  markAutoApplied(buildId)
  // Laisser un court délai pour éviter une coupure en pleine saisie
  setTimeout(() => {
    void applyUpdateInternal(buildId)
  }, 3500)
}

async function applyUpdateInternal(knownBuildId?: string | null) {
  if (applying) return
  applying = true

  const buildId = knownBuildId ?? (await fetchServerBuildId())
  if (buildId) {
    try {
      localStorage.setItem(BUILD_KEY, buildId)
    } catch {
      /* ignore */
    }
  }

  try {
    if (updateServiceWorker) {
      await Promise.race([
        updateServiceWorker(true),
        new Promise((resolve) => setTimeout(resolve, 1500)),
      ])
    }
  } catch {
    /* continue vers hard reload */
  }

  await requestServiceWorkerUpdate()
  await clearAppCaches()
  hardReload(buildId)
}

async function checkServerBuild() {
  const buildId = await fetchServerBuildId()
  if (!buildId) return

  let stored: string | null = null
  try {
    stored = localStorage.getItem(BUILD_KEY)
  } catch {
    /* ignore */
  }

  if (!stored) {
    try {
      localStorage.setItem(BUILD_KEY, buildId)
    } catch {
      /* ignore */
    }
    return
  }

  if (stored !== buildId) {
    // Afficher la bannière + tentative d'application auto contrôlée (anti-boucle).
    needRefresh.value = true
    void requestServiceWorkerUpdate()
    void autoApplyUpdate(buildId)
  }
}

function ensureStarted() {
  if (started || typeof window === 'undefined') return
  started = true

  updateServiceWorker = registerSW({
    immediate: true,
    onNeedRefresh() {
      needRefresh.value = true
    },
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return
      setInterval(() => {
        void registration.update()
      }, 60_000)
    },
  })

  void checkServerBuild()
  setInterval(() => {
    void checkServerBuild()
  }, 60_000)

  window.addEventListener('focus', () => {
    void checkServerBuild()
    void requestServiceWorkerUpdate()
  })
}

export function usePwaUpdate() {
  onMounted(() => {
    ensureStarted()
  })

  onUnmounted(() => {
    // Ne pas arrêter le singleton : la bannière reste globale dans App.vue
  })

  async function applyUpdate() {
    await applyUpdateInternal()
  }

  // Démarrer même si le composant monté en retard
  ensureStarted()

  return { needRefresh, applyUpdate }
}

export function useNetworkStatus() {
  const offline = ref(typeof navigator !== 'undefined' ? !navigator.onLine : false)

  function sync() {
    offline.value = !navigator.onLine
  }

  onMounted(() => {
    sync()
    window.addEventListener('offline', sync)
    window.addEventListener('online', sync)
  })

  onUnmounted(() => {
    window.removeEventListener('offline', sync)
    window.removeEventListener('online', sync)
  })

  return { offline }
}
