<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ClipboardList, RefreshCw } from '@lucide/vue'
import api from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { fetchAndPrintLabVisitResults } from '@/lib/lab-visit-print'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import MedecinStatsGrid from '@/components/MedecinStatsGrid.vue'
import MedecinPrescriptionModal, {
  type PrescriptionVisit,
} from '@/components/MedecinPrescriptionModal.vue'
import LabsResultsDataTable, {
  type LabsResultsVisitRow,
} from '@/components/ui/LabsResultsDataTable.vue'

const router = useRouter()
const auth = useAuthStore()

const visits = ref<LabsResultsVisitRow[]>([])
const prescriptionVisit = ref<PrescriptionVisit | null>(null)
const loading = ref(false)
const statsRefreshKey = ref(0)
const message = ref('')
const messageType = ref<'success' | 'error'>('success')
const printError = ref('')

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
  const result = await fetchAndPrintLabVisitResults(visit, auth.user, 'medecin')
  if (!result.ok) printError.value = result.error
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

        <p v-if="!loading && !visits.length" class="empty">
          Aucun résultat de laboratoire disponible pour le moment.
        </p>
        <LabsResultsDataTable
          v-else
          fill
          :visits="visits"
          :selected-id="prescriptionVisit?.id"
          :loading="loading"
          @append="openAppendModal"
          @view="viewResults"
          @print="printResults"
        />
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
