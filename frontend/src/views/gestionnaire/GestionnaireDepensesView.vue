<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Wallet, Plus, Receipt, Tags, TrendingDown, ListOrdered, CalendarDays, Pencil, Trash2 } from '@lucide/vue'
import api from '@/api/client'
import { formatFcfa } from '@/lib/roles'
import { formatShortDate } from '@/lib/admin-dashboard'
import { confirmAppModal, showApiErrorModal } from '@/lib/api-modal-helper'
import UiCard from '@/components/ui/UiCard.vue'
import UiButton from '@/components/ui/UiButton.vue'
import CaisseToolbar from '@/components/caisse/CaisseToolbar.vue'
import GestionnaireRowAction from '@/components/gestionnaire/GestionnaireRowAction.vue'
import GestionnaireRowActionGroup from '@/components/gestionnaire/GestionnaireRowActionGroup.vue'
import GestionnaireExpenseFormModal, {
  type ExpenseCategoryOption,
  type GestionnaireExpenseEdit,
  type GestionnaireExpenseFormPayload,
} from '@/components/gestionnaire/GestionnaireExpenseFormModal.vue'
import GestionnaireDepensesCategoriesPanel from '@/components/gestionnaire/GestionnaireDepensesCategoriesPanel.vue'
import '@/assets/gestionnaire-page.css'

type TabId = 'liste' | 'categories'

type ExpenseRow = {
  id: string
  date: string
  category: string
  categoryColor: string | null
  expenseCategoryId: string | null
  description: string
  amountFcfa: number
  beneficiary: string | null
  comment: string | null
  recordedByName: string | null
  recordedByRoleLabel: string | null
}

type ExpenseCategory = ExpenseCategoryOption

const route = useRoute()
const router = useRouter()

const activeTab = ref<TabId>(route.query.tab === 'categories' ? 'categories' : 'liste')
const rows = ref<ExpenseRow[]>([])
const categories = ref<ExpenseCategory[]>([])
const filter = ref<'all' | 'month'>('all')
const loading = ref(false)
const showExpenseModal = ref(false)
const expenseSaving = ref(false)
const editingExpense = ref<GestionnaireExpenseEdit | null>(null)

const totalFcfa = computed(() => rows.value.reduce((sum, row) => sum + row.amountFcfa, 0))
const expenseCount = computed(() => rows.value.length)
const averageFcfa = computed(() =>
  expenseCount.value > 0 ? Math.round(totalFcfa.value / expenseCount.value) : 0,
)

const monthLabel = computed(() =>
  new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }),
)

const pageSubtitle = computed(() =>
  activeTab.value === 'categories'
    ? 'Gestion des dépenses et catégories'
    : 'Enregistrement des sorties de caisse',
)

const filterLabel = computed(() => (filter.value === 'month' ? `Période : ${monthLabel.value}` : 'Toutes les périodes'))

function selectTab(tab: TabId) {
  activeTab.value = tab
}

watch(activeTab, (tab) => {
  router.replace({ query: tab === 'categories' ? { tab: 'categories' } : {} })
  if (tab === 'liste') loadCategories()
})

watch(
  () => route.query.tab,
  (tab) => {
    activeTab.value = tab === 'categories' ? 'categories' : 'liste'
  },
)

async function loadRows() {
  loading.value = true
  try {
    const { data } = await api.get<ExpenseRow[]>(`/gestionnaire/expenses?filter=${filter.value}`)
    rows.value = data
  } finally {
    loading.value = false
  }
}

async function loadCategories() {
  const { data } = await api.get<ExpenseCategory[]>('/gestionnaire/expense-categories')
  categories.value = data
}

function setFilter(next: 'all' | 'month') {
  if (filter.value === next) return
  filter.value = next
  loadRows()
}

function openExpenseModal() {
  editingExpense.value = null
  showExpenseModal.value = true
}

function openEditExpense(row: ExpenseRow) {
  editingExpense.value = {
    id: row.id,
    businessDate: row.date,
    label: row.description,
    amountFcfa: row.amountFcfa,
    expenseCategoryId: row.expenseCategoryId,
    beneficiary: row.beneficiary,
    comment: row.comment,
  }
  showExpenseModal.value = true
}

