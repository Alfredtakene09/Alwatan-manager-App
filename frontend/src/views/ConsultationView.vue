<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useSilentRefresh } from '@/composables/useSilentRefresh'
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
  CircleDollarSign,
  PillBottle,
  PenLine,
} from '@lucide/vue'
import api from '@/api/client'
import { confirmAppModal, showApiErrorModal } from '@/lib/api-modal-helper'
import { fullName } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth'
import { useAppI18n } from '@/i18n/useAppI18n'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import MedecinStatsGrid from '@/components/MedecinStatsGrid.vue'
import MedecinReceivableModal from '@/components/medecin/MedecinReceivableModal.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import MultiExamPrescriptionPicker from '@/components/MultiExamPrescriptionPicker.vue'
import DoctorPharmacyOrdonnancePicker from '@/components/DoctorPharmacyOrdonnancePicker.vue'
import PatientMedicalHistory, {
  type MedicalHistoryEntry,
} from '@/components/dossier/PatientMedicalHistory.vue'
import { emptyExamsByKind, emptyExamCommentsByKind, countExamsByKind, filterInvoiceExamComments, type ExamsByKind, type ExamCommentsByKind } from '@/lib/exam-catalog'
import {
  CLINICAL_CONSULTATION_EXAM_LABEL,
  hasClinicalConsultationSelected,
  hasLabResults,
  isDirectClinicalConsultationPrescription,
  isPharmacyCatalogLine,
  parsePharmacyOrdonnanceLines,
  parsePrescribedExamsByKind,
  parsePrescribedExamCommentsByKind,
  parsePrescribedHospitalisationDays,
  type PharmacyOrdonnanceLine,
} from '@/lib/lab-notes'
import ConsultationQueueDataTable, {
  type ConsultationVisitRow,
} from '@/components/ui/ConsultationQueueDataTable.vue'

const visits = ref<ConsultationVisitRow[]>([])
const modalVisitId = ref<string | null>(null)
const transferVisitId = ref<string | null>(null)
const transferServices = ref<{ id: string; name: string; doctorCount: number }[]>([])
const selectedServiceId = ref('')
const message = ref('')
const messageType = ref<'success' | 'error'>('success')
const loading = ref(false)
const submitting = ref(false)
const transferring = ref(false)
const selectedExamsByKind = ref<ExamsByKind>(emptyExamsByKind())
const examCommentsByKind = ref<ExamCommentsByKind>(emptyExamCommentsByKind())
const operationAmountFcfa = ref<number | null>(null)
const hospitalisationDays = ref<number | null>(null)
const doctorComment = ref('')
const pharmacyOrdonnance = ref<PharmacyOrdonnanceLine[]>([])
const recentHistory = ref<MedicalHistoryEntry[]>([])
const loadingHistory = ref(false)
/** Onglets du modal : Examens | Pharmacie | Hors pharmacie | Notes */
const consultModalTab = ref<'exams' | 'pharmacy' | 'external' | 'notes'>('exams')

const route = useRoute()
const auth = useAuthStore()
const { uiText, dateTimeText } = useAppI18n()

const modalVisit = computed(() => visits.value.find((v) => v.id === modalVisitId.value) ?? null)
const transferVisit = computed(() => visits.value.find((v) => v.id === transferVisitId.value) ?? null)
const latestVitals = computed(() => modalVisit.value?.vitalSigns?.[0] ?? null)

const showConsultationPanel = computed(() =>
  hasClinicalConsultationSelected(selectedExamsByKind.value),
)

/** Blocage édition examens uniquement si des résultats labo existent déjà. */
const isLabLockedVisit = computed(() => {
  const notes = modalVisit.value?.consultation?.clinicalNotes
  return hasLabResults(notes)
})

const hasOperationSelected = computed(
  () => (selectedExamsByKind.value.operation?.length ?? 0) > 0,
)

const recentResults = computed(() =>
  recentHistory.value.filter((entry) => entry.labPanels.length > 0 || entry.operations?.length),
)

const patientMetaLine = computed(() => {
  if (!modalVisit.value) return ''
  const parts = [modalVisit.value.patient.code]
  if (modalVisit.value.patient.phone) parts.push(modalVisit.value.patient.phone)
  parts.push(dateTimeText(modalVisit.value.createdAt))
  return parts.join(' · ')
})

