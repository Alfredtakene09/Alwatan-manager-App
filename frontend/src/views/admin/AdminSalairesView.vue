<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Coins, Banknote, History } from '@lucide/vue'
import api from '@/api/client'
import { formatFcfa } from '@/lib/roles'
import { confirmAppModal } from '@/lib/api-modal-helper'
import type { PayrollRow } from '@/lib/admin-dashboard'
import { PAYROLL_STATUS_LABEL } from '@/lib/admin-dashboard'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiButton from '@/components/ui/UiButton.vue'
import CaisseToolbar from '@/components/caisse/CaisseToolbar.vue'
import AdminPayrollHistoriquePanel from '@/components/admin/AdminPayrollHistoriquePanel.vue'

type TabId = 'mois' | 'historique'

type PayrollResponse = {
  year: number
  month: number
  rows: Array<{
    id: string
    grossFcfa: number
    status: PayrollRow['status']
    employee: { fullName: string; jobTitle: string | null }
  }>
}

const route = useRoute()
const router = useRouter()

const activeTab = ref<TabId>(route.query.tab === 'historique' ? 'historique' : 'mois')
const payload = ref<PayrollResponse | null>(null)
const loading = ref(false)
const historiquePanelRef = ref<InstanceType<typeof AdminPayrollHistoriquePanel> | null>(null)

const rows = computed(() =>
  (payload.value?.rows ?? []).map((row) => ({
    id: row.id,
    employeeName: row.employee.fullName,
    jobTitle: row.employee.jobTitle,
    grossFcfa: row.grossFcfa,
    status: row.status,
  })),
)

const paidCount = computed(() => rows.value.filter((row) => row.status === 'PAID').length)
const progress = computed(() =>
  rows.value.length ? Math.round((paidCount.value / rows.value.length) * 100) : 0,
)

const pageSubtitle = computed(() =>
  activeTab.value === 'historique'
    ? 'Historique des salaires payés'
    : 'Validation des salaires et fiches du personnel',
)

function selectTab(tab: TabId) {
  activeTab.value = tab
}

watch(activeTab, (tab) => {
  router.replace({ query: tab === 'historique' ? { tab: 'historique' } : {} })
})

watch(
  () => route.query.tab,
  (tab) => {
    activeTab.value = tab === 'historique' ? 'historique' : 'mois'
  },
)

async function loadPayroll() {
  loading.value = true
  try {
    const { data } = await api.get<PayrollResponse>('/admin/payroll')
    payload.value = data
  } finally {
    loading.value = false
  }
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
  await loadPayroll()
  historiquePanelRef.value?.reload()
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
  await loadPayroll()
  historiquePanelRef.value?.reload()
}

onMounted(loadPayroll)
</script>

<template>
  <div class="admin-page salaires-page">
    <UiPageHeader title="Salaires & paie" :subtitle="pageSubtitle" :icon="Coins">
      <template v-if="activeTab === 'mois'" #actions>
        <UiButton @click="payAllPending">Valider la paie</UiButton>
      </template>
    </UiPageHeader>

    <CaisseToolbar role="tablist" aria-label="Sections salaires">
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
    </CaisseToolbar>

    <template v-if="activeTab === 'mois'">
      <UiCard title="Fiches de paie" description="Suivi des paiements du mois en cours">
        <div class="payroll-progress">
          <div class="payroll-progress__bar">
            <div class="payroll-progress__fill" :style="{ width: `${progress}%` }" />
          </div>
          <span>{{ paidCount }}/{{ rows.length }} employés payés ce mois</span>
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
              <th>Statut paiement</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.id">
              <td>{{ row.employeeName }}</td>
              <td>{{ row.jobTitle ?? '—' }}</td>
              <td>{{ formatFcfa(row.grossFcfa) }}</td>
              <td>{{ PAYROLL_STATUS_LABEL[row.status] }}</td>
              <td>
                <UiButton
                  v-if="row.status !== 'PAID'"
                  size="sm"
                  variant="ghost"
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

    <AdminPayrollHistoriquePanel v-else ref="historiquePanelRef" />
  </div>
</template>

<style scoped>
.admin-page {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
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

@media (max-width: 720px) {
  .salaires-toolbar__tab {
    flex: 1 1 auto;
    justify-content: center;
  }
}
</style>
