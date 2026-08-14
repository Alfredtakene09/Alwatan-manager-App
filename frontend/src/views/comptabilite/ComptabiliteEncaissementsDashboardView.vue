<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  LayoutDashboard,
  Clock,
  Banknote,
  Layers,
  FlaskConical,
  Stethoscope,
  History,
} from '@lucide/vue'
import { isAxiosError } from 'axios'
import api from '@/api/client'
import { showApiErrorModal } from '@/lib/api-modal-helper'
import { formatFcfa } from '@/lib/roles'
import { useComptabiliteQueue } from '@/composables/useComptabiliteQueue'
import UiCard from '@/components/ui/UiCard.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import RoleDashboardShell from '@/components/dashboard/RoleDashboardShell.vue'
import EncaissementsOverviewCharts from '@/components/comptabilite/EncaissementsOverviewCharts.vue'
import ConsultationsComptabilitePanel from '@/components/comptabilite/ConsultationsComptabilitePanel.vue'
import EncaissementsComptabilitePanel from '@/components/comptabilite/EncaissementsComptabilitePanel.vue'
import LabExamsPendingDataTable, { type LabExamPendingRow } from '@/components/ui/LabExamsPendingDataTable.vue'
import LabExamPaymentModal, {
  type LabExamPaymentConfirmPayload,
  type LabExamPaymentItem,
} from '@/components/comptabilite/LabExamPaymentModal.vue'
import { EXAM_KIND_LABELS, type ExamKindSlug } from '@/lib/exam-catalog/types'
import { remainingPayableExamKinds } from '@/lib/exam-billing'
import { normalizeLabExamPendingItem } from '@/lib/lab-exam-pending'
import { printLabExamPaymentReceipts, printPendingLabExamInvoices } from '@/lib/lab-exam-invoice'
import type { SummaryStat } from '@/lib/dashboard-summary'
import type { ComptabiliteStats } from '@/components/comptabilite/ComptabiliteStatsGrid.vue'

type TabId = 'suivi' | 'attente' | 'historique'

const route = useRoute()
const router = useRouter()

function tabFromQuery(): TabId {
  const tab = String(route.query.tab ?? '')
  if (tab === 'attente' || tab === 'consultations' || tab === 'examens') return 'attente'
  if (tab === 'historique' || tab === 'encaissements') return 'historique'
  return 'suivi'
}

const activeTab = ref<TabId>(tabFromQuery())

watch(
  () => route.query.tab,
  () => {
    activeTab.value = tabFromQuery()
  },
)

function setTab(tab: TabId) {
  activeTab.value = tab
  void router.replace({ query: { ...route.query, tab } })
}

const tabs: { id: TabId; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'suivi', label: 'Vue d’ensemble', icon: LayoutDashboard },
  { id: 'attente', label: 'À encaisser', icon: Clock },
  { id: 'historique', label: 'Historique', icon: History },
]

const stats = ref<ComptabiliteStats | null>(null)
const loading = ref(false)
const loadError = ref('')

const { data: queueData, message, messageType, loading: queueLoading, load: loadQueue } = useComptabiliteQueue()
const selectedId = ref<string | null>(null)
const submitting = ref(false)
const submittingKind = ref<ExamKindSlug | null>(null)
const consultationsRefreshKey = ref(0)

const pendingItems = computed<LabExamPendingRow[]>(() => queueData.value?.labExamsPending ?? [])

const selectedItem = computed<LabExamPaymentItem | null>(() => {
  if (!selectedId.value) return null
  return pendingItems.value.find((item) => item.id === selectedId.value) ?? null
})

