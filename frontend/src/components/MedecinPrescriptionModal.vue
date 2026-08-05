<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { FlaskConical, HeartPulse, Save, Plus, X } from '@lucide/vue'
import api from '@/api/client'
import { fullName } from '@/lib/roles'
import { formatAppDateTime } from '@/i18n/locale-format'
import {
  countNewExamsInAppend,
  hasClinicalConsultationSelected,
  parsePrescribedExamsByKind,
  parsePrescribedExamCommentsByKind,
  parsePrescribedHospitalisationDays,
  parsePharmacyOrdonnanceLines,
  type PharmacyOrdonnanceLine,
} from '@/lib/lab-notes'
import MultiExamPrescriptionPicker from '@/components/MultiExamPrescriptionPicker.vue'
import DoctorPharmacyOrdonnancePicker from '@/components/DoctorPharmacyOrdonnancePicker.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiTextarea from '@/components/ui/UiTextarea.vue'
import {
  countExamsByKind,
  emptyExamsByKind,
  emptyExamCommentsByKind,
  EXAM_KIND_LABELS,
  EXAM_KIND_ORDER,
  INVOICE_EXAM_COMMENT_KINDS,
  filterInvoiceExamComments,
  type ExamsByKind,
  type ExamCommentsByKind,
} from '@/lib/exam-catalog'
import { useAuthStore } from '@/stores/auth'
import { useAppI18n } from '@/i18n/useAppI18n'

export type PrescriptionVisit = {
  id: string
  createdAt: string
  updatedAt: string
  patient: {
    firstName: string
    lastName: string
    code: string
    phone?: string | null
    category?: string
    ongName?: string | null
  }
  assignedDoctor?: { firstName: string; lastName: string } | null
  vitalSigns?: Array<{
    weightKg?: number | null
    bloodPressure?: string | null
    temperatureC?: number | null
    pulseBpm?: number | null
    recordedAt: string
  }>
  consultation?: {
    clinicalNotes?: string | null
    doctorComment?: string | null
    updatedAt?: string
  } | null
}

const props = defineProps<{
  visit: PrescriptionVisit | null
  mode: 'edit' | 'append'
}>()

const emit = defineEmits<{
  close: []
  saved: []
}>()

const auth = useAuthStore()
const { uiText } = useAppI18n()

/** Visite figée à l'ouverture — évite la perte de sélection lors des rafraîchissements liste. */
const sessionVisit = ref<PrescriptionVisit | null>(null)

const submitting = ref(false)
const errorMessage = ref('')
const selectedExamsByKind = ref<ExamsByKind>(emptyExamsByKind())
const examCommentsByKind = ref<ExamCommentsByKind>(emptyExamCommentsByKind())
const hospitalisationDays = ref<number | null>(null)
const doctorComment = ref('')
const pharmacyOrdonnance = ref<PharmacyOrdonnanceLine[]>([])
const operationAmountFcfa = ref<number | null>(null)

const latestVitals = computed(() => sessionVisit.value?.vitalSigns?.[0] ?? null)

const showConsultationPanel = computed(() =>
  hasClinicalConsultationSelected(selectedExamsByKind.value),
)

const existingExamsByKind = computed(() =>
  parsePrescribedExamsByKind(sessionVisit.value?.consultation?.clinicalNotes),
)

const excludeByKind = computed(() =>
  props.mode === 'append' ? existingExamsByKind.value : emptyExamsByKind(),
)

const existingCommentsByKind = computed(() =>
  parsePrescribedExamCommentsByKind(sessionVisit.value?.consultation?.clinicalNotes),
)

const existingExamSections = computed(() =>
  EXAM_KIND_ORDER.map((kind) => ({
    kind,
    label: EXAM_KIND_LABELS[kind],
    exams: existingExamsByKind.value[kind],
    comment: INVOICE_EXAM_COMMENT_KINDS.includes(kind)
      ? (existingCommentsByKind.value[kind]?.trim() ?? '')
      : '',
  })).filter((section) => section.exams.length > 0 || section.comment),
)

