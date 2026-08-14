<script setup lang="ts">
import { computed } from 'vue'
import { fullName } from '@/lib/roles'
import { getVisitStatusMeta } from '@/lib/visit-status'
import { sortVisitsByPatientNewestFirst } from '@/lib/patient-sort'
import { useAppI18n } from '@/i18n/useAppI18n'
import { translateTemplate } from '@/lib/dashboard-i18n'
import '@/assets/simple-table.css'

type Patient = {
  id: string
  code: string
  firstName: string
  lastName: string
  phone?: string
  createdAt?: string
}

export type VisitRow = {
  id: string
  status: string
  updatedAt: string
  patient: Patient
  assignedDoctor?: { firstName: string; lastName: string } | null
}

const props = defineProps<{
  visits: VisitRow[]
  loading?: boolean
  fill?: boolean
}>()

const { uiText } = useAppI18n()

function formatSince(iso: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000))
  if (minutes < 1) return uiText("À l'instant")
  if (minutes < 60) return translateTemplate('{n} min', { n: minutes })
  const hours = Math.floor(minutes / 60)
  return translateTemplate('{h} h {m} min', { h: hours, m: minutes % 60 })
}

const rows = computed(() =>
  sortVisitsByPatientNewestFirst(props.visits).map((v) => {
    const meta = getVisitStatusMeta(v.status)
    return {
      id: v.id,
      code: v.patient.code,
      patientName: fullName(v.patient.firstName, v.patient.lastName),
      patientPhone: v.patient.phone || '',
      statusLabel: uiText(meta.label),
      statusVariant: meta.variant,
      pole: uiText(meta.pole),
      doctor: v.assignedDoctor
        ? fullName(v.assignedDoctor.firstName, v.assignedDoctor.lastName)
        : '—',
      duration: formatSince(v.updatedAt),
    }
  }),
)
</script>

<template>
  <div class="simple-table-shell" :class="{ 'simple-table-shell--fill': fill }">
    <div v-if="loading" class="simple-table-overlay" role="status" aria-live="polite">
      <span class="simple-table-spinner" aria-hidden="true" />
      Chargement…
    </div>
    <div class="simple-table-scroll">
      <p v-if="!loading && !rows.length" class="simple-table__empty">Aucune visite</p>
      <div v-else class="simple-table-wrap">
        <table class="simple-table">
          <thead>
            <tr>
              <th class="simple-table__num">#</th>
              <th>Matricule</th>
              <th>Patient</th>
              <th>État</th>
              <th>Pôle</th>
              <th>Médecin</th>
              <th>Durée</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, index) in rows" :key="row.id">
              <td class="simple-table__num">{{ index + 1 }}</td>
              <td><span class="st-badge">{{ row.code }}</span></td>
              <td>
                <span class="st-name">{{ row.patientName }}</span>
                <span v-if="row.patientPhone" class="st-sub">{{ row.patientPhone }}</span>
              </td>
              <td>
                <span class="st-badge" :class="`st-badge--${row.statusVariant}`">{{ row.statusLabel }}</span>
              </td>
              <td>{{ row.pole }}</td>
              <td>
                <span v-if="row.doctor !== '—'" class="st-name">{{ row.doctor }}</span>
                <span v-else class="st-muted">—</span>
              </td>
              <td><span class="st-date">{{ row.duration }}</span></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
