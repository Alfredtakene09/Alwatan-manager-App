import { onMounted, onUnmounted, ref, toValue, type MaybeRefOrGetter } from 'vue'

export type SilentRefreshRunOptions = {
  /** true = pas de spinner / overlay (défaut pour le polling) */
  silent?: boolean
}

export type SilentRefreshOptions = {
  /** Intervalle de polling (ms). Défaut 30 s. */
  intervalMs?: number
  /** Si false, le tick est ignoré (modal ouvert, brouillon sale…). */
  enabled?: MaybeRefOrGetter<boolean>
  /** Pause quand l’onglet est en arrière-plan. Défaut true. */
  pauseWhenHidden?: boolean
  /** Relancer au focus de la fenêtre. Défaut true. */
  refreshOnFocus?: boolean
  /** Premier chargement au mount (silent: false). Défaut true. */
  immediate?: boolean
}

/**
 * Actualise périodiquement les listes sans faire « bouger » la page :
 * pas d’overlay loading sur les polls, pause hors onglet, ignore si désactivé.
 */
export function useSilentRefresh(
  fetcher: (opts: { silent: boolean }) => void | Promise<void>,
  options: SilentRefreshOptions = {},
) {
  const {
    intervalMs = 30_000,
    enabled = true,
    pauseWhenHidden = true,
    refreshOnFocus = true,
    immediate = true,
  } = options

  const refreshing = ref(false)
  let timer: ReturnType<typeof setInterval> | undefined
  let generation = 0
  let inFlight = false

  function canRun() {
    if (!toValue(enabled)) return false
    if (pauseWhenHidden && typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      return false
    }
    return true
  }

  async function run(opts: SilentRefreshRunOptions = {}) {
    const silent = opts.silent ?? true
    if (silent && !canRun()) return
    if (inFlight) return

    const gen = ++generation
    inFlight = true
    if (silent) refreshing.value = true

    try {
      await fetcher({ silent })
    } finally {
      if (gen === generation) {
        inFlight = false
        refreshing.value = false
      }
    }
  }

  function onVisibilityOrFocus() {
    if (!canRun()) return
    void run({ silent: true })
  }

  function onVisibilityChange() {
    if (document.visibilityState === 'visible') onVisibilityOrFocus()
  }

  onMounted(() => {
    if (immediate) void run({ silent: false })

    timer = setInterval(() => {
      void run({ silent: true })
    }, intervalMs)

    if (pauseWhenHidden) {
      document.addEventListener('visibilitychange', onVisibilityChange)
    }
    if (refreshOnFocus) {
      window.addEventListener('focus', onVisibilityOrFocus)
    }
  })

  onUnmounted(() => {
    if (timer) clearInterval(timer)
    timer = undefined
    generation += 1
    inFlight = false
    refreshing.value = false
    document.removeEventListener('visibilitychange', onVisibilityChange)
    window.removeEventListener('focus', onVisibilityOrFocus)
  })

  return {
    refreshing,
    /** Manuel : overlay loading sauf si `silent: true`. */
    refresh: (opts?: SilentRefreshRunOptions) => run({ silent: opts?.silent ?? false }),
  }
}
