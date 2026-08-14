<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Eye, FileText, Filter } from '@lucide/vue'
import api from '@/api/client'
import { formatFcfa, fullName } from '@/lib/roles'
import { sortByCreatedAtNewestFirst } from '@/lib/patient-sort'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import UiFormModal from '@/components/ui/UiFormModal.vue'
import '@/assets/simple-table.css'

type Invoice = {
  id: string
  invoiceNumber: string
  type: string
  status: string
  amountFcfa: number
  createdAt: string
  patient: { code: string; firstName: string; lastName: string } | null
}

type PatientInvoiceGroup = {
  id: string
  patientName: string
  patientCode: string
  invoiceCount: number
  invoiceCountLabel: string
  totalAmount: string
  totalAmountSort: number
  lastDate: string
  lastDateSort: number
  invoices: Invoice[]
}

const TYPE_LABELS: Record<string, string> = {
  SURGERY: 'Chirurgie',
  HOSPITALIZATION_DEPOSIT: 'Caution hosp.',
  HOSPITALIZATION_FINAL: 'Régul. hosp.',
  PHARMACY: 'Pharmacie',
  CONSULTATION: 'Consultation',
  LAB_EXAM: 'Examens labo',
}

const STATUS_LABELS: Record<string, string> = {
  PAID: 'Payée',
  PENDING: 'En attente',
  DRAFT: 'Brouillon',
  CANCELLED: 'Annulée',
}

const invoices = ref<Invoice[]>([])
const filterType = ref('')
const filterStatus = ref('')
const loading = ref(false)
const selectedGroupKey = ref<string | null>(null)

function statusVariant(status: string) {
  if (status === 'PAID') return 'success'
  if (status === 'PENDING') return 'warning'
  if (status === 'CANCELLED') return 'danger'
  return 'default'
}

function groupKeyForInvoice(inv: Invoice) {
  return inv.patient?.code ?? `__orphan__:${inv.id}`
}

const patientGroups = computed<PatientInvoiceGroup[]>(() => {
  const map = new Map<string, Invoice[]>()

  for (const inv of invoices.value) {
    const key = groupKeyForInvoice(inv)
    const list = map.get(key) ?? []
    list.push(inv)
    map.set(key, list)
  }

  return [...map.entries()]
    .map(([key, groupInvoices]) => {
      const sorted = sortByCreatedAtNewestFirst(groupInvoices)
      const patient = sorted[0]?.patient
      const totalAmountFcfa = sorted.reduce((sum, inv) => sum + inv.amountFcfa, 0)
      const last = sorted[0]

      return {
        id: key,
        patientName: patient ? fullName(patient.firstName, patient.lastName) : 'Client externe',
        patientCode: patient?.code ?? '—',
        invoiceCount: sorted.length,
        invoiceCountLabel: `${sorted.length} facture${sorted.length > 1 ? 's' : ''}`,
        totalAmount: formatFcfa(totalAmountFcfa),
        totalAmountSort: totalAmountFcfa,
        lastDate: last ? new Date(last.createdAt).toLocaleDateString('fr-FR') : '—',
        lastDateSort: last ? new Date(last.createdAt).getTime() : 0,
        invoices: sorted,
      }
    })
    .sort((a, b) => b.lastDateSort - a.lastDateSort)
})

const tableData = computed(() => patientGroups.value)

const selectedGroup = computed(
  () => patientGroups.value.find((group) => group.id === selectedGroupKey.value) ?? null,
)

async function load() {
  loading.value = true
  try {
    const { data } = await api.get('/factures', {
      params: {
        limit: 500,
        ...(filterType.value ? { type: filterType.value } : {}),
        ...(filterStatus.value ? { status: filterStatus.value } : {}),
      },
    })
    invoices.value = data
  } finally {
    loading.value = false
  }
}

function downloadPdf(id: string) {
  window.open(`/api/factures/${id}/pdf`, '_blank')
}

function openDetails(id: string) {
  selectedGroupKey.value = id
}

function closeDetails() {
  selectedGroupKey.value = null
}

onMounted(load)
</script>

