import { onMounted, onUnmounted, ref } from 'vue'
import { registerSW } from 'virtual:pwa-register'

const BUILD_KEY = 'alwatan-app-build-id'
const needRefresh = ref(false)
let updateServiceWorker: ((reloadPage?: boolean) => Promise<void>) | null = null
let started = false

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
    needRefresh.value = true
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
  })

  void checkServerBuild()
  setInterval(() => {
    void checkServerBuild()
  }, 60_000)

  window.addEventListener('focus', () => {
    void checkServerBuild()
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
    const buildId = await fetchServerBuildId()
    if (buildId) {
      try {
        localStorage.setItem(BUILD_KEY, buildId)
      } catch {
        /* ignore */
      }
    }

    if (updateServiceWorker) {
      try {
        await updateServiceWorker(true)
      } catch {
        window.location.reload()
      }
    } else {
      window.location.reload()
    }
    needRefresh.value = false
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
