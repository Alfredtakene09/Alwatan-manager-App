import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { i18n, ensureInitialLocale, preloadAllLocales } from './i18n'
import './style.css'
import './assets/simple-table.css'
import './assets/page-table-layout.css'
import './assets/app-modal.css'

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.use(i18n)

// Seule la langue enregistrée est chargée avant l’affichage ; les autres suivent en tâche de fond.
void ensureInitialLocale().then(() => {
  app.mount('#app')
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void })
    .requestIdleCallback
  const later = () => preloadAllLocales()
  if (idle) idle(later, { timeout: 5_000 })
  else setTimeout(later, 3_000)
})
