import { defineStore } from 'pinia'
import api from '@/api/client'
import { getDefaultRoute, type SessionUser } from '@/lib/roles'

let fetchMePromise: Promise<void> | null = null

export const useAuthStore = defineStore('auth', {
  state: () => ({
    user: null as SessionUser | null,
    loading: false,
  }),
  getters: {
    isAuthenticated: (state) => !!state.user,
  },
  actions: {
    async fetchMe() {
      if (fetchMePromise) {
        await fetchMePromise
        return
      }
      fetchMePromise = (async () => {
        try {
          const { data } = await api.get<SessionUser>('/auth/me')
          this.user = data
        } catch (error: unknown) {
          const status = (error as { response?: { status?: number } })?.response?.status
          // Une coupure réseau ne ferme pas la session : le cookie est encore valable.
          if (status === 401 || status === 403) this.user = null
        } finally {
          fetchMePromise = null
        }
      })()
      await fetchMePromise
    },
    async login(username: string, password: string) {
      this.loading = true
      try {
        const { data } = await api.post('/auth/login', { username, password })
        this.user = data.user
        return getDefaultRoute(data.user.role)
      } finally {
        this.loading = false
      }
    },
    async logout() {
      await api.post('/auth/logout')
      this.user = null
    },
  },
})
