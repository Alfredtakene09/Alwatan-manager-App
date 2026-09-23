<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  PillBottle,
  Banknote,
  PackageX,
  UserRound,
  TrendingUp,
  Wallet,
  Percent,
  ShoppingBag,
  Receipt,
  ShoppingCart,
  Package,
  RotateCcw,
  ChevronDown,
  Printer,
} from '@lucide/vue'
import api from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { canAccessModule, formatFcfa, fullName, ROLE_LABELS, type AppUserRole } from '@/lib/roles'
import UiCard from '@/components/ui/UiCard.vue'
import UiButton from '@/components/ui/UiButton.vue'
import RoleDashboardShell from '@/components/dashboard/RoleDashboardShell.vue'
import DashboardMetricBars, { type MetricBar } from '@/components/dashboard/DashboardMetricBars.vue'
import DashboardPendingBars from '@/components/dashboard/DashboardPendingBars.vue'
import UiStatCard from '@/components/ui/UiStatCard.vue'
import type { SummaryStat } from '@/lib/dashboard-summary'
import { useAppI18n } from '@/i18n/useAppI18n'
import { translateTemplate } from '@/lib/dashboard-i18n'
import { usePharmacyDayClosure } from '@/composables/usePharmacyDayClosure'

type PharmacyProfit = {
  revenueFcfa: number
  costFcfa: number
  profitFcfa: number
  marginPercent: number
}

type PharmacieDashboardStats = {
  productsCount: number
  lowStock: number
  prescriptionsToday: number
  prescriptionsExternalToday: number
  revenueTodayFcfa: number
  salesLast7Days: Array<{
    date: string
    dayLabel: string
    totalFcfa: number
    patientFcfa: number
    externalFcfa: number
  }>
  topLowStock: Array<{ name: string; quantity: number; minStock: number; level: string }>
  profitToday: PharmacyProfit
  profitWeek: PharmacyProfit
  salesSummary?: {
    from?: string
    to?: string
    salesCount: number
    productsSoldCount: number
    grossTotalFcfa: number
    reductionFcfa: number
    netTotalFcfa: number
    freeSalesCount: number
    returnsCount: number
    returnsNetFcfa: number
  }
}

const emptyProfit = (): PharmacyProfit => ({
  revenueFcfa: 0,
  costFcfa: 0,
  profitFcfa: 0,
  marginPercent: 0,
})

const auth = useAuthStore()
const { uiText, localeCode } = useAppI18n()
const { closingSales, printPharmacyCumul } = usePharmacyDayClosure()
const stats = ref<PharmacieDashboardStats | null>(null)
const loading = ref(false)
const loadError = ref('')

