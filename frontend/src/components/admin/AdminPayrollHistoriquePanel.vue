<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { CalendarRange, Search, Undo2, X } from '@lucide/vue'
import api from '@/api/client'
import { formatFcfa } from '@/lib/roles'
import { formatShortDate } from '@/lib/admin-dashboard'
import { confirmAppModal, showApiErrorModal, showSuccessModal } from '@/lib/api-modal-helper'
import { exportTableExcel, exportTablePdf, exportTableWord, type ExportColumn } from '@/lib/table-export'
import ExportButtons from '@/components/ui/ExportButtons.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiButton from '@/components/ui/UiButton.vue'

type HistoryRow = {
  id: string
  year: number
  month: number
  grossFcfa: number
  primeFcfa: number
  advanceDeductionFcfa: number
  netFcfa: number
  paidAt: string | null
  employee: { fullName: string; jobTitle: string | null; service: string }
}

const emit = defineEmits<{ cancelled: [] }>()

const rows = ref<HistoryRow[]>([])
const loading = ref(false)
const cancellingId = ref<string | null>(null)
const dateFrom = ref('')
const dateTo = ref('')
const searchQuery = ref('')
/** Filtre par poste ('' = tous) : tableau, totaux et exports. */
const jobTitleFilter = ref('')

const hasRange = computed(() => !!dateFrom.value && !!dateTo.value)

