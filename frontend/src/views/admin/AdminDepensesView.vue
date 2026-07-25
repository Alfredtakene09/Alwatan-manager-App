<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeft, Wallet, Plus, Pencil, Trash2, ListOrdered } from '@lucide/vue'
import api from '@/api/client'
import { canAccessModule, formatFcfa } from '@/lib/roles'
import { confirmAppModal } from '@/lib/api-modal-helper'
import type { AdminExpenseRow } from '@/lib/admin-dashboard'
import { EXPENSE_STATUS_VARIANT, formatShortDate } from '@/lib/admin-dashboard'
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
import { useAuthStore } from '@/stores/auth'
import { useAppI18n } from '@/i18n/useAppI18n'
import { translateTemplate } from '@/lib/dashboard-i18n'

type SectionId = 'liste' | 'indices'
type ListFilter = 'range' | 'all' | 'month'

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

const router = useRouter()
const auth = useAuthStore()
const { uiText, t } = useAppI18n()

const canManageExpenses = computed(() =>
  auth.user ? canAccessModule(auth.user.role, 'admin') : false,
)

const activeSection = ref<SectionId>('liste')
const listFilter = ref<ListFilter>('all')
const dateFrom = ref(todayIso())
const dateTo = ref(todayIso())
const { activeIndices, loadIndices } = useExpenseIndices()

const rows = ref<AdminExpenseRow[]>([])
const loading = ref(false)
const showExpenseModal = ref(false)
const editingExpense = ref<AdminExpenseEdit | null>(null)
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
  if (dateFrom.value > dateTo.value) {
    dateTo.value = dateFrom.value
  }
  listFilter.value = 'range'
  selectSection('liste')
  if (canManageExpenses.value) {
    loadRows()
  }
}

function openCreateExpense() {
  loadIndices()
  editingExpense.value = null
  showExpenseModal.value = true
}

function openEditExpense(row: AdminExpenseRow) {
  editingExpense.value = {
    id: row.id,
    businessDate: row.date,
    label: row.label ?? row.description,
    amountFcfa: row.amountFcfa,
    categoryCode: row.categoryCode,
    status: row.status,
    comment: row.comment ?? '',
    rejectionReason: row.rejectionReason ?? '',
  }
  showExpenseModal.value = true
}

async function deleteExpense(row: AdminExpenseRow) {
  const ok = await confirmAppModal({
    type: 'DELETE',
    title: uiText('Supprimer la dépense'),
    message: translateTemplate('Supprimer définitivement « {name} » ?', {
      name: row.description,
    }),
    confirmLabel: uiText('Supprimer'),
  })
  if (!ok) return
  await api.delete(`/admin/expenses/${row.id}`)
  await loadRows()
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
          {{ t('common.Retour') }}
        </UiButton>
        <UiButton
          v-if="canManageExpenses && activeSection === 'liste'"
          :icon="Plus"
          @click="openCreateExpense"
        >
          {{ uiText('Nouvelle dépense') }}
        </UiButton>
      </template>
    </UiPageHeader>

    <div class="depenses-toolbar-row">
      <CaisseToolbar role="toolbar" :aria-label="uiText('Filtres dépenses')" class="depenses-toolbar-row__filters">
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

        <button
          type="button"
          class="depenses-toolbar__tab"
          :class="{ 'depenses-toolbar__tab--active': activeSection === 'indices' }"
          :aria-selected="activeSection === 'indices'"
          @click="selectSection('indices')"
        >
          <ListOrdered :size="16" />
          {{ uiText('Indices') }}
        </button>
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

    <template v-if="activeSection === 'liste'">
      <UiCard v-if="canManageExpenses" title="Liste des dépenses">
        <div v-if="loading" class="chart-empty">{{ t('common.Chargement…') }}</div>
        <div v-else-if="!rows.length" class="chart-empty">{{ uiText('Aucune dépense') }}</div>
        <table v-else class="admin-table">
          <thead>
            <tr>
              <th>{{ uiText('Date') }}</th>
              <th>{{ uiText('Catégorie') }}</th>
              <th>{{ uiText('Description') }}</th>
              <th>{{ uiText('Montant') }}</th>
              <th>{{ uiText('Statut') }}</th>
              <th>{{ t('common.Actions') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.id">
              <td>{{ formatShortDate(row.date) }}</td>
              <td>{{ row.category }}</td>
              <td>{{ row.description }}</td>
              <td>{{ formatFcfa(row.amountFcfa) }}</td>
              <td>
                <span class="status-badge" :class="`status-badge--${EXPENSE_STATUS_VARIANT[row.status]}`">
                  {{ row.statusLabel }}
                </span>
              </td>
              <td class="actions">
                <UiButton size="sm" variant="ghost" :icon="Pencil" @click="openEditExpense(row)">
                  {{ t('common.Modifier') }}
                </UiButton>
                <UiButton size="sm" variant="danger" :icon="Trash2" @click="deleteExpense(row)">
                  {{ t('common.Supprimer') }}
                </UiButton>
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
      :default-business-date="expenseBusinessDate"
      @go-to-indices="showExpenseModal = false; selectSection('indices')"
      @close="showExpenseModal = false; editingExpense = null"
      @submit="submitExpense"
    />
  </div>
</template>

<style scoped>
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