const vitalsLine = computed(() => {
  const v = latestVitals.value
  if (!v) return ''
  const parts: string[] = []
  if (v.weightKg) parts.push(`${v.weightKg} kg`)
  if (v.bloodPressure) parts.push(v.bloodPressure)
  if (v.temperatureC) parts.push(`${v.temperatureC} °C`)
  if (v.pulseBpm) parts.push(`${v.pulseBpm} bpm`)
  return parts.join(' · ')
})

const finalCommentHint = computed(() => {
  if (showConsultationPanel.value) {
    return uiText('Notes cliniques et conduite — enregistrées dans le dossier.')
  }
  if (hasOperationSelected.value) {
    return uiText('Note opératoire / indications — visibles dans le dossier patient.')
  }
  return uiText('Note pour le dossier patient (et résultats labo).')
})

const isAdminSupervision = computed(
  () =>
    auth.user?.role === 'ADMIN' ||
    auth.user?.role === 'COMPTABLE' ||
    auth.user?.role === 'GESTIONNAIRE',
)
const transferServiceOptions = computed(() => {
  const currentServiceId = transferVisit.value?.assignedClinicService?.id
  return transferServices.value.filter((service) => service.id !== currentServiceId)
})
const statsRefreshKey = ref(0)
const showReceivableModal = ref(false)
const selectedExamsCount = computed(() => countExamsByKind(selectedExamsByKind.value))

const pharmacyCatalogCount = computed(
  () => pharmacyOrdonnance.value.filter((line) => isPharmacyCatalogLine(line)).length,
)

const pharmacyExternalCount = computed(
  () => pharmacyOrdonnance.value.filter((line) => !isPharmacyCatalogLine(line)).length,
)
const hospitalisationPrescribed = computed(
  () => (selectedExamsByKind.value.hospitalisation?.length ?? 0) > 0,
)
const canSubmitConsultation = computed(() => {
  if (doctorComment.value.trim().length >= 2) return true
  if (pharmacyOrdonnance.value.length > 0) return true
  if (selectedExamsCount.value <= 0) return false
  if (hospitalisationPrescribed.value && (hospitalisationDays.value ?? 0) < 1) return false
  return true
})
const submitConsultationLabel = computed(() => {
  if (submitting.value) return uiText('Enregistrement…')
  if (showConsultationPanel.value && selectedExamsCount.value > 0) {
    return uiText('Enregistrer le dossier')
  }
  if (hasOperationSelected.value) return uiText('Enregistrer le dossier')
  if (selectedExamsCount.value > 0) return uiText('Prescrire et enregistrer')
  return uiText('Enregistrer le commentaire')
})

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

async function ensureTransferServicesLoaded() {
  if (transferServices.value.length) return
  await loadTransferServices()
}

async function loadVisits(opts?: { silent?: boolean }) {
  if (!opts?.silent) loading.value = true
  try {
    const queue = isAdminSupervision.value ? 'supervision' : 'pending'
    const { data } = await api.get('/visits', { params: { queue } })
    visits.value = data
    if (modalVisitId.value && !data.some((v: ConsultationVisitRow) => v.id === modalVisitId.value)) {
      closeModal()
    }
  } finally {
    if (!opts?.silent) loading.value = false
    // Aussi en silent poll : sinon la carte KPI « Consultation » reste figée
    // alors que la file (visits) est déjà à jour.
    statsRefreshKey.value += 1
  }
}

const { refresh: refreshVisits } = useSilentRefresh(
  ({ silent }) => loadVisits({ silent }),
  {
    intervalMs: 20_000,
    enabled: () => !modalVisitId.value,
    immediate: false,
  },
)

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
  pharmacyOrdonnance.value = []
  operationAmountFcfa.value = null
  consultModalTab.value = 'exams'
}

/** Clic « Consulter » = consultation déjà engagée (diagnostic, pharmacie, enregistrement). */
function preselectClinicalConsultation() {
  selectedExamsByKind.value = {
    ...emptyExamsByKind(),
    specialty: [CLINICAL_CONSULTATION_EXAM_LABEL],
  }
}

