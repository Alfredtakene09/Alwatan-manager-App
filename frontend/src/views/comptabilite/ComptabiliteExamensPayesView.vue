<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { CheckCircle2, FlaskConical } from '@lucide/vue'
import api from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { useAppI18n } from '@/i18n/useAppI18n'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import LabExamsPendingDataTable, {
  type LabExamPendingRow,
} from '@/components/ui/LabExamsPendingDataTable.vue'
import ExamReclamationModal from '@/components/comptabilite/ExamReclamationModal.vue'
import ExamPaidDetailModal from '@/components/comptabilite/ExamPaidDetailModal.vue'
import ExamensPayesSubnav from '@/components/comptabilite/ExamensPayesSubnav.vue'
import { normalizeLabExamPendingItem, type LabExamPendingItem } from '@/lib/lab-exam-pending'
import { printAllPendingLabExamInvoices } from '@/lib/lab-exam-invoice'
import { emptyExamReductionsByKind } from '@/lib/exam-billing'
import type { ExamKindSlug } from '@/lib/exam-catalog/types'

const auth = useAuthStore()
const { t, uiText } = useAppI18n()

const paidItems = ref<LabExamPendingItem[]>([])
const loading = ref(false)
const message = ref('')
const messageType = ref<'success' | 'error'>('success')
const reclamationItem = ref<LabExamPendingItem | null>(null)
const reclamationOpen = ref(false)
const detailItem = ref<LabExamPendingItem | null>(null)
const detailOpen = ref(false)

const printableIds = computed(() => {
  const ids = new Set<string>()
  for (const item of paidItems.value) {
    const kinds = resolvePaidKinds(item)
    if (kinds.length) ids.add(item.id)
  }
  return ids
})

function resolvePaidKinds(item: LabExamPendingItem): ExamKindSlug[] {
  if (item.paidKinds?.length) return item.paidKinds
  const fromInvoices = Object.entries(item.invoicesByKind ?? {})
    .filter(([, inv]) => inv && (inv.paidFcfa ?? inv.netFcfa) > 0)
    .map(([kind]) => kind as ExamKindSlug)
  if (fromInvoices.length) return fromInvoices
  return Object.keys(item.invoicesByKind ?? {}) as ExamKindSlug[]
}

function resolvePrintStatus(item: LabExamPendingItem): string {
  const remaining =
    item.remainingFcfa ??
    Object.values(item.invoicesByKind ?? {}).reduce(
      (sum, inv) => sum + Math.max(0, inv?.remainingFcfa ?? 0),
      0,
    )
  if (remaining > 0) return 'Payé partiellement'
  return 'Payé'
}

async function load() {
  loading.value = true
  try {
    const { data } = await api.get<LabExamPendingItem[]>('/comptabilite/paid-exams')
    paidItems.value = data
  } catch {
    message.value = uiText('Impossible de charger la liste des examens payés.')
    messageType.value = 'error'
    paidItems.value = []
  } finally {
    loading.value = false
  }
}

function onPrint(id: string) {
  const item = paidItems.value.find((row) => row.id === id)
  if (!item) return

  const kinds = resolvePaidKinds(item)
  if (!kinds.length) {
    message.value = uiText('Aucune facture payée à imprimer pour ce dossier.')
    messageType.value = 'error'
    return
  }

  const normalized = normalizeLabExamPendingItem({
    ...item,
    cashierName:
      item.cashierName ??
      (auth.user ? `${auth.user.firstName} ${auth.user.lastName}`.trim() : undefined),
  })

  const printed = printAllPendingLabExamInvoices(
    normalized,
    item.reductionsByKind ?? emptyExamReductionsByKind(),
    resolvePrintStatus(item),
    item.invoicesByKind,
    kinds,
  )

  if (!printed) {
    message.value = uiText("Impossible de générer le reçu : données d'examen manquantes.")
    messageType.value = 'error'
  }
}

function openReclamation(id: string) {
  reclamationItem.value = paidItems.value.find((row) => row.id === id) ?? null
  reclamationOpen.value = !!reclamationItem.value
}

function openDetail(id: string) {
  detailItem.value = paidItems.value.find((row) => row.id === id) ?? null
  detailOpen.value = !!detailItem.value
}

function closeReclamation() {
  reclamationOpen.value = false
  reclamationItem.value = null
}

function closeDetail() {
  detailOpen.value = false
  detailItem.value = null
}

function onReclamationSubmitted() {
  message.value = uiText(
    'Remboursement appliqué : les montants ont été déduits et les examens retirés du dossier payé.',
  )
  messageType.value = 'success'
  void load()
}

onMounted(load)
</script>

<template>
  <div class="page-with-table">
    <section class="page-with-table__head">
      <UiPageHeader
        title="Examens payés"
        subtitle="Patients ayant réglé leurs examens — réimpression des factures par type (laboratoire, radio, écho, odonto)"
        :icon="CheckCircle2"
      />

      <UiAlert v-if="message" :type="messageType" :message="message" />

      <ExamensPayesSubnav />
    </section>

    <section class="page-with-table__body">
      <UiCard direct title="Examens payés"
        description="Laboratoire, radiologie, échographie et odontologie"
        class="ui-card--table-panel"
        :icon="FlaskConical"
        icon-variant="green"
      >
        <template #actions>
          <UiButton variant="ghost" size="sm" :disabled="loading" @click="load">
            {{ t('common.refresh') }}
          </UiButton>
        </template>

        <p v-if="!loading && !paidItems.length" class="empty">
          {{ uiText('Aucun examen payé pour le moment') }}
        </p>
        <LabExamsPendingDataTable
          v-else
          fill
          mode="paid"
          :items="paidItems as LabExamPendingRow[]"
          :loading="loading"
          :printable-ids="printableIds"
          @print="onPrint"
          @reclaim="openReclamation"
          @view="openDetail"
        />
      </UiCard>
    </section>

    <ExamPaidDetailModal
      v-model:open="detailOpen"
      :item="detailItem"
      @close="closeDetail"
    />

    <ExamReclamationModal
      v-model:open="reclamationOpen"
      :item="reclamationItem"
      @close="closeReclamation"
      @submitted="onReclamationSubmitted"
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
