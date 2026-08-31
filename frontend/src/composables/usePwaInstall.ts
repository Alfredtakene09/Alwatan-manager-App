import { computed, onMounted, onUnmounted, ref } from 'vue'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISS_KEY = 'alwatan-pwa-install-dismissed'
/** Une fois le raccourci Bureau / tablette téléchargé, ne plus proposer le bandeau. */
const SHORTCUT_DONE_KEY = 'alwatan-desktop-shortcut-done'
const LAUNCHER_REV_KEY = 'alwatan-launcher-revision'

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1' || sessionStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

function writeFlag(key: string, persistent: boolean) {
  try {
    if (persistent) localStorage.setItem(key, '1')
    else sessionStorage.setItem(key, '1')
  } catch {
    /* ignore */
  }
}

function readStoredRevision(): string | null {
  try {
    return localStorage.getItem(LAUNCHER_REV_KEY)
  } catch {
    return null
  }
}

function writeStoredRevision(revision: string) {
  try {
    localStorage.setItem(LAUNCHER_REV_KEY, revision)
  } catch {
    /* ignore */
  }
}

function isLocalhostHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}

function detectPlatform() {
  if (typeof navigator === 'undefined') {
    return { isAndroid: false, isIos: false, isMobile: false, isWindows: false }
  }
  const ua = navigator.userAgent || ''
  const isAndroid = /Android/i.test(ua)
  const isIos =
    /iPad|iPhone|iPod/i.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const isMobile =
    isAndroid ||
    isIos ||
    /Mobile|Tablet|Silk/i.test(ua) ||
    (typeof window !== 'undefined' && window.matchMedia('(max-width: 1024px) and (pointer: coarse)').matches)
  const isWindows = /Windows/i.test(ua) && !isAndroid
  return { isAndroid, isIos, isMobile, isWindows }
}

export function usePwaInstall() {
  const deferredPrompt = ref<BeforeInstallPromptEvent | null>(null)
  const dismissed = ref(readFlag(DISMISS_KEY))
  const shortcutDone = ref(readFlag(SHORTCUT_DONE_KEY))
  const isStandalone = ref(false)
  const showAndroidHelp = ref(false)
  const launcherNeedsSync = ref(false)
  const serverLauncherRevision = ref<string | null>(null)
  const platform = detectPlatform()

  const canNativeInstall = computed(() => deferredPrompt.value !== null)
  const isSecureContext = computed(() => window.isSecureContext === true)
  const isLanHttp = computed(() => {
    if (typeof window === 'undefined') return false
    return window.location.protocol === 'http:' && !isLocalhostHost(window.location.hostname)
  })
  const isAndroid = computed(() => platform.isAndroid)
  const isIos = computed(() => platform.isIos)
  const isMobile = computed(() => platform.isMobile)
  const isWindows = computed(() => platform.isWindows)

  const shouldShowBanner = computed(() => {
    if (isStandalone.value) return false
    // Actualisation réseau : prioritaire même si le bandeau a été fermé avant
    if (launcherNeedsSync.value && isWindows.value) return true
    if (dismissed.value) return false
    if (shortcutDone.value) return false
    return true
  })

  const onBeforeInstall = (event: Event) => {
    event.preventDefault()
    deferredPrompt.value = event as BeforeInstallPromptEvent
  }

  async function checkLauncherRevision() {
    if (!platform.isWindows || typeof window === 'undefined') return
    try {
      const res = await fetch(`/api/client-setup/info?_=${Date.now()}`, {
        credentials: 'omit',
        cache: 'no-store',
      })
      if (!res.ok) return
      const data = (await res.json()) as { launcherRevision?: string }
      const rev = data.launcherRevision?.trim()
      if (!rev) return
      serverLauncherRevision.value = rev
      const stored = readStoredRevision()
      if (stored !== rev) {
        launcherNeedsSync.value = true
      }
    } catch {
      /* ignore */
    }
  }

  onMounted(() => {
    isStandalone.value =
      window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: fullscreen)').matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true

    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    void checkLauncherRevision()
  })

  onUnmounted(() => {
    window.removeEventListener('beforeinstallprompt', onBeforeInstall)
  })

  function dismissBanner() {
    dismissed.value = true
    writeFlag(DISMISS_KEY, true)
    showAndroidHelp.value = false
    // Reporter l’actualisation : mémoriser la révision pour ne pas spammer,
    // mais le prochain changement serveur rappellera le bandeau.
    if (launcherNeedsSync.value && serverLauncherRevision.value) {
      writeStoredRevision(serverLauncherRevision.value)
      launcherNeedsSync.value = false
    }
  }

  function markShortcutDownloaded() {
    shortcutDone.value = true
    writeFlag(SHORTCUT_DONE_KEY, true)
    launcherNeedsSync.value = false
    if (serverLauncherRevision.value) {
      writeStoredRevision(serverLauncherRevision.value)
    }
  }

  async function promptNativeInstall(): Promise<boolean> {
    const prompt = deferredPrompt.value
    if (!prompt) return false
    await prompt.prompt()
    const { outcome } = await prompt.userChoice
    deferredPrompt.value = null
    if (outcome === 'accepted') dismissBanner()
    return outcome === 'accepted'
  }

  function downloadShortcut() {
    markShortcutDownloaded()
    window.location.assign(
      `/api/client-setup/install-desktop-shortcut.cmd?_=${Date.now()}`,
    )
  }

  /** Toujours un téléchargement neuf (pas une simple mise à jour du raccourci). */
  function syncDesktopShortcut() {
    markShortcutDownloaded()
    window.location.assign(
      `/api/client-setup/install-desktop-shortcut.cmd?_=${Date.now()}`,
    )
  }

  function downloadAndroidShortcut() {
    // Téléchargement serveur (Content-Disposition) — plus fiable qu’un blob sur Android.
    // Ne pas masquer le bandeau tant que l’utilisateur n’a pas confirmé (« Plus tard »).
    const url = `/api/client-setup/android-shortcut.html?_=${Date.now()}`
    window.location.assign(url)
  }

  function openAndroidHelp() {
    showAndroidHelp.value = true
  }

  function closeAndroidHelp() {
    showAndroidHelp.value = false
  }

  return {
    isStandalone,
    isSecureContext,
    isLanHttp,
    isAndroid,
    isIos,
    isMobile,
    isWindows,
    canNativeInstall,
    shouldShowBanner,
    showAndroidHelp,
    launcherNeedsSync,
    dismissBanner,
    promptNativeInstall,
    downloadShortcut,
    syncDesktopShortcut,
    downloadAndroidShortcut,
    openAndroidHelp,
    closeAndroidHelp,
  }
}
