<script setup lang="ts">
import { computed, onMounted, ref, watch, type Component } from 'vue'
import { useRouter } from 'vue-router'
import {
  LayoutDashboard,
  Banknote,
  TrendingDown,
  TrendingUp,
  Users,
  Stethoscope,
  FlaskConical,
  BedDouble,
  Wallet,
  Activity,
} from '@lucide/vue'
import api from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { canAccessModule, formatFcfa } from '@/lib/roles'
import type { AdminDashboardOverview } from '@/lib/admin-dashboard'
import {
  formatMonthLabel,
  evolutionTextForExport,
  formatTrendPercentLocalized,
  translateDashboardLabel,
  translateTemplate,
} from '@/lib/dashboard-i18n'
import { useAppI18n } from '@/i18n/useAppI18n'
import type { GestionnaireDashboardOverview } from '@/lib/gestionnaire-dashboard'
import UiCard from '@/components/ui/UiCard.vue'
import UiButton from '@/components/ui/UiButton.vue'
import ExportButtons from '@/components/ui/ExportButtons.vue'
import UiStatCard from '@/components/ui/UiStatCard.vue'
import {
  exportBasename,
  exportTablePdf,
  exportWorkbook,
  type ExportColumn,
  type ExportSection,
  type WorkbookSheetDef,
} from '@/lib/table-export'
import RoleDashboardShell from '@/components/dashboard/RoleDashboardShell.vue'
import DashboardLineChart from '@/components/dashboard/DashboardLineChart.vue'
import DashboardDonutChart from '@/components/dashboard/DashboardDonutChart.vue'
import DashboardHorizontalBars from '@/components/dashboard/DashboardHorizontalBars.vue'
import type { SummaryStat } from '@/lib/dashboard-summary'

const router = useRouter()
const auth = useAuthStore()
const { localeCode, isArabic, uiText } = useAppI18n()

function localIsoDate(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const dateFrom = ref('')
const dateTo = ref('')

const overview = ref<AdminDashboardOverview | null>(null)
const gestionnaireOverview = ref<GestionnaireDashboardOverview | null>(null)
const loading = ref(false)
const loadError = ref('')

const showAdminSection = computed(() =>
  auth.user ? canAccessModule(auth.user.role, 'admin') : false,
)
const showGestionnaireSection = computed(() =>
  auth.user ? canAccessModule(auth.user.role, 'gestionnaire') : false,
)

const isFullMonthRange = computed(() => {
  const [yearRaw, monthRaw] = dateFrom.value.split('-')
  const year = Number(yearRaw)
  const month = Number(monthRaw)
  if (!Number.isFinite(year) || !Number.isFinite(month)) return false
  const monthStart = localIsoDate(new Date(year, month - 1, 1))
  const monthEnd = localIsoDate(new Date(year, month, 0))
  return dateFrom.value === monthStart && dateTo.value === monthEnd
})

const periodQuery = computed(() => ({
  from: dateFrom.value,
  to: dateTo.value,
}))

function formatRegistrationDate(iso: string) {
  const [year, month, day] = iso.split('-')
  if (!year || !month || !day) return iso
  return `${day.padStart(2, '0')}-${month.padStart(2, '0')}-${year}`
}

function formatRegistrationRange(fromIso: string, toIso: string) {
  if (fromIso === toIso) return formatRegistrationDate(fromIso)
  return `${formatRegistrationDate(fromIso)} – ${formatRegistrationDate(toIso)}`
}

const periodCaption = computed(() => {
  void localeCode.value
  const from = dateFrom.value
  const to = dateTo.value
  if (!from || !to) return uiText('Période')
  return formatRegistrationRange(from, to)
})

const boardSubtitle = computed(() => {
  void localeCode.value
  const base = uiText("Vue d'ensemble, finances, caisses et supervision de la clinique")
  if (!dateFrom.value || !dateTo.value) return base
  return `${base} — ${periodCaption.value}`
})


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
  void localeCode.value
  const k = gestionnaireOverview.value?.financialKpis ?? overview.value?.financialKpis
  if (!k) return []
  const cash = gestionnaireOverview.value?.kpis
  const soldeFcfa = cash
    ? cash.receptionCashFcfa + cash.comptableCashFcfa
    : 0
  return [
    {
      id: 'revenue',
      label: translateDashboardLabel(isFullMonthRange.value ? 'Recettes du mois' : 'Recettes de la période'),
      value: formatFcfa(k.revenueMonthFcfa),
      icon: Banknote,
      variant: 'green',
      trend: formatTrendPercentLocalized(k.revenueChangePercent, !isFullMonthRange.value),
    },
    {
      id: 'expenses',
      label: translateDashboardLabel(isFullMonthRange.value ? 'Dépenses du mois' : 'Dépenses de la période'),
      value: formatFcfa(k.expensesMonthFcfa),
      icon: TrendingDown,
      variant: 'rose',
      trend: formatTrendPercentLocalized(k.expensesChangePercent, !isFullMonthRange.value),
    },
    {
      id: 'net',
      label: translateDashboardLabel('Bénéfice net'),
      value: formatFcfa(k.netMonthFcfa),
      icon: TrendingUp,
      variant: 'blue',
      trend: formatTrendPercentLocalized(k.netChangePercent, !isFullMonthRange.value),
    },
    {
      id: 'payroll',
      label: translateDashboardLabel('Masse salariale'),
      value: formatFcfa(k.payrollMonthFcfa),
      icon: Users,
      variant: 'violet',
      trend: translateDashboardLabel('Salaires à jour des fiches employés'),
    },
    {
      id: 'doctor-shares',
      label: translateDashboardLabel('Parts médecins reçues'),
      value: formatFcfa(k.doctorSharesReceivedFcfa ?? 0),
      icon: Stethoscope,
      variant: 'amber',
      trend: [
        translateTemplate('Consultations : {amount}', {
          amount: formatFcfa(k.doctorSharesConsultationFcfa ?? 0),
        }),
        translateTemplate('Opérations : {amount}', {
          amount: formatFcfa(k.doctorSharesSurgeryFcfa ?? 0),
        }),
        formatTrendPercentLocalized(k.doctorSharesChangePercent ?? 0, !isFullMonthRange.value),
      ].join(' · '),
    },
    {
      id: 'balance',
      label: translateDashboardLabel('Solde'),
      value: formatFcfa(soldeFcfa),
      icon: Wallet,
      variant: 'cyan',
    },
  ]
})

