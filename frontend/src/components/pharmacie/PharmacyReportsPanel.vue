<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { BarChart3, FileText } from '@lucide/vue'
import api from '@/api/client'
import { formatFcfa, fullName, ROLE_LABELS, type AppUserRole } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth'
import {
  buildClinicPrintHeader,
  openPrintDocument,
} from '@/lib/print-document'
import {
  escapeHtml,
  exportBasename,
  exportWorkbook,
  exportWorkbookWord,
  rowsToHtmlTable,
  type ExportColumn,
} from '@/lib/table-export'
import UiCard from '@/components/ui/UiCard.vue'
import ExportButtons from '@/components/ui/ExportButtons.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import DashboardBarChart, { type BarChartDay } from '@/components/dashboard/DashboardBarChart.vue'
import DashboardPendingBars from '@/components/dashboard/DashboardPendingBars.vue'
import { useAppI18n } from '@/i18n/useAppI18n'
import { translateTemplate } from '@/lib/dashboard-i18n'

type PharmacyReport = {
  from: string
  to: string
  prescriptionsCount: number
  totalUnitsSold: number
  totalRevenueFcfa: number
  profitPeriod: {
    revenueFcfa: number
    costFcfa: number
    profitFcfa: number
    marginPercent: number
    excludedLinesCount?: number
    excludedRevenueFcfa?: number
  }
  salesByDay: Array<{ date: string; dayLabel: string; totalFcfa: number }>
  topProducts: Array<{ name: string; quantity: number; revenueFcfa: number }>
  salesByCategory: Array<{ name: string; quantity: number; revenueFcfa: number }>
}

type PharmacyRevenueReport = {
  from: string
  to: string
  period: string
  pharmacist: { id: string; firstName: string; lastName: string } | null
  prescriptionsCount: number
  returnsCount: number
  grossSalesFcfa: number
  netSalesFcfa: number
  returnsGrossFcfa: number
  returnsNetFcfa: number
  netRevenueFcfa: number
  salesByDay: Array<{
    date: string
    dayLabel: string
    grossSalesFcfa: number
    returnsNetFcfa: number
    netRevenueFcfa: number
  }>
}

type PharmacyPurchaseReport = {
  from: string
  to: string
  invoicesCount: number
  totalFcfa: number
  productsCount: number
  invoices: Array<{
    id: string
    businessDate: string
    invoiceNumber: string
    supplierName: string
    amountFcfa: number
    productsCount: number
    unitsCount: number
    lines: Array<{ productName: string; quantity: number; unitCostFcfa: number; totalFcfa: number }>
  }>
}

type PharmacistOption = { id: string; firstName: string; lastName: string; role?: AppUserRole }

