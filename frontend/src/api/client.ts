import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
  // Évite les clics qui restent bloqués longtemps sur un LAN lent / serveur saturé
  timeout: 25_000,
})

function isAuthCheckRequest(url: string, method: string) {
  const m = method.toLowerCase()
  if (url.includes('/auth/login') || url.includes('/auth/me')) return true
  // Ne pas expulser silencieusement après Enregistrer : laisser l’UI afficher l’erreur.
  return m !== 'get' && m !== 'head'
}

function isIdempotent(method: string) {
  const m = method.toLowerCase()
  return m === 'get' || m === 'head' || m === 'options'
}

/** Coupure LAN courte : réessayer les lectures, sans relancer un enregistrement. */
function isTransientFailure(error: { code?: string; response?: { status?: number } }) {
  if (error?.code === 'ERR_CANCELED') return false
  const status = error?.response?.status
  if (!status) return true
  return status === 502 || status === 503 || status === 504
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error?.config as { url?: string; method?: string; __retryCount?: number } | undefined
    const method = String(config?.method ?? 'get')
    if (config && isIdempotent(method) && isTransientFailure(error)) {
      const attempt = (config.__retryCount ?? 0) + 1
      if (attempt <= 3) {
        config.__retryCount = attempt
        await wait(350 * attempt)
        return api.request(config)
      }
    }

    const status = error?.response?.status
    const url = String(error?.config?.url ?? '')
    const code = String(error?.response?.data?.code ?? '')
    // Session cookie absente / invalide après ouverture via raccourci LAN → retour login.
    if (status === 401 && !isAuthCheckRequest(url, method) && typeof window !== 'undefined') {
      const path = window.location.pathname
      if (path !== '/login' && !path.startsWith('/login')) {
        const authRaw = sessionStorage.getItem('alwatan-auth-redirect')
        if (!authRaw) {
          sessionStorage.setItem('alwatan-auth-redirect', '1')
          const reason =
            code === 'SESSION_IDLE'
              ? 'idle'
              : code === 'ACCOUNT_LOCKED'
                ? 'locked'
                : code === 'SESSION_REPLACED'
                  ? 'replaced'
                  : code === 'NO_SESSION'
                    ? null
                    : 'expired'
          window.location.assign(reason ? `/login?session=${reason}` : '/login')
        }
      }
    }
    return Promise.reject(error)
  },
)

export default api
