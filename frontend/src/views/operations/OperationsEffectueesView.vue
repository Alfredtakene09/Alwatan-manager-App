<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  CheckCircle2,
  Scissors,
  RefreshCw,
  CalendarDays,
  CalendarRange,
  Calendar,
  CircleDollarSign,
  Stethoscope,
  Building2,
  HeartHandshake,
  Search,
  Save,
  Banknote,
} from '@lucide/vue'
import { isAxiosError } from 'axios'
import api from '@/api/client'
import { confirmAppModal } from '@/lib/api-modal-helper'
import { formatFcfa, fullName } from '@/lib/roles'
import { type SurgeryCaseRow, formatSurgeryDate, todayDateInputValue } from '@/lib/surgery-case'
import {
  computeOperationShares,
  surgeryCompletedAtIso,
} from '@/lib/surgery-shares'
import {
  countUnpaidShares,
  getShareAmountFcfa,
  getUnpaidShareKinds,
  hasAnySharePaid,
  isSharePaid,
  SHARE_KIND_LABELS,
  sumUnpaidShareAmounts,
  type OperationShareKind,
} from '@/lib/surgery-share-payments'
import {
  currentMonthKey,
  formatPeriodLabel,
  matchesDateFilter,
  todayDateKey,
  yesterdayDateKey,
  type DateFilterMode,
} from '@/lib/date-filters'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiFormModal from '@/components/ui/UiFormModal.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiStatCard from '@/components/ui/UiStatCard.vue'
import CompletedOperationsDataTable from '@/components/ui/CompletedOperationsDataTable.vue'

const DATE_MODES: { id: DateFilterMode; label: string; icon: typeof CalendarDays }[] = [
  { id: 'day', label: 'Jour', icon: CalendarDays },
  { id: 'month', label: 'Mois', icon: Calendar },
  { id: 'custom', label: 'Personnaliser', icon: CalendarRange },
]

const surgeries = ref<SurgeryCaseRow[]>([])
const loading = ref(false)
const actionId = ref<string | null>(null)
const batchPaying = ref(false)
const message = ref('')
const messageType = ref<'success' | 'error'>('success')
const searchQuery = ref('')
const filterSurgeonId = ref('')
const postponeModalOpen = ref(false)
const postponeTargetId = ref<string | null>(null)
const postponeDate = ref(todayDateInputValue())
const payModalOpen = ref(false)
const payTargetId = ref<string | null>(null)
const selectedShares = ref<OperationShareKind[]>([])

const dateFilterMode = ref<DateFilterMode>('month')
const filterDay = ref(todayDateKey())
const filterMonth = ref(currentMonthKey())
const filterFrom = ref('')
const filterTo = ref('')

const dateFilteredSurgeries = computed(() =>
  surgeries.value.filter((surgery) =>
    matchesDateFilter(
      surgeryCompletedAtIso(surgery),
      dateFilterMode.value,
      filterDay.value,
      filterMonth.value,
      filterFrom.value,
      filterTo.value,
    ),
  ),
)

const filteredSurgeries = computed(() => dateFilteredSurgeries.value)

const surgeonOptions = computed(() => {
  const map = new Map<string, string>()
  for (const surgery of filteredSurgeries.value) {
    map.set(
      surgery.surgeon.id,
      fullName(surgery.surgeon.firstName, surgery.surgeon.lastName),
    )
  }
  return [...map.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
})

const doctorFilteredSurgeries = computed(() => {
  if (!filterSurgeonId.value) return filteredSurgeries.value
  return filteredSurgeries.value.filter((surgery) => surgery.surgeon.id === filterSurgeonId.value)
})

const displayedSurgeries = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  const base = doctorFilteredSurgeries.value
  if (!q) return base

  return base.filter((surgery) => {
    const patientName = fullName(surgery.visit.patient.firstName, surgery.visit.patient.lastName).toLowerCase()
    const surgeonName = fullName(surgery.surgeon.firstName, surgery.surgeon.lastName).toLowerCase()
    return (
      patientName.includes(q) ||
      surgery.visit.patient.code.toLowerCase().includes(q) ||
      surgery.interventionType.label.toLowerCase().includes(q) ||
      surgeonName.includes(q)
    )
  })
})

const hasSurgeriesOutsidePeriod = computed(
  () =>
    surgeries.value.length > 0 &&
    dateFilteredSurgeries.value.length === 0 &&
    !searchQuery.value.trim() &&
    !filterSurgeonId.value,
)

const postponeTarget = computed(() =>
  surgeries.value.find((s) => s.id === postponeTargetId.value) ?? null,
)