function localIsoDate(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function shiftIsoDate(iso: string, days: number) {
  const [year, month, day] = iso.split('-').map(Number)
  const next = new Date(year, month - 1, day)
  next.setDate(next.getDate() + days)
  return localIsoDate(next)
}

type PharmacistOption = {
  id: string
  firstName: string
  lastName: string
  role?: AppUserRole
}

function pharmacyOperatorName(row: PharmacistOption) {
  return fullName(row.firstName, row.lastName)
}

function pharmacyOperatorRoleLabel(row: PharmacistOption) {
  if (!row.role || row.role === 'PHARMACIEN') return ''
  return ROLE_LABELS[row.role] ?? row.role
}

const todayIso = localIsoDate()
const dateFrom = ref(todayIso)
const dateTo = ref(todayIso)
type SalesPeriodPreset = 'today' | '7d' | '30d' | 'custom'
const salesPeriodPreset = ref<SalesPeriodPreset>('today')
const pharmacists = ref<PharmacistOption[]>([])
const selectedPharmacistId = ref('')
const pharmacistMenuOpen = ref(false)
const pharmacistFilterRef = ref<HTMLElement | null>(null)

const isPharmacist = computed(() => auth.user?.role === 'PHARMACIEN')
const canFilterPharmacist = computed(() => !isPharmacist.value)

const selectedPharmacistLabel = computed(() => {
  void localeCode.value
  if (!selectedPharmacistId.value) return uiText('Pharmaciens')
  const found = pharmacists.value.find((row) => row.id === selectedPharmacistId.value)
  if (!found) return uiText('Pharmaciens')
  const role = pharmacyOperatorRoleLabel(found)
  const name = pharmacyOperatorName(found)
  return role ? `${name} · ${uiText(role)}` : name
})

const showProfitSection = computed(() =>
  auth.user ? canAccessModule(auth.user.role, 'gestionnaire') : false,
)

const dashboardSubtitle = computed(() => {
  void localeCode.value
  if (isPharmacist.value) return uiText('Mes ventes, ordonnances et stock')
  if (showProfitSection.value) return uiText('Résumé pharmacie — bénéfice, ventes, ordonnances et stock')
  return uiText('Résumé pharmacie — ventes, ordonnances et stock')
})

const activityChartTitle = computed(() => {
  void localeCode.value
  return isPharmacist.value ? uiText('Mon activité du jour') : uiText('Activité du jour')
})

const activityLegend = computed(() => {
  void localeCode.value
  return [
    { key: 'ordonnances', label: uiText('Ordonnances'), colorClass: 'legend-dot--b' },
    { key: 'externes', label: uiText('Externes'), colorClass: 'legend-dot--c' },
    { key: 'alertes', label: uiText('Alertes stock'), colorClass: 'legend-dot--e' },
  ]
})

const activityMetrics = computed((): MetricBar[] => {
  void localeCode.value
  if (!stats.value) return []
  const s = stats.value
  return [
    {
      key: 'ordonnances',
      label: uiText('Ordonnances'),
      value: s.prescriptionsToday,
      color: '#0d9488',
      hint: translateTemplate('Ordonnances patients : {n}', { n: s.prescriptionsToday }),
    },
    {
      key: 'externes',
      label: uiText('Externes'),
      value: s.prescriptionsExternalToday,
      color: '#d97706',
      hint: translateTemplate('Clients externes : {n}', { n: s.prescriptionsExternalToday }),
    },
    {
      key: 'alertes',
      label: uiText('Alertes stock'),
      value: s.lowStock,
      color: '#e11d48',
      hint: translateTemplate('Alertes stock : {n}', { n: s.lowStock }),
    },
  ]
})

const emptySalesSummary = () => ({
  salesCount: 0,
  productsSoldCount: 0,
  grossTotalFcfa: 0,
  reductionFcfa: 0,
  netTotalFcfa: 0,
  freeSalesCount: 0,
  returnsCount: 0,
  returnsNetFcfa: 0,
})

const salesSummaryCards = computed(() => {
  void localeCode.value
  const s = stats.value?.salesSummary ?? emptySalesSummary()
  return [
    {
      id: 'sales-count',
      label: uiText('Nombre de ventes'),
      value: s.salesCount,
      icon: ShoppingCart,
      variant: 'green' as const,
      trend: s.freeSalesCount
        ? translateTemplate('{n} vente(s) gratuite(s)', { n: s.freeSalesCount })
        : uiText('Tickets / ordonnances'),
    },
    {
      id: 'products-sold',
      label: uiText('Produits vendus'),
      value: s.productsSoldCount,
      icon: Package,
      variant: 'teal' as const,
      trend: uiText('Unités dispensées'),
    },
    {
      id: 'gross-total',
      label: uiText('Total brut'),
      value: formatFcfa(s.grossTotalFcfa),
      icon: Banknote,
      variant: 'blue' as const,
      trend: uiText('Avant remise'),
    },
    {
      id: 'reduction',
      label: uiText('Remises'),
      value: formatFcfa(s.reductionFcfa),
      icon: Percent,
      variant: 'amber' as const,
      trend: uiText('Réductions accordées'),
    },
    {
      id: 'net-total',
      label: uiText('Total net'),
      value: formatFcfa(s.netTotalFcfa),
      icon: Wallet,
      variant: 'violet' as const,
      trend: uiText('Montant encaissé'),
    },
    {
      id: 'returns',
      label: uiText('Retours'),
      value: s.returnsCount,
      icon: RotateCcw,
      variant: 'rose' as const,
      trend: s.returnsNetFcfa
        ? translateTemplate('Remboursé {amount}', { amount: formatFcfa(s.returnsNetFcfa) })
        : uiText('Aucun remboursement'),
    },
  ]
})

const summaryStats = computed((): SummaryStat[] => {
  void localeCode.value
  if (!stats.value) return []
  const s = stats.value
  const today = s.profitToday ?? emptyProfit()
  const week = s.profitWeek ?? emptyProfit()
  const cards: SummaryStat[] = [
    {
      id: 'prescriptions',
      label: isPharmacist.value ? uiText('Mes ordonnances (jour)') : uiText('Ordonnances (jour)'),
      value: s.prescriptionsToday,
      icon: PillBottle,
      variant: 'teal',
      trend: formatFcfa(s.revenueTodayFcfa),
    },
    {
      id: 'external-today',
      label: isPharmacist.value
        ? uiText('Mes ventes externes (jour)')
        : uiText('Clients externes (jour)'),
      value: s.prescriptionsExternalToday,
      icon: UserRound,
      variant: 'blue',
      trend: uiText('Ventes comptoir'),
    },
    {
      id: 'low-stock',
      label: uiText('Alertes stock'),
      value: s.lowStock,
      icon: PackageX,
      variant: 'amber',
      trend: translateTemplate('{n} produits actifs', { n: s.productsCount }),
    },
  ]
  if (showProfitSection.value) {
    cards.push({
      id: 'purchases-total',
      label: uiText('Prix total des achats'),
      value: formatFcfa(week.costFcfa),
      icon: Receipt,
      variant: 'cyan',
      trend: translateTemplate('7 jours · jour {amount}', { amount: formatFcfa(today.costFcfa) }),
    })
  }
  return cards
})

const profitCards = computed(() => {
  void localeCode.value
  const today = stats.value?.profitToday ?? emptyProfit()
  const week = stats.value?.profitWeek ?? emptyProfit()
  return [
    {
      id: 'profit-today',
      label: uiText('Bénéfice du jour'),
      value: formatFcfa(today.profitFcfa),
      icon: TrendingUp,
      variant: today.profitFcfa >= 0 ? ('green' as const) : ('rose' as const),
      trend: translateTemplate('CA {amount}', { amount: formatFcfa(today.revenueFcfa) }),
    },
    {
      id: 'profit-week',
      label: uiText('Bénéfice 7 jours'),
      value: formatFcfa(week.profitFcfa),
      icon: Wallet,
      variant: week.profitFcfa >= 0 ? ('teal' as const) : ('rose' as const),
      trend: translateTemplate('CA {amount}', { amount: formatFcfa(week.revenueFcfa) }),
    },
    {
      id: 'margin-today',
      label: uiText('Marge du jour'),
      value: `${today.marginPercent} %`,
      icon: Percent,
      variant: 'violet' as const,
      trend: translateTemplate('Coût {amount}', { amount: formatFcfa(today.costFcfa) }),
    },
    {
      id: 'cost-today',
      label: uiText("Coût d'achat (jour)"),
      value: formatFcfa(today.costFcfa),
      icon: ShoppingBag,
      variant: 'amber' as const,
      trend: translateTemplate('Marge 7 j. {n} %', { n: week.marginPercent }),
    },
  ]
})

const stockBars = computed(() => {
  if (!stats.value) return []
  return stats.value.topLowStock.map((product) => ({
    label: product.name,
    count: product.quantity,
    scaleMax: Math.max(product.minStock, 1),
    color: product.quantity <= 0 ? '#e11d48' : product.quantity <= Math.max(1, Math.floor(product.minStock / 2)) ? '#e11d48' : '#d97706',
  }))
})

function applyPreset(preset: SalesPeriodPreset) {
  salesPeriodPreset.value = preset
  const today = localIsoDate()
  if (preset === 'today') {
    dateFrom.value = today
    dateTo.value = today
    return
  }
  if (preset === '7d') {
    dateFrom.value = shiftIsoDate(today, -6)
    dateTo.value = today
    return
  }
  if (preset === '30d') {
    dateFrom.value = shiftIsoDate(today, -29)
    dateTo.value = today
  }
}

function syncPresetFromDates() {
  const today = localIsoDate()
  if (dateFrom.value === today && dateTo.value === today) {
    salesPeriodPreset.value = 'today'
    return
  }
  if (dateTo.value === today && dateFrom.value === shiftIsoDate(today, -6)) {
    salesPeriodPreset.value = '7d'
    return
  }
  if (dateTo.value === today && dateFrom.value === shiftIsoDate(today, -29)) {
    salesPeriodPreset.value = '30d'
    return
  }
  salesPeriodPreset.value = 'custom'
}

async function loadPharmacists() {
  if (!canFilterPharmacist.value) {
    pharmacists.value = []
    return
  }
  try {
    const { data } = await api.get<PharmacistOption[]>('/pharmacie/pharmacists')
    pharmacists.value = data
  } catch {
    pharmacists.value = []
  }
}

function selectPharmacist(id: string) {
  pharmacistMenuOpen.value = false
  if (selectedPharmacistId.value === id) return
  selectedPharmacistId.value = id
}

function togglePharmacistMenu() {
  pharmacistMenuOpen.value = !pharmacistMenuOpen.value
}

function onDocumentPointerDown(event: PointerEvent) {
  const root = pharmacistFilterRef.value
  if (!root || !pharmacistMenuOpen.value) return
  if (event.target instanceof Node && root.contains(event.target)) return
  pharmacistMenuOpen.value = false
}

async function loadStats() {
  loading.value = true
  loadError.value = ''
  try {
    const { data } = await api.get<PharmacieDashboardStats>('/dashboard/pharmacie', {
      params: {
        from: dateFrom.value,
        to: dateTo.value,
        ...(canFilterPharmacist.value && selectedPharmacistId.value
          ? { pharmacistId: selectedPharmacistId.value }
          : {}),
      },
    })
    stats.value = {
      ...data,
      profitToday: data.profitToday ?? emptyProfit(),
      profitWeek: data.profitWeek ?? emptyProfit(),
    }
  } catch {
    loadError.value = 'Impossible de charger le tableau de bord pharmacie.'
    stats.value = null
  } finally {
    loading.value = false
  }
}

function printFilteredCumul() {
  void printPharmacyCumul({
    from: dateFrom.value,
    to: dateTo.value,
    ...(canFilterPharmacist.value && selectedPharmacistId.value
      ? { pharmacistId: selectedPharmacistId.value }
      : {}),
  })
}

watch([dateFrom, dateTo, selectedPharmacistId], () => {
  if (dateFrom.value > dateTo.value) {
    dateTo.value = dateFrom.value
    return
  }
  syncPresetFromDates()
  void loadStats()
})

onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointerDown)
  void loadPharmacists()
  void loadStats()
})

