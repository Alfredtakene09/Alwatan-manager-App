<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { Search, History, Eye, Download, Printer } from '@lucide/vue'
import api from '@/api/client'
import { formatFcfa } from '@/lib/roles'
import { formatShortDate } from '@/lib/admin-dashboard'
import { buildClinicPrintHeader, openPrintDocument } from '@/lib/print-document'
import UiCard from '@/components/ui/UiCard.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiFormModal from '@/components/ui/UiFormModal.vue'
import CaisseToolbar from '@/components/caisse/CaisseToolbar.vue'
import GestionnaireRowAction from '@/components/gestionnaire/GestionnaireRowAction.vue'
import GestionnaireRowActionGroup from '@/components/gestionnaire/GestionnaireRowActionGroup.vue'

type HistoryRow = {
  id: string
  year: number
  month: number
  grossFcfa: number
  netFcfa: number
  paidAt: string | null
  paymentMethod: string | null
  employee: { fullName: string; jobTitle: string | null; service: string }
}

type PeriodSummary = {
  year: number
  month: number
  total: number
  paid: number
  unpaid: number
}

const PAYMENT_LABELS: Record<string, string> = {
  ESPECES: 'Espèces',
  VIREMENT: 'Virement',
  CHEQUE: 'Chèque',
}

const rows = ref<HistoryRow[]>([])
const periods = ref<PeriodSummary[]>([])
const loading = ref(false)

const periodFilter = ref('all')
const serviceFilter = ref('all')
const searchQuery = ref('')
const tableFilter = ref('')
const exportScope = ref<'all' | 'selected'>('all')
const selectedIds = ref<string[]>([])
const showPayslipModal = ref(false)
const selectedPayslip = ref<HistoryRow | null>(null)
const serviceOptions = computed(() => {
  const set = new Set(rows.value.map((row) => row.employee.service))
  return ['all', ...[...set].sort((a, b) => a.localeCompare(b, 'fr'))]
})

const filteredRows = computed(() => {
  const q = `${searchQuery.value} ${tableFilter.value}`.trim().toLowerCase()
  return rows.value.filter((row) => {
    if (periodFilter.value !== 'all') {
      const [y, m] = periodFilter.value.split('-').map(Number)
      if (row.year !== y || row.month !== m) return false
    }
    if (serviceFilter.value !== 'all' && row.employee.service !== serviceFilter.value) {
      return false
    }
    if (q) {
      const haystack = [
        row.employee.fullName,
        row.employee.jobTitle ?? '',
        row.employee.service,
      ]
        .join(' ')
        .toLowerCase()
      if (!haystack.includes(q)) return false
    }
    return true
  })
})

const selectedRows = computed(() =>
  filteredRows.value.filter((row) => selectedIds.value.includes(row.id)),
)
const exportRows = computed(() =>
  exportScope.value === 'selected' ? selectedRows.value : filteredRows.value,
)
const allVisibleSelected = computed(
  () => filteredRows.value.length > 0 && filteredRows.value.every((row) => selectedIds.value.includes(row.id)),
)

const totalNetFcfa = computed(() =>
  filteredRows.value.reduce((sum, row) => sum + row.netFcfa, 0),
)

function periodLabel(year: number, month: number) {
  return new Date(year, month - 1, 1).toLocaleDateString('fr-FR', {
    month: 'long',
    year: 'numeric',
  })
}

function periodKey(year: number, month: number) {
  return `${year}-${month}`
}

async function loadPeriods() {
  const { data } = await api.get<{ periods: PeriodSummary[] }>('/gestionnaire/payroll/periods')
  periods.value = data.periods.filter((p) => p.paid > 0)
}

async function loadHistory() {
  loading.value = true
  try {
    const params: Record<string, string | number> = {}
    if (periodFilter.value !== 'all') {
      const [y, m] = periodFilter.value.split('-').map(Number)
      params.year = y
      params.month = m
    }
    if (serviceFilter.value !== 'all') params.service = serviceFilter.value
    if (searchQuery.value.trim()) params.search = searchQuery.value.trim()

    const { data } = await api.get<{ rows: HistoryRow[] }>('/gestionnaire/payroll/history', {
      params,
    })
    rows.value = data.rows
  } finally {
    loading.value = false
  }
}

function payslipViewUrl(id: string) {
  return `/api/gestionnaire/payroll/${id}/payslip.pdf`
}

function payslipDownloadUrl(id: string) {
  return `/api/gestionnaire/payroll/${id}/payslip.pdf?download=1`
}

async function openPayslipModal(row: HistoryRow) {
  selectedPayslip.value = row
  showPayslipModal.value = true
}

function closePayslipModal() {
  showPayslipModal.value = false
  selectedPayslip.value = null
}

function printPayslipFromModal() {
  if (!selectedPayslip.value) return
  // Ouvre la fiche PDF en aperçu natif: l'utilisateur lance l'impression
  // avec les options du navigateur (Cmd/Ctrl+P ou bouton imprimer).
  window.open(payslipViewUrl(selectedPayslip.value.id), '_blank', 'noopener')
}

