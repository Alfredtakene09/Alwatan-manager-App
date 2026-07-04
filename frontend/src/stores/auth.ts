import { defineStore } from 'pinia'
import api from '@/api/client'
import { getDefaultRoute, type SessionUser } from '@/lib/roles'

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
      try {
        const { data } = await api.get<SessionUser>('/auth/me')
        this.user = data
      } catch {
        this.user = null
      }
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
