<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  LayoutDashboard,
  Banknote,
  TrendingDown,
  TrendingUp,
  Users,
  CalendarDays,
  FlaskConical,
  BedDouble,
  Bell,
  Plus,
  Wallet,
  ClipboardList,
} from '@lucide/vue'
import api from '@/api/client'
import { formatFcfa } from '@/lib/roles'
import { confirmAppModal } from '@/lib/api-modal-helper'
import type { AdminDashboardOverview, AdminExpenseRow, TrendFilter } from '@/lib/admin-dashboard'
import {
  EXPENSE_STATUS_VARIANT,
  PAYROLL_STATUS_LABEL,
  filterTrend,
  formatRelativeTime,
  formatShortDate,
  formatTrendPercent,
} from '@/lib/admin-dashboard'
import AdminExpenseFormModal, {
  type AdminExpenseFormPayload,
} from '@/components/admin/AdminExpenseFormModal.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiStatCard from '@/components/ui/UiStatCard.vue'
import UiFormModal from '@/components/ui/UiFormModal.vue'
import UiTextarea from '@/components/ui/UiTextarea.vue'
import RoleDashboardShell from '@/components/dashboard/RoleDashboardShell.vue'
import DashboardLineChart from '@/components/dashboard/DashboardLineChart.vue'
import DashboardDonutChart from '@/components/dashboard/DashboardDonutChart.vue'
import DashboardHorizontalBars from '@/components/dashboard/DashboardHorizontalBars.vue'
import type { SummaryStat } from '@/lib/dashboard-summary'

const router = useRouter()
const overview = ref<AdminDashboardOverview | null>(null)
const loading = ref(false)
const loadError = ref('')
const trendFilter = ref<TrendFilter>('year')
const expenseFilter = ref<'all' | 'month' | 'pending'>('all')
const showExpenseModal = ref(false)
const showRejectModal = ref(false)
const rejectTarget = ref<AdminExpenseRow | null>(null)
const rejectReason = ref('')
const expenseSaving = ref(false)

const REVENUE_COLORS: Record<string, string> = {
  consultations: '#2563eb',
  examens: '#0d9488',
  operations: '#d97706',
  hospitalisation: '#7c3aed',
  autres: '#64748b',
}

const EXPENSE_COLORS: Record<string, string> = {
  salaires: '#7c3aed',
  fournitures: '#2563eb',
  equipements: '#d97706',
  maintenance: '#0d9488',
  autres: '#64748b',
}

const summaryStats = computed((): SummaryStat[] => {
  const k = overview.value?.financialKpis
  if (!k) return []
  return [
    {
      id: 'revenue',
      label: 'Recettes du mois',
      value: formatFcfa(k.revenueMonthFcfa),
      icon: Banknote,
      variant: 'green',
      trend: formatTrendPercent(k.revenueChangePercent),
    },
    {
      id: 'expenses',
      label: 'Dépenses du mois',
      value: formatFcfa(k.expensesMonthFcfa),
      icon: TrendingDown,
      variant: 'rose',
      trend: formatTrendPercent(k.expensesChangePercent),
    },
    {
      id: 'net',
      label: 'Bénéfice net',
      value: formatFcfa(k.netMonthFcfa),
      icon: TrendingUp,
      variant: 'blue',
      trend: formatTrendPercent(k.netChangePercent),
    },
    {
      id: 'payroll',
      label: 'Masse salariale',
      value: formatFcfa(k.payrollMonthFcfa),
      icon: Users,
      variant: 'violet',
      trend: formatTrendPercent(k.payrollChangePercent),
    },
  ]
})

const filteredTrend = computed(() => {
  if (!overview.value) return []
  return filterTrend(overview.value.monthlyTrend, trendFilter.value)
})

const lineChartLabels = computed(() => filteredTrend.value.map((row) => row.label))
const lineChartSeries = computed(() => {
  const points = filteredTrend.value
  return [
    {
      key: 'revenue',
      label: 'Recettes',
      color: '#16a34a',
      values: points.map((row) => row.revenueFcfa),
    },
    {
      key: 'expenses',
      label: 'Dépenses',
      color: '#e11d48',
      values: points.map((row) => row.expensesFcfa),
    },
    {
      key: 'net',
      label: 'Bénéfice net',
      color: '#2563eb',
      values: points.map((row) => row.netFcfa),
    },
  ]
})