const filteredTrend = computed(() => overview.value?.monthlyTrend ?? [])

const trendRangeCaption = computed(() => {
  const points = filteredTrend.value
  const first = points[0]
  const last = points[points.length - 1]
  if (first?.fromIso && last?.toIso) return formatRegistrationRange(first.fromIso, last.toIso)
  return periodCaption.value
})

const lineChartLabels = computed(() => {
  void localeCode.value
  const locale = isArabic.value ? 'ar-TD' : 'fr-FR'
  return filteredTrend.value.map((row) =>
    row.fromIso && row.toIso
      ? formatRegistrationRange(row.fromIso, row.toIso)
      : formatMonthLabel(row.year, row.month, locale),
  )
})
const lineChartSeries = computed(() => {
  void localeCode.value
  const points = filteredTrend.value
  return [
    {
      key: 'revenue',
      label: translateDashboardLabel('Recettes'),
      color: '#16a34a',
      values: points.map((row) => row.revenueFcfa),
    },
    {
      key: 'expenses',
      label: translateDashboardLabel('Dépenses'),
      color: '#e11d48',
      values: points.map((row) => row.expensesFcfa),
    },
    {
      key: 'net',
      label: translateDashboardLabel('Bénéfice net'),
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

const moduleIconByKey: Record<string, Component> = {
  consultations: Users,
  examens: FlaskConical,
  laboratoire: FlaskConical,
  operations: TrendingUp,
  hospitalisation: BedDouble,
  pharmacie: Wallet,
  autres: Banknote,
}

const moduleVariantByKey: Record<string, NonNullable<SummaryStat['variant']>> = {
  consultations: 'teal',
  examens: 'blue',
  laboratoire: 'blue',
  operations: 'amber',
  hospitalisation: 'violet',
  pharmacie: 'green',
  autres: 'cyan',
}

const revenueModuleStats = computed(() => {
  void localeCode.value
  const rows = overview.value?.revenueBreakdown ?? []
  return rows.map((row) => {
    const normalizedKey = row.key.toLowerCase()
    const icon = moduleIconByKey[normalizedKey] ?? Banknote
    const variant = moduleVariantByKey[normalizedKey] ?? 'green'
    return {
      id: `revenue-module-${row.key}`,
      label: `${translateDashboardLabel('Entrées')} ${translateDashboardLabel(row.label)}`,
      value: formatFcfa(row.amountFcfa),
      icon,
      variant,
    }
  })
})

const operationsTotalFcfa = computed(() =>
  (overview.value?.operationsByService ?? []).reduce((sum, row) => sum + row.amountFcfa, 0),
)

const operationsTotalCount = computed(() =>
  (overview.value?.operationsByService ?? []).reduce((sum, row) => sum + row.count, 0),
)

const operationsCountLabel = computed(() => {
  void localeCode.value
  const n = operationsTotalCount.value
  return n <= 1
    ? translateTemplate('{n} opération', { n })
    : translateTemplate('{n} opérations', { n })
})

type DashboardExportRow = { label: string; value: string; extra?: string; extra2?: string }

const kpiColumns: ExportColumn<DashboardExportRow>[] = [
  { header: uiText('Indicateur'), value: (row) => row.label },
  { header: uiText('Valeur'), value: (row) => row.value },
  { header: uiText('Évolution'), value: (row) => row.extra ?? '' },
]

const amountColumns: ExportColumn<DashboardExportRow>[] = [
  { header: uiText('Libellé'), value: (row) => row.label },
  { header: uiText('Montant'), value: (row) => row.value },
  { header: uiText('Part'), value: (row) => row.extra ?? '' },
]

const serviceColumns: ExportColumn<DashboardExportRow>[] = [
  { header: uiText('Service'), value: (row) => row.label },
  { header: uiText('Nombre'), value: (row) => row.extra ?? '' },
  { header: uiText('Montant'), value: (row) => row.value },
]

const simpleColumns: ExportColumn<DashboardExportRow>[] = [
  { header: uiText('Libellé'), value: (row) => row.label },
  { header: uiText('Valeur'), value: (row) => row.value },
]

function percentLabel(percent?: number) {
  if (percent == null || !Number.isFinite(percent)) return ''
  return `${percent.toLocaleString(isArabic.value ? 'ar-TD' : 'fr-FR', { maximumFractionDigits: 1 })} %`
}

function dashboardExportPayload() {
  void localeCode.value
  const title = uiText('Tableau de board')
  const captionRows = [{ label: uiText('Période'), value: periodCaption.value }]
  const sections: ExportSection<DashboardExportRow>[] = []

  const kpiRows: DashboardExportRow[] = summaryStats.value.map((card) => ({
    label: String(card.label),
    value: String(card.value),
    extra: evolutionTextForExport(card.trend ? String(card.trend) : ''),
  }))
  if (kpiRows.length) {
    sections.push({
      title: uiText('Indicateurs'),
      columns: kpiColumns,
      rows: kpiRows,
      columnWidths: [10, 48, 44, 80],
    })
  }

  const revenueRows: DashboardExportRow[] = (overview.value?.revenueBreakdown ?? []).map((row) => ({
    label: `${translateDashboardLabel('Entrées')} ${translateDashboardLabel(row.label)}`,
    value: formatFcfa(row.amountFcfa),
    extra: percentLabel(row.percent),
  }))
  if (revenueRows.length) {
    sections.push({
      title: uiText('Entrées financières par module'),
      columns: amountColumns,
      rows: revenueRows,
    })
  }

  const expenseRows: DashboardExportRow[] = (overview.value?.expenseBreakdown ?? []).map((row) => ({
    label: translateDashboardLabel(row.label),
    value: formatFcfa(row.amountFcfa),
    extra: percentLabel(row.percent),
  }))
  if (expenseRows.length) {
    sections.push({ title: uiText('Dépenses par catégorie'), columns: amountColumns, rows: expenseRows })
  }

  const operationRows: DashboardExportRow[] = (overview.value?.operationsByService ?? []).map((row) => ({
    label: row.serviceName,
    extra: String(row.count),
    value: formatFcfa(row.amountFcfa),
  }))
  if (operationRows.length) {
    sections.push({
      title: uiText('Opérations par service'),
      columns: serviceColumns,
      rows: operationRows,
      totalsRows: [
        { label: uiText('Total'), value: `${operationsCountLabel.value} — ${formatFcfa(operationsTotalFcfa.value)}` },
      ],
    })
  }

  if (overview.value?.clinical) {
    const clinical = overview.value.clinical
    sections.push({
      title: uiText('Activité clinique'),
      columns: simpleColumns,
      rows: [
        { label: uiText('Opération'), value: `${formatFcfa(operationsTotalFcfa.value)} (${operationsCountLabel.value})` },
        {
          label: uiText('Patients de la période'),
          value: String(clinical.patientsInPeriod ?? clinical.patientsToday ?? 0),
        },
        { label: uiText('Examens en attente'), value: String(clinical.examsPending ?? 0) },
        { label: uiText('Hospitalisations actives'), value: String(clinical.activeHospitalizations ?? 0) },
      ],
    })
  }

  const trendRows: DashboardExportRow[] = filteredTrend.value.map((row, index) => ({
    label: lineChartLabels.value[index] ?? row.label,
    value: formatFcfa(row.revenueFcfa),
    extra: formatFcfa(row.expensesFcfa),
    extra2: formatFcfa(row.netFcfa),
  }))
  if (trendRows.length) {
    sections.push({
      title: uiText('Évolution mensuelle'),
      columns: [
        { header: uiText('Dates'), value: (row) => row.label },
        { header: uiText('Recettes'), value: (row) => row.value },
        { header: uiText('Dépenses'), value: (row) => row.extra ?? '' },
        { header: uiText('Bénéfice net'), value: (row) => row.extra2 ?? '' },
      ],
      rows: trendRows,
      columnWidths: [12, 62, 36, 36, 36],
    })
  }

  const excelSheets: WorkbookSheetDef[] = sections.map((section) => ({
    name: section.title,
    columns: section.columns,
    rows: section.rows,
    totalsRows: section.totalsRows,
  }))

  return { title, captionRows, sections, excelSheets, hasRows: sections.some((section) => section.rows.length) }
}

function exportDashboardPdf() {
  const payload = dashboardExportPayload()
  exportTablePdf(payload.title, simpleColumns, [], {
    captionRows: payload.captionRows,
    sections: payload.sections,
  })
}

function exportDashboardExcel() {
  const payload = dashboardExportPayload()
  exportWorkbook(exportBasename(payload.title), payload.excelSheets)
}

const canExportDashboard = computed(() => !loading.value && dashboardExportPayload().hasRows)

async function loadOverview() {
  loading.value = true
  loadError.value = ''
  try {
    const tasks: Promise<void>[] = []
    const params = dateFrom.value && dateTo.value ? periodQuery.value : {}

    if (showAdminSection.value) {
      tasks.push(
        api.get<AdminDashboardOverview>('/dashboard/admin', { params }).then(({ data }) => {
          overview.value = data
          if (!dateFrom.value && data.period?.from && data.period.to) {
            dateFrom.value = data.period.from
            dateTo.value = data.period.to
          }
        }),
      )
    } else {
      overview.value = null
    }

    if (showGestionnaireSection.value) {
      tasks.push(
        api.get<GestionnaireDashboardOverview>('/dashboard/gestionnaire', { params }).then(({ data }) => {
          gestionnaireOverview.value = data
        }),
      )
    } else {
      gestionnaireOverview.value = null
    }

    if (!tasks.length) {
      overview.value = null
      gestionnaireOverview.value = null
    } else {
      await Promise.all(tasks)
    }
  } catch {
    loadError.value = 'Impossible de charger le tableau de bord.'
    overview.value = null
    gestionnaireOverview.value = null
  } finally {
    loading.value = false
  }
}

onMounted(loadOverview)

watch([dateFrom, dateTo], ([from, to], [prevFrom, prevTo]) => {
  if (!prevFrom && !prevTo) return
  if (from > to) {
    dateTo.value = from
    return
  }
  void loadOverview()
})
</script>

<template>
  <RoleDashboardShell
    title="Tableau de board"
    :subtitle="boardSubtitle"
    :icon="LayoutDashboard"
    :stats="summaryStats"
    :loading="loading"
    :load-error="loadError"
    @refresh="loadOverview"
  >
    <template #actions>
      <div class="dashboard-period" role="group" :aria-label="uiText('Période')">
        <label class="dashboard-period__field">
          <span class="dashboard-period__label">{{ uiText('Du') }}</span>
          <input
            v-model="dateFrom"
            type="date"
            class="dashboard-period__input"
            :max="dateTo || undefined"
            :aria-label="uiText('Du')"
          />
        </label>
        <label class="dashboard-period__field">
          <span class="dashboard-period__label">{{ uiText('Au') }}</span>
          <input
            v-model="dateTo"
            type="date"
            class="dashboard-period__input"
            :min="dateFrom || undefined"
            :aria-label="uiText('Au')"
          />
        </label>
      </div>
      <UiButton
        v-if="showAdminSection"
        variant="ghost"
        size="sm"
        :icon="Wallet"
        @click="router.push('/admin/depenses')"
      >
        Gestion des dépenses
      </UiButton>
      <ExportButtons
        :disabled="!canExportDashboard"
        :show-word="false"
        @pdf="exportDashboardPdf"
        @excel="exportDashboardExcel"
      />
      <UiButton variant="ghost" size="sm" :disabled="loading" @click="loadOverview">
        Actualiser
      </UiButton>
    </template>

    <div class="admin-dashboard">
      <section v-if="showAdminSection && revenueModuleStats.length" class="finance-entry-section">
        <div class="finance-entry-section__header">
          <h3>Entrées financières par module</h3>
          <span>{{ periodCaption }}</span>
        </div>
        <div class="finance-entry-cards">
          <UiStatCard
            v-for="card in revenueModuleStats"
            :key="card.id"
            :label="card.label"
            :value="card.value"
            :icon="card.icon"
            :variant="card.variant"
            compact
          />
        </div>
      </section>

      <section v-if="showAdminSection" class="clinical-cards">
        <UiStatCard
          label="Opération"
          :value="formatFcfa(operationsTotalFcfa)"
          :trend="operationsCountLabel"
          :icon="Activity"
          variant="amber"
          compact
        />
        <UiStatCard
          label="Patients de la période"
          :value="overview?.clinical.patientsInPeriod ?? overview?.clinical.patientsToday ?? 0"
          :icon="Users"
          variant="teal"
          compact
        />
        <UiStatCard
          label="Examens en attente"
          :value="overview?.clinical.examsPending ?? 0"
          :icon="FlaskConical"
          variant="amber"
          compact
        />
        <UiStatCard
          label="Hospitalisations actives"
          :value="overview?.clinical.activeHospitalizations ?? 0"
          :icon="BedDouble"
          variant="violet"
          compact
        />
      </section>

      <section v-if="showAdminSection" class="charts-grid">
        <UiCard
          title="Évolution mensuelle"
          :description="trendRangeCaption"
          :icon="TrendingUp"
          icon-variant="blue"
        >
          <DashboardLineChart
            :labels="lineChartLabels"
            :series="lineChartSeries"
            :format-value="formatFcfa"
            :loading="loading"
          />
        </UiCard>

        <UiCard
          title="Répartition des recettes"
          :description="isFullMonthRange ? 'Mois en cours' : periodCaption"
          :icon="Banknote"
          icon-variant="green"
        >
          <DashboardDonutChart :slices="revenueDonut" :format-value="formatFcfa" />
        </UiCard>

        <UiCard
          title="Répartition des dépenses"
          :description="isFullMonthRange ? 'Mois en cours' : periodCaption"
          :icon="Wallet"
          icon-variant="rose"
        >
          <DashboardHorizontalBars :rows="expenseBars" :format-value="formatFcfa" />
        </UiCard>
      </section>
    </div>
  </RoleDashboardShell>
</template>

<style scoped>
@import '@/styles/dashboard-charts.css';

.admin-dashboard {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.finance-entry-section {
  border: 1px solid rgba(22, 163, 74, 0.22);
  border-radius: 14px;
  padding: 0.75rem;
  background: linear-gradient(180deg, rgba(240, 253, 244, 0.75), rgba(255, 255, 255, 0.95));
}

.finance-entry-section__header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.5rem;
}

.finance-entry-section__header h3 {
  margin: 0;
  font-size: 0.95rem;
  color: #166534;
}

.finance-entry-section__header span {
  font-size: 0.75rem;
  color: #4b5563;
}

.finance-entry-cards {
  display: flex;
  flex-wrap: nowrap;
  gap: 0.55rem;
}

.finance-entry-cards > * {
  flex: 1 1 0;
  min-width: 0;
}

.charts-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
}

.charts-grid > :first-child {
  grid-column: 1 / -1;
}

.clinical-cards {
  display: flex;
  flex-wrap: nowrap;
  gap: 0.55rem;
}

.clinical-cards > * {
  flex: 1 1 0;
  min-width: 0;
}

.page-header__actions :deep(.dashboard-period),
.dashboard-period {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 0.45rem;
}

.dashboard-period__field {
  display: flex;
  flex-direction: column;
  gap: 0.12rem;
}

.dashboard-period__label {
  font-size: 0.625rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}

.dashboard-period__input {
  height: 2.15rem;
  width: 9.25rem;
  max-width: 100%;
  padding: 0 0.5rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-card);
  color: var(--text);
  font: inherit;
  font-size: 0.8125rem;
}

.trend-filters {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.trend-filters__date {
  max-width: 220px;
}

@media (max-width: 1100px) {
  .charts-grid {
    grid-template-columns: 1fr;
  }

  .charts-grid > :first-child {
    grid-column: auto;
  }
}

@media (max-width: 639px) {
  .finance-entry-cards,
  .clinical-cards {
    flex-wrap: wrap;
  }

  .finance-entry-cards > *,
  .clinical-cards > * {
    flex: 1 1 calc(50% - 0.55rem);
  }
}
</style>
