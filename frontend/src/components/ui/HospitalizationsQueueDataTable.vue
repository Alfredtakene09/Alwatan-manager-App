<script setup lang="ts">
import { computed } from 'vue'
import { Eye, Pencil, BedDouble, Calendar, Printer, Trash2, Banknote } from '@lucide/vue'
import { formatFcfa, fullName } from '@/lib/roles'
import {
  HOSPITALIZATION_STATUS_LABELS,
  hospitalizationStayDays,
} from '@/lib/hospitalization-admission'
import { useAppI18n } from '@/i18n/useAppI18n'
import '@/assets/simple-table.css'

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
  paidAt?: string | Date | null
  paidFcfa?: number
  depositFcfa?: number
  visit: {
    id: string
    patient: { code: string; firstName: string; lastName: string; phone?: string | null; service?: string | null }
    consultation?: {
      doctor?: { firstName: string; lastName: string } | null
    } | null
    assignedDoctor?: { firstName: string; lastName: string } | null
  }
  room?: { name: string; type?: string } | null
}

const props = withDefaults(
  defineProps<{
    items: HospitalizationQueueItem[]
    loading?: boolean
    fill?: boolean
    focusedVisitId?: string | null
    canDelete?: boolean
  }>(),
  { canDelete: true },
)

const emit = defineEmits<{
  admit: [id: string]
  view: [id: string]
  edit: [id: string]
  discharge: [id: string]
  print: [id: string]
  delete: [id: string]
  collect: [id: string]
}>()

const { uiText, localeCode, dateText } = useAppI18n()

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

function roomTypeLabel(item: HospitalizationQueueItem) {
  const type = item.room?.type ?? item.roomType
  if (type === 'VIP') return 'VIP'
  if (type === 'SIMPLE') return uiText('Simple')
  return '—'
}

const headers = computed(() => {
  void localeCode.value
  return {
    code: uiText('Matricule'),
    patient: uiText('Patient'),
    doctor: uiText('Médecin'),
    roomType: uiText('Chambre'),
    days: uiText('Jours'),
    status: uiText('Statut'),
    entry: uiText('Entrée'),
    exit: uiText('Sortie'),
    amount: uiText('Montant'),
    actions: uiText('Actions'),
    loading: uiText('Chargement des hospitalisations…'),
    empty: uiText('Aucune hospitalisation à afficher'),
  }
})

const rows = computed(() => {
  void localeCode.value
  return [...props.items]
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
      const startLabel = item.startDate ? dateText(item.startDate) : '—'
      const endLabel = item.endDate ? dateText(item.endDate) : '—'
      const amountLabel =
        item.totalDueFcfa && item.totalDueFcfa > 0
          ? formatFcfa(item.totalDueFcfa)
          : item.dailyRateFcfa
            ? `${formatFcfa(item.dailyRateFcfa)}/${uiText('nuit')}`
            : '—'

      const due = item.totalDueFcfa ?? 0
      const received = Math.max(0, item.paidFcfa ?? item.depositFcfa ?? 0)
      const unfinished = item.status !== 'DISCHARGED' && item.status !== 'CANCELLED'
      const unpaid = unfinished && due > received && Boolean(item.startDate)
      const statusFr = unpaid
        ? 'En attente de paiement'
        : (HOSPITALIZATION_STATUS_LABELS[item.status] ?? item.status)

      return {
        id: item.id,
        visitId: item.visit.id,
        focused: item.visit.id === props.focusedVisitId,
        code: item.visit.patient.code,
        patientName: fullName(item.visit.patient.firstName, item.visit.patient.lastName),
        patientPhone: item.visit.patient.phone || '',
        patientService: item.visit.patient.service?.trim() || '—',
        doctorName: doctorName(item),
        roomTypeLabel: roomTypeLabel(item),
        status: item.status,
        statusTone: unpaid ? 'warning' : statusTone(item.status),
        statusLabel: uiText(statusFr),
        startLabel,
        endLabel,
        amountLabel,
        daysLabel: (() => {
          const days = hospitalizationStayDays(item)
          return days > 0 ? uiText('{n} jour(s)').replace('{n}', String(days)) : '—'
        })(),
        needsAdmission: item.status === 'REQUESTED' || (item.status === 'RESERVED' && !hasRoom),
        canView: true,
        canEdit: hasRoom && Boolean(item.startDate) && item.status !== 'DISCHARGED',
        canDischarge: item.status === 'ACTIVE' && hasRoom,
        canCollect: unpaid,
        canReprint:
          Boolean(item.startDate) &&
          item.status !== 'REQUESTED' &&
          item.status !== 'CANCELLED',
      }
    })
})
</script>

