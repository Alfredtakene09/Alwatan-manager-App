<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { CheckCircle2, ClipboardList, RefreshCw } from '@lucide/vue'
import api from '@/api/client'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import MedecinStatsGrid from '@/components/MedecinStatsGrid.vue'
import MedecinPrescriptionModal, {
  type PrescriptionVisit,
} from '@/components/MedecinPrescriptionModal.vue'
import ConsultedPatientsDataTable, {
  type ConsultedVisitRow,
} from '@/components/ui/ConsultedPatientsDataTable.vue'

const visits = ref<ConsultedVisitRow[]>([])
const prescriptionVisit = ref<PrescriptionVisit | null>(null)
const message = ref('')
const messageType = ref<'success' | 'error'>('success')
const loading = ref(false)
const statsRefreshKey = ref(0)

const visitCountLabel = computed(() => {
  if (loading.value) return 'Chargement…'
  if (!visits.value.length) return 'Aucun patient consulté pour le moment'
  const pending = visits.value.filter((v) => v.status !== 'COMPLETED').length
  const closed = visits.value.length - pending
  if (closed && pending) {
    return `${pending} en attente de paiement · ${closed} clôturé(s) aujourd'hui`
  }
  if (closed) return `${closed} consultation(s) clôturée(s) aujourd'hui`
  return `${pending} patient(s) en attente de paiement`
})

async function loadVisits() {
  if (prescriptionVisit.value) return
  loading.value = true
  try {
    const { data } = await api.get('/visits', { params: { queue: 'consulted' } })
    visits.value = data
    if (
      prescriptionVisit.value &&
      !data.some((v: ConsultedVisitRow) => v.id === prescriptionVisit.value?.id)
    ) {
      closePrescriptionModal()
    }
  } finally {
    loading.value = false
    statsRefreshKey.value += 1
  }
}

/** Un seul bouton Voir → même modal que la consultation, résumé d’abord. */
function openViewModal(id: string) {
  const visit = visits.value.find((v) => v.id === id)
  if (!visit) return
  prescriptionVisit.value = visit
  message.value = ''
}

function closePrescriptionModal() {
  prescriptionVisit.value = null
}

function onPrescriptionSaved() {
  message.value = 'Dossier mis à jour avec succès.'
  messageType.value = 'success'
  loadVisits()
}

onMounted(loadVisits)
</script>

<template>
  <div class="page-with-table page-with-table--medecin">
    <section class="page-with-table__head">
      <UiPageHeader
        title="Déjà consulté"
        subtitle="Patients consultés — en attente de paiement, ou clôturés aujourd'hui"
        :icon="CheckCircle2"
      />

      <UiAlert v-if="message" :type="messageType" :message="message" />

      <MedecinStatsGrid :refresh-key="statsRefreshKey" />
    </section>

    <section class="page-with-table__body">
      <UiCard direct title="Patients déjà consultés"
        :description="visitCountLabel"
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
          Aucun patient consulté pour le moment. Les dossiers prescrits ou clôturés aujourd'hui apparaîtront ici.
        </p>
        <ConsultedPatientsDataTable
          v-else-if="visits.length || loading"
          fill
          :visits="visits"
          :selected-id="prescriptionVisit?.id"
          :loading="loading"
          @view="openViewModal"
        />
      </UiCard>
    </section>

    <MedecinPrescriptionModal
      :visit="prescriptionVisit"
      mode="edit"
      :show-resume-tab="true"
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
