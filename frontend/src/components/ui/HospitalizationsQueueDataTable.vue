<script setup lang="ts">
import { computed } from 'vue'
import type { Config } from 'datatables.net'
import { formatFcfa, fullName } from '@/lib/roles'
import { DT_ICONS, statusBadge } from '@/lib/datatable-defaults'
import { HOSPITALIZATION_STATUS_LABELS } from '@/lib/hospitalization-admission'
import UiDataTable from '@/components/ui/UiDataTable.vue'

export type HospitalizationQueueItem = {
  id: string
  status: string
  roomType: string
  reductionFcfa?: number
  totalDueFcfa?: number
  nightsCount?: number
  endDate?: string | null
  dailyRateFcfa?: number
  startDate?: string | null
  visit: {
    id: string
    patient: { code: string; firstName: string; lastName: string; phone?: string | null }
    consultation?: {
      doctor?: { firstName: string; lastName: string } | null
    } | null
    assignedDoctor?: { firstName: string; lastName: string } | null
  }
  room?: { name: string; type?: string } | null
}

const props = defineProps<{
  items: HospitalizationQueueItem[]
  loading?: boolean
  fill?: boolean
  focusedVisitId?: string | null
}>()

const emit = defineEmits<{
  admit: [id: string]
  view: [id: string]
  edit: [id: string]
  discharge: [id: string]
}>()

function doctorName(item: HospitalizationQueueItem) {
  const doctor = item.visit.consultation?.doctor ?? item.visit.assignedDoctor
  return doctor ? `Dr ${fullName(doctor.firstName, doctor.lastName)}` : '—'
}

function statusTone(status: string): 'warning' | 'success' | 'info' | 'danger' | 'default' {
  if (status === 'REQUESTED') return 'warning'
  if (status === 'ACTIVE') return 'success'
  if (status === 'RESERVED') return 'info'
  if (status === 'DISCHARGED') return 'default'
  return 'danger'
}

function roomLabel(item: HospitalizationQueueItem) {
  return item.room?.name ?? '—'
}

function roomTypeLabel(item: HospitalizationQueueItem) {
  const type = item.room?.type ?? item.roomType
  if (type === 'VIP') return 'VIP'
  if (type === 'SIMPLE') return 'Simple'
  return '—'
}

const tableData = computed(() =>
  [...props.items]
    .sort((a, b) => {
      const order = { ACTIVE: 0, RESERVED: 1, DISCHARGED: 2, REQUESTED: 3 }
      const aOrder = order[a.status as keyof typeof order] ?? 9
      const bOrder = order[b.status as keyof typeof order] ?? 9
      if (aOrder !== bOrder) return aOrder - bOrder
      const aDate = a.startDate ? new Date(a.startDate).getTime() : 0
      const bDate = b.startDate ? new Date(b.startDate).getTime() : 0
      return bDate - aDate
    })
    .map((item) => {
      const hasRoom = Boolean(item.room)
      const startLabel = item.startDate
        ? new Date(item.startDate).toLocaleDateString('fr-FR')
        : '—'
      const endLabel = item.endDate
        ? new Date(item.endDate).toLocaleDateString('fr-FR')
        : '—'
      const amountLabel =
        item.totalDueFcfa && item.totalDueFcfa > 0
          ? formatFcfa(item.totalDueFcfa)
          : item.dailyRateFcfa
            ? `${formatFcfa(item.dailyRateFcfa)}/nuit`
            : '—'

      return {
        id: item.id,
        visitId: item.visit.id,
        focused: item.visit.id === props.focusedVisitId,
        code: item.visit.patient.code,
        patientName: fullName(item.visit.patient.firstName, item.visit.patient.lastName),
        patientPhone: item.visit.patient.phone || '',
        doctorName: doctorName(item),
        roomLabel: roomLabel(item),
        roomTypeLabel: roomTypeLabel(item),
        status: item.status,
        statusLabel: HOSPITALIZATION_STATUS_LABELS[item.status] ?? item.status,
        startLabel,
        endLabel,
        amountLabel,
        nightsLabel: item.nightsCount ? `${item.nightsCount} nuit(s)` : '—',
        needsAdmission: item.status === 'REQUESTED' || (item.status === 'RESERVED' && !hasRoom),
        canView: true,
        canEdit: hasRoom && Boolean(item.startDate) && item.status !== 'DISCHARGED',
        canDischarge: item.status === 'ACTIVE' && hasRoom,
      }
    }),
)

