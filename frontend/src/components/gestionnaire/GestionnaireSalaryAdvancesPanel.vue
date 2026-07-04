<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import axios from 'axios'
import { Plus, HandCoins, Ban, Search, Printer, Download } from '@lucide/vue'
import api from '@/api/client'
import { formatFcfa } from '@/lib/roles'
import { formatShortDate } from '@/lib/admin-dashboard'
import { confirmAppModal, showApiErrorModal } from '@/lib/api-modal-helper'
import { buildClinicPrintHeader, openPrintDocument } from '@/lib/print-document'
import UiCard from '@/components/ui/UiCard.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import GestionnaireRowAction from '@/components/gestionnaire/GestionnaireRowAction.vue'
import GestionnaireRowActionGroup from '@/components/gestionnaire/GestionnaireRowActionGroup.vue'
import GestionnaireSalaryAdvanceFormModal, {
  type SalaryAdvanceEmployeeOption,
  type SalaryAdvanceFormPayload,
} from '@/components/gestionnaire/GestionnaireSalaryAdvanceFormModal.vue'
import '@/assets/gestionnaire-page.css'

type SalaryAdvanceRow = {
  id: string
  employeeId: string
  amountFcfa: number
  businessDate: string
  comment: string | null
  status: 'PENDING' | 'DEDUCTED' | 'CANCELLED'
  statusLabel: string
  payrollYear: number | null
  payrollMonth: number | null
  recordedByName: string
  employee: {
    id: string
    fullName: string
    jobTitle: string | null
    service: string
  }
}

type StatusFilter = 'all' | 'PENDING' | 'DEDUCTED' | 'CANCELLED'

const rows = ref<SalaryAdvanceRow[]>([])
const employees = ref<SalaryAdvanceEmployeeOption[]>([])
const loading = ref(false)
const saving = ref(false)
const showModal = ref(false)
const formError = ref('')
const statusFilter = ref<StatusFilter>('all')
const searchQuery = ref('')
const tableFilter = ref('')
const exportScope = ref<'all' | 'selected'>('all')
const selectedIds = ref<string[]>([])

