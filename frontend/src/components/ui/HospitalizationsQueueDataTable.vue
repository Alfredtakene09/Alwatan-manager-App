<script setup lang="ts">
import { computed } from 'vue'
import { Eye, Pencil, BedDouble, Calendar } from '@lucide/vue'
import { formatFcfa, fullName } from '@/lib/roles'
import { HOSPITALIZATION_STATUS_LABELS } from '@/lib/hospitalization-admission'
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

const rows = computed(() =>
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
        patientService: item.visit.patient.service?.trim() || '—',
        doctorName: doctorName(item),
        roomLabel: roomLabel(item),
        roomTypeLabel: roomTypeLabel(item),
        status: item.status,
        statusTone: statusTone(item.status),
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
      Chargement des hospitalisations…
    </div>

    <div class="simple-table-scroll">
      <p v-if="!loading && !rows.length" class="simple-table__empty">
        Aucune hospitalisation à afficher
      </p>
      <div v-else class="simple-table-wrap">
        <table class="simple-table">
          <thead>
            <tr>
              <th class="simple-table__num">#</th>
              <th>Matricule</th>
              <th>Patient</th>
              <th>Médecin</th>
              <th>Chambre</th>
              <th>Salle</th>
              <th>Statut</th>
              <th>Entrée</th>
              <th>Sortie</th>
              <th>Montant</th>
              <th class="simple-table__actions-head">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, index) in rows" :key="row.id">
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
                <span class="st-sub">{{ row.roomLabel }}</span>
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
                <span class="st-sub">{{ row.nightsLabel }}</span>
              </td>
              <td class="simple-table__actions">
                <div class="st-actions">
                  <button
                    v-if="row.canView"
                    type="button"
                    class="st-btn"
                    title="Voir le profil"
                    aria-label="Voir"
                    @click="emit('view', row.id)"
                  >
                    <Eye :size="15" />
                  </button>
                  <button
                    v-if="row.canEdit"
                    type="button"
                    class="st-btn st-btn--edit"
                    title="Modifier le séjour"
                    aria-label="Modifier"
                    @click="emit('edit', row.id)"
                  >
                    <Pencil :size="15" />
                  </button>
                  <button
                    v-if="row.needsAdmission"
                    type="button"
                    class="st-btn st-btn--hosp"
                    title="Programmer l'admission"
                    aria-label="Programmer"
                    @click="emit('admit', row.id)"
                  >
                    <BedDouble :size="15" />
                  </button>
                  <button
                    v-if="row.canDischarge"
                    type="button"
                    class="st-btn st-btn--accent"
                    title="Clôturer la sortie"
                    aria-label="Clôturer"
                    @click="emit('discharge', row.id)"
                  >
                    <Calendar :size="15" />
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
