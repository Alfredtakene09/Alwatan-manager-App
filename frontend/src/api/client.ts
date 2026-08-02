import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
  // Évite les clics qui restent bloqués longtemps sur un LAN lent / serveur saturé
  timeout: 25_000,
})

export default api
