<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { CheckCircle2, FlaskConical } from '@lucide/vue'
import api from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { useAppI18n } from '@/i18n/useAppI18n'
import { confirmAppModal, showApiErrorModal } from '@/lib/api-modal-helper'
import { formatFcfa, fullName } from '@/lib/roles'
import { translateTemplate } from '@/lib/dashboard-i18n'
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
import { activeExamKindsFromBlocks, normalizeLabExamPendingItem, type LabExamLine, type LabExamPendingItem } from '@/lib/lab-exam-pending'
import { printAllPendingLabExamInvoices } from '@/lib/lab-exam-invoice'
import { emptyExamReductionsByKind, emptyExamsByKindBlocks } from '@/lib/exam-billing'
import { LAB_BILLABLE_EXAM_KINDS, EXAM_KIND_LABELS, type ExamKindSlug } from '@/lib/exam-catalog/types'
import { todayDateKey, toLocalDateKey } from '@/lib/date-filters'
import { cancelPrintWindow, ensurePrintWindow } from '@/lib/print-document'
import ExportButtons from '@/components/ui/ExportButtons.vue'
import { exportTableExcel, exportTablePdf, exportTableWord } from '@/lib/table-export'
import {
  labExamListExportColumns,
  toLabExamListExportRows,
} from '@/lib/lab-exam-pending-export'

const auth = useAuthStore()
const { t, uiText, isArabic } = useAppI18n()
const canDeletePaid = computed(() => auth.user?.role === 'ADMIN')
const deletingPaid = ref(false)

const paidItems = ref<LabExamPendingItem[]>([])
const listFrom = ref(todayDateKey())
const listTo = ref(todayDateKey())
const kindFilter = ref<'' | ExamKindSlug>('')
const kindOptions = LAB_BILLABLE_EXAM_KINDS
const loading = ref(false)
const message = ref('')
const messageType = ref<'success' | 'error'>('success')
const reclamationItem = ref<LabExamPendingItem | null>(null)
const reclamationOpen = ref(false)
const detailItem = ref<LabExamPendingItem | null>(null)
const detailOpen = ref(false)

function paidKindsOf(item: LabExamPendingItem): ExamKindSlug[] {
  const withoutOperation = (kinds: ExamKindSlug[]) =>
    kinds.filter((kind) => kind !== 'operation')
  if (item.paidKinds?.length) return withoutOperation(item.paidKinds)
  const fromInvoices = Object.entries(item.invoicesByKind ?? {})
    .filter(([, inv]) => (inv?.paidFcfa ?? inv?.netFcfa ?? 0) > 0)
    .map(([kind]) => kind as ExamKindSlug)
  if (fromInvoices.length) return withoutOperation(fromInvoices)
  return withoutOperation(activeExamKindsFromBlocks(item.allExamsByKind ?? item.examsByKind))
}

function paidDateKey(item: LabExamPendingItem, kind: ExamKindSlug): string | null {
  const raw = item.paidAtByKind?.[kind] ?? item.paidAt
  if (!raw) return null
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return null
  return toLocalDateKey(date)
}

function kindsInSelection(item: LabExamPendingItem): ExamKindSlug[] {
  const from = listFrom.value
  const to = listTo.value
  const start = from && to && from > to ? to : from
  const end = from && to && from > to ? from : to
  return paidKindsOf(item).filter((kind) => {
    if (kindFilter.value && kind !== kindFilter.value) return false
    const key = paidDateKey(item, kind)
    if (!key) return !start && !end
    if (start && key < start) return false
    if (end && key > end) return false
    return true
  })
}