function downloadPayslip(id: string) {
  window.open(payslipDownloadUrl(id), '_blank', 'noopener')
}

function toggleAllVisible() {
  if (allVisibleSelected.value) {
    selectedIds.value = selectedIds.value.filter((id) => !filteredRows.value.some((row) => row.id === id))
    return
  }
  const set = new Set(selectedIds.value)
  filteredRows.value.forEach((row) => set.add(row.id))
  selectedIds.value = [...set]
}

function toggleOne(id: string, checked: boolean) {
  const set = new Set(selectedIds.value)
  if (checked) set.add(id)
  else set.delete(id)
  selectedIds.value = [...set]
}

function historyRowsToTableHtml() {
  const bodyRows = exportRows.value
    .map(
      (row) => `
      <tr>
        <td>${row.paidAt ? formatShortDate(row.paidAt) : '—'}</td>
        <td>${periodLabel(row.year, row.month)}</td>
        <td>${row.employee.fullName}</td>
        <td>${row.employee.jobTitle ?? '—'}</td>
        <td>${row.employee.service}</td>
        <td>${formatFcfa(row.netFcfa)}</td>
        <td>${row.paymentMethod ? PAYMENT_LABELS[row.paymentMethod] ?? row.paymentMethod : '—'}</td>
      </tr>`,
    )
    .join('')

  return `
    ${buildClinicPrintHeader('Historique des paiements')}
    <table>
      <thead>
        <tr>
          <th>Date de paiement</th><th>Période</th><th>Employé</th><th>Poste</th><th>Service</th><th>Net payé</th><th>Mode</th>
        </tr>
      </thead>
      <tbody>${bodyRows}</tbody>
    </table>
  `
}

function printHistoryRows() {
  if (!exportRows.value.length) return
  openPrintDocument('Historique des paiements', historyRowsToTableHtml(), {
    autoPrint: true,
    pageSize: 'A4',
  })
}

function exportHistoryPdf() {
  if (!exportRows.value.length) return
  openPrintDocument('Historique des paiements (PDF)', historyRowsToTableHtml(), {
    autoPrint: true,
    pageSize: 'A4',
  })
}

watch([periodFilter, serviceFilter], () => {
  void loadHistory()
})

let searchTimer: ReturnType<typeof setTimeout> | null = null
watch(searchQuery, () => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    void loadHistory()
  }, 300)
})

watch(filteredRows, () => {
  const visible = new Set(filteredRows.value.map((row) => row.id))
  selectedIds.value = selectedIds.value.filter((id) => visible.has(id))
})

onMounted(async () => {
  await loadPeriods()
  await loadHistory()
})

defineExpose({ reload: loadHistory })
</script>

