import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  optimizeDeps: {
    include: ['@lucide/vue', 'vue', 'vue-router', 'pinia', 'axios'],
  },
  server: {
    port: 5173,
    // Écoute IPv4 sur toutes les interfaces (accès LAN clients)
    host: '0.0.0.0',
    // Autorise http://IP-LAN:5173 depuis les postes du réseau
    allowedHosts: true,
    strictPort: true,
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET ?? 'http://127.0.0.1:4000',
        changeOrigin: true,
      },
    },
  },
})
