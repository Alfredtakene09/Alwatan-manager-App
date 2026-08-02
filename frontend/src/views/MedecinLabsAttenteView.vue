<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { FlaskConical, RefreshCw } from '@lucide/vue'
import api from '@/api/client'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import MedecinStatsGrid from '@/components/MedecinStatsGrid.vue'
import MedecinPrescriptionModal, {
  type PrescriptionVisit,
} from '@/components/MedecinPrescriptionModal.vue'
import LabsWaitingDataTable, {
  type LabsWaitingVisitRow,
} from '@/components/ui/LabsWaitingDataTable.vue'
import { useSilentRefresh } from '@/composables/useSilentRefresh'

const visits = ref<LabsWaitingVisitRow[]>([])
const prescriptionVisit = ref<PrescriptionVisit | null>(null)
const loading = ref(false)
const statsRefreshKey = ref(0)
const message = ref('')
const messageType = ref<'success' | 'error'>('success')

async function loadVisits(opts?: { silent?: boolean }) {
  if (prescriptionVisit.value) return
  if (!opts?.silent) loading.value = true
  try {
    const { data } = await api.get('/consultations/labs-en-attente')
    visits.value = data
  } finally {
    if (!opts?.silent) loading.value = false
    if (!opts?.silent) statsRefreshKey.value += 1
  }
}

function openAppendModal(id: string) {
  const visit = visits.value.find((v) => v.id === id)
  if (!visit) return
  prescriptionVisit.value = visit
  message.value = ''
}

function closePrescriptionModal() {
  prescriptionVisit.value = null
}

function onPrescriptionSaved() {
  message.value = 'Nouveaux examens ajoutés. Les examens supplémentaires suivront le circuit paiement / laboratoire.'
  messageType.value = 'success'
  void loadVisits()
}

const { refresh: refreshVisits } = useSilentRefresh(
  ({ silent }) => loadVisits({ silent }),
  {
    intervalMs: 20_000,
    enabled: () => !prescriptionVisit.value,
    immediate: false,
  },
)

onMounted(() => {
  void loadVisits()
})
</script>

<template>
  <div class="page-with-table page-with-table--medecin">
    <section class="page-with-table__head">
      <UiPageHeader
        title="En attente de labos"
        subtitle="Patients transférés au laboratoire — vous pouvez prescrire des examens complémentaires"
        :icon="FlaskConical"
      />

      <UiAlert v-if="message" :type="messageType" :message="message" />

      <MedecinStatsGrid :refresh-key="statsRefreshKey" />
    </section>

    <section class="page-with-table__body">
      <UiCard
        title="Analyses en cours"
        description="Patients en attente de résultats — visibles après validation par la comptabilité"
        class="ui-card--table-panel"
        :icon="FlaskConical"
        icon-variant="amber"
      >
        <template #actions>
          <UiButton variant="ghost" size="sm" :icon="RefreshCw" :disabled="loading" @click="refreshVisits()">
            Actualiser
          </UiButton>
        </template>

        <p v-if="!loading && !visits.length" class="empty">
          Aucun patient en attente de résultats laboratoire pour le moment.
        </p>
        <LabsWaitingDataTable
          v-else
          fill
          :visits="visits"
          :selected-id="prescriptionVisit?.id"
          :loading="loading && !visits.length"
          @append="openAppendModal"
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
