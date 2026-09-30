<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { Bell, AlertTriangle, Clock, BedDouble, FlaskConical, Stethoscope } from '@lucide/vue'
import api from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { canAccessModule, formatFcfa, fullName } from '@/lib/roles'
import type { AdminDashboardOverview } from '@/lib/admin-dashboard'
import type { GestionnaireDashboardOverview } from '@/lib/gestionnaire-dashboard'
import {
  translateDashboardLabel,
  translateTemplate,
} from '@/lib/dashboard-i18n'
import { hospitalizationStayEnded } from '@/lib/hospitalization-admission'
import { useAppI18n } from '@/i18n/useAppI18n'
import UiFormModal from '@/components/ui/UiFormModal.vue'

const auth = useAuthStore()
const { localeCode } = useAppI18n()

const showModal = ref(false)
const overview = ref<AdminDashboardOverview | null>(null)
const gestionnaireOverview = ref<GestionnaireDashboardOverview | null>(null)
const pendingHospitalizations = ref<
  Array<{
    id: string
    visitId: string
    patientCode: string
    patientName: string
  }>
>([])
const overdueHospitalizations = ref<
  Array<{
    id: string
    visitId: string
    patientCode: string
    patientName: string
    roomName: string
  }>
>([])
const pendingExamPayments = ref<
  Array<{
    id: string
    visitId: string
    patientCode: string
    patientName: string
    examsSummary: string
    examCount: number
    amountFcfa: number
  }>
>([])
const pendingConsultationPayments = ref<
  Array<{
    id: string
    visitId: string
    patientCode: string
    patientName: string
    amountFcfa: number
  }>
>([])
let refreshTimer: ReturnType<typeof setInterval> | undefined

const ALERT_MAX_AGE_MS = 24 * 60 * 60 * 1000

/** Alerte liée à un événement daté : masquée de la cloche au-delà de 24 h. */
function isRecentAlert(at?: string | null) {
  if (!at) return true
  const time = new Date(at).getTime()
  if (Number.isNaN(time)) return true
  return Date.now() - time <= ALERT_MAX_AGE_MS
}

function hasModule(module: string) {
  return Boolean(auth.user && canAccessModule(auth.user.role, module))
}

const canSeeAlerts = computed(() => {
  if (!auth.user) return false
  return (
    hasModule('admin') ||
    hasModule('gestionnaire') ||
    hasModule('hospitalisation') ||
    hasModule('reception')
  )
})

/** Encaissement examens — réception, gestionnaire, direction, admin. */
const canSeeExamPaymentAlerts = computed(() => hasModule('comptabilite') || hasModule('reception'))
/** Factures consultation impayées — gestionnaire, direction, admin. */
const canSeeConsultationPaymentAlerts = computed(() => hasModule('comptabilite'))
const canSeePaymentAlerts = computed(
  () => canSeeExamPaymentAlerts.value || canSeeConsultationPaymentAlerts.value,
)
const examPaymentActionTo = computed(() =>
  hasModule('reception') && !hasModule('comptabilite')
    ? '/reception/en-attente-paiement'
    : '/comptabilite/en-attente-paiement',
)
const canSeeHospitalizationAlerts = computed(() => hasModule('hospitalisation'))
const canSeeGestionnaireAlerts = computed(() => hasModule('gestionnaire'))
const canSeeAdminAlerts = computed(() => hasModule('admin'))

