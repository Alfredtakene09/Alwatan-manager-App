<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { FileText, Printer, Search, RefreshCw, X } from '@lucide/vue'
import api from '@/api/client'
import { useAppI18n } from '@/i18n/useAppI18n'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiButton from '@/components/ui/UiButton.vue'
import AmountFcfa from '@/components/ui/AmountFcfa.vue'
import ExportButtons from '@/components/ui/ExportButtons.vue'
import { exportTablePdf, type ExportColumn } from '@/lib/table-export'
import { formatFcfa } from '@/lib/format-fcfa'
import {
  buildJourneyInvoiceHtml,
  buildPrintDocumentHtml,
  openPrintDocument,
  reservePrintWindow,
  type JourneyInvoiceData,
} from '@/lib/print-document'

type JourneyRow = {
  visitId: string
  reference: string
  date: string
  patient: { code: string; firstName: string; lastName: string; phone?: string | null }
  doctor: string | null
  sections: string[]
  invoiceCount: number
  totalFcfa: number
  paidFcfa: number
  remainingFcfa: number
}

const { uiText, dateTimeText, localeCode } = useAppI18n()

function todayIso(offsetDays = 0) {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const search = ref('')
const from = ref(`${todayIso().slice(0, 8)}01`)
const to = ref(todayIso())
const rows = ref<JourneyRow[]>([])
const loading = ref(false)
const error = ref('')

const selected = ref<JourneyInvoiceData | null>(null)
const selectedId = ref<string | null>(null)
const detailLoading = ref(false)

const SECTION_LABELS: Record<string, string> = {
  consultation: 'Consultation',
  examens: 'Examens',
  operation: 'Opération',
  hospitalisation: 'Hospitalisation',
  pharmacie: 'Pharmacie',
  autre: 'Autres',
}

const totals = computed(() =>
  rows.value.reduce(
    (acc, r) => ({
      total: acc.total + r.totalFcfa,
      paid: acc.paid + r.paidFcfa,
      remaining: acc.remaining + r.remainingFcfa,
    }),
    { total: 0, paid: 0, remaining: 0 },
  ),
)

async function load() {
  loading.value = true
  error.value = ''
  try {
    const { data } = await api.get<JourneyRow[]>('/comptabilite/factures-parcours', {
      params: { q: search.value.trim() || undefined, from: from.value || undefined, to: to.value || undefined },
    })
    rows.value = data
  } catch (e: unknown) {
    const err = e as { response?: { data?: { error?: string } } }
    error.value = err.response?.data?.error ?? uiText('Impossible de charger les factures')
  } finally {
    loading.value = false
  }
}

let searchTimer: ReturnType<typeof setTimeout> | null = null
watch(search, () => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(load, 350)
})
watch([from, to], load)

async function fetchDetail(visitId: string) {
  const { data } = await api.get<JourneyInvoiceData>(`/comptabilite/factures-parcours/${visitId}`)
  return data
}

async function openDetail(row: JourneyRow) {
  selectedId.value = row.visitId
  detailLoading.value = true
  selected.value = null
  try {
    selected.value = await fetchDetail(row.visitId)
  } catch {
    error.value = uiText('Impossible de charger la facture')
    selectedId.value = null
  } finally {
    detailLoading.value = false
  }
}

function closeDetail() {
  selected.value = null
  selectedId.value = null
}

const previewHtml = computed(() => {
  void localeCode.value
  if (!selected.value) return ''
  return buildPrintDocumentHtml(buildJourneyInvoiceHtml(selected.value), { pageSize: 'A4' })
})

async function printRow(row: JourneyRow) {
  // Fenêtre réservée pendant le clic : print() reste autorisé après l'appel API.
  reservePrintWindow('A4')
  try {
    const data = selected.value && selectedId.value === row.visitId ? selected.value : await fetchDetail(row.visitId)
    printInvoice(data)
  } catch {
    error.value = uiText('Impossible de charger la facture')
  }
}

function printInvoice(data: JourneyInvoiceData) {
  openPrintDocument(`Facture ${data.reference}`, buildJourneyInvoiceHtml(data), {
    pageSize: 'A4',
    autoPrint: true,
  })
}

function statusOf(row: { totalFcfa: number; paidFcfa: number; remainingFcfa: number }) {
  if (row.remainingFcfa <= 0) return { label: 'Payée', cls: 'is-paid' }
  if (row.paidFcfa > 0) return { label: 'Payée partiellement', cls: 'is-partial' }
  return { label: 'En attente', cls: 'is-pending' }
}

