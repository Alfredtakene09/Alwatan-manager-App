<script setup lang="ts">
import { computed } from 'vue'
import type { Config } from 'datatables.net'
import { fullName } from '@/lib/roles'
import {
  formatPrescribedExamsSummary,
  formatLabPrescribedExamsPreview,
  formatLabPrescribedExamsSummary,
  countLabPrescribedExams,
  parseLabResultsCompletedAt,
} from '@/lib/lab-notes'
import { sortByCreatedAtNewestFirst } from '@/lib/patient-sort'
import { DT_ICONS, labCompletedRowActionsHtml } from '@/lib/datatable-defaults'
import UiDataTable from '@/components/ui/UiDataTable.vue'

export type LabsWaitingVisitRow = {
  id: string
  createdAt: string
  updatedAt: string
  patient: {
    firstName: string
    lastName: string
    code: string
    phone?: string | null
    age?: number | null
    ageUnit?: string | null
    gender?: string | null
    category?: string
    ongName?: string | null
  }
  assignedDoctor?: { firstName: string; lastName: string } | null
  invoices?: Array<{
    invoiceNumber: string
    amountFcfa: number
    type: string
    createdAt: string
  }>
  vitalSigns?: Array<{
    weightKg?: number | null
    bloodPressure?: string | null
    temperatureC?: number | null
    pulseBpm?: number | null
    recordedAt: string
  }>
  consultation?: {
    id?: string
    clinicalNotes?: string | null
    labSentToLabAt?: string | null
    labExamReductionFcfa?: number
    labApprovedBy?: { firstName: string; lastName: string } | null
    doctor?: { firstName: string; lastName: string } | null
    updatedAt?: string
  } | null
}

const props = withDefaults(
  defineProps<{
    visits: LabsWaitingVisitRow[]
    selectedId?: string | null
    loading?: boolean
    fill?: boolean
    actionsMode?: 'append' | 'lab' | 'lab-completed' | 'none'
    examsSummaryMode?: 'all' | 'lab'
    dateMode?: 'sent' | 'completed'
    tableKey?: string
  }>(),
  {
    actionsMode: 'append',
    examsSummaryMode: 'all',
    dateMode: 'sent',
    tableKey: 'labs-waiting',
  },
)

const emit = defineEmits<{
  append: [id: string]
  view: [id: string]
  modify: [id: string]
  saisir: [id: string]
  print: [id: string]
  add: [id: string]
}>()

const tableData = computed(() =>
  sortByCreatedAtNewestFirst(
    props.visits.map((v) => ({
      ...v,
      createdAt:
        props.dateMode === 'completed'
          ? (parseLabResultsCompletedAt(v.consultation?.clinicalNotes)?.toISOString() ??
            v.consultation?.updatedAt ??
            v.updatedAt)
          : (v.consultation?.labSentToLabAt ?? v.updatedAt),
    })),
  ).map((v) => {
    const notes = v.consultation?.clinicalNotes
    const eventAt =
      props.dateMode === 'completed'
        ? (parseLabResultsCompletedAt(notes) ??
          new Date(v.consultation?.updatedAt ?? v.updatedAt))
        : new Date(v.consultation?.labSentToLabAt ?? v.updatedAt)
    const examsFull =
      props.examsSummaryMode === 'lab' ? formatLabPrescribedExamsSummary(notes) : formatPrescribedExamsSummary(notes)
    const exams =
      props.examsSummaryMode === 'lab' ? formatLabPrescribedExamsPreview(notes) : examsFull
    const examCount =
      props.examsSummaryMode === 'lab' ? countLabPrescribedExams(notes) : examsFull === '—' ? 0 : examsFull.split(',').length
    return {
      id: v.id,
      code: v.patient.code,
      patientName: fullName(v.patient.firstName, v.patient.lastName),
      patientPhone: v.patient.phone || '',
      exams,
      examsFull,
      examCount,
      eventDate: eventAt.toLocaleDateString('fr-FR'),
      eventTime: eventAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
      eventSort: eventAt.getTime(),
    }
  }),
)

