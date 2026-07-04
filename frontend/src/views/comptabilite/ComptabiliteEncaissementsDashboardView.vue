<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { LayoutDashboard, Clock, Banknote, TrendingUp, Layers, FlaskConical } from '@lucide/vue'
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

const stats = ref<ComptabiliteStats | null>(null)
const loading = ref(false)
const loadError = ref('')

const { data: queueData, message, messageType, loading: queueLoading, load: loadQueue } = useComptabiliteQueue()
const router = useRouter()
const selectedId = ref<string | null>(null)
const submitting = ref(false)
const submittingKind = ref<ExamKindSlug | null>(null)

const pendingItems = computed<LabExamPendingRow[]>(() => queueData.value?.labExamsPending ?? [])

const selectedItem = computed<LabExamPaymentItem | null>(() => {
  if (!selectedId.value) return null
  return pendingItems.value.find((item) => item.id === selectedId.value) ?? null
})

const summaryStats = computed((): SummaryStat[] => {
  if (!stats.value) return []
  const s = stats.value
  const weekTotal = (s.revenueLast7Days ?? []).reduce((sum, day) => sum + day.totalFcfa, 0)
  const pendingTotal = s.labPendingCount + s.surgeriesPending + s.hospitalizationsPending

  return [
    {
      id: 'total-today',
      label: "Encaissé aujourd'hui",
      value: formatFcfa(s.collectedTodayTotalFcfa ?? 0),
      icon: Banknote,
      variant: 'teal',
      trend: `${s.consultationsTodayCount + s.labPaidTodayCount + (s.surgeryPaidTodayCount ?? 0) + (s.hospitalizationPaidTodayCount ?? 0)} encaissement(s)`,
    },
    {
      id: 'lab-pending',
      label: 'Examens en attente',
      value: s.labPendingCount,
      icon: Clock,
      variant: 'amber',
      trend: formatFcfa(s.labPendingGrossFcfa),
    },
    {
      id: 'week-total',
      label: 'Total 7 derniers jours',
      value: formatFcfa(weekTotal),
      icon: TrendingUp,
      variant: 'green',
      trend: `~${formatFcfa(Math.round(weekTotal / 7))} / jour`,
    },
    {
      id: 'pending-total',
      label: 'Dossiers en attente',
      value: pendingTotal,
      icon: Layers,
      variant: 'blue',
      trend: 'Examens, bloc, hospitalisation',
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
    /* le GET hospitalisation resynchronisera si besoin */
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
    if (!shouldClose) {
      submittingKind.value = null
    }
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
  <div class="page-with-table">
    <section class="page-with-table__head">
      <RoleDashboardShell
        subtitle="Performance des encaissements et suivi des files d'attente"
        :icon="LayoutDashboard"
        :stats="summaryStats"
        :loading="loading"
        :load-error="loadError"
        @refresh="refreshAll"
      >
        <EncaissementsOverviewCharts :stats="stats" :loading="loading" />
      </RoleDashboardShell>

      <UiAlert v-if="message" :type="messageType" :message="message" />
    </section>

    <section class="page-with-table__body">
      <UiCard
        title="Patients en attente de paiement"
        description="Liste des patients — examens, radiologie et échographie"
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
    </section>

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

.empty {
  margin: 0;
  text-align: center;
  color: var(--text-muted);
  padding: 2rem 1rem;
  font-size: 0.9375rem;
}
</style>
