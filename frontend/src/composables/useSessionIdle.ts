import { onMounted, onUnmounted, watch, type Ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

/** Aligne sur le backend (12 h d'inactivite — survit a la veille PC). */
export const SESSION_IDLE_MS = 12 * 60 * 60 * 1000

const ACTIVITY_EVENTS: (keyof WindowEventMap)[] = [
  'pointerdown',
  'keydown',
  'scroll',
  'touchstart',
  'mousemove',
]

/**
 * Deconnecte apres longue inactivite.
 * Pendant la veille (onglet hidden), le timer ne deconnecte pas :
 * au reveil on reprend la session si le serveur l'accepte encore.
 */
export function useSessionIdle(enabled: Ref<boolean> | (() => boolean)) {
  const auth = useAuthStore()
  const router = useRouter()
  let timer: ReturnType<typeof setTimeout> | undefined
  let lastMark = 0
  let wakeCheckInFlight = false

  function isEnabled() {
    return typeof enabled === 'function' ? enabled() : enabled.value
  }

  async function expireSession() {
    if (!isEnabled() || !auth.user) return
    // Ne pas deconnecter pendant que la machine / l'onglet dort
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      return
    }
    try {
      await auth.logout()
    } catch {
      auth.user = null
    }
    if (router.currentRoute.value.name !== 'login') {
      window.location.assign('/login?session=idle')
    }
  }

  function resetTimer() {
    if (!isEnabled() || !auth.user) return
    const now = Date.now()
    if (now - lastMark < 1000 && timer) return
    lastMark = now
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      void expireSession()
    }, SESSION_IDLE_MS)
  }

  async function resumeAfterWake() {
    if (!isEnabled() || !auth.user || wakeCheckInFlight) return
    wakeCheckInFlight = true
    try {
      await auth.fetchMe()
      if (!auth.user) {
        if (router.currentRoute.value.name !== 'login') {
          window.location.assign('/login?session=expired')
        }
        return
      }
      resetTimer()
    } catch {
      resetTimer()
    } finally {
      wakeCheckInFlight = false
    }
  }

  function onVisibility() {
    if (document.visibilityState === 'visible') {
      void resumeAfterWake()
    }
  }

  function onPageShow(ev: PageTransitionEvent) {
    // Reveil apres veille / restauration bfcache
    if (ev.persisted || document.visibilityState === 'visible') {
      void resumeAfterWake()
    }
  }

  function onOnline() {
    void resumeAfterWake()
  }

  function start() {
    stop()
    if (!isEnabled() || !auth.user) return
    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, resetTimer, { passive: true })
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pageshow', onPageShow)
    window.addEventListener('online', onOnline)
    resetTimer()
  }

  function stop() {
    if (timer) {
      clearTimeout(timer)
      timer = undefined
    }
    for (const event of ACTIVITY_EVENTS) {
      window.removeEventListener(event, resetTimer)
    }
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('pageshow', onPageShow)
    window.removeEventListener('online', onOnline)
  }

  onMounted(() => {
    start()
  })

  onUnmounted(() => {
    stop()
  })

  watch(
    () => auth.user?.id,
    () => {
      if (auth.user && isEnabled()) start()
      else stop()
    },
  )

  return { resetTimer, stop }
}
