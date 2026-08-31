import { defineStore } from 'pinia'
import api from '@/api/client'
import {
  countLabPrescribedExams,
  formatLabPrescribedExamsPreview,
  parsePrescribedExamsByKind,
} from '@/lib/lab-notes'
import { summarizePrescribedExamFieldNames } from '@/lib/lab-prescribed-panels'
import { fullName } from '@/lib/roles'

export type LabAlertItem = {
  visitId: string
  patientCode: string
  patientName: string
  examCount: number
  exams: string[]
  labSentToLabAt: string | null
  recent: boolean
}

export type LabAlertsPayload = {
  waitingExamCount: number
  recentExamCount: number
  waitingVisitCount: number
  items: LabAlertItem[]
}

type QueueVisitLike = {
  id: string
  patient: { code: string; firstName: string; lastName: string }
  consultation?: {
    clinicalNotes?: string | null
    labSentToLabAt?: string | Date | null
  } | null
}

const REFRESH_EVENT = 'lab-alerts-refresh'
const RECENT_MS = 24 * 60 * 60 * 1000

function buildItemsFromVisits(visits: QueueVisitLike[]): {
  waitingExamCount: number
  recentExamCount: number
  waitingVisitCount: number
  items: LabAlertItem[]
} {
  const recentCutoff = Date.now() - RECENT_MS
  let waitingExamCount = 0
  let recentExamCount = 0
  const items: LabAlertItem[] = []

  for (const visit of visits) {
    const notes = visit.consultation?.clinicalNotes
    const examCount = countLabPrescribedExams(notes)
    waitingExamCount += examCount
    const sentRaw = visit.consultation?.labSentToLabAt ?? null
    const sentAt = sentRaw ? new Date(sentRaw) : null
    const recent = Boolean(sentAt && !Number.isNaN(sentAt.getTime()) && sentAt.getTime() >= recentCutoff)
    if (recent) recentExamCount += examCount
    const exams = summarizePrescribedExamFieldNames(parsePrescribedExamsByKind(notes).examen)
      .split(', ')
      .filter(Boolean)
    items.push({
      visitId: visit.id,
      patientCode: visit.patient.code,
      patientName: fullName(visit.patient.firstName, visit.patient.lastName),
      examCount,
      exams: exams.slice(0, 6),
      labSentToLabAt: sentAt && !Number.isNaN(sentAt.getTime()) ? sentAt.toISOString() : null,
      recent,
    })
  }

  return {
    waitingExamCount,
    recentExamCount,
    waitingVisitCount: items.length,
    items,
  }
}

export const useLabAlertsStore = defineStore('lab-alerts', {
  state: () => ({
    waitingExamCount: 0,
    recentExamCount: 0,
    waitingVisitCount: 0,
    items: [] as LabAlertItem[],
    loaded: false,
    loading: false,
    pendingRefresh: false,
  }),
  getters: {
    badgeCount(state): number {
      return state.waitingExamCount
    },
  },
  actions: {
    applyPayload(payload: LabAlertsPayload) {
      this.waitingExamCount = Number(payload.waitingExamCount) || 0
      this.recentExamCount = Number(payload.recentExamCount) || 0
      this.waitingVisitCount = Number(payload.waitingVisitCount) || 0
      this.items = Array.isArray(payload.items) ? payload.items : []
      this.loaded = true
    },

    /** Même source que la carte « Examens » de la file d’attente. */
    syncFromQueueVisits(visits: QueueVisitLike[]) {
      this.applyPayload(buildItemsFromVisits(Array.isArray(visits) ? visits : []))
    },

    async fetchAlerts(force = false) {
      if (this.loading) {
        if (force) this.pendingRefresh = true
        return
      }
      if (this.loaded && !force) return
      this.loading = true
      try {
        const { data } = await api.get<LabAlertsPayload>('/laboratoire/alerts')
        this.applyPayload(data)
      } catch {
        // Ne pas écraser un compteur déjà synchronisé depuis la file locale.
        if (!this.loaded) {
          this.waitingExamCount = 0
          this.recentExamCount = 0
          this.waitingVisitCount = 0
          this.items = []
          this.loaded = true
        }
      } finally {
        this.loading = false
        if (this.pendingRefresh) {
          this.pendingRefresh = false
          void this.fetchAlerts(true)
        }
      }
    },

    async refresh() {
      await this.fetchAlerts(true)
    },

    reset() {
      this.waitingExamCount = 0
      this.recentExamCount = 0
      this.waitingVisitCount = 0
      this.items = []
      this.loaded = false
      this.loading = false
      this.pendingRefresh = false
    },
  },
})

export function emitLabAlertsRefresh() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(REFRESH_EVENT))
}

export function labAlertsRefreshEventName() {
  return REFRESH_EVENT
}

// Réexport utile pour debug / autres écrans
export { formatLabPrescribedExamsPreview }