async function loadRecentHistory(patientId: string | undefined) {
  recentHistory.value = []
  if (!patientId) return
  loadingHistory.value = true
  try {
    const { data } = await api.get<{ medicalHistory: MedicalHistoryEntry[] }>(
      `/patient-dossiers/${patientId}`,
    )
    recentHistory.value = Array.isArray(data.medicalHistory) ? data.medicalHistory.slice(0, 4) : []
  } catch {
    recentHistory.value = []
  } finally {
    loadingHistory.value = false
  }
}

async function openConsultModal(id: string) {
  modalVisitId.value = id
  resetExamForm()
  message.value = ''
  recentHistory.value = []

  const visit = visits.value.find((v) => v.id === id)
  void loadRecentHistory(visit?.patient?.id)

  // Reprise d’un dossier déjà prescrit : préremplir examens / ordonnance / notes.
  const notes = visit?.consultation?.clinicalNotes
  const existingExams = parsePrescribedExamsByKind(notes)
  if (countExamsByKind(existingExams) > 0) {
    selectedExamsByKind.value = existingExams
    examCommentsByKind.value = parsePrescribedExamCommentsByKind(notes)
    hospitalisationDays.value = parsePrescribedHospitalisationDays(notes)
    pharmacyOrdonnance.value = parsePharmacyOrdonnanceLines(notes)
    doctorComment.value = visit?.consultation?.doctorComment?.trim() ?? ''
    consultModalTab.value = hasLabResults(notes) ? 'pharmacy' : 'exams'
  } else {
    preselectClinicalConsultation()
    if (notes || visit?.consultation?.doctorComment) {
      pharmacyOrdonnance.value = parsePharmacyOrdonnanceLines(notes)
      doctorComment.value = visit?.consultation?.doctorComment?.trim() ?? ''
    }
  }

  if (visit?.status === 'WAITING_CONSULTATION') {
    try {
      const { data } = await api.patch(`/visits/${id}/start-consultation`)
      const index = visits.value.findIndex((v) => v.id === id)
      if (index >= 0) visits.value[index] = data
      void loadRecentHistory(data?.patient?.id ?? visit?.patient?.id)
    } catch {
      message.value = uiText('Impossible de démarrer la consultation.')
      messageType.value = 'error'
      closeModal()
    }
  }
}

function closeModal() {
  modalVisitId.value = null
  resetExamForm()
  recentHistory.value = []
}

