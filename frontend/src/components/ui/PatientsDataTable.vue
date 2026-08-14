<script setup lang="ts">
import { computed } from 'vue'
import { Pencil, RefreshCw, Trash2 } from '@lucide/vue'
import { fullName } from '@/lib/roles'
import { sortPatientsNewestFirst } from '@/lib/patient-sort'
import { useAppI18n } from '@/i18n/useAppI18n'
import '@/assets/simple-table.css'

export type PatientRow = {
  id: string
  code: string
  firstName: string
  lastName: string
  phone?: string
  service?: string | null
  gender?: string
  createdAt?: string
  /** false = déjà envoyé / consulté (ou données liées) — pas de bouton supprimer */
  canDelete?: boolean
  createdBy?: { id: string; firstName: string; lastName: string } | null
}

const props = withDefaults(
  defineProps<{
    patients: PatientRow[]
    loading?: boolean
    fill?: boolean
    showDelete?: boolean
    showReceptionist?: boolean
  }>(),
  { showDelete: true, showReceptionist: false },
)

const emit = defineEmits<{
  edit: [patient: PatientRow]
  reconsult: [patient: PatientRow]
  delete: [patient: PatientRow]
}>()

const { uiText } = useAppI18n()

const rows = computed(() =>
  sortPatientsNewestFirst(props.patients).map((p) => ({
    patient: p,
    code: p.code,
    fullName: fullName(p.firstName, p.lastName),
    service: p.service?.trim() || '',
    phone: p.phone || '',
    gender: p.gender,
    createdAt: formatDate(p.createdAt),
    receptionistName: p.createdBy
      ? fullName(p.createdBy.firstName, p.createdBy.lastName)
      : '',
    canDelete: props.showDelete && p.canDelete !== false,
  })),
)

function formatDate(iso?: string) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

function genderLabel(gender?: string) {
  if (gender === 'F') return uiText('Féminin')
  if (gender === 'M') return uiText('Masculin')
  return '—'
}

function genderClass(gender?: string) {
  if (gender === 'F') return 'st-pill st-pill--f'
  if (gender === 'M') return 'st-pill st-pill--m'
  return 'st-pill st-pill--na'
}
</script>

<template>
  <div
    class="simple-table-shell"
    :class="{
      'simple-table-shell--fill': fill,
    }"
  >
    <div
      v-if="loading"
      class="simple-table-overlay" role="status"
      aria-live="polite"
    >
      <span class="simple-table-spinner" aria-hidden="true" />
      Chargement des dossiers…
    </div>

    <div class="simple-table-scroll">
      <p v-if="!loading && !rows.length" class="simple-table__empty">
        Aucun patient à afficher
      </p>
      <div v-else class="simple-table-wrap">
        <table class="simple-table">
          <thead>
            <tr>
              <th class="simple-table__num">#</th>
              <th>Matricule</th>
              <th>Nom complet</th>
              <th>Service</th>
              <th>Téléphone</th>
              <th>Genre</th>
              <th>Date d'inscription</th>
              <th v-if="showReceptionist">Réceptionniste</th>
              <th class="simple-table__actions-head">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, index) in rows" :key="row.patient.id">
              <td class="simple-table__num">{{ index + 1 }}</td>
              <td>
                <span class="st-badge">{{ row.code }}</span>
              </td>
              <td>
                <span class="st-name">{{ row.fullName }}</span>
              </td>
              <td>
                <span v-if="row.service" class="st-date">{{ row.service }}</span>
                <span v-else class="st-muted">—</span>
              </td>
              <td>
                <a
                  v-if="row.phone"
                  class="st-phone"
                  :href="`tel:${row.phone}`"
                >{{ row.phone }}</a>
                <span v-else class="st-muted">—</span>
              </td>
              <td>
                <span :class="genderClass(row.gender)">{{ genderLabel(row.gender) }}</span>
              </td>
              <td>
                <span class="st-date">{{ row.createdAt }}</span>
              </td>
              <td v-if="showReceptionist">
                <span v-if="row.receptionistName" class="st-date">{{ row.receptionistName }}</span>
                <span v-else class="st-muted">—</span>
              </td>
              <td class="simple-table__actions">
                <div class="st-actions">
                  <button
                    type="button"
                    class="st-btn st-btn--edit"
                    title="Modifier le dossier"
                    aria-label="Modifier le dossier"
                    @click="emit('edit', row.patient)"
                  >
                    <Pencil :size="15" />
                  </button>
                  <button
                    type="button"
                    class="st-btn st-btn--accent"
                    title="Reconsultation"
                    aria-label="Reconsultation"
                    @click="emit('reconsult', row.patient)"
                  >
                    <RefreshCw :size="15" />
                  </button>
                  <template v-if="row.canDelete">
                    <span class="st-sep" aria-hidden="true" />
                    <button
                      type="button"
                      class="st-btn st-btn--delete"
                      title="Supprimer le dossier"
                      aria-label="Supprimer le dossier"
                      @click="emit('delete', row.patient)"
                    >
                      <Trash2 :size="15" />
                    </button>
                  </template>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
