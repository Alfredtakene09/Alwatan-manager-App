<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeft, Wallet, Plus, Pencil, ListOrdered, Search, Trash2, ArrowDownLeft, ArrowUpRight } from '@lucide/vue'
import api from '@/api/client'
import { canAccessModule, formatFcfa } from '@/lib/roles'
import type { AdminExpenseRow } from '@/lib/admin-dashboard'
import { formatShortDate } from '@/lib/admin-dashboard'
import AdminExpenseFormModal, {
  type AdminExpenseEdit,
  type AdminExpenseFormPayload,
} from '@/components/admin/AdminExpenseFormModal.vue'
import CaisseToolbar from '@/components/caisse/CaisseToolbar.vue'
import CaisseCompactDateField from '@/components/caisse/CaisseCompactDateField.vue'
import CaisseDepensesPanel from '@/components/caisse/CaisseDepensesPanel.vue'
import ExpenseIndicesPanel from '@/components/caisse/ExpenseIndicesPanel.vue'
import { useExpenseIndices } from '@/composables/useExpenseIndices'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiButton from '@/components/ui/UiButton.vue'
import ExportButtons from '@/components/ui/ExportButtons.vue'
import { exportTableExcel, exportTablePdf, exportTableWord, type ExportColumn } from '@/lib/table-export'
import { useAuthStore } from '@/stores/auth'
import { useAppI18n } from '@/i18n/useAppI18n'
import { confirmAppModal, showApiErrorModal } from '@/lib/api-modal-helper'
import { translateTemplate } from '@/lib/dashboard-i18n'

type SectionId = 'liste' | 'indices'
type ListFilter = 'range' | 'all' | 'month'