function narrowToKinds(item: LabExamPendingItem, kinds: ExamKindSlug[]): LabExamPendingItem {
  const blocks = emptyExamsByKindBlocks()
  const lines: LabExamLine[] = []
  const invoicesByKind: LabExamPendingItem['invoicesByKind'] = {}
  let grossFcfa = 0
  let collectedFcfa = 0
  let remainingFcfa = 0
  let latestPaid: string | null = null

  for (const kind of kinds) {
    const block = item.allExamsByKind?.[kind] ?? item.examsByKind?.[kind]
    const kindLines = block?.lines?.length
      ? block.lines
      : (item.examLines ?? []).filter((line) => line.kind === kind)
    const kindGross = block?.grossFcfa ?? kindLines.reduce((sum, line) => sum + line.unitPriceFcfa, 0)
    blocks[kind] = { lines: kindLines, grossFcfa: kindGross }
    lines.push(...kindLines)
    grossFcfa += kindGross

    const invoice = item.invoicesByKind?.[kind]
    if (invoice) {
      invoicesByKind[kind] = invoice
      collectedFcfa += invoice.paidFcfa ?? invoice.netFcfa
      remainingFcfa += invoice.remainingFcfa ?? 0
    }

    const at = item.paidAtByKind?.[kind]
    if (at && (!latestPaid || at > latestPaid)) latestPaid = at
  }

  return {
    ...item,
    examLines: lines,
    examsByKind: blocks,
    allExamsByKind: blocks,
    invoicesByKind,
    paidKinds: kinds,
    grossFcfa,
    collectedFcfa,
    remainingFcfa,
    paidAt: latestPaid ?? item.paidAt,
  }
}

const filteredItems = computed(() =>
  paidItems.value.flatMap((item) => {
    const kinds = kindsInSelection(item)
    if (!kinds.length) return []
    return [narrowToKinds(item, kinds)]
  }),
)

const isTodayRange = computed(
  () => listFrom.value === todayDateKey() && listTo.value === todayDateKey(),
)

function resetDatesToToday() {
  const today = todayDateKey()
  listFrom.value = today
  listTo.value = today
}

function clearDates() {
  listFrom.value = ''
  listTo.value = ''
}

const paidExportRows = computed(() =>
  toLabExamListExportRows(filteredItems.value, 'paid', isArabic.value ? 'ar-TD' : 'fr-FR'),
)
const paidExportColumns = computed(() => labExamListExportColumns('paid'))

function paidExportShared() {
  return {
    totalsRows: [
      { label: uiText('Nombre de dossiers'), value: String(paidExportRows.value.length) },
    ],
  }
}

function exportPaidPdf() {
  exportTablePdf(uiText('Examens payés'), paidExportColumns.value, paidExportRows.value, paidExportShared())
}

function exportPaidExcel() {
  exportTableExcel(uiText('Examens payés'), paidExportColumns.value, paidExportRows.value, paidExportShared())
}

function exportPaidWord() {
  void exportTableWord(uiText('Examens payés'), paidExportColumns.value, paidExportRows.value, paidExportShared())
}