const dashboardAlerts = computed(() => {
  void localeCode.value
  const items: Array<{
    id: string
    severity: 'danger' | 'warning' | 'info'
    title: string
    message: string
    actionLabel?: string
    actionTo?: string
    kind?: 'hospitalization' | 'hospitalization-overdue' | 'exam-payment' | 'consultation-payment' | 'default'
  }> = []

  if (canSeeExamPaymentAlerts.value) {
    for (const exam of pendingExamPayments.value) {
      items.push({
        id: `exam-pay-${exam.id}`,
        severity: 'warning',
        kind: 'exam-payment',
        title: translateDashboardLabel('Paiement examens'),
        message: exam.examsSummary
          ? `${exam.patientCode} — ${exam.patientName} · ${exam.examsSummary} · ${formatFcfa(exam.amountFcfa)}`
          : `${exam.patientCode} — ${exam.patientName} · ${formatFcfa(exam.amountFcfa)}`,
        actionLabel: translateDashboardLabel('Encaisser'),
        actionTo: examPaymentActionTo.value,
      })
    }
  }

  if (canSeeConsultationPaymentAlerts.value) {
    for (const consult of pendingConsultationPayments.value) {
      items.push({
        id: `consult-pay-${consult.id}`,
        severity: 'info',
        kind: 'consultation-payment',
        title: translateDashboardLabel('Paiement consultation'),
        message: `${consult.patientCode} — ${consult.patientName} · ${formatFcfa(consult.amountFcfa)}`,
        actionLabel: translateDashboardLabel('Encaisser'),
        actionTo: '/comptabilite/en-attente-paiement',
      })
    }
  }

  if (canSeeHospitalizationAlerts.value) {
    for (const hosp of overdueHospitalizations.value) {
      items.push({
        id: `hosp-overdue-${hosp.id}`,
        severity: 'danger',
        kind: 'hospitalization-overdue',
        title: translateDashboardLabel('Libérer la salle'),
        message: hosp.roomName
          ? `${hosp.patientCode} — ${hosp.patientName} · ${hosp.roomName}`
          : `${hosp.patientCode} — ${hosp.patientName}`,
        actionLabel: translateDashboardLabel('Libérer la salle'),
        actionTo: `/hospitalisation?tab=hospitalized&visitId=${encodeURIComponent(hosp.visitId)}`,
      })
    }
    for (const hosp of pendingHospitalizations.value) {
      items.push({
        id: `hosp-${hosp.id}`,
        severity: 'warning',
        kind: 'hospitalization',
        title: translateDashboardLabel('Nouvelle hospitalisation'),
        message: `${hosp.patientCode} — ${hosp.patientName}`,
        actionLabel: translateDashboardLabel('Admettre le patient'),
        actionTo: `/hospitalisation?tab=hospitalized&visitId=${encodeURIComponent(hosp.visitId)}`,
      })
    }
  }

  if (canSeeGestionnaireAlerts.value) {
    const unpaidPayroll =
      gestionnaireOverview.value?.alerts.unpaidPayroll ?? overview.value?.alerts.unpaidPayroll ?? 0
    if (unpaidPayroll > 0) {
      items.push({
        id: 'payroll',
        severity: 'warning',
        title: translateDashboardLabel('Paie du mois incomplète'),
        message:
          unpaidPayroll > 1
            ? translateTemplate('{n} salaires encore à valider ce mois.', { n: unpaidPayroll })
            : translateTemplate('{n} salaire encore à valider ce mois.', { n: unpaidPayroll }),
        actionLabel: translateDashboardLabel('Ouvrir la paie'),
        actionTo: '/admin/salaires',
      })
    }

    const pendingDoctorOvertime = gestionnaireOverview.value?.alerts.pendingDoctorOvertime ?? 0
    if (pendingDoctorOvertime > 0) {
      items.push({
        id: 'doctor-overtime',
        severity: 'warning',
        title: translateDashboardLabel('Heures supplémentaires à valider'),
        message:
          pendingDoctorOvertime > 1
            ? translateTemplate('{n} saisies médecins en attente de calcul.', {
                n: pendingDoctorOvertime,
              })
            : translateTemplate('{n} saisie médecin en attente de calcul.', {
                n: pendingDoctorOvertime,
              }),
        actionLabel: translateDashboardLabel('Valider les heures'),
        actionTo: '/admin/salaires?tab=heures-supp',
      })
    }

    const pendingExpenses =
      overview.value?.alerts.pendingExpenses ??
      gestionnaireOverview.value?.alerts.pendingExpenses ??
      0
    if (pendingExpenses > 0) {
      items.push({
        id: 'pending-expenses',
        severity: 'warning',
        title: translateDashboardLabel('Dépenses à valider'),
        message:
          pendingExpenses > 1
            ? translateTemplate('{n} dépenses en attente de validation.', { n: pendingExpenses })
            : translateTemplate('{n} dépense en attente de validation.', { n: pendingExpenses }),
        actionLabel: translateDashboardLabel('Voir les dépenses'),
        actionTo: '/admin/depenses',
      })
    }
  }

  if (canSeeAdminAlerts.value) {
    const lowStock = overview.value?.alerts.lowStock ?? 0
    if (lowStock > 0) {
      items.push({
        id: 'low-stock',
        severity: 'warning',
        title: translateDashboardLabel('Stock pharmacie bas'),
        message:
          lowStock > 1
            ? translateTemplate('{n} produits en stock critique.', { n: lowStock })
            : translateTemplate('{n} produit en stock critique.', { n: lowStock }),
        actionLabel: translateDashboardLabel('Voir la pharmacie'),
        actionTo: '/pharmacie/alertes',
      })
    }
  }

  return items
})

