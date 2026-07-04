<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Clock, FlaskConical } from '@lucide/vue'
import api from '@/api/client'
import { showApiErrorModal } from '@/lib/api-modal-helper'
import { useComptabiliteQueue } from '@/composables/useComptabiliteQueue'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import LabExamsPendingDataTable, {
  type LabExamPendingRow,
} from '@/components/ui/LabExamsPendingDataTable.vue'
import LabExamPaymentModal, {
  type LabExamPaymentConfirmPayload,
  type LabExamPaymentItem,
} from '@/components/comptabilite/LabExamPaymentModal.vue'
import { EXAM_KIND_LABELS, type ExamKindSlug } from '@/lib/exam-catalog/types'
import { remainingPayableExamKinds } from '@/lib/exam-billing'
import { initLabExamReductionsByKind, normalizeLabExamPendingItem } from '@/lib/lab-exam-pending'
import { printLabExamPaymentReceipts, printPendingLabExamInvoices } from '@/lib/lab-exam-invoice'
import ComptabiliteStatsGrid from '@/components/comptabilite/ComptabiliteStatsGrid.vue'
import { isAxiosError } from 'axios'

const { data, message, messageType, loading, load } = useComptabiliteQueue()
const router = useRouter()
const selectedId = ref<string | null>(null)
const submitting = ref(false)
const submittingKind = ref<ExamKindSlug | null>(null)
const statsRefreshKey = ref(0)

const pendingItems = computed<LabExamPendingRow[]>(() => data.value?.labExamsPending ?? [])

const selectedItem = computed<LabExamPaymentItem | null>(() => {
  if (!selectedId.value) return null
  return pendingItems.value.find((item) => item.id === selectedId.value) ?? null
})

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
    const invoiceCount = Object.keys(res.invoicesByKind ?? {}).length
    const invoiceLabel =
      invoiceCount === 1 && res.invoicesByKind
        ? ` — facture ${Object.values(res.invoicesByKind)[0]?.invoiceNumber}`
        : invoiceCount > 1
          ? ` — ${invoiceCount} facture(s)`
          : ''
    const followUpNotes: string[] = []
    if (res.surgeryAuthorized) followUpNotes.push('Opération ajoutée aux opérations en attente')
    if (res.hasLabTransfer) followUpNotes.push('Transféré au laboratoire')
    const followUp = followUpNotes.length ? ` ${followUpNotes.join('. ')}.` : ''
    const kindLabel = payingAll
      ? 'Tous les examens'
      : payload.kinds[0]
        ? EXAM_KIND_LABELS[payload.kinds[0]]
        : 'Examen'
    message.value = `${kindLabel} encaissé${invoiceLabel}.${followUp}`
    messageType.value = 'success'
    statsRefreshKey.value += 1
    await load()
    if (!shouldClose) {
      submittingKind.value = null
    }
  } catch (error: unknown) {
    const shown = await showApiErrorModal(error, 'Erreur lors du paiement.')
    if (!shown) {
      const apiMessage = isAxiosError(error)
        ? (error.response?.data as { error?: string } | undefined)?.error
        : undefined
      message.value = apiMessage ?? 'Erreur lors du paiement.'
      messageType.value = 'error'
    }
    submittingKind.value = null
  } finally {
    submitting.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="page-with-table">
    <section class="page-with-table__head">
      <UiPageHeader
        title="En attente de paiement"
        subtitle="Encaissez chaque type d'examen séparément — labo, opération, radio…"
        :icon="Clock"
      />

      <UiAlert v-if="message" :type="messageType" :message="message" />

      <ComptabiliteStatsGrid :refresh-key="statsRefreshKey" />
    </section>

    <section class="page-with-table__body">
      <UiCard
        title="En attente de paiement"
        description="Les types déjà payés disparaissent et suivent leur parcours (labo, opérations…)"
        class="ui-card--table-panel"
        :icon="FlaskConical"
        icon-variant="amber"
      >
        <template #actions>
          <UiButton variant="ghost" size="sm" :disabled="loading" @click="load">
            Actualiser
          </UiButton>
        </template>

        <p v-if="!loading && !pendingItems.length" class="empty">
          Aucune prescription en attente de paiement
        </p>
        <LabExamsPendingDataTable
          v-else
          fill
          :items="pendingItems"
          :loading="loading"
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
.empty {
  text-align: center;
  color: var(--text-light);
  padding: 2rem 1rem;
  font-size: 0.875rem;
}
</style>
