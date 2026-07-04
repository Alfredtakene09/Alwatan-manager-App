<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  Scissors,
  RefreshCw,
  Clock,
  CheckCircle2,
  CircleDollarSign,
  CalendarDays,
  Calendar,
  CalendarRange,
} from '@lucide/vue'
import api from '@/api/client'
import { formatFcfa, fullName } from '@/lib/roles'
import { type SurgeryCaseRow, formatSurgeryDate } from '@/lib/surgery-case'
import { surgeryCompletedAtIso } from '@/lib/surgery-shares'
import {
  getShareAmountFcfa,
  getSharePaidAt,
  isSharePaid,
  SHARE_KIND_LABELS,
  type OperationShareKind,
} from '@/lib/surgery-share-payments'
import {
  currentMonthKey,
  formatPeriodLabel,
  matchesDateFilter,
  todayDateKey,
  type DateFilterMode,
} from '@/lib/date-filters'
import { isAwaitingPerformance } from '@/lib/surgery-status'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiBadge from '@/components/ui/UiBadge.vue'
import UiStatCard from '@/components/ui/UiStatCard.vue'

const DATE_MODES: { id: DateFilterMode; label: string; icon: typeof CalendarDays }[] = [
  { id: 'day', label: 'Jour', icon: CalendarDays },
  { id: 'month', label: 'Mois', icon: Calendar },
  { id: 'custom', label: 'Personnaliser', icon: CalendarRange },
]

const surgeries = ref<SurgeryCaseRow[]>([])
const loading = ref(false)
const message = ref('')
const messageType = ref<'success' | 'error'>('success')
const filterTab = ref<'awaiting' | 'completed'>('awaiting')

const dateFilterMode = ref<DateFilterMode>('month')
const filterDay = ref(todayDateKey())
const filterMonth = ref(currentMonthKey())
const filterFrom = ref('')
const filterTo = ref('')

const isAwaiting = (surgery: SurgeryCaseRow) => isAwaitingPerformance(surgery.status)

const awaitingSurgeries = computed(() => surgeries.value.filter(isAwaiting))

const completedSurgeries = computed(() => {
  return surgeries.value
    .filter((s) => s.status === 'COMPLETED')
    .filter((surgery) =>
      matchesDateFilter(
        surgeryCompletedAtIso(surgery),
        dateFilterMode.value,
        filterDay.value,
        filterMonth.value,
        filterFrom.value,
        filterTo.value,
      ),
    )
})

const displayedSurgeries = computed(() =>
  filterTab.value === 'awaiting' ? awaitingSurgeries.value : completedSurgeries.value,
)

const periodLabel = computed(() =>
  formatPeriodLabel(
    dateFilterMode.value,
    filterDay.value,
    filterMonth.value,
    filterFrom.value,
    filterTo.value,
  ),
)

function myShareKind(surgery: SurgeryCaseRow): OperationShareKind {
  return surgery.myShareKind ?? 'surgeon'
}

function myShareAmount(surgery: SurgeryCaseRow) {
  return getShareAmountFcfa(surgery, myShareKind(surgery))
}

function mySharePaid(surgery: SurgeryCaseRow) {
  return isSharePaid(surgery, myShareKind(surgery))
}

const stats = computed(() => {
  const completedAll = surgeries.value.filter((s) => s.status === 'COMPLETED')
  const completedPeriod = completedSurgeries.value
  let unpaidFcfa = 0
  let unpaidCount = 0
  let paidFcfa = 0

  for (const surgery of completedAll) {
    const kind = myShareKind(surgery)
    const amount = getShareAmountFcfa(surgery, kind)
    if (isSharePaid(surgery, kind)) {
      paidFcfa += amount
    } else {
      unpaidFcfa += amount
      unpaidCount += 1
    }
  }

  return {
    awaiting: awaitingSurgeries.value.length,
    completedPeriod: completedPeriod.length,
    unpaidCount,
    unpaidFcfa,
    paidFcfa,
  }
})

