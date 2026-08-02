import type { Router, RouteLocationRaw } from 'vue-router'

const prefetched = new Set<string>()

/** Précharge le chunk JS d'une route (survol menu) pour accélérer le clic suivant. */
export function prefetchRoute(router: Router, to: RouteLocationRaw) {
  try {
    const resolved = router.resolve(to)
    const key = resolved.fullPath
    if (prefetched.has(key)) return
    prefetched.add(key)

    for (const record of resolved.matched) {
      const components = record.components
      if (!components) continue
      for (const comp of Object.values(components)) {
        if (typeof comp === 'function') {
          void Promise.resolve((comp as () => unknown)()).catch(() => {
            prefetched.delete(key)
          })
        }
      }
    }
  } catch {
    /* ignore */
  }
}
