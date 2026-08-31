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
  X,
  Eye,
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
import { isAwaitingPayment, isAwaitingPerformance, isCompletable, isDoctorAwaiting } from '@/lib/surgery-status'
import { showApiErrorModal } from '@/lib/api-modal-helper'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiBadge from '@/components/ui/UiBadge.vue'
import UiStatCard from '@/components/ui/UiStatCard.vue'
import { useAppI18n } from '@/i18n/useAppI18n'

type DoctorReceivableItem = {
  kind: 'CONSULTATION' | 'OPERATION_SURGEON' | 'OPERATION_ASSISTANT'
  amountFcfa: number
}

type DoctorReceivablePayload = {
  totals: {
    surgeryShareFcfa: number
    totalShareFcfa: number
  }
  me?: { items?: DoctorReceivableItem[] }
  doctors?: Array<{ items?: DoctorReceivableItem[] }>
}

const DATE_MODES: { id: DateFilterMode; label: string; icon: typeof CalendarDays }[] = [
  { id: 'day', label: 'Jour', icon: CalendarDays },
  { id: 'month', label: 'Mois', icon: Calendar },
  { id: 'custom', label: 'Personnaliser', icon: CalendarRange },
]

const surgeries = ref<SurgeryCaseRow[]>([])
const surgeryReceivableFcfa = ref(0)
const surgeryReceivableCount = ref(0)
const loading = ref(false)
const actionId = ref<string | null>(null)
const message = ref('')
const messageType = ref<'success' | 'error'>('success')
const filterTab = ref<'awaiting' | 'completed'>('awaiting')

const dateFilterMode = ref<DateFilterMode>('month')
const filterDay = ref(todayDateKey())
const filterMonth = ref(currentMonthKey())
const filterFrom = ref('')
const filterTo = ref('')
const completeTarget = ref<SurgeryCaseRow | null>(null)
const completeNote = ref('')
const detailTarget = ref<SurgeryCaseRow | null>(null)
const { uiText } = useAppI18n()

const isAwaiting = (surgery: SurgeryCaseRow) => isDoctorAwaiting(surgery.status)
const isUnpaidCase = (surgery: SurgeryCaseRow) => isAwaitingPayment(surgery.status)

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
  const completedPeriod = completedSurgeries.value
  let paidFcfa = 0

  for (const surgery of surgeries.value.filter((s) => s.status === 'COMPLETED')) {
    const kind = myShareKind(surgery)
    if (isSharePaid(surgery, kind)) {
      paidFcfa += getShareAmountFcfa(surgery, kind)
    }
  }

  return {
    awaiting: awaitingSurgeries.value.length,
    completedPeriod: completedPeriod.length,
    unpaidCount: surgeryReceivableCount.value,
    unpaidFcfa: surgeryReceivableFcfa.value,
    paidFcfa,
  }
})

function evolutionLabel(surgery: SurgeryCaseRow) {
  if (isUnpaidCase(surgery)) {
    return surgery.status === 'QUOTED'
      ? uiText('Devis — en attente de paiement')
      : uiText('Prescrite — en attente de paiement')
  }
  if (isAwaiting(surgery)) {
    if (!surgery.operationScheduledAt) return uiText('Payée — date d\'opération à fixer')
    const scheduled = new Date(surgery.operationScheduledAt)
    if (scheduled.getTime() > Date.now()) {
      return uiText('Programmée le {date}').replace(
        '{date}',
        formatSurgeryDate(surgery.operationScheduledAt),
      )
    }
    return uiText('Date prévue le {date}').replace(
      '{date}',
      formatSurgeryDate(surgery.operationScheduledAt),
    )
  }
  return uiText('Effectuée le {date}').replace(
    '{date}',
    formatSurgeryDate(surgery.completedAt ?? surgery.operationScheduledAt),
  )
}