const alertsCount = computed(() => dashboardAlerts.value.length)

const alertsAriaLabel = computed(() => {
  void localeCode.value
  return translateTemplate('Alertes ({n})', { n: alertsCount.value })
})

const alertsModalSubtitle = computed(() => {
  void localeCode.value
  if (!alertsCount.value) return translateDashboardLabel('Aucune alerte')
  return alertsCount.value > 1
    ? translateTemplate('{n} alertes à traiter', { n: alertsCount.value })
    : translateTemplate('{n} alerte à traiter', { n: alertsCount.value })
})

const alertsEmptyMessage = computed(() => {
  void localeCode.value
  if (canSeeConsultationPaymentAlerts.value) {
    return translateDashboardLabel(
      'Tout est à jour — aucun paiement, clôture, dépense, paie ni hospitalisation en attente.',
    )
  }
  if (canSeeExamPaymentAlerts.value) {
    return translateDashboardLabel(
      'Tout est à jour — aucun paiement examens ni hospitalisation en attente.',
    )
  }
  if (canSeeHospitalizationAlerts.value) {
    return translateDashboardLabel(
      'Tout est à jour — aucune hospitalisation en attente ni salle à libérer.',
    )
  }
  return translateDashboardLabel(
    'Tout est à jour — aucune action urgente sur la caisse comptable, les dépenses ni la paie.',
  )
})

async function loadPaymentAlerts() {
  if (!canSeePaymentAlerts.value) {
    pendingExamPayments.value = []
    pendingConsultationPayments.value = []
    return
  }

  type PaymentAlertsResponse = {
    exams?: Array<{
      id: string
      visitId: string
      patientCode: string
      patientName: string
      examsSummary?: string
      examCount?: number
      amountFcfa: number
      updatedAt?: string
    }>
    consultations?: Array<{
      id: string
      visitId: string
      patientCode: string
      patientName: string
      amountFcfa: number
      createdAt?: string
    }>
  }

  const { data } = await api.get<PaymentAlertsResponse>('/comptabilite/payment-alerts')
  pendingExamPayments.value = (data.exams ?? []).filter((row) => isRecentAlert(row.updatedAt)).map((row) => ({
    id: row.id,
    visitId: row.visitId,
    patientCode: row.patientCode,
    patientName: row.patientName,
    examsSummary: row.examsSummary ?? '',
    examCount: row.examCount ?? 0,
    amountFcfa: row.amountFcfa,
  }))
  pendingConsultationPayments.value = (data.consultations ?? []).filter((row) =>
    isRecentAlert(row.createdAt),
  )
}

