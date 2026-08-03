import { computed, onMounted, onUnmounted, ref } from 'vue'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISS_KEY = 'alwatan-pwa-install-dismissed'
/** Une fois le raccourci Bureau / tablette téléchargé, ne plus proposer le bandeau. */
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
    if (isStandalone.value || dismissed.value || shortcutDone.value) return false
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
    showAndroidHelp.value = false
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

  function downloadAndroidShortcut() {
    markShortcutDownloaded()
    const origin = window.location.origin.replace(/\/$/, '')
    const appUrl = `${origin}/`
    const iconUrl = `${origin}/pwa/icon-192.png`
    const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="theme-color" content="#1b4f9c" />
  <meta name="mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-title" content="Alwatan Manager" />
  <link rel="icon" href="${iconUrl}" />
  <link rel="apple-touch-icon" href="${iconUrl}" />
  <title>Alwatan Manager — Tablette</title>
  <style>
    body{margin:0;min-height:100vh;font-family:system-ui,sans-serif;background:linear-gradient(160deg,#e8f0fb,#fff 45%,#f5f7fb);color:#12233f;display:grid;place-items:center;padding:1.25rem}
    .card{width:min(440px,100%);background:#fff;border-radius:18px;box-shadow:0 12px 40px rgba(18,35,63,.12);padding:1.4rem 1.25rem 1.5rem;text-align:center}
    img{width:84px;height:84px;border-radius:18px;object-fit:cover;margin-bottom:.85rem}
    h1{margin:0 0 .35rem;font-size:1.25rem}
    p{margin:0 0 .85rem;color:#4b5563;line-height:1.45;font-size:.95rem}
    ol{text-align:start;margin:0 0 1.1rem;padding-inline-start:1.2rem;line-height:1.55}
    a.btn{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:.75rem 1.1rem;border-radius:12px;text-decoration:none;background:#1b4f9c;color:#fff;font-weight:650;width:100%}
    .hint{margin-top:.9rem;font-size:.82rem;color:#6b7280}
    .ar{direction:rtl}
  </style>
</head>
<body>
  <main class="card">
    <img src="${iconUrl}" alt="Alwatan" />
    <h1>Clinique Alwatan — Manager</h1>
    <p>Raccourci tablette. Ouvrez l’app puis ajoutez-la à l’écran d’accueil.</p>
    <ol>
      <li>Appuyez sur <strong>Ouvrir l’application</strong>.</li>
      <li>Chrome : menu <strong>⋮</strong> → <strong>Ajouter à l’écran d’accueil</strong>.</li>
      <li>Safari (iPad) : Partager → <strong>Sur l’écran d’accueil</strong>.</li>
    </ol>
    <a class="btn" href="${appUrl}">Ouvrir l’application</a>
    <p class="hint ar">افتح التطبيق ثم أضفه إلى الشاشة الرئيسية.</p>
    <p class="hint">${appUrl}</p>
  </main>
</body>
</html>`
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
    const objectUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = objectUrl
    a.download = 'Alwatan-Manager-Tablette.html'
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(objectUrl)
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
    dismissBanner,
    promptNativeInstall,
    downloadShortcut,
    downloadAndroidShortcut,
    openAndroidHelp,
    closeAndroidHelp,
  }
}
