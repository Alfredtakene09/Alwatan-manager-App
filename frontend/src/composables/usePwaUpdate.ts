import { onMounted, onUnmounted, ref } from 'vue'
import { registerSW } from 'virtual:pwa-register'

export function usePwaUpdate() {
  const needRefresh = ref(false)

  const updateServiceWorker = registerSW({
    immediate: true,
    onNeedRefresh() {
      needRefresh.value = true
    },
  })

  async function applyUpdate() {
    await updateServiceWorker(true)
    needRefresh.value = false
  }

  return { needRefresh, applyUpdate }
}

export function useNetworkStatus() {
  const offline = ref(typeof navigator !== 'undefined' ? !navigator.onLine : false)

  function sync() {
    offline.value = !navigator.onLine
  }

  onMounted(() => {
    sync()
    window.addEventListener('offline', sync)
    window.addEventListener('online', sync)
  })

  onUnmounted(() => {
    window.removeEventListener('offline', sync)
    window.removeEventListener('online', sync)
  })

  return { offline }
}