async function loadHospitalizationAlerts() {
  if (!canSeeHospitalizationAlerts.value) {
    pendingHospitalizations.value = []
    overdueHospitalizations.value = []
    return
  }

  type HospRow = {
    id: string
    status: string
    startDate?: string | null
    endDate?: string | null
    nightsCount?: number | null
    createdAt?: string
    room?: { name?: string } | null
    visit: {
      id: string
      patient: { code: string; firstName: string; lastName: string }
    }
  }

  const { data } = await api.get<{ hospitalizations?: HospRow[] }>('/hospitalisation')
  const rows = data.hospitalizations ?? []
  pendingHospitalizations.value = rows
    .filter((row) => {
      if (row.status === 'DISCHARGED' || row.status === 'CANCELLED') return false
      const admitted = row.status === 'ACTIVE' || (Boolean(row.room) && Boolean(row.startDate))
      return !admitted && isRecentAlert(row.createdAt)
    })
    .sort((a, b) => {
      const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0
      const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0
      return bTime - aTime
    })
    .map((row) => ({
      id: row.id,
      visitId: row.visit.id,
      patientCode: row.visit.patient.code,
      patientName: fullName(row.visit.patient.firstName, row.visit.patient.lastName),
    }))

  overdueHospitalizations.value = rows
    .filter((row) => hospitalizationStayEnded(row) && isRecentAlert(row.endDate))
    .map((row) => ({
      id: row.id,
      visitId: row.visit.id,
      patientCode: row.visit.patient.code,
      patientName: fullName(row.visit.patient.firstName, row.visit.patient.lastName),
      roomName: row.room?.name ?? '',
    }))
}

async function loadAlerts() {
  if (!canSeeAlerts.value || !auth.user) {
    overview.value = null
    gestionnaireOverview.value = null
    pendingHospitalizations.value = []
    overdueHospitalizations.value = []
    pendingExamPayments.value = []
    pendingConsultationPayments.value = []
    return
  }

  const tasks: Promise<void>[] = []
  if (canSeeAdminAlerts.value) {
    tasks.push(
      api.get<AdminDashboardOverview>('/dashboard/admin').then(({ data }) => {
        overview.value = data
      }),
    )
  } else {
    overview.value = null
  }

  if (canSeeGestionnaireAlerts.value) {
    tasks.push(
      api.get<GestionnaireDashboardOverview>('/dashboard/gestionnaire').then(({ data }) => {
        gestionnaireOverview.value = data
      }),
    )
  } else {
    gestionnaireOverview.value = null
  }

  tasks.push(
    loadHospitalizationAlerts().catch(() => {
      pendingHospitalizations.value = []
      overdueHospitalizations.value = []
    }),
  )
  tasks.push(
    loadPaymentAlerts().catch(() => {
      pendingExamPayments.value = []
      pendingConsultationPayments.value = []
    }),
  )

  try {
    await Promise.all(tasks)
  } catch {
    /* garde les dernières alertes connues */
  }
}

onMounted(() => {
  void loadAlerts()
  refreshTimer = setInterval(() => {
    void loadAlerts()
  }, 90_000)
})

onUnmounted(() => {
  if (refreshTimer) clearInterval(refreshTimer)
})

watch(
  () => [auth.user?.id, auth.user?.role],
  () => {
    void loadAlerts()
  },
)

watch(showModal, (open) => {
  if (open) void loadAlerts()
})
</script>

