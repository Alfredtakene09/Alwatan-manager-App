<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import {
  Stethoscope,
  ClipboardList,
  RefreshCw,
  X,
  FlaskConical,
  HeartPulse,
  CheckCircle2,
  ArrowRightLeft,
} from '@lucide/vue'
import api from '@/api/client'
import { confirmAppModal, showApiErrorModal } from '@/lib/api-modal-helper'
import { fullName } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import MedecinStatsGrid from '@/components/MedecinStatsGrid.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import MultiExamPrescriptionPicker from '@/components/MultiExamPrescriptionPicker.vue'
import { emptyExamsByKind, emptyExamCommentsByKind, countExamsByKind, filterInvoiceExamComments, type ExamsByKind, type ExamCommentsByKind } from '@/lib/exam-catalog'
import ConsultationQueueDataTable, {
  type ConsultationVisitRow,
} from '@/components/ui/ConsultationQueueDataTable.vue'

const visits = ref<ConsultationVisitRow[]>([])
const modalVisitId = ref<string | null>(null)
const transferVisitId = ref<string | null>(null)
const doctors = ref<{ id: string; firstName: string; lastName: string }[]>([])
const selectedDoctorId = ref('')
const message = ref('')
const messageType = ref<'success' | 'error'>('success')
const loading = ref(false)
const submitting = ref(false)
const transferring = ref(false)
const selectedExamsByKind = ref<ExamsByKind>(emptyExamsByKind())
const examCommentsByKind = ref<ExamCommentsByKind>(emptyExamCommentsByKind())
const hospitalisationDays = ref<number | null>(null)
const doctorComment = ref('')

const modalVisit = computed(() => visits.value.find((v) => v.id === modalVisitId.value) ?? null)
const transferVisit = computed(() => visits.value.find((v) => v.id === transferVisitId.value) ?? null)
const route = useRoute()
const auth = useAuthStore()
const isAdminSupervision = computed(
  () => auth.user?.role === 'ADMIN' || auth.user?.role === 'COMPTABLE',
)
const transferDoctorOptions = computed(() => {
  const assignedId = transferVisit.value?.assignedDoctor?.id
  return doctors.value.filter((doctor) => doctor.id !== assignedId)
})
const latestVitals = computed(() => modalVisit.value?.vitalSigns?.[0] ?? null)
const statsRefreshKey = ref(0)
const selectedExamsCount = computed(() => countExamsByKind(selectedExamsByKind.value))
const hospitalisationPrescribed = computed(
  () => (selectedExamsByKind.value.hospitalisation?.length ?? 0) > 0,
)
const canSubmitConsultation = computed(() => {
  if (doctorComment.value.trim().length >= 2) return true
  if (selectedExamsCount.value <= 0) return false
  if (hospitalisationPrescribed.value && (hospitalisationDays.value ?? 0) < 1) return false
  return true
})
const submitConsultationLabel = computed(() => {
  if (submitting.value) return 'Enregistrement…'
  if (selectedExamsCount.value > 0) return 'Prescrire et enregistrer'
  return 'Enregistrer le commentaire'
})

async function loadDoctors() {
  const { data } = await api.get<{ id: string; firstName: string; lastName: string }[]>('/visits/doctors')
  doctors.value = data
}

async function loadVisits() {
  loading.value = true
  try {
    const queue = isAdminSupervision.value ? 'supervision' : 'pending'
    const { data } = await api.get('/visits', { params: { queue } })
    visits.value = data
    if (modalVisitId.value && !data.some((v: ConsultationVisitRow) => v.id === modalVisitId.value)) {
      closeModal()
    }
  } finally {
    loading.value = false
    statsRefreshKey.value += 1
  }
}

async function ensureVisitAvailable(visitId: string) {
  if (visits.value.some((v) => v.id === visitId)) return true
  const { data } = await api.get<ConsultationVisitRow[]>('/visits', { params: { queue: 'my-patients' } })
  const visit = data.find((v) => v.id === visitId)
  if (!visit) return false
  visits.value = [...visits.value, visit]
  return true
}

function resetExamForm() {
  selectedExamsByKind.value = emptyExamsByKind()
  examCommentsByKind.value = emptyExamCommentsByKind()
  hospitalisationDays.value = null
  doctorComment.value = ''
}

async function openConsultModal(id: string) {
  modalVisitId.value = id
  resetExamForm()
  message.value = ''

  const visit = visits.value.find((v) => v.id === id)
  if (visit?.status === 'WAITING_CONSULTATION') {
    try {
      const { data } = await api.patch(`/visits/${id}/start-consultation`)
      const index = visits.value.findIndex((v) => v.id === id)
      if (index >= 0) visits.value[index] = data
    } catch {
      message.value = 'Impossible de démarrer la consultation.'
      messageType.value = 'error'
      closeModal()
    }
  }
}