function closeExpenseModal() {
  showExpenseModal.value = false
  editingExpense.value = null
}

async function deleteExpense(row: ExpenseRow) {
  const ok = await confirmAppModal({
    type: 'DELETE',
    title: 'Supprimer la dépense',
    message: `« ${row.description} » (${formatFcfa(row.amountFcfa)}) sera supprimée définitivement.`,
    confirmLabel: 'Supprimer',
  })
  if (!ok) return
  try {
    await api.delete(`/gestionnaire/expenses/${row.id}`)
    await loadRows()
  } catch (error) {
    await showApiErrorModal(error, 'Suppression impossible.')
  }
}

function buildExpenseFormData(payload: GestionnaireExpenseFormPayload) {
  const formData = new FormData()
  formData.append('businessDate', payload.businessDate)
  formData.append('label', payload.label)
  formData.append('amountFcfa', String(payload.amountFcfa))
  if (payload.expenseCategoryId) {
    formData.append('expenseCategoryId', payload.expenseCategoryId)
  }
  if (payload.beneficiary) {
    formData.append('beneficiary', payload.beneficiary)
  }
  if (payload.comment) {
    formData.append('comment', payload.comment)
  }
  if (payload.receipt) {
    formData.append('receipt', payload.receipt)
  }
  return formData
}

