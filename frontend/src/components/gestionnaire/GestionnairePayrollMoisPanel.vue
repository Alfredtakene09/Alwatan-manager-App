<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import axios from 'axios'
import {
  CalendarDays,
  CircleDollarSign,
  FileText,
  ClipboardList,
  Users,
  Wallet,
  CheckCircle2,
  Search,
  Printer,
  Download,
} from '@lucide/vue'
import api from '@/api/client'
import { formatFcfa } from '@/lib/roles'
import { PAYROLL_STATUS_LABEL } from '@/lib/admin-dashboard'
import { confirmAppModal, showSuccessModal, showApiErrorModal } from '@/lib/api-modal-helper'
import UiCard from '@/components/ui/UiCard.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import CaisseToolbar from '@/components/caisse/CaisseToolbar.vue'
import GestionnairePayrollPaymentModal, {
  type PayrollPaymentPayload,
  type PayrollPaymentTarget,
} from '@/components/gestionnaire/GestionnairePayrollPaymentModal.vue'
import GestionnaireRowAction from '@/components/gestionnaire/GestionnaireRowAction.vue'
import GestionnaireRowActionGroup from '@/components/gestionnaire/GestionnaireRowActionGroup.vue'
import { buildClinicPrintHeader, openPrintDocument } from '@/lib/print-document'
import '@/assets/gestionnaire-page.css'

type PayrollRow = PayrollPaymentTarget & {
  status: 'PENDING' | 'PAID' | 'LATE'
  pendingAdvancesFcfa?: number
}

type PayrollResponse = {
  year: number
  month: number
  prepared: boolean
  eligibleCount: number
  paidCount: number
  unpaidCount: number
  unpaidNetFcfa: number
  rows: PayrollRow[]
}

type StatusFilter = 'all' | 'unpaid' | 'PAID' | 'PENDING' | 'LATE'

const props = defineProps<{
  year: number
  month: number
}>()

const emit = defineEmits<{
  'update:period': [year: number, month: number]
  paid: []
}>()

const payload = ref<PayrollResponse | null>(null)
const loading = ref(false)
const preparing = ref(false)
const unpreparing = ref(false)
const showPayModal = ref(false)
const payTarget = ref<PayrollPaymentTarget | null>(null)
const paySaving = ref(false)
const payError = ref('')

const statusFilter = ref<StatusFilter>('unpaid')
const serviceFilter = ref('all')
const searchQuery = ref('')
const tableFilter = ref('')
const exportScope = ref<'all' | 'selected'>('all')
const selectedIds = ref<string[]>([])

const periodInput = computed({
  get() {
    return `${props.year}-${String(props.month).padStart(2, '0')}`
  },
  set(value: string) {
    const [y, m] = value.split('-').map(Number)
    if (Number.isFinite(y) && Number.isFinite(m) && m >= 1 && m <= 12) {
      emit('update:period', y, m)
    }
  },
})

const periodLabel = computed(() =>
  new Date(props.year, props.month - 1, 1).toLocaleDateString('fr-FR', {
    month: 'long',
    year: 'numeric',
  }),
)

const rows = computed(() => payload.value?.rows ?? [])

const serviceOptions = computed(() => {
  const set = new Set(rows.value.map((row) => row.employee.service))
  return ['all', ...[...set].sort((a, b) => a.localeCompare(b, 'fr'))]
})

