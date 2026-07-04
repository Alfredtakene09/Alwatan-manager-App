<script setup lang="ts">
import { computed } from 'vue'
import type { Config } from 'datatables.net'
import { fullName } from '@/lib/roles'
import {
  formatPrescribedExamsPreview,
  formatPrescribedExamsSummary,
  countPrescribedExams,
} from '@/lib/lab-notes'
import { sortByCreatedAtNewestFirst } from '@/lib/patient-sort'
import { DT_ICONS, statusBadge } from '@/lib/datatable-defaults'
import UiDataTable from '@/components/ui/UiDataTable.vue'

export type ConsultedVisitRow = {
  id: string
  status: string
  createdAt: string
  updatedAt: string
  patient: {
    firstName: string
    lastName: string
    code: string
    phone?: string | null
    category?: string
    ongName?: string | null
  }
  assignedDoctor?: { firstName: string; lastName: string } | null
  vitalSigns?: Array<{
    weightKg?: number | null
    bloodPressure?: string | null
    temperatureC?: number | null
    pulseBpm?: number | null
    recordedAt: string
  }>
  consultation?: {
    clinicalNotes?: string | null
    updatedAt: string
    labSentToLabAt?: string | null
  } | null
}

const props = defineProps<{
  visits: ConsultedVisitRow[]
  selectedId?: string | null
  loading?: boolean
  fill?: boolean
}>()

const emit = defineEmits<{
  view: [id: string]
  edit: [id: string]
  append: [id: string]
}>()

const tableData = computed(() =>
  sortByCreatedAtNewestFirst(props.visits).map((v) => {
    const consultedAt = new Date(v.consultation?.updatedAt ?? v.updatedAt)
    const notes = v.consultation?.clinicalNotes
    const examsFull = formatPrescribedExamsSummary(notes)
    const exams = formatPrescribedExamsPreview(notes)
    const examCount = countPrescribedExams(notes)
    const labSent = Boolean(v.consultation?.labSentToLabAt)
    return {
      id: v.id,
      code: v.patient.code,
      patientName: fullName(v.patient.firstName, v.patient.lastName),
      patientPhone: v.patient.phone || '',
      patientCategory: v.patient.category ?? 'STANDARD',
      ongName: v.patient.ongName ?? '',
      exams,
      examsFull,
      examCount,
      consultedDate: consultedAt.toLocaleDateString('fr-FR'),
      consultedTime: consultedAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
      consultedSort: consultedAt.getTime(),
      labSent,
    }
  }),
)

const columns = [
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
    data: 'exams',
    title: 'Examens prescrits',
    responsivePriority: 3,
    render: (exams: string, _t: string, row: { examsFull: string; examCount: number }) => {
      const title =
        row.examsFull && row.examsFull !== exams && row.examsFull !== '—'
          ? ` title="${row.examsFull.replace(/"/g, '&quot;')}"`
          : ''
      const countBadge =
        row.examCount > 0 ? `<span class="dt-exam-count">${row.examCount}</span>` : ''
      return `<span class="dt-exam-preview"${title}>${countBadge}<span class="dt-sub dt-sub--truncate">${exams}</span></span>`
    },
  },
  {
    data: 'consultedSort',
    title: 'Consulté le',
    responsivePriority: 4,
    render: (_d: number, _t: string, row: { consultedDate: string; consultedTime: string }) =>
      `<span class="dt-date">${row.consultedDate}</span><span class="dt-sub">${row.consultedTime}</span>`,
  },
  {
    data: null,
    title: 'Statut',
    orderable: false,
    responsivePriority: 5,
    render: () => statusBadge('En attente paiement', 'warning'),
  },
  {
    data: null,
    title: 'Actions',
    orderable: false,
    className: 'dt-actions-col dt-actions-col--consulted all',
    responsivePriority: 1,
    render: (_d: unknown, _t: string, row: { id: string; labSent: boolean }) => `
      <div class="dt-row-actions dt-medecin-actions" data-id="${row.id}">
        <button type="button" class="dt-btn dt-btn--icon dt-btn--icon-soft" data-action="view" title="Voir les examens prescrits" aria-label="Voir les examens prescrits">
          ${DT_ICONS.view}
        </button>
        ${
          row.labSent
            ? ''
            : `<button type="button" class="dt-btn dt-btn--icon dt-btn--icon-soft" data-action="edit" title="Modifier la prescription" aria-label="Modifier la prescription">
          ${DT_ICONS.edit}
        </button>`
        }
        <button type="button" class="dt-btn dt-btn--icon dt-btn--accent" data-action="append" title="Ajouter des examens" aria-label="Ajouter des examens">
          ${DT_ICONS.plus}
        </button>
      </div>
    `,
  },
]

const options = computed<Config>(() => ({
  rowCallback(row: HTMLElement, data: object | unknown[]) {
    const id = (data as { id?: string }).id
    row.classList.toggle('dt-row--selected', id === props.selectedId)
  },
}))

function onAction({ action, id }: { action: string; id: string }) {
  if (action === 'view') emit('view', id)
  if (action === 'edit') emit('edit', id)
  if (action === 'append') emit('append', id)
}
</script>

<template>
  <UiDataTable
    table-key="consulted-patients"
    compact
    :fill="fill"
    :data="tableData"
    :columns="columns"
    :options="options"
    :loading="loading"
    loading-label="Chargement des patients consultés…"
    @action="onAction"
  />
</template>