<template>
  <div class="page-with-table">
    <section class="page-with-table__head">
      <UiPageHeader
        title="Factures officielles"
        subtitle="Factures regroupées par patient — détail et impression PDF"
        :icon="FileText"
      />

      <UiCard title="Filtres" :icon="Filter" icon-variant="blue">
        <div class="filters">
          <UiSelect v-model="filterType" label="Type">
            <option value="">Tous les types</option>
            <option value="SURGERY">Chirurgie</option>
            <option value="HOSPITALIZATION_DEPOSIT">Caution hospitalisation</option>
            <option value="HOSPITALIZATION_FINAL">Régularisation</option>
            <option value="PHARMACY">Pharmacie</option>
            <option value="CONSULTATION">Consultation</option>
            <option value="LAB_EXAM">Examens labo</option>
          </UiSelect>
          <UiSelect v-model="filterStatus" label="Statut">
            <option value="">Tous</option>
            <option value="PAID">Payée</option>
            <option value="PENDING">En attente</option>
          </UiSelect>
          <UiButton variant="primary" @click="load">Appliquer</UiButton>
        </div>
      </UiCard>
    </section>

    <section class="page-with-table__body">
      <UiCard direct title="Factures par patient" class="ui-card--table-panel" :icon="FileText" icon-variant="teal">
        <div class="simple-table-shell simple-table-shell--fill">
          <div
            v-if="loading"
            class="simple-table-overlay" role="status"
            aria-live="polite"
          >
            <span class="simple-table-spinner" aria-hidden="true" />
            Chargement…
          </div>
          <div class="simple-table-scroll">
            <div class="simple-table-wrap">
              <table class="simple-table">
                <thead>
                  <tr>
                    <th class="simple-table__num">#</th>
                    <th>Patient</th>
                    <th>Factures</th>
                    <th>Montant total</th>
                    <th>Dernière facture</th>
                    <th class="simple-table__actions-head">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(row, index) in tableData" :key="row.id">
                    <td class="simple-table__num">{{ index + 1 }}</td>
                    <td>
                      <span class="st-name">{{ row.patientName }}</span>
                      <span class="st-sub">{{ row.patientCode }}</span>
                    </td>
                    <td>{{ row.invoiceCountLabel }}</td>
                    <td><span class="st-amount">{{ row.totalAmount }}</span></td>
                    <td><span class="st-date">{{ row.lastDate }}</span></td>
                    <td class="simple-table__actions">
                      <div class="st-actions">
                        <button
                          type="button"
                          class="st-btn st-btn--text"
                          title="Voir les détails"
                          aria-label="Voir les détails"
                          @click="openDetails(row.id)"
                        >
                          <Eye :size="15" />
                          Détails
                        </button>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </UiCard>
    </section>

    <UiFormModal
      v-if="selectedGroup"
      title="Détail des factures"
      :subtitle="`${selectedGroup.patientCode} — ${selectedGroup.patientName}`"
      size="large"
      @close="closeDetails"
    >
      <div class="invoice-detail">
        <p class="invoice-detail__summary">
          <strong>{{ selectedGroup.invoiceCountLabel }}</strong>
          · Total {{ selectedGroup.totalAmount }}
          · Dernière facture le {{ selectedGroup.lastDate }}
        </p>

        <table class="detail-table">
          <thead>
            <tr>
              <th>N° Facture</th>
              <th>Type</th>
              <th>Montant</th>
              <th>Statut</th>
              <th>Date</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr v-for="inv in selectedGroup.invoices" :key="inv.id">
              <td><strong>{{ inv.invoiceNumber }}</strong></td>
              <td>{{ TYPE_LABELS[inv.type] ?? inv.type }}</td>
              <td class="detail-table__amount">{{ formatFcfa(inv.amountFcfa) }}</td>
              <td>
                <span
                  class="detail-table__status"
                  :class="`detail-table__status--${statusVariant(inv.status)}`"
                >
                  {{ STATUS_LABELS[inv.status] ?? inv.status }}
                </span>
              </td>
              <td>{{ new Date(inv.createdAt).toLocaleDateString('fr-FR') }}</td>
              <td class="detail-table__actions">
                <UiButton size="sm" variant="ghost" @click="downloadPdf(inv.id)">
                  PDF
                </UiButton>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </UiFormModal>
  </div>
</template>

<style scoped>
.filters {
  display: grid;
  grid-template-columns: 1fr 1fr auto;
  gap: 1rem;
  align-items: end;
}

.invoice-detail__summary {
  margin: 0 0 0.85rem;
  font-size: 0.8125rem;
  color: var(--text-muted);
}

.detail-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8125rem;
}

.detail-table th,
.detail-table td {
  padding: 0.55rem 0.5rem;
  text-align: left;
  border-bottom: 1px solid var(--border);
}

.detail-table__amount {
  font-weight: 700;
  color: var(--primary-800, #1e3a5f);
}

.detail-table__actions {
  text-align: right;
  white-space: nowrap;
}

.detail-table__status {
  display: inline-flex;
  align-items: center;
  padding: 0.15rem 0.45rem;
  border-radius: 999px;
  font-size: 0.6875rem;
  font-weight: 700;
}

.detail-table__status--success {
  background: #dcfce7;
  color: #15803d;
}

.detail-table__status--warning {
  background: #fef3c7;
  color: #b45309;
}

.detail-table__status--danger {
  background: #ffe4e6;
  color: #be123c;
}

.detail-table__status--default {
  background: #f1f5f9;
  color: #475569;
}

@media (max-width: 768px) {
  .filters {
    grid-template-columns: 1fr;
  }
}
</style>