const summaryStats = computed((): SummaryStat[] => {
  if (!stats.value) return []
  const s = stats.value
  const weekTotal = (s.revenueLast7Days ?? []).reduce((sum, day) => sum + day.totalFcfa, 0)
  const pendingTotal =
    (s.consultationsPendingCount ?? 0) +
    s.labPendingCount +
    s.surgeriesPending +
    s.hospitalizationsPending

  return [
    {
      id: 'total-today',
      label: "Encaissé aujourd'hui",
      value: formatFcfa(s.collectedTodayTotalFcfa ?? 0),
      icon: Banknote,
      variant: 'teal',
      trend: `${s.consultationsTodayCount + s.labPaidTodayCount + (s.surgeryPaidTodayCount ?? 0) + (s.hospitalizationPaidTodayCount ?? 0)} règlement(s)`,
    },
    {
      id: 'consult-pending',
      label: 'Consultations à encaisser',
      value: s.consultationsPendingCount ?? 0,
      icon: Stethoscope,
      variant: 'blue',
      trend: formatFcfa(s.consultationsPendingFcfa ?? 0),
    },
    {
      id: 'lab-pending',
      label: 'Examens / actes à encaisser',
      value: s.labPendingCount,
      icon: FlaskConical,
      variant: 'amber',
      trend: formatFcfa(s.labPendingGrossFcfa),
    },
    {
      id: 'pending-total',
      label: 'Files en attente',
      value: pendingTotal,
      icon: Layers,
      variant: 'violet',
      trend: `7 j : ${formatFcfa(weekTotal)}`,
    },
  ]
})

async function loadStats() {
  loading.value = true
  loadError.value = ''
  try {
    const { data } = await api.get<ComptabiliteStats>('/comptabilite/stats')
    stats.value = data
  } catch {
    loadError.value = 'Impossible de charger la synthèse des encaissements.'
    stats.value = null
  } finally {
    loading.value = false
  }
}

async function refreshAll() {
  consultationsRefreshKey.value += 1
  await Promise.all([loadStats(), loadQueue()])
}

function openPay(id: string) {
  selectedId.value = id
}

function closePayment() {
  selectedId.value = null
  submittingKind.value = null
}

function onPrint(id: string) {
  const item = pendingItems.value.find((row) => row.id === id)
  if (item) {
    printPendingLabExamInvoices(normalizeLabExamPendingItem(item))
  }
}

async function goToHospitalization(visitId: string) {
  try {
    await api.post('/hospitalisation/actions', { action: 'ensure_referral', visitId })
  } catch {
    /* ignore */
  }
  await router.push({ path: '/hospitalisation', query: { tab: 'queue', visitId } })
}

async function confirmPayment(payload: LabExamPaymentConfirmPayload) {
  const paidItem = pendingItems.value.find((row) => row.id === payload.consultationId)
  const normalizedPaid = paidItem ? normalizeLabExamPendingItem(paidItem) : null
  const payingAll = payload.kinds.length > 1
  submitting.value = true
  submittingKind.value = payingAll ? null : (payload.kinds[0] ?? null)
  message.value = ''
  try {
    const { data: res } = await api.post('/comptabilite', {
      action: 'pay_lab_exams',
      consultationId: payload.consultationId,
      kinds: payload.kinds,
      reductionsByKind: payload.reductionsByKind,
      reductionFcfa: payload.reductionFcfa,
      installmentAmountFcfa: payload.installmentAmountFcfa,
      installmentsByKind: payload.installmentsByKind,
    })
    const shouldClose =
      res.allKindsPaid ||
      remainingPayableExamKinds((res.remainingUnpaidKinds ?? []) as ExamKindSlug[]).length === 0
    if (shouldClose) closePayment()
    if (normalizedPaid) {
      printLabExamPaymentReceipts(
        normalizedPaid,
        {
          kinds: payload.kinds,
          reductionsByKind: payload.reductionsByKind,
        },
        res.invoicesByKind,
      )
    }
    const kindLabel = payingAll ? 'Tous les examens' : EXAM_KIND_LABELS[payload.kinds[0] ?? 'examen']
    message.value = `${kindLabel} encaissé.`
    messageType.value = 'success'
    await refreshAll()
    if (!shouldClose) submittingKind.value = null
  } catch (error) {
    await showApiErrorModal(error, 'Erreur lors du paiement.')
    message.value = isAxiosError(error)
      ? ((error.response?.data as { error?: string } | undefined)?.error ?? 'Erreur lors du paiement.')
      : 'Erreur lors du paiement.'
    messageType.value = 'error'
    submittingKind.value = null
  } finally {
    submitting.value = false
  }
}