const filteredRows = computed(() => {
  const q = `${searchQuery.value} ${tableFilter.value}`.trim().toLowerCase()
  const statusRows =
    statusFilter.value === 'all'
      ? rows.value
      : rows.value.filter((row) => row.status === statusFilter.value)

  return statusRows.filter((row) => {
    if (!q) return true
    const haystack = [
      row.employee.fullName,
      row.employee.jobTitle ?? '',
      row.employee.service,
      row.comment ?? '',
      row.recordedByName,
    ]
      .join(' ')
      .toLowerCase()
    return haystack.includes(q)
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

const pendingTotal = computed(() =>
  rows.value
    .filter((row) => row.status === 'PENDING')
    .reduce((sum, row) => sum + row.amountFcfa, 0),
)

const pendingCount = computed(() => rows.value.filter((row) => row.status === 'PENDING').length)

async function loadEmployees() {
  const { data } = await api.get<Array<{ id: string; firstName: string; lastName: string; jobTitle: string | null }>>(
    '/gestionnaire/employees?forSelection=true',
  )
  employees.value = data.map((row) => ({
    id: row.id,
    fullName: `${row.firstName} ${row.lastName}`.trim(),
    jobTitle: row.jobTitle,
  }))
}

async function loadRows() {
  loading.value = true
  try {
    const { data } = await api.get<SalaryAdvanceRow[]>('/gestionnaire/salary-advances')
    rows.value = data
  } finally {
    loading.value = false
  }
}

function openCreate() {
  formError.value = ''
  showModal.value = true
}

function closeModal() {
  showModal.value = false
  formError.value = ''
}

async function submitForm(payload: SalaryAdvanceFormPayload) {
  saving.value = true
  formError.value = ''
  try {
    await api.post('/gestionnaire/salary-advances', payload)
    closeModal()
    await loadRows()
  } catch (error) {
    formError.value =
      axios.isAxiosError(error) && typeof error.response?.data?.error === 'string'
        ? error.response.data.error
        : 'Enregistrement impossible.'
  } finally {
    saving.value = false
  }
}

async function cancelAdvance(row: SalaryAdvanceRow) {
  const ok = await confirmAppModal({
    type: 'WARNING',
    title: 'Annuler l\'avance',
    message: `Annuler l'avance de ${formatFcfa(row.amountFcfa)} pour ${row.employee.fullName} ?`,
    confirmLabel: 'Annuler l\'avance',
  })
  if (!ok) return
  try {
    await api.patch(`/gestionnaire/salary-advances/${row.id}/cancel`)
    await loadRows()
  } catch (error) {
    await showApiErrorModal(error, 'Annulation impossible.')
  }
}

function payrollPeriodLabel(row: SalaryAdvanceRow) {
  if (!row.payrollYear || !row.payrollMonth) return '—'
  return new Date(row.payrollYear, row.payrollMonth - 1, 1).toLocaleDateString('fr-FR', {
    month: 'long',
    year: 'numeric',
  })
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

function advancesRowsToTableHtml() {
  const rowsHtml = exportRows.value
    .map(
      (row) => `
      <tr>
        <td>${formatShortDate(row.businessDate)}</td>
        <td>${row.employee.fullName}</td>
        <td>${row.employee.service}</td>
        <td>${formatFcfa(row.amountFcfa)}</td>
        <td>${row.statusLabel}</td>
        <td>${payrollPeriodLabel(row)}</td>
        <td>${row.recordedByName}</td>
        <td>${row.comment || '—'}</td>
      </tr>`,
    )
    .join('')

  return `
    ${buildClinicPrintHeader('Avances sur salaire')}
    <table>
      <thead>
        <tr>
          <th>Date</th><th>Employé</th><th>Service</th><th>Montant</th><th>Statut</th><th>Période paie</th><th>Enregistré par</th><th>Commentaire</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  `
}

function printAdvanceRows() {
  if (!exportRows.value.length) return
  openPrintDocument('Avances sur salaire', advancesRowsToTableHtml(), { autoPrint: true, pageSize: 'A4' })
}

function exportAdvancesPdf() {
  if (!exportRows.value.length) return
  openPrintDocument('Avances sur salaire (PDF)', advancesRowsToTableHtml(), {
    autoPrint: true,
    pageSize: 'A4',
  })
}

onMounted(async () => {
  await Promise.all([loadEmployees(), loadRows()])
})

watch(filteredRows, () => {
  const visible = new Set(filteredRows.value.map((row) => row.id))
  selectedIds.value = selectedIds.value.filter((id) => visible.has(id))
})

defineExpose({ reload: loadRows })
</script>

<template>
  <UiCard class="advances-card">
    <div class="advances-card__head">
      <div class="advances-card__intro">
        <div class="advances-card__icon" aria-hidden="true">
          <HandCoins :size="18" />
        </div>
        <div>
          <h2 class="advances-card__title">Avances sur salaire</h2>
          <p class="advances-card__desc">
            {{ pendingCount }} avance(s) en attente — {{ formatFcfa(pendingTotal) }} à déduire
          </p>
        </div>
      </div>
      <UiButton variant="primary" :icon="Plus" @click="openCreate">Nouvelle avance</UiButton>
    </div>

    <div class="advances-filters" role="tablist" aria-label="Filtrer par statut">
      <button
        v-for="option in [
          { id: 'all', label: 'Toutes' },
          { id: 'PENDING', label: 'En attente' },
          { id: 'DEDUCTED', label: 'Déduites' },
          { id: 'CANCELLED', label: 'Annulées' },
        ]"
        :key="option.id"
        type="button"
        class="advances-filters__btn"
        :class="{ 'advances-filters__btn--active': statusFilter === option.id }"
        @click="statusFilter = option.id as StatusFilter"
      >
        {{ option.label }}
      </button>
    </div>

    <div v-if="filteredRows.length" class="table-head-actions">
      <UiInput
        v-model="searchQuery"
        label="Filtrage du tableau"
        placeholder="Nom, service, commentaire…"
        :icon="Search"
      />
      <UiSelect v-model="exportScope" label="Portée">
        <option value="all">Tous les résultats ({{ filteredRows.length }})</option>
        <option value="selected">Sélection ({{ selectedRows.length }})</option>
      </UiSelect>
      <UiButton :icon="Printer" variant="ghost" :disabled="!exportRows.length" @click="printAdvanceRows">
        Impression
      </UiButton>
      <UiButton :icon="Download" variant="secondary" :disabled="!exportRows.length" @click="exportAdvancesPdf">
        PDF
      </UiButton>
    </div>

    <div v-if="loading" class="chart-empty">Chargement…</div>
    <div v-else-if="!filteredRows.length" class="chart-empty">
      Aucune avance enregistrée pour ce filtre.
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
          <th>Date</th>
          <th>Employé</th>
          <th>Service</th>
          <th>Montant</th>
          <th>Statut</th>
          <th>Période paie</th>
          <th>Enregistré par</th>
          <th>Commentaire</th>
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
          <td>{{ formatShortDate(row.businessDate) }}</td>
          <td>
            <strong>{{ row.employee.fullName }}</strong>
            <span v-if="row.employee.jobTitle" class="advances-table__meta">
              {{ row.employee.jobTitle }}
            </span>
          </td>
          <td>{{ row.employee.service }}</td>
          <td>{{ formatFcfa(row.amountFcfa) }}</td>
          <td>
            <span
              class="status-badge"
              :class="{
                'status-badge--pending': row.status === 'PENDING',
                'status-badge--paid': row.status === 'DEDUCTED',
                'status-badge--late': row.status === 'CANCELLED',
              }"
            >
              {{ row.statusLabel }}
            </span>
          </td>
          <td>{{ payrollPeriodLabel(row) }}</td>
          <td>{{ row.recordedByName }}</td>
          <td class="advances-table__comment">{{ row.comment || '—' }}</td>
          <td class="actions">
            <GestionnaireRowActionGroup>
              <GestionnaireRowAction
                v-if="row.status === 'PENDING'"
                :icon="Ban"
                label="Annuler"
                variant="danger"
                @click="cancelAdvance(row)"
              />
            </GestionnaireRowActionGroup>
          </td>
        </tr>
      </tbody>
    </table>
  </UiCard>

  <GestionnaireSalaryAdvanceFormModal
    :open="showModal"
    :employees="employees"
    :saving="saving"
    :error-message="formError"
    @close="closeModal"
    @submit="submitForm"
  />
</template>

<style scoped>
.table-head-actions {
  display: grid;
  grid-template-columns: 1.5fr 1fr auto auto;
  gap: 0.6rem;
  margin-bottom: 0.85rem;
  align-items: end;
}

.advances-card__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1rem;
}

.advances-card__intro {
  display: flex;
  gap: 0.75rem;
  align-items: flex-start;
}

.advances-card__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2.25rem;
  height: 2.25rem;
  border-radius: 10px;
  background: #fef3c7;
  color: #b45309;
}

.advances-card__title {
  margin: 0;
  font-size: 1rem;
  font-weight: 800;
  color: var(--text-primary);
}

.advances-card__desc {
  margin: 0.2rem 0 0;
  font-size: 0.8125rem;
  color: var(--text-muted);
}

.advances-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-bottom: 0.85rem;
}

.advances-filters__btn {
  min-height: 2rem;
  padding: 0.35rem 0.75rem;
  border: 1px solid #e2e8f0;
  border-radius: 999px;
  background: #fff;
  color: #64748b;
  font-family: inherit;
  font-size: 0.75rem;
  font-weight: 700;
  cursor: pointer;
}

.advances-filters__btn--active {
  border-color: #fcd34d;
  background: #fffbeb;
  color: #b45309;
}

.advances-table__meta {
  display: block;
  font-size: 0.75rem;
  color: var(--text-muted);
  font-weight: 500;
}

.advances-table__comment {
  max-width: 12rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

@media (max-width: 720px) {
  .advances-card__head {
    flex-direction: column;
  }

  .table-head-actions {
    grid-template-columns: 1fr;
  }
}
</style>