onUnmounted(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown)
})
</script>

<template>
  <RoleDashboardShell
    title="Tableau de bord pharmacie"
    :subtitle="dashboardSubtitle"
    :icon="PillBottle"
    :stats="summaryStats"
    :loading="loading"
    :load-error="loadError"
    @refresh="loadStats"
  >
    <template #actions>
      <UiButton
        variant="secondary"
        size="sm"
        :icon="Printer"
        :disabled="closingSales || loading"
        @click="printFilteredCumul"
      >
        {{ uiText('Imprimer le cumul') }}
      </UiButton>
      <UiButton variant="ghost" size="sm" :disabled="loading" @click="loadStats">
        {{ uiText('Actualiser') }}
      </UiButton>
    </template>
    <section v-if="showProfitSection" class="profit-section" :aria-label="uiText('Bénéfice pharmacie')">
      <h2 class="profit-section__title">{{ uiText('Bénéfice') }}</h2>
      <p class="profit-section__hint">
        {{ uiText('Marge brute = ventes − coût d’achat (prix d’achat des produits)') }}
      </p>
      <div class="profit-cards">
        <UiStatCard
          v-for="card in profitCards"
          :key="card.id"
          :label="card.label"
          :value="card.value"
          :icon="card.icon"
          :variant="card.variant"
          :trend="card.trend"
          compact
        />
      </div>
    </section>

    <section class="pharma-dashboard">
      <UiCard class="pharma-dashboard__sales" icon-variant="green">
        <div class="sales-period-bar" role="group" :aria-label="uiText('Période')">
          <div class="sales-period-pills" role="tablist">
            <button
              type="button"
              class="sales-period-pill"
              :class="{ 'sales-period-pill--active': salesPeriodPreset === 'today' }"
              @click="applyPreset('today')"
            >
              {{ uiText("Aujourd'hui") }}
            </button>
            <button
              type="button"
              class="sales-period-pill"
              :class="{ 'sales-period-pill--active': salesPeriodPreset === '7d' }"
              @click="applyPreset('7d')"
            >
              {{ uiText('7 derniers jours') }}
            </button>
            <button
              type="button"
              class="sales-period-pill"
              :class="{ 'sales-period-pill--active': salesPeriodPreset === '30d' }"
              @click="applyPreset('30d')"
            >
              {{ uiText('30 derniers jours') }}
            </button>
          </div>
          <div
            v-if="canFilterPharmacist && pharmacists.length"
            ref="pharmacistFilterRef"
            class="pharmacist-filter"
          >
            <button
              type="button"
              class="sales-period-pill"
              :class="{ 'sales-period-pill--active': !selectedPharmacistId }"
              @click="selectPharmacist('')"
            >
              {{ uiText('Tous') }}
            </button>
            <div class="pharmacist-dropdown">
              <button
                type="button"
                class="sales-period-pill pharmacist-dropdown__trigger"
                :class="{ 'sales-period-pill--active': Boolean(selectedPharmacistId) }"
                :aria-expanded="pharmacistMenuOpen"
                :aria-haspopup="true"
                @click="togglePharmacistMenu"
              >
                <span>{{ selectedPharmacistLabel }}</span>
                <ChevronDown :size="16" :class="{ 'pharmacist-dropdown__chevron--open': pharmacistMenuOpen }" />
              </button>
              <ul v-if="pharmacistMenuOpen" class="pharmacist-dropdown__list" role="listbox">
                <li v-for="pharmacist in pharmacists" :key="pharmacist.id" role="none">
                  <button
                    type="button"
                    class="pharmacist-dropdown__option"
                    :class="{ 'pharmacist-dropdown__option--active': selectedPharmacistId === pharmacist.id }"
                    role="option"
                    :aria-selected="selectedPharmacistId === pharmacist.id"
                    @click="selectPharmacist(pharmacist.id)"
                  >
                    <span>{{ pharmacyOperatorName(pharmacist) }}</span>
                    <small v-if="pharmacyOperatorRoleLabel(pharmacist)" class="pharmacist-dropdown__role">
                      {{ uiText(pharmacyOperatorRoleLabel(pharmacist)) }}
                    </small>
                  </button>
                </li>
              </ul>
            </div>
          </div>
          <div class="sales-date-range">
            <label class="sales-date-filter">
              <span class="sales-date-filter__label">{{ uiText('Du') }}</span>
              <input
                v-model="dateFrom"
                type="date"
                class="sales-date-filter__input"
                :max="dateTo || undefined"
                :aria-label="uiText('Du')"
              />
            </label>
            <label class="sales-date-filter">
              <span class="sales-date-filter__label">{{ uiText('Au') }}</span>
              <input
                v-model="dateTo"
                type="date"
                class="sales-date-filter__input"
                :min="dateFrom || undefined"
                :max="todayIso"
                :aria-label="uiText('Au')"
              />
            </label>
            <UiButton
              variant="secondary"
              size="sm"
              :icon="Printer"
              :disabled="closingSales || loading"
              @click="printFilteredCumul"
            >
              {{ uiText('Imprimer le cumul') }}
            </UiButton>
          </div>
        </div>
        <div class="sales-summary-cards">
          <UiStatCard
            v-for="card in salesSummaryCards"
            :key="card.id"
            :label="card.label"
            :value="card.value"
            :icon="card.icon"
            :variant="card.variant"
            :trend="card.trend"
            compact
          />
        </div>
      </UiCard>

      <div class="pharma-dashboard__row">
        <UiCard
          class="pharma-dashboard__activity"
          :title="activityChartTitle"
          :description="uiText('Répartition du jour — ordonnances, ventes externes et alertes')"
          :icon="PillBottle"
          icon-variant="teal"
        >
          <DashboardMetricBars
            :items="activityMetrics"
            :loading="loading"
            :empty-label="uiText('Aucune activité aujourd’hui')"
          />
          <div class="pharma-dashboard__activity-legend chart-legend">
            <span v-for="item in activityLegend" :key="item.key" class="chart-legend__item">
              <i class="legend-dot" :class="item.colorClass" />
              <span>{{ item.label }}</span>
            </span>
          </div>
        </UiCard>

        <UiCard
          class="pharma-dashboard__stock"
          :title="uiText('Stocks critiques')"
          :description="uiText('Niveau par rapport au seuil d\'alerte')"
          :icon="PackageX"
          icon-variant="amber"
        >
          <div v-if="!stockBars.length" class="chart-empty">{{ uiText('Aucune alerte stock') }}</div>
          <DashboardPendingBars v-else :items="stockBars" />
        </UiCard>
      </div>
    </section>
  </RoleDashboardShell>
