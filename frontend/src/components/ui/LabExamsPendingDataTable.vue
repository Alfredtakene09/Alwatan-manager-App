<script setup lang="ts">
import { computed } from 'vue'
import type { Config } from 'datatables.net'
import { formatFcfa, fullName } from '@/lib/roles'
import { sortByCreatedAtNewestFirst } from '@/lib/patient-sort'
import { DT_ICONS } from '@/lib/datatable-defaults'
import { formatExamLinesSummaryShort, type LabExamPendingItem } from '@/lib/lab-exam-pending'
import UiDataTable from '@/components/ui/UiDataTable.vue'

export type LabExamPendingRow = LabExamPendingItem

const props = withDefaults(
  defineProps<{
    items: LabExamPendingRow[]
    loading?: boolean
    fill?: boolean
    mode?: 'pending' | 'paid'
    printableIds?: Set<string>
  }>(),
  { mode: 'pending' },
)

const emit = defineEmits<{
  pay: [id: string]
  print: [id: string]
  reclaim: [id: string]
  hospitalize: [visitId: string]
}>()

const isPaidMode = computed(() => props.mode === 'paid')

const tableData = computed(() =>
  sortByCreatedAtNewestFirst(
    props.items.map((item) => ({
      ...item,
      createdAt: isPaidMode.value ? (item.paidAt ?? item.updatedAt) : item.updatedAt,
    })),
  ).map((item) => {
    const referenceDate = new Date(isPaidMode.value ? (item.paidAt ?? item.updatedAt) : item.updatedAt)
    const netFcfa =
      item.grossFcfa - (item.labExamReductionFcfa ?? 0)
    return {
      id: item.id,
      visitId: item.visitId ?? '',
      hasHospitalisation: (item.unpaidKinds ?? []).includes('hospitalisation'),
      code: item.visit.patient.code,
      patientName: fullName(item.visit.patient.firstName, item.visit.patient.lastName),
      patientPhone: item.visit.patient.phone || '',
      doctorName: item.doctor
        ? `Dr ${fullName(item.doctor.firstName, item.doctor.lastName)}`
        : 'Patient externe — Réception',
      ...(() => {
        const summary = formatExamLinesSummaryShort(item.examLines, {
          maxLabelChars: 18,
          maxTotalChars: 64,
        })
        return {
          exams: summary.short,
          examsFull: summary.full,
          examCount: summary.examCount,
        }
      })(),
      gross: formatFcfa(isPaidMode.value ? netFcfa : item.grossFcfa),
      grossSort: isPaidMode.value ? netFcfa : item.grossFcfa,
      date: referenceDate.toLocaleDateString('fr-FR'),
      time: referenceDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
      dateSort: referenceDate.getTime(),
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
      data: 'doctorName',
      title: 'Médecin',
      responsivePriority: 4,
      render: (name: string) => `<span class="dt-sub">${name}</span>`,
    },
    {
      data: 'exams',
      title: 'Examens',
      responsivePriority: 6,
      className: 'dt-exams-col',
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
      data: 'grossSort',
      title: isPaidMode.value ? 'Net payé' : 'Montant',
      responsivePriority: 3,
      render: (_d: number, _t: string, row: { gross: string }) =>
        `<strong class="dt-amount">${row.gross}</strong>`,
    },
    {
      data: 'dateSort',
      title: isPaidMode.value ? 'Payé le' : 'Prescrit le',
      responsivePriority: 5,
      render: (_d: number, _t: string, row: { date: string; time: string }) =>
        `<span class="dt-date">${row.date}</span><span class="dt-sub">${row.time}</span>`,
    },
    {
      data: null,
      title: '',
      orderable: false,
      className: isPaidMode.value
        ? 'dt-actions-col dt-actions-col--lab all'
        : 'dt-actions-col dt-actions-col--lab-pending all',
      responsivePriority: 1,
      render: (_d: unknown, _t: string, row: { id: string; visitId: string; hasHospitalisation: boolean }) => {
        if (isPaidMode.value) {
          const canPrint = props.printableIds?.has(row.id) ?? true
          const printTitle = canPrint
            ? 'Imprimer les factures'
            : 'Aucune facture payée à imprimer'
          const printDisabled = canPrint ? '' : ' disabled aria-disabled="true"'
          return `
      <div class="dt-row-actions" data-id="${row.id}">
        <button type="button" class="dt-btn dt-btn--icon" data-action="reclaim" title="Réclamation" aria-label="Réclamation">
          ${DT_ICONS.reclaim}
        </button>
        <button type="button" class="dt-btn dt-btn--icon" data-action="print" title="${printTitle}" aria-label="${printTitle}"${printDisabled}>
          ${DT_ICONS.print}
        </button>
      </div>
    `
        }
        const hospBtn = row.hasHospitalisation
          ? `<button type="button" class="dt-btn dt-btn--icon dt-btn--hosp" data-action="hospitalize" title="Hospitalisation — attribuer un lit" aria-label="Hospitalisation">
          ${DT_ICONS.bed}
        </button>`
          : ''
        return `
      <div class="dt-row-actions dt-lab-pending-actions" data-id="${row.id}" data-visit-id="${row.visitId}">
        <button type="button" class="dt-btn dt-btn--icon dt-btn--pay" data-action="pay" title="Encaisser" aria-label="Encaisser">
          ${DT_ICONS.pay}
        </button>
        ${hospBtn}
        <button type="button" class="dt-btn dt-btn--icon" data-action="print" title="Aperçu factures" aria-label="Aperçu factures">
          ${DT_ICONS.print}
        </button>
      </div>
    `
      },
    },
  ]
  return base
})

const options = computed<Config>(() => ({
  columnDefs: [
    {
      targets: -1,
      width: '9.75rem',
      className: isPaidMode.value
        ? 'dt-actions-col dt-actions-col--lab all'
        : 'dt-actions-col dt-actions-col--lab-pending all',
    },
  ],
}))

function onAction({ action, id }: { action: string; id: string }) {
  if (action === 'pay') emit('pay', id)
  if (action === 'print') {
    if (isPaidMode.value && props.printableIds && !props.printableIds.has(id)) return
    emit('print', id)
  }
  if (action === 'reclaim') emit('reclaim', id)
  if (action === 'hospitalize') {
    const row = tableData.value.find((item) => item.id === id)
    if (row?.visitId) emit('hospitalize', row.visitId)
  }
}
</script>

<template>
  <UiDataTable
    :table-key="isPaidMode ? 'lab-exams-paid' : 'lab-exams-pending'"
    compact
    :fill="fill"
    :data="tableData"
    :columns="columns"
    :options="options"
    :loading="loading"
    :loading-label="isPaidMode ? 'Chargement des examens payés…' : 'Chargement des examens en attente…'"
    @action="onAction"
  />
</template>
