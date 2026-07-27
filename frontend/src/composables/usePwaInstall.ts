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

  const isSecureContext = computed(
    () => typeof window !== 'undefined' && window.isSecureContext,
  )

  const canNativeInstall = computed(() => deferredPrompt.value !== null)

  const shouldShowBanner = computed(() => {
    if (isStandalone.value || dismissed.value) return false
    if (canNativeInstall.value) return true
    return !isSecureContext.value
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

  function downloadWindowsAppLauncher() {
    const origin = `${window.location.origin}/`
    const lines = [
      '@echo off',
      'title Alwatan Manager',
      `set "APP_URL=${origin}"`,
      'set "EDGE=%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe"',
      'if not exist "%EDGE%" set "EDGE=%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe"',
      'if not exist "%EDGE%" set "EDGE=%LocalAppData%\\Google\\Chrome\\Application\\chrome.exe"',
      'if not exist "%EDGE%" set "EDGE=%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe"',
      'if exist "%EDGE%" (',
      '  start "" "%EDGE%" --app="%APP_URL%"',
      ') else (',
      '  start "" "%APP_URL%"',
      ')',
    ]
    const blob = new Blob([lines.join('\r\n')], { type: 'application/octet-stream' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'Lancer-Alwatan-Manager.cmd'
    anchor.click()
    URL.revokeObjectURL(url)
    dismissBanner()
  }

  return {
    isStandalone,
    isSecureContext,
    canNativeInstall,
    shouldShowBanner,
    dismissBanner,
    promptNativeInstall,
    downloadWindowsAppLauncher,
  }
}