</template>

<style scoped>
.profit-section {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.profit-section__title {
  margin: 0;
  font-size: 1rem;
  font-weight: 700;
  color: var(--text);
}

.profit-section__hint {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--text-muted);
}

.profit-cards {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.85rem;
}

.pharma-dashboard {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.pharma-dashboard__sales :deep(.ui-card__body) {
  padding-top: 0.85rem;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.sales-period-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-start;
  gap: 0.75rem;
}

.sales-period-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.sales-period-pill {
  height: 2.15rem;
  padding: 0 0.8rem;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--bg-card);
  color: var(--text-muted);
  font: inherit;
  font-size: 0.8125rem;
  font-weight: 650;
  cursor: pointer;
}

.sales-period-pill--active {
  border-color: var(--primary-500, #0d9488);
  background: color-mix(in srgb, var(--primary-500, #0d9488) 12%, white);
  color: var(--primary-700, #0f766e);
}

.pharmacist-filter {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
}

.pharmacist-dropdown {
  position: relative;
}

.pharmacist-dropdown__trigger {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  max-width: 16rem;
}

.pharmacist-dropdown__trigger span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pharmacist-dropdown__chevron--open {
  transform: rotate(180deg);
}

.pharmacist-dropdown__list {
  position: absolute;
  top: calc(100% + 0.3rem);
  left: 0;
  z-index: 8;
  min-width: 12rem;
  max-width: 18rem;
  max-height: 14rem;
  margin: 0;
  padding: 0.3rem;
  overflow: auto;
  list-style: none;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: #fff;
  box-shadow: 0 8px 24px rgb(15 23 42 / 12%);
}

.pharmacist-dropdown__option {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.1rem;
  width: 100%;
  padding: 0.5rem 0.65rem;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 0.8125rem;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}

.pharmacist-dropdown__role {
  font-size: 0.6875rem;
  font-weight: 650;
  color: var(--text-muted);
}

.pharmacist-dropdown__option:hover,
.pharmacist-dropdown__option--active {
  background: color-mix(in srgb, var(--primary-500, #0d9488) 12%, white);
  color: var(--primary-700, #0f766e);
}

.sales-date-range {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 0.5rem;
  margin-left: auto;
}

.sales-date-range :deep(.ui-button) {
  height: 2.15rem;
}

.sales-date-filter {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.sales-date-filter__label {
  font-size: 0.625rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}

.sales-date-filter__input {
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

.sales-summary-cards {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.85rem;
}

.pharma-dashboard__row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr);
  gap: 1rem;
  align-items: stretch;
}

.pharma-dashboard__activity-legend {
  margin-top: 1.15rem;
}

.pharma-dashboard__activity-legend .legend-dot--b { background: #0d9488; }
.pharma-dashboard__activity-legend .legend-dot--c { background: #d97706; }
.pharma-dashboard__activity-legend .legend-dot--e { background: #e11d48; }

.chart-empty {
  padding: 2rem 1rem;
  text-align: center;
  color: var(--text-light);
  font-size: 0.875rem;
}

@media (max-width: 1100px) {
  .profit-cards,
  .sales-summary-cards {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 960px) {
  .pharma-dashboard__row {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 560px) {
  .profit-cards,
  .sales-summary-cards {
    grid-template-columns: 1fr;
  }
}
</style>