function periodLabel(year: number, month: number) {
  return new Date(year, month - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
}

/** Horodatage → jour local (et non le jour UTC des 10 premiers caractères). */
function formatPaidAt(iso: string) {
  const date = new Date(iso)
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return formatShortDate(`${y}-${m}-${d}`)
}

function normalizeText(value: string) {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

function jobTitleOf(row: HistoryRow) {
  return row.employee.jobTitle?.trim() || '—'
}

const jobTitleOptions = computed(() =>
  [...new Set(rows.value.map(jobTitleOf))].sort((a, b) =>
    a.localeCompare(b, 'fr', { sensitivity: 'base' }),
  ),
)

// Poste absent de la période chargée : on revient à « Tous les postes ».
watch(jobTitleOptions, (options) => {
  if (jobTitleFilter.value && !options.includes(jobTitleFilter.value)) jobTitleFilter.value = ''
})

const filteredRows = computed(() => {
  const q = normalizeText(searchQuery.value.trim())
  const jobTitle = jobTitleFilter.value
  return rows.value.filter((row) => {
    if (jobTitle && jobTitleOf(row) !== jobTitle) return false
    if (!q) return true
    return normalizeText(
      [
        row.employee.fullName,
        row.employee.jobTitle ?? '',
        row.employee.service,
        periodLabel(row.year, row.month),
      ].join(' '),
    ).includes(q)
  })
})

const totals = computed(() =>
  filteredRows.value.reduce(
    (sum, row) => ({
      gross: sum.gross + row.grossFcfa,
      advances: sum.advances + row.advanceDeductionFcfa,
      net: sum.net + row.netFcfa,
    }),
    { gross: 0, advances: 0, net: 0 },
  ),
)

const description = computed(() =>
  hasRange.value
    ? `Salaires payés du ${formatShortDate(dateFrom.value)} au ${formatShortDate(dateTo.value)}`
    : 'Les 100 derniers salaires payés',
)

async function loadHistory() {
  if (hasRange.value && dateFrom.value > dateTo.value) dateTo.value = dateFrom.value
  loading.value = true
  try {
    const { data } = await api.get<{ rows: HistoryRow[] }>('/admin/payroll/history', {
      params: hasRange.value ? { from: dateFrom.value, to: dateTo.value } : undefined,
    })
    rows.value = data.rows
  } finally {
    loading.value = false
  }
}

function onDateChange() {
  if (!dateFrom.value && !dateTo.value) return loadHistory()
  if (!dateFrom.value) dateFrom.value = dateTo.value
  if (!dateTo.value) dateTo.value = dateFrom.value
  void loadHistory()
}

function clearDates() {
  dateFrom.value = ''
  dateTo.value = ''
  void loadHistory()
}

/** Export : un paiement (un employé) par ligne, dans l'ordre affiché. */
const historyExportColumns: ExportColumn<HistoryRow>[] = [
  { header: 'N°', value: (r) => filteredRows.value.indexOf(r) + 1 },
  { header: 'Date de paiement', value: (r) => (r.paidAt ? formatPaidAt(r.paidAt) : '—') },
  { header: 'Période', value: (r) => periodLabel(r.year, r.month) },
  { header: 'Employé', value: (r) => r.employee.fullName },
  { header: 'Poste', value: (r) => r.employee.jobTitle ?? '—' },
  { header: 'Service', value: (r) => r.employee.service },
  { header: 'Salaire brut', value: (r) => formatFcfa(r.grossFcfa) },
  { header: 'Avance déduite', value: (r) => (r.advanceDeductionFcfa > 0 ? formatFcfa(r.advanceDeductionFcfa) : '—') },
  { header: 'Net versé', value: (r) => formatFcfa(r.netFcfa) },
]

function historyExportOptions() {
  return {
    captionRows: [
      { label: 'Période', value: description.value },
      { label: 'Poste', value: jobTitleFilter.value || 'Tous les postes' },
    ],
    totalsRows: [
      { label: 'Nombre de paiements', value: String(filteredRows.value.length) },
      { label: 'Total brut', value: formatFcfa(totals.value.gross) },
      { label: 'Total avances', value: formatFcfa(totals.value.advances) },
      { label: 'Total net', value: formatFcfa(totals.value.net) },
    ],
  }
}

function exportHistoryPdf() {
  exportTablePdf('Historique des paiements', historyExportColumns, filteredRows.value, historyExportOptions())
}

function exportHistoryExcel() {
  exportTableExcel('Historique des paiements', historyExportColumns, filteredRows.value, {
    totalsRows: historyExportOptions().totalsRows,
  })
}

function exportHistoryWord() {
  void exportTableWord('Historique des paiements', historyExportColumns, filteredRows.value, historyExportOptions())
}

async function cancelPayroll(row: HistoryRow) {
  const period = periodLabel(row.year, row.month)
  const ok = await confirmAppModal({
    type: 'WARNING',
    title: 'Annuler la paie',
    message: `Annuler le paiement de ${row.employee.fullName} (${period}) ? ${formatFcfa(row.netFcfa)} seront remis en caisse et l'employé réapparaîtra dans la paie de ${period}.`,
    confirmLabel: 'Annuler la paie',
    cancelLabel: 'Retour',
  })
  if (!ok) return
  cancellingId.value = row.id
  try {
    await api.post(`/admin/payroll/${row.id}/cancel`)
    await loadHistory()
    emit('cancelled')
    await showSuccessModal('Paie annulée', `Le paiement de ${row.employee.fullName} (${period}) a été annulé.`)
  } catch (error) {
    await showApiErrorModal(error, "Impossible d'annuler la paie.")
  } finally {
    cancellingId.value = null
  }
}

onMounted(loadHistory)

defineExpose({ reload: loadHistory })
</script>

<template>
  <UiCard title="Paiements enregistrés" :description="description">
    <div class="history-filters">
      <div class="history-search">
        <Search :size="16" class="history-search__icon" />
        <input
          v-model="searchQuery"
          type="search"
          class="history-input history-search__input"
          placeholder="Rechercher un employé, un poste, un mois…"
          aria-label="Rechercher un paiement"
        />
      </div>
      <select v-model="jobTitleFilter" class="history-input history-job-select" aria-label="Filtrer par poste">
        <option value="">Tous les postes</option>
        <option v-for="title in jobTitleOptions" :key="title" :value="title">{{ title }}</option>
      </select>
      <div class="history-dates">
        <CalendarRange :size="16" class="history-dates__icon" />
        <label class="history-dates__field">
          <span>Du</span>
          <input
            v-model="dateFrom"
            type="date"
            class="history-input"
            :max="dateTo || undefined"
            aria-label="Payé à partir du"
            @change="onDateChange"
          />
        </label>
        <label class="history-dates__field">
          <span>Au</span>
          <input
            v-model="dateTo"
            type="date"
            class="history-input"
            :min="dateFrom || undefined"
            aria-label="Payé jusqu'au"
            @change="onDateChange"
          />
        </label>
        <UiButton
          v-if="dateFrom || dateTo"
          size="sm"
          variant="ghost"
          :icon="X"
          title="Effacer les dates"
          aria-label="Effacer les dates"
          @click="clearDates"
        />
        <ExportButtons
          :disabled="loading || !filteredRows.length"
          @pdf="exportHistoryPdf"
          @excel="exportHistoryExcel"
          @word="exportHistoryWord"
        />
      </div>
    </div>

    <div v-if="loading" class="chart-empty">Chargement…</div>
    <div v-else-if="!rows.length" class="chart-empty">
      {{ hasRange ? 'Aucun salaire payé sur cette période' : 'Aucun paiement enregistré' }}
    </div>
    <div v-else-if="!filteredRows.length" class="chart-empty">Aucun résultat</div>
    <div v-else class="history-table-wrap">
      <table class="admin-table">
        <thead>
          <tr>
            <th>Date de paiement</th>
            <th>Période</th>
            <th>Employé</th>
            <th>Poste</th>
            <th>Service</th>
            <th>Salaire brut</th>
            <th>Avance déduite</th>
            <th>Net versé</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in filteredRows" :key="row.id">
            <td>{{ row.paidAt ? formatPaidAt(row.paidAt) : '—' }}</td>
            <td>{{ periodLabel(row.year, row.month) }}</td>
            <td>{{ row.employee.fullName }}</td>
            <td>{{ row.employee.jobTitle ?? '—' }}</td>
            <td>{{ row.employee.service }}</td>
            <td>{{ formatFcfa(row.grossFcfa) }}</td>
            <td>
              <span v-if="row.advanceDeductionFcfa > 0" class="advance-deduct">
                -{{ formatFcfa(row.advanceDeductionFcfa) }}
              </span>
              <span v-else>—</span>
            </td>
            <td class="num-strong">{{ formatFcfa(row.netFcfa) }}</td>
            <td>
              <UiButton
                size="sm"
                variant="danger"
                :icon="Undo2"
                :disabled="cancellingId !== null"
                @click="cancelPayroll(row)"
              >
                Annuler la paie
              </UiButton>
            </td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td colspan="5">{{ filteredRows.length }} paiement(s)</td>
            <td>{{ formatFcfa(totals.gross) }}</td>
            <td>
              <span v-if="totals.advances > 0" class="advance-deduct">-{{ formatFcfa(totals.advances) }}</span>
              <span v-else>—</span>
            </td>
            <td class="num-strong">{{ formatFcfa(totals.net) }}</td>
            <td></td>
          </tr>
        </tfoot>
      </table>
    </div>
  </UiCard>
</template>

<style scoped>
.history-filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  margin-bottom: 0.75rem;
}

.history-input {
  padding: 0.45rem 0.65rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-card);
  color: var(--text);
  font-family: inherit;
  font-size: 0.875rem;
}

