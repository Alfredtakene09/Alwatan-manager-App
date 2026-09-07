/**
 * État imprimante locale (agent ESC/POS) pour bandeaux UI.
 */
import { ref, onMounted, onUnmounted } from 'vue'
import { checkPrintAgentHealth, warmPrintAgentHealth } from '@/lib/thermal-print-agent'

export type PrintHealthState = {
  checking: boolean
  ok: boolean
  printerName: string | null
  hint: string
}

const shared = ref<PrintHealthState>({
  checking: true,
  ok: false,
  printerName: null,
  hint: 'Verification imprimante…',
})

let pollTimer: ReturnType<typeof setInterval> | null = null
let subscribers = 0

async function refreshPrintHealth() {
  shared.value = { ...shared.value, checking: true }
  const res = await checkPrintAgentHealth({ force: true })
  if (res.ok) {
    shared.value = {
      checking: false,
      ok: true,
      printerName: res.printerName ?? null,
      hint: res.printerName
        ? `Impression silencieuse prete (${res.printerName})`
        : 'Impression silencieuse prete',
    }
  } else {
    shared.value = {
      checking: false,
      ok: false,
      printerName: null,
      hint:
        'Agent impression local injoignable (127.0.0.1:19100). Sur ce poste : UPDATE-ET-DEMARRER.bat, puis dans Chrome autorisez « Accès au réseau local » pour Alwatan, puis F5.',
    }
  }
}

export function usePrintHealthBanner() {
  onMounted(() => {
    subscribers += 1
    warmPrintAgentHealth()
    void refreshPrintHealth()
    if (!pollTimer) {
      pollTimer = setInterval(() => {
        void refreshPrintHealth()
      }, 30000)
    }
  })

  onUnmounted(() => {
    subscribers = Math.max(0, subscribers - 1)
    if (subscribers === 0 && pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  })

  return {
    printHealth: shared,
    refreshPrintHealth,
  }
}

export { refreshPrintHealth }