function closeModal() {
  modalVisitId.value = null
  resetExamForm()
}

function openTransferModal(id: string) {
  transferVisitId.value = id
  selectedDoctorId.value = ''
  message.value = ''
}

function closeTransferModal() {
  transferVisitId.value = null
  selectedDoctorId.value = ''
}

async function submitTransfer() {
  if (!transferVisitId.value || !selectedDoctorId.value) {
    message.value = 'Sélectionnez un médecin destinataire.'
    messageType.value = 'error'
    return
  }

  const ok = await confirmAppModal({
    title: 'Transférer le patient',
    message: 'Confirmer le transfert de ce patient vers le médecin sélectionné ?',
    confirmLabel: 'Transférer',
    variant: 'primary',
  })
  if (!ok) return

  transferring.value = true
  message.value = ''
  try {
    await api.patch(`/visits/${transferVisitId.value}/transfer`, {
      doctorId: selectedDoctorId.value,
    })
    message.value = 'Patient transféré au médecin sélectionné.'
    messageType.value = 'success'
    closeTransferModal()
    await loadVisits()
  } catch (error: unknown) {
    const shown = await showApiErrorModal(error, 'Impossible de transférer ce patient.')
    if (!shown) {
      message.value = 'Impossible de transférer ce patient.'
      messageType.value = 'error'
    }
  } finally {
    transferring.value = false
  }
}

async function submitExams() {
  if (!modalVisitId.value) return
  if (!canSubmitConsultation.value) {
    message.value = 'Sélectionnez au moins un examen ou saisissez un commentaire (2 caractères min.).'
    messageType.value = 'error'
    return
  }

  submitting.value = true
  message.value = ''
  try {
    const payload: Record<string, unknown> = {
      visitId: modalVisitId.value,
      doctorComment: doctorComment.value.trim() || undefined,
    }
    if (selectedExamsCount.value > 0) {
      payload.examsByKind = selectedExamsByKind.value
      payload.examCommentsByKind = filterInvoiceExamComments(examCommentsByKind.value)
      if (hospitalisationPrescribed.value && hospitalisationDays.value && hospitalisationDays.value >= 1) {
        payload.hospitalisationDays = hospitalisationDays.value
      }
    }
    await api.post('/consultations/prescribe-exams', payload)
    const hasComment = !!doctorComment.value.trim()
    message.value =
      selectedExamsCount.value && hasComment
        ? 'Examens prescrits — commentaire enregistré pour les résultats de labos.'
        : selectedExamsCount.value
          ? 'Examens prescrits — en attente de paiement à la réception.'
          : 'Commentaire enregistré pour les résultats de labos.'
    messageType.value = 'success'
    closeModal()
    await loadVisits()
  } catch (error: unknown) {
    const shown = await showApiErrorModal(error, 'Erreur lors de l\'enregistrement de la consultation.')
    if (!shown) {
      message.value = 'Erreur lors de l\'enregistrement de la consultation.'
      messageType.value = 'error'
    }
  } finally {
    submitting.value = false
  }
}

onMounted(async () => {
  await Promise.all([loadVisits(), loadDoctors()])
  if (isAdminSupervision.value) return
  const visitId = route.query.visit
  if (typeof visitId === 'string' && (await ensureVisitAvailable(visitId))) {
    await openConsultModal(visitId)
  }
})
</script>