async function submitExpense(payload: GestionnaireExpenseFormPayload) {
  expenseSaving.value = true
  try {
    const formData = buildExpenseFormData(payload)
    if (editingExpense.value?.id) {
      await api.put(`/gestionnaire/expenses/${editingExpense.value.id}`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
    } else {
      await api.post('/gestionnaire/expenses', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
    }
    closeExpenseModal()
    await loadRows()
  } finally {
    expenseSaving.value = false
  }
}

onMounted(async () => {
  await Promise.all([loadCategories(), loadRows()])
})
</script>

<template>
  <div class="gestionnaire-page depenses-page">
    <header class="depenses-hero">
      <div class="depenses-hero__main">
        <div class="depenses-hero__icon" aria-hidden="true">
          <Wallet :size="26" />
        </div>
        <div class="depenses-hero__copy">
          <p class="depenses-hero__eyebrow">Charges & sorties</p>
          <h1 class="depenses-hero__title">Dépenses</h1>
          <p class="depenses-hero__subtitle">{{ pageSubtitle }}</p>
        </div>
      </div>
      <UiButton
        v-if="activeTab === 'liste'"
        :icon="Plus"
        class="depenses-hero__cta"
        @click="openExpenseModal"
      >
        Nouvelle dépense
      </UiButton>
    </header>

    <CaisseToolbar role="tablist" aria-label="Sections dépenses" class="depenses-tabs">
      <button
        type="button"
        class="depenses-toolbar__tab"
        :class="{ 'depenses-toolbar__tab--active': activeTab === 'liste' }"
        :aria-selected="activeTab === 'liste'"
        @click="selectTab('liste')"
      >
        <Receipt :size="16" />
        Liste des dépenses
      </button>
      <button
        type="button"
        class="depenses-toolbar__tab"
        :class="{ 'depenses-toolbar__tab--active': activeTab === 'categories' }"
        :aria-selected="activeTab === 'categories'"
        @click="selectTab('categories')"
      >
        <Tags :size="16" />
        Catégories
      </button>
    </CaisseToolbar>

    <template v-if="activeTab === 'liste'">
      <section class="depenses-kpis" aria-label="Synthèse des dépenses">
        <article class="depenses-kpi depenses-kpi--primary">
          <div class="depenses-kpi__icon">
            <TrendingDown :size="18" />
          </div>
          <div>
            <p class="depenses-kpi__label">Total {{ filter === 'month' ? 'du mois' : 'affiché' }}</p>
            <p class="depenses-kpi__value">{{ loading ? '—' : formatFcfa(totalFcfa) }}</p>
          </div>
        </article>
        <article class="depenses-kpi">
          <div class="depenses-kpi__icon depenses-kpi__icon--neutral">
            <ListOrdered :size="18" />
          </div>
          <div>
            <p class="depenses-kpi__label">Nombre de lignes</p>
            <p class="depenses-kpi__value depenses-kpi__value--sm">{{ loading ? '—' : expenseCount }}</p>
          </div>
        </article>
        <article class="depenses-kpi">
          <div class="depenses-kpi__icon depenses-kpi__icon--neutral">
            <CalendarDays :size="18" />
          </div>
          <div>
            <p class="depenses-kpi__label">Moyenne / ligne</p>
            <p class="depenses-kpi__value depenses-kpi__value--sm">
              {{ loading || !expenseCount ? '—' : formatFcfa(averageFcfa) }}
            </p>
          </div>
        </article>
      </section>

      <UiCard class="depenses-card">
        <div class="depenses-card__head">
          <div>
            <h2 class="depenses-card__title">Historique des sorties</h2>
            <p class="depenses-card__desc">
              Vue consolidée — réception, comptabilité, gestionnaire
            </p>
          </div>
          <div class="depenses-segment" role="group" aria-label="Filtrer par période">
            <button
              type="button"
              class="depenses-segment__btn"
              :class="{ 'depenses-segment__btn--active': filter === 'all' }"
              @click="setFilter('all')"
            >
              Toutes
            </button>
            <button
              type="button"
              class="depenses-segment__btn"
              :class="{ 'depenses-segment__btn--active': filter === 'month' }"
              @click="setFilter('month')"
            >
              Ce mois
            </button>
          </div>
        </div>

        <p class="depenses-period">{{ filterLabel }}</p>

        <div v-if="loading" class="depenses-state">
          <span class="depenses-state__spinner" aria-hidden="true" />
          Chargement des dépenses…
        </div>

        <div v-else-if="!rows.length" class="depenses-empty">
          <div class="depenses-empty__icon" aria-hidden="true">
            <Receipt :size="32" />
          </div>
          <p class="depenses-empty__title">Aucune dépense</p>
          <p class="depenses-empty__text">
            {{ filter === 'month' ? 'Aucune sortie enregistrée ce mois-ci.' : 'Commencez par enregistrer une sortie de caisse.' }}
          </p>
          <UiButton :icon="Plus" @click="openExpenseModal">Enregistrer une dépense</UiButton>
        </div>

        <div v-else class="depenses-table-wrap">
          <table class="gestionnaire-table depenses-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Catégorie</th>
                <th>Description</th>
                <th class="col-amount">Montant</th>
                <th>Enregistrée par</th>
                <th class="col-actions"><span class="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in rows" :key="row.id">
                <td class="depenses-table__date">{{ formatShortDate(row.date) }}</td>
                <td>
                  <span
                    class="category-pill"
                    :style="{
                      '--pill-color': row.categoryColor ?? '#d97706',
                    }"
                  >
                    <span class="category-pill__dot" />
                    {{ row.category }}
                  </span>
                </td>
                <td class="depenses-table__desc">{{ row.description }}</td>
                <td class="col-amount">{{ formatFcfa(row.amountFcfa) }}</td>
                <td>
                  <span v-if="row.recordedByName" class="recorded-by">
                    <span class="recorded-by__name">{{ row.recordedByName }}</span>
                    <span v-if="row.recordedByRoleLabel" class="recorded-by__role">{{ row.recordedByRoleLabel }}</span>
                  </span>
                  <span v-else class="text-muted">—</span>
                </td>
                <td class="actions">
                  <GestionnaireRowActionGroup>
                    <GestionnaireRowAction
                      :icon="Pencil"
                      label="Modifier"
                      variant="edit"
                      @click="openEditExpense(row)"
                    />
                    <GestionnaireRowAction
                      :icon="Trash2"
                      label="Supprimer"
                      variant="danger"
                      @click="deleteExpense(row)"
                    />
                  </GestionnaireRowActionGroup>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="rows.length" class="depenses-summary">
          <span class="depenses-summary__count">{{ expenseCount }} dépense{{ expenseCount > 1 ? 's' : '' }}</span>
          <span class="depenses-summary__total">
            Total : <strong>{{ formatFcfa(totalFcfa) }}</strong>
          </span>
        </div>
      </UiCard>

      <GestionnaireExpenseFormModal
        :open="showExpenseModal"
        :saving="expenseSaving"
        :categories="categories"
        :editing="editingExpense"
        @close="closeExpenseModal"
        @submit="submitExpense"
      />
    </template>

    <GestionnaireDepensesCategoriesPanel v-else class="depenses-categories-panel" />
  </div>
</template>

<style scoped>
.depenses-page {
  gap: 1rem;
}

.depenses-hero {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  padding: 1.25rem 1.35rem;
  border-radius: 16px;
  background: linear-gradient(135deg, #fffbeb 0%, #fef3c7 42%, #fff 100%);
  border: 1px solid rgba(217, 119, 6, 0.2);
  box-shadow: 0 8px 28px rgba(180, 83, 9, 0.08);
}

.depenses-hero__main {
  display: flex;
  align-items: flex-start;
  gap: 1rem;
  min-width: 0;
}

.depenses-hero__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 3.25rem;
  height: 3.25rem;
  flex-shrink: 0;
  border-radius: 14px;
  background: #fff;
  color: #b45309;
  border: 1px solid rgba(217, 119, 6, 0.22);
  box-shadow: 0 4px 14px rgba(217, 119, 6, 0.12);
}

.depenses-hero__eyebrow {
  margin: 0 0 0.2rem;
  font-size: 0.6875rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #b45309;
}

.depenses-hero__title {
  margin: 0;
  font-size: 1.65rem;
  font-weight: 800;
  letter-spacing: -0.03em;
  color: #78350f;
  line-height: 1.15;
}

.depenses-hero__subtitle {
  margin: 0.35rem 0 0;
  font-size: 0.9rem;
  color: #92400e;
  line-height: 1.45;
}

.depenses-hero__cta {
  flex-shrink: 0;
  align-self: center;
}

.depenses-tabs {
  margin-top: -0.15rem;
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

.depenses-kpis {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.75rem;
}

.depenses-kpi {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.9rem 1rem;
  border-radius: 14px;
  background: #fff;
  border: 1px solid rgba(15, 23, 42, 0.07);
  box-shadow: 0 2px 10px rgba(15, 23, 42, 0.04);
}

.depenses-kpi--primary {
  background: linear-gradient(145deg, #fff1f2 0%, #fff 55%);
  border-color: rgba(225, 29, 72, 0.14);
}

.depenses-kpi__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2.35rem;
  height: 2.35rem;
  border-radius: 10px;
  background: rgba(225, 29, 72, 0.1);
  color: #be123c;
  flex-shrink: 0;
}

.depenses-kpi__icon--neutral {
  background: rgba(245, 158, 11, 0.12);
  color: #b45309;
}

.depenses-kpi__label {
  margin: 0;
  font-size: 0.75rem;
  font-weight: 600;
  color: #78716c;
}

.depenses-kpi__value {
  margin: 0.1rem 0 0;
  font-size: 1.35rem;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: #be123c;
  font-variant-numeric: tabular-nums;
}

.depenses-kpi__value--sm {
  font-size: 1.15rem;
  color: #78350f;
}

.depenses-card :deep(.ui-card__body) {
  padding-top: 0.35rem;
}

.depenses-card__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
  margin-bottom: 0.35rem;
}

.depenses-card__title {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 800;
  color: #1c1917;
  letter-spacing: -0.02em;
}

.depenses-card__desc {
  margin: 0.2rem 0 0;
  font-size: 0.8125rem;
  color: #78716c;
}

.depenses-segment {
  display: inline-flex;
  padding: 0.2rem;
  border-radius: 11px;
  background: #fffbeb;
  border: 1px solid rgba(217, 119, 6, 0.18);
}

.depenses-segment__btn {
  padding: 0.4rem 0.85rem;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: #92400e;
  font-family: inherit;
  font-size: 0.8125rem;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
}

.depenses-segment__btn--active {
  background: #fff;
  color: #78350f;
  box-shadow: 0 1px 4px rgba(15, 23, 42, 0.08);
}

.depenses-period {
  margin: 0 0 0.85rem;
  font-size: 0.75rem;
  font-weight: 600;
  color: #a8a29e;
}

.depenses-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.65rem;
  padding: 2.5rem 1rem;
  color: #78716c;
  font-size: 0.875rem;
}