const columns = computed(() => {
  const matriculeCol = {
    data: 'code',
    title: 'Matricule',
    responsivePriority: 2,
    className: props.actionsMode === 'lab-completed' ? 'dt-code-col all' : undefined,
    render: (code: string) => `<span class="dt-badge">${code}</span>`,
  }

  const patientCol = {
    data: 'patientName',
    title: 'Patient',
    responsivePriority: props.actionsMode === 'lab-completed' ? 3 : 1,
    className: props.actionsMode === 'lab-completed' ? 'dt-patient-col dt-patient-col--completed all' : undefined,
    render: (name: string, _t: string, row: { patientPhone: string }) => {
      const safeName = name.replace(/"/g, '&quot;')
      const title = row.patientPhone
        ? `${name} — ${row.patientPhone}`.replace(/"/g, '&quot;')
        : safeName
      const phone = row.patientPhone
        ? `<span class="dt-sub">${row.patientPhone}</span>`
        : ''
      return `<span class="dt-patient-cell" title="${title}"><span class="dt-name">${safeName}</span>${phone}</span>`
    },
  }

  const examsCol = {
    data: 'exams',
    title: 'Examens',
    responsivePriority: props.actionsMode === 'lab-completed' ? 5 : 3,
    className: props.actionsMode === 'lab-completed' ? 'dt-exams-col all' : undefined,
    render: (exams: string, _t: string, row: { examsFull: string; examCount: number }) => {
      const title =
        row.examsFull && row.examsFull !== exams && row.examsFull !== '—'
          ? ` title="${row.examsFull.replace(/"/g, '&quot;')}"`
          : ''
      const countBadge =
        row.examCount > 0
          ? `<span class="dt-exam-count">${row.examCount}</span>`
          : ''
      return `<span class="dt-exam-preview"${title}>${countBadge}<span class="dt-sub dt-sub--truncate">${exams}</span></span>`
    },
  }

  const dateCol = {
    data: 'eventSort',
    title: props.dateMode === 'completed' ? 'Terminé le' : 'Transféré le',
    responsivePriority: 4,
    className: props.actionsMode === 'lab-completed' ? 'dt-date-col all' : undefined,
    render: (_d: number, _t: string, row: { eventDate: string; eventTime: string }) =>
      `<span class="dt-date">${row.eventDate}</span><span class="dt-sub">${row.eventTime}</span>`,
  }

  const base =
    props.actionsMode === 'lab-completed'
      ? [matriculeCol, patientCol, dateCol, examsCol]
      : [matriculeCol, patientCol, examsCol, dateCol]

  if (props.actionsMode === 'none') return base

  if (props.actionsMode === 'lab') {
    return [
      ...base,
      {
        data: null,
        title: 'Actions',
        orderable: false,
        className: 'dt-actions-col dt-actions-col--lab all',
        responsivePriority: 1,
        render: (_d: unknown, _t: string, row: { id: string }) => `
      <div class="dt-row-actions dt-lab-actions" data-id="${row.id}">
        <button type="button" class="dt-btn dt-btn--icon dt-btn--accent" data-action="saisir" title="Saisir les résultats" aria-label="Saisir les résultats">
          ${DT_ICONS.edit}
        </button>
        <button type="button" class="dt-btn dt-btn--icon dt-btn--icon-soft" data-action="view" title="Voir le dossier" aria-label="Voir le dossier">
          ${DT_ICONS.view}
        </button>
      </div>
    `,
      },
    ]
  }

  if (props.actionsMode === 'lab-completed') {
    return [
      ...base,
      {
        data: null,
        title: 'Actions',
        orderable: false,
        className: 'dt-actions-col dt-actions-col--lab dt-actions-col--lab-completed all',
        responsivePriority: 1,
        render: (_d: unknown, _t: string, row: { id: string }) => labCompletedRowActionsHtml(row),
      },
    ]
  }

  return [
    ...base,
    {
      data: null,
      title: '',
      orderable: false,
      className: 'dt-actions-col all',
      responsivePriority: 1,
      render: (_d: unknown, _t: string, row: { id: string }) => `
      <div class="dt-row-actions" data-id="${row.id}">
        <button type="button" class="dt-btn dt-btn--text dt-btn--accent" data-action="append" title="Ajouter des examens" aria-label="Ajouter des examens">
          ${DT_ICONS.plus} Ajouter
        </button>
      </div>
    `,
    },
  ]
})

const options = computed<Config>(() => ({
  rowCallback(row: HTMLElement, data: object | unknown[]) {
    const id = (data as { id?: string }).id
    row.classList.toggle('dt-row--selected', id === props.selectedId)
  },
}))

function onAction({ action, id }: { action: string; id: string }) {
  if (action === 'append') emit('append', id)
  if (action === 'view') emit('view', id)
  if (action === 'modify') emit('modify', id)
  if (action === 'saisir') emit('saisir', id)
  if (action === 'print') emit('print', id)
  if (action === 'add') emit('add', id)
}
</script>

<template>
  <UiDataTable
    :table-key="tableKey"
    compact
    :fill="fill"
    :data="tableData"
    :columns="columns"
    :options="options"
    :loading="loading"
    :loading-label="dateMode === 'completed' ? 'Chargement des examens terminés…' : 'Chargement des analyses en cours…'"
    @action="onAction"
  />
</template>
