import { watch } from 'vue'
import { useRouter } from 'vue-router'
import api from '@/api/client'
import { showAppModal, useAppModal } from '@/composables/useAppModal'
import { useSilentRefresh } from '@/composables/useSilentRefresh'
import { translateTemplate } from '@/lib/dashboard-i18n'
import { fullName } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth'

export const MEDECIN_PENDING_QUEUE_EVENT = 'alwatan-medecin-pending-queue'

type PendingVisit = {
  id: string
  patient: {
    firstName: string
    lastName: string
    code: string
  }
}

type AlertPatient = {
  id: string
  name: string
  code: string
}

function waitUntilAppModalIdle(): Promise<void> {
  const { state } = useAppModal()
  if (!state.open) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = window.setInterval(() => {
      if (!state.open) {
        window.clearInterval(timer)
        resolve()
      }
    }, 250)
  })
}

function toAlertPatient(visit: PendingVisit): AlertPatient {
  return {
    id: visit.id,
    name: fullName(visit.patient.firstName, visit.patient.lastName),
    code: visit.patient.code,
  }
}

/**
 * Surveille la file du médecin et affiche une modal quand un patient
 * est enregistré (ou transféré) pour son compte. Le texte suit la langue
 * choisie dans l’application (localStorage alwatan-locale).
 */
export function useDoctorNewPatientAlert() {
  const auth = useAuthStore()
  const router = useRouter()
  const knownIds = new Set<string>()
  const queued: AlertPatient[] = []
  let initialized = false
  let alerting = false

  function reset() {
    knownIds.clear()
    queued.length = 0
    initialized = false
    alerting = false
  }

  function isDoctorSession() {
    return auth.user?.role === 'MEDECIN'
  }

  async function showNewPatientModal(patients: AlertPatient[]) {
    if (!patients.length) return

    const goToQueue = () => {
      if (router.currentRoute.value.name !== 'consultation') {
        void router.push({ name: 'consultation' })
      }
    }

    if (patients.length === 1) {
      const [patient] = patients
      await showAppModal({
        type: 'INFO',
        title: 'Nouveau patient en attente',
        message: translateTemplate(
          '{name} ({code}) a été enregistré à la réception et attend votre consultation.',
          { name: patient.name, code: patient.code },
        ),
        confirmLabel: 'Voir la file',
        showCancel: false,
        onConfirm: goToQueue,
      })
      return
    }

    const intro = translateTemplate(
      '{count} nouveaux patients ont été enregistrés pour votre consultation :',
      { count: patients.length },
    )
    const lines = patients.map((patient) => `• ${patient.name} (${patient.code})`)
    await showAppModal({
      type: 'INFO',
      title: 'Nouveaux patients en attente',
      message: [intro, ...lines].join('\n'),
      confirmLabel: 'Voir la file',
      showCancel: false,
      onConfirm: goToQueue,
    })
  }

  async function drainQueue() {
    if (alerting) return
    alerting = true
    try {
      while (queued.length) {
        const batch = queued.splice(0)
        await waitUntilAppModalIdle()
        await showNewPatientModal(batch)
      }
    } finally {
      alerting = false
      if (queued.length) void drainQueue()
    }
  }

  function enqueueAlert(patients: AlertPatient[]) {
    for (const patient of patients) {
      if (!queued.some((item) => item.id === patient.id)) queued.push(patient)
    }
    void drainQueue()
  }

  async function poll() {
    if (!isDoctorSession()) return
    try {
      const { data } = await api.get<PendingVisit[]>('/visits', { params: { queue: 'pending' } })
      const visits = Array.isArray(data) ? data : []

      window.dispatchEvent(
        new CustomEvent(MEDECIN_PENDING_QUEUE_EVENT, { detail: { visits } }),
      )

      if (!initialized) {
        for (const visit of visits) knownIds.add(visit.id)
        initialized = true
        return
      }

      const newcomers = visits.filter((visit) => !knownIds.has(visit.id)).map(toAlertPatient)
      const currentIds = new Set(visits.map((visit) => visit.id))
      for (const visit of visits) knownIds.add(visit.id)
      for (const id of [...knownIds]) {
        if (!currentIds.has(id)) knownIds.delete(id)
      }

      if (newcomers.length) enqueueAlert(newcomers)
    } catch {
      // File indisponible : on réessaiera au prochain intervalle.
    }
  }

  useSilentRefresh(() => poll(), {
    intervalMs: 8_000,
    enabled: () => isDoctorSession(),
    immediate: false,
  })

  watch(
    () => auth.user?.id,
    () => {
      reset()
      if (isDoctorSession()) void poll()
    },
    { immediate: true },
  )
}
