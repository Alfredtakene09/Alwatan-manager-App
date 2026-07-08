<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ClipboardList, Eye, Plus, Printer, RefreshCw } from '@lucide/vue'
import api from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { fetchAndPrintLabVisitResults } from '@/lib/lab-visit-print'
import { fullName } from '@/lib/roles'
import {
  countLabPrescribedExams,
  formatLabPrescribedExamsPreview,
  formatLabPrescribedExamsSummary,
  parseLatestLabResultAt,
} from '@/lib/lab-notes'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import MedecinStatsGrid from '@/components/MedecinStatsGrid.vue'
import MedecinPrescriptionModal, {
  type PrescriptionVisit,
} from '@/components/MedecinPrescriptionModal.vue'
import { type LabsResultsVisitRow } from '@/components/ui/LabsResultsDataTable.vue'
import '@/assets/lab-visit-table.css'

const router = useRouter()
const auth = useAuthStore()

const visits = ref<LabsResultsVisitRow[]>([])
const prescriptionVisit = ref<PrescriptionVisit | null>(null)
const loading = ref(false)
const statsRefreshKey = ref(0)
const message = ref('')
const messageType = ref<'success' | 'error'>('success')
const printError = ref('')
const printingVisitId = ref<string | null>(null)

const rows = computed(() =>
  visits.value
    .map((visit) => {
      const notes = visit.consultation?.clinicalNotes
      const resultAt =
        parseLatestLabResultAt(notes) ??
        new Date(visit.consultation?.updatedAt ?? visit.updatedAt)
      return {
        id: visit.id,
        code: visit.patient.code,
        patientName: fullName(visit.patient.firstName, visit.patient.lastName),
        patientPhone: visit.patient.phone || '',
        exams: formatLabPrescribedExamsPreview(notes),
        examsFull: formatLabPrescribedExamsSummary(notes),
        examCount: countLabPrescribedExams(notes),
        resultDate: resultAt.toLocaleDateString('fr-FR'),
        resultTime: resultAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
        resultSort: resultAt.getTime(),
      }
    })
    .sort((a, b) => b.resultSort - a.resultSort),
)

const POLL_MS = 30_000
let pollTimer: ReturnType<typeof setInterval> | null = null

async function loadVisits() {
  if (prescriptionVisit.value) return
  loading.value = true
  try {
    const { data } = await api.get('/consultations/labs-resultats')
    visits.value = data
  } finally {
    loading.value = false
    statsRefreshKey.value += 1
  }
}

function openAppendModal(id: string) {
  const visit = visits.value.find((v) => v.id === id)
  if (!visit) return
  prescriptionVisit.value = visit
  message.value = ''
}

function viewResults(visitId: string) {
  router.push({ name: 'medecin-labs-resultats-dossier', params: { visitId } })
}

async function printResults(visitId: string) {
  const visit = visits.value.find((v) => v.id === visitId)
  if (!visit) return

  printError.value = ''
  printingVisitId.value = visitId
  const result = await fetchAndPrintLabVisitResults(visit, auth.user, 'medecin')
  if (!result.ok) printError.value = result.error
  printingVisitId.value = null
}

function closePrescriptionModal() {
  prescriptionVisit.value = null
}

function onPrescriptionSaved() {
  message.value = 'Nouveaux examens ajoutés à la prescription.'
  messageType.value = 'success'
  loadVisits()
}

onMounted(() => {
  loadVisits()
  pollTimer = setInterval(loadVisits, POLL_MS)
})

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer)
})
</script>

<template>
  <div class="page-with-table page-with-table--medecin">
    <section class="page-with-table__head">
      <UiPageHeader
        title="Résultats de labos"
        subtitle="Consultation des résultats — prescription d'examens complémentaires possible"
        :icon="ClipboardList"
      />

      <UiAlert v-if="message" :type="messageType" :message="message" />
      <UiAlert v-if="printError" type="error" :message="printError" />

      <MedecinStatsGrid :refresh-key="statsRefreshKey" />
    </section>

    <section class="page-with-table__body">
      <UiCard
        title="Résultats disponibles"
        description="Œil : consulter · Imprimer : dossier complet · Bouton Ajouter : examens complémentaires"
        class="ui-card--table-panel"
        :icon="ClipboardList"
        icon-variant="teal"
      >
        <template #actions>
          <UiButton variant="ghost" size="sm" :icon="RefreshCw" :disabled="loading" @click="loadVisits">
            Actualiser
          </UiButton>
        </template>

        <p v-if="loading && !visits.length" class="empty">Chargement des résultats…</p>
        <p v-else-if="!loading && !visits.length" class="empty">
          Aucun résultat de laboratoire disponible pour le moment.
        </p>
        <div v-else class="lab-visit-table-wrap">
          <table class="lab-visit-table">
            <thead>
              <tr>
                <th class="lab-visit-table__num">#</th>
                <th>Matricule</th>
                <th>Patient</th>
                <th>Examens</th>
                <th>Résultats reçus</th>
                <th class="lab-visit-table__actions-head">Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(row, index) in rows"
                :key="row.id"
                :class="{ 'is-selected': prescriptionVisit?.id === row.id }"
              >
                <td class="lab-visit-table__num">{{ index + 1 }}</td>
                <td>
                  <span class="lab-visit-badge">{{ row.code }}</span>
                </td>
                <td>
                  <span class="lab-visit-name">{{ row.patientName }}</span>
                  <span v-if="row.patientPhone" class="lab-visit-sub">{{ row.patientPhone }}</span>
                </td>
                <td>
                  <span class="lab-visit-exams" :title="row.examsFull !== row.exams ? row.examsFull : ''">
                    <span v-if="row.examCount > 0" class="lab-visit-exam-count">{{ row.examCount }}</span>
                    <span class="lab-visit-sub lab-visit-sub--truncate">{{ row.exams }}</span>
                  </span>
                </td>
                <td>
                  <span class="lab-visit-date">{{ row.resultDate }}</span>
                  <span class="lab-visit-sub">{{ row.resultTime }}</span>
                </td>
                <td>
                  <div class="lab-visit-actions">
                    <button
                      type="button"
                      class="lab-visit-act lab-visit-act--icon lab-visit-act--accent"
                      title="Voir les résultats"
                      @click="viewResults(row.id)"
                    >
                      <Eye :size="15" />
                    </button>
                    <button
                      type="button"
                      class="lab-visit-act lab-visit-act--icon"
                      title="Imprimer les résultats"
                      :disabled="printingVisitId === row.id"
                      @click="printResults(row.id)"
                    >
                      <Printer :size="15" />
                    </button>
                    <button
                      type="button"
                      class="lab-visit-act lab-visit-act--labeled"
                      title="Ajouter des examens"
                      @click="openAppendModal(row.id)"
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
      </UiCard>
    </section>

    <MedecinPrescriptionModal
      :visit="prescriptionVisit"
      mode="append"
      @close="closePrescriptionModal"
      @saved="onPrescriptionSaved"
    />
  </div>
</template>

<style scoped>
.empty {
  text-align: center;
  color: var(--text-light);
  padding: 2rem 1rem;
  font-size: 0.875rem;
}
</style>