const payTarget = computed(() =>
  surgeries.value.find((s) => s.id === payTargetId.value) ?? null,
)

const payTargetUnpaidShares = computed(() => {
  if (!payTarget.value) return [] as OperationShareKind[]
  return getUnpaidShareKinds(payTarget.value)
})

const payTargetTotal = computed(() => {
  if (!payTarget.value) return 0
  return selectedShares.value.reduce(
    (sum, kind) => sum + getShareAmountFcfa(payTarget.value!, kind),
    0,
  )
})

const periodLabel = computed(() =>
  formatPeriodLabel(
    dateFilterMode.value,
    filterDay.value,
    filterMonth.value,
    filterFrom.value,
    filterTo.value,
  ),
)

function shareUnpaidAmount(kind: OperationShareKind) {
  return doctorFilteredSurgeries.value.reduce((sum, surgery) => {
    if (isSharePaid(surgery, kind)) return sum
    return sum + getShareAmountFcfa(surgery, kind)
  }, 0)
}

function shareUnpaidCount(kind: OperationShareKind) {
  return doctorFilteredSurgeries.value.filter((surgery) => !isSharePaid(surgery, kind)).length
}

const stats = computed(() => {
  const rows = doctorFilteredSurgeries.value.map((surgery) => computeOperationShares(surgery))
  const withAssistant = rows.filter((row) => row.hasAssistant)

  return {
    count: rows.length,
    totalFcfa: rows.reduce((sum, row) => sum + row.totalFcfa, 0),
    surgeonShareFcfa: rows.reduce((sum, row) => sum + row.surgeonShareFcfa, 0),
    surgeonShareUnpaidFcfa: shareUnpaidAmount('surgeon'),
    unpaidSurgeonCount: shareUnpaidCount('surgeon'),
    assistantShareFcfa: rows.reduce((sum, row) => sum + row.assistantShareFcfa, 0),
    assistantShareUnpaidFcfa: shareUnpaidAmount('assistant'),
    unpaidAssistantCount: shareUnpaidCount('assistant'),
    clinicShareFcfa: rows.reduce((sum, row) => sum + row.clinicShareFcfa, 0),
    clinicShareUnpaidFcfa: shareUnpaidAmount('clinic'),
    unpaidClinicCount: shareUnpaidCount('clinic'),
    assistantCount: withAssistant.length,
    unpaidShareCount: countUnpaidShares(doctorFilteredSurgeries.value),
    unpaidShareTotalFcfa: sumUnpaidShareAmounts(doctorFilteredSurgeries.value),
  }
})

const batchPaySurgeryIds = computed(() =>
  doctorFilteredSurgeries.value
    .filter((surgery) => getUnpaidShareKinds(surgery).length > 0)
    .map((surgery) => surgery.id),
)

async function load() {
  loading.value = true
  message.value = ''
  try {
    const { data } = await api.get<SurgeryCaseRow[]>('/surgeries', {
      params: { scope: 'completed' },
    })
    surgeries.value = data
  } catch (error) {
    const apiMessage = isAxiosError(error)
      ? (error.response?.data as { error?: string } | undefined)?.error
      : undefined
    message.value = apiMessage ?? 'Impossible de charger les opérations effectuées.'
    messageType.value = 'error'
    surgeries.value = []
  } finally {
    loading.value = false
  }
}

function openPayModal(id: string) {
  const surgery = surgeries.value.find((row) => row.id === id)
  if (!surgery) return

  payTargetId.value = id
  selectedShares.value = getUnpaidShareKinds(surgery)
  payModalOpen.value = true
}

function closePayModal() {
  payModalOpen.value = false
  payTargetId.value = null
  selectedShares.value = []
}

function toggleShare(kind: OperationShareKind) {
  if (selectedShares.value.includes(kind)) {
    selectedShares.value = selectedShares.value.filter((value) => value !== kind)
    return
  }
  selectedShares.value = [...selectedShares.value, kind]
}

async function confirmPayShares() {
  const id = payTargetId.value
  if (!id || !selectedShares.value.length) {
    message.value = 'Sélectionnez au moins une part à régler.'
    messageType.value = 'error'
    return
  }

  actionId.value = id
  message.value = ''
  try {
    await api.post(`/surgeries/${id}/pay-shares`, { shares: selectedShares.value })
    message.value = 'Paiement enregistré.'
    messageType.value = 'success'
    closePayModal()
    await load()
  } catch (error) {
    const apiMessage = isAxiosError(error)
      ? (error.response?.data as { error?: string } | undefined)?.error
      : undefined
    message.value = apiMessage ?? 'Erreur lors du paiement.'
    messageType.value = 'error'
  } finally {
    actionId.value = null
  }
}

