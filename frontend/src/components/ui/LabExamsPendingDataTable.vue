<script setup lang="ts">
import { computed } from 'vue'
import type { Config } from 'datatables.net'
import { formatFcfa, fullName } from '@/lib/roles'
import { sortByCreatedAtNewestFirst } from '@/lib/patient-sort'
import { DT_ICONS } from '@/lib/datatable-defaults'
import { formatExamLinesSummary, type LabExamPendingItem } from '@/lib/lab-exam-pending'
import { useAppI18n } from '@/i18n/useAppI18n'
import UiDataTable from '@/components/ui/UiDataTable.vue'

const { uiText, localeCode, isArabic } = useAppI18n()
const dateLocale = computed(() => (isArabic.value ? 'ar-TD' : 'fr-FR'))

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
  view: [id: string]
  hospitalize: [visitId: string]
}>()

const isPaidMode = computed(() => props.mode === 'paid')

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const tableData = computed(() => {
  void localeCode.value
  return sortByCreatedAtNewestFirst(
    props.items.map((item) => ({
      ...item,
      createdAt: isPaidMode.value ? (item.paidAt ?? item.updatedAt) : item.updatedAt,
    })),
  ).map((item) => {
    const referenceDate = new Date(isPaidMode.value ? (item.paidAt ?? item.updatedAt) : item.updatedAt)
    const netFcfa =
      item.grossFcfa - (item.labExamReductionFcfa ?? 0)
    const examCount = item.examLines?.length ?? 0
    const examsFull = formatExamLinesSummary(item.examLines ?? [])
    const collectedFromPartials = Object.values(item.partialPaymentsByKind ?? {}).reduce(
      (sum, row) => sum + Math.max(0, row?.paidFcfa ?? 0),
      0,
    )
    const remainingFromPartials = Object.values(item.partialPaymentsByKind ?? {}).reduce(
      (sum, row) => sum + Math.max(0, row?.remainingFcfa ?? 0),
      0,
    )
    const collectedFromInvoices = Object.values(item.invoicesByKind ?? {}).reduce((sum, inv) => {
      if (!inv) return sum
      if (inv.paidFcfa != null) return sum + Math.max(0, inv.paidFcfa)
      return sum + Math.max(0, inv.netFcfa)
    }, 0)
    const remainingFromInvoices = Object.values(item.invoicesByKind ?? {}).reduce(
      (sum, inv) => sum + Math.max(0, inv?.remainingFcfa ?? 0),
      0,
    )
    const collectedFcfa =
      item.collectedFcfa != null
        ? item.collectedFcfa
        : Math.max(collectedFromInvoices, collectedFromPartials)
    const remainingFromPayments =
      item.remainingFcfa != null
        ? item.remainingFcfa
        : Math.max(remainingFromInvoices, remainingFromPartials)

    // En attente : solde dû = reste des tranches + montant des types encore non commencés.
    let pendingDueFcfa = item.grossFcfa
    if (!isPaidMode.value) {
      const unpaidKinds = item.unpaidKinds ?? []
      const partials = item.partialPaymentsByKind ?? {}
      if (unpaidKinds.length) {
        pendingDueFcfa = unpaidKinds.reduce((sum, kind) => {
          const partial = partials[kind]
          if (partial) return sum + Math.max(0, partial.remainingFcfa)
          return sum + Math.max(0, item.examsByKind?.[kind]?.grossFcfa ?? 0)
        }, 0)
      } else if (remainingFromPayments > 0) {
        pendingDueFcfa = remainingFromPayments
      }
    }

    const remainingFcfa = isPaidMode.value ? remainingFromPayments : pendingDueFcfa
    const displayNetFcfa = isPaidMode.value
      ? collectedFcfa > 0
        ? collectedFcfa
        : netFcfa
      : pendingDueFcfa
    const showPartialBreakdown = collectedFcfa > 0 && remainingFcfa > 0
    return {
      id: item.id,
      visitId: item.visitId ?? '',
      hasHospitalisation: (item.unpaidKinds ?? []).includes('hospitalisation'),
      code: item.visit.patient.code,
      patientName: fullName(item.visit.patient.firstName, item.visit.patient.lastName),
      patientPhone: item.visit.patient.phone || '',
      doctorName: item.doctor
        ? `Dr ${fullName(item.doctor.firstName, item.doctor.lastName)}`
        : uiText('Patient externe — Réception'),
      exams: examsFull,
      examsFull,
      examCount,
      gross: formatFcfa(displayNetFcfa),
      grossSort: displayNetFcfa,
      collected: showPartialBreakdown ? formatFcfa(collectedFcfa) : '',
      remaining: showPartialBreakdown || (isPaidMode.value && remainingFcfa > 0)
        ? formatFcfa(remainingFcfa)
        : '',
      remainingSort: remainingFcfa,
      date: referenceDate.toLocaleDateString(dateLocale.value),
      time: referenceDate.toLocaleTimeString(dateLocale.value, { hour: '2-digit', minute: '2-digit' }),
      dateSort: referenceDate.getTime(),
    }
  })
})

