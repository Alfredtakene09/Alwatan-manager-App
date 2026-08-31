<script setup lang="ts">
import { computed } from 'vue'
import { Eye, ArrowLeftRight } from '@lucide/vue'
import { fullName } from '@/lib/roles'
import {
  formatPrescribedExamsPreview,
  formatPrescribedExamsSummary,
  countPrescribedExams,
} from '@/lib/lab-notes'
import { sortByCreatedAtNewestFirst } from '@/lib/patient-sort'
import { useAppI18n } from '@/i18n/useAppI18n'
import '@/assets/simple-table.css'

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
  assignedClinicService?: { id: string; name: string } | null
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
    diagnosis?: string | null
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
  transfer: [id: string]
}>()

const { uiText, localeCode, dateText, timeText } = useAppI18n()

const rows = computed(() => {
  void localeCode.value
  return sortByCreatedAtNewestFirst(props.visits).map((v) => {
    const consultedAt = new Date(v.consultation?.updatedAt ?? v.updatedAt)
    const notes = v.consultation?.clinicalNotes
    const examsFull = formatPrescribedExamsSummary(notes)
    const exams = formatPrescribedExamsPreview(notes)
    const examCount = countPrescribedExams(notes)
    const closed = v.status === 'COMPLETED'
    return {
      id: v.id,
      code: v.patient.code,
      patientName: fullName(v.patient.firstName, v.patient.lastName),
      patientPhone: v.patient.phone || '',
      exams,
      examsFull,
      examCount,
      consultedDate: dateText(consultedAt),
      consultedTime: timeText(consultedAt, { hour: '2-digit', minute: '2-digit' }),
      statusLabel: uiText(closed ? 'Clôturé' : 'En attente paiement'),
      statusVariant: closed ? 'success' : 'warning',
    }
  })
})
</script>

<template>
  <div class="simple-table-shell" :class="{ 'simple-table-shell--fill': fill }">
    <div v-if="loading" class="simple-table-overlay" role="status" aria-live="polite">
      <span class="simple-table-spinner" aria-hidden="true" />
      {{ uiText('Chargement des patients consultés…') }}
    </div>
    <div class="simple-table-scroll">
      <p v-if="!loading && !rows.length" class="simple-table__empty">
        {{ uiText('Aucun patient consulté') }}
      </p>
      <div v-else class="simple-table-wrap">
        <table class="simple-table">
          <thead>
            <tr>
              <th class="simple-table__num">#</th>
              <th>{{ uiText('Matricule') }}</th>
              <th>{{ uiText('Patient') }}</th>
              <th>{{ uiText('Examens prescrits') }}</th>
              <th>{{ uiText('Consulté le') }}</th>
              <th>{{ uiText('Statut') }}</th>
              <th class="simple-table__actions-head">{{ uiText('Actions') }}</th>
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
                <span
                  class="st-exam-preview"
                  :title="row.examsFull !== row.exams && row.examsFull !== '—' ? row.examsFull : undefined"
                >
                  <span v-if="row.examCount > 0" class="st-exam-count">{{ row.examCount }}</span>
                  <span class="st-sub st-sub--truncate">{{ row.exams }}</span>
                </span>
              </td>
              <td>
                <span class="st-date">{{ row.consultedDate }}</span>
                <span class="st-sub">{{ row.consultedTime }}</span>
              </td>
              <td>
                <span class="st-badge" :class="`st-badge--${row.statusVariant}`">{{ row.statusLabel }}</span>
              </td>
              <td class="simple-table__actions">
                <div class="st-actions st-actions--wrap">
                  <button
                    type="button"
                    class="st-btn st-btn--accent"
                    :title="uiText('Voir')"
                    :aria-label="uiText('Voir')"
                    @click="emit('view', row.id)"
                  >
                    <Eye :size="15" />
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