onMounted(refreshAll)
</script>

<template>
  <div class="encaissements-page">
    <div class="encaissements-tabs" role="tablist" aria-label="Encaissements">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        type="button"
        role="tab"
        class="encaissements-tabs__btn"
        :class="{ 'encaissements-tabs__btn--active': activeTab === tab.id }"
        :aria-selected="activeTab === tab.id"
        @click="setTab(tab.id)"
      >
        <component :is="tab.icon" :size="16" />
        {{ tab.label }}
      </button>
    </div>

    <div v-if="activeTab === 'suivi'" class="page-with-table">
      <section class="page-with-table__head">
        <RoleDashboardShell
          subtitle="Suivi des encaissements — consultations, examens, opérations et hospitalisation (gestionnaire)"
          :icon="LayoutDashboard"
          :stats="summaryStats"
          :loading="loading"
          :load-error="loadError"
          @refresh="refreshAll"
        >
          <EncaissementsOverviewCharts :stats="stats" :loading="loading" />
        </RoleDashboardShell>
      </section>
    </div>

    <div v-else-if="activeTab === 'attente'" class="encaissements-attente">
      <UiAlert v-if="message" :type="messageType" :message="message" />

      <ConsultationsComptabilitePanel
        :key="`consult-${consultationsRefreshKey}`"
        title="Consultations à encaisser"
        subtitle="Patients enregistrés à la réception — règlement par le gestionnaire"
        :icon="Stethoscope"
        table-key="encaissements-consultations-attente"
        card-title="File consultations"
      />

      <UiCard
        direct
        title="Examens, radiologie, échographie, opérations"
        description="Prescriptions médecin / patient externe — encaisser puis envoyer au service"
        class="ui-card--table-panel"
        :icon="FlaskConical"
        icon-variant="amber"
      >
        <template #actions>
          <UiButton variant="ghost" size="sm" :disabled="queueLoading" @click="loadQueue">
            Actualiser
          </UiButton>
        </template>

        <p v-if="!queueLoading && !pendingItems.length" class="empty">
          Aucune prescription en attente de paiement
        </p>
        <LabExamsPendingDataTable
          v-else
          fill
          :items="pendingItems"
          :loading="queueLoading"
          @pay="openPay"
          @print="onPrint"
          @hospitalize="goToHospitalization"
        />
      </UiCard>
    </div>

    <div v-else class="encaissements-historique">
      <EncaissementsComptabilitePanel
        title="Historique des encaissements"
        subtitle="Tous les règlements enregistrés — consultations, examens, chirurgie et hospitalisation"
        table-key="encaissements-historique"
      />
    </div>

    <LabExamPaymentModal
      :item="selectedItem"
      :submitting="submitting"
      :submitting-kind="submittingKind"
      @close="closePayment"
      @confirm="confirmPayment"
    />
  </div>
</template>

<style scoped>
@import '@/styles/dashboard-charts.css';

.encaissements-page {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.encaissements-tabs {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  padding: 0.25rem;
  background: #f1f5f9;
  border: 1px solid var(--border);
  border-radius: 10px;
  width: fit-content;
}

.encaissements-tabs__btn {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.45rem 0.85rem;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-muted);
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;
}

.encaissements-tabs__btn--active {
  background: #fff;
  color: var(--primary-800);
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08);
}

.encaissements-attente,
.encaissements-historique {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.empty {
  margin: 0;
  text-align: center;
  color: var(--text-muted);
  padding: 2rem 1rem;
  font-size: 0.9375rem;
}
</style>
