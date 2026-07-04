<script setup lang="ts">
import { computed } from 'vue'
import { fullName, formatFcfa } from '@/lib/roles'
import { type SurgeryCaseRow, formatSurgeryDate } from '@/lib/surgery-case'
import {
  computeOperationShares,
  formatAssistantLabel,
  surgeryCompletedAtIso,
} from '@/lib/surgery-shares'
import {
  formatSharePaymentLine,
  getApplicableShareKinds,
  getUnpaidShareKinds,
  hasAnySharePaid,
  isFullyPaid,
} from '@/lib/surgery-share-payments'
import { DT_ICONS, statusBadge } from '@/lib/datatable-defaults'
import UiDataTable from '@/components/ui/UiDataTable.vue'

const props = defineProps<{
  surgeries: SurgeryCaseRow[]
  loading?: boolean
  fill?: boolean
  busyId?: string | null
}>()

const emit = defineEmits<{
  revert: [id: string]
  postpone: [id: string]
  payShares: [id: string]
}>()

const tableData = computed(() =>
  [...props.surgeries]
    .sort(
      (a, b) =>
        new Date(surgeryCompletedAtIso(b)).getTime() - new Date(surgeryCompletedAtIso(a)).getTime(),
    )
    .map((surgery) => {
      const shares = computeOperationShares(surgery)
      const assistant = formatAssistantLabel(surgery)
      const completedAt = surgery.completedAt ?? surgery.operationScheduledAt ?? surgery.updatedAt
      const completedDate = new Date(completedAt)
      const shareParts = getApplicableShareKinds(surgery).map((kind) =>
        formatSharePaymentLine(surgery, kind),
      )
      const unpaidCount = getUnpaidShareKinds(surgery).length
      const fullyPaid = isFullyPaid(surgery)
      const anyPaid = hasAnySharePaid(surgery)
      const paymentStatusLabel = fullyPaid
        ? statusBadge('Tout réglé', 'success')
        : anyPaid
          ? statusBadge(`${unpaidCount} part(s) restante(s)`, 'warning')
          : statusBadge('À régler', 'warning')

      return {
        id: surgery.id,
        patientName: fullName(surgery.visit.patient.firstName, surgery.visit.patient.lastName),
        intervention: surgery.interventionType.label,
        surgeonName: `Dr ${fullName(surgery.surgeon.firstName, surgery.surgeon.lastName)}`,
        assistantLabel: assistant,
        totalAmount: formatFcfa(shares.totalFcfa),
        totalSort: shares.totalFcfa,
        shareBreakdown: shareParts.join(' · '),
        paymentStatusLabel,
        fullyPaid,
        anyPaid,
        hasUnpaidShares: unpaidCount > 0,
        completedDate: completedDate.toLocaleDateString('fr-FR'),
        completedTime: completedDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
        completedSort: completedDate.getTime(),
        scheduledLabel: formatSurgeryDate(surgery.operationScheduledAt ?? surgery.completedAt),
        hasAssistant: shares.hasAssistant,
        busy: props.busyId === surgery.id,
      }
    }),
)

const columns = [
  {
    data: 'patientName',
    title: 'Patient',
    responsivePriority: 1,
    render: (name: string) => `<span class="dt-name">${name}</span>`,
  },
  {
    data: 'intervention',
    title: 'Intervention',
    responsivePriority: 2,
    render: (label: string) => `<span class="dt-name">${label}</span>`,
  },
  {
    data: 'surgeonName',
    title: 'Équipe',
    responsivePriority: 4,
    render: (surgeon: string, _t: string, row: { assistantLabel: string | null }) => {
      const assistant = row.assistantLabel
        ? `<span class="dt-team-sub">Asst. ${row.assistantLabel}</span>`
        : `<span class="dt-team-sub dt-muted">Sans assistant</span>`
      return `<span class="dt-name">${surgeon}</span>${assistant}`
    },
  },
  {
    data: 'totalSort',
    title: 'Montant & répartition',
    responsivePriority: 2,
    render: (
      _d: number,
      _t: string,
      row: { totalAmount: string; shareBreakdown: string; paymentStatusLabel: string },
    ) =>
      `<span class="dt-amount">${row.totalAmount}</span><span class="dt-share-breakdown">${row.shareBreakdown}</span><span class="dt-sub">${row.paymentStatusLabel}</span>`,
  },
  {
    data: 'scheduledLabel',
    title: 'Date prévue',
    responsivePriority: 5,
    render: (label: string) => `<span class="dt-date">${label}</span>`,
  },
  {
    data: 'completedSort',
    title: 'Effectuée le',
    responsivePriority: 3,
    render: (_d: number, _t: string, row: { completedDate: string; completedTime: string }) =>
      `${statusBadge(row.completedDate, 'success')}<span class="dt-sub">${row.completedTime}</span>`,
  },
  {
    data: null,
    title: 'Actions',
    orderable: false,
    className: 'dt-actions-col dt-actions-col--completed all',
    responsivePriority: 1,
    render: (
      _d: unknown,
      _t: string,
      row: {
        id: string
        busy: boolean
        fullyPaid: boolean
        hasUnpaidShares: boolean
        anyPaid: boolean
      },
    ) => {
      const payButton = row.fullyPaid
        ? `<span class="dt-btn dt-btn--icon dt-btn--paid" title="Réglé" aria-label="Réglé">${DT_ICONS.check}</span>`
        : row.hasUnpaidShares
          ? `<button type="button" class="dt-btn dt-btn--icon dt-btn--accent" data-action="pay-shares" title="Enregistrer un paiement" aria-label="Enregistrer un paiement"${row.busy ? ' disabled' : ''}>
          ${DT_ICONS.pay}
        </button>`
          : ''

      const scheduleActions = row.anyPaid
        ? ''
        : `
        <button type="button" class="dt-btn dt-btn--icon dt-btn--icon-soft" data-action="postpone" title="Repousser" aria-label="Repousser"${row.busy ? ' disabled' : ''}>
          ${DT_ICONS.calendar}
        </button>
        <button type="button" class="dt-btn dt-btn--icon dt-btn--icon-soft" data-action="revert" title="Retour en attente" aria-label="Retour en attente"${row.busy ? ' disabled' : ''}>
          ${DT_ICONS.undo}
        </button>`

      return `
      <div class="dt-row-actions dt-medecin-actions" data-id="${row.id}">
        ${payButton}
        ${scheduleActions}
      </div>
    `
    },
  },
]

function onAction({ action, id }: { action: string; id: string }) {
  if (props.busyId) return
  if (action === 'revert') emit('revert', id)
  if (action === 'postpone') emit('postpone', id)
  if (action === 'pay-shares') emit('payShares', id)
}
</script>

<template>
  <UiDataTable
    table-key="completed-operations"
    fill
    :data="tableData"
    :columns="columns"
    :loading="loading"
    loading-label="Chargement des opérations effectuées…"
    @action="onAction"
  />
</template>
