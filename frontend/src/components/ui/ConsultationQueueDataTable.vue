<script setup lang="ts">
import { computed } from 'vue'
import { Eye, ArrowLeftRight } from '@lucide/vue'
import { fullName } from '@/lib/roles'
import { getVisitStatusMeta } from '@/lib/visit-status'
import { sortByCreatedAtNewestFirst } from '@/lib/patient-sort'
import { useAppI18n } from '@/i18n/useAppI18n'
import '@/assets/simple-table.css'

export type ConsultationVisitRow = {
  id: string
  status: string
  createdAt: string
  notes?: string | null
  patient: {
    id?: string
    firstName: string
    lastName: string
    code: string
    phone?: string | null
  }
  assignedDoctor?: { id: string; firstName: string; lastName: string } | null
  vitalSigns?: Array<{
    weightKg?: number | null
    bloodPressure?: string | null
    temperatureC?: number | null
    pulseBpm?: number | null
    recordedAt: string
  }>
  billing?: {
    consultationFeeFcfa: number
    reductionFcfa: number
    totalFcfa: number
  }
  consultation?: {
    clinicalNotes?: string | null
    doctorComment?: string | null
    diagnosis?: string | null
    labSentToLabAt?: string | null
  } | null
}

const props = defineProps<{
  visits: ConsultationVisitRow[]
  selectedId?: string | null
  loading?: boolean
  readOnly?: boolean
}>()

const emit = defineEmits<{
  consult: [id: string]
  transfer: [id: string]
}>()

const { uiText, localeCode, dateText, timeText } = useAppI18n()

const rows = computed(() => {
  void localeCode.value
  return sortByCreatedAtNewestFirst(props.visits).map((v) => {
    const meta = getVisitStatusMeta(v.status)
    const arrival = new Date(v.createdAt)
    return {
      id: v.id,
      code: v.patient.code,
      patientName: fullName(v.patient.firstName, v.patient.lastName),
      patientPhone: v.patient.phone || '',
      statusLabel: uiText(meta.label),
      statusVariant: meta.variant,
      arrivalDate: dateText(arrival),
      arrivalTime: timeText(arrival, { hour: '2-digit', minute: '2-digit' }),
      doctorName: v.assignedDoctor
        ? `Dr ${fullName(v.assignedDoctor.firstName, v.assignedDoctor.lastName)}`
        : uiText('Non assigné'),
    }
  })
})
</script>

<template>
  <div class="simple-table-shell">
    <div v-if="loading" class="simple-table-overlay" role="status" aria-live="polite">
      <span class="simple-table-spinner" aria-hidden="true" />
      Chargement de la file…
    </div>
    <div class="simple-table-scroll">
      <p v-if="!loading && !rows.length" class="simple-table__empty">Aucune visite en file</p>
      <div v-else class="simple-table-wrap">
        <table class="simple-table">
          <thead>
            <tr>
              <th class="simple-table__num">#</th>
              <th>Matricule</th>
              <th>Patient</th>
              <th>Statut</th>
              <th>Arrivée</th>
              <th v-if="readOnly">Médecin assigné</th>
              <th v-else class="simple-table__actions-head">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(row, index) in rows"
              :key="row.id"
              :class="{ 'st-row--selected': row.id === selectedId }"
            >
              <td class="simple-table__num">{{ index + 1 }}</td>
              <td><span class="st-badge">{{ row.code }}</span></td>
              <td>
                <span class="st-name">{{ row.patientName }}</span>
                <span v-if="row.patientPhone" class="st-sub">{{ row.patientPhone }}</span>
              </td>
              <td>
                <span class="st-badge" :class="`st-badge--${row.statusVariant}`">{{ row.statusLabel }}</span>
              </td>
              <td>
                <span class="st-date">{{ row.arrivalDate }}</span>
                <span class="st-sub">{{ row.arrivalTime }}</span>
              </td>
              <td v-if="readOnly">
                <span class="st-date">{{ row.doctorName }}</span>
              </td>
              <td v-else class="simple-table__actions">
                <div class="st-actions st-actions--wrap">
                  <button
                    type="button"
                    class="st-btn st-btn--text st-btn--accent"
                    :title="uiText('Consulter')"
                    :aria-label="uiText('Consulter')"
                    @click="emit('consult', row.id)"
                  >
                    <Eye :size="15" />
                    {{ uiText('Consulter') }}
                  </button>
                  <button
                    type="button"
                    class="st-btn st-btn--text"
                    :title="uiText('Transférer')"
                    :aria-label="uiText('Transférer')"
                    @click="emit('transfer', row.id)"
                  >
                    <ArrowLeftRight :size="15" />
                    {{ uiText('Transférer') }}
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