async function payAllSharesForPeriod() {
  const ids = batchPaySurgeryIds.value
  if (!ids.length) return

  const confirmed = await confirmAppModal({
    type: 'CONFIRM',
    title: 'Régler toutes les parts',
    message: `Régler toutes les parts restantes pour la période ? ${stats.value.unpaidShareCount} part(s) — ${formatFcfa(stats.value.unpaidShareTotalFcfa)}`,
    confirmLabel: 'Régler',
  })
  if (!confirmed) return

  batchPaying.value = true
  message.value = ''
  try {
    const { data } = await api.post<{ count: number }>('/surgeries/pay-shares-batch', {
      surgeryIds: ids,
    })
    message.value = `${data.count} paiement(s) enregistré(s).`
    messageType.value = 'success'
    await load()
  } catch (error) {
    const apiMessage = isAxiosError(error)
      ? (error.response?.data as { error?: string } | undefined)?.error
      : undefined
    message.value = apiMessage ?? 'Erreur lors du règlement groupé.'
    messageType.value = 'error'
  } finally {
    batchPaying.value = false
  }
}

async function revertToAwaiting(id: string) {
  const surgery = surgeries.value.find((row) => row.id === id)
  if (surgery && hasAnySharePaid(surgery)) {
    message.value = 'Impossible : un règlement a déjà été enregistré sur cette opération.'
    messageType.value = 'error'
    return
  }

  const confirmed = await confirmAppModal({
    type: 'WARNING',
    title: 'Renvoyer en attente',
    message: 'Renvoyer cette opération en attente ? À utiliser si l\'intervention a été annulée ou n\'a finalement pas eu lieu.',
    confirmLabel: 'Renvoyer',
  })
  if (!confirmed) return

  actionId.value = id
  message.value = ''
  try {
    await api.post(`/surgeries/${id}/revert`)
    message.value = 'Opération renvoyée dans Opérations en attente.'
    messageType.value = 'success'
    await load()
  } catch (error) {
    const apiMessage = isAxiosError(error)
      ? (error.response?.data as { error?: string } | undefined)?.error
      : undefined
    message.value = apiMessage ?? 'Erreur lors du retour en attente.'
    messageType.value = 'error'
  } finally {
    actionId.value = null
  }
}

function openPostponeModal(id: string) {
  const surgery = surgeries.value.find((row) => row.id === id)
  if (surgery && hasAnySharePaid(surgery)) {
    message.value = 'Impossible : un règlement a déjà été enregistré sur cette opération.'
    messageType.value = 'error'
    return
  }

  postponeTargetId.value = id
  postponeDate.value = todayDateInputValue()
  postponeModalOpen.value = true
}

function closePostponeModal() {
  postponeModalOpen.value = false
  postponeTargetId.value = null
}

async function confirmPostpone() {
  const id = postponeTargetId.value
  if (!id || !postponeDate.value) {
    message.value = 'Choisissez une nouvelle date.'
    messageType.value = 'error'
    return
  }

  actionId.value = id
  message.value = ''
  try {
    await api.post(`/surgeries/${id}/revert`, { operationDate: postponeDate.value })
    message.value = `Opération reportée au ${formatSurgeryDate(postponeDate.value)} — visible dans Opérations en attente.`
    messageType.value = 'success'
    closePostponeModal()
    await load()
  } catch (error) {
    const apiMessage = isAxiosError(error)
      ? (error.response?.data as { error?: string } | undefined)?.error
      : undefined
    message.value = apiMessage ?? 'Erreur lors du report.'
    messageType.value = 'error'
  } finally {
    actionId.value = null
  }
}

function setToday() {
  filterDay.value = todayDateKey()
}

function setYesterday() {
  filterDay.value = yesterdayDateKey()
}

function resetCustomRange() {
  filterFrom.value = ''
  filterTo.value = ''
}

onMounted(load)
</script>

