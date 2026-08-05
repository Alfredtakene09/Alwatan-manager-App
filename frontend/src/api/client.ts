import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
  // Évite les clics qui restent bloqués longtemps sur un LAN lent / serveur saturé
  timeout: 25_000,
})

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status
    const url = String(error?.config?.url ?? '')
    const isAuthEndpoint = url.includes('/auth/login') || url.includes('/auth/me')
    const code = String(error?.response?.data?.code ?? '')
    // Session cookie absente / invalide après ouverture via raccourci LAN → retour login.
    if (status === 401 && !isAuthEndpoint && typeof window !== 'undefined') {
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
                  : 'expired'
          window.location.assign(`/login?session=${reason}`)
        }
      }
    }
    return Promise.reject(error)
  },
)

export default api
