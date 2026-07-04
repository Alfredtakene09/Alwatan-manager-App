<script setup lang="ts">
import { computed } from 'vue'
import type { Config } from 'datatables.net'
import { fullName } from '@/lib/roles'
import { sortPatientsNewestFirst } from '@/lib/patient-sort'
import { genderBadge, patientRowActionsHtml } from '@/lib/datatable-defaults'
import UiDataTable from '@/components/ui/UiDataTable.vue'

export type PatientRow = {
  id: string
  code: string
  firstName: string
  lastName: string
  phone?: string
  gender?: string
  createdAt?: string
}

const props = withDefaults(
  defineProps<{
    patients: PatientRow[]
    loading?: boolean
    fill?: boolean
    showDelete?: boolean
  }>(),
  { showDelete: true },
)

const emit = defineEmits<{
  print: [patient: PatientRow]
  edit: [patient: PatientRow]
  reconsult: [patient: PatientRow]
  delete: [patient: PatientRow]
}>()

const patientsById = computed(() => new Map(props.patients.map((p) => [p.id, p])))

function formatDate(iso?: string) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

const tableData = computed(() =>
  sortPatientsNewestFirst(props.patients).map((p) => ({
    id: p.id,
    code: p.code,
    fullName: fullName(p.firstName, p.lastName),
    phone: p.phone || '—',
    genderRaw: p.gender,
    createdAt: formatDate(p.createdAt),
    createdAtSort: p.createdAt ? new Date(p.createdAt).getTime() : 0,
  })),
)

const columns = computed(() => [
  {
    data: 'code',
    title: 'Matricule',
    responsivePriority: 1,
    render: (code: string) => `<span class="dt-badge">${code}</span>`,
  },
  {
    data: 'fullName',
    title: 'Nom complet',
    responsivePriority: 2,
    render: (name: string) => `<span class="dt-name">${name}</span>`,
  },
  {
    data: 'phone',
    title: 'Téléphone',
    responsivePriority: 4,
    render: (phone: string) =>
      phone === '—' ? '<span class="dt-muted">—</span>' : `<a class="dt-phone" href="tel:${phone}">${phone}</a>`,
  },
  {
    data: 'genderRaw',
    title: 'Genre',
    responsivePriority: 5,
    render: (_d: unknown, _t: string, row: { genderRaw?: string }) => genderBadge(row.genderRaw),
  },
  {
    data: 'createdAtSort',
    title: "Date d'inscription",
    responsivePriority: 3,
    render: (_d: number, _t: string, row: { createdAt: string }) =>
      `<span class="dt-date">${row.createdAt}</span>`,
  },
  {
    data: null,
    title: 'Actions',
    orderable: false,
    searchable: false,
    className: 'dt-actions-col dt-actions-col--patients all',
    responsivePriority: 1,
    render: (_d: unknown, _t: string, row: { id: string }) =>
      patientRowActionsHtml(row, { showDelete: props.showDelete }),
  },
])

const options: Config = {
  columnDefs: [{ targets: 5, type: 'num' }],
}

function onAction({ action, id }: { action: string; id: string }) {
  const patient = patientsById.value.get(id)
  if (!patient) return
  if (action === 'print') emit('print', patient)
  if (action === 'edit') emit('edit', patient)
  if (action === 'reconsult') emit('reconsult', patient)
  if (action === 'delete') emit('delete', patient)
}
</script>

<template>
  <UiDataTable
    table-key="patients"
    :data="tableData"
    :columns="columns"
    :options="options"
    :loading="loading"
    :fill="fill"
    loading-label="Chargement des dossiers…"
    @action="onAction"
  />
</template>
