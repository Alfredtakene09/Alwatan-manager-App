<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Coins, Banknote, History, HandCoins, CheckCircle2, Clock } from '@lucide/vue'
import api from '@/api/client'
import { formatFcfa } from '@/lib/roles'
import { confirmAppModal } from '@/lib/api-modal-helper'
import type { PayrollRow } from '@/lib/admin-dashboard'
import { PAYROLL_STATUS_LABEL } from '@/lib/admin-dashboard'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiStatCard from '@/components/ui/UiStatCard.vue'
import CaisseToolbar from '@/components/caisse/CaisseToolbar.vue'
import AdminPayrollHistoriquePanel from '@/components/admin/AdminPayrollHistoriquePanel.vue'
import GestionnaireSalaryAdvancesPanel from '@/components/gestionnaire/GestionnaireSalaryAdvancesPanel.vue'

type TabId = 'mois' | 'historique' | 'avances'

type PayrollResponse = {
  year: number
  month: number
  rows: Array<{
    id: string
    grossFcfa: number
    pendingAdvancesFcfa?: number
    status: PayrollRow['status']
    employee: { fullName: string; jobTitle: string | null }
  }>
}

type SalaryAdvanceSummary = {
  id: string
  employeeId: string
  remainingFcfa: number
}

const route = useRoute()
const router = useRouter()

function resolveTab(tab: unknown): TabId {
  if (tab === 'historique') return 'historique'
  if (tab === 'avances') return 'avances'
  return 'mois'
}

const activeTab = ref<TabId>(resolveTab(route.query.tab))
const payload = ref<PayrollResponse | null>(null)
const advanceRows = ref<SalaryAdvanceSummary[]>([])
const loading = ref(false)
const historiquePanelRef = ref<InstanceType<typeof AdminPayrollHistoriquePanel> | null>(null)
const avancesPanelRef = ref<InstanceType<typeof GestionnaireSalaryAdvancesPanel> | null>(null)

const rows = computed(() =>
  (payload.value?.rows ?? []).map((row) => ({
    id: row.id,
    employeeName: row.employee.fullName,
    jobTitle: row.employee.jobTitle,
    grossFcfa: row.grossFcfa,
    pendingAdvancesFcfa: row.pendingAdvancesFcfa ?? 0,
    status: row.status,
  })),
)

const paidCount = computed(() => rows.value.filter((row) => row.status === 'PAID').length)
const unpaidCount = computed(() => rows.value.filter((row) => row.status !== 'PAID').length)
const totalCount = computed(() => rows.value.length)
const progress = computed(() =>
  totalCount.value ? Math.round((paidCount.value / totalCount.value) * 100) : 0,
)

const employeesWithAdvancesCount = computed(() => {
  const ids = new Set(advanceRows.value.map((row) => row.employeeId))
  return ids.size
})

const periodLabel = computed(() => {
  if (!payload.value) return 'Mois en cours'
  return new Date(payload.value.year, payload.value.month - 1, 1).toLocaleDateString('fr-FR', {
    month: 'long',
    year: 'numeric',
  })
})

const pageSubtitle = computed(() => {
  if (activeTab.value === 'historique') return 'Historique des salaires payés'
  if (activeTab.value === 'avances') return 'Avances sur salaire des employés'
  return 'Validation des salaires et fiches du personnel'
})

function selectTab(tab: TabId) {
  activeTab.value = tab
}

watch(activeTab, async (tab, previous) => {
  router.replace({ query: tab === 'historique' || tab === 'avances' ? { tab } : {} })
  if (previous === 'avances' || tab === 'avances') {
    await loadAdvances()
  }
})

watch(
  () => route.query.tab,
  (tab) => {
    activeTab.value = resolveTab(tab)
  },
)

async function loadAdvances() {
  try {
    const { data } = await api.get<SalaryAdvanceSummary[]>('/admin/salary-advances', {
      params: { status: 'PENDING' },
    })
    advanceRows.value = data
  } catch {
    advanceRows.value = []
  }
}