const exportColumns: ExportColumn<JourneyRow>[] = [
  { header: 'N° facture', value: (row) => row.reference },
  { header: 'Date', value: (row) => dateTimeText(row.date), widthWeight: 1.3 },
  { header: 'Patient', value: (row) => `${row.patient.firstName} ${row.patient.lastName} (${row.patient.code})`, widthWeight: 1.8 },
  { header: 'Prestations', value: (row) => row.sections.map((s) => uiText(SECTION_LABELS[s] ?? s)).join(', '), widthWeight: 1.6 },
  { header: 'Total', value: (row) => formatFcfa(row.totalFcfa) },
  { header: 'Payé', value: (row) => formatFcfa(row.paidFcfa) },
  { header: 'Reste', value: (row) => formatFcfa(row.remainingFcfa) },
  { header: 'Statut', value: (row) => uiText(statusOf(row).label) },
]

function exportPdf() {
  exportTablePdf(uiText('Factures'), exportColumns, rows.value, {
    orientation: 'landscape',
    captionRows: [
      { label: 'Période', value: `${from.value || '…'} → ${to.value || '…'}` },
      ...(search.value.trim() ? [{ label: 'Recherche', value: search.value.trim() }] : []),
    ],
    totalsRows: [
      { label: 'Total facturé', value: formatFcfa(totals.value.total) },
      { label: 'Encaissé', value: formatFcfa(totals.value.paid) },
      { label: 'Reste à payer', value: formatFcfa(totals.value.remaining) },
    ],
  })
}

onMounted(load)
</script>

<template>
  <div class="factures-page">
    <UiPageHeader
      title="Factures"
      subtitle="Une facture unique par parcours patient : consultation, examens, opération, hospitalisation et pharmacie"
      :icon="FileText"
    >
      <template #actions>
        <ExportButtons
          :show-excel="false"
          :show-word="false"
          :disabled="loading || !rows.length"
          @pdf="exportPdf"
        />
      </template>
    </UiPageHeader>

    <UiCard direct class="factures-filters">
      <div class="factures-filters__row">
        <label class="factures-field factures-field--search">
          <Search :size="16" />
          <input v-model="search" type="search" :placeholder="uiText('Patient, matricule ou téléphone')" />
        </label>
        <label class="factures-field">
          <span>{{ uiText('Du') }}</span>
          <input v-model="from" type="date" />
        </label>
        <label class="factures-field">
          <span>{{ uiText('Au') }}</span>
          <input v-model="to" type="date" />
        </label>
        <UiButton variant="outline" :icon="RefreshCw" :loading="loading" @click="load">
          {{ uiText('Actualiser') }}
        </UiButton>
      </div>
      <div class="factures-summary">
        <div><span>{{ uiText('Factures') }}</span><strong>{{ rows.length }}</strong></div>
        <div><span>{{ uiText('Total facturé') }}</span><AmountFcfa :amount="totals.total" bold /></div>
        <div><span>{{ uiText('Encaissé') }}</span><AmountFcfa :amount="totals.paid" variant="in" bold /></div>
        <div><span>{{ uiText('Reste à payer') }}</span><AmountFcfa :amount="totals.remaining" variant="out" bold /></div>
      </div>
    </UiCard>

    <p v-if="error" class="factures-error">{{ error }}</p>

    <div class="factures-layout" :class="{ 'has-detail': selectedId }">
      <UiCard direct class="factures-list">
        <div class="factures-table-wrap">
          <table class="factures-table">
            <thead>
              <tr>
                <th>{{ uiText('N° facture') }}</th>
                <th>{{ uiText('Date') }}</th>
                <th>{{ uiText('Patient') }}</th>
                <th>{{ uiText('Prestations') }}</th>
                <th class="num">{{ uiText('Total') }}</th>
                <th class="num">{{ uiText('Payé') }}</th>
                <th>{{ uiText('Statut') }}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!loading && !rows.length">
                <td colspan="8" class="factures-empty">{{ uiText('Aucune facture sur cette période') }}</td>
              </tr>
              <tr
                v-for="row in rows"
                :key="row.visitId"
                :class="{ 'is-selected': row.visitId === selectedId }"
                @click="openDetail(row)"
              >
                <td class="nowrap"><strong>{{ row.reference }}</strong></td>
                <td>{{ dateTimeText(row.date) }}</td>
                <td>
                  {{ row.patient.firstName }} {{ row.patient.lastName }}
                  <small class="factures-muted">{{ row.patient.code }}</small>
                </td>
                <td>
                  <span v-for="s in row.sections" :key="s" class="factures-chip">{{ uiText(SECTION_LABELS[s] ?? s) }}</span>
                </td>
                <td class="num"><AmountFcfa :amount="row.totalFcfa" bold /></td>
                <td class="num"><AmountFcfa :amount="row.paidFcfa" /></td>
                <td>
                  <span class="factures-status" :class="statusOf(row).cls">{{ uiText(statusOf(row).label) }}</span>
                </td>
                <td class="factures-actions">
                  <UiButton size="sm" variant="ghost" :icon="Printer" @click.stop="printRow(row)">
                    {{ uiText('Imprimer') }}
                  </UiButton>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </UiCard>

      <UiCard v-if="selectedId" direct class="factures-preview">
        <div class="factures-preview__bar">
          <strong>{{ selected?.reference ?? '…' }}</strong>
          <div class="factures-preview__actions">
            <UiButton size="sm" :icon="Printer" :disabled="!selected" @click="selected && printInvoice(selected)">
              {{ uiText('Imprimer la facture') }}
            </UiButton>
            <UiButton size="sm" variant="ghost" :icon="X" @click="closeDetail">{{ uiText('Fermer') }}</UiButton>
          </div>
        </div>
        <p v-if="detailLoading" class="factures-muted factures-preview__loading">{{ uiText('Chargement…') }}</p>
        <iframe v-else-if="previewHtml" class="factures-preview__frame" :srcdoc="previewHtml" title="Facture" />
      </UiCard>
    </div>
  </div>
