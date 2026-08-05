import { onMounted, onUnmounted, watch, type Ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

/** Aligné sur le backend (30 minutes d'inactivité). */
export const SESSION_IDLE_MS = 30 * 60 * 1000

const ACTIVITY_EVENTS: (keyof WindowEventMap)[] = [
  'pointerdown',
  'keydown',
  'scroll',
  'touchstart',
  'mousemove',
]

/**
 * Déconnecte automatiquement après 30 min sans interaction sur la page.
 * Le backend impose aussi ce délai via lastActivityAt.
 */
export function useSessionIdle(enabled: Ref<boolean> | (() => boolean)) {
  const auth = useAuthStore()
  const router = useRouter()
  let timer: ReturnType<typeof setTimeout> | undefined
  let lastMark = 0

  function isEnabled() {
    return typeof enabled === 'function' ? enabled() : enabled.value
  }

  async function expireSession() {
    if (!isEnabled() || !auth.user) return
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
    // Évite de reset le timer à chaque mousemove (throttle 1s)
    if (now - lastMark < 1000 && timer) return
    lastMark = now
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      void expireSession()
    }, SESSION_IDLE_MS)
  }

  function onVisibility() {
    if (document.visibilityState === 'visible') {
      resetTimer()
    }
  }

  function start() {
    stop()
    if (!isEnabled() || !auth.user) return
    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, resetTimer, { passive: true })
    }
    document.addEventListener('visibilitychange', onVisibility)
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
