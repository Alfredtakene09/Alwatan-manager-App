<script setup lang="ts">
import { computed } from 'vue'
import type { Config } from 'datatables.net'
import { fullName } from '@/lib/roles'
import {
  formatLabPrescribedExamsPreview,
  formatLabPrescribedExamsSummary,
  countLabPrescribedExams,
  parseLatestLabResultAt,
} from '@/lib/lab-notes'
import { DT_ICONS } from '@/lib/datatable-defaults'
import UiDataTable from '@/components/ui/UiDataTable.vue'

export type LabsResultsVisitRow = {
  id: string
  createdAt: string
  updatedAt: string
  patient: {
    firstName: string
    lastName: string
    code: string
    phone?: string | null
    category?: string
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
    doctorComment?: string | null
    updatedAt?: string
    doctor?: { firstName: string; lastName: string } | null
  } | null
}

const props = defineProps<{
  visits: LabsResultsVisitRow[]
  selectedId?: string | null
  loading?: boolean
  fill?: boolean
}>()

const emit = defineEmits<{
  append: [id: string]
  view: [id: string]
  print: [id: string]
}>()

const tableData = computed(() =>
  [...props.visits]
    .map((v) => {
    const notes = v.consultation?.clinicalNotes
    const updatedAt =
      parseLatestLabResultAt(notes) ??
      new Date(v.consultation?.updatedAt ?? v.updatedAt)
    const examsFull = formatLabPrescribedExamsSummary(notes)
    const exams = formatLabPrescribedExamsPreview(notes)
    const examCount = countLabPrescribedExams(notes)
    return {
      id: v.id,
      code: v.patient.code,
      patientName: fullName(v.patient.firstName, v.patient.lastName),
      patientPhone: v.patient.phone || '',
      exams,
      examsFull,
      examCount,
      resultDate: updatedAt.toLocaleDateString('fr-FR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }),
      resultTime: updatedAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
      resultSort: updatedAt.getTime(),
    }
  })
    .sort((a, b) => b.resultSort - a.resultSort),
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
    title: 'Examens',
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
    data: 'resultSort',
    title: 'Résultats reçus',
    responsivePriority: 4,
    render: (_d: number, _t: string, row: { resultDate: string; resultTime: string }) =>
      `<span class="dt-date">${row.resultDate}</span><span class="dt-sub">${row.resultTime}</span>`,
  },
  {
    data: null,
    title: 'Actions',
    orderable: false,
    className: 'dt-actions-col dt-actions-col--lab dt-actions-col--lab-medecin all',
    responsivePriority: 1,
    render: (_d: unknown, _t: string, row: { id: string }) => `
      <div class="dt-row-actions dt-lab-actions" data-id="${row.id}">
        <button type="button" class="dt-btn dt-btn--icon dt-btn--accent" data-action="view" title="Voir les résultats" aria-label="Voir les résultats">
          ${DT_ICONS.view}
        </button>
        <button type="button" class="dt-btn dt-btn--icon dt-btn--icon-soft" data-action="print" title="Imprimer les résultats" aria-label="Imprimer les résultats">
          ${DT_ICONS.print}
        </button>
        <button type="button" class="dt-btn dt-btn--accent dt-btn--labeled" data-action="append" title="Ajouter des examens" aria-label="Ajouter des examens">
          ${DT_ICONS.plus}<span>Ajouter</span>
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
  if (action === 'append') emit('append', id)
  if (action === 'view') emit('view', id)
  if (action === 'print') emit('print', id)
}
</script>

<template>
  <UiDataTable
    table-key="labs-results"
    compact
    :fill="fill"
    :data="tableData"
    :columns="columns"
    :options="options"
    :loading="loading"
    loading-label="Chargement des résultats…"
    @action="onAction"
  />
</template>