</template>

<style scoped>
.factures-filters__row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: center;
}
.factures-field {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  border: 1px solid var(--color-border, #cbd5e1);
  border-radius: 8px;
  padding: 0.35rem 0.6rem;
  background: var(--color-surface, #fff);
}
.factures-field input {
  border: none;
  outline: none;
  background: transparent;
  font: inherit;
  color: inherit;
}
.factures-field--search {
  flex: 1 1 260px;
}
.factures-field--search input {
  width: 100%;
}
.factures-summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 0.75rem;
  margin-top: 0.85rem;
}
.factures-summary > div {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  padding: 0.55rem 0.75rem;
  border-radius: 8px;
  background: var(--color-surface-muted, #f1f5f9);
}
.factures-summary span {
  font-size: 0.78rem;
  color: var(--color-text-muted, #64748b);
}
.factures-error {
  color: #b91c1c;
  margin: 0.5rem 0;
}
.factures-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 1rem;
  margin-top: 1rem;
}
@media (min-width: 1280px) {
  .factures-layout.has-detail {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }
}
.factures-table-wrap {
  overflow-x: auto;
}
.factures-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.88rem;
}
.factures-table th,
.factures-table td {
  padding: 0.55rem 0.6rem;
  border-bottom: 1px solid var(--color-border, #e2e8f0);
  text-align: start;
  vertical-align: middle;
}
.factures-table th {
  font-size: 0.75rem;
  text-transform: uppercase;
  color: var(--color-text-muted, #64748b);
}
.factures-table .num {
  text-align: end;
  white-space: nowrap;
}
.factures-table tbody tr {
  cursor: pointer;
}
.factures-table .nowrap {
  white-space: nowrap;
}
.factures-table tbody tr:hover,
.factures-table tbody tr.is-selected {
  background: var(--color-surface-muted, #f0fdfa);
}
.factures-empty {
  text-align: center !important;
  padding: 2rem !important;
  color: var(--color-text-muted, #64748b);
}
.factures-muted {
  display: block;
  color: var(--color-text-muted, #64748b);
  font-size: 0.78rem;
}
.factures-chip {
  display: inline-block;
  margin: 0.1rem 0.25rem 0.1rem 0;
  padding: 0.1rem 0.5rem;
  border-radius: 999px;
  font-size: 0.72rem;
  background: #e0f2f1;
  color: #0f766e;
}
.factures-status {
  font-size: 0.75rem;
  font-weight: 600;
  padding: 0.15rem 0.55rem;
  border-radius: 999px;
  white-space: nowrap;
}
.factures-status.is-paid {
  background: #dcfce7;
  color: #166534;
}
.factures-status.is-partial {
  background: #fef3c7;
  color: #92400e;
}
.factures-status.is-pending {
  background: #fee2e2;
  color: #991b1b;
}
.factures-actions {
  text-align: end;
}
.factures-preview__bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-bottom: 0.6rem;
}
.factures-preview__actions {
  display: flex;
  gap: 0.4rem;
}
.factures-preview__loading {
  padding: 2rem;
  text-align: center;
}
.factures-preview__frame {
  width: 100%;
  height: 78vh;
  border: 1px solid var(--color-border, #e2e8f0);
  border-radius: 8px;
  background: #fff;
}
</style>