const columns = computed(() => {
  void localeCode.value
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const base: any[] = [
    {
      data: 'code',
      title: uiText('Matricule'),
      responsivePriority: 2,
      render: (code: string) => `<span class="dt-badge">${code}</span>`,
    },
    {
      data: 'patientName',
      title: uiText('Patient'),
      responsivePriority: 1,
      render: (name: string, _t: string, row: { patientPhone: string }) =>
        row.patientPhone
          ? `<span class="dt-name">${name}</span><span class="dt-sub">${row.patientPhone}</span>`
          : `<span class="dt-name">${name}</span>`,
    },
    {
      data: 'doctorName',
      title: uiText('Médecin'),
      responsivePriority: 4,
      render: (name: string) => `<span class="dt-sub">${name}</span>`,
    },
    {
      data: 'exams',
      title: uiText('Examens'),
      responsivePriority: 3,
      className: 'dt-exams-col dt-exams-col--full all',
      orderable: false,
      render: (exams: string, _t: string, row: { examsFull: string; examCount: number }) => {
        const lines = (row.examsFull || exams || '—')
          .split(' · ')
          .filter(Boolean)
          .map((line) => `<span class="dt-exam-line">${escapeHtml(line)}</span>`)
          .join('')
        const countBadge =
          row.examCount > 0 ? `<span class="dt-exam-count">${row.examCount}</span>` : ''
        return `<div class="dt-exam-full">${countBadge}<div class="dt-exam-full__list">${lines}</div></div>`
      },
    },
    {
      data: 'grossSort',
      title: uiText(isPaidMode.value ? 'Net payé' : 'Montant'),
      responsivePriority: 2,
      className: isPaidMode.value ? 'dt-amount-col dt-amount-col--paid all' : 'dt-amount-col dt-amount-col--pending all',
      render: (
        _d: number,
        _t: string,
        row: { gross: string; remaining?: string; collected?: string },
      ) => {
        if (isPaidMode.value) {
          const remainingLine = row.remaining
            ? `<span class="dt-amount-remaining" dir="ltr">${uiText('Reste')} ${row.remaining}</span>`
            : ''
          return `<div class="dt-amount-stack"><strong class="dt-amount dt-amount--nowrap" dir="ltr">${row.gross}</strong>${remainingLine}</div>`
        }
        // En attente : reste à payer en évidence + déjà encaissé si tranche.
        if (row.collected && row.remaining) {
          return `<div class="dt-amount-stack">
            <strong class="dt-amount dt-amount--nowrap dt-amount--due" dir="ltr">${uiText('Reste')} ${row.remaining}</strong>
            <span class="dt-amount-collected" dir="ltr">${uiText('Déjà encaissé')} ${row.collected}</span>
          </div>`
        }
        return `<div class="dt-amount-stack"><strong class="dt-amount dt-amount--nowrap" dir="ltr">${row.gross}</strong></div>`
      },
    },
  ]

  if (!isPaidMode.value) {
    base.push({
      data: 'dateSort',
      title: uiText('Prescrit le'),
      responsivePriority: 5,
      render: (_d: number, _t: string, row: { date: string; time: string }) =>
        `<span class="dt-date">${row.date}</span><span class="dt-sub">${row.time}</span>`,
    })
  }

  base.push({
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
          ? uiText('Imprimer les factures')
          : uiText('Aucune facture payée à imprimer')
        const viewLabel = uiText('Voir')
        const reclaimLabel = uiText('Réclamation')
        const printDisabled = canPrint ? '' : ' disabled aria-disabled="true"'
        return `
      <div class="dt-row-actions" data-id="${row.id}">
        <button type="button" class="dt-btn dt-btn--icon dt-btn--icon-soft" data-action="view" title="${viewLabel}" aria-label="${viewLabel}">
          ${DT_ICONS.view}
        </button>
        <button type="button" class="dt-btn dt-btn--icon" data-action="reclaim" title="${reclaimLabel}" aria-label="${reclaimLabel}">
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
  })

  return base
})

const options = computed<Config>(() => ({
  columnDefs: [
    {
      targets: -1,
      width: isPaidMode.value ? '11.5rem' : '9.75rem',
      className: isPaidMode.value
        ? 'dt-actions-col dt-actions-col--lab all'
        : 'dt-actions-col dt-actions-col--lab-pending all',
    },
    {
      targets: 3,
      width: '28%',
      className: 'dt-exams-col dt-exams-col--full all',
    },
    ...(isPaidMode.value
      ? [
          {
            targets: 4,
            width: '10.5rem',
            className: 'dt-amount-col dt-amount-col--paid all',
          },
        ]
      : [
          {
            targets: 4,
            width: '7.5rem',
            className: 'dt-amount-col',
          },
        ]),
  ],
}))

function onAction({ action, id }: { action: string; id: string }) {
  if (action === 'pay') emit('pay', id)
  if (action === 'print') {
    if (isPaidMode.value && props.printableIds && !props.printableIds.has(id)) return
    emit('print', id)
  }
  if (action === 'reclaim') emit('reclaim', id)
  if (action === 'view') emit('view', id)
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
    :loading-label="isPaidMode ? uiText('Chargement des examens payés…') : uiText('Chargement des examens en attente…')"
    @action="onAction"
  />
</template>