function evolutionLabel(surgery: SurgeryCaseRow) {
  if (isAwaiting(surgery)) {
    if (!surgery.operationScheduledAt) return 'Payée — date d\'opération à fixer'
    const scheduled = new Date(surgery.operationScheduledAt)
    if (scheduled.getTime() > Date.now()) {
      return `Programmée le ${formatSurgeryDate(surgery.operationScheduledAt)}`
    }
    return `Date prévue le ${formatSurgeryDate(surgery.operationScheduledAt)}`
  }
  return `Effectuée le ${formatSurgeryDate(surgery.completedAt ?? surgery.operationScheduledAt)}`
}

function paymentLabel(surgery: SurgeryCaseRow) {
  if (isAwaiting(surgery)) return '—'
  const kind = myShareKind(surgery)
  if (isSharePaid(surgery, kind)) {
    const paidAt = getSharePaidAt(surgery, kind)
    if (paidAt) {
      return `Réglée le ${new Date(paidAt).toLocaleDateString('fr-FR', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })}`
    }
    return 'Réglée'
  }
  return 'En attente de règlement'
}

function roleLabel(surgery: SurgeryCaseRow) {
  return myShareKind(surgery) === 'assistant' ? 'Assistant' : 'Chirurgien'
}

async function load() {
  loading.value = true
  message.value = ''
  try {
    const { data } = await api.get<SurgeryCaseRow[]>('/surgeries/mine', {
      params: { scope: 'all' },
    })
    surgeries.value = data
  } catch {
    message.value = 'Impossible de charger vos opérations.'
    messageType.value = 'error'
    surgeries.value = []
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="page-with-table page-with-table--medecin">
    <section class="page-with-table__head">
      <UiPageHeader
        title="Mes opérations"
        subtitle="Suivi de vos interventions et du règlement de votre part"
        :icon="Scissors"
      />

      <UiAlert v-if="message" :type="messageType" :message="message" />

      <div class="stats-grid ops-stats">
        <UiStatCard mini label="En attente" :value="stats.awaiting" :icon="Clock" variant="amber" />
        <UiStatCard mini label="Effectuées" :value="stats.completedPeriod" :icon="CheckCircle2" variant="teal" />
        <UiStatCard mini label="À percevoir" :value="formatFcfa(stats.unpaidFcfa)" :icon="CircleDollarSign" variant="rose" />
      </div>

      <div v-if="filterTab === 'completed'" class="filter-bar" role="region" aria-label="Filtrer par date">
        <div class="filter-bar__row">
          <div class="filter-bar__modes">
            <button
              v-for="mode in DATE_MODES"
              :key="mode.id"
              type="button"
              class="filter-bar__mode"
              :class="{ 'filter-bar__mode--active': dateFilterMode === mode.id }"
              @click="dateFilterMode = mode.id"
            >
              <component :is="mode.icon" :size="15" />
              {{ mode.label }}
            </button>
          </div>
          <div class="filter-bar__controls">
            <template v-if="dateFilterMode === 'day'">
              <label class="filter-bar__field">
                <span class="filter-bar__field-label">Date</span>
                <input v-model="filterDay" type="date" class="filter-bar__input" />
              </label>
            </template>
            <template v-else-if="dateFilterMode === 'month'">
              <label class="filter-bar__field">
                <span class="filter-bar__field-label">Mois</span>
                <input v-model="filterMonth" type="month" class="filter-bar__input" />
              </label>
            </template>
            <template v-else>
              <label class="filter-bar__field">
                <span class="filter-bar__field-label">Du</span>
                <input v-model="filterFrom" type="date" class="filter-bar__input" />
              </label>
              <label class="filter-bar__field">
                <span class="filter-bar__field-label">Au</span>
                <input v-model="filterTo" type="date" class="filter-bar__input" />
              </label>
            </template>
          </div>
        </div>
        <p class="filter-bar__period">{{ periodLabel }}</p>
      </div>
    </section>

    <section class="page-with-table__body">
      <UiCard
        title="Suivi opératoire"
        description="Lecture seule — le règlement est enregistré par la comptabilité"
        class="ui-card--table-panel"
        :icon="Scissors"
        icon-variant="green"
      >
        <template #actions>
          <div class="ops-tabs">
            <button
              type="button"
              class="ops-tabs__btn"
              :class="{ 'ops-tabs__btn--active': filterTab === 'awaiting' }"
              @click="filterTab = 'awaiting'"
            >
              En attente ({{ stats.awaiting }})
            </button>
            <button
              type="button"
              class="ops-tabs__btn"
              :class="{ 'ops-tabs__btn--active': filterTab === 'completed' }"
              @click="filterTab = 'completed'"
            >
              Effectuées
            </button>
          </div>
          <UiButton variant="ghost" size="sm" :icon="RefreshCw" :disabled="loading" @click="load">
            Actualiser
          </UiButton>
        </template>

        <p v-if="!loading && !displayedSurgeries.length" class="ops-empty">
          {{
            filterTab === 'awaiting'
              ? 'Aucune opération en attente pour le moment'
              : 'Aucune opération effectuée sur la période sélectionnée'
          }}
        </p>

        <div v-else class="ops-table-wrap">
          <table class="ops-table">
            <thead>
              <tr>
                <th>Patient</th>
                <th>Intervention</th>
                <th>Votre rôle</th>
                <th>Évolution</th>
                <th>Ma part</th>
                <th>Règlement</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="surgery in displayedSurgeries" :key="surgery.id">
                <td class="ops-table__patient">
                  <strong>
                    {{ fullName(surgery.visit.patient.firstName, surgery.visit.patient.lastName) }}
                  </strong>
                </td>
                <td>{{ surgery.interventionType.label }}</td>
                <td>{{ roleLabel(surgery) }}</td>
                <td>{{ evolutionLabel(surgery) }}</td>
                <td>
                  <strong>{{ formatFcfa(myShareAmount(surgery)) }}</strong>
                  <span class="ops-table__share-kind">
                    {{ SHARE_KIND_LABELS[myShareKind(surgery)] }}
                  </span>
                </td>
                <td>
                  <UiBadge v-if="isAwaiting(surgery)" variant="warning">Non applicable</UiBadge>
                  <UiBadge v-else-if="mySharePaid(surgery)" variant="success">
                    {{ paymentLabel(surgery) }}
                  </UiBadge>
                  <UiBadge v-else variant="danger">{{ paymentLabel(surgery) }}</UiBadge>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </UiCard>
    </section>
  </div>
</template>

<style scoped>
.ops-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
  gap: 0.75rem;
  margin-top: 0.5rem;
}

.filter-bar {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0.75rem 1rem;
  margin-top: 0.75rem;
}

.filter-bar__row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 0.75rem 1rem;
}

