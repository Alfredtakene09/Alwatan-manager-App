import { computed, onMounted, onUnmounted, ref } from 'vue'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISS_KEY = 'alwatan-pwa-install-dismissed'
/** Une fois le raccourci Bureau téléchargé, ne plus proposer le bandeau. */
const SHORTCUT_DONE_KEY = 'alwatan-desktop-shortcut-done'

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

function isLocalhostHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}

export function usePwaInstall() {
  const deferredPrompt = ref<BeforeInstallPromptEvent | null>(null)
  const dismissed = ref(readFlag(DISMISS_KEY))
  const shortcutDone = ref(readFlag(SHORTCUT_DONE_KEY))
  const isStandalone = ref(false)

  const canNativeInstall = computed(() => deferredPrompt.value !== null)
  const isSecureContext = computed(() => window.isSecureContext === true)
  const isLanHttp = computed(() => {
    if (typeof window === 'undefined') return false
    return window.location.protocol === 'http:' && !isLocalhostHost(window.location.hostname)
  })

  const shouldShowBanner = computed(() => {
    if (isStandalone.value || dismissed.value || shortcutDone.value) return false
    // Première visite (IP) : proposer le raccourci ; disparaît après téléchargement / « Plus tard ».
    return true
  })

  const onBeforeInstall = (event: Event) => {
    event.preventDefault()
    deferredPrompt.value = event as BeforeInstallPromptEvent
  }

  onMounted(() => {
    isStandalone.value =
      window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: fullscreen)').matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true

    window.addEventListener('beforeinstallprompt', onBeforeInstall)
  })

  onUnmounted(() => {
    window.removeEventListener('beforeinstallprompt', onBeforeInstall)
  })

  function dismissBanner() {
    dismissed.value = true
    writeFlag(DISMISS_KEY, true)
  }

  function markShortcutDownloaded() {
    shortcutDone.value = true
    writeFlag(SHORTCUT_DONE_KEY, true)
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
    window.location.assign('/api/client-setup/install-desktop-shortcut.cmd')
  }

  return {
    isStandalone,
    isSecureContext,
    isLanHttp,
    canNativeInstall,
    shouldShowBanner,
    dismissBanner,
    promptNativeInstall,
    downloadShortcut,
  }
}
