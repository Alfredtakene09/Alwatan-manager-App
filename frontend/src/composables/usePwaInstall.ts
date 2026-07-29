import { computed, onMounted, onUnmounted, ref } from 'vue'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISS_KEY = 'alwatan-pwa-install-dismissed'

function readDismissed(): boolean {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === '1'
  } catch {
    return false
  }
}

export function usePwaInstall() {
  const deferredPrompt = ref<BeforeInstallPromptEvent | null>(null)
  const dismissed = ref(readDismissed())
  const isStandalone = ref(false)

  const canNativeInstall = computed(() => deferredPrompt.value !== null)

  const shouldShowBanner = computed(() => {
    if (isStandalone.value || dismissed.value) return false
    // Pas de bandeau « télécharger le lanceur » en HTTP LAN — seulement l’install PWA native.
    return canNativeInstall.value
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
    try {
      sessionStorage.setItem(DISMISS_KEY, '1')
    } catch {
      /* ignore */
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

  return {
    isStandalone,
    canNativeInstall,
    shouldShowBanner,
    dismissBanner,
    promptNativeInstall,
  }
}