const revenueDonut = computed(() =>
  (overview.value?.revenueBreakdown ?? []).map((row) => ({
    ...row,
    percent: row.percent ?? 0,
    color: REVENUE_COLORS[row.key] ?? '#64748b',
  })),
)

const expenseBars = computed(() =>
  (overview.value?.expenseBreakdown ?? []).map((row) => ({
    key: row.key,
    label: row.label,
    amountFcfa: row.amountFcfa,
    color: EXPENSE_COLORS[row.key] ?? '#64748b',
  })),
)

const filteredExpenses = computed(() => {
  const rows = overview.value?.recentExpenses ?? []
  if (expenseFilter.value === 'pending') {
    return rows.filter((row) => row.status === 'PENDING')
  }
  if (expenseFilter.value === 'month') {
    const now = new Date()
    const prefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    return rows.filter((row) => row.date.startsWith(prefix))
  }
  return rows
})

const payrollProgress = computed(() => {
  const payroll = overview.value?.payroll
  if (!payroll || !payroll.totalCount) return 0
  return Math.round((payroll.paidCount / payroll.totalCount) * 100)
})

async function loadOverview() {
  loading.value = true
  loadError.value = ''
  try {
    const { data } = await api.get<AdminDashboardOverview>('/dashboard/admin')
    overview.value = data
  } catch {
    loadError.value = 'Impossible de charger le tableau de bord administrateur.'
    overview.value = null
  } finally {
    loading.value = false
  }
}

async function validateExpense(row: AdminExpenseRow) {
  const ok = await confirmAppModal({
    type: 'CONFIRM',
    title: 'Valider la dépense',
    message: `Confirmer la validation de « ${row.description} » pour ${formatFcfa(row.amountFcfa)} ?`,
    confirmLabel: 'Valider',
    cancelLabel: 'Annuler',
  })
  if (!ok) return
  await api.patch(`/admin/expenses/${row.id}/validate`)
  await loadOverview()
}

async function rejectExpense(row: AdminExpenseRow) {
  rejectTarget.value = row
  rejectReason.value = ''
  showRejectModal.value = true
}

async function submitReject() {
  if (!rejectTarget.value || rejectReason.value.trim().length < 3) return
  await api.patch(`/admin/expenses/${rejectTarget.value.id}/reject`, {
    reason: rejectReason.value.trim(),
  })
  showRejectModal.value = false
  rejectTarget.value = null
  await loadOverview()
}

async function payPayroll(id: string, employeeName: string) {
  const ok = await confirmAppModal({
    type: 'CONFIRM',
    title: 'Valider la paie',
    message: `Confirmer le paiement du salaire de ${employeeName} ?`,
    confirmLabel: 'Confirmer le paiement',
    cancelLabel: 'Annuler',
  })
  if (!ok) return
  await api.post(`/admin/payroll/${id}/pay`)
  await loadOverview()
}

async function submitExpense(payload: AdminExpenseFormPayload) {
  expenseSaving.value = true
  try {
    await api.post('/admin/expenses', payload)
    showExpenseModal.value = false
    await loadOverview()
  } finally {
    expenseSaving.value = false
  }
}

onMounted(loadOverview)
</script>