<template>
  <div class="page-with-table ops-completed-page">
    <section class="page-with-table__head">
      <UiPageHeader
        title="Opérations effectuées"
        subtitle="Compte rendu journalier — répartition médecin, assistant chirurgie et clinique"
        :icon="CheckCircle2"
      />
      <UiAlert v-if="message && !postponeModalOpen && !payModalOpen" :type="messageType" :message="message" />

      <div class="stats-grid">
        <UiStatCard
          mini
          label="Montant total"
          :value="formatFcfa(stats.totalFcfa)"
          :icon="CircleDollarSign"
          variant="teal"
        />
        <UiStatCard
          mini
          label="Part médecin"
          :value="formatFcfa(stats.surgeonShareFcfa)"
          :icon="Stethoscope"
          variant="blue"
        />
        <UiStatCard
          mini
          label="Part assistant"
          :value="formatFcfa(stats.assistantShareFcfa)"
          :icon="HeartHandshake"
          variant="violet"
        />
        <UiStatCard
          mini
          label="Part clinique"
          :value="formatFcfa(stats.clinicShareFcfa)"
          :icon="Building2"
          variant="green"
        />
      </div>

      <div class="filter-bar" role="region" aria-label="Filtrer par date">
        <div class="filter-bar__row">
          <div class="filter-bar__modes" role="tablist" aria-label="Période">
            <button
              v-for="mode in DATE_MODES"
              :key="mode.id"
              type="button"
              role="tab"
              class="filter-bar__mode"
              :class="{ 'filter-bar__mode--active': dateFilterMode === mode.id }"
              :aria-selected="dateFilterMode === mode.id"
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
              <div class="filter-bar__quick">
                <button type="button" class="filter-bar__chip" @click="setToday">Aujourd'hui</button>
                <button type="button" class="filter-bar__chip" @click="setYesterday">Hier</button>
              </div>
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
              <span class="filter-bar__sep" aria-hidden="true">→</span>
              <label class="filter-bar__field">
                <span class="filter-bar__field-label">Au</span>
                <input v-model="filterTo" type="date" class="filter-bar__input" />
              </label>
              <button type="button" class="filter-bar__chip filter-bar__chip--muted" @click="resetCustomRange">
                Effacer
              </button>
            </template>

            <label class="filter-bar__field">
              <span class="filter-bar__field-label">Médecin</span>
              <select v-model="filterSurgeonId" class="filter-bar__input filter-bar__select">
                <option value="">Tous les médecins</option>
                <option v-for="surgeon in surgeonOptions" :key="surgeon.id" :value="surgeon.id">
                  Dr {{ surgeon.name }}
                </option>
              </select>
            </label>
          </div>
        </div>

        <div class="filter-bar__footer">
          <CalendarRange :size="15" class="filter-bar__footer-icon" />
          <span class="filter-bar__period">{{ periodLabel }}</span>
          <span class="filter-bar__dot" aria-hidden="true">·</span>
          <span class="filter-bar__count">{{ stats.count }} opération(s) sur la période</span>
          <UiButton
            v-if="stats.unpaidShareCount"
            variant="success"
            size="sm"
            :icon="Banknote"
            class="filter-bar__pay-btn"
            :disabled="batchPaying || !!actionId"
            @click="payAllSharesForPeriod"
          >
            {{
              batchPaying
                ? 'Enregistrement…'
                : `Régler les parts (${stats.unpaidShareCount})`
            }}
          </UiButton>
        </div>
      </div>
    </section>

    <section class="page-with-table__body">
      <UiCard
        title="Opérations effectuées"
        description="Paiement direct par part · Repousser ou retour en attente si aucun règlement"
        class="ui-card--table-panel ops-completed-table-card"
        :icon="Scissors"
        icon-variant="green"
      >
        <template #actions>
          <div class="table-search">
            <Search :size="16" class="table-search__icon" />
            <input
              v-model="searchQuery"
              type="search"
              class="table-search__input"
              placeholder="Patient, matricule, intervention…"
              aria-label="Rechercher une opération"
            />
          </div>
          <UiButton variant="ghost" size="sm" :icon="RefreshCw" :disabled="loading" @click="load">
            Actualiser
          </UiButton>
        </template>

        <p v-if="!loading && !displayedSurgeries.length" class="ops-empty">
          {{
            hasSurgeriesOutsidePeriod
              ? `${surgeries.length} opération(s) enregistrée(s) hors de la période — élargissez le filtre (mois ou dates personnalisées).`
              : searchQuery.trim() || filterSurgeonId
                ? 'Aucun résultat pour cette recherche'
                : 'Aucune opération effectuée sur la période sélectionnée'
          }}
        </p>
        <CompletedOperationsDataTable
          v-else
          fill
          :surgeries="displayedSurgeries"
          :loading="loading"
          :busy-id="actionId"
          @revert="revertToAwaiting"
          @postpone="openPostponeModal"
          @pay-shares="openPayModal"
        />
      </UiCard>
    </section>

    <UiFormModal
      v-if="payModalOpen && payTarget"
      title-id="pay-modal-title"
      title="Enregistrer un paiement"
      :subtitle="`${fullName(payTarget.visit.patient.firstName, payTarget.visit.patient.lastName)} — ${payTarget.interventionType.label}`"
      :icon="Banknote"
      @close="closePayModal"
    >
      <UiAlert v-if="message && payModalOpen" :type="messageType" :message="message" />
      <section class="form-panel">
        <p class="form-panel__hint">Sélectionnez les parts réglées directement en fin de journée.</p>
        <div class="pay-modal__options">
          <label
            v-for="kind in payTargetUnpaidShares"
            :key="kind"
            class="pay-modal__option"
          >
            <input
              type="checkbox"
              :checked="selectedShares.includes(kind)"
              @change="toggleShare(kind)"
            />
            <span class="pay-modal__option-label">
              {{ SHARE_KIND_LABELS[kind] }}
              <strong>{{ formatFcfa(getShareAmountFcfa(payTarget, kind)) }}</strong>
            </span>
          </label>
        </div>
        <p class="pay-modal__total">
          Total sélectionné : <strong>{{ formatFcfa(payTargetTotal) }}</strong>
        </p>
      </section>

      <template #footer>
        <UiButton variant="ghost" @click="closePayModal">Annuler</UiButton>
        <UiButton
          variant="success"
          :icon="Banknote"
          :disabled="!!actionId || !selectedShares.length"
          @click="confirmPayShares"
        >
          {{ actionId ? 'Enregistrement…' : 'Confirmer le paiement' }}
        </UiButton>
      </template>
    </UiFormModal>

    <UiFormModal
      v-if="postponeModalOpen && postponeTarget"
      title-id="postpone-modal-title"
      title="Repousser l'opération"
      :subtitle="`${fullName(postponeTarget.visit.patient.firstName, postponeTarget.visit.patient.lastName)} — ${postponeTarget.interventionType.label}`"
      :icon="Calendar"
      @close="closePostponeModal"
    >
      <UiAlert v-if="message && postponeModalOpen" :type="messageType" :message="message" />
      <section class="form-panel">
        <UiInput v-model="postponeDate" type="date" label="Nouvelle date d'opération" required />
      </section>

      <template #footer>
        <UiButton variant="ghost" @click="closePostponeModal">Annuler</UiButton>
        <UiButton variant="primary" :icon="Save" :disabled="!!actionId" @click="confirmPostpone">
          {{ actionId ? 'Enregistrement…' : 'Confirmer le report' }}
        </UiButton>
      </template>
    </UiFormModal>
  </div>
