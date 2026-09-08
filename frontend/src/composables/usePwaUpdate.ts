import { onMounted, onUnmounted, ref } from 'vue'
import { registerSW } from 'virtual:pwa-register'

const BUILD_KEY = 'alwatan-app-build-id'
const needRefresh = ref(false)
let updateServiceWorker: ((reloadPage?: boolean) => Promise<void>) | null = null
let started = false
let applying = false

/** Vite dev (5173) : pas de bundle `assets/index-*.js` — évite la boucle de rechargement. */
function isDevFrontend() {
  return import.meta.env.DEV
}

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

/** Bundle réellement chargé dans cette page (pas le localStorage). */
function loadedBundleId(): string | null {
  if (typeof document === 'undefined') return null
  const scripts = Array.from(document.querySelectorAll('script[src]'))
  for (const el of scripts) {
    const src = el.getAttribute('src') ?? ''
    const match = src.match(/assets\/index-[^"'/?#]+\.js/)
    if (match) return match[0]
  }
  return null
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

async function unregisterAllWorkers() {
  if (!('serviceWorker' in navigator)) return
  try {
    const regs = await navigator.serviceWorker.getRegistrations()
    await Promise.all(regs.map((reg) => reg.unregister()))
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
  window.location.replace(url.toString())
}

async function applyUpdateInternal(knownBuildId?: string | null) {
  if (applying) return
  applying = true

  const buildId = knownBuildId ?? (await fetchServerBuildId())

  try {
    if (updateServiceWorker) {
      await Promise.race([
        updateServiceWorker(true),
        new Promise((resolve) => setTimeout(resolve, 1200)),
      ])
    }
  } catch {
    /* continue vers hard reload */
  }

  await requestServiceWorkerUpdate()
  await unregisterAllWorkers()
  await clearAppCaches()
  try {
    localStorage.removeItem(BUILD_KEY)
  } catch {
    /* ignore */
  }
  hardReload(buildId)
}

async function checkServerBuild() {
  if (isDevFrontend()) return

  const buildId = await fetchServerBuildId()
  if (!buildId || buildId === 'dev' || buildId === 'unknown') return

  const loaded = loadedBundleId()
  const loadedMatchesServer = Boolean(loaded && buildId.includes(loaded))

  if (loadedMatchesServer) {
    try {
      localStorage.setItem(BUILD_KEY, buildId)
    } catch {
      /* ignore */
    }
    needRefresh.value = false
    return
  }

  let stored: string | null = null
  try {
    stored = localStorage.getItem(BUILD_KEY)
  } catch {
    /* ignore */
  }

  if (stored === buildId && loadedMatchesServer) return

  needRefresh.value = true
  void requestServiceWorkerUpdate()
}

function ensureStarted() {
  if (started || typeof window === 'undefined') return
  started = true

  if (isDevFrontend()) return

  updateServiceWorker = registerSW({
    immediate: true,
    onNeedRefresh() {
      needRefresh.value = true
    },
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return
      void registration.update()
      setInterval(() => {
        void registration.update()
      }, 30_000)
    },
  })

  void checkServerBuild()
  setInterval(() => {
    void checkServerBuild()
  }, 30_000)

  window.addEventListener('focus', () => {
    void checkServerBuild()
    void requestServiceWorkerUpdate()
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void checkServerBuild()
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
