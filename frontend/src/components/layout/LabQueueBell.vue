<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Bell, Clock, FlaskConical } from '@lucide/vue'
import { useAuthStore } from '@/stores/auth'
import { canAccessModule } from '@/lib/roles'
import { translateDashboardLabel, translateTemplate } from '@/lib/dashboard-i18n'
import { useAppI18n } from '@/i18n/useAppI18n'
import {
  labAlertsRefreshEventName,
  useLabAlertsStore,
} from '@/stores/lab-alerts'
import UiFormModal from '@/components/ui/UiFormModal.vue'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()
const labAlerts = useLabAlertsStore()
const { localeCode, dateTimeText, numberText, uiText } = useAppI18n()

const showModal = ref(false)
let refreshTimer: ReturnType<typeof setInterval> | undefined

const canSeeLabBell = computed(() =>
  Boolean(auth.user && canAccessModule(auth.user.role, 'laboratoire')),
)

/** Sur la file d'attente, le compteur est synchronisé avec la carte Examens. */
const isWaitingQueuePage = computed(() => route.name === 'laboratoire')

/** Examens reçus encore en attente de saisie / envoi au médecin. */
const badgeCount = computed(() => labAlerts.waitingExamCount)

const modalTitle = computed(() => {
  void localeCode.value
  return uiText('Examens en attente reçus')
})

const alertsAriaLabel = computed(() => {
  void localeCode.value
  if (!badgeCount.value) return translateDashboardLabel('Aucun examen en attente reçu')
  return translateTemplate('{n} examen(s) en attente reçu(s)', { n: badgeCount.value })
})

const modalSubtitle = computed(() => {
  void localeCode.value
  if (!badgeCount.value) return translateDashboardLabel('Aucun examen en attente')
  const parts = [
    translateTemplate('{n} examen(s) reçu(s) en attente', { n: badgeCount.value }),
  ]
  if (labAlerts.recentExamCount > 0) {
    parts.push(
      translateTemplate('dont {n} récent(s)', { n: labAlerts.recentExamCount }),
    )
  }
  return parts.join(' · ')
})

async function loadAlerts() {
  if (!canSeeLabBell.value) {
    labAlerts.reset()
    return
  }
  // Ne pas écraser le sync file d'attente (même source que la carte Examens).
  if (isWaitingQueuePage.value) return
  await labAlerts.refresh()
}

function openVisit(visitId: string) {
  showModal.value = false
  void router.push({ name: 'laboratoire-dossier', params: { visitId } })
}

function openQueue() {
  showModal.value = false
  void router.push({ name: 'laboratoire' })
}

function onRefreshEvent() {
  void loadAlerts()
}

function onVisibility() {
  if (document.visibilityState === 'visible') void loadAlerts()
}

onMounted(() => {
  void loadAlerts()
  refreshTimer = setInterval(() => {
    void loadAlerts()
  }, 45_000)
  window.addEventListener(labAlertsRefreshEventName(), onRefreshEvent)
  document.addEventListener('visibilitychange', onVisibility)
})

onUnmounted(() => {
  if (refreshTimer) clearInterval(refreshTimer)
  window.removeEventListener(labAlertsRefreshEventName(), onRefreshEvent)
  document.removeEventListener('visibilitychange', onVisibility)
})

watch(
  () => auth.user?.id,
  () => {
    void loadAlerts()
  },
)

watch(isWaitingQueuePage, (onQueue) => {
  if (!onQueue) void loadAlerts()
})
</script>