</template>

<style scoped>
.filter-bar {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0.45rem 0.65rem;
  box-shadow: var(--shadow-sm);
  margin-top: 0.35rem;
}

.filter-bar__row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 0.85rem 1.25rem;
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
  gap: 0.65rem 0.85rem;
  flex: 1;
  min-width: min(100%, 14rem);
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

.filter-bar__select {
  cursor: pointer;
}

.filter-bar__quick {
  display: flex;
  gap: 0.4rem;
}

.filter-bar__chip {
  height: 2.25rem;
  padding: 0 0.75rem;
  border: 1px solid var(--primary-200);
  border-radius: 8px;
  background: var(--primary-50);
  color: var(--primary-800);
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
}

.filter-bar__chip--muted {
  background: #f8fafc;
  border-color: var(--border);
  color: var(--text-muted);
}

.filter-bar__sep {
  color: var(--text-light);
}

.filter-bar__footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
  margin-top: 0.75rem;
  padding-top: 0.7rem;
  border-top: 1px dashed var(--border);
  font-size: 0.8125rem;
}

.filter-bar__footer-icon {
  color: var(--primary-600);
}

.filter-bar__period {
  font-weight: 600;
}

.filter-bar__count {
  color: var(--text-muted);
}

.filter-bar__pay-btn {
  margin-left: auto;
}

.table-search {
  position: relative;
  min-width: min(100%, 14rem);
}

.table-search__icon {
  position: absolute;
  left: 0.65rem;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-muted);
  pointer-events: none;
}

.table-search__input {
  width: 100%;
  height: 2.1rem;
  padding: 0 0.75rem 0 2.1rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
  font-size: 0.8125rem;
}

.table-search__input:focus {
  outline: 2px solid var(--accent-200);
  border-color: var(--accent-400);
}

.ops-empty {
  color: var(--text-light);
  font-size: 0.875rem;
  text-align: center;
  padding: 2rem 1rem;
}

.pay-modal__options {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

.pay-modal__option {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  padding: 0.65rem 0.75rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
  cursor: pointer;
}

.pay-modal__option-label {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  width: 100%;
  font-size: 0.875rem;
}

.pay-modal__total {
  margin: 0.85rem 0 0;
  font-size: 0.875rem;
  color: var(--text-muted);
}

</style>
