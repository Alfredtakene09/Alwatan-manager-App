<script setup lang="ts">
import { computed, onMounted, ref, watch, type Component } from 'vue'
import { useRouter } from 'vue-router'
import {
  LayoutDashboard,
  Banknote,
  TrendingDown,
  TrendingUp,
  Users,
  FlaskConical,
  BedDouble,
  Wallet,
  Activity,
  CircleDollarSign,
} from '@lucide/vue'
import api from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { canAccessModule, formatFcfa, fullName } from '@/lib/roles'
import type { AdminDashboardOverview } from '@/lib/admin-dashboard'
import {
  formatMonthLabel,
  formatTrendPercentLocalized,
  translateDashboardLabel,
  translateTemplate,
} from '@/lib/dashboard-i18n'
import { useAppI18n } from '@/i18n/useAppI18n'
import type { GestionnaireDashboardOverview } from '@/lib/gestionnaire-dashboard'
import UiCard from '@/components/ui/UiCard.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import UiStatCard from '@/components/ui/UiStatCard.vue'
import RoleDashboardShell from '@/components/dashboard/RoleDashboardShell.vue'
import DashboardLineChart from '@/components/dashboard/DashboardLineChart.vue'
import DashboardDonutChart from '@/components/dashboard/DashboardDonutChart.vue'
import DashboardHorizontalBars from '@/components/dashboard/DashboardHorizontalBars.vue'
import type { SummaryStat } from '@/lib/dashboard-summary'
import { currentMonthKey, todayDateKey } from '@/lib/date-filters'
import { showAppModal } from '@/composables/useAppModal'

const router = useRouter()
const auth = useAuthStore()
const { localeCode, isArabic } = useAppI18n()

const overview = ref<AdminDashboardOverview | null>(null)
const gestionnaireOverview = ref<GestionnaireDashboardOverview | null>(null)
const loading = ref(false)
const loadError = ref('')
const selectedTrendMonth = ref('')

type DoctorShareItem = {
  key: string
  kind: 'CONSULTATION' | 'OPERATION_SURGEON' | 'OPERATION_ASSISTANT'
  amountFcfa: number
  businessDate: string
  surgeryCaseId?: string
  invoiceId?: string
  label: string
}

type DoctorShareDoctor = {
  id: string
  firstName: string
  lastName: string
  hasConsultationQuota?: boolean
  canAddToSalary?: boolean
  consultationShareFcfa: number
  surgeryShareFcfa: number
  totalShareFcfa: number
  items?: DoctorShareItem[]
}

type DoctorSharesOverview = {
  totals: {
    consultationShareFcfa: number
    surgeryShareFcfa: number
    totalShareFcfa: number
    pendingPayrollFcfa: number
  }
  doctors: DoctorShareDoctor[]
}

const doctorShares = ref<DoctorSharesOverview | null>(null)
const doctorSharePeriod = ref<'day' | 'month'>('month')
const doctorShareDoctorId = ref('')
const doctorShareOptions = ref<Array<{ id: string; firstName: string; lastName: string }>>([])
const settlingDoctorShares = ref(false)
const settleSharesMessage = ref('')
const settleSharesType = ref<'success' | 'error'>('success')

const showAdminSection = computed(() =>
  auth.user ? canAccessModule(auth.user.role, 'admin') : false,
)
const showGestionnaireSection = computed(() =>
  auth.user ? canAccessModule(auth.user.role, 'gestionnaire') : false,
)

const doctorSharesCardValue = computed(() => {
  const totals = doctorShares.value?.totals
  if (!totals) return formatFcfa(0)
  return formatFcfa(totals.totalShareFcfa)
})

const doctorSharesTrend = computed(() => {
  void localeCode.value
  const totals = doctorShares.value?.totals
  if (!totals) return translateDashboardLabel('Parts médecins non réglées')
  const parts = [
    translateTemplate('Consult. {amount}', { amount: formatFcfa(totals.consultationShareFcfa) }),
    translateTemplate('Opér. {amount}', { amount: formatFcfa(totals.surgeryShareFcfa) }),
  ]
  if (totals.pendingPayrollFcfa > 0) {
    parts.push(translateTemplate('Paie {amount}', { amount: formatFcfa(totals.pendingPayrollFcfa) }))
  }
  return parts.join(' · ')
})

