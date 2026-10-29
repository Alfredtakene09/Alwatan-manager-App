<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  PillBottle,
  Banknote,
  PackageX,
  UserRound,
  TrendingUp,
  Wallet,
  ShoppingCart,
  Package,
  ChevronDown,
  Printer,
} from '@lucide/vue'
import api from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { canAccessModule, formatFcfa, fullName, ROLE_LABELS, type AppUserRole } from '@/lib/roles'
import UiCard from '@/components/ui/UiCard.vue'
import UiButton from '@/components/ui/UiButton.vue'
import RoleDashboardShell from '@/components/dashboard/RoleDashboardShell.vue'
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
  excludedLinesCount?: number
  excludedRevenueFcfa?: number
}

type PharmacieDashboardStats = {
  productsCount: number
  lowStock: number
  prescriptionsInPeriod: number
  prescriptionsExternalInPeriod: number
  revenueInPeriodFcfa: number
  salesLast7Days: Array<{
    date: string
    dayLabel: string
    totalFcfa: number
    patientFcfa: number
    externalFcfa: number
  }>
  topLowStock: Array<{ name: string; quantity: number; minStock: number; level: string }>
  topProducts?: Array<{ productId: string; name: string; quantity: number; revenueFcfa: number }>
  topSellers?: Array<{
    userId: string
    name: string
    role: AppUserRole | null
    salesCount: number
    revenueFcfa: number
  }>
  profitPeriod: PharmacyProfit
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
let statsLoadRequest = 0

function localIsoDate(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
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
const pharmacists = ref<PharmacistOption[]>([])
const selectedPharmacistId = ref('')
const pharmacistMenuOpen = ref(false)
const pharmacistFilterRef = ref<HTMLElement | null>(null)

const isPharmacist = computed(() => auth.user?.role === 'PHARMACIEN')
const canFilterPharmacist = computed(() => !isPharmacist.value)

const selectedPharmacistLabel = computed(() => {
  void localeCode.value
  if (!selectedPharmacistId.value) return uiText('Tous les pharmaciens')
  const found = pharmacists.value.find((row) => row.id === selectedPharmacistId.value)
  if (!found) return uiText('Tous les pharmaciens')
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

function formatSelectedDate(iso: string) {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString(localeCode.value, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

const selectedPeriodLabel = computed(() => {
  void localeCode.value
  const from = formatSelectedDate(dateFrom.value)
  const to = formatSelectedDate(dateTo.value)
  return from === to ? from : `${from} – ${to}`
})

const selectedPeriodTrend = computed(() =>
  translateTemplate('Période : {period}', { period: selectedPeriodLabel.value }),
)

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
      id: 'net-total',
      label: uiText('Total net'),
      value: formatFcfa(s.netTotalFcfa),
      icon: Wallet,
      variant: 'violet' as const,
      trend: s.reductionFcfa
        ? translateTemplate('Remises {amount}', { amount: formatFcfa(s.reductionFcfa) })
        : uiText('Montant encaissé'),
    },
  ]
})

const summaryStats = computed((): SummaryStat[] => {
  void localeCode.value
  if (!stats.value) return []
  const s = stats.value
  const cards: SummaryStat[] = [
    {
      id: 'prescriptions',
      label: isPharmacist.value
        ? uiText('Mes ordonnances (période)')
        : uiText('Ordonnances (période)'),
      value: s.prescriptionsInPeriod,
      icon: PillBottle,
      variant: 'teal',
      trend: formatFcfa(s.revenueInPeriodFcfa),
    },
    {
      id: 'external-today',
      label: isPharmacist.value
        ? uiText('Mes ventes externes (période)')
        : uiText('Clients externes (période)'),
      value: s.prescriptionsExternalInPeriod,
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
  return cards
})

const profitExclusionNote = computed(() => {
  void localeCode.value
  const period = stats.value?.profitPeriod
  if (!period?.excludedLinesCount) return ''
  return translateTemplate(
    '{n} ligne(s) vendue(s) sans prix d’achat exclue(s) du bénéfice ({amount}) — renseignez le prix d’achat de ces produits.',
    { n: period.excludedLinesCount, amount: formatFcfa(period.excludedRevenueFcfa ?? 0) },
  )
})

const profitCards = computed(() => {
  void localeCode.value
  const period = stats.value?.profitPeriod ?? emptyProfit()
  return [
    {
      id: 'profit-period',
      label: uiText('Bénéfice période'),
      value: formatFcfa(period.profitFcfa),
      icon: TrendingUp,
      variant: period.profitFcfa >= 0 ? ('green' as const) : ('rose' as const),
      trend: translateTemplate('CA {amount}', { amount: formatFcfa(period.revenueFcfa) }),
    },
    {
      id: 'margin-period',
      label: uiText('Marge période'),
      value: `${period.marginPercent} %`,
      icon: Wallet,
      variant: 'violet' as const,
      trend: translateTemplate('Coût {amount}', { amount: formatFcfa(period.costFcfa) }),
    },
  ]
})

function barWidth(value: number, max: number) {
  return `${Math.max(2, (value / Math.max(1, max)) * 100)}%`
}

const topProductBars = computed(() => {
  void localeCode.value
  const rows = stats.value?.topProducts ?? []
  const max = Math.max(0, ...rows.map((row) => row.revenueFcfa))
  return rows.map((row) => ({
    key: row.productId,
    label: row.name,
    amountFcfa: row.revenueFcfa,
    width: barWidth(row.revenueFcfa, max),
    hint: translateTemplate('{n} unité(s) vendue(s)', { n: row.quantity }),
  }))
})

const topSellerBars = computed(() => {
  void localeCode.value
  const rows = stats.value?.topSellers ?? []
  const max = Math.max(0, ...rows.map((row) => row.revenueFcfa))
  return rows.map((row) => {
    const role = row.role && row.role !== 'PHARMACIEN' ? ROLE_LABELS[row.role] : ''
    return {
      key: row.userId,
      label: role ? `${row.name} · ${uiText(role)}` : row.name,
      amountFcfa: row.revenueFcfa,
      width: barWidth(row.revenueFcfa, max),
      hint: translateTemplate('{n} vente(s)', { n: row.salesCount }),
    }
  })
})

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
  const request = ++statsLoadRequest
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
    if (request !== statsLoadRequest) return
    stats.value = {
      ...data,
      profitPeriod: data.profitPeriod ?? emptyProfit(),
    }
  } catch {
    if (request !== statsLoadRequest) return
    loadError.value = 'Impossible de charger le tableau de bord pharmacie.'
    stats.value = null
  } finally {
    if (request === statsLoadRequest) loading.value = false
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
      <div class="pharmacy-header-actions">
        <div class="sales-date-range sales-date-range--header">
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
        </div>
        <UiButton
          variant="secondary"
          size="sm"
          :icon="Printer"
          :disabled="closingSales || loading"
          @click="printFilteredCumul"
        >
          {{ uiText('Imprimer le cumul') }}
        </UiButton>
        <div
          v-if="canFilterPharmacist && pharmacists.length"
          ref="pharmacistFilterRef"
          class="pharmacist-dropdown"
        >
          <button
            type="button"
            class="pharmacist-dropdown__trigger"
            :class="{ 'pharmacist-dropdown__trigger--active': Boolean(selectedPharmacistId) }"
            :aria-expanded="pharmacistMenuOpen"
            :aria-haspopup="true"
            @click="togglePharmacistMenu"
          >
            <UserRound :size="15" />
            <span>{{ selectedPharmacistLabel }}</span>
            <ChevronDown :size="16" :class="{ 'pharmacist-dropdown__chevron--open': pharmacistMenuOpen }" />
          </button>
          <ul v-if="pharmacistMenuOpen" class="pharmacist-dropdown__list" role="listbox">
            <li role="none">
              <button
                type="button"
                class="pharmacist-dropdown__option"
                :class="{ 'pharmacist-dropdown__option--active': !selectedPharmacistId }"
                role="option"
                :aria-selected="!selectedPharmacistId"
                @click="selectPharmacist('')"
              >
                <span>{{ uiText('Tous les pharmaciens') }}</span>
              </button>
            </li>
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
    </template>
    <section v-if="showProfitSection" class="profit-section" :aria-label="uiText('Bénéfice pharmacie')">
      <h2 class="profit-section__title">{{ uiText('Bénéfice') }}</h2>
      <p class="profit-section__hint">
        {{ uiText('Bénéfice réalisé = ventes nettes après remises et retours − coût des produits vendus non retournés') }}
      </p>
      <p v-if="profitExclusionNote" class="profit-section__warning">{{ profitExclusionNote }}</p>
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

      <div class="pharma-dashboard__row" :class="{ 'pharma-dashboard__row--single': !canFilterPharmacist }">
        <UiCard
          :title="uiText('Produits les plus vendus')"
          :description="selectedPeriodTrend"
          :icon="Package"
          icon-variant="teal"
        >
          <div v-if="!topProductBars.length" class="chart-empty">
            {{ uiText('Aucune vente sur cette période') }}
          </div>
          <ol v-else class="rank-bars">
            <li v-for="(row, index) in topProductBars" :key="row.key" class="rank-bars__row">
              <div class="rank-bars__head">
                <span class="rank-bars__rank">{{ index + 1 }}</span>
                <span class="rank-bars__label" :title="row.label">{{ row.label }}</span>
                <strong class="rank-bars__value">{{ formatFcfa(row.amountFcfa) }}</strong>
              </div>
              <div class="rank-bars__track">
                <div class="rank-bars__fill rank-bars__fill--teal" :style="{ width: row.width }" />
              </div>
              <small class="rank-bars__hint">{{ row.hint }}</small>
            </li>
          </ol>
        </UiCard>

        <UiCard
          v-if="canFilterPharmacist"
          :title="uiText('Meilleurs vendeurs')"
          :description="translateTemplate('Chiffre d\'affaires — {period}', { period: selectedPeriodLabel })"
          :icon="TrendingUp"
          icon-variant="violet"
        >
          <div v-if="!topSellerBars.length" class="chart-empty">
            {{ uiText('Aucune vente sur cette période') }}
          </div>
          <ol v-else class="rank-bars">
            <li v-for="(row, index) in topSellerBars" :key="row.key" class="rank-bars__row">
              <div class="rank-bars__head">
                <span class="rank-bars__rank">{{ index + 1 }}</span>
                <span class="rank-bars__label" :title="row.label">{{ row.label }}</span>
                <strong class="rank-bars__value">{{ formatFcfa(row.amountFcfa) }}</strong>
              </div>
              <div class="rank-bars__track">
                <div class="rank-bars__fill rank-bars__fill--violet" :style="{ width: row.width }" />
              </div>
              <small class="rank-bars__hint">{{ row.hint }}</small>
            </li>
          </ol>
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

.profit-section__warning {
  margin: 0;
  padding: 0.5rem 0.75rem;
  border-radius: var(--radius-sm);
  background: #fffbeb;
  color: #92400e;
  font-size: 0.8125rem;
}

.profit-cards {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
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

.pharmacy-header-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: flex-end;
  gap: 0.5rem;
}

.sales-date-range--header {
  margin-left: 0;
}

.pharmacist-dropdown {
  position: relative;
}

.pharmacist-dropdown__trigger {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  height: 2.15rem;
  max-width: 16rem;
  padding: 0 0.75rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-card);
  color: var(--text);
  font: inherit;
  font-size: 0.8125rem;
  font-weight: 650;
  cursor: pointer;
}

.pharmacist-dropdown__trigger--active {
  border-color: var(--primary-500, #0d9488);
  background: color-mix(in srgb, var(--primary-500, #0d9488) 12%, white);
  color: var(--primary-700, #0f766e);
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
  right: 0;
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

@media (max-width: 760px) {
  .pharmacy-header-actions {
    width: 100%;
    justify-content: flex-start;
  }

  .sales-date-range--header {
    flex: 1 1 100%;
  }

  .sales-date-range--header .sales-date-filter {
    flex: 1 1 8rem;
  }

  .sales-date-range--header .sales-date-filter__input {
    width: 100%;
  }
}

.sales-summary-cards {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.85rem;
}

.pharma-dashboard__row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
  align-items: stretch;
}

.pharma-dashboard__row--single {
  grid-template-columns: 1fr;
}

.rank-bars {
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.rank-bars__row {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.rank-bars__head {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  min-width: 0;
}

.rank-bars__rank {
  flex: none;
  display: inline-grid;
  place-items: center;
  width: 1.35rem;
  height: 1.35rem;
  border-radius: 999px;
  background: #f1f5f9;
  color: var(--text-muted);
  font-size: 0.6875rem;
  font-weight: 700;
}

.rank-bars__label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text);
}

.rank-bars__value {
  flex: none;
  font-size: 0.8125rem;
  font-variant-numeric: tabular-nums;
}

.rank-bars__track {
  height: 0.55rem;
  margin-left: 1.9rem;
  border-radius: 999px;
  background: #f1f5f9;
  overflow: hidden;
}

.rank-bars__fill {
  height: 100%;
  border-radius: 999px;
  transition: width 0.25s ease;
}

.rank-bars__fill--teal { background: #0d9488; }
.rank-bars__fill--violet { background: #7c3aed; }

.rank-bars__hint {
  margin-left: 1.9rem;
  font-size: 0.6875rem;
  color: var(--text-muted);
}

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