<template>
  <div v-if="canSeeLabBell" class="lab-bell-wrap">
    <button
      type="button"
      class="lab-bell"
      :class="{ 'lab-bell--active': badgeCount > 0 }"
      :aria-label="alertsAriaLabel"
      :title="alertsAriaLabel"
      @click="showModal = true"
    >
      <Bell :size="16" />
      <span class="lab-bell__count">{{ numberText(badgeCount) }}</span>
    </button>

    <UiFormModal
      v-if="showModal"
      :title="modalTitle"
      :subtitle="modalSubtitle"
      :icon="Bell"
      @close="showModal = false"
    >
      <ul v-if="labAlerts.items.length" class="lab-alerts-list">
        <li
          v-for="item in labAlerts.items"
          :key="item.visitId"
          class="lab-alerts-list__item"
          :class="{ 'lab-alerts-list__item--recent': item.recent }"
        >
          <FlaskConical v-if="item.recent" :size="18" />
          <Clock v-else :size="18" />
          <div class="lab-alerts-list__body">
            <strong>
              {{ item.patientCode }} — {{ item.patientName }}
              <span class="lab-alerts-list__count">
                {{
                  translateTemplate('{n} examen(s)', { n: item.examCount })
                }}
              </span>
            </strong>
            <p v-if="item.exams.length" class="lab-alerts-list__exams">
              {{ item.exams.join(', ') }}
            </p>
            <p v-if="item.labSentToLabAt" class="lab-alerts-list__meta">
              {{
                item.recent
                  ? translateDashboardLabel('Récent')
                  : translateDashboardLabel('En attente')
              }}
              · {{ dateTimeText(item.labSentToLabAt) }}
            </p>
            <button
              type="button"
              class="lab-alerts-list__action"
              @click="openVisit(item.visitId)"
            >
              {{ translateDashboardLabel('Saisir les résultats') }}
            </button>
          </div>
        </li>
      </ul>
      <p v-else class="lab-alerts-list__empty">
        {{ translateDashboardLabel('Aucun examen en attente de saisie.') }}
      </p>

      <template #footer>
        <button type="button" class="lab-alerts-footer" @click="openQueue">
          {{ translateDashboardLabel('Ouvrir la file laboratoire') }}
        </button>
      </template>
    </UiFormModal>
  </div>
</template>

<style scoped>
.lab-bell-wrap {
  display: inline-flex;
  align-items: center;
}

.lab-bell {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  min-height: 2rem;
  padding: 0.3rem 0.65rem;
  border: 1.5px solid var(--border);
  border-radius: 8px;
  background: var(--bg-card, #fff);
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.18s ease;
  font-family: var(--font);
  font-size: 0.8125rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.lab-bell:hover {
  color: var(--primary-800);
  border-color: var(--accent-400, #60a5fa);
}

.lab-bell--active {
  color: #0f766e;
  border-color: #5eead4;
  background: #f0fdfa;
}

.lab-bell__count {
  min-width: 1rem;
  text-align: center;
}

.lab-bell--active .lab-bell__count {
  color: #b91c1c;
}

.lab-alerts-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  max-height: min(55vh, 28rem);
  overflow: auto;
}

.lab-alerts-list__item {
  display: flex;
  align-items: flex-start;
  gap: 0.65rem;
  padding: 0.7rem 0.8rem;
  border-radius: 0.65rem;
  background: #fffbeb;
  color: #92400e;
  font-size: 0.875rem;
}

.lab-alerts-list__item--recent {
  background: #ecfeff;
  color: #155e75;
}

.lab-alerts-list__body {
  min-width: 0;
  flex: 1;
}

.lab-alerts-list__body strong {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.35rem 0.55rem;
  font-size: 0.9rem;
}

.lab-alerts-list__count {
  font-size: 0.75rem;
  font-weight: 700;
  opacity: 0.85;
}

.lab-alerts-list__exams,
.lab-alerts-list__meta {
  margin: 0.25rem 0 0;
  font-size: 0.8125rem;
  line-height: 1.4;
  opacity: 0.95;
}

.lab-alerts-list__meta {
  opacity: 0.8;
}

.lab-alerts-list__action {
  margin-top: 0.5rem;
  padding: 0.35rem 0.65rem;
  border-radius: 8px;
  border: 1px solid currentColor;
  background: rgba(255, 255, 255, 0.55);
  color: inherit;
  font-size: 0.8125rem;
  font-weight: 700;
  cursor: pointer;
}

.lab-alerts-list__action:hover {
  background: rgba(255, 255, 255, 0.9);
}

.lab-alerts-list__empty {
  margin: 0;
  padding: 0.85rem;
  border-radius: 0.65rem;
  background: #f0fdf4;
  color: #166534;
  font-size: 0.875rem;
}

.lab-alerts-footer {
  width: 100%;
  padding: 0.55rem 0.85rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
  color: var(--primary-800);
  font-weight: 700;
  font-size: 0.8125rem;
  cursor: pointer;
}

.lab-alerts-footer:hover {
  background: var(--primary-50, #eff6ff);
}
</style>