const printableIds = computed(() => {
  const ids = new Set<string>()
  for (const item of filteredItems.value) {
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
  const fromExams = activeExamKindsFromBlocks(item.allExamsByKind ?? item.examsByKind)
  if (fromExams.length) return fromExams
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
  const item =
    filteredItems.value.find((row) => row.id === id) ??
    paidItems.value.find((row) => row.id === id)
  if (!item) return

  const kinds = resolvePaidKinds(item)
  if (!kinds.length) {
    message.value = uiText('Aucune facture payée à imprimer pour ce dossier.')
    messageType.value = 'error'
    return
  }

  if (!ensurePrintWindow('80mm')) {
    message.value = uiText("Impossible d'imprimer le reçu.")
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
    cancelPrintWindow()
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

async function deletePaidExams(id: string) {
  if (!canDeletePaid.value || deletingPaid.value) return
  const item = paidItems.value.find((row) => row.id === id)
  if (!item) return
  const patient = item.visit.patient
  const confirmed = await confirmAppModal({
    type: 'DELETE',
    title: uiText('Supprimer les examens payés'),
    message: translateTemplate(
      'Annuler tous les examens payés de {code} — {name} ? Les factures seront remboursées et les examens retirés du dossier. Cette action est irréversible.',
      {
        code: patient.code,
        name: fullName(patient.firstName, patient.lastName),
      },
    ),
    confirmLabel: uiText('Supprimer'),
  })
  if (!confirmed) return

  deletingPaid.value = true
  message.value = ''
  try {
    const { data } = await api.delete<{ totalRefundedFcfa?: number }>(`/comptabilite/paid-exams/${id}`)
    closeDetail()
    message.value = translateTemplate('Examens payés supprimés. Montant remboursé : {amount}.', {
      amount: formatFcfa(data.totalRefundedFcfa ?? 0),
    })
    messageType.value = 'success'
    await load()
  } catch (error: unknown) {
    await showApiErrorModal(error, uiText('Impossible de supprimer les examens payés.'))
  } finally {
    deletingPaid.value = false
  }
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
          <ExportButtons
            :disabled="loading || !paidExportRows.length"
            @pdf="exportPaidPdf"
            @excel="exportPaidExcel"
            @word="exportPaidWord"
          />
          <UiButton variant="ghost" size="sm" :disabled="loading" @click="load">
            {{ t('common.refresh') }}
          </UiButton>
        </template>

        <div class="paid-filters">
          <div class="date-range-filter">
            <label class="date-filter">
              <span class="date-filter__label">{{ uiText('Du') }}</span>
              <input
                v-model="listFrom"
                type="date"
                class="date-filter__input"
                :max="listTo || undefined"
                :aria-label="uiText('Du')"
              />
            </label>
            <label class="date-filter">
              <span class="date-filter__label">{{ uiText('Au') }}</span>
              <input
                v-model="listTo"
                type="date"
                class="date-filter__input"
                :min="listFrom || undefined"
                :aria-label="uiText('Au')"
              />
            </label>
            <button
              v-if="!isTodayRange"
              type="button"
              class="date-filter__today"
              @click="resetDatesToToday"
            >
              {{ uiText("Aujourd'hui") }}
            </button>
            <button
              v-if="listFrom || listTo"
              type="button"
              class="date-filter__today"
              @click="clearDates"
            >
              {{ uiText('Toutes les dates') }}
            </button>
          </div>

          <label class="date-filter">
            <span class="date-filter__label">{{ uiText("Type d'examen") }}</span>
            <select v-model="kindFilter" class="date-filter__input date-filter__input--kind">
              <option value="">{{ uiText('Tous') }}</option>
              <option v-for="kind in kindOptions" :key="kind" :value="kind">
                {{ uiText(EXAM_KIND_LABELS[kind]) }}
              </option>
            </select>
          </label>
        </div>

        <p v-if="!loading && !filteredItems.length" class="empty">
          {{ uiText('Aucun examen payé pour cette période') }}
        </p>
        <LabExamsPendingDataTable
          v-else
          fill
          mode="paid"
          :items="filteredItems as LabExamPendingRow[]"
          :loading="loading"
          :printable-ids="printableIds"
          :can-delete-paid="canDeletePaid"
          @print="onPrint"
          @reclaim="openReclamation"
          @view="openDetail"
          @delete="deletePaidExams"
        />
      </UiCard>
    </section>

    <ExamPaidDetailModal
      v-model:open="detailOpen"
      :item="detailItem"
      :can-delete-paid="canDeletePaid"
      @close="closeDetail"
      @print="onPrint"
      @delete="deletePaidExams"
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

.paid-filters {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 0.75rem 1rem;
  padding: 0.75rem 0.85rem 0.35rem;
}

.date-range-filter {
  display: flex;
  align-items: flex-end;
  gap: 0.45rem;
  flex-shrink: 0;
}

.date-filter {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.date-filter__label {
  font-size: 0.625rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}

.date-filter__input {
  height: 2.25rem;
  width: 8.75rem;
  padding: 0 0.5rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-card);
  color: var(--text);
  font: inherit;
  font-size: 0.8125rem;
}

.date-filter__input--kind {
  width: 11rem;
}

.date-filter__today {
  margin-bottom: 0.35rem;
  padding: 0;
  border: none;
  background: none;
  color: var(--primary-600, #0d9488);
  font-size: 0.75rem;
  font-weight: 700;
  cursor: pointer;
}

</style>