<template>
  <template v-if="canSeeAlerts">
    <button
      type="button"
      class="alerts-bell"
      :class="{ 'alerts-bell--active': alertsCount > 0 }"
      :aria-label="alertsAriaLabel"
      :title="alertsAriaLabel"
      @click="showModal = true"
    >
      <Bell :size="18" />
      <span v-if="alertsCount > 0" class="alerts-bell__badge">{{ alertsCount }}</span>
    </button>

    <UiFormModal
      v-if="showModal"
      title="Alertes"
      :subtitle="alertsModalSubtitle"
      :icon="Bell"
      @close="showModal = false"
    >
      <ul v-if="dashboardAlerts.length" class="alerts-list">
        <li
          v-for="alert in dashboardAlerts"
          :key="alert.id"
          class="alerts-list__item"
          :class="`alerts-list__item--${alert.severity}`"
        >
          <div class="alerts-list__content">
            <FlaskConical v-if="alert.kind === 'exam-payment'" :size="18" />
            <Stethoscope v-else-if="alert.kind === 'consultation-payment'" :size="18" />
            <BedDouble
              v-else-if="alert.kind === 'hospitalization' || alert.kind === 'hospitalization-overdue'"
              :size="18"
            />
            <AlertTriangle v-else-if="alert.severity === 'danger'" :size="18" />
            <Clock v-else :size="18" />
            <div>
              <strong class="alerts-list__title">{{ alert.title }}</strong>
              <p class="alerts-list__message">{{ alert.message }}</p>
              <RouterLink
                v-if="alert.actionTo"
                :to="alert.actionTo"
                class="alerts-list__action"
                @click="showModal = false"
              >
                {{ alert.actionLabel }}
              </RouterLink>
            </div>
          </div>
        </li>
      </ul>
      <p v-else class="alerts-list__item alerts-list__item--ok">
        {{ alertsEmptyMessage }}
      </p>
    </UiFormModal>
  </template>
</template>

<style scoped>
.alerts-bell {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.5rem;
  height: 2.5rem;
  border: 2px solid var(--border);
  border-radius: 10px;
  background: var(--bg-card);
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.18s ease;
  box-shadow: var(--shadow-sm);
}

.alerts-bell:hover {
  color: var(--primary-800);
  border-color: var(--accent-400);
}

.alerts-bell--active {
  color: #b45309;
  border-color: #fcd34d;
  background: #fffbeb;
}

.alerts-bell__badge {
  position: absolute;
  top: -6px;
  right: -6px;
  min-width: 1.1rem;
  height: 1.1rem;
  padding: 0 0.3rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: #dc2626;
  color: #fff;
  border-radius: 999px;
  font-size: 0.6875rem;
  font-weight: 700;
  line-height: 1;
}

.alerts-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  max-height: min(55vh, 28rem);
  overflow: auto;
}

.alerts-list__item {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  padding: 0.65rem 0.75rem;
  border-radius: 0.65rem;
  font-size: 0.875rem;
  line-height: 1.45;
}

.alerts-list__content {
  display: flex;
  gap: 0.65rem;
  align-items: flex-start;
}

.alerts-list__title {
  display: block;
  margin-bottom: 0.2rem;
  font-size: 0.9rem;
}

.alerts-list__message {
  margin: 0;
  font-size: 0.8125rem;
  line-height: 1.45;
  opacity: 0.95;
}

.alerts-list__action {
  display: inline-flex;
  align-items: center;
  margin-top: 0.5rem;
  padding: 0.35rem 0.65rem;
  border-radius: 8px;
  border: 1px solid currentColor;
  background: rgba(255, 255, 255, 0.55);
  color: inherit;
  font-size: 0.8125rem;
  font-weight: 700;
  text-decoration: none;
  cursor: pointer;
  transition: background 0.15s ease;
}

.alerts-list__action:hover {
  background: rgba(255, 255, 255, 0.9);
}

.alerts-list__item--danger {
  background: #fef2f2;
  color: #991b1b;
}

.alerts-list__item--warning {
  background: #fffbeb;
  color: #92400e;
}

.alerts-list__item--info {
  background: #eff6ff;
  color: #1e40af;
}

.alerts-list__item--ok {
  background: #f0fdf4;
  color: #166534;
}
</style>