<template>
  <RoleDashboardShell
    subtitle="Gestion financière, dépenses, salaires et supervision de la clinique"
    :icon="LayoutDashboard"
    :stats="summaryStats"
    :loading="loading"
    :load-error="loadError"
    @refresh="loadOverview"
  >
    <div class="admin-dashboard">
      <section class="charts-grid">
        <UiCard
          title="Évolution mensuelle"
          description="Recettes, dépenses et bénéfice net — 12 mois glissants"
          :icon="TrendingUp"
          icon-variant="blue"
        >
          <div class="trend-filters">
            <button
              type="button"
              class="trend-filters__btn"
              :class="{ 'trend-filters__btn--active': trendFilter === 'month' }"
              @click="trendFilter = 'month'"
            >
              Mois
            </button>
            <button
              type="button"
              class="trend-filters__btn"
              :class="{ 'trend-filters__btn--active': trendFilter === 'quarter' }"
              @click="trendFilter = 'quarter'"
            >
              Trimestre
            </button>
            <button
              type="button"
              class="trend-filters__btn"
              :class="{ 'trend-filters__btn--active': trendFilter === 'year' }"
              @click="trendFilter = 'year'"
            >
              Année
            </button>
          </div>
          <DashboardLineChart
            :labels="lineChartLabels"
            :series="lineChartSeries"
            :format-value="formatFcfa"
            :loading="loading"
          />
        </UiCard>

        <UiCard
          title="Répartition des recettes"
          description="Mois en cours"
          :icon="Banknote"
          icon-variant="green"
        >
          <DashboardDonutChart :slices="revenueDonut" :format-value="formatFcfa" />
        </UiCard>

        <UiCard
          title="Répartition des dépenses"
          description="Mois en cours"
          :icon="Wallet"
          icon-variant="rose"
        >
          <DashboardHorizontalBars :rows="expenseBars" :format-value="formatFcfa" />
        </UiCard>
      </section>

      <section class="admin-dashboard__grid">
        <UiCard title="Dépenses récentes" description="Suivi et validation" :icon="Wallet" icon-variant="amber">
          <div class="section-toolbar">
            <div class="section-toolbar__filters">
              <button
                type="button"
                class="trend-filters__btn"
                :class="{ 'trend-filters__btn--active': expenseFilter === 'all' }"
                @click="expenseFilter = 'all'"
              >
                Toutes
              </button>
              <button
                type="button"
                class="trend-filters__btn"
                :class="{ 'trend-filters__btn--active': expenseFilter === 'month' }"
                @click="expenseFilter = 'month'"
              >
                Ce mois
              </button>
              <button
                type="button"
                class="trend-filters__btn"
                :class="{ 'trend-filters__btn--active': expenseFilter === 'pending' }"
                @click="expenseFilter = 'pending'"
              >
                En attente
              </button>
            </div>
            <div class="section-toolbar__actions">
              <UiButton size="sm" :icon="Plus" @click="showExpenseModal = true">Nouvelle dépense</UiButton>
              <UiButton size="sm" variant="ghost" @click="router.push('/admin/depenses')">Voir tout</UiButton>
            </div>
          </div>

          <div v-if="!filteredExpenses.length" class="chart-empty">Aucune dépense à afficher</div>
          <div v-else class="data-table-wrap">
            <table class="admin-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Catégorie</th>
                  <th>Description</th>
                  <th>Montant</th>
                  <th>Statut</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in filteredExpenses.slice(0, 8)" :key="row.id">
                  <td>{{ formatShortDate(row.date) }}</td>
                  <td>{{ row.category }}</td>
                  <td>{{ row.description }}</td>
                  <td>{{ formatFcfa(row.amountFcfa) }}</td>
                  <td>
                    <span class="status-badge" :class="`status-badge--${EXPENSE_STATUS_VARIANT[row.status]}`">
                      {{ row.statusLabel }}
                    </span>
                  </td>
                  <td class="admin-table__actions">
                    <UiButton
                      v-if="row.status === 'PENDING'"
                      size="sm"
                      variant="ghost"
                      @click="validateExpense(row)"
                    >
                      Valider
                    </UiButton>
                    <UiButton
                      v-if="row.status === 'PENDING'"
                      size="sm"
                      variant="ghost"
                      @click="rejectExpense(row)"
                    >
                      Rejeter
                    </UiButton>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </UiCard>

        <div class="admin-dashboard__stack">
          <UiCard title="Aperçu employés" description="Effectif actif" :icon="Users" icon-variant="teal">
            <div class="employees-summary">
              <div>
                <strong class="employees-summary__count">{{ overview?.employees.totalActive ?? 0 }}</strong>
                <span>employés actifs</span>
              </div>
              <span v-if="overview?.employees.newThisMonth" class="employees-summary__badge">
                +{{ overview.employees.newThisMonth }} nouveaux ce mois
              </span>
            </div>
            <div class="service-list">
              <div
                v-for="row in overview?.employees.byService ?? []"
                :key="row.service"
                class="service-list__row"
              >
                <span>{{ row.service }}</span>
                <strong>{{ row.count }}</strong>
              </div>
            </div>
          </UiCard>

          <UiCard
            title="Paie du mois"
            description="Mois en cours"
            :icon="Banknote"
            icon-variant="violet"
          >
            <div class="payroll-progress">
              <div class="payroll-progress__bar">
                <div class="payroll-progress__fill" :style="{ width: `${payrollProgress}%` }" />
              </div>
              <span>
                {{ overview?.payroll.paidCount ?? 0 }}/{{ overview?.payroll.totalCount ?? 0 }} employés payés
              </span>
            </div>
            <div v-if="!(overview?.payroll.rows.length)" class="chart-empty">Aucune fiche de paie ce mois</div>
            <div v-else class="data-table-wrap">
              <table class="admin-table admin-table--compact">
                <thead>
                  <tr>
                    <th>Employé</th>
                    <th>Poste</th>
                    <th>Brut</th>
                    <th>Statut</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in overview?.payroll.rows.slice(0, 6)" :key="row.id">
                    <td>{{ row.employeeName }}</td>
                    <td>{{ row.jobTitle ?? '—' }}</td>
                    <td>{{ formatFcfa(row.grossFcfa) }}</td>
                    <td>{{ PAYROLL_STATUS_LABEL[row.status] }}</td>
                    <td>
                      <UiButton
                        v-if="row.status !== 'PAID'"
                        size="sm"
                        variant="ghost"
                        @click="payPayroll(row.id, row.employeeName)"
                      >
                        Valider la paie
                      </UiButton>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <UiButton class="section-link" size="sm" variant="ghost" @click="router.push('/admin/salaires')">
              Voir tout
            </UiButton>
          </UiCard>
        </div>
      </section>

      <section class="clinical-cards">
        <UiStatCard
          label="Patients aujourd'hui"
          :value="overview?.clinical.patientsToday ?? 0"
          :icon="Users"
          variant="teal"
          mini
        />
        <UiStatCard
          label="RDV du jour"
          :value="overview?.clinical.appointmentsToday ?? 0"
          :icon="CalendarDays"
          variant="blue"
          mini
        />
        <UiStatCard
          label="Examens en attente"
          :value="overview?.clinical.examsPending ?? 0"
          :icon="FlaskConical"
          variant="amber"
          mini
        />
        <UiStatCard
          label="Hospitalisations actives"
          :value="overview?.clinical.activeHospitalizations ?? 0"
          :icon="BedDouble"
          variant="violet"
          mini
        />
      </section>

      <section class="admin-dashboard__bottom">
        <UiCard title="Alertes importantes" :icon="Bell" icon-variant="amber">
          <ul class="alerts-list">
            <li v-if="overview?.alerts.pendingExpenses" class="alerts-list__item alerts-list__item--danger">
              Dépenses en attente de validation — {{ overview.alerts.pendingExpenses }}
            </li>
            <li v-if="overview?.alerts.unpaidPayroll" class="alerts-list__item alerts-list__item--warning">
              Salaires non payés ce mois — {{ overview.alerts.unpaidPayroll }}
            </li>
            <li v-if="overview?.alerts.lowStock" class="alerts-list__item alerts-list__item--warning">
              Stock pharmacie bas — {{ overview.alerts.lowStock }} produit(s)
            </li>
            <li
              v-for="item in overview?.alerts.recentValidations ?? []"
              :key="item.id"
              class="alerts-list__item alerts-list__item--success"
            >
              Dépense validée — {{ item.label }} — {{ formatFcfa(item.amountFcfa) }}
            </li>
            <li
              v-if="
                !overview?.alerts.pendingExpenses &&
                !overview?.alerts.unpaidPayroll &&
                !overview?.alerts.lowStock &&
                !(overview?.alerts.recentValidations.length)
              "
              class="chart-empty"
            >
              Aucune alerte pour le moment
            </li>
          </ul>
        </UiCard>

        <UiCard title="Journal d'activité Admin" :icon="ClipboardList" icon-variant="blue">
          <ul class="journal-list">
            <li v-for="entry in overview?.activityJournal ?? []" :key="entry.id">
              <span>{{ entry.message }} — {{ formatRelativeTime(entry.createdAt) }}</span>
              <small>{{ entry.actorName }}</small>
            </li>
            <li v-if="!(overview?.activityJournal.length)" class="chart-empty">Aucune action récente</li>
          </ul>
          <UiButton size="sm" variant="ghost" class="section-link" @click="router.push('/admin/depenses')">
            Voir l'historique complet
          </UiButton>
        </UiCard>
      </section>
    </div>

    <AdminExpenseFormModal
      :open="showExpenseModal"
      :saving="expenseSaving"
      @close="showExpenseModal = false"
      @submit="submitExpense"
    />

    <UiFormModal
      v-if="showRejectModal"
      title="Rejeter la dépense"
      subtitle="Justification obligatoire"
      @close="showRejectModal = false"
    >
      <UiTextarea v-model="rejectReason" label="Motif du rejet" />
      <template #footer>
        <UiButton variant="ghost" @click="showRejectModal = false">Annuler</UiButton>
        <UiButton variant="danger" :disabled="rejectReason.trim().length < 3" @click="submitReject">
          Confirmer le rejet
        </UiButton>
      </template>
    </UiFormModal>
  </RoleDashboardShell>