<template>
  <div class="page-with-table page-with-table--medecin">
    <section class="page-with-table__head">
      <UiPageHeader
        :title="isAdminSupervision ? 'Supervision — file de consultation' : 'Consultation médicale'"
        :subtitle="
          isAdminSupervision
            ? 'Vue lecture seule — tous les patients en attente ou en cours de consultation'
            : 'Patients assignés à votre compte ou transférés vers vous'
        "
        :icon="Stethoscope"
      />

      <UiAlert v-if="message" :type="messageType" :message="message" />

      <MedecinStatsGrid v-if="!isAdminSupervision" :refresh-key="statsRefreshKey" />
    </section>

    <section class="page-with-table__body">
      <UiCard
        :title="isAdminSupervision ? 'Patients en file d\'attente' : 'Patients à consulter'"
        :description="
          isAdminSupervision
            ? 'Supervision clinique — aucune action médicale depuis ce compte Direction'
            : 'Cliquez sur Consulter pour voir le dossier et prescrire les examens'
        "
        class="ui-card--table-panel consultation-queue-panel"
        :icon="ClipboardList"
        icon-variant="blue"
      >
        <template #actions>
          <UiButton variant="ghost" size="sm" :icon="RefreshCw" :disabled="loading" @click="loadVisits">
            Actualiser
          </UiButton>
        </template>

        <p v-if="!loading && !visits.length" class="empty">
          {{
            isAdminSupervision
              ? 'Aucun patient en file de consultation pour le moment.'
              : 'Aucun patient en attente'
          }}
        </p>
        <ConsultationQueueDataTable
          v-else
          fill
          :visits="visits"
          :selected-id="modalVisitId"
          :loading="loading"
          :read-only="isAdminSupervision"
          @consult="openConsultModal"
          @transfer="openTransferModal"
        />
      </UiCard>
    </section>

    <Teleport to="body">
      <div v-if="modalVisit" class="modal-overlay" @click.self="closeModal">
        <div class="modal modal--consult" role="dialog" aria-modal="true" aria-labelledby="consult-modal-title">
          <header class="modal__header">
            <div>
              <h2 id="consult-modal-title">
                {{ fullName(modalVisit.patient.firstName, modalVisit.patient.lastName) }}
              </h2>
              <p>{{ modalVisit.patient.code }} — Consultation & prescription d'examens</p>
            </div>
            <button type="button" class="modal__close" aria-label="Fermer" @click="closeModal">
              <X :size="18" />
            </button>
          </header>

          <div class="modal__body">
            <section class="info-section">
              <h3>Informations patient</h3>
              <dl class="info-grid">
                <div>
                  <dt>Matricule</dt>
                  <dd>{{ modalVisit.patient.code }}</dd>
                </div>
                <div v-if="modalVisit.patient.phone">
                  <dt>Téléphone</dt>
                  <dd>{{ modalVisit.patient.phone }}</dd>
                </div>
                <div v-if="modalVisit.assignedDoctor">
                  <dt>Médecin assigné</dt>
                  <dd>Dr {{ fullName(modalVisit.assignedDoctor.firstName, modalVisit.assignedDoctor.lastName) }}</dd>
                </div>
                <div>
                  <dt>Arrivée</dt>
                  <dd>{{ new Date(modalVisit.createdAt).toLocaleString('fr-FR') }}</dd>
                </div>
              </dl>
            </section>

            <section v-if="latestVitals" class="info-section info-section--vitals">
              <h3>
                <HeartPulse :size="16" />
                Constantes (réception)
              </h3>
              <dl class="info-grid">
                <div v-if="latestVitals.weightKg">
                  <dt>Poids</dt>
                  <dd>{{ latestVitals.weightKg }} kg</dd>
                </div>
                <div v-if="latestVitals.bloodPressure">
                  <dt>Tension</dt>
                  <dd>{{ latestVitals.bloodPressure }}</dd>
                </div>
                <div v-if="latestVitals.temperatureC">
                  <dt>Température</dt>
                  <dd>{{ latestVitals.temperatureC }} °C</dd>
                </div>
                <div v-if="latestVitals.pulseBpm">
                  <dt>Pouls</dt>
                  <dd>{{ latestVitals.pulseBpm }} bpm</dd>
                </div>
              </dl>
            </section>

            <section class="info-section">
              <h3>
                <FlaskConical :size="16" />
                Prescrire des examens
              </h3>
              <MultiExamPrescriptionPicker
                v-model="selectedExamsByKind"
                v-model:comments="examCommentsByKind"
                v-model:hospitalisation-days="hospitalisationDays"
              />
            </section>

            <section class="info-section info-section--comment">
              <h3>Commentaire médecin</h3>
              <p class="comment-hint">
                Observations, conduite à tenir… Visible dans les résultats de labos (bouton Voir).
              </p>
              <textarea
                v-model="doctorComment"
                class="doctor-comment"
                rows="4"
                placeholder="Ex. Patient stable, repos recommandé, contrôle dans 15 jours…"
              />
            </section>
          </div>

          <footer class="modal__footer">
            <UiButton variant="ghost" @click="closeModal">Annuler</UiButton>
            <UiButton
              variant="primary"
              :icon="CheckCircle2"
              :disabled="submitting || !canSubmitConsultation"
              @click="submitExams"
            >
              {{ submitConsultationLabel }}
            </UiButton>
          </footer>
        </div>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="transferVisit" class="modal-overlay" @click.self="closeTransferModal">
        <div class="modal modal--transfer" role="dialog" aria-modal="true" aria-labelledby="transfer-modal-title">
          <header class="modal__header">
            <div>
              <h2 id="transfer-modal-title">Transférer le patient</h2>
              <p>
                {{ fullName(transferVisit.patient.firstName, transferVisit.patient.lastName) }}
                — {{ transferVisit.patient.code }}
              </p>
            </div>
            <button type="button" class="modal__close" aria-label="Fermer" @click="closeTransferModal">
              <X :size="18" />
            </button>
          </header>

          <div class="modal__body">
            <UiSelect v-model="selectedDoctorId" label="Médecin destinataire" required>
              <option value="" disabled>Choisir un médecin…</option>
              <option v-for="doctor in transferDoctorOptions" :key="doctor.id" :value="doctor.id">
                Dr {{ fullName(doctor.firstName, doctor.lastName) }}
              </option>
            </UiSelect>
            <p class="transfer-hint">
              Le patient retournera en attente de consultation chez le médecin choisi.
            </p>
          </div>

          <footer class="modal__footer">
            <UiButton variant="ghost" @click="closeTransferModal">Annuler</UiButton>
            <UiButton
              variant="primary"
              :icon="ArrowRightLeft"
              :disabled="transferring || !selectedDoctorId"
              @click="submitTransfer"
            >
              {{ transferring ? 'Transfert…' : 'Confirmer le transfert' }}
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

