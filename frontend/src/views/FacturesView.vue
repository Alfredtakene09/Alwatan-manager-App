<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { FileText, Filter } from '@lucide/vue'
import api from '@/api/client'
import { formatFcfa, fullName } from '@/lib/roles'
import { sortByCreatedAtNewestFirst } from '@/lib/patient-sort'
import { DT_ICONS, statusBadge } from '@/lib/datatable-defaults'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import UiDataTable from '@/components/ui/UiDataTable.vue'

type Invoice = {
  id: string
  invoiceNumber: string
  type: string
  status: string
  amountFcfa: number
  createdAt: string
  patient: { code: string; firstName: string; lastName: string }
}

const invoices = ref<Invoice[]>([])
const filterType = ref('')
const filterStatus = ref('')
const loading = ref(false)

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

function statusVariant(status: string) {
  if (status === 'PAID') return 'success'
  if (status === 'PENDING') return 'warning'
  if (status === 'CANCELLED') return 'danger'
  return 'default'
}

const tableData = computed(() =>
  sortByCreatedAtNewestFirst(invoices.value).map((inv) => ({
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    patientName: fullName(inv.patient.firstName, inv.patient.lastName),
    patientCode: inv.patient.code,
    typeLabel: TYPE_LABELS[inv.type] ?? inv.type,
    amount: formatFcfa(inv.amountFcfa),
    amountSort: inv.amountFcfa,
    status: inv.status,
    statusLabel: STATUS_LABELS[inv.status] ?? inv.status,
    statusVariant: statusVariant(inv.status),
    date: new Date(inv.createdAt).toLocaleDateString('fr-FR'),
    dateSort: new Date(inv.createdAt).getTime(),
  })),
)

const columns = [
  {
    data: 'invoiceNumber',
    title: 'N° Facture',
    responsivePriority: 1,
    render: (n: string) => `<strong class="dt-name">${n}</strong>`,
  },
  {
    data: 'patientName',
    title: 'Patient',
    responsivePriority: 2,
    render: (name: string, _t: string, row: { patientCode: string }) =>
      `<span class="dt-name">${name}</span><span class="dt-sub">${row.patientCode}</span>`,
  },
  { data: 'typeLabel', title: 'Type', responsivePriority: 4 },
  {
    data: 'amountSort',
    title: 'Montant',
    responsivePriority: 3,
    render: (_d: number, _t: string, row: { amount: string }) =>
      `<span class="dt-amount">${row.amount}</span>`,
  },
  {
    data: 'statusLabel',
    title: 'Statut',
    responsivePriority: 5,
    render: (label: string, _t: string, row: { statusVariant: string }) =>
      statusBadge(label, row.statusVariant as 'success' | 'warning' | 'danger' | 'default'),
  },
  {
    data: 'dateSort',
    title: 'Date',
    responsivePriority: 6,
    render: (_d: number, _t: string, row: { date: string }) =>
      `<span class="dt-date">${row.date}</span>`,
  },
  {
    data: null,
    title: '',
    orderable: false,
    className: 'dt-actions-col',
    responsivePriority: 1,
    render: (_d: unknown, _t: string, row: { id: string }) => `
      <div class="dt-row-actions" data-id="${row.id}">
        <button type="button" class="dt-btn dt-btn--text" data-action="pdf" title="Télécharger PDF" aria-label="PDF">
          ${DT_ICONS.download} PDF
        </button>
      </div>
    `,
  },
]

async function load() {
  loading.value = true
  try {
    const { data } = await api.get('/factures', {
      params: {
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

function onAction({ action, id }: { action: string; id: string }) {
  if (action === 'pdf') downloadPdf(id)
}

onMounted(load)
</script>

<template>
  <div class="page-with-table">
    <section class="page-with-table__head">
      <UiPageHeader
        title="Factures officielles"
        subtitle="Historique des factures générées par la comptabilité — impression PDF"
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
      <UiCard title="Liste des factures" class="ui-card--table-panel" :icon="FileText" icon-variant="teal">
        <UiDataTable
          table-key="factures"
          fill
          compact
          :data="tableData"
          :columns="columns"
          :loading="loading"
          @action="onAction"
        />
      </UiCard>
    </section>
  </div>
</template>

<style scoped>
.filters {
  display: grid;
  grid-template-columns: 1fr 1fr auto;
  gap: 1rem;
  align-items: end;
}

.section {
  margin-top: 0;
}

@media (max-width: 768px) {
  .filters {
    grid-template-columns: 1fr;
  }
}
</style>