</template>

<style scoped>
@import '@/styles/dashboard-charts.css';

.admin-dashboard {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.charts-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
}

.charts-grid > :first-child {
  grid-column: 1 / -1;
}

.admin-dashboard__grid {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
  gap: 1rem;
}

.admin-dashboard__stack {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.admin-dashboard__bottom {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
}

.clinical-cards {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.75rem;
}

.trend-filters {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.trend-filters__btn {
  border: 1px solid var(--border);
  background: var(--bg-card);
  color: var(--text-muted);
  border-radius: 999px;
  padding: 0.3rem 0.75rem;
  font-size: 0.75rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.trend-filters__btn--active {
  background: var(--accent-100);
  color: var(--accent-700);
  border-color: rgba(107, 124, 62, 0.35);
}

.section-toolbar {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
  flex-wrap: wrap;
  margin-bottom: 0.75rem;
}

.section-toolbar__filters,
.section-toolbar__actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  align-items: center;
}

.data-table-wrap {
  overflow-x: auto;
}

.admin-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8125rem;
}

.admin-table th,
.admin-table td {
  padding: 0.55rem 0.45rem;
  border-bottom: 1px solid var(--border);
  text-align: left;
}

.admin-table th {
  color: var(--text-muted);
  font-weight: 600;
}

.admin-table__actions {
  display: flex;
  gap: 0.25rem;
  flex-wrap: wrap;
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

.employees-summary {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}

.employees-summary__count {
  display: block;
  font-size: 2rem;
  line-height: 1;
}

.employees-summary__badge {
  background: #dcfce7;
  color: #166534;
  border-radius: 999px;
  padding: 0.25rem 0.6rem;
  font-size: 0.75rem;
  font-weight: 600;
}

.service-list {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.service-list__row {
  display: flex;
  justify-content: space-between;
  font-size: 0.8125rem;
  color: var(--text-muted);
}

.payroll-progress {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  margin-bottom: 0.75rem;
  font-size: 0.8125rem;
  color: var(--text-muted);
}

.payroll-progress__bar {
  height: 0.55rem;
  border-radius: 999px;
  background: #f1f5f9;
  overflow: hidden;
}

.payroll-progress__fill {
  height: 100%;
  background: linear-gradient(90deg, #7c3aed, #a78bfa);
  border-radius: 999px;
}

.alerts-list,
.journal-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

.alerts-list__item {
  padding: 0.55rem 0.7rem;
  border-radius: var(--radius);
  font-size: 0.8125rem;
}

.alerts-list__item--danger { background: #ffe4e6; color: #be123c; }
.alerts-list__item--warning { background: #fef3c7; color: #b45309; }
.alerts-list__item--success { background: #dcfce7; color: #166534; }

.journal-list li {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  padding: 0.45rem 0;
  border-bottom: 1px dashed var(--border);
  font-size: 0.8125rem;
}

.journal-list small {
  color: var(--text-light);
}

.section-link {
  margin-top: 0.75rem;
}

@media (max-width: 1100px) {
  .charts-grid,
  .admin-dashboard__grid,
  .admin-dashboard__bottom,
  .clinical-cards {
    grid-template-columns: 1fr;
  }

  .charts-grid > :first-child {
    grid-column: auto;
  }
}
</style>
