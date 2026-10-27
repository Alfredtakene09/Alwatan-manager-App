<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Coins, Banknote, History, HandCoins, CheckCircle2, Clock, Search } from '@lucide/vue'
import api from '@/api/client'
import { formatFcfa } from '@/lib/roles'
import { confirmAppModal, showApiErrorModal, showSuccessModal } from '@/lib/api-modal-helper'
import type { PayrollRow } from '@/lib/admin-dashboard'
import { PAYROLL_STATUS_LABEL } from '@/lib/admin-dashboard'
import { exportTableExcel, exportTablePdf, exportTableWord, type ExportColumn } from '@/lib/table-export'
import ExportButtons from '@/components/ui/ExportButtons.vue'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiStatCard from '@/components/ui/UiStatCard.vue'
import CaisseToolbar from '@/components/caisse/CaisseToolbar.vue'
import AdminPayrollHistoriquePanel from '@/components/admin/AdminPayrollHistoriquePanel.vue'
import GestionnaireSalaryAdvancesPanel from '@/components/gestionnaire/GestionnaireSalaryAdvancesPanel.vue'
import GestionnaireOvertimePanel from '@/components/gestionnaire/GestionnaireOvertimePanel.vue'

type TabId = 'mois' | 'historique' | 'avances' | 'heures-supp'

/** Montant affiché avec « F » au lieu de « FCFA ». */
function formatF(amount: number) {
  return formatFcfa(amount).replace(/FCFA/, 'F')
}

type PayrollResponse = {
  year: number
  month: number
  rows: Array<{
    id: string
    grossFcfa: number
    pendingAdvancesFcfa?: number
    netFcfa?: number
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
  if (tab === 'heures-supp') return 'heures-supp'
  return 'mois'
}

function currentYearMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

const periodInput = ref(currentYearMonth())
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
    netFcfa: row.netFcfa ?? Math.max(0, row.grossFcfa - (row.pendingAdvancesFcfa ?? 0)),
    status: row.status,
  })),
)

const searchQuery = ref('')
/** Filtre par poste ('' = tous) : liste et exports. */
const jobTitleFilter = ref('')

/** Une fiche validée quitte la liste du mois et reste consultable dans l'Historique. */
const pendingRows = computed(() => rows.value.filter((row) => row.status !== 'PAID'))

function normalizeText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

const jobTitleOptions = computed(() =>
  [...new Set(pendingRows.value.map((row) => row.jobTitle?.trim() || '—'))].sort((a, b) =>
    a.localeCompare(b, 'fr', { sensitivity: 'base' }),
  ),
)

// Poste absent du mois choisi : on revient à « Tous les postes ».
watch(jobTitleOptions, (options) => {
  if (jobTitleFilter.value && !options.includes(jobTitleFilter.value)) jobTitleFilter.value = ''
})

const filteredRows = computed(() => {
  const q = normalizeText(searchQuery.value.trim())
  const jobTitle = jobTitleFilter.value
  return pendingRows.value.filter((row) => {
    if (jobTitle && (row.jobTitle?.trim() || '—') !== jobTitle) return false
    if (!q) return true
    return normalizeText(
      [row.employeeName, row.jobTitle ?? '', PAYROLL_STATUS_LABEL[row.status], String(row.grossFcfa)].join(' '),
    ).includes(q)
  })
})

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
  if (activeTab.value === 'heures-supp') return 'Heures supplémentaires médecins — validation et calcul'
  return 'Validation des salaires et fiches du personnel'
})

function selectTab(tab: TabId) {
  activeTab.value = tab
}