const columns = [
  {
    data: 'code',
    title: 'Matricule',
    responsivePriority: 3,
    render: (code: string) => `<span class="dt-badge">${code}</span>`,
  },
  {
    data: 'patientName',
    title: 'Patient',
    responsivePriority: 1,
    render: (name: string, _t: string, row: { patientPhone: string; focused: boolean }) =>
      `<span class="dt-name${row.focused ? ' dt-name--focus' : ''}">${name}</span>${
        row.patientPhone ? `<span class="dt-sub">${row.patientPhone}</span>` : ''
      }`,
  },
  {
    data: 'doctorName',
    title: 'Médecin',
    responsivePriority: 5,
    render: (name: string) => `<span class="dt-sub">${name}</span>`,
  },
  {
    data: 'roomTypeLabel',
    title: 'Chambre',
    responsivePriority: 4,
    render: (label: string) => `<span class="dt-badge dt-badge--muted">${label}</span>`,
  },
  {
    data: 'roomLabel',
    title: 'Salle',
    responsivePriority: 4,
    render: (label: string) => `<span class="dt-sub">${label}</span>`,
  },
  {
    data: 'statusLabel',
    title: 'Statut',
    orderable: false,
    responsivePriority: 3,
    render: (_label: string, _t: string, row: { status: string; statusLabel: string }) =>
      statusBadge(row.statusLabel, statusTone(row.status)),
  },
  {
    data: 'startLabel',
    title: 'Entrée',
    responsivePriority: 6,
    render: (date: string) => `<span class="dt-date">${date}</span>`,
  },
  {
    data: 'endLabel',
    title: 'Sortie',
    responsivePriority: 6,
    render: (date: string) => `<span class="dt-date">${date}</span>`,
  },
  {
    data: 'amountLabel',
    title: 'Montant',
    responsivePriority: 5,
    render: (amount: string, _t: string, row: { nightsLabel: string }) =>
      `<span class="dt-name">${amount}</span><span class="dt-sub">${row.nightsLabel}</span>`,
  },
  {
    data: null,
    title: '',
    orderable: false,
    className: 'dt-actions-col all',
    responsivePriority: 1,
    render: (
      _d: unknown,
      _t: string,
      row: {
        id: string
        visitId: string
        needsAdmission: boolean
        canView: boolean
        canEdit: boolean
        canDischarge: boolean
      },
    ) => {
      const viewBtn = row.canView
        ? `<button type="button" class="dt-btn dt-btn--icon" data-action="view" title="Voir le profil" aria-label="Voir">
          ${DT_ICONS.view}
        </button>`
        : ''
      const editBtn = row.canEdit
        ? `<button type="button" class="dt-btn dt-btn--icon" data-action="edit" title="Modifier le séjour" aria-label="Modifier">
          ${DT_ICONS.edit}
        </button>`
        : ''
      const admitBtn = row.needsAdmission
        ? `<button type="button" class="dt-btn dt-btn--icon dt-btn--hosp" data-action="admit" title="Programmer l'admission" aria-label="Programmer">
          ${DT_ICONS.bed}
        </button>`
        : ''
      const dischargeBtn = row.canDischarge
        ? `<button type="button" class="dt-btn dt-btn--icon dt-btn--accent" data-action="discharge" title="Clôturer la sortie" aria-label="Clôturer">
          ${DT_ICONS.calendar}
        </button>`
        : ''
      return `
      <div class="dt-row-actions" data-id="${row.id}" data-visit-id="${row.visitId}">
        ${viewBtn}
        ${editBtn}
        ${admitBtn}
        ${dischargeBtn}
      </div>`
    },
  },
]

const options = computed<Config>(() => ({}))

function onAction({ action, id }: { action: string; id: string }) {
  if (action === 'admit') emit('admit', id)
  if (action === 'view') emit('view', id)
  if (action === 'edit') emit('edit', id)
  if (action === 'discharge') emit('discharge', id)
}
</script>

<template>
  <UiDataTable
    table-key="hospitalizations-queue"
    compact
    :fill="fill"
    :data="tableData"
    :columns="columns"
    :options="options"
    :loading="loading"
    loading-label="Chargement des hospitalisations…"
    @action="onAction"
  />
</template>