const selectedDoctorLabel = computed(() => {
  if (!doctorShareDoctorId.value) return translateDashboardLabel('Somme globale')
  const doc = doctorShareOptions.value.find((d) => d.id === doctorShareDoctorId.value)
  return doc ? fullName(doc.firstName, doc.lastName) : translateDashboardLabel('Médecin')
})

const selectedDoctorShareRow = computed(() => {
  if (!doctorShareDoctorId.value || !doctorShares.value) return null
  return doctorShares.value.doctors.find((d) => d.id === doctorShareDoctorId.value) ?? null
})

const canSettleSelectedDoctorCash = computed(() => {
  const row = selectedDoctorShareRow.value
  return Boolean(row && (row.totalShareFcfa ?? 0) > 0 && (row.items?.length ?? 0) > 0)
})

async function settleSelectedDoctorCash() {
  const row = selectedDoctorShareRow.value
  if (!row?.items?.length) return

  const confirmed = await showAppModal({
    type: 'CONFIRM',
    title: translateDashboardLabel('Régler en espèces'),
    message: translateTemplate(
      'Confirmer le règlement cash de {amount} pour {name} ? La carte repassera à zéro.',
      {
        amount: formatFcfa(row.totalShareFcfa),
        name: fullName(row.firstName, row.lastName),
      },
    ),
    confirmLabel: 'Régler',
    cancelLabel: 'Annuler',
    showCancel: true,
  })
  if (!confirmed) return

  settlingDoctorShares.value = true
  settleSharesMessage.value = ''
  try {
    const consultItems = row.items.filter(
      (item) => item.kind === 'CONSULTATION' && item.invoiceId,
    )
    if (consultItems.length) {
      await api.post('/doctor-shares/settle-consultations-cash', {
        items: consultItems.map((item) => ({
          invoiceId: item.invoiceId!,
          amountFcfa: item.amountFcfa,
          businessDate: item.businessDate,
          doctorUserId: row.id,
        })),
      })
    }

    const surgeryShares = new Map<string, Set<'surgeon' | 'assistant'>>()
    for (const item of row.items) {
      if (!item.surgeryCaseId) continue
      if (item.kind !== 'OPERATION_SURGEON' && item.kind !== 'OPERATION_ASSISTANT') continue
      const set = surgeryShares.get(item.surgeryCaseId) ?? new Set()
      set.add(item.kind === 'OPERATION_SURGEON' ? 'surgeon' : 'assistant')
      surgeryShares.set(item.surgeryCaseId, set)
    }
    for (const [surgeryId, shares] of surgeryShares) {
      await api.post('/doctor-shares/settle-surgery-cash', {
        surgeryId,
        shares: [...shares],
      })
    }

    settleSharesType.value = 'success'
    settleSharesMessage.value = translateDashboardLabel(
      'Parts réglées en espèces — la carte est à jour.',
    )
    await loadDoctorShares()
  } catch (error: unknown) {
    const err = error as { response?: { data?: { error?: string } } }
    settleSharesType.value = 'error'
    settleSharesMessage.value =
      err.response?.data?.error ||
      translateDashboardLabel('Impossible de régler ces parts en espèces.')
  } finally {
    settlingDoctorShares.value = false
  }
}


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
      label: translateDashboardLabel('Recettes du mois'),
      value: formatFcfa(k.revenueMonthFcfa),
      icon: Banknote,
      variant: 'green',
      trend: formatTrendPercentLocalized(k.revenueChangePercent),
    },
    {
      id: 'expenses',
      label: translateDashboardLabel('Dépenses du mois'),
      value: formatFcfa(k.expensesMonthFcfa),
      icon: TrendingDown,
      variant: 'rose',
      trend: formatTrendPercentLocalized(k.expensesChangePercent),
    },
    {
      id: 'net',
      label: translateDashboardLabel('Bénéfice net'),
      value: formatFcfa(k.netMonthFcfa),
      icon: TrendingUp,
      variant: 'blue',
      trend: formatTrendPercentLocalized(k.netChangePercent),
    },
    {
      id: 'payroll',
      label: translateDashboardLabel('Masse salariale'),
      value: formatFcfa(k.payrollMonthFcfa),
      icon: Users,
      variant: 'violet',
      trend: formatTrendPercentLocalized(k.payrollChangePercent),
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

const filteredTrend = computed(() => {
  if (!overview.value) return []
  const points = overview.value.monthlyTrend
  if (!selectedTrendMonth.value) return points
  const [yearRaw, monthRaw] = selectedTrendMonth.value.split('-')
  const year = Number(yearRaw)
  const month = Number(monthRaw)
  if (!Number.isFinite(year) || !Number.isFinite(month)) return points
  const endIndex = points.findIndex((row) => row.year === year && row.month === month)
  if (endIndex < 0) return points
  return points.slice(Math.max(0, endIndex - 11), endIndex + 1)
})

const lineChartLabels = computed(() => {
  void localeCode.value
  const locale = isArabic.value ? 'ar-TD' : 'fr-FR'
  return filteredTrend.value.map((row) => formatMonthLabel(row.year, row.month, locale))
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

async function loadDoctorShares() {
  if (!showAdminSection.value && !showGestionnaireSection.value) {
    doctorShares.value = null
    return
  }
  const params: Record<string, string> = {
    period: doctorSharePeriod.value,
  }
  if (doctorSharePeriod.value === 'day') params.day = todayDateKey()
  else params.month = currentMonthKey()
  if (doctorShareDoctorId.value) params.doctorId = doctorShareDoctorId.value

  const [{ data: overviewData }, { data: doctors }] = await Promise.all([
    api.get<DoctorSharesOverview>('/doctor-shares/receivable', { params }),
    doctorShareOptions.value.length
      ? Promise.resolve({ data: doctorShareOptions.value })
      : api.get<Array<{ id: string; firstName: string; lastName: string }>>('/doctor-shares/doctors'),
  ])
  doctorShares.value = overviewData
  if (!doctorShareOptions.value.length) {
    doctorShareOptions.value = doctors
  }
}

async function loadOverview() {
  loading.value = true
  loadError.value = ''
  try {
    const tasks: Promise<void>[] = []

    if (showAdminSection.value) {
      tasks.push(
        api.get<AdminDashboardOverview>('/dashboard/admin').then(({ data }) => {
          overview.value = data
        }),
      )
    } else {
      overview.value = null
    }

    if (showGestionnaireSection.value) {
      tasks.push(
        api.get<GestionnaireDashboardOverview>('/dashboard/gestionnaire').then(({ data }) => {
          gestionnaireOverview.value = data
        }),
      )
    } else {
      gestionnaireOverview.value = null
    }

    tasks.push(loadDoctorShares())

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
watch([doctorSharePeriod, doctorShareDoctorId], () => {
  settleSharesMessage.value = ''
  loadDoctorShares().catch(() => {
    doctorShares.value = null
  })
})
</script>

<template>
  <RoleDashboardShell
    title="Tableau de board"
    subtitle="Vue d'ensemble, finances, caisses et supervision de la clinique"
    :icon="LayoutDashboard"
    :stats="summaryStats"
    :loading="loading"
    :load-error="loadError"
    @refresh="loadOverview"
  >
    <template #actions>
      <UiButton
        v-if="showAdminSection"
        variant="ghost"
        size="sm"
        :icon="Wallet"
        @click="router.push('/admin/depenses')"
      >
        Gestion des dépenses
      </UiButton>
      <UiButton variant="ghost" size="sm" :disabled="loading" @click="loadOverview">
        Actualiser
      </UiButton>
    </template>

    <div class="admin-dashboard">
      <section
        v-if="showAdminSection || showGestionnaireSection"
        class="doctor-shares-section"
      >
        <div class="doctor-shares-section__header">
          <h3>{{ translateDashboardLabel('Parts médecins à percevoir') }}</h3>
          <span>{{ selectedDoctorLabel }}</span>
        </div>
        <div class="doctor-shares-section__filters">
          <UiSelect v-model="doctorSharePeriod" :label="translateDashboardLabel('Période')">
            <option value="day">{{ translateDashboardLabel("Aujourd'hui") }}</option>
            <option value="month">{{ translateDashboardLabel('Mois') }}</option>
          </UiSelect>
          <UiSelect
            v-model="doctorShareDoctorId"
            :label="translateDashboardLabel('Médecin')"
          >
            <option value="">{{ translateDashboardLabel('Tous (somme globale)') }}</option>
            <option v-for="doc in doctorShareOptions" :key="doc.id" :value="doc.id">
              {{ fullName(doc.firstName, doc.lastName) }}
            </option>
          </UiSelect>
          <div class="doctor-shares-section__actions">
            <UiButton
              v-if="canSettleSelectedDoctorCash"
              type="button"
              size="sm"
              variant="secondary"
              :icon="Wallet"
              :loading="settlingDoctorShares"
              @click="settleSelectedDoctorCash"
            >
              {{ translateDashboardLabel('Régler en espèces') }}
            </UiButton>
            <p v-else-if="!doctorShareDoctorId" class="doctor-shares-section__hint">
              {{
                translateDashboardLabel(
                  'Sélectionnez un médecin pour afficher le bouton de règlement.',
                )
              }}
            </p>
            <p
              v-else-if="(selectedDoctorShareRow?.totalShareFcfa ?? 0) <= 0"
              class="doctor-shares-section__hint"
            >
              {{ translateDashboardLabel('Rien à régler pour ce médecin.') }}
            </p>
          </div>
        </div>
        <UiStatCard
          label="À percevoir (parts %)"
          :value="doctorSharesCardValue"
          :trend="doctorSharesTrend"
          :icon="CircleDollarSign"
          variant="rose"
          compact
        />
        <p
          v-if="settleSharesMessage"
          class="doctor-shares-section__message"
          :class="`doctor-shares-section__message--${settleSharesType}`"
        >
          {{ settleSharesMessage }}
        </p>
      </section>

      <section v-if="showAdminSection && revenueModuleStats.length" class="finance-entry-section">
        <div class="finance-entry-section__header">
          <h3>Entrées financières par module</h3>
          <span>{{ selectedTrendMonth ? 'Période personnalisée' : 'Vue agrégée' }}</span>
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
          label="Patients aujourd'hui"
          :value="overview?.clinical.patientsToday ?? 0"
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
          description="Recettes, dépenses et bénéfice net — 12 mois glissants"
          :icon="TrendingUp"
          icon-variant="blue"
        >
          <div class="trend-filters">
            <UiInput v-model="selectedTrendMonth" type="month" label="Période" class="trend-filters__date" />
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
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 0.75rem;
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
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.75rem;
}

.doctor-shares-section {
  display: grid;
  gap: 0.75rem;
  padding: 1rem 1.1rem;
  border-radius: 14px;
  border: 1px solid rgba(225, 29, 72, 0.14);
  background: linear-gradient(180deg, rgba(255, 241, 242, 0.9), #fff);
}

.doctor-shares-section__header {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
  align-items: baseline;
}

.doctor-shares-section__header h3 {
  margin: 0;
  font-size: 1rem;
}

.doctor-shares-section__header span {
  font-size: 0.8125rem;
  color: var(--text-muted);
}

.doctor-shares-section__filters {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
  align-items: end;
}

.doctor-shares-section__actions {
  grid-column: 1 / -1;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.65rem;
}

.doctor-shares-section__hint {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--text-muted);
}

.doctor-shares-section__message {
  margin: 0;
  font-size: 0.8125rem;
}

.doctor-shares-section__message--success {
  color: #047857;
}

.doctor-shares-section__message--error {
  color: #be123c;
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
  .charts-grid,
  .clinical-cards,
  .doctor-shares-section__filters {
    grid-template-columns: 1fr;
  }

  .charts-grid > :first-child {
    grid-column: auto;
  }
}

@media (max-width: 800px) {
  .finance-entry-cards {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 520px) {
  .finance-entry-cards {
    grid-template-columns: 1fr;
  }
}
</style>