watch(activeTab, async (tab, previous) => {
  router.replace({
    query:
      tab === 'historique' || tab === 'avances' || tab === 'heures-supp' ? { tab } : {},
  })
  if (previous === 'avances' || tab === 'avances') {
    await loadAdvances()
  }
  if (tab === 'mois') {
    await loadPayroll()
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

let loadSeq = 0

async function loadPayroll() {
  const seq = ++loadSeq
  loading.value = true
  try {
    const [year, month] = periodInput.value.split('-').map(Number)
    const { data } = await api.get<PayrollResponse>('/admin/payroll', {
      params: Number.isFinite(year) && Number.isFinite(month) ? { year, month } : undefined,
    })
    // Changement de mois rapide : seule la dernière réponse s'affiche.
    if (seq === loadSeq) payload.value = data
  } finally {
    if (seq === loadSeq) loading.value = false
  }
}

async function reloadPayrollData() {
  await Promise.all([loadPayroll(), loadAdvances()])
}

async function payRow(row: (typeof rows.value)[number]) {
  const ok = await confirmAppModal({
    type: 'CONFIRM',
    title: 'Valider la paie',
    message:
      row.pendingAdvancesFcfa > 0
        ? `Confirmer le paiement du salaire de ${row.employeeName} : ${formatFcfa(row.grossFcfa)} − avance ${formatFcfa(row.pendingAdvancesFcfa)} = ${formatFcfa(row.netFcfa)} à verser ?`
        : `Confirmer le paiement du salaire de ${row.employeeName} (${formatFcfa(row.netFcfa)}) ?`,
    confirmLabel: 'Confirmer',
  })
  if (!ok) return
  await api.post(`/admin/payroll/${row.id}/pay`)
  await reloadPayrollData()
  historiquePanelRef.value?.reload()
  avancesPanelRef.value?.reload()
}

/** Paiement groupé : seulement après un filtre (poste ou recherche), sur les fiches affichées. */
const isFiltered = computed(() => !!jobTitleFilter.value || !!searchQuery.value.trim())
const payingFiltered = ref(false)

async function payFilteredRows() {
  const targets = filteredRows.value
  if (!isFiltered.value || !targets.length) return
  const net = targets.reduce((sum, row) => sum + row.netFcfa, 0)
  const scope = jobTitleFilter.value ? `du poste « ${jobTitleFilter.value} »` : 'filtrées'
  const ok = await confirmAppModal({
    type: 'CONFIRM',
    title: 'Paiement groupé',
    message: `Confirmer le paiement des ${targets.length} fiche(s) ${scope} pour ${periodLabel.value} (${formatFcfa(net)} net à verser) ?`,
    confirmLabel: 'Tout payer',
  })
  if (!ok) return
  payingFiltered.value = true
  let paid = 0
  try {
    for (const row of targets) {
      await api.post(`/admin/payroll/${row.id}/pay`)
      paid += 1
    }
    await showSuccessModal('Paiement groupé', `${paid} salaire(s) payé(s) pour ${periodLabel.value}.`)
  } catch (error) {
    await showApiErrorModal(error, `Paiement interrompu après ${paid} fiche(s) sur ${targets.length}.`)
  } finally {
    payingFiltered.value = false
    await reloadPayrollData()
    historiquePanelRef.value?.reload()
    avancesPanelRef.value?.reload()
  }
}

type PayrollExportRow = (typeof rows.value)[number]

const payrollExportColumns: ExportColumn<PayrollExportRow>[] = [
  { header: 'Employé', value: (r) => r.employeeName },
  { header: 'Poste', value: (r) => r.jobTitle ?? '—' },
  { header: 'Salaire brut', value: (r) => formatFcfa(r.grossFcfa) },
  { header: 'Avance', value: (r) => (r.pendingAdvancesFcfa > 0 ? formatFcfa(r.pendingAdvancesFcfa) : '—') },
  { header: 'Net', value: (r) => formatFcfa(r.netFcfa) },
  { header: 'Statut paiement', value: (r) => PAYROLL_STATUS_LABEL[r.status] },
]

function payrollExportTotals() {
  const gross = filteredRows.value.reduce((sum, row) => sum + row.grossFcfa, 0)
  const advances = filteredRows.value.reduce((sum, row) => sum + row.pendingAdvancesFcfa, 0)
  const net = filteredRows.value.reduce((sum, row) => sum + row.netFcfa, 0)
  return [
    { label: 'Nombre de fiches', value: String(filteredRows.value.length) },
    { label: 'Total brut', value: formatFcfa(gross) },
    { label: 'Total avances', value: formatFcfa(advances) },
    { label: 'Total net', value: formatFcfa(net) },
  ]
}

function payrollExportCaption() {
  return [
    { label: 'Période', value: periodLabel.value },
    { label: 'Poste', value: jobTitleFilter.value || 'Tous les postes' },
  ]
}

function exportPayrollPdf() {
  exportTablePdf('Paie du mois', payrollExportColumns, filteredRows.value, {
    captionRows: payrollExportCaption(),
    totalsRows: payrollExportTotals(),
  })
}

function exportPayrollExcel() {
  exportTableExcel('Paie du mois', payrollExportColumns, filteredRows.value, {
    totalsRows: payrollExportTotals(),
  })
}

function exportPayrollWord() {
  void exportTableWord('Paie du mois', payrollExportColumns, filteredRows.value, {
    captionRows: payrollExportCaption(),
    totalsRows: payrollExportTotals(),
  })
}

watch(periodInput, () => {
  if (activeTab.value === 'mois') void loadPayroll()
})

onMounted(reloadPayrollData)
</script>

<template>
  <div class="admin-page salaires-page">
    <UiPageHeader title="Salaires & paie" :subtitle="pageSubtitle" :icon="Coins">
      <template v-if="activeTab === 'mois'" #actions>
        <input
          v-model="periodInput"
          type="month"
          class="salaires-month-input"
          aria-label="Période de paie"
        />
        <ExportButtons :disabled="loading || !filteredRows.length" @pdf="exportPayrollPdf" @excel="exportPayrollExcel" @word="exportPayrollWord" />
        <UiButton
          v-if="isFiltered"
          variant="success"
          :disabled="payingFiltered || loading || !filteredRows.length"
          @click="payFilteredRows"
        >
          {{ payingFiltered ? 'Paiement…' : `Payer la sélection (${filteredRows.length})` }}
        </UiButton>
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
        <button
          type="button"
          class="salaires-toolbar__tab"
          :class="{ 'salaires-toolbar__tab--active': activeTab === 'heures-supp' }"
          :aria-selected="activeTab === 'heures-supp'"
          @click="selectTab('heures-supp')"
        >
          <Clock :size="16" />
          Heures supp.
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

        <div class="payroll-filters-row">
          <div class="payroll-search">
            <Search :size="16" class="payroll-search__icon" />
            <input
              v-model="searchQuery"
              type="search"
              class="payroll-search__input"
              placeholder="Rechercher un employé, un poste…"
              aria-label="Rechercher une fiche de paie"
            />
          </div>
          <select v-model="jobTitleFilter" class="payroll-job-select" aria-label="Filtrer par poste">
            <option value="">Tous les postes</option>
            <option v-for="title in jobTitleOptions" :key="title" :value="title">{{ title }}</option>
          </select>
          <span v-if="!isFiltered && pendingRows.length" class="payroll-filters-hint">
            Filtrez par poste pour payer plusieurs fiches à la fois.
          </span>
        </div>

        <div v-if="loading" class="chart-empty">Chargement…</div>
        <div v-else-if="!rows.length" class="chart-empty">
          Aucune fiche de paie — définissez un salaire fixe sur les fiches employés
        </div>
        <div v-else-if="!pendingRows.length" class="chart-empty">
          Toutes les fiches de {{ periodLabel }} sont payées.
          <UiButton size="sm" variant="ghost" :icon="History" @click="selectTab('historique')">
            Voir l'historique
          </UiButton>
        </div>
        <div v-else-if="!filteredRows.length" class="chart-empty">Aucun résultat</div>
        <table v-else class="admin-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Employé</th>
              <th>Poste</th>
              <th>Salaire brut</th>
              <th>Avance</th>
              <th>Net</th>
              <th>Statut paiement</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, index) in filteredRows" :key="row.id">
              <td>{{ index + 1 }}</td>
              <td>{{ row.employeeName }}</td>
              <td>{{ row.jobTitle ?? '—' }}</td>
              <td>{{ formatF(row.grossFcfa) }}</td>
              <td>
                <span v-if="(row.pendingAdvancesFcfa ?? 0) > 0" class="advance-deduct">
                  -{{ formatF(row.pendingAdvancesFcfa ?? 0) }}
                </span>
                <span v-else>—</span>
              </td>
              <td>{{ formatF(row.netFcfa) }}</td>
              <td>{{ PAYROLL_STATUS_LABEL[row.status] }}</td>
              <td>
                <UiButton
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

    <AdminPayrollHistoriquePanel
      v-else-if="activeTab === 'historique'"
      ref="historiquePanelRef"
      @cancelled="reloadPayrollData"
    />
    <div v-else-if="activeTab === 'avances'" class="salary-advances-admin">
      <p class="salary-advances-admin__hint">
        Les avances en attente sont automatiquement déduites au moment de la validation de la paie.
      </p>
      <GestionnaireSalaryAdvancesPanel ref="avancesPanelRef" api-base-path="/admin" />
    </div>
    <GestionnaireOvertimePanel v-else />
  </div>
</template>

<style scoped>
.payroll-filters-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
  margin-bottom: 0.75rem;
}

.payroll-search {
  position: relative;
  flex: 1 1 16rem;
  max-width: 22rem;
}

.payroll-filters-hint {
  align-self: center;
  color: var(--text-muted);
  font-size: 0.8rem;
}

.payroll-job-select {
  flex: 0 1 14rem;
  min-width: 0;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-card);
  color: var(--text);
  font-family: inherit;
  font-size: 0.875rem;
}

.payroll-search__icon {
  position: absolute;
  top: 50%;
  left: 0.65rem;
  transform: translateY(-50%);
  color: var(--text-muted);
  pointer-events: none;
}

.payroll-search__input {
  width: 100%;
  padding: 0.5rem 0.75rem 0.5rem 2.1rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-card);
  color: var(--text);
  font-size: 0.875rem;
}

.payroll-search__input:focus {
  outline: none;
  border-color: var(--primary-400);
}

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

.salaires-month-input {
  min-width: 160px;
  padding: 0.4rem 0.6rem;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: #fff;
  font-family: inherit;
  font-size: 0.8125rem;
  color: var(--text);
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
  font-size: 0.8125rem;
}

.admin-table th,
.admin-table td {
  padding: 0.55rem 0.4rem;
  border-bottom: 1px solid var(--border);
  text-align: left;
  font-size: 0.8125rem;
  white-space: nowrap;
}

.admin-table th {
  font-size: 0.75rem;
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