.depenses-state__spinner {
  width: 1.1rem;
  height: 1.1rem;
  border: 2px solid rgba(217, 119, 6, 0.2);
  border-top-color: #d97706;
  border-radius: 50%;
  animation: depenses-spin 0.7s linear infinite;
}

@keyframes depenses-spin {
  to {
    transform: rotate(360deg);
  }
}

.depenses-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 0.5rem;
  padding: 2.5rem 1.25rem;
  border-radius: 14px;
  background: linear-gradient(180deg, #fffbeb 0%, #fff 100%);
  border: 1px dashed rgba(217, 119, 6, 0.28);
}

.depenses-empty__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 4rem;
  height: 4rem;
  margin-bottom: 0.25rem;
  border-radius: 999px;
  background: #fff;
  color: #d97706;
  border: 1px solid rgba(217, 119, 6, 0.2);
}

.depenses-empty__title {
  margin: 0;
  font-size: 1rem;
  font-weight: 800;
  color: #44403c;
}

.depenses-empty__text {
  margin: 0 0 0.5rem;
  max-width: 22rem;
  font-size: 0.875rem;
  color: #78716c;
  line-height: 1.5;
}

.depenses-table-wrap {
  overflow-x: auto;
  margin: 0 -0.15rem;
  border-radius: 12px;
  border: 1px solid rgba(15, 23, 42, 0.06);
}