const newExamsCount = computed(() =>
  props.mode === 'append'
    ? countNewExamsInAppend(sessionVisit.value?.consultation?.clinicalNotes, selectedExamsByKind.value)
    : countExamsByKind(selectedExamsByKind.value),
)

const selectedInPickerCount = computed(() => countExamsByKind(selectedExamsByKind.value))

const addsNewHospitalisation = computed(() => {
  const hadHosp = (existingExamsByKind.value.hospitalisation?.length ?? 0) > 0
  const addsHosp = (selectedExamsByKind.value.hospitalisation?.length ?? 0) > 0
  return addsHosp && !hadHosp
})

const canSubmit = computed(() => {
  if (props.mode === 'append') {
    if (newExamsCount.value > 0) return true
    return addsNewHospitalisation.value && (hospitalisationDays.value ?? 0) >= 1
  }
  return selectedInPickerCount.value > 0
})

const duplicateSelectionHint = computed(() => {
  if (props.mode !== 'append' || !selectedInPickerCount.value || newExamsCount.value > 0) return ''
  return 'Les examens sélectionnés sont déjà prescrits sur ce dossier. Choisissez d\'autres examens.'
})

const modalTitle = computed(() =>
  props.mode === 'append' ? 'Ajouter des examens' : 'Modifier la prescription',
)

const submitLabel = computed(() =>
  props.mode === 'append' ? 'Ajouter les examens' : 'Enregistrer les modifications',
)

function resetForm() {
  if (!sessionVisit.value) {
    selectedExamsByKind.value = emptyExamsByKind()
    examCommentsByKind.value = emptyExamCommentsByKind()
    hospitalisationDays.value = null
    doctorComment.value = ''
    pharmacyOrdonnance.value = []
    operationAmountFcfa.value = null
    return
  }
  if (props.mode === 'append') {
    selectedExamsByKind.value = emptyExamsByKind()
    examCommentsByKind.value = emptyExamCommentsByKind()
    hospitalisationDays.value = null
    doctorComment.value = ''
    pharmacyOrdonnance.value = []
    operationAmountFcfa.value = null
  } else {
    selectedExamsByKind.value = parsePrescribedExamsByKind(sessionVisit.value.consultation?.clinicalNotes)
    examCommentsByKind.value = parsePrescribedExamCommentsByKind(sessionVisit.value.consultation?.clinicalNotes)
    hospitalisationDays.value = parsePrescribedHospitalisationDays(sessionVisit.value.consultation?.clinicalNotes)
    doctorComment.value = sessionVisit.value.consultation?.doctorComment?.trim() ?? ''
    pharmacyOrdonnance.value = parsePharmacyOrdonnanceLines(sessionVisit.value.consultation?.clinicalNotes)
    operationAmountFcfa.value = null
  }
  errorMessage.value = ''
}

watch(
  () => props.visit,
  (visit) => {
    if (!visit) {
      sessionVisit.value = null
      return
    }
    if (!sessionVisit.value || sessionVisit.value.id !== visit.id) {
      sessionVisit.value = visit
      resetForm()
    }
  },
  { immediate: true },
)