function openTransferModal(id: string) {
  transferVisitId.value = id
  selectedServiceId.value = ''
  message.value = ''
  void ensureTransferServicesLoaded()
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
  message.value = ''
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

async function submitExams() {
  if (!modalVisitId.value) return
  if (!canSubmitConsultation.value) {
    message.value = uiText(
      'Sélectionnez au moins un examen ou saisissez un commentaire (2 caractères min.).',
    )
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

    // Dossier déjà au labo : n’envoyer que pharmacie / notes (pas les examens).
    if (isLabLockedVisit.value) {
      payload.pharmacyOrdonnance = pharmacyOrdonnance.value
    } else {
      if (selectedExamsCount.value > 0) {
        payload.examsByKind = selectedExamsByKind.value
        payload.examCommentsByKind = filterInvoiceExamComments(examCommentsByKind.value)
        if (hospitalisationPrescribed.value && hospitalisationDays.value && hospitalisationDays.value >= 1) {
          payload.hospitalisationDays = hospitalisationDays.value
        }
        if (
          (selectedExamsByKind.value.operation?.length ?? 0) > 0 &&
          operationAmountFcfa.value != null
        ) {
          payload.operationAmountFcfa = operationAmountFcfa.value
        }
      }
      if (showConsultationPanel.value && pharmacyOrdonnance.value.length > 0) {
        payload.pharmacyOrdonnance = pharmacyOrdonnance.value
      }
    }

    const hadOrdonnance = pharmacyOrdonnance.value.length > 0
    await api.post('/consultations/prescribe-exams', payload)
    const hasComment = !!doctorComment.value.trim()
    const consultationOnly = isDirectClinicalConsultationPrescription(selectedExamsByKind.value)
    message.value = uiText(
      isLabLockedVisit.value && hadOrdonnance
        ? 'Ordonnance enregistrée.'
        : hadOrdonnance
          ? 'Consultation enregistrée — ordonnance sauvegardée (impression manuelle).'
          : consultationOnly
            ? 'Consultation enregistrée — aucun examen prescrit.'
            : selectedExamsCount.value && hasComment
              ? 'Examens prescrits — commentaire enregistré pour les résultats de labos.'
              : selectedExamsCount.value
                ? 'Examens prescrits — en attente de paiement (gestionnaire / admin).'
                : 'Commentaire enregistré pour les résultats de labos.',
    )
    messageType.value = 'success'
    closeModal()
    await loadVisits()
  } catch (error: unknown) {
    const shown = await showApiErrorModal(error, "Erreur lors de l'enregistrement de la consultation.")
    if (!shown) {
      message.value = uiText("Erreur lors de l'enregistrement de la consultation.")
      messageType.value = 'error'
    }
  } finally {
    submitting.value = false
  }
}

onMounted(async () => {
  await Promise.all([loadVisits(), loadTransferServices()])
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
      >
        <template v-if="!isAdminSupervision" #actions>
          <div class="consultation-header-actions">
            <UiButton
              variant="secondary"
              size="sm"
              :icon="CircleDollarSign"
              @click="showReceivableModal = true"
            >
              {{ uiText('À percevoir') }}
            </UiButton>
          </div>
        </template>
      </UiPageHeader>

      <UiAlert v-if="message" :type="messageType" :message="message" />

      <MedecinStatsGrid v-if="!isAdminSupervision" :refresh-key="statsRefreshKey" />
    </section>

    <section class="page-with-table__body">
      <UiCard direct :title="isAdminSupervision ? 'Patients en file d\'attente' : 'Patients à consulter'"
        :description="
          isAdminSupervision
            ? uiText('Supervision — lecture seule')
            : uiText('Consulter : dossier, prescription, commentaire final')
        "
        class="ui-card--table-panel consultation-queue-panel"
        :icon="ClipboardList"
        icon-variant="blue"
      >
        <template #actions>
          <UiButton variant="ghost" size="sm" :icon="RefreshCw" :disabled="loading" @click="refreshVisits()">
            {{ uiText('Actualiser') }}
          </UiButton>
        </template>

        <p v-if="!loading && !visits.length" class="empty">
          {{
            uiText(
              isAdminSupervision
                ? 'Aucun patient en file de consultation pour le moment.'
                : 'Aucun patient en attente',
            )
          }}
        </p>
        <ConsultationQueueDataTable
          v-else
          fill
          :visits="visits"
          :selected-id="modalVisitId"
          :loading="loading && !visits.length"
          :read-only="isAdminSupervision"
          @consult="openConsultModal"
          @transfer="openTransferModal"
        />
      </UiCard>
    </section>

    <MedecinReceivableModal
      :open="showReceivableModal"
      @close="showReceivableModal = false"
    />

    <Teleport to="body">
      <div v-if="modalVisit" class="modal-overlay" @click.self="closeModal">
        <div class="modal modal--consult" role="dialog" aria-modal="true" aria-labelledby="consult-modal-title">
          <header class="modal__header">
            <div>
              <h2 id="consult-modal-title">
                {{ fullName(modalVisit.patient.firstName, modalVisit.patient.lastName) }}
              </h2>
              <p>{{ patientMetaLine }} — {{ uiText('Consultation') }}</p>
              <p v-if="vitalsLine" class="modal__vitals">
                <HeartPulse :size="13" />
                {{ vitalsLine }}
              </p>
            </div>
            <button type="button" class="modal__close" :aria-label="uiText('Fermer')" @click="closeModal">
              <X :size="18" />
            </button>
          </header>

          <div class="modal__body">
            <section v-if="loadingHistory || recentResults.length" class="info-section info-section--history">
              <h3>
                <FlaskConical :size="15" />
                {{ uiText('Résultats antérieurs') }}
              </h3>
              <p v-if="loadingHistory" class="comment-hint">{{ uiText('Chargement…') }}</p>
              <PatientMedicalHistory
                v-else
                :entries="recentResults"
                :patient="modalVisit.patient"
                :expand-first="true"
                :show-open-lab-link="true"
                :empty-message="uiText('Aucun résultat labo ou opération enregistré.')"
              />
            </section>

            <div class="consult-tabs" role="tablist" :aria-label="uiText('Sections consultation')">
              <button
                type="button"
                class="consult-tabs__btn"
                :class="{ 'consult-tabs__btn--active': consultModalTab === 'exams' }"
                role="tab"
                :aria-selected="consultModalTab === 'exams'"
                @click="consultModalTab = 'exams'"
              >
                <FlaskConical :size="15" />
                {{ uiText('Examens') }}
                <span v-if="selectedExamsCount" class="consult-tabs__badge">{{ selectedExamsCount }}</span>
              </button>
              <button
                v-if="showConsultationPanel"
                type="button"
                class="consult-tabs__btn"
                :class="{ 'consult-tabs__btn--active': consultModalTab === 'pharmacy' }"
                role="tab"
                :aria-selected="consultModalTab === 'pharmacy'"
                @click="consultModalTab = 'pharmacy'"
              >
                <PillBottle :size="15" />
                <span class="consult-tabs__label">
                  {{ uiText('Pharmacie') }}
                  <small>{{ uiText('facultatif') }}</small>
                </span>
                <span v-if="pharmacyCatalogCount" class="consult-tabs__badge">
                  {{ pharmacyCatalogCount }}
                </span>
              </button>
              <button
                v-if="showConsultationPanel"
                type="button"
                class="consult-tabs__btn"
                :class="{ 'consult-tabs__btn--active': consultModalTab === 'external' }"
                role="tab"
                :aria-selected="consultModalTab === 'external'"
                @click="consultModalTab = 'external'"
              >
                <PenLine :size="15" />
                <span class="consult-tabs__label">
                  {{ uiText('Hors pharmacie') }}
                  <small>{{ uiText('facultatif') }}</small>
                </span>
                <span v-if="pharmacyExternalCount" class="consult-tabs__badge">
                  {{ pharmacyExternalCount }}
                </span>
              </button>
              <button
                type="button"
                class="consult-tabs__btn"
                :class="{ 'consult-tabs__btn--active': consultModalTab === 'notes' }"
                role="tab"
                :aria-selected="consultModalTab === 'notes'"
                @click="consultModalTab = 'notes'"
              >
                <ClipboardList :size="15" />
                <span class="consult-tabs__label">
                  {{ uiText('Notes') }}
                  <small>{{ uiText('facultatif') }}</small>
                </span>
              </button>
            </div>

            <section v-show="consultModalTab === 'exams'" class="info-section info-section--exams">
              <MultiExamPrescriptionPicker
                v-model="selectedExamsByKind"
                v-model:comments="examCommentsByKind"
                v-model:hospitalisation-days="hospitalisationDays"
                v-model:operation-amount-fcfa="operationAmountFcfa"
                :doctor-id="auth.user?.id"
                :hide-consultation-tab="true"
              />
            </section>

            <section
              v-show="consultModalTab === 'notes'"
              class="info-section info-section--comment"
            >
              <h3>
                {{ uiText('Notes cliniques / diagnostic') }}
                <span class="optional-tag">{{ uiText('facultatif') }}</span>
              </h3>
              <p class="comment-hint">
                {{ uiText('La première ligne des notes est enregistrée comme diagnostic.') }}
                {{ finalCommentHint }}
              </p>
              <textarea
                v-model="doctorComment"
                class="doctor-comment"
                rows="4"
                :placeholder="
                  hasOperationSelected
                    ? uiText('Suite opératoire, indications, surveillance…')
                    : uiText('Motif, examen clinique, diagnostic…')
                "
              />
            </section>

            <section
              v-if="showConsultationPanel"
              v-show="consultModalTab === 'pharmacy' || consultModalTab === 'external'"
              class="info-section info-section--pharmacy"
            >
              <DoctorPharmacyOrdonnancePicker
                v-model="pharmacyOrdonnance"
                :mode="consultModalTab === 'external' ? 'external' : 'catalog'"
                :patient="modalVisit?.patient"
                :doctor-name="
                  modalVisit?.assignedDoctor
                    ? `Dr ${fullName(modalVisit.assignedDoctor.firstName, modalVisit.assignedDoctor.lastName)}`
                    : auth.user
                      ? `Dr ${fullName(auth.user.firstName, auth.user.lastName)}`
                      : null
                "
              />
            </section>
          </div>

          <footer class="modal__footer">
            <UiButton variant="ghost" @click="closeModal">{{ uiText('Annuler') }}</UiButton>
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
            <UiSelect v-model="selectedServiceId" label="Service destinataire" required>
              <option value="" disabled>Choisir un service…</option>
              <option v-for="service in transferServiceOptions" :key="service.id" :value="service.id">
                {{ service.name
                }}{{ service.doctorCount ? '' : ` (${uiText('aucun médecin rattaché')})` }}
              </option>
            </UiSelect>
            <p v-if="!transferServiceOptions.length" class="transfer-hint" style="color: var(--danger, #b91c1c)">
              {{ uiText('Aucun service disponible. Créez-en un dans la page Services.') }}
            </p>
            <p v-else class="transfer-hint">
              Le patient apparaîtra en attente de consultation chez le(s) médecin(s) de ce service.
              Dès qu’un médecin démarre la consultation, le patient disparaît des autres files.
            </p>
          </div>

          <footer class="modal__footer">
            <UiButton variant="ghost" @click="closeTransferModal">Annuler</UiButton>
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

.consultation-header-actions {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
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
  max-width: min(52rem, 100%);
  max-height: min(92dvh, 860px);
}

.modal--transfer {
  max-width: 28rem;
}

.modal__vitals {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  margin-top: 0.35rem !important;
  padding: 0.2rem 0.5rem;
  border-radius: 999px;
  background: #f1f5f9;
  color: var(--text) !important;
  font-weight: 600;
}

.info-section--history {
  padding: 0.65rem 0.75rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: #f8fafc;
}

.info-section--history :deep(.timeline) {
  gap: 0.55rem;
}

.info-section--history :deep(.timeline-item__marker) {
  margin-top: 0.75rem;
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

.consult-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  padding: 0.3rem;
  border-radius: 10px;
  background: var(--surface-muted, #f1f5f9);
  border: 1px solid var(--border);
}

.consult-tabs__btn {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  flex: 1 1 auto;
  justify-content: center;
  min-height: 2.4rem;
  padding: 0.45rem 0.75rem;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: 0.8125rem;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.12s, color 0.12s, border-color 0.12s;
}

.consult-tabs__label {
  display: inline-flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.05rem;
  line-height: 1.15;
  text-align: left;
}

.consult-tabs__label small {
  font-size: 0.625rem;
  font-weight: 600;
  color: var(--text-light);
  text-transform: lowercase;
}

.consult-tabs__btn--active .consult-tabs__label small {
  color: var(--primary-600);
}

.optional-tag {
  margin-left: 0.35rem;
  padding: 0.1rem 0.4rem;
  border-radius: 999px;
  background: var(--surface-muted, #f1f5f9);
  color: var(--text-muted);
  font-size: 0.625rem;
  font-weight: 700;
  text-transform: lowercase;
  vertical-align: middle;
}

.consult-tabs__btn--active {
  background: #fff;
  border-color: var(--primary-200);
  color: var(--primary-800);
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06);
}

.consult-tabs__badge {
  min-width: 1.25rem;
  height: 1.25rem;
  padding: 0 0.35rem;
  border-radius: 999px;
  background: var(--primary-600);
  color: #fff;
  font-size: 0.6875rem;
  font-weight: 800;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.section-hint {
  margin: -0.35rem 0 0.65rem;
  font-size: 0.75rem;
  color: var(--text-muted);
  line-height: 1.4;
}

.info-section__count {
  margin-left: 0.15rem;
  min-width: 1.25rem;
  height: 1.25rem;
  padding: 0 0.35rem;
  border-radius: 999px;
  background: var(--surface-muted, #f1f5f9);
  color: var(--text-muted);
  font-size: 0.6875rem;
  font-weight: 800;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.info-section--comment {
  padding: 0.75rem 0.9rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: #fff;
}

.info-section--pharmacy {
  padding: 0.15rem 0;
}

.info-section--pharmacy :deep(.ordo-picker__head h4) {
  margin: 0;
  font-size: 0.9rem;
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
  min-height: 4.5rem;
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
