import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import './style.css'
import './assets/datatable-theme.css'
import './assets/app-modal.css'

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')