async function loadPayroll() {
  loading.value = true
  try {
    const { data } = await api.get<PayrollResponse>('/admin/payroll')
    payload.value = data
  } finally {
    loading.value = false
  }
}

async function reloadPayrollData() {
  await Promise.all([loadPayroll(), loadAdvances()])
}

async function payRow(row: PayrollRow) {
  const ok = await confirmAppModal({
    type: 'CONFIRM',
    title: 'Valider la paie',
    message: `Confirmer le paiement du salaire de ${row.employeeName} (${formatFcfa(row.grossFcfa)}) ?`,
    confirmLabel: 'Confirmer',
  })
  if (!ok) return
  await api.post(`/admin/payroll/${row.id}/pay`)
  await reloadPayrollData()
  historiquePanelRef.value?.reload()
  avancesPanelRef.value?.reload()
}

async function payAllPending() {
  const pending = rows.value.filter((row) => row.status !== 'PAID')
  if (!pending.length) return
  const ok = await confirmAppModal({
    type: 'CONFIRM',
    title: 'Valider la paie du mois',
    message: `Confirmer le paiement de ${pending.length} salaire(s) en attente ?`,
    confirmLabel: 'Tout valider',
  })
  if (!ok) return
  for (const row of pending) {
    await api.post(`/admin/payroll/${row.id}/pay`)
  }
  await reloadPayrollData()
  historiquePanelRef.value?.reload()
  avancesPanelRef.value?.reload()
}

onMounted(reloadPayrollData)
</script>

<template>
  <div class="admin-page salaires-page">
    <UiPageHeader title="Salaires & paie" :subtitle="pageSubtitle" :icon="Coins">
      <template v-if="activeTab === 'mois'" #actions>
        <UiButton @click="payAllPending">Valider la paie</UiButton>
      </template>
    </UiPageHeader>

    <div class="salaires-toolbar-row">
      <CaisseToolbar role="tablist" aria-label="Sections salaires" class="salaires-toolbar-row__tabs">
        <button
          type="button"
          class="salaires-toolbar__tab"
          :class="{ 'salaires-toolbar__tab--active': activeTab === 'mois' }"
          :aria-selected="activeTab === 'mois'"
          @click="selectTab('mois')"
        >
          <Banknote :size="16" />
          Paie du mois
        </button>
        <button
          type="button"
          class="salaires-toolbar__tab"
          :class="{ 'salaires-toolbar__tab--active': activeTab === 'historique' }"
          :aria-selected="activeTab === 'historique'"
          @click="selectTab('historique')"
        >
          <History :size="16" />
          Historique
        </button>
        <button
          type="button"
          class="salaires-toolbar__tab"
          :class="{ 'salaires-toolbar__tab--active': activeTab === 'avances' }"
          :aria-selected="activeTab === 'avances'"
          @click="selectTab('avances')"
        >
          <HandCoins :size="16" />
          Avances
        </button>
      </CaisseToolbar>

      <div class="salaires-toolbar-row__stats" aria-label="Synthèse paie">
        <UiStatCard
          label="Avances"
          :value="employeesWithAdvancesCount"
          :icon="HandCoins"
          variant="amber"
          mini
        />
        <UiStatCard
          label="Payés"
          :value="paidCount"
          :icon="CheckCircle2"
          variant="green"
          mini
        />
        <UiStatCard
          label="Non payés"
          :value="unpaidCount"
          :icon="Clock"
          variant="rose"
          mini
        />
      </div>
    </div>

    <template v-if="activeTab === 'mois'">
      <UiCard title="Fiches de paie" :description="`Suivi des paiements — ${periodLabel}`">
        <div class="payroll-progress">
          <div class="payroll-progress__bar">
            <div class="payroll-progress__fill" :style="{ width: `${progress}%` }" />
          </div>
          <span>{{ paidCount }}/{{ totalCount }} employés payés ce mois</span>
        </div>

        <div v-if="loading" class="chart-empty">Chargement…</div>
        <div v-else-if="!rows.length" class="chart-empty">
          Aucune fiche de paie — définissez un salaire fixe sur les fiches employés
        </div>
        <table v-else class="admin-table">
          <thead>
            <tr>
              <th>Employé</th>
              <th>Poste</th>
              <th>Salaire brut</th>
              <th>Avance</th>
              <th>Statut paiement</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.id">
              <td>{{ row.employeeName }}</td>
              <td>{{ row.jobTitle ?? '—' }}</td>
              <td>{{ formatFcfa(row.grossFcfa) }}</td>
              <td>
                <span v-if="(row.pendingAdvancesFcfa ?? 0) > 0" class="advance-deduct">
                  -{{ formatFcfa(row.pendingAdvancesFcfa ?? 0) }}
                </span>
                <span v-else>—</span>
              </td>
              <td>{{ PAYROLL_STATUS_LABEL[row.status] }}</td>
              <td>
                <UiButton
                  v-if="row.status !== 'PAID'"
                  size="sm"
                  variant="success"
                  @click="payRow(row)"
                >
                  Valider la paie
                </UiButton>
              </td>
            </tr>
          </tbody>
        </table>
      </UiCard>
    </template>

    <AdminPayrollHistoriquePanel v-else-if="activeTab === 'historique'" ref="historiquePanelRef" />
    <div v-else class="salary-advances-admin">
      <p class="salary-advances-admin__hint">
        Les avances en attente sont automatiquement déduites au moment de la validation de la paie.
      </p>
      <GestionnaireSalaryAdvancesPanel ref="avancesPanelRef" api-base-path="/admin" />
    </div>
  </div>