<template>
  <div
    class="simple-table-shell"
    :class="{ 'simple-table-shell--fill': fill }"
  >
    <div
      v-if="loading"
      class="simple-table-overlay" role="status"
      aria-live="polite"
    >
      <span class="simple-table-spinner" aria-hidden="true" />
      {{ headers.loading }}
    </div>

    <div class="simple-table-scroll">
      <p v-if="!loading && !rows.length" class="simple-table__empty">
        {{ headers.empty }}
      </p>
      <div v-else class="simple-table-wrap">
        <table class="simple-table">
          <thead>
            <tr>
              <th class="simple-table__num">#</th>
              <th>{{ headers.code }}</th>
              <th>{{ headers.patient }}</th>
              <th>{{ headers.doctor }}</th>
              <th>{{ headers.roomType }}</th>
              <th>{{ headers.days }}</th>
              <th>{{ headers.status }}</th>
              <th>{{ headers.entry }}</th>
              <th>{{ headers.exit }}</th>
              <th>{{ headers.amount }}</th>
              <th class="simple-table__actions-head">{{ headers.actions }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, index) in rows" :key="row.id" :data-visit-id="row.visitId">
              <td class="simple-table__num">{{ index + 1 }}</td>
              <td>
                <span class="st-badge">{{ row.code }}</span>
              </td>
              <td>
                <span class="st-name" :class="{ 'st-name--focus': row.focused }">{{ row.patientName }}</span>
                <span class="st-sub">{{ row.patientService }}</span>
                <span v-if="row.patientPhone" class="st-sub">{{ row.patientPhone }}</span>
              </td>
              <td>
                <span class="st-sub">{{ row.doctorName }}</span>
              </td>
              <td>
                <span class="st-badge st-badge--default">{{ row.roomTypeLabel }}</span>
              </td>
              <td>
                <span class="st-name">{{ row.daysLabel }}</span>
              </td>
              <td>
                <span class="st-badge" :class="`st-badge--${row.statusTone}`">{{ row.statusLabel }}</span>
              </td>
              <td>
                <span class="st-date">{{ row.startLabel }}</span>
              </td>
              <td>
                <span class="st-date">{{ row.endLabel }}</span>
              </td>
              <td>
                <span class="st-name">{{ row.amountLabel }}</span>
              </td>
              <td class="simple-table__actions">
                <div class="st-actions">
                  <button
                    v-if="row.canView"
                    type="button"
                    class="st-btn"
                    :title="uiText('Voir le profil')"
                    :aria-label="uiText('Voir')"
                    @click="emit('view', row.id)"
                  >
                    <Eye :size="15" />
                  </button>
                  <button
                    v-if="row.canCollect"
                    type="button"
                    class="st-btn st-btn--pay"
                    :title="uiText('Acompte (hors solde)')"
                    :aria-label="uiText('Acompte (hors solde)')"
                    @click="emit('collect', row.id)"
                  >
                    <Banknote :size="15" />
                  </button>
                  <button
                    v-if="row.canReprint"
                    type="button"
                    class="st-btn st-btn--accent"
                    :title="uiText('Réimprimer le reçu')"
                    :aria-label="uiText('Réimprimer le reçu')"
                    @click="emit('print', row.id)"
                  >
                    <Printer :size="15" />
                  </button>
                  <button
                    v-if="row.canEdit"
                    type="button"
                    class="st-btn st-btn--edit"
                    :title="uiText('Modifier la date de sortie')"
                    :aria-label="uiText('Modifier la date de sortie')"
                    @click="emit('edit', row.id)"
                  >
                    <Pencil :size="15" />
                  </button>
                  <button
                    v-if="row.needsAdmission"
                    type="button"
                    class="st-btn st-btn--hosp"
                    :title="uiText('Programmer l\'admission')"
                    :aria-label="uiText('Programmer')"
                    @click="emit('admit', row.id)"
                  >
                    <BedDouble :size="15" />
                  </button>
                  <button
                    v-if="row.canDischarge"
                    type="button"
                    class="st-btn st-btn--accent"
                    :title="uiText('Clôturer la sortie')"
                    :aria-label="uiText('Clôturer')"
                    @click="emit('discharge', row.id)"
                  >
                    <Calendar :size="15" />
                  </button>
                  <button
                    v-if="canDelete"
                    type="button"
                    class="st-btn st-btn--delete"
                    :title="uiText('Supprimer l\'hospitalisation')"
                    :aria-label="uiText('Supprimer')"
                    @click="emit('delete', row.id)"
                  >
                    <Trash2 :size="15" />
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
