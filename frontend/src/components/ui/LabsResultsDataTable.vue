<script setup lang="ts">
import { computed } from 'vue'
import { Eye, Plus, Printer } from '@lucide/vue'
import { fullName } from '@/lib/roles'
import {
  formatLabPrescribedExamsPreview,
  formatLabPrescribedExamsSummary,
  countLabPrescribedExams,
  parseLatestLabResultAt,
} from '@/lib/lab-notes'
import { formatAppDate, formatAppTime } from '@/i18n/locale-format'
import { useAppI18n } from '@/i18n/useAppI18n'
import type { PrescribedByPerson } from '@/lib/lab-panel-print'
import '@/assets/simple-table.css'

export type LabsResultsVisitRow = {
  id: string
  createdAt: string
  updatedAt: string
  patient: {
    id?: string
    firstName: string
    lastName: string
    code: string
    phone?: string | null
    category?: string
    createdBy?: PrescribedByPerson | null
  }
  assignedDoctor?: PrescribedByPerson | null
  invoices?: Array<{
    issuedBy?: PrescribedByPerson | null
  }>
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
    doctor?: PrescribedByPerson | null
    labApprovedBy?: PrescribedByPerson | null
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

const { uiText } = useAppI18n()

const rows = computed(() =>
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
        resultDate: formatAppDate(updatedAt),
        resultTime: formatAppTime(updatedAt),
        resultSort: updatedAt.getTime(),
      }
    })
    .sort((a, b) => b.resultSort - a.resultSort),
)
</script>

<template>
  <div class="simple-table-shell" :class="{ 'simple-table-shell--fill': fill }">
    <div v-if="loading" class="simple-table-overlay" role="status" aria-live="polite">
      <span class="simple-table-spinner" aria-hidden="true" />
      {{ uiText('Chargement des résultats…') }}
    </div>

    <div class="simple-table-scroll">
      <p v-if="!loading && !rows.length" class="simple-table__empty">
        {{ uiText('Aucun résultat à afficher') }}
      </p>
      <div v-else class="simple-table-wrap">
        <table class="simple-table">
          <thead>
            <tr>
              <th class="simple-table__num">#</th>
              <th>{{ uiText('Matricule') }}</th>
              <th>{{ uiText('Patient') }}</th>
              <th class="simple-table__exam">{{ uiText('Examens') }}</th>
              <th>{{ uiText('Résultats reçus') }}</th>
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
              <td>
                <span class="st-badge">{{ row.code }}</span>
              </td>
              <td>
                <span class="st-name">{{ row.patientName }}</span>
                <span v-if="row.patientPhone" class="st-sub">{{ row.patientPhone }}</span>
              </td>
              <td class="simple-table__exam">
                <span
                  class="st-exam-preview"
                  :title="
                    row.examsFull !== row.exams && row.examsFull !== '—'
                      ? row.examsFull
                      : undefined
                  "
                >
                  <span v-if="row.examCount > 0" class="st-exam-count">{{ row.examCount }}</span>
                  <span class="st-sub st-sub--truncate">{{ row.exams }}</span>
                </span>
              </td>
              <td>
                <span class="st-date">{{ row.resultDate }}</span>
                <span class="st-sub">{{ row.resultTime }}</span>
              </td>
              <td class="simple-table__actions">
                <div class="st-actions st-actions--wrap">
                  <button
                    type="button"
                    class="st-btn st-btn--accent"
                    :title="uiText('Voir les résultats')"
                    :aria-label="uiText('Voir les résultats')"
                    @click="emit('view', row.id)"
                  >
                    <Eye :size="15" />
                  </button>
                  <button
                    type="button"
                    class="st-btn st-btn--soft"
                    :title="uiText('Imprimer les résultats')"
                    :aria-label="uiText('Imprimer les résultats')"
                    @click="emit('print', row.id)"
                  >
                    <Printer :size="15" />
                  </button>
                  <button
                    type="button"
                    class="st-btn st-btn--accent st-btn--labeled"
                    :title="uiText('Ajouter des examens')"
                    :aria-label="uiText('Ajouter des examens')"
                    @click="emit('append', row.id)"
                  >
                    <Plus :size="15" />
                    <span>{{ uiText('Ajouter') }}</span>
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