</template>

<style scoped>
.admin-page {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.salaires-toolbar-row {
  display: flex;
  align-items: stretch;
  gap: 0.65rem;
  width: 100%;
  padding: 0.3rem;
  border-radius: 12px;
  background: var(--surface-muted, #eef2e6);
  border: 1px solid var(--border);
}

.salaires-toolbar-row__tabs {
  flex: 0 0 auto;
}

.salaires-toolbar-row__tabs:deep(.caisse-toolbar) {
  width: auto;
  padding: 0;
  border: none;
  background: transparent;
}

.salaires-toolbar-row__stats {
  flex: 1 1 auto;
  display: flex;
  align-items: stretch;
  justify-content: flex-end;
  gap: 0.45rem;
  min-width: 0;
  overflow-x: auto;
}

.salaires-toolbar-row__stats :deep(.stat-card) {
  flex: 1 1 0;
  min-width: 7.5rem;
  max-width: 11rem;
}

.salaires-toolbar__tab {
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

.salaires-toolbar__tab--active {
  background: #fff;
  color: var(--primary-800);
  box-shadow: 0 1px 4px rgba(15, 23, 42, 0.08);
}

.payroll-progress {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  margin-bottom: 0.85rem;
  font-size: 0.875rem;
  color: var(--text-muted);
}

.payroll-progress__bar {
  height: 0.6rem;
  border-radius: 999px;
  background: #f1f5f9;
  overflow: hidden;
}

.payroll-progress__fill {
  height: 100%;
  background: linear-gradient(90deg, #7c3aed, #a78bfa);
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
}

.advance-deduct {
  color: #b45309;
  font-weight: 700;
}

@media (max-width: 960px) {
  .salaires-toolbar-row {
    flex-direction: column;
    align-items: stretch;
  }

  .salaires-toolbar-row__stats {
    justify-content: stretch;
  }

  .salaires-toolbar-row__stats :deep(.stat-card) {
    max-width: none;
  }
}

@media (max-width: 720px) {
  .salaires-toolbar__tab {
    flex: 1 1 auto;
    justify-content: center;
  }

  .salaires-toolbar-row__stats {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

.salary-advances-admin {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.salary-advances-admin__hint {
  margin: 0;
  padding: 0.6rem 0.75rem;
  border: 1px solid #fde68a;
  border-radius: 10px;
  background: #fffbeb;
  color: #92400e;
  font-size: 0.8125rem;
  font-weight: 600;
}
</style>
