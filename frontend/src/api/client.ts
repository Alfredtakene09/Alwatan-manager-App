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

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status
    const url = String(error?.config?.url ?? '')
    const method = String(error?.config?.method ?? 'get')
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