<template>
  <UiCard title="Historique des paiements" description="Salaires validés — filtres par période, service et employé">
    <div class="history-summary">
      <History :size="18" />
      <span>
        <strong>{{ filteredRows.length }}</strong> paiement(s) —
        total net <strong>{{ formatFcfa(totalNetFcfa) }}</strong>
      </span>
    </div>

    <div class="history-filters">
      <UiSelect v-model="periodFilter" label="Période de paie">
        <option value="all">Toutes les périodes</option>
        <option
          v-for="period in periods"
          :key="periodKey(period.year, period.month)"
          :value="periodKey(period.year, period.month)"
        >
          {{ periodLabel(period.year, period.month) }} ({{ period.paid }} payé(s))
        </option>
      </UiSelect>

      <UiSelect v-model="serviceFilter" label="Service">
        <option value="all">Tous les services</option>
        <option
          v-for="service in serviceOptions.filter((s) => s !== 'all')"
          :key="service"
          :value="service"
        >
          {{ service }}
        </option>
      </UiSelect>

      <UiInput
        v-model="searchQuery"
        label="Rechercher"
        placeholder="Nom, poste…"
        :icon="Search"
      />
    </div>

    <div v-if="filteredRows.length" class="table-head-actions">
      <UiInput
        v-model="tableFilter"
        label="Filtrage du tableau"
        placeholder="Filtrer dans le tableau…"
        :icon="Search"
      />
      <UiSelect v-model="exportScope" label="Portée">
        <option value="all">Tous les résultats ({{ filteredRows.length }})</option>
        <option value="selected">Sélection ({{ selectedRows.length }})</option>
      </UiSelect>
      <UiButton :icon="Printer" variant="ghost" :disabled="!exportRows.length" @click="printHistoryRows">
        Impression
      </UiButton>
      <UiButton :icon="Download" variant="secondary" :disabled="!exportRows.length" @click="exportHistoryPdf">
        PDF
      </UiButton>
    </div>

    <CaisseToolbar v-if="periodFilter !== 'all'" class="history-period-chip" aria-label="Période active">
      <span>{{ periodLabel(Number(periodFilter.split('-')[0]), Number(periodFilter.split('-')[1])) }}</span>
    </CaisseToolbar>

    <div v-if="loading" class="chart-empty">Chargement…</div>
    <div v-else-if="!filteredRows.length" class="chart-empty">Aucun paiement ne correspond aux filtres.</div>
    <table v-else class="gestionnaire-table">
      <thead>
        <tr>
          <th>
            <input
              type="checkbox"
              :checked="allVisibleSelected"
              aria-label="Tout sélectionner"
              @change="toggleAllVisible"
            />
          </th>
          <th>Date de paiement</th>
          <th>Période</th>
          <th>Employé</th>
          <th>Poste</th>
          <th>Service</th>
          <th>Net payé</th>
          <th>Mode</th>
          <th class="col-actions"><span class="sr-only">Actions</span></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in filteredRows" :key="row.id">
          <td>
            <input
              type="checkbox"
              :checked="selectedIds.includes(row.id)"
              aria-label="Sélectionner la ligne"
              @change="toggleOne(row.id, ($event.target as HTMLInputElement).checked)"
            />
          </td>
          <td>{{ row.paidAt ? formatShortDate(row.paidAt) : '—' }}</td>
          <td>{{ periodLabel(row.year, row.month) }}</td>
          <td>{{ row.employee.fullName }}</td>
          <td>{{ row.employee.jobTitle ?? '—' }}</td>
          <td>{{ row.employee.service }}</td>
          <td>{{ formatFcfa(row.netFcfa) }}</td>
          <td>{{ row.paymentMethod ? PAYMENT_LABELS[row.paymentMethod] ?? row.paymentMethod : '—' }}</td>
          <td class="actions">
            <GestionnaireRowActionGroup>
              <GestionnaireRowAction
                :icon="Eye"
                label="Voir"
                variant="neutral"
                @click="openPayslipModal(row)"
              />
            </GestionnaireRowActionGroup>
          </td>
        </tr>
      </tbody>
    </table>

    <UiFormModal
      v-if="showPayslipModal && selectedPayslip"
      title-id="gestionnaire-payslip-preview-title"
      title="Aperçu de la fiche de paie"
      :subtitle="`${selectedPayslip.employee.fullName} — ${periodLabel(selectedPayslip.year, selectedPayslip.month)}`"
      :icon="Eye"
      size="large"
      @close="closePayslipModal"
    >
      <div class="payslip-preview">
        <table class="gestionnaire-table payslip-preview__table">
          <tbody>
            <tr>
              <th>Employé</th>
              <td>{{ selectedPayslip.employee.fullName }}</td>
            </tr>
            <tr>
              <th>Période</th>
              <td>{{ periodLabel(selectedPayslip.year, selectedPayslip.month) }}</td>
            </tr>
            <tr>
              <th>Poste</th>
              <td>{{ selectedPayslip.employee.jobTitle ?? '—' }}</td>
            </tr>
            <tr>
              <th>Service</th>
              <td>{{ selectedPayslip.employee.service }}</td>
            </tr>
            <tr>
              <th>Date de paiement</th>
              <td>{{ selectedPayslip.paidAt ? formatShortDate(selectedPayslip.paidAt) : '—' }}</td>
            </tr>
            <tr>
              <th>Mode de paiement</th>
              <td>{{ selectedPayslip.paymentMethod ? PAYMENT_LABELS[selectedPayslip.paymentMethod] ?? selectedPayslip.paymentMethod : '—' }}</td>
            </tr>
            <tr>
              <th>Montant brut</th>
              <td>{{ formatFcfa(selectedPayslip.grossFcfa) }}</td>
            </tr>
            <tr>
              <th>Net payé</th>
              <td><strong>{{ formatFcfa(selectedPayslip.netFcfa) }}</strong></td>
            </tr>
          </tbody>
        </table>
      </div>

      <template #footer>
        <UiButton variant="ghost" @click="closePayslipModal">Fermer</UiButton>
        <UiButton :icon="Download" variant="secondary" @click="downloadPayslip(selectedPayslip.id)">
          Télécharger PDF
        </UiButton>
        <UiButton :icon="Printer" variant="primary" @click="printPayslipFromModal">
          Imprimer
        </UiButton>
      </template>
    </UiFormModal>
  </UiCard>
</template>

<style scoped>
.history-summary {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.85rem;
  padding: 0.65rem 0.85rem;
  border-radius: 10px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  font-size: 0.8125rem;
  color: #475569;
}

.history-filters {
  display: grid;
  grid-template-columns: 1.2fr 1fr 1.2fr;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}

.history-period-chip {
  margin-bottom: 0.75rem;
  font-size: 0.8125rem;
  font-weight: 700;
  color: var(--primary-800);
}

.table-head-actions {
  display: grid;
  grid-template-columns: 1.5fr 1fr auto auto;
  gap: 0.6rem;
  margin-bottom: 0.85rem;
  align-items: end;
}

.payslip-preview {
  width: 100%;
  min-height: 18rem;
}

.payslip-preview__table {
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  overflow: hidden;
}

.payslip-preview__table th {
  width: 32%;
  background: #f8fafc;
  color: #475569;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

@media (max-width: 768px) {
  .history-filters {
    grid-template-columns: 1fr;
  }

  .table-head-actions {
    grid-template-columns: 1fr;
  }
}
</style>