function paymentLabel(surgery: SurgeryCaseRow) {
  if (isUnpaidCase(surgery)) return uiText('Patient non encaissé')
  if (isAwaiting(surgery)) return '—'
  const kind = myShareKind(surgery)
  if (isSharePaid(surgery, kind)) {
    const paidAt = getSharePaidAt(surgery, kind)
    if (paidAt) {
      return uiText('Réglée le {date}').replace(
        '{date}',
        new Date(paidAt).toLocaleDateString('fr-FR', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        }),
      )
    }
    return uiText('Réglée')
  }
  return uiText('En attente de règlement')
}

function roleLabel(surgery: SurgeryCaseRow) {
  return myShareKind(surgery) === 'assistant' ? uiText('Assistant') : uiText('Chirurgien')
}

function canMarkCompleted(surgery: SurgeryCaseRow) {
  return isCompletable(surgery.status)
}

function openCompleteModal(surgery: SurgeryCaseRow) {
  completeTarget.value = surgery
  completeNote.value = ''
  message.value = ''
}

function closeCompleteModal() {
  if (actionId.value) return
  completeTarget.value = null
  completeNote.value = ''
}

function openDetailsModal(surgery: SurgeryCaseRow) {
  detailTarget.value = surgery
}

function closeDetailsModal() {
  detailTarget.value = null
}

async function confirmComplete() {
  const surgery = completeTarget.value
  const note = completeNote.value.trim()
  if (!surgery) return
  if (note.length < 2) {
    message.value = uiText('Saisissez le commentaire pour enregistrer le dossier.')
    messageType.value = 'error'
    return
  }

  actionId.value = surgery.id
  message.value = ''
  try {
    await api.post(`/surgeries/mine/${surgery.id}/complete`, {
      notes: note,
    })
    message.value = uiText('Dossier enregistré — opération marquée comme effectuée.')
    messageType.value = 'success'
    completeTarget.value = null
    completeNote.value = ''
    await load()
    filterTab.value = 'completed'
  } catch (error: unknown) {
    const shown = await showApiErrorModal(error, 'Impossible de marquer l’opération comme effectuée.')
    if (!shown) {
      const err = error as { response?: { data?: { error?: string } } }
      message.value =
        err.response?.data?.error || uiText('Impossible de marquer l’opération comme effectuée.')
      messageType.value = 'error'
    }
  } finally {
    actionId.value = null
  }
}

async function loadReceivableShares() {
  try {
    const { data } = await api.get<DoctorReceivablePayload>('/doctor-shares/receivable', {
      params: { period: 'month', month: currentMonthKey() },
    })
    const items =
      data.me?.items ?? data.doctors?.[0]?.items ?? ([] as DoctorReceivableItem[])
    const surgeryItems = items.filter((item) => item.kind !== 'CONSULTATION')
    surgeryReceivableFcfa.value =
      data.totals.surgeryShareFcfa ??
      surgeryItems.reduce((sum, item) => sum + item.amountFcfa, 0)
    surgeryReceivableCount.value = surgeryItems.length
  } catch {
    surgeryReceivableFcfa.value = 0
    surgeryReceivableCount.value = 0
  }
}