const filteredRows = computed(() => {
  const q = `${searchQuery.value} ${tableFilter.value}`.trim().toLowerCase()
  return rows.value.filter((row) => {
    if (statusFilter.value === 'unpaid' && row.status === 'PAID') return false
    if (statusFilter.value !== 'all' && statusFilter.value !== 'unpaid') {
      if (row.status !== statusFilter.value) return false
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

const paidCount = computed(() => payload.value?.paidCount ?? 0)
const unpaidCount = computed(() => payload.value?.unpaidCount ?? 0)
const totalCount = computed(() => rows.value.length)
const progress = computed(() =>
  totalCount.value ? Math.round((paidCount.value / totalCount.value) * 100) : 0,
)
const isComplete = computed(
  () => payload.value?.prepared && totalCount.value > 0 && unpaidCount.value === 0,
)
const unpaidNetTotal = computed(() => payload.value?.unpaidNetFcfa ?? 0)
const canUnprepare = computed(() => payload.value?.prepared && paidCount.value === 0)

async function loadPayroll() {
  loading.value = true
  try {
    const { data } = await api.get<PayrollResponse>('/gestionnaire/payroll', {
      params: { year: props.year, month: props.month },
    })
    payload.value = data
  } finally {
    loading.value = false
  }
}

async function preparePayroll() {
  preparing.value = true
  try {
    const { data } = await api.post<PayrollResponse>('/gestionnaire/payroll/prepare', {
      year: props.year,
      month: props.month,
    })
    payload.value = data
    await showSuccessModal(
      'Paie préparée',
      `${data.rows.length} fiche(s) générée(s) pour ${periodLabel.value}.`,
    )
  } catch (error) {
    const message =
      axios.isAxiosError(error) && typeof error.response?.data?.error === 'string'
        ? error.response.data.error
        : 'Impossible de préparer la paie.'
    await showApiErrorModal(error, message)
  } finally {
    preparing.value = false
  }
}

async function unpreparePayroll() {
  if (!payload.value?.prepared) return
  const ok = await confirmAppModal({
    type: 'WARNING',
    title: 'Annuler la paie préparée',
    message: `Toutes les fiches de ${periodLabel.value} non payées seront supprimées.`,
    confirmLabel: 'Annuler la paie',
  })
  if (!ok) return

  unpreparing.value = true
  try {
    const { data } = await api.post<PayrollResponse>('/gestionnaire/payroll/unprepare', {
      year: props.year,
      month: props.month,
    })
    payload.value = data
    statusFilter.value = 'unpaid'
    await showSuccessModal('Paie annulée', `La préparation de ${periodLabel.value} a été annulée.`)
  } catch (error) {
    const message =
      axios.isAxiosError(error) && typeof error.response?.data?.error === 'string'
        ? error.response.data.error
        : 'Impossible d’annuler la paie préparée.'
    await showApiErrorModal(error, message)
  } finally {
    unpreparing.value = false
  }
}

function openPayModal(row: PayrollRow) {
  payTarget.value = row
  payError.value = ''
  showPayModal.value = true
}

function closePayModal() {
  showPayModal.value = false
  payTarget.value = null
  payError.value = ''
}

async function submitPay(form: PayrollPaymentPayload) {
  if (!payTarget.value) return
  const employeeName = payTarget.value.employee.fullName
  paySaving.value = true
  payError.value = ''
  try {
    await api.post(`/gestionnaire/payroll/${payTarget.value.id}/pay`, form)
    closePayModal()
    await showSuccessModal('Paiement enregistré', `Salaire de ${employeeName} validé.`)
    await loadPayroll()
    emit('paid')
  } catch (error) {
    await showApiErrorModal(error, 'Le paiement a échoué.')
  } finally {
    paySaving.value = false
  }
}

function payslipUrl(id: string) {
  return `/api/gestionnaire/payroll/${id}/payslip.pdf`
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

function payrollRowsToTableHtml() {
  const rowsHtml = exportRows.value
    .map(
      (row) => `
      <tr>
        <td>${row.employee.fullName}</td>
        <td>${row.employee.jobTitle ?? '—'}</td>
        <td>${row.employee.service}</td>
        <td>${formatFcfa(row.grossFcfa)}</td>
        <td>${(row.pendingAdvancesFcfa ?? 0) > 0 ? `-${formatFcfa(row.pendingAdvancesFcfa ?? 0)}` : '—'}</td>
        <td>${formatFcfa(row.netFcfa)}</td>
        <td>${PAYROLL_STATUS_LABEL[row.status]}</td>
      </tr>`,
    )
    .join('')

  return `
    ${buildClinicPrintHeader(`Fiches de paie — ${periodLabel.value}`)}
    <table>
      <thead>
        <tr>
          <th>Employé</th><th>Poste</th><th>Service</th><th>Brut</th><th>Avances</th><th>Net</th><th>Statut</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  `
}

function printPayrollRows() {
  if (!exportRows.value.length) return
  openPrintDocument('Fiches de paie', payrollRowsToTableHtml(), { autoPrint: true, pageSize: 'A4' })
}

function exportPayrollPdf() {
  if (!exportRows.value.length) return
  openPrintDocument('Fiches de paie (PDF)', payrollRowsToTableHtml(), { autoPrint: true, pageSize: 'A4' })
}

watch(
  () => [props.year, props.month] as const,
  () => {
    void loadPayroll()
  },
  { immediate: true },
)

watch(filteredRows, () => {
  const visible = new Set(filteredRows.value.map((row) => row.id))
  selectedIds.value = selectedIds.value.filter((id) => visible.has(id))
})

defineExpose({ reload: loadPayroll })
</script>

<template>
  <UiCard
    title="Fiches de paie"
    :description="`Paie de ${periodLabel} — préparez, filtrez et validez les salaires`"
  >
    <div class="payroll-toolbar">
      <div class="payroll-toolbar__period">
        <label class="payroll-toolbar__period-label">
          <CalendarDays :size="16" />
          Période de paie
        </label>
        <input v-model="periodInput" type="month" class="payroll-toolbar__month-input" />
      </div>
      <div class="payroll-toolbar__actions">
        <UiButton
          variant="primary"
          :icon="ClipboardList"
          :disabled="preparing || loading || unpreparing"
          @click="preparePayroll"
        >
          {{ preparing ? 'Préparation…' : 'Préparer la paie du mois' }}
        </UiButton>
        <UiButton
          v-if="payload?.prepared"
          variant="danger"
          :disabled="!canUnprepare || unpreparing || preparing || loading"
          @click="unpreparePayroll"
        >
          {{ unpreparing ? 'Annulation…' : 'Annuler la paie préparée' }}
        </UiButton>
      </div>
    </div>

    <div v-if="payload?.prepared" class="payroll-kpis">
      <article class="payroll-kpi payroll-kpi--warn">
        <Users :size="18" />
        <div>
          <p class="payroll-kpi__label">Non payés</p>
          <p class="payroll-kpi__value">{{ unpaidCount }}</p>
        </div>
      </article>
      <article class="payroll-kpi">
        <Wallet :size="18" />
        <div>
          <p class="payroll-kpi__label">Net restant à verser</p>
          <p class="payroll-kpi__value">{{ formatFcfa(unpaidNetTotal) }}</p>
        </div>
      </article>
      <article class="payroll-kpi payroll-kpi--ok">
        <CheckCircle2 :size="18" />
        <div>
          <p class="payroll-kpi__label">Payés</p>
          <p class="payroll-kpi__value">{{ paidCount }}/{{ totalCount }}</p>
        </div>
      </article>
    </div>

    <div v-if="payload?.prepared" class="payroll-progress">
      <div class="payroll-progress__bar">
        <div class="payroll-progress__fill" :style="{ width: `${progress}%` }" />
      </div>
      <span>{{ paidCount }}/{{ totalCount }} employés payés — {{ periodLabel }}</span>
    </div>

    <div
      v-if="isComplete"
      class="payroll-complete-banner"
      role="status"
    >
      <CheckCircle2 :size="20" />
      <div>
        <strong>Paie du mois terminée</strong>
        <p>Tous les salaires de {{ periodLabel }} sont payés. Consultez l'onglet Historique.</p>
      </div>
    </div>

    <div v-if="payload?.prepared" class="payroll-filters">
      <CaisseToolbar aria-label="Filtres paie">
        <button
          v-for="option in [
            { id: 'unpaid', label: 'Non payés' },
            { id: 'all', label: 'Tous' },
            { id: 'PENDING', label: 'En attente' },
            { id: 'LATE', label: 'En retard' },
            { id: 'PAID', label: 'Payés' },
          ]"
          :key="option.id"
          type="button"
          class="payroll-filters__tab"
          :class="{ 'payroll-filters__tab--active': statusFilter === option.id }"
          @click="statusFilter = option.id as StatusFilter"
        >
          {{ option.label }}
        </button>
      </CaisseToolbar>

      <div class="payroll-filters__fields">
        <UiSelect v-model="serviceFilter" label="Service">
          <option value="all">Tous les services</option>
          <option v-for="service in serviceOptions.filter((s) => s !== 'all')" :key="service" :value="service">
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
    </div>

    <div v-if="payload?.prepared && filteredRows.length" class="table-head-actions">
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
      <UiButton :icon="Printer" variant="ghost" :disabled="!exportRows.length" @click="printPayrollRows">
        Impression
      </UiButton>
      <UiButton :icon="Download" variant="secondary" :disabled="!exportRows.length" @click="exportPayrollPdf">
        PDF
      </UiButton>
    </div>

    <div v-if="loading" class="chart-empty">Chargement…</div>
    <div v-else-if="!payload?.prepared" class="payroll-empty">
      <ClipboardList :size="40" />
      <h3>Aucune paie préparée pour {{ periodLabel }}</h3>
      <p>
        Cliquez sur « Préparer la paie du mois » pour générer les fiches des employés éligibles
        <span v-if="payload?.eligibleCount">({{ payload.eligibleCount }} salarié(s) avec salaire fixe)</span>.
      </p>
      <UiButton variant="primary" :icon="ClipboardList" :disabled="preparing" @click="preparePayroll">
        Préparer la paie
      </UiButton>
    </div>
    <div v-else-if="!filteredRows.length" class="chart-empty">
      Aucune fiche ne correspond aux filtres sélectionnés.
    </div>
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
          <th>Employé</th>
          <th>Poste</th>
          <th>Service</th>
          <th>Brut</th>
          <th>Avances</th>
          <th>Net</th>
          <th>Statut</th>
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
          <td>{{ row.employee.fullName }}</td>
          <td>{{ row.employee.jobTitle ?? '—' }}</td>
          <td>{{ row.employee.service }}</td>
          <td>{{ formatFcfa(row.grossFcfa) }}</td>
          <td>
            <span v-if="(row.pendingAdvancesFcfa ?? 0) > 0" class="advances-deduct">
              -{{ formatFcfa(row.pendingAdvancesFcfa ?? 0) }}
            </span>
            <span v-else>—</span>
          </td>
          <td>{{ formatFcfa(row.netFcfa) }}</td>
          <td>
            <span
              class="status-badge"
              :class="{
                'status-badge--paid': row.status === 'PAID',
                'status-badge--pending': row.status === 'PENDING',
                'status-badge--late': row.status === 'LATE',
              }"
            >
              {{ PAYROLL_STATUS_LABEL[row.status] }}
            </span>
          </td>
          <td class="actions">
            <GestionnaireRowActionGroup>
              <GestionnaireRowAction
                v-if="row.status !== 'PAID'"
                :icon="CircleDollarSign"
                label="Payer"
                variant="success"
                @click="openPayModal(row)"
              />
              <GestionnaireRowAction
                v-if="row.status === 'PAID'"
                :icon="FileText"
                label="Fiche PDF"
                variant="pdf"
                :href="payslipUrl(row.id)"
              />
            </GestionnaireRowActionGroup>
          </td>
        </tr>
      </tbody>
    </table>
  </UiCard>

  <GestionnairePayrollPaymentModal
    :open="showPayModal"
    :target="payTarget"
    :saving="paySaving"
    :error-message="payError"
    @close="closePayModal"
    @submit="submitPay"
  />
</template>

<style scoped>
.payroll-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 0.85rem;
  margin-bottom: 1rem;
}

.payroll-toolbar__actions {
  display: inline-flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.5rem;
}

.payroll-toolbar__period {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.payroll-toolbar__period-label {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.payroll-toolbar__month-input {
  min-height: 2.5rem;
  padding: 0.45rem 0.75rem;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: #fff;
  font-family: inherit;
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--text-primary);
}

.payroll-kpis {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.65rem;
  margin-bottom: 0.85rem;
}

.payroll-kpi {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  padding: 0.75rem 0.85rem;
  border-radius: 12px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  color: #475569;
}

.payroll-kpi--warn {
  background: #fffbeb;
  border-color: #fde68a;
  color: #b45309;
}

.payroll-kpi--ok {
  background: #ecfdf5;
  border-color: #a7f3d0;
  color: #047857;
}

.payroll-kpi__label {
  margin: 0;
  font-size: 0.6875rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  opacity: 0.85;
}

.payroll-kpi__value {
  margin: 0.15rem 0 0;
  font-size: 1.125rem;
  font-weight: 800;
  line-height: 1.1;
}

.payroll-progress {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  margin-bottom: 0.85rem;
  font-size: 0.875rem;
  color: #64748b;
}

.payroll-progress__bar {
  height: 0.6rem;
  border-radius: 999px;
  background: #fef3c7;
  overflow: hidden;
}

.payroll-progress__fill {
  height: 100%;
  background: linear-gradient(90deg, #f59e0b, #d97706);
}

.payroll-complete-banner {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  margin-bottom: 0.85rem;
  padding: 0.85rem 1rem;
  border-radius: 12px;
  background: #ecfdf5;
  border: 1px solid #a7f3d0;
  color: #065f46;
}

.payroll-complete-banner p {
  margin: 0.2rem 0 0;
  font-size: 0.8125rem;
  color: #047857;
}

.payroll-filters {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin-bottom: 0.85rem;
}

.payroll-filters__tab {
  min-height: 2rem;
  padding: 0.35rem 0.75rem;
  border: none;
  border-radius: 9px;
  background: transparent;
  color: var(--text-muted);
  font-family: inherit;
  font-size: 0.75rem;
  font-weight: 700;
  cursor: pointer;
}

.payroll-filters__tab--active {
  background: #fff;
  color: var(--primary-800);
  box-shadow: 0 1px 4px rgba(15, 23, 42, 0.08);
}

.payroll-filters__fields {
  display: grid;
  grid-template-columns: 1fr 1.4fr;
  gap: 0.75rem;
}

.payroll-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.65rem;
  padding: 2rem 1rem;
  text-align: center;
  color: #64748b;
}

.payroll-empty h3 {
  margin: 0;
  font-size: 1rem;
  color: var(--text-primary);
}

.payroll-empty p {
  margin: 0;
  max-width: 28rem;
  font-size: 0.875rem;
  line-height: 1.5;
}

.table-head-actions {
  display: grid;
  grid-template-columns: 1.5fr 1fr auto auto;
  gap: 0.6rem;
  margin-bottom: 0.85rem;
  align-items: end;
}

.advances-deduct {
  color: #b45309;
  font-weight: 700;
}

@media (max-width: 768px) {
  .payroll-kpis {
    grid-template-columns: 1fr;
  }

  .payroll-filters__fields {
    grid-template-columns: 1fr;
  }

  .table-head-actions {
    grid-template-columns: 1fr;
  }

  .payroll-toolbar {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