const report = ref<PharmacyReport | null>(null)
const revenueReport = ref<PharmacyRevenueReport | null>(null)
const purchaseReport = ref<PharmacyPurchaseReport | null>(null)
const pharmacists = ref<PharmacistOption[]>([])
const loading = ref(false)
const message = ref('')
const pharmacistId = ref('')
const localIsoDate = (date: Date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
const todayIso = localIsoDate(new Date())
const dateFrom = ref(todayIso)
const dateTo = ref(todayIso)
let reportRequest = 0

const auth = useAuthStore()
const canFilterPharmacist = computed(() =>
  Boolean(auth.user && auth.user.role !== 'PHARMACIEN'),
)

const { uiText, localeCode } = useAppI18n()

const salesChart = computed((): BarChartDay[] => {
  void localeCode.value
  const days = revenueReport.value?.salesByDay ?? report.value?.salesByDay ?? []
  return days.map((day) => {
    const total =
      'netRevenueFcfa' in day
        ? day.netRevenueFcfa
        : (day as { totalFcfa: number }).totalFcfa
    return {
      date: day.date,
      dayLabel: day.dayLabel,
      total,
      segments: [
        {
          key: 'sales',
          value: total,
          colorClass: 'bar-chart__bar--a',
          title: translateTemplate('CA net : {amount}', { amount: formatFcfa(total) }),
        },
      ],
    }
  })
})

const topProductBars = computed(() => {
  if (!report.value) return []
  return report.value.topProducts.map((row) => ({
    label: row.name,
    count: row.revenueFcfa,
    amount: row.revenueFcfa,
    color: '#0d9488',
  }))
})

const categoryBars = computed(() => {
  if (!report.value) return []
  return report.value.salesByCategory.map((row) => ({
    label: row.name,
    count: row.revenueFcfa,
    amount: row.revenueFcfa,
    color: '#7c3aed',
  }))
})

async function loadReport() {
  if (!customRangeValid.value) {
    message.value = uiText('La date de début doit précéder la date de fin.')
    return
  }
  const request = ++reportRequest
  loading.value = true
  message.value = ''
  try {
    const params: Record<string, string> = {
      period: 'custom',
      from: dateFrom.value,
      to: dateTo.value,
    }
    if (canFilterPharmacist.value && pharmacistId.value) {
      params.pharmacistId = pharmacistId.value
    }
    const [reportRes, revenueRes, purchaseRes] = await Promise.all([
      api.get<PharmacyReport>('/pharmacie/reports', { params }),
      api.get<PharmacyRevenueReport>('/pharmacie/revenue-report', { params }),
      api.get<PharmacyPurchaseReport>('/pharmacie/purchases/report', {
        params: { from: dateFrom.value, to: dateTo.value },
      }),
    ])
    if (request !== reportRequest) return
    report.value = reportRes.data
    revenueReport.value = revenueRes.data
    purchaseReport.value = purchaseRes.data
  } catch {
    if (request !== reportRequest) return
    message.value = 'Impossible de charger le rapport.'
    report.value = null
    revenueReport.value = null
    purchaseReport.value = null
  } finally {
    if (request === reportRequest) loading.value = false
  }
}

watch([dateFrom, dateTo], () => {
  void loadReport()
})

async function loadPharmacists() {
  if (!canFilterPharmacist.value) return
  try {
    const { data } = await api.get<PharmacistOption[]>('/pharmacie/pharmacists')
    pharmacists.value = data
  } catch {
    pharmacists.value = []
  }
}

const periodLabel = computed(() => {
  void localeCode.value
  const from = formatPeriodDate(dateFrom.value)
  const to = formatPeriodDate(dateTo.value)
  return from === to ? from : `${from} – ${to}`
})

function formatPeriodDate(iso: string) {
  if (!iso) return ''
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString(localeCode.value, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

const customRangeValid = computed(
  () => Boolean(dateFrom.value && dateTo.value && dateFrom.value <= dateTo.value),
)

const salesLegend = computed(() => {
  void localeCode.value
  return [{ key: 'sales', label: uiText('Ventes'), colorClass: 'legend-dot--a' }]
})

const kpiRows = computed(() => {
  void localeCode.value
  if (!revenueReport.value) return []
  const rev = revenueReport.value
  const rows = [
    ...(report.value
      ? [{
          label: uiText('Bénéfice période'),
          value: formatFcfa(report.value.profitPeriod.profitFcfa),
        }]
      : []),
    { label: uiText('Ventes (net encaissé)'), value: formatFcfa(rev.netRevenueFcfa) },
    { label: uiText('Retours'), value: formatFcfa(rev.returnsNetFcfa) },
    { label: uiText('CA net'), value: formatFcfa(rev.netRevenueFcfa) },
    { label: uiText('Nombre de ventes'), value: rev.prescriptionsCount },
    { label: uiText('Nombre de retours'), value: rev.returnsCount },
    { label: uiText('Période'), value: `${rev.from} → ${rev.to}` },
  ]
  if (rev.pharmacist) {
    rows.unshift({
      label: uiText('Pharmacien'),
      value: fullName(rev.pharmacist.firstName, rev.pharmacist.lastName),
    })
  }
  return rows
})

const kpiColumns = computed<ExportColumn<(typeof kpiRows.value)[number]>[]>(() => {
  void localeCode.value
  return [
    { header: uiText('Indicateur'), value: (r) => r.label },
    { header: uiText('Valeur'), value: (r) => r.value },
  ]
})

const topProductColumns = computed<ExportColumn<PharmacyReport['topProducts'][number]>[]>(() => {
  void localeCode.value
  return [
    { header: uiText('Produit'), value: (r) => r.name },
    { header: uiText('Quantité'), value: (r) => r.quantity },
    { header: uiText('CA'), value: (r) => formatFcfa(r.revenueFcfa) },
  ]
})

const categoryColumns = computed<ExportColumn<PharmacyReport['salesByCategory'][number]>[]>(() => {
  void localeCode.value
  return [
    { header: uiText('Catégorie'), value: (r) => r.name },
    { header: uiText('Quantité'), value: (r) => r.quantity },
    { header: uiText('CA'), value: (r) => formatFcfa(r.revenueFcfa) },
  ]
})

type PurchaseLineRow = PharmacyPurchaseReport['invoices'][number]['lines'][number] & {
  invoiceNumber: string
  supplierName: string
  businessDate: string
}

const purchaseLineRows = computed((): PurchaseLineRow[] =>
  (purchaseReport.value?.invoices ?? []).flatMap((invoice) =>
    invoice.lines.map((line) => ({
      ...line,
      invoiceNumber: invoice.invoiceNumber,
      supplierName: invoice.supplierName,
      businessDate: invoice.businessDate,
    })),
  ),
)

const purchaseColumns = computed<ExportColumn<PurchaseLineRow>[]>(() => {
  void localeCode.value
  return [
    { header: uiText('Date'), value: (r) => formatPeriodDate(r.businessDate) },
    { header: uiText('N° facture'), value: (r) => r.invoiceNumber },
    { header: uiText('Fournisseur'), value: (r) => r.supplierName },
    { header: uiText('Produit'), value: (r) => r.productName },
    { header: uiText('Quantité'), value: (r) => r.quantity },
    { header: uiText("Prix d'achat"), value: (r) => formatFcfa(r.unitCostFcfa) },
    { header: uiText('Total'), value: (r) => formatFcfa(r.totalFcfa) },
  ]
})

function exportPdf() {
  if (!report.value) return
  const body = `${buildClinicPrintHeader(uiText('Rapport des ventes pharmacie'))}
<div class="row"><span>${uiText('Période')}</span><strong>${escapeHtml(periodLabel.value)}</strong></div>
${rowsToHtmlTable(kpiColumns.value, kpiRows.value, { captionRows: [{ label: uiText('Synthèse'), value: 'KPI' }] })}
<h3>${uiText('Top produits')}</h3>
${rowsToHtmlTable(topProductColumns.value, report.value.topProducts)}
<h3>${uiText('Ventes par catégorie')}</h3>
${rowsToHtmlTable(categoryColumns.value, report.value.salesByCategory)}
<h3>${uiText('Factures fournisseur')}</h3>
${rowsToHtmlTable(purchaseColumns.value, purchaseLineRows.value)}`
  openPrintDocument(uiText('Rapport des ventes pharmacie'), body, { pageSize: 'A4', autoPrint: true })
}

function exportExcel() {
  if (!report.value) return
  exportWorkbook(exportBasename('rapport-ventes-pharmacie'), [
    { name: 'KPI', columns: kpiColumns.value, rows: kpiRows.value },
    { name: uiText('Top produits'), columns: topProductColumns.value, rows: report.value.topProducts },
    { name: uiText('Catégories'), columns: categoryColumns.value, rows: report.value.salesByCategory },
    { name: uiText('Factures'), columns: purchaseColumns.value, rows: purchaseLineRows.value },
  ])
}

function exportWord() {
  if (!report.value) return
  void exportWorkbookWord(exportBasename('rapport-ventes-pharmacie'), [
    { name: 'KPI', columns: kpiColumns.value, rows: kpiRows.value },
    { name: uiText('Top produits'), columns: topProductColumns.value, rows: report.value.topProducts },
    { name: uiText('Catégories'), columns: categoryColumns.value, rows: report.value.salesByCategory },
    { name: uiText('Factures'), columns: purchaseColumns.value, rows: purchaseLineRows.value },
  ])
}

onMounted(() => {
  void loadPharmacists()
  void loadReport()
})
</script>

<template>
  <div class="reports-layout">
    <UiCard
      title="Rapport des ventes"
      description="Chiffre d'affaires, volumes et classements"
      :icon="BarChart3"
      icon-variant="green"
    >
      <template #actions>
        <UiSelect v-if="canFilterPharmacist" v-model="pharmacistId" label="Pharmacien" class="period-select" @change="loadReport">
          <option value="">{{ uiText('Tous les pharmaciens') }}</option>
          <option v-for="p in pharmacists" :key="p.id" :value="p.id">
            {{
              p.role && p.role !== 'PHARMACIEN'
                ? `${fullName(p.firstName, p.lastName)} · ${uiText(ROLE_LABELS[p.role] ?? p.role)}`
                : fullName(p.firstName, p.lastName)
            }}
          </option>
        </UiSelect>
        <div class="report-date-range">
          <label>
            <span>{{ uiText('Du') }}</span>
            <input v-model="dateFrom" type="date" :max="dateTo || todayIso" :aria-label="uiText('Du')" />
          </label>
          <label>
            <span>{{ uiText('Au') }}</span>
            <input
              v-model="dateTo"
              type="date"
              :min="dateFrom || undefined"
              :max="todayIso"
              :aria-label="uiText('Au')"
            />
          </label>
        </div>
      </template>

      <UiAlert v-if="message" type="error" :message="message" />

      <div v-if="revenueReport" class="report-kpis">
        <div class="kpi">
          <span>{{ uiText('Ventes net') }}</span>
          <strong>{{ formatFcfa(revenueReport.netRevenueFcfa) }}</strong>
        </div>
        <div class="kpi">
          <span>{{ uiText('Retours') }}</span>
          <strong>{{ formatFcfa(revenueReport.returnsNetFcfa) }}</strong>
        </div>
        <div class="kpi kpi--accent">
          <span>{{ uiText('CA net') }}</span>
          <strong>{{ formatFcfa(revenueReport.netRevenueFcfa) }}</strong>
        </div>
        <div class="kpi">
          <span>{{ uiText('Ventes / retours') }}</span>
          <strong>{{ revenueReport.prescriptionsCount }} / {{ revenueReport.returnsCount }}</strong>
        </div>
        <div v-if="report" class="kpi kpi--profit">
          <span>{{ uiText('Bénéfice période') }}</span>
          <strong>{{ formatFcfa(report.profitPeriod.profitFcfa) }}</strong>
          <small>
            {{ translateTemplate('CA {amount}', { amount: formatFcfa(report.profitPeriod.revenueFcfa) }) }}
            ·
            {{ translateTemplate('Coût {amount}', { amount: formatFcfa(report.profitPeriod.costFcfa) }) }}
          </small>
          <small v-if="report.profitPeriod.excludedLinesCount">
            {{
              translateTemplate('{n} ligne(s) sans prix d’achat exclue(s)', {
                n: report.profitPeriod.excludedLinesCount,
              })
            }}
          </small>
        </div>
      </div>
    </UiCard>

    <div class="charts-grid">
      <UiCard title="CA net par jour" description="Encaissements nets après retours" :icon="BarChart3" icon-variant="teal">
        <DashboardBarChart
          :days="salesChart"
          :loading="loading"
          :format-total="formatFcfa"
          :legend="salesLegend"
        />
      </UiCard>

      <UiCard title="Top produits" description="Classement par chiffre d'affaires" :icon="BarChart3" icon-variant="amber">
        <div v-if="!topProductBars.length" class="chart-empty">{{ uiText('Aucune vente sur la période') }}</div>
        <DashboardPendingBars v-else :items="topProductBars" />
      </UiCard>

      <UiCard title="Ventes par catégorie" description="Répartition du CA" :icon="BarChart3" icon-variant="violet">
        <div v-if="!categoryBars.length" class="chart-empty">{{ uiText('Aucune vente sur la période') }}</div>
        <DashboardPendingBars v-else :items="categoryBars" />
      </UiCard>
    </div>

    <UiCard
      title="Factures fournisseur"
      description="Factures saisies et produits ajoutés en stock"
      :icon="FileText"
      icon-variant="blue"
    >
      <div v-if="purchaseReport" class="report-kpis">
        <div class="kpi">
          <span>{{ uiText('Nombre de factures') }}</span>
          <strong>{{ purchaseReport.invoicesCount }}</strong>
        </div>
        <div class="kpi kpi--accent">
          <span>{{ uiText('Montant total') }}</span>
          <strong>{{ formatFcfa(purchaseReport.totalFcfa) }}</strong>
        </div>
        <div class="kpi">
          <span>{{ uiText('Produits ajoutés') }}</span>
          <strong>{{ purchaseReport.productsCount }}</strong>
        </div>
      </div>

      <div v-if="!purchaseReport?.invoices.length" class="chart-empty">
        {{ uiText('Aucune facture sur la période') }}
      </div>
      <ul v-else class="purchase-list">
        <li v-for="invoice in purchaseReport.invoices" :key="invoice.id">
          <details>
            <summary>
              <span class="purchase-list__main">
                <strong>{{ uiText('Facture n°') }} {{ invoice.invoiceNumber }}</strong>
                <small>{{ invoice.supplierName }} · {{ formatPeriodDate(invoice.businessDate) }}</small>
              </span>
              <span class="purchase-list__count">
                {{ translateTemplate('{n} produit(s)', { n: invoice.productsCount }) }}
              </span>
              <strong class="purchase-list__amount">{{ formatFcfa(invoice.amountFcfa) }}</strong>
            </summary>
            <table class="purchase-lines">
              <thead>
                <tr>
                  <th>{{ uiText('Produit') }}</th>
                  <th>{{ uiText('Quantité') }}</th>
                  <th>{{ uiText("Prix d'achat") }}</th>
                  <th>{{ uiText('Total') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(line, index) in invoice.lines" :key="index">
                  <td>{{ line.productName }}</td>
                  <td>{{ line.quantity }}</td>
                  <td>{{ formatFcfa(line.unitCostFcfa) }}</td>
                  <td>{{ formatFcfa(line.totalFcfa) }}</td>
                </tr>
              </tbody>
            </table>
          </details>
        </li>
      </ul>
    </UiCard>

    <div class="report-exports">
      <span class="report-exports__label">{{ uiText('Exporter le rapport') }}</span>
      <ExportButtons :disabled="loading || !report" @pdf="exportPdf" @excel="exportExcel" @word="exportWord" />
    </div>
  </div>
</template>

<style scoped>
@import '@/styles/dashboard-charts.css';

.reports-layout {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.period-select {
  min-width: 11rem;
}

.report-date-range {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 0.5rem;
}

.report-date-range label {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  font-size: 0.6875rem;
  font-weight: 700;
  color: var(--text-muted);
}

.report-date-range input {
  min-height: 2.25rem;
  padding: 0.35rem 0.5rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-card);
  color: var(--text);
  font: inherit;
}

.report-kpis {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.75rem;
  margin-top: 0.5rem;
}

.kpi {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.85rem 1rem;
  border-radius: var(--radius-sm);
  background: var(--surface-muted, #f8faf5);
  border: 1px solid var(--border);
  font-size: 0.8125rem;
  color: var(--text-muted);
}

.kpi strong {
  font-size: 1.15rem;
  color: var(--primary-800);
}

.kpi--accent strong {
  color: var(--action);
}

.kpi--profit {
  border-color: var(--primary-500, #0d9488);
}

.kpi--profit strong {
  color: var(--primary-700, #0f766e);
}

.kpi--profit small {
  color: var(--text-muted);
}

.charts-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
}

.charts-grid > :first-child {
  grid-column: 1 / -1;
}

.report-exports {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-card);
}

.report-exports__label {
  font-size: 0.8125rem;
  font-weight: 650;
  color: var(--text-muted);
}

.purchase-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin: 0.75rem 0 0;
  padding: 0;
  list-style: none;
}

.purchase-list details {
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-card);
}

.purchase-list summary {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.6rem 0.85rem;
  cursor: pointer;
}

.purchase-list__main {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
}

.purchase-list__main small,
.purchase-list__count {
  font-size: 0.8125rem;
  color: var(--text-muted);
}

.purchase-list__amount {
  color: var(--primary-800);
  white-space: nowrap;
}

.purchase-lines {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8125rem;
}

.purchase-lines th,
.purchase-lines td {
  padding: 0.4rem 0.85rem;
  border-top: 1px solid var(--border);
  text-align: left;
}

.purchase-lines th {
  color: var(--text-muted);
  font-weight: 650;
}

.chart-empty {
  padding: 2rem 1rem;
  text-align: center;
  color: var(--text-muted);
  font-size: 0.875rem;
}

@media (max-width: 900px) {
  .report-kpis,
  .charts-grid {
    grid-template-columns: 1fr;
  }

  .charts-grid > :first-child {
    grid-column: auto;
  }
}
</style>