async function load() {
  loading.value = true
  message.value = ''
  try {
    const [{ data }, ] = await Promise.all([
      api.get<SurgeryCaseRow[]>('/surgeries/mine', {
        params: { scope: 'all' },
      }),
      loadReceivableShares(),
    ])
    surgeries.value = data
  } catch {
    message.value = 'Impossible de charger vos opérations.'
    messageType.value = 'error'
    surgeries.value = []
    surgeryReceivableFcfa.value = 0
    surgeryReceivableCount.value = 0
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
        :title="uiText('Mes opérations')"
        :subtitle="uiText('Interventions, clôture et parts à percevoir')"
        :icon="Scissors"
      />

      <UiAlert v-if="message" :type="messageType" :message="message" />

      <div class="stats-grid ops-stats">
        <UiStatCard mini label="En attente" :value="stats.awaiting" :icon="Clock" variant="amber" />
        <UiStatCard mini label="Effectuées" :value="stats.completedPeriod" :icon="CheckCircle2" variant="teal" />
        <UiStatCard
          mini
          label="À percevoir"
          :value="formatFcfa(stats.unpaidFcfa)"
          :icon="CircleDollarSign"
          variant="rose"
        />
      </div>
      <p class="ops-receivable-hint">
        {{
          stats.unpaidCount > 0
            ? uiText(
                '{n} part(s) opération — % calculé sur le montant déjà encaissé (tranches incluses)',
              ).replace('{n}', String(stats.unpaidCount))
            : uiText('Aucune part opération à percevoir pour le moment')
        }}
      </p>

      <div v-if="filterTab === 'completed'" class="filter-bar" role="region" :aria-label="uiText('Filtrer par date')">
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
              {{ uiText(mode.label) }}
            </button>
          </div>
          <div class="filter-bar__controls">
            <template v-if="dateFilterMode === 'day'">
              <label class="filter-bar__field">
                <span class="filter-bar__field-label">{{ uiText('Date') }}</span>
                <input v-model="filterDay" type="date" class="filter-bar__input" />
              </label>
            </template>
            <template v-else-if="dateFilterMode === 'month'">
              <label class="filter-bar__field">
                <span class="filter-bar__field-label">{{ uiText('Mois') }}</span>
                <input v-model="filterMonth" type="month" class="filter-bar__input" />
              </label>
            </template>
            <template v-else>
              <label class="filter-bar__field">
                <span class="filter-bar__field-label">{{ uiText('Du') }}</span>
                <input v-model="filterFrom" type="date" class="filter-bar__input" />
              </label>
              <label class="filter-bar__field">
                <span class="filter-bar__field-label">{{ uiText('Au') }}</span>
                <input v-model="filterTo" type="date" class="filter-bar__input" />
              </label>
            </template>
          </div>
        </div>
        <p class="filter-bar__period">{{ periodLabel }}</p>
      </div>
    </section>

    <section class="page-with-table__body">
      <UiCard direct :title="uiText('Suivi opératoire')"
        :description="uiText('À l’effectuation : commenter et enregistrer le dossier — le paiement reste à part')"
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
              {{ uiText('En attente') }} ({{ stats.awaiting }})
            </button>
            <button
              type="button"
              class="ops-tabs__btn"
              :class="{ 'ops-tabs__btn--active': filterTab === 'completed' }"
              @click="filterTab = 'completed'"
            >
              {{ uiText('Effectuées') }}
            </button>
          </div>
          <UiButton variant="ghost" size="sm" :icon="RefreshCw" :disabled="loading" @click="load">
            {{ uiText('Actualiser') }}
          </UiButton>
        </template>

        <p v-if="!loading && !displayedSurgeries.length" class="ops-empty">
          {{
            uiText(
              filterTab === 'awaiting'
                ? 'Aucune opération en attente pour le moment'
                : 'Aucune opération effectuée sur la période sélectionnée',
            )
          }}
        </p>

        <div v-else class="ops-table-wrap">
          <table class="ops-table">
            <thead>
              <tr>
                <th>{{ uiText('Patient') }}</th>
                <th>{{ uiText('Intervention') }}</th>
                <th>{{ uiText('Évolution') }}</th>
                <th>{{ uiText('Ma part') }}</th>
                <th>{{ uiText('Règlement') }}</th>
                <th class="ops-table__actions-col">{{ uiText('Actions') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="surgery in displayedSurgeries" :key="surgery.id">
                <td class="ops-table__patient">
                  <strong>
                    {{ fullName(surgery.visit.patient.firstName, surgery.visit.patient.lastName) }}
                  </strong>
                  <p
                    v-if="surgery.visit.consultation?.doctorComment"
                    class="ops-table__note"
                  >
                    {{ surgery.visit.consultation.doctorComment }}
                  </p>
                </td>
                <td>{{ surgery.interventionType.label }}</td>
                <td>{{ evolutionLabel(surgery) }}</td>
                <td>
                  <strong>{{ formatFcfa(myShareAmount(surgery)) }}</strong>
                  <span class="ops-table__share-kind">
                    {{ SHARE_KIND_LABELS[myShareKind(surgery)] }}
                  </span>
                </td>
                <td>
                  <UiBadge v-if="isUnpaidCase(surgery)" variant="warning">
                    {{ paymentLabel(surgery) }}
                  </UiBadge>
                  <UiBadge v-else-if="canMarkCompleted(surgery)" variant="info">
                    {{
                      isAwaitingPerformance(surgery.status)
                        ? uiText('Payée — à clôturer')
                        : uiText('À clôturer')
                    }}
                  </UiBadge>
                  <UiBadge v-else-if="mySharePaid(surgery)" variant="success">
                    {{ paymentLabel(surgery) }}
                  </UiBadge>
                  <UiBadge v-else variant="danger">{{ paymentLabel(surgery) }}</UiBadge>
                </td>
                <td class="ops-table__actions-col">
                  <div v-if="surgery.status === 'COMPLETED'" class="ops-table__actions">
                    <button
                      type="button"
                      class="ops-act ops-act--ghost"
                      :title="uiText('Voir détails')"
                      :aria-label="uiText('Voir détails')"
                      :disabled="!!actionId"
                      @click="openDetailsModal(surgery)"
                    >
                      <Eye :size="15" />
                      <span>{{ uiText('Voir') }}</span>
                    </button>
                  </div>
                  <div v-else class="ops-table__actions">
                    <button
                      v-if="canMarkCompleted(surgery)"
                      type="button"
                      class="ops-act ops-act--primary"
                      :disabled="!!actionId"
                      @click="openCompleteModal(surgery)"
                    >
                      <CheckCircle2 :size="15" />
                      {{ uiText('Effectuée') }}
                    </button>
                    <span v-else class="ops-table__hint">—</span>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </UiCard>
    </section>

    <Teleport to="body">
      <div v-if="completeTarget" class="ops-modal-overlay" @click.self="closeCompleteModal">
        <div class="ops-modal" role="dialog" aria-modal="true" aria-labelledby="ops-complete-title">
          <header class="ops-modal__header">
            <div>
              <h2 id="ops-complete-title">{{ uiText('Effectuer l’opération') }}</h2>
              <p>
                {{
                  fullName(
                    completeTarget.visit.patient.firstName,
                    completeTarget.visit.patient.lastName,
                  )
                }}
                — {{ completeTarget.interventionType.label }}
              </p>
            </div>
            <button
              type="button"
              class="ops-modal__close"
              :aria-label="uiText('Fermer')"
              :disabled="!!actionId"
              @click="closeCompleteModal"
            >
              <X :size="18" />
            </button>
          </header>
          <div class="ops-modal__body">
            <label class="ops-modal__label">{{ uiText('Commentaire final (opération)') }}</label>
            <p class="ops-modal__hint">
              {{ uiText('Rédigez le compte rendu puis enregistrez le dossier patient.') }}
            </p>
            <textarea
              v-model="completeNote"
              class="ops-modal__textarea"
              rows="5"
              :placeholder="uiText('Déroulement, suite, surveillance…')"
            />
          </div>
          <footer class="ops-modal__footer">
            <UiButton variant="ghost" :disabled="!!actionId" @click="closeCompleteModal">
              {{ uiText('Annuler') }}
            </UiButton>
            <UiButton
              variant="primary"
              :icon="CheckCircle2"
              :loading="!!actionId"
              :disabled="completeNote.trim().length < 2"
              @click="confirmComplete"
            >
              {{ uiText('Enregistrer le dossier') }}
            </UiButton>
          </footer>
        </div>
      </div>

      <div v-if="detailTarget" class="ops-modal-overlay" @click.self="closeDetailsModal">
        <div
          class="ops-modal ops-modal--wide"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ops-detail-title"
        >
          <header class="ops-modal__header">
            <div>
              <h2 id="ops-detail-title">{{ uiText('Détails de l’opération') }}</h2>
              <p>
                {{
                  fullName(
                    detailTarget.visit.patient.firstName,
                    detailTarget.visit.patient.lastName,
                  )
                }}
                — {{ detailTarget.visit.patient.code }}
              </p>
            </div>
            <button
              type="button"
              class="ops-modal__close"
              :aria-label="uiText('Fermer')"
              @click="closeDetailsModal"
            >
              <X :size="18" />
            </button>
          </header>
          <div class="ops-modal__body ops-detail">
            <dl class="ops-detail__grid">
              <div>
                <dt>{{ uiText('Intervention') }}</dt>
                <dd>{{ detailTarget.interventionType.label }}</dd>
              </div>
              <div>
                <dt>{{ uiText('Votre rôle') }}</dt>
                <dd>{{ roleLabel(detailTarget) }}</dd>
              </div>
              <div>
                <dt>{{ uiText('Évolution') }}</dt>
                <dd>{{ evolutionLabel(detailTarget) }}</dd>
              </div>
              <div>
                <dt>{{ uiText('Date prévue') }}</dt>
                <dd>{{ formatSurgeryDate(detailTarget.operationScheduledAt) }}</dd>
              </div>
              <div>
                <dt>{{ uiText('Effectuée le') }}</dt>
                <dd>{{ formatSurgeryDate(detailTarget.completedAt) }}</dd>
              </div>
              <div>
                <dt>{{ uiText('Ma part') }}</dt>
                <dd>
                  {{ formatFcfa(myShareAmount(detailTarget)) }}
                  ({{ SHARE_KIND_LABELS[myShareKind(detailTarget)] }})
                </dd>
              </div>
              <div>
                <dt>{{ uiText('Règlement') }}</dt>
                <dd>{{ paymentLabel(detailTarget) }}</dd>
              </div>
              <div v-if="detailTarget.visit.patient.phone">
                <dt>{{ uiText('Téléphone') }}</dt>
                <dd>{{ detailTarget.visit.patient.phone }}</dd>
              </div>
              <div v-if="detailTarget.visit.consultation?.diagnosis" class="ops-detail__full">
                <dt>{{ uiText('Diagnostic') }}</dt>
                <dd>{{ detailTarget.visit.consultation.diagnosis }}</dd>
              </div>
              <div class="ops-detail__full">
                <dt>{{ uiText('Commentaire final') }}</dt>
                <dd>
                  {{
                    detailTarget.visit.consultation?.doctorComment?.trim() ||
                    uiText('Aucun commentaire final.')
                  }}
                </dd>
              </div>
            </dl>
          </div>
          <footer class="ops-modal__footer">
            <UiButton variant="primary" @click="closeDetailsModal">
              {{ uiText('Fermer') }}
            </UiButton>
          </footer>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.ops-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
  gap: 0.75rem;
  margin-top: 0.5rem;
}

.ops-receivable-hint {
  margin: 0.45rem 0 0;
  font-size: 0.75rem;
  color: var(--text-muted);
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
  flex: 1 1 0;
  min-height: 0;
  max-width: 100%;
}

.ops-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9375rem;
  min-width: 52rem;
}

.ops-table th,
.ops-table td {
  padding: 0.85rem 0.9rem;
  text-align: start;
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

.ops-table__hint {
  font-size: 0.75rem;
  color: var(--text-muted);
  font-weight: 500;
}

.ops-table__actions-col {
  position: sticky;
  inset-inline-end: 0;
  z-index: 2;
  min-width: 11.5rem;
  background: #fff;
  box-shadow: -6px 0 10px -8px rgba(15, 23, 42, 0.25);
}

.ops-table thead .ops-table__actions-col {
  background: #f8fafc;
  z-index: 3;
}

.ops-table__actions {
  display: flex;
  flex-wrap: nowrap;
  gap: 0.35rem;
  align-items: center;
}

.ops-act {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.35rem 0.55rem;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: #fff;
  color: var(--text);
  font-size: 0.75rem;
  font-weight: 650;
  cursor: pointer;
  white-space: nowrap;
}

.ops-act:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.ops-act--ghost:hover:not(:disabled) {
  background: #f1f5f9;
  border-color: #cbd5e1;
}

.ops-act--accent {
  background: var(--primary-50, #eff6ff);
  border-color: var(--primary-200, #bfdbfe);
  color: var(--primary-800, #1e40af);
}

.ops-act--accent:hover:not(:disabled) {
  background: var(--primary-100, #dbeafe);
}

.ops-act--primary {
  background: linear-gradient(135deg, var(--action), var(--action-hover));
  border-color: transparent;
  color: #fff;
}

.ops-empty {
  text-align: center;
  color: var(--text-light);
  padding: 2rem 1rem;
  font-size: 0.875rem;
}

.ops-table__note {
  margin: 0.35rem 0 0;
  font-size: 0.75rem;
  color: var(--text-muted);
  line-height: 1.35;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  max-width: 16rem;
}

.ops-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background: rgba(15, 23, 42, 0.45);
  backdrop-filter: blur(4px);
}

.ops-modal {
  width: 100%;
  max-width: 28rem;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
}

.ops-modal--wide {
  max-width: 36rem;
}

.ops-modal__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 1rem 1.15rem 0;
}

.ops-modal__header h2 {
  margin: 0;
  font-size: 1.05rem;
}

.ops-modal__header p {
  margin: 0.3rem 0 0;
  font-size: 0.75rem;
  color: var(--text-muted);
}

.ops-modal__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  border: 0;
  border-radius: 8px;
  background: #f1f5f9;
  color: var(--text-muted);
  cursor: pointer;
}

.ops-modal__body {
  padding: 0.85rem 1.15rem;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.ops-modal__label {
  font-size: 0.8125rem;
  font-weight: 700;
  color: var(--primary-800);
}

.ops-modal__hint {
  margin: 0;
  font-size: 0.75rem;
  color: var(--text-muted);
}

.ops-modal__textarea {
  width: 100%;
  min-height: 6rem;
  resize: vertical;
  padding: 0.65rem 0.75rem;
  border: 1.5px solid var(--border);
  border-radius: var(--radius-sm);
  font-family: inherit;
  font-size: 0.875rem;
}

.ops-modal__textarea:focus {
  outline: none;
  border-color: var(--primary-400);
  box-shadow: 0 0 0 3px var(--focus-ring-sm);
}

.ops-modal__existing {
  margin: 0 0 0.5rem;
  padding: 0.65rem 0.75rem;
  border-radius: var(--radius-sm);
  background: #f8fafc;
  border: 1px solid var(--border);
  font-size: 0.8125rem;
  color: var(--text-muted);
  white-space: pre-wrap;
  line-height: 1.4;
  max-height: 8rem;
  overflow: auto;
}

.ops-modal__existing strong {
  display: block;
  margin-bottom: 0.25rem;
  color: var(--primary-800);
  font-size: 0.75rem;
}

.ops-detail__grid {
  margin: 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem 1rem;
}

.ops-detail__grid > div {
  min-width: 0;
}

.ops-detail__full {
  grid-column: 1 / -1;
}

.ops-detail__grid dt {
  margin: 0;
  font-size: 0.6875rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-light);
}

.ops-detail__grid dd {
  margin: 0.2rem 0 0;
  font-size: 0.875rem;
  color: var(--text);
  white-space: pre-wrap;
  line-height: 1.4;
}

.ops-modal__footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.55rem;
  padding: 0.85rem 1.15rem 1.1rem;
  border-top: 1px solid var(--border);
}
</style>