.filter-bar__modes {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  padding: 0.2rem;
  background: #f1f5f9;
  border-radius: 10px;
  border: 1px solid var(--border);
}

.filter-bar__mode {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.42rem 0.75rem;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-muted);
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;
}

.filter-bar__mode--active {
  background: #fff;
  color: var(--primary-800);
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08);
}

.filter-bar__controls {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 0.65rem;
}

.filter-bar__field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.filter-bar__field-label {
  font-size: 0.6875rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-light);
}

.filter-bar__input {
  height: 2.25rem;
  padding: 0 0.65rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
  font-size: 0.875rem;
  min-width: 10.5rem;
}

.filter-bar__period {
  margin: 0.65rem 0 0;
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-muted);
}

.ops-tabs {
  display: flex;
  gap: 0.25rem;
  margin-right: 0.5rem;
  flex-wrap: wrap;
}

.ops-tabs__btn {
  border: 1px solid var(--border);
  background: #fff;
  border-radius: 999px;
  padding: 0.3rem 0.75rem;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-muted);
  cursor: pointer;
}

.ops-tabs__btn--active {
  background: var(--primary-100);
  border-color: var(--primary-300);
  color: var(--primary-800);
}

.ops-table-wrap {
  overflow: auto;
}

.ops-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9375rem;
}

.ops-table th,
.ops-table td {
  padding: 0.85rem 0.9rem;
  text-align: left;
  border-bottom: 1px solid var(--border);
  vertical-align: middle;
}

.ops-table th {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
  background: #f8fafc;
  white-space: nowrap;
}

.ops-table__patient strong {
  display: block;
}

.ops-table__share-kind {
  display: block;
  margin-top: 0.15rem;
  font-size: 0.75rem;
  color: var(--text-muted);
}

.ops-empty {
  text-align: center;
  color: var(--text-light);
  padding: 2rem 1rem;
  font-size: 0.875rem;
}
</style>