.depenses-table {
  margin: 0;
}

.depenses-table tbody tr:hover {
  background: rgba(255, 251, 235, 0.65);
}

.depenses-table__date {
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  color: #57534e;
  font-weight: 600;
}

.depenses-table__desc {
  max-width: 16rem;
  color: #292524;
  font-weight: 500;
}

.category-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.22rem 0.55rem;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--pill-color);
  background: color-mix(in srgb, var(--pill-color) 12%, white);
  border: 1px solid color-mix(in srgb, var(--pill-color) 22%, transparent);
}

.category-pill__dot {
  width: 0.45rem;
  height: 0.45rem;
  border-radius: 999px;
  background: var(--pill-color);
  flex-shrink: 0;
}

.col-amount {
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  color: #be123c;
  white-space: nowrap;
}

.recorded-by {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}

.recorded-by__name {
  font-weight: 600;
  color: #44403c;
  font-size: 0.8125rem;
}

.recorded-by__role {
  font-size: 0.6875rem;
  font-weight: 600;
  color: #a8a29e;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.text-muted {
  color: #a8a29e;
}

.depenses-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-top: 1rem;
  padding: 0.85rem 1rem;
  border-radius: 12px;
  background: linear-gradient(90deg, #fff1f2 0%, #fffbeb 100%);
  border: 1px solid rgba(225, 29, 72, 0.1);
}

.depenses-summary__count {
  font-size: 0.8125rem;
  font-weight: 600;
  color: #78716c;
}

.depenses-summary__total {
  font-size: 0.875rem;
  color: #57534e;
}

.depenses-summary__total strong {
  font-size: 1.05rem;
  font-weight: 800;
  color: #be123c;
  font-variant-numeric: tabular-nums;
}

@media (max-width: 900px) {
  .depenses-kpis {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .depenses-hero {
    flex-direction: column;
    align-items: stretch;
  }

  .depenses-hero__cta {
    align-self: stretch;
    justify-content: center;
  }

  .depenses-toolbar__tab {
    flex: 1 1 auto;
    justify-content: center;
  }

  .depenses-card__head {
    flex-direction: column;
  }

  .depenses-segment {
    width: 100%;
  }

  .depenses-segment__btn {
    flex: 1;
  }

  .depenses-summary {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
