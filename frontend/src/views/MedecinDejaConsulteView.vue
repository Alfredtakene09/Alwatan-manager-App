<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { CheckCircle2, ClipboardList, RefreshCw } from '@lucide/vue'
import api from '@/api/client'
import { confirmAppModal, showApiErrorModal } from '@/lib/api-modal-helper'
import { fullName } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth'
import { useAppI18n } from '@/i18n/useAppI18n'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import MedecinStatsGrid from '@/components/MedecinStatsGrid.vue'
import MedecinPrescriptionModal, {
  type PrescriptionVisit,
} from '@/components/MedecinPrescriptionModal.vue'
import MedecinTransferModal, {
  type TransferServiceOption,
} from '@/components/medecin/MedecinTransferModal.vue'
import ConsultedPatientsDataTable, {
  type ConsultedVisitRow,
} from '@/components/ui/ConsultedPatientsDataTable.vue'

const visits = ref<ConsultedVisitRow[]>([])
const prescriptionVisit = ref<PrescriptionVisit | null>(null)
const prescriptionStartTab = ref<'resume' | 'edit'>('resume')
const transferVisitId = ref<string | null>(null)
const transferServices = ref<TransferServiceOption[]>([])
const transferring = ref(false)
const message = ref('')
const messageType = ref<'success' | 'error'>('success')
const loading = ref(false)
const statsRefreshKey = ref(0)
const auth = useAuthStore()
const { uiText } = useAppI18n()

const transferVisit = computed(() => visits.value.find((v) => v.id === transferVisitId.value) ?? null)

const visitCountLabel = computed(() => {
  if (loading.value) return uiText('Chargement…')
  if (!visits.value.length) return uiText('Aucun patient consulté pour le moment')
  const pending = visits.value.filter((v) => v.status !== 'COMPLETED').length
  const closed = visits.value.length - pending
  if (closed && pending) {
    return uiText('{pending} en attente de paiement · {closed} clôturé(s) aujourd\'hui')
      .replace('{pending}', String(pending))
      .replace('{closed}', String(closed))
  }
  if (closed) {
    return uiText('{n} consultation(s) clôturée(s) aujourd\'hui').replace('{n}', String(closed))
  }
  return uiText('{n} patient(s) en attente de paiement').replace('{n}', String(pending))
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

async function loadTransferServices() {
  try {
    const { data } = await api.get<TransferServiceOption[]>('/visits/transfer-services')
    transferServices.value = Array.isArray(data)
      ? [...data].sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }))
      : []
  } catch {
    transferServices.value = []
  }
}

function openTransferModal(id: string) {
  transferVisitId.value = id
  message.value = ''
  void loadTransferServices()
}

function openPrescriptionModal(id: string, startTab: 'resume' | 'edit') {
  const visit = visits.value.find((v) => v.id === id)
  if (!visit) return
  prescriptionStartTab.value = startTab
  prescriptionVisit.value = visit
  message.value = ''
}

function openViewModal(id: string) {
  openPrescriptionModal(id, 'resume')
}

function openEditModal(id: string) {
  openPrescriptionModal(id, 'edit')
}

function closePrescriptionModal() {
  prescriptionVisit.value = null
}

function onPrescriptionSaved() {
  message.value = uiText('Dossier mis à jour avec succès.')
  messageType.value = 'success'
  loadVisits()
}

function closeTransferModal() {
  transferVisitId.value = null
}

async function submitTransfer(payload: { clinicServiceId: string; doctorId: string }) {
  const visitId = transferVisitId.value
  if (!visitId || !payload.clinicServiceId || !payload.doctorId) {
    message.value = uiText('Sélectionnez un médecin destinataire.')
    messageType.value = 'error'
    return
  }

  const ok = await confirmAppModal({
    title: uiText('Transférer le patient'),
    message: uiText('Confirmer le transfert de ce patient vers le médecin sélectionné ?'),
    confirmLabel: uiText('Transférer'),
    type: 'CONFIRM',
  })
  if (!ok) return

  transferring.value = true
  try {
    await api.patch(`/visits/${visitId}/transfer`, payload)
    visits.value = visits.value.filter((visit) => visit.id !== visitId)
    if (prescriptionVisit.value?.id === visitId) closePrescriptionModal()
    message.value = uiText('Patient transféré au médecin sélectionné.')
    messageType.value = 'success'
    closeTransferModal()
    await loadVisits()
  } catch (error: unknown) {
    const shown = await showApiErrorModal(error, 'Impossible de transférer ce patient.')
    if (!shown) {
      message.value = uiText('Impossible de transférer ce patient.')
      messageType.value = 'error'
    }
  } finally {
    transferring.value = false
  }
}

onMounted(async () => {
  await Promise.all([loadVisits(), loadTransferServices()])
})
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
          {{
            uiText(
              "Aucun patient consulté pour le moment. Les dossiers prescrits ou clôturés aujourd'hui apparaîtront ici.",
            )
          }}
        </p>
        <ConsultedPatientsDataTable
          v-else-if="visits.length || loading"
          fill
          :visits="visits"
          :selected-id="prescriptionVisit?.id"
          :loading="loading"
          @view="openViewModal"
          @edit="openEditModal"
          @transfer="openTransferModal"
        />
      </UiCard>
    </section>

    <MedecinPrescriptionModal
      :key="`${prescriptionVisit?.id ?? 'closed'}-${prescriptionStartTab}`"
      :visit="prescriptionVisit"
      mode="edit"
      :show-resume-tab="true"
      :start-tab="prescriptionStartTab"
      @close="closePrescriptionModal"
      @saved="onPrescriptionSaved"
    />

    <Teleport to="body">
      <MedecinTransferModal
        v-if="transferVisit"
        :patient-name="fullName(transferVisit.patient.firstName, transferVisit.patient.lastName)"
        :patient-code="transferVisit.patient.code"
        :services="transferServices"
        :current-service-id="transferVisit.assignedClinicService?.id"
        :current-doctor-id="auth.user?.id"
        :transferring="transferring"
        @close="closeTransferModal"
        @confirm="submitTransfer"
      />
    </Teleport>
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
