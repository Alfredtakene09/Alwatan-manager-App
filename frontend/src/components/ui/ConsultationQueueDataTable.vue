<script setup lang="ts">
import { computed } from 'vue'
import type { Config } from 'datatables.net'
import { fullName } from '@/lib/roles'
import { getVisitStatusMeta } from '@/lib/visit-status'
import { sortByCreatedAtNewestFirst } from '@/lib/patient-sort'
import { DT_ICONS, statusBadge } from '@/lib/datatable-defaults'
import UiDataTable from '@/components/ui/UiDataTable.vue'

export type ConsultationVisitRow = {
  id: string
  status: string
  createdAt: string
  notes?: string | null
  patient: { firstName: string; lastName: string; code: string; phone?: string | null }
  assignedDoctor?: { id: string; firstName: string; lastName: string } | null
  vitalSigns?: Array<{
    weightKg?: number | null
    bloodPressure?: string | null
    temperatureC?: number | null
    pulseBpm?: number | null
    recordedAt: string
  }>
  billing?: {
    consultationFeeFcfa: number
    reductionFcfa: number
    totalFcfa: number
  }
}

const props = defineProps<{
  visits: ConsultationVisitRow[]
  selectedId?: string | null
  loading?: boolean
  readOnly?: boolean
}>()

const emit = defineEmits<{
  consult: [id: string]
  transfer: [id: string]
}>()

const tableData = computed(() =>
  sortByCreatedAtNewestFirst(props.visits).map((v) => {
    const meta = getVisitStatusMeta(v.status)
    const arrival = new Date(v.createdAt)
    return {
      id: v.id,
      code: v.patient.code,
      patientName: fullName(v.patient.firstName, v.patient.lastName),
      patientPhone: v.patient.phone || '',
      statusLabel: meta.label,
      statusVariant: meta.variant,
      arrivalDate: arrival.toLocaleDateString('fr-FR'),
      arrivalTime: arrival.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
      arrivalSort: arrival.getTime(),
      doctorName: v.assignedDoctor
        ? `Dr ${fullName(v.assignedDoctor.firstName, v.assignedDoctor.lastName)}`
        : 'Non assigné',
    }
  }),
)

const columns = computed(() => {
  const base = [
  {
    data: 'code',
    title: 'Matricule',
    responsivePriority: 2,
    render: (code: string) => `<span class="dt-badge">${code}</span>`,
  },
  {
    data: 'patientName',
    title: 'Patient',
    responsivePriority: 1,
    render: (name: string, _t: string, row: { patientPhone: string }) =>
      row.patientPhone
        ? `<span class="dt-name">${name}</span><span class="dt-sub">${row.patientPhone}</span>`
        : `<span class="dt-name">${name}</span>`,
  },
  {
    data: 'statusLabel',
    title: 'Statut',
    responsivePriority: 3,
    render: (label: string, _t: string, row: { statusVariant: string }) =>
      statusBadge(label, row.statusVariant as 'info' | 'primary' | 'warning' | 'success' | 'default'),
  },
  {
    data: 'arrivalSort',
    title: 'Arrivée',
    responsivePriority: 4,
    render: (_d: number, _t: string, row: { arrivalDate: string; arrivalTime: string }) =>
      `<span class="dt-date">${row.arrivalDate}</span><span class="dt-sub">${row.arrivalTime}</span>`,
  },
  ]

  if (props.readOnly) {
    base.push({
      data: 'doctorName',
      title: 'Médecin assigné',
      responsivePriority: 2,
      render: (name: string) => `<span class="dt-date">${name}</span>`,
    })
    return base
  }

  base.push({
    data: null,
    title: '',
    orderable: false,
    className: 'dt-actions-col all',
    responsivePriority: 1,
    render: (_d: unknown, _t: string, row: { id: string }) => `
      <div class="dt-row-actions" data-id="${row.id}">
        <button type="button" class="dt-btn dt-btn--text dt-btn--accent" data-action="consult" title="Consulter" aria-label="Consulter">
          ${DT_ICONS.view} Consulter
        </button>
        <button type="button" class="dt-btn dt-btn--text" data-action="transfer" title="Transférer" aria-label="Transférer">
          ${DT_ICONS.transfer} Transférer
        </button>
      </div>
    `,
  })
  return base
})

const options = computed<Config>(() => ({
  rowCallback(row: HTMLElement, data: object | unknown[]) {
    const id = (data as { id?: string }).id
    row.classList.toggle('dt-row--selected', id === props.selectedId)
  },
}))

function onAction({ action, id }: { action: string; id: string }) {
  if (action === 'consult') emit('consult', id)
  if (action === 'transfer') emit('transfer', id)
}
</script>

<template>
  <UiDataTable
    table-key="consultation-queue"
    compact
    :data="tableData"
    :columns="columns"
    :options="options"
    :loading="loading"
    loading-label="Chargement de la file…"
    @action="onAction"
  />
</template>