async function submit() {
  if (!sessionVisit.value || !canSubmit.value) return

  if (props.mode === 'append' && newExamsCount.value === 0 && !addsNewHospitalisation.value) {
    errorMessage.value = 'Sélectionnez au moins un nouvel examen à ajouter.'
    return
  }
  if (props.mode === 'edit' && !selectedInPickerCount.value) {
    errorMessage.value = 'Sélectionnez au moins un examen.'
    return
  }
  const hospPrescribed = (selectedExamsByKind.value.hospitalisation?.length ?? 0) > 0
  if (hospPrescribed && (hospitalisationDays.value ?? 0) < 1) {
    errorMessage.value = 'Indiquez le nombre de jours d\'hospitalisation.'
    return
  }

  submitting.value = true
  errorMessage.value = ''
  try {
    await api.post('/consultations/prescribe-exams', {
      visitId: sessionVisit.value.id,
      examsByKind: selectedExamsByKind.value,
      examCommentsByKind: filterInvoiceExamComments(examCommentsByKind.value),
      hospitalisationDays: hospPrescribed ? hospitalisationDays.value ?? undefined : undefined,
      doctorComment: doctorComment.value.trim() || undefined,
      pharmacyOrdonnance: showConsultationPanel.value ? pharmacyOrdonnance.value : undefined,
      append: props.mode === 'append',
      ...(
        (selectedExamsByKind.value.operation?.length ?? 0) > 0 && operationAmountFcfa.value != null
          ? { operationAmountFcfa: operationAmountFcfa.value }
          : {}
      ),
    })
    if (showConsultationPanel.value && pharmacyOrdonnance.value.length) {
      const { printPharmacyOrdonnance } = await import('@/lib/pharmacy-ordonnance-print')
      printPharmacyOrdonnance({
        patient: sessionVisit.value.patient,
        doctorName: sessionVisit.value.assignedDoctor
          ? `Dr ${fullName(sessionVisit.value.assignedDoctor.firstName, sessionVisit.value.assignedDoctor.lastName)}`
          : auth.user
            ? `Dr ${fullName(auth.user.firstName, auth.user.lastName)}`
            : null,
        lines: pharmacyOrdonnance.value,
      })
    }
    emit('saved')
    emit('close')
  } catch (error: unknown) {
    const apiMessage =
      error && typeof error === 'object' && 'response' in error
        ? (error as { response?: { data?: { error?: string } } }).response?.data?.error
        : undefined
    errorMessage.value = apiMessage ?? 'Erreur lors de l\'enregistrement de la prescription.'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="sessionVisit" class="modal-overlay" @click.self="emit('close')">
      <div class="modal modal--consult" role="dialog" aria-modal="true" aria-labelledby="prescription-modal-title">
        <header class="modal__header">
          <div>
            <h2 id="prescription-modal-title">
              {{ fullName(sessionVisit.patient.firstName, sessionVisit.patient.lastName) }}
            </h2>
            <p>{{ sessionVisit.patient.code }} — {{ modalTitle }}</p>
          </div>
          <button type="button" class="modal__close" aria-label="Fermer" @click="emit('close')">
            <X :size="18" />
          </button>
        </header>

        <div class="modal__body">
          <p v-if="errorMessage" class="modal-error">{{ errorMessage }}</p>
          <p v-else-if="duplicateSelectionHint" class="modal-hint">{{ duplicateSelectionHint }}</p>

          <section class="info-section">
            <h3>Informations patient</h3>
            <dl class="info-grid">
              <div>
                <dt>Matricule</dt>
                <dd>{{ sessionVisit.patient.code }}</dd>
              </div>
              <div v-if="sessionVisit.patient.phone">
                <dt>Téléphone</dt>
                <dd>{{ sessionVisit.patient.phone }}</dd>
              </div>
              <div v-if="sessionVisit.assignedDoctor">
                <dt>Médecin assigné</dt>
                <dd>Dr {{ fullName(sessionVisit.assignedDoctor.firstName, sessionVisit.assignedDoctor.lastName) }}</dd>
              </div>
              <div>
                <dt>Arrivée</dt>
                <dd>{{ formatAppDateTime(sessionVisit.createdAt) }}</dd>
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

          <section v-if="mode === 'append' && existingExamSections.length" class="info-section">
            <h3>
              <FlaskConical :size="16" />
              Examens déjà prescrits
            </h3>
            <div class="exam-sections">
              <div v-for="section in existingExamSections" :key="section.kind" class="exam-section">
                <h4>{{ uiText(section.label) }}</h4>
                <ul v-if="section.exams.length" class="exam-list">
                  <li v-for="exam in section.exams" :key="`${section.kind}-${exam}`">{{ uiText(exam) }}</li>
                </ul>
                <p v-if="section.comment" class="exam-comment">{{ section.comment }}</p>
              </div>
            </div>
          </section>

          <section class="info-section">
            <h3>
              <FlaskConical :size="16" />
              {{ mode === 'append' ? 'Nouveaux examens à prescrire' : 'Examens prescrits' }}
            </h3>
            <p v-if="mode === 'append'" class="section-hint">
              Seuls les examens pas encore prescrits sont proposés dans la liste.
            </p>
            <MultiExamPrescriptionPicker
              v-model="selectedExamsByKind"
              v-model:comments="examCommentsByKind"
              v-model:hospitalisation-days="hospitalisationDays"
              v-model:operation-amount-fcfa="operationAmountFcfa"
              :exclude-by-kind="excludeByKind"
              :doctor-id="auth.user?.id"
            />
          </section>

          <section v-if="showConsultationPanel" class="info-section info-section--consultation">
            <h3>Consultation clinique</h3>
            <p class="section-hint">
              Paiement déjà effectué à la réception — aucun envoi au laboratoire ni second encaissement examens.
              Saisissez les informations cliniques et composez l’ordonnance pharmacie.
            </p>
            <UiTextarea
              v-model="doctorComment"
              label="Informations cliniques"
              :rows="5"
              placeholder="Motif, examen clinique, diagnostic, conduite à tenir…"
            />
            <DoctorPharmacyOrdonnancePicker
              v-model="pharmacyOrdonnance"
              :patient="sessionVisit.patient"
              :doctor-name="
                sessionVisit.assignedDoctor
                  ? `Dr ${fullName(sessionVisit.assignedDoctor.firstName, sessionVisit.assignedDoctor.lastName)}`
                  : auth.user
                    ? `Dr ${fullName(auth.user.firstName, auth.user.lastName)}`
                    : null
              "
            />
          </section>
        </div>

        <footer class="modal__footer">
          <UiButton variant="ghost" @click="emit('close')">Annuler</UiButton>
          <UiButton
            variant="primary"
            :icon="mode === 'append' ? Plus : Save"
            :disabled="submitting || !canSubmit"
            @click="submit"
          >
            {{ submitting ? 'Enregistrement…' : submitLabel }}
            <span v-if="mode === 'append' && newExamsCount > 0" class="submit-badge">
              +{{ newExamsCount }}
            </span>
          </UiButton>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
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

.info-section--consultation {
  border: 1px solid var(--primary-200);
  border-radius: var(--radius-sm);
  padding: 0.85rem 1rem;
  background: linear-gradient(180deg, var(--primary-50), #fff);
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

.modal-error {
  margin: 0;
  padding: 0.65rem 0.85rem;
  border-radius: var(--radius-sm);
  background: var(--danger-bg);
  color: var(--danger);
  font-size: 0.8125rem;
}

.modal-hint {
  margin: 0;
  padding: 0.65rem 0.85rem;
  border-radius: var(--radius-sm);
  background: #fffbeb;
  border: 1px solid #fde68a;
  color: #92400e;
  font-size: 0.8125rem;
}

.section-hint {
  margin: -0.35rem 0 0.65rem;
  font-size: 0.75rem;
  color: var(--text-muted);
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

.exam-sections {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.exam-section h4 {
  margin: 0 0 0.4rem;
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--primary-700);
}

.exam-list {
  margin: 0;
  padding-left: 1.15rem;
}

.exam-list li {
  font-size: 0.875rem;
  font-weight: 500;
  padding: 0.15rem 0;
  color: var(--text);
}

.exam-comment {
  margin: 0.35rem 0 0;
  padding: 0.5rem 0.65rem;
  border-radius: 6px;
  background: var(--accent-50);
  border: 1px solid var(--accent-100);
  font-size: 0.8125rem;
  color: var(--text);
  line-height: 1.45;
}

.modal__footer {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-items: center;
  gap: 0.65rem;
  padding: 1rem 1.5rem 1.35rem;
  border-top: 1px solid var(--border);
  flex-shrink: 0;
}

.submit-badge {
  margin-left: 0.35rem;
  padding: 0.1rem 0.4rem;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.25);
  font-size: 0.6875rem;
  font-weight: 800;
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
