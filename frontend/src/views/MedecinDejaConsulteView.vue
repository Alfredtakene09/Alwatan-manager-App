<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { CheckCircle2, ClipboardList, RefreshCw, ArrowRightLeft, X } from '@lucide/vue'
import api from '@/api/client'
import { confirmAppModal, showApiErrorModal } from '@/lib/api-modal-helper'
import { fullName } from '@/lib/roles'
import { useAppI18n } from '@/i18n/useAppI18n'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import MedecinStatsGrid from '@/components/MedecinStatsGrid.vue'
import MedecinPrescriptionModal, {
  type PrescriptionVisit,
} from '@/components/MedecinPrescriptionModal.vue'
import ConsultedPatientsDataTable, {
  type ConsultedVisitRow,
} from '@/components/ui/ConsultedPatientsDataTable.vue'

const visits = ref<ConsultedVisitRow[]>([])
const prescriptionVisit = ref<PrescriptionVisit | null>(null)
const transferVisitId = ref<string | null>(null)
const transferServices = ref<{ id: string; name: string; doctorCount: number }[]>([])
const selectedServiceId = ref('')
const transferring = ref(false)
const message = ref('')
const messageType = ref<'success' | 'error'>('success')
const loading = ref(false)
const statsRefreshKey = ref(0)
const { uiText } = useAppI18n()

const transferVisit = computed(() => visits.value.find((v) => v.id === transferVisitId.value) ?? null)
const transferServiceOptions = computed(() => {
  const currentServiceId = transferVisit.value?.assignedClinicService?.id
  return transferServices.value.filter((service) => service.id !== currentServiceId)
})

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
    const { data } = await api.get<{ id: string; name: string; doctorCount: number }[]>(
      '/visits/transfer-services',
    )
    transferServices.value = Array.isArray(data)
      ? [...data].sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }))
      : []
  } catch {
    transferServices.value = []
  }
}

function openTransferModal(id: string) {
  transferVisitId.value = id
  selectedServiceId.value = ''
  message.value = ''
  void loadTransferServices()
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
  message.value = uiText('Dossier mis à jour avec succès.')
  messageType.value = 'success'
  loadVisits()
}

function closeTransferModal() {
  transferVisitId.value = null
  selectedServiceId.value = ''
}

async function submitTransfer() {
  if (!transferVisitId.value || !selectedServiceId.value) {
    message.value = uiText('Sélectionnez un service destinataire.')
    messageType.value = 'error'
    return
  }

  const ok = await confirmAppModal({
    title: uiText('Transférer le patient'),
    message: uiText('Confirmer le transfert de ce patient vers le service sélectionné ?'),
    confirmLabel: uiText('Transférer'),
    type: 'CONFIRM',
  })
  if (!ok) return

  transferring.value = true
  try {
    await api.patch(`/visits/${transferVisitId.value}/transfer`, {
      clinicServiceId: selectedServiceId.value,
    })
    message.value = uiText('Patient transféré vers le service sélectionné.')
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
          @transfer="openTransferModal"
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

    <Teleport to="body">
      <div v-if="transferVisit" class="modal-overlay" @click.self="closeTransferModal">
        <div class="modal modal--transfer" role="dialog" aria-modal="true" aria-labelledby="transfer-modal-title">
          <header class="modal__header">
            <div>
              <h2 id="transfer-modal-title">{{ uiText('Transférer le patient') }}</h2>
              <p>
                {{ fullName(transferVisit.patient.firstName, transferVisit.patient.lastName) }}
                — {{ transferVisit.patient.code }}
              </p>
            </div>
            <button type="button" class="modal__close" :aria-label="uiText('Fermer')" @click="closeTransferModal">
              <X :size="18" />
            </button>
          </header>

          <div class="modal__body">
            <UiSelect v-model="selectedServiceId" :label="uiText('Service destinataire')" required>
              <option value="" disabled>{{ uiText('Choisir un service…') }}</option>
              <option v-for="service in transferServiceOptions" :key="service.id" :value="service.id">
                {{ service.name
                }}{{ service.doctorCount ? '' : ` (${uiText('aucun médecin rattaché')})` }}
              </option>
            </UiSelect>
            <p class="transfer-hint">
              {{
                uiText(
                  'Le patient apparaîtra en attente de consultation chez le(s) médecin(s) de ce service.',
                )
              }}
            </p>
          </div>

          <footer class="modal__footer">
            <UiButton variant="ghost" @click="closeTransferModal">{{ uiText('Annuler') }}</UiButton>
            <UiButton
              variant="primary"
              :icon="ArrowRightLeft"
              :disabled="transferring || !selectedServiceId"
              @click="submitTransfer"
            >
              {{ uiText(transferring ? 'Transfert…' : 'Confirmer le transfert') }}
            </UiButton>
          </footer>
        </div>
      </div>
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

.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: grid;
  place-items: center;
  padding: 1rem;
  background: rgba(15, 23, 42, 0.45);
}

.modal--transfer {
  width: min(420px, 100%);
  background: var(--surface, #fff);
  border-radius: 16px;
  box-shadow: 0 20px 50px rgba(15, 23, 42, 0.2);
  overflow: hidden;
}

.modal__header {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  padding: 1.1rem 1.25rem 0.75rem;
}

.modal__header h2 {
  margin: 0;
  font-size: 1.05rem;
}

.modal__header p {
  margin: 0.25rem 0 0;
  color: var(--text-muted);
  font-size: 0.875rem;
}

.modal__close {
  border: 0;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}

.modal__body {
  padding: 0.5rem 1.25rem 1rem;
}

.transfer-hint {
  margin: 0.75rem 0 0;
  font-size: 0.8125rem;
  color: var(--text-muted);
  line-height: 1.4;
}

.modal__footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  padding: 0.85rem 1.25rem 1.15rem;
}
</style>
