<script setup lang="ts">
import { computed } from 'vue'
import { Pencil, Plus, Printer } from '@lucide/vue'
import { fullName } from '@/lib/roles'
import {
  formatPrescribedExamsSummary,
  formatPrescribedExamsPreview,
  formatLabPrescribedExamsPreview,
  formatLabPrescribedExamsSummary,
  countLabPrescribedExams,
  countPrescribedExams,
  parseLabResultsCompletedAt,
} from '@/lib/lab-notes'
import { sortByCreatedAtNewestFirst } from '@/lib/patient-sort'
import { formatAppDate, formatAppTime } from '@/i18n/locale-format'
import { useAppI18n } from '@/i18n/useAppI18n'
import type { PrescribedByPerson } from '@/lib/lab-panel-print'
import '@/assets/simple-table.css'

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
    createdBy?: PrescribedByPerson | null
  }
  assignedDoctor?: PrescribedByPerson | null
  invoices?: Array<{
    invoiceNumber: string
    amountFcfa: number
    type: string
    createdAt: string
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
    id?: string
    clinicalNotes?: string | null
    labSentToLabAt?: string | null
    labExamReductionFcfa?: number
    labApprovedBy?: PrescribedByPerson | null
    doctor?: PrescribedByPerson | null
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

const { uiText } = useAppI18n()

const showActions = computed(() => props.actionsMode !== 'none')
const isCompletedLayout = computed(() => props.actionsMode === 'lab-completed')
const dateColumnTitle = computed(() =>
  props.dateMode === 'completed' ? 'Terminé le' : 'Transféré le',
)
const loadingLabel = computed(() =>
  props.dateMode === 'completed'
    ? 'Chargement des examens terminés…'
    : 'Chargement des analyses en cours…',
)

const rows = computed(() =>
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
      props.examsSummaryMode === 'lab'
        ? formatLabPrescribedExamsSummary(notes)
        : formatPrescribedExamsSummary(notes)
    const exams =
      props.examsSummaryMode === 'lab'
        ? formatLabPrescribedExamsPreview(notes)
        : formatPrescribedExamsPreview(notes)
    const examCount =
      props.examsSummaryMode === 'lab'
        ? countLabPrescribedExams(notes)
        : countPrescribedExams(notes)
    const doctor = v.consultation?.doctor ?? v.assignedDoctor
    return {
      id: v.id,
      code: v.patient.code,
      patientName: fullName(v.patient.firstName, v.patient.lastName),
      patientPhone: v.patient.phone || '',
      doctorName: doctor ? `Dr ${fullName(doctor.firstName, doctor.lastName)}` : '—',
      exams,
      examsFull,
      examCount,
      eventDate: formatAppDate(eventAt),
      eventTime: formatAppTime(eventAt),
    }
  }),
)
</script>

<template>
  <div
    class="simple-table-shell"
    :class="{ 'simple-table-shell--fill': fill }"
    :data-table-key="tableKey"
  >
    <div v-if="loading" class="simple-table-overlay" role="status" aria-live="polite">
      <span class="simple-table-spinner" aria-hidden="true" />
      {{ loadingLabel }}
    </div>

    <div class="simple-table-scroll">
      <p v-if="!loading && !rows.length" class="simple-table__empty">Aucun examen à afficher</p>
      <div v-else class="simple-table-wrap">
        <table class="simple-table">
          <thead>
            <tr>
              <th class="simple-table__num">#</th>
              <th>Matricule</th>
              <th>Patient</th>
              <th>Médecin</th>
              <template v-if="isCompletedLayout">
                <th>{{ dateColumnTitle }}</th>
                <th>Examens</th>
              </template>
              <template v-else>
                <th>Examens</th>
                <th>{{ dateColumnTitle }}</th>
              </template>
              <th v-if="showActions" class="simple-table__actions-head">Actions</th>
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
              <td>
                <span v-if="row.doctorName !== '—'" class="st-name">{{ row.doctorName }}</span>
                <span v-else class="st-muted">—</span>
              </td>

              <template v-if="isCompletedLayout">
                <td>
                  <span class="st-date">{{ row.eventDate }}</span>
                  <span class="st-sub">{{ row.eventTime }}</span>
                </td>
                <td>
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
              </template>
              <template v-else>
                <td>
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
                  <span class="st-date">{{ row.eventDate }}</span>
                  <span class="st-sub">{{ row.eventTime }}</span>
                </td>
              </template>

              <td v-if="showActions" class="simple-table__actions">
                <div class="st-actions st-actions--wrap">
                  <button
                    v-if="actionsMode === 'lab'"
                    type="button"
                    class="st-btn st-btn--text st-btn--accent"
                    :title="uiText('Saisir les résultats')"
                    :aria-label="uiText('Saisir les résultats')"
                    @click="emit('saisir', row.id)"
                  >
                    <Pencil :size="15" />
                    {{ uiText('Saisir') }}
                  </button>

                  <template v-else-if="actionsMode === 'lab-completed'">
                    <button
                      type="button"
                      class="st-btn st-btn--text st-btn--accent"
                      :title="uiText('Resaisir les résultats')"
                      :aria-label="uiText('Resaisir les résultats')"
                      @click="emit('modify', row.id)"
                    >
                      <Pencil :size="15" />
                      {{ uiText('Resaisir') }}
                    </button>
                    <button
                      type="button"
                      class="st-btn st-btn--text"
                      :title="uiText('Imprimer')"
                      :aria-label="uiText('Imprimer')"
                      @click="emit('print', row.id)"
                    >
                      <Printer :size="15" />
                      {{ uiText('Imprimer') }}
                    </button>
                  </template>

                  <button
                    v-else
                    type="button"
                    class="st-btn st-btn--text st-btn--accent"
                    title="Ajouter des examens"
                    aria-label="Ajouter des examens"
                    @click="emit('append', row.id)"
                  >
                    <Plus :size="15" />
                    Ajouter
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
