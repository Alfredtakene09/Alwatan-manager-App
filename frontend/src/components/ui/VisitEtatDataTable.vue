<script setup lang="ts">
import { computed } from 'vue'
import { fullName } from '@/lib/roles'
import { getVisitStatusMeta } from '@/lib/visit-status'
import { sortVisitsByPatientNewestFirst } from '@/lib/patient-sort'
import { statusBadge } from '@/lib/datatable-defaults'
import UiDataTable from '@/components/ui/UiDataTable.vue'

type Patient = {
  id: string
  code: string
  firstName: string
  lastName: string
  phone?: string
  createdAt?: string
}

export type VisitRow = {
  id: string
  status: string
  updatedAt: string
  patient: Patient
  assignedDoctor?: { firstName: string; lastName: string } | null
}

const props = defineProps<{
  visits: VisitRow[]
  loading?: boolean
  fill?: boolean
}>()

function formatSince(iso: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000))
  if (minutes < 1) return "À l'instant"
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  return `${hours} h ${minutes % 60} min`
}

const tableData = computed(() =>
  sortVisitsByPatientNewestFirst(props.visits).map((v) => {
    const meta = getVisitStatusMeta(v.status)
    return {
      id: v.id,
      code: v.patient.code,
      patientName: fullName(v.patient.firstName, v.patient.lastName),
      patientPhone: v.patient.phone || '',
      statusLabel: meta.label,
      statusVariant: meta.variant,
      pole: meta.pole,
      doctor: v.assignedDoctor
        ? fullName(v.assignedDoctor.firstName, v.assignedDoctor.lastName)
        : '—',
      duration: formatSince(v.updatedAt),
      updatedSort: new Date(v.updatedAt).getTime(),
    }
  }),
)

const columns = [
  {
    data: 'code',
    title: 'Matricule',
    responsivePriority: 1,
    render: (code: string) => `<span class="dt-badge">${code}</span>`,
  },
  {
    data: 'patientName',
    title: 'Patient',
    responsivePriority: 2,
    render: (name: string, _t: string, row: { patientPhone: string }) =>
      row.patientPhone
        ? `<span class="dt-name">${name}</span><span class="dt-sub">${row.patientPhone}</span>`
        : `<span class="dt-name">${name}</span>`,
  },
  {
    data: 'statusLabel',
    title: 'État',
    responsivePriority: 3,
    render: (label: string, _t: string, row: { statusVariant: string }) =>
      statusBadge(label, row.statusVariant as 'info' | 'primary' | 'warning' | 'success' | 'default'),
  },
  { data: 'pole', title: 'Pôle', responsivePriority: 4 },
  {
    data: 'doctor',
    title: 'Médecin',
    responsivePriority: 5,
    render: (doctor: string) =>
      doctor === '—' ? '<span class="dt-muted">—</span>' : `<span class="dt-name">${doctor}</span>`,
  },
  {
    data: 'updatedSort',
    title: 'Durée',
    responsivePriority: 6,
    render: (_d: number, _t: string, row: { duration: string }) =>
      `<span class="dt-date">${row.duration}</span>`,
  },
]

</script>

<template>
  <UiDataTable
    table-key="visits-etat"
    compact
    :fill="fill"
    :data="tableData"
    :columns="columns"
    :loading="loading"
    loading-label="Chargement…"
  />
</template>