function todayIso() {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

const router = useRouter()
const auth = useAuthStore()
const { uiText } = useAppI18n()

const canManageExpenses = computed(() =>
  auth.user ? canAccessModule(auth.user.role, 'admin') : false,
)

const activeSection = ref<SectionId>('liste')
const listFilter = ref<ListFilter>('all')
const dateFrom = ref(todayIso())
const dateTo = ref(todayIso())
const { activeIndices, loadIndices } = useExpenseIndices()

const rows = ref<AdminExpenseRow[]>([])
const search = ref('')

function normalizeText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

const flowFilter = ref<'all' | 'ENTREE' | 'SORTIE'>('all')
const dateFromInitialized = ref(false)

const filteredRows = computed(() => {
  const query = normalizeText(search.value.trim())
  const byFlow =
    flowFilter.value === 'all'
      ? rows.value
      : rows.value.filter((row) => row.flow === flowFilter.value)
  if (!query) return byFlow
  return byFlow.filter((row) =>
    normalizeText(
      [
        row.description,
        row.category,
        row.comment ?? '',
        row.flow === 'ENTREE' ? 'entrée' : 'sortie',
        formatShortDate(row.date),
        String(row.amountFcfa),
        formatFcfa(row.amountFcfa),
      ].join(' '),
    ).includes(query),
  )
})
const loading = ref(false)
const showExpenseModal = ref(false)
const editingExpense = ref<AdminExpenseEdit | null>(null)
const createFlow = ref<'SORTIE' | 'ENTREE'>('SORTIE')
const expenseSaving = ref(false)

const expenseSummary = ref({
  countLabel: 'Aucune dépense',
  totalLabel: 'Total',
  totalFcfa: 0,
  show: false,
})

function onExpenseSummaryUpdate(payload: {
  countLabel: string
  totalLabel: string
  totalFcfa: number
  show: boolean
}) {
  expenseSummary.value = payload
}

const expenseBusinessDate = computed(() =>
  listFilter.value === 'range' ? dateTo.value : todayIso(),
)

const pageSubtitle = computed(() => {
  if (activeSection.value === 'indices') {
    return 'Motifs prédéfinis proposés dans le formulaire de dépense'
  }
  if (canManageExpenses.value) {
    return 'Suivi et validation des dépenses de la clinique'
  }
  return 'Dépenses de la clinique payées en caisse (réception ou comptabilité)'
})

function selectSection(section: SectionId) {
  activeSection.value = section
}

function onIndicesChanged() {
  loadIndices()
}

async function loadRows() {
  if (listFilter.value === 'range' && dateFrom.value > dateTo.value) {
    dateTo.value = dateFrom.value
  }
  loading.value = true
  try {
    const params =
      listFilter.value === 'all'
        ? { filter: 'all' }
        : listFilter.value === 'month'
          ? { filter: 'month' }
          : { from: dateFrom.value, to: dateTo.value }
    const { data } = await api.get<AdminExpenseRow[]>('/admin/expenses', { params })
    rows.value = data
    if (!dateFromInitialized.value && listFilter.value === 'all') {
      dateFromInitialized.value = true
      const first = data.map((row) => row.date.slice(0, 10)).sort()[0]
      if (first) dateFrom.value = first
    }
  } finally {
    loading.value = false
  }
}

function setListFilter(next: ListFilter) {
  listFilter.value = next
  selectSection('liste')
  if (canManageExpenses.value) {
    loadRows()
  }
}

function onDateRangeChange() {
  if (!dateFrom.value) dateFrom.value = todayIso()
  if (!dateTo.value) dateTo.value = todayIso()
  if (dateFrom.value > dateTo.value) {
    dateTo.value = dateFrom.value
  }
  listFilter.value = 'range'
  selectSection('liste')
  if (canManageExpenses.value) {
    loadRows()
  }
}

function openCreateExpense(flow: 'SORTIE' | 'ENTREE' = 'SORTIE') {
  loadIndices()
  createFlow.value = flow
  editingExpense.value = null
  showExpenseModal.value = true
}

function openEditExpense(row: AdminExpenseRow) {
  if (row.source === 'payroll') return
  editingExpense.value = {
    id: row.id,
    businessDate: row.date,
    label: row.label ?? row.description,
    amountFcfa: row.amountFcfa,
    categoryCode: row.categoryCode,
    flow: row.flow,
    status: row.status,
    comment: row.comment ?? '',
    rejectionReason: row.rejectionReason ?? '',
  }
  showExpenseModal.value = true
}

const deletingId = ref<string | null>(null)

/** Supprime la ligne : la somme sort des totaux, du solde de caisse et du tableau de bord. */
async function deleteExpense(row: AdminExpenseRow) {
  if (row.source === 'payroll' || deletingId.value) return
  const isPurchase = (row.label ?? row.description ?? '').startsWith('Achat pharmacie')
  const confirmed = await confirmAppModal({
    title: uiText('Supprimer la ligne'),
    message:
      translateTemplate('« {label} » ({amount}) sera supprimée et retirée des totaux et du solde de caisse.', {
        label: row.label ?? row.description,
        amount: formatFcfa(row.amountFcfa),
      }) +
      (isPurchase ? ` ${uiText('Le stock pharmacie de cette facture n’est pas modifié.')}` : ''),
    confirmLabel: uiText('Supprimer'),
  })
  if (!confirmed) return
  deletingId.value = row.id
  try {
    await api.delete(`/admin/expenses/${row.id}`)
    await loadRows()
  } catch (error) {
    await showApiErrorModal(error, uiText('Suppression impossible.'))
  } finally {
    deletingId.value = null
  }
}

async function submitExpense(payload: AdminExpenseFormPayload) {
  expenseSaving.value = true
  try {
    if (editingExpense.value?.id) {
      await api.put(`/admin/expenses/${editingExpense.value.id}`, payload)
    } else {
      await api.post('/admin/expenses', payload)
    }
    showExpenseModal.value = false
    editingExpense.value = null
    await loadRows()
  } finally {
    expenseSaving.value = false
  }
}

const expensePeriodLabel = computed(() => {
  if (listFilter.value === 'all') return uiText('toutes les périodes')
  if (listFilter.value === 'month') return uiText('Ce mois')
  if (dateFrom.value === dateTo.value) return formatShortDate(dateFrom.value)
  return `${formatShortDate(dateFrom.value)} – ${formatShortDate(dateTo.value)}`
})

/** Totaux de la liste affichée : période, type et recherche appliqués, lignes rejetées exclues. */
const flowTotals = computed(() => {
  const totals = { entreeFcfa: 0, entreeCount: 0, sortieFcfa: 0, sortieCount: 0 }
  for (const row of filteredRows.value) {
    if (row.status === 'REJECTED') continue
    if (row.flow === 'ENTREE') {
      totals.entreeFcfa += row.amountFcfa
      totals.entreeCount += 1
    } else {
      totals.sortieFcfa += row.amountFcfa
      totals.sortieCount += 1
    }
  }
  return totals
})

const expenseExportColumns: ExportColumn<AdminExpenseRow>[] = [
  { header: 'Date', value: (row) => formatShortDate(row.date) },
  { header: 'Catégorie', value: (row) => row.category },
  { header: 'Type', value: (row) => (row.flow === 'ENTREE' ? 'Entrée' : 'Sortie') },
  { header: 'Description', value: (row) => row.description },
  { header: 'Montant', value: (row) => formatFcfa(row.amountFcfa) },
  { header: 'Commentaire', value: (row) => row.comment?.trim() || '—' },
]

function expenseExportShared() {
  return {
    captionRows: [
      { label: 'Période', value: expensePeriodLabel.value },
      { label: 'Total des entrées', value: formatFcfa(flowTotals.value.entreeFcfa) },
      { label: 'Total des sorties', value: formatFcfa(flowTotals.value.sortieFcfa) },
    ],
  }
}

function exportExpensesPdf() {
  exportTablePdf(uiText('Dépenses'), expenseExportColumns, filteredRows.value, expenseExportShared())
}

function exportExpensesExcel() {
  exportTableExcel(uiText('Dépenses'), expenseExportColumns, filteredRows.value, expenseExportShared())
}

function exportExpensesWord() {
  void exportTableWord(uiText('Dépenses'), expenseExportColumns, filteredRows.value, expenseExportShared())
}

function goBack() {
  if (window.history.state?.back) {
    router.back()
    return
  }
  router.push(canManageExpenses.value ? '/dashboard' : '/reception')
}

watch(activeSection, (section) => {
  if (section === 'liste' && canManageExpenses.value) {
    loadRows()
  }
})

onMounted(() => {
  loadIndices()
  if (canManageExpenses.value) {
    loadRows()
  }
})
</script>

<template>
  <div class="admin-page depenses-page">
    <UiPageHeader title="Gestion des dépenses" :subtitle="pageSubtitle" :icon="Wallet">
      <template #actions>
        <UiButton variant="ghost" size="sm" :icon="ArrowLeft" @click="goBack">
          {{ uiText('Retour') }}
        </UiButton>
        <ExportButtons
          v-if="canManageExpenses && activeSection === 'liste'"
          :disabled="loading || !filteredRows.length"
          @pdf="exportExpensesPdf"
          @excel="exportExpensesExcel"
          @word="exportExpensesWord"
        />
        <UiButton
          v-if="canManageExpenses && activeSection === 'liste'"
          :icon="Plus"
          @click="openCreateExpense()"
        >
          {{ uiText('Nouvelle saisie') }}
        </UiButton>
      </template>
    </UiPageHeader>

    <div class="depenses-bar">
    <div class="depenses-toolbar-row">
      <CaisseToolbar role="toolbar" :aria-label="uiText('Filtres dépenses')" class="depenses-toolbar-row__filters">
        <button
          type="button"
          class="depenses-toolbar__tab"
          :class="{ 'depenses-toolbar__tab--active': activeSection === 'liste' && listFilter === 'all' }"
          :aria-selected="activeSection === 'liste' && listFilter === 'all'"
          @click="setListFilter('all')"
        >
          {{ uiText('Toutes') }}
        </button>
        <template v-if="canManageExpenses">
          <button
            type="button"
            class="depenses-toolbar__tab"
            :class="{ 'depenses-toolbar__tab--active': activeSection === 'liste' && listFilter === 'month' }"
            :aria-selected="activeSection === 'liste' && listFilter === 'month'"
            @click="setListFilter('month')"
          >
            {{ uiText('Ce mois') }}
          </button>
        </template>

        <CaisseCompactDateField
          v-model="dateFrom"
          :label="uiText('Du')"
          :disabled="activeSection === 'indices'"
          :inactive="activeSection === 'indices' || listFilter !== 'range'"
          @update:model-value="onDateRangeChange"
        />
        <CaisseCompactDateField
          v-model="dateTo"
          :label="uiText('Au')"
          :disabled="activeSection === 'indices'"
          :inactive="activeSection === 'indices' || listFilter !== 'range'"
          @update:model-value="onDateRangeChange"
        />

        <select
          v-if="canManageExpenses"
          v-model="flowFilter"
          class="depenses-toolbar__select"
          :aria-label="uiText('Type')"
          :disabled="activeSection === 'indices'"
        >
          <option value="all">{{ uiText('Entrées et sorties') }}</option>
          <option value="ENTREE">{{ uiText('Entrée') }}</option>
          <option value="SORTIE">{{ uiText('Sortie') }}</option>
        </select>
      </CaisseToolbar>

      <div
        v-if="!canManageExpenses && activeSection === 'liste' && expenseSummary.show"
        class="depenses-toolbar-row__summary"
        :aria-label="uiText('Synthèse des dépenses')"
      >
        <span class="depenses-toolbar-row__summary-count">{{ expenseSummary.countLabel }}</span>
        <strong class="depenses-toolbar-row__summary-total">
          {{ expenseSummary.totalLabel }} : {{ formatFcfa(expenseSummary.totalFcfa) }}
        </strong>
      </div>
    </div>

    <button
      type="button"
      class="depenses-toolbar__tab depenses-bar__indices"
      :class="{ 'depenses-toolbar__tab--active': activeSection === 'indices' }"
      :aria-selected="activeSection === 'indices'"
      @click="selectSection('indices')"
    >
      <ListOrdered :size="16" />
      {{ uiText('Indices') }}
    </button>
    </div>

    <template v-if="activeSection === 'liste'">
      <UiCard v-if="canManageExpenses" title="Liste des dépenses">
        <div class="depenses-list-head">
          <div class="depenses-search">
            <Search :size="16" class="depenses-search__icon" />
            <input
              v-model="search"
              type="search"
              class="depenses-search__input"
              :placeholder="uiText('Rechercher une dépense…')"
              :aria-label="uiText('Rechercher une dépense…')"
            />
          </div>
          <div class="flow-totals" :aria-label="uiText('Synthèse des dépenses')">
            <div v-if="flowFilter !== 'SORTIE'" class="flow-total flow-total--in">
              <ArrowDownLeft :size="16" class="flow-total__icon" />
              <span class="flow-total__label">{{ uiText('Total des entrées') }}</span>
              <strong class="flow-total__amount">{{ formatFcfa(flowTotals.entreeFcfa) }}</strong>
              <span class="flow-total__count">({{ flowTotals.entreeCount }})</span>
            </div>
            <div v-if="flowFilter !== 'ENTREE'" class="flow-total flow-total--out">
              <ArrowUpRight :size="16" class="flow-total__icon" />
              <span class="flow-total__label">{{ uiText('Total des sorties') }}</span>
              <strong class="flow-total__amount">{{ formatFcfa(flowTotals.sortieFcfa) }}</strong>
              <span class="flow-total__count">({{ flowTotals.sortieCount }})</span>
            </div>
          </div>
        </div>
        <div v-if="loading" class="chart-empty">{{ uiText('Chargement…') }}</div>
        <div v-else-if="!filteredRows.length" class="chart-empty">
          {{
            search.trim()
              ? uiText('Aucun résultat')
              : listFilter === 'range'
                ? uiText('Aucune dépense pour cette date')
                : uiText('Aucune dépense')
          }}
        </div>
        <table v-else class="admin-table">
          <thead>
            <tr>
              <th>{{ uiText('Date') }}</th>
              <th>{{ uiText('Catégorie') }}</th>
              <th>{{ uiText('Type') }}</th>
              <th>{{ uiText('Description') }}</th>
              <th>{{ uiText('Montant') }}</th>
              <th>{{ uiText('Actions') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in filteredRows" :key="row.id">
              <td>{{ formatShortDate(row.date) }}</td>
              <td>{{ row.category }}</td>
              <td :class="row.flow === 'ENTREE' ? 'flow-in' : 'flow-out'">
                {{ row.flow === 'ENTREE' ? uiText('Entrée') : uiText('Sortie') }}
              </td>
              <td>{{ row.description }}</td>
              <td>{{ formatFcfa(row.amountFcfa) }}</td>
              <td class="actions">
                <template v-if="row.source !== 'payroll'">
                <UiButton
                  size="sm"
                  variant="ghost"
                  :icon="Pencil"
                  :title="uiText('Modifier')"
                  :aria-label="uiText('Modifier')"
                  @click="openEditExpense(row)"
                />
                <UiButton
                  size="sm"
                  variant="ghost"
                  class="action-delete"
                  :icon="Trash2"
                  :title="uiText('Supprimer')"
                  :aria-label="uiText('Supprimer')"
                  :loading="deletingId === row.id"
                  :disabled="!!deletingId"
                  @click="deleteExpense(row)"
                />
                </template>
                <span v-else class="text-muted">{{ uiText('Paie versée') }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </UiCard>

      <CaisseDepensesPanel
        v-else
        :show-header="false"
        :show-date-filter="false"
        external-summary
        deactivate-mode
        v-model:business-date-from="dateFrom"
        v-model:business-date-to="dateTo"
        :list-filter="listFilter"
        :active-indices="activeIndices"
        @summary-update="onExpenseSummaryUpdate"
      />
    </template>

    <ExpenseIndicesPanel v-else @changed="onIndicesChanged" />

    <AdminExpenseFormModal
      :open="showExpenseModal"
      :saving="expenseSaving"
      :editing="editingExpense"
      :indices="activeIndices"
      :default-flow="editingExpense?.flow ?? createFlow"
      :default-business-date="expenseBusinessDate"
      @go-to-indices="showExpenseModal = false; selectSection('indices')"
      @close="showExpenseModal = false; editingExpense = null"
      @submit="submitExpense"
    />
  </div>
</template>

<style scoped>
.depenses-list-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  margin-bottom: 0.75rem;
}

.depenses-search {
  position: relative;
  flex: 1 1 16rem;
  max-width: 22rem;
}

.flow-totals {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.flow-total {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.4rem 0.75rem;
  border-radius: var(--radius-sm);
  border: 1px solid;
  font-size: 0.8125rem;
  white-space: nowrap;
}

.flow-total--in {
  background: #f0fdf4;
  border-color: #bbf7d0;
  color: #15803d;
}

.flow-total--out {
  background: #fef2f2;
  border-color: #fecaca;
  color: #b91c1c;
}

.flow-total__label {
  font-weight: 600;
  color: var(--text-muted);
}

.flow-total__amount {
  font-size: 0.9rem;
}

.flow-total__count {
  font-size: 0.75rem;
  color: var(--text-muted);
}

.depenses-search__icon {
  position: absolute;
  top: 50%;
  left: 0.65rem;
  transform: translateY(-50%);
  color: var(--text-muted);
  pointer-events: none;
}

.depenses-search__input {
  width: 100%;
  padding: 0.5rem 0.75rem 0.5rem 2.1rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-card);
  color: var(--text);
  font-size: 0.875rem;
}

.depenses-search__input:focus {
  outline: none;
  border-color: var(--primary-400);
}

.flow-out {
  background: #fee2e2;
  color: #b91c1c;
  font-weight: 600;
}

.flow-in {
  background: #dcfce7;
  color: #15803d;
  font-weight: 600;
}

.admin-page {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.admin-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
}

.admin-table th,
.admin-table td {
  padding: 0.6rem 0.5rem;
  border-bottom: 1px solid var(--border);
  text-align: left;
}

.actions {
  display: flex;
  gap: 0.35rem;
}

.actions :deep(.action-delete) {
  color: #be123c;
}

.status-badge {
  display: inline-flex;
  padding: 0.15rem 0.5rem;
  border-radius: 999px;
  font-size: 0.6875rem;
  font-weight: 600;
}

.status-badge--green { background: #dcfce7; color: #166534; }
.status-badge--amber { background: #fef3c7; color: #b45309; }
.status-badge--rose { background: #ffe4e6; color: #be123c; }

.depenses-bar {
  display: flex;
  align-items: stretch;
  gap: 0.65rem;
  width: 100%;
}

.depenses-bar .depenses-toolbar-row {
  flex: 1 1 auto;
  width: auto;
  min-width: 0;
}

.depenses-bar__indices {
  flex: 0 0 auto;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface-muted, #eef2e6);
}

.depenses-toolbar__select {
  min-height: 2.25rem;
  padding: 0 0.6rem;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: #fff;
  color: var(--text);
  font-family: inherit;
  font-size: 0.8125rem;
  font-weight: 700;
}

.depenses-toolbar-row {
  display: flex;
  align-items: stretch;
  gap: 0.65rem;
  width: 100%;
  padding: 0.3rem;
  border-radius: 12px;
  background: var(--surface-muted, #eef2e6);
  border: 1px solid var(--border);
}

.depenses-toolbar-row__filters {
  flex: 0 0 auto;
}

.depenses-toolbar-row__filters:deep(.caisse-toolbar) {
  width: auto;
  padding: 0;
  border: none;
  background: transparent;
}

.depenses-toolbar-row__summary {
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.85rem;
  min-width: 0;
  margin-left: auto;
  padding: 0.45rem 0.85rem;
  border-radius: 9px;
  background: linear-gradient(135deg, #fff8eb 0%, #fff3d6 100%);
  border: 1px solid rgba(245, 158, 11, 0.25);
  white-space: nowrap;
}

.depenses-toolbar-row__summary-count {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-muted);
}

.depenses-toolbar-row__summary-total {
  font-size: 0.9rem;
  color: #92400e;
}

.depenses-toolbar__tab {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  min-height: 2.25rem;
  padding: 0.45rem 0.9rem;
  border: none;
  border-radius: 9px;
  background: transparent;
  color: var(--text-muted);
  font-family: inherit;
  font-size: 0.8125rem;
  font-weight: 700;
  line-height: 1.2;
  white-space: nowrap;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
}

.depenses-toolbar__tab--active {
  background: #fff;
  color: var(--primary-800);
  box-shadow: 0 1px 4px rgba(15, 23, 42, 0.08);
}

@media (max-width: 960px) {
  .depenses-bar {
    flex-direction: column;
  }

  .depenses-toolbar-row {
    flex-direction: column;
    align-items: stretch;
  }

  .depenses-toolbar-row__summary {
    justify-content: space-between;
    white-space: normal;
  }
}

@media (max-width: 720px) {
  .depenses-toolbar__tab {
    flex: 1 1 auto;
    justify-content: center;
  }
}
</style>
