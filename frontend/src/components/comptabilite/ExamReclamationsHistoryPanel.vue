<script setup lang="ts">
import { onMounted, ref, watch, computed } from 'vue'
import { ClipboardList, RefreshCw } from '@lucide/vue'
import api from '@/api/client'
import { formatFcfa, fullName } from '@/lib/roles'
import { EXAM_KIND_LABELS, type ExamKindSlug } from '@/lib/exam-catalog/types'
import {
  EXAM_RECLAMATION_REASON_LABELS,
  EXAM_RECLAMATION_STATUS_LABELS,
  type ExamReclamationRow,
  type ExamReclamationStatus,
} from '@/lib/exam-reclamation'
import UiCard from '@/components/ui/UiCard.vue'
import UiButton from '@/components/ui/UiButton.vue'
import ExportButtons from '@/components/ui/ExportButtons.vue'
import { useAppI18n } from '@/i18n/useAppI18n'
import { translateTemplate } from '@/lib/dashboard-i18n'
import { exportTableExcel, exportTablePdf, type ExportColumn } from '@/lib/table-export'

const props = withDefaults(
  defineProps<{
    refreshKey?: number
  }>(),
  {},
)

const rows = ref<ExamReclamationRow[]>([])
const loading = ref(false)

const { uiText, t, localeCode, isArabic } = useAppI18n()
const dateLocale = computed(() => (isArabic.value ? 'ar-TD' : 'fr-FR'))

const STATUS_CLASS: Record<ExamReclamationStatus, string> = {
  PENDING: 'status--pending',
  IN_PROGRESS: 'status--progress',
  REFUNDED: 'status--refunded',
  REJECTED: 'status--rejected',
}

async function load() {
  loading.value = true
  try {
    const { data } = await api.get<ExamReclamationRow[]>('/comptabilite/exam-reclamations')
    rows.value = data
  } catch {
    rows.value = []
  } finally {
    loading.value = false
  }
}

function formatDate(value: string) {
  void localeCode.value
  const date = new Date(value)
  const datePart = date.toLocaleDateString(dateLocale.value, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
  const timePart = date.toLocaleTimeString(dateLocale.value, { hour: '2-digit', minute: '2-digit' })
  return `${datePart} · ${timePart}`
}

function examKindLabel(kind: string) {
  return uiText(EXAM_KIND_LABELS[kind as ExamKindSlug] ?? kind)
}

function reasonLabel(reason: ExamReclamationRow['reason']) {
  return uiText(EXAM_RECLAMATION_REASON_LABELS[reason])
}

function statusLabel(status: ExamReclamationStatus) {
  return uiText(EXAM_RECLAMATION_STATUS_LABELS[status])
}

function examsSummary(row: ExamReclamationRow) {
  if (row.examLines?.length) {
    return row.examLines.map((line) => line.examLabel).join(', ')
  }
  return row.examLabel ?? '—'
}

const reclamationExportColumns: ExportColumn<ExamReclamationRow>[] = [
  { header: 'Date', value: (r) => formatDate(r.createdAt) },
  {
    header: 'Patient',
    value: (r) =>
      r.patient
        ? `${r.patient.code} — ${fullName(r.patient.firstName, r.patient.lastName)}`
        : '—',
  },
  { header: 'Examens', value: (r) => examsSummary(r) },
  { header: 'Montant', value: (r) => formatFcfa(r.totalFcfa) },
  { header: 'Motif', value: (r) => reasonLabel(r.reason) },
  { header: 'Statut', value: (r) => statusLabel(r.status) },
]

function exportPdf() {
  exportTablePdf('Historique des réclamations examens', reclamationExportColumns, rows.value)
}

function exportExcel() {
  exportTableExcel('Historique des réclamations examens', reclamationExportColumns, rows.value)
}

onMounted(load)

watch(() => props.refreshKey, () => {
  load()
})
</script>

<template>
  <UiCard
    title="Historique des réclamations"
    description="Remboursements appliqués immédiatement à la validation — montants déduits des factures examens"
    class="ui-card--table-panel"
    :icon="ClipboardList"
    icon-variant="amber"
  >
    <template #actions>
      <ExportButtons :disabled="loading || !rows.length" @pdf="exportPdf" @excel="exportExcel" />
      <UiButton variant="ghost" size="sm" :disabled="loading" :icon="RefreshCw" @click="load">
        {{ t('common.refresh') }}
      </UiButton>
    </template>

    <p v-if="loading" class="hint">{{ t('common.Chargement…') }}</p>
    <p v-else-if="!rows.length" class="hint">{{ uiText('Aucune réclamation enregistrée.') }}</p>

    <div v-else class="table-wrap">
      <table class="recl-table">
        <thead>
          <tr>
            <th>{{ uiText('Date') }}</th>
            <th>{{ uiText('Patient') }}</th>
            <th>{{ uiText('Examens') }}</th>
            <th>{{ uiText('Montant') }}</th>
            <th>{{ uiText('Motif') }}</th>
            <th>{{ uiText('Statut') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.id">
            <td>{{ formatDate(row.createdAt) }}</td>
            <td>
              <strong>{{ fullName(row.patient.firstName, row.patient.lastName) }}</strong>
              <span class="sub">{{ row.patient.code }}</span>
            </td>
            <td>
              <span class="sub" v-if="row.examLines?.length > 1">
                {{ translateTemplate('{n} examens', { n: row.examLines.length }) }}
              </span>
              <span v-else-if="row.examKind" class="sub">{{ examKindLabel(row.examKind) }}</span>
              {{ examsSummary(row) }}
            </td>
            <td class="amount">{{ formatFcfa(row.totalFcfa ?? 0) }}</td>
            <td>{{ reasonLabel(row.reason) }}</td>
            <td>
              <span class="status" :class="STATUS_CLASS[row.status]">
                {{ statusLabel(row.status) }}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </UiCard>
</template>

<style scoped>
.hint {
  margin: 0;
  text-align: center;
  color: var(--text-muted);
  padding: 1.5rem;
  font-size: 0.875rem;
}

.table-wrap {
  overflow-x: auto;
}

.recl-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8125rem;
}

.recl-table th,
.recl-table td {
  padding: 0.55rem 0.65rem;
  border-bottom: 1px solid var(--border);
  text-align: left;
  vertical-align: top;
}

.recl-table th {
  font-size: 0.6875rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}

.sub {
  display: block;
  font-size: 0.6875rem;
  color: var(--text-muted);
}

.amount {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.status {
  display: inline-block;
  padding: 0.15rem 0.45rem;
  border-radius: 999px;
  font-size: 0.625rem;
  font-weight: 800;
  text-transform: uppercase;
}

.status--pending {
  background: #fef3c7;
  color: #92400e;
}

.status--progress {
  background: #dbeafe;
  color: #1d4ed8;
}

.status--refunded {
  background: #d1fae5;
  color: #047857;
}

.status--rejected {
  background: #fee2e2;
  color: #b91c1c;
}
</style>