.consultation-queue-panel :deep(.ui-card__header) {
  padding: 1.4rem 1.6rem 0.5rem;
  gap: 1rem;
}

.consultation-queue-panel :deep(.ui-card__icon) {
  width: 3.25rem;
  height: 3.25rem;
  border-radius: 14px;
}

.consultation-queue-panel :deep(.ui-card__icon svg) {
  width: 24px;
  height: 24px;
}

.consultation-queue-panel :deep(.ui-card__titles h3) {
  font-size: 1.3125rem;
  letter-spacing: -0.02em;
}

.consultation-queue-panel :deep(.ui-card__titles p) {
  margin-top: 0.4rem;
  font-size: 0.9375rem;
  line-height: 1.55;
}

.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  background: rgba(15, 23, 42, 0.45);
  backdrop-filter: blur(4px);
}

.modal {
  width: 100%;
  max-width: 36rem;
  max-height: min(90dvh, 720px);
  display: flex;
  flex-direction: column;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
}

.modal--consult {
  max-width: 42rem;
}

.modal--transfer {
  max-width: 28rem;
}

.transfer-hint {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--text-muted);
  line-height: 1.45;
}

.modal__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  padding: 1.35rem 1.5rem 0;
  flex-shrink: 0;
}

.modal__header h2 {
  margin: 0;
  font-size: 1.2rem;
}

.modal__header p {
  margin: 0.35rem 0 0;
  font-size: 0.8125rem;
  color: var(--text-muted);
}

.modal__close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  border: 0;
  border-radius: 8px;
  background: #f1f5f9;
  color: var(--text-muted);
  cursor: pointer;
}

.modal__close:hover {
  background: #e2e8f0;
  color: var(--text);
}

.modal__body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 1rem 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
}

.info-section h3 {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin: 0 0 0.65rem;
  font-size: 0.8125rem;
  font-weight: 700;
  color: var(--primary-800);
}

.info-section--vitals {
  padding: 0.85rem 1rem;
  background: #f8fafc;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}

.info-section--comment {
  padding-top: 0.25rem;
}

.comment-hint {
  margin: 0 0 0.5rem;
  font-size: 0.75rem;
  color: var(--text-muted);
  line-height: 1.4;
}

.doctor-comment {
  width: 100%;
  padding: 0.7rem 0.85rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font: inherit;
  resize: vertical;
  min-height: 5.5rem;
  background: #fff;
  color: var(--text);
}

.doctor-comment:focus {
  outline: none;
  border-color: var(--accent-500);
  box-shadow: 0 0 0 3px var(--focus-ring);
}

.info-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.65rem 1rem;
  margin: 0;
}

.info-grid dt {
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-light);
  margin-bottom: 0.1rem;
}

.info-grid dd {
  margin: 0;
  font-size: 0.875rem;
  font-weight: 600;
}

.modal__footer {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.65rem;
  padding: 1rem 1.5rem 1.35rem;
  border-top: 1px solid var(--border);
  flex-shrink: 0;
}

@media (max-width: 900px) {
  .info-grid {
    grid-template-columns: 1fr;
  }

  .modal-overlay {
    padding: 0.75rem;
  }
}
</style>