.history-input:focus {
  outline: none;
  border-color: var(--primary-400);
}

.history-job-select {
  flex: 0 1 14rem;
  min-width: 0;
}

.history-search {
  position: relative;
  flex: 1 1 16rem;
  max-width: 22rem;
}

.history-search__icon {
  position: absolute;
  top: 50%;
  left: 0.65rem;
  transform: translateY(-50%);
  color: var(--text-muted);
  pointer-events: none;
}

.history-search__input {
  width: 100%;
  padding-left: 2.1rem;
}

.history-dates {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.45rem;
}

.history-dates__icon {
  color: var(--text-muted);
}

.history-dates__field {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-muted);
}

.history-table-wrap {
  overflow-x: auto;
}

.admin-table {
  width: 100%;
  border-collapse: collapse;
}

.admin-table th,
.admin-table td {
  padding: 0.65rem 0.5rem;
  border-bottom: 1px solid var(--border);
  text-align: left;
  font-size: 0.875rem;
  white-space: nowrap;
}

.admin-table tfoot td {
  font-weight: 700;
  border-bottom: none;
  border-top: 2px solid var(--border);
}

.advance-deduct {
  color: #be123c;
  font-weight: 600;
}

.num-strong {
  font-weight: 700;
}

@media (max-width: 640px) {
  .history-search {
    max-width: none;
  }
}
</style>
