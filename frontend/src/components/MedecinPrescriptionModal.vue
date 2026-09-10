<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { FlaskConical, HeartPulse, Save, Plus, X, PillBottle, PenLine, Pencil } from '@lucide/vue'
import api from '@/api/client'
import { fullName } from '@/lib/roles'
import { formatAppDateTime } from '@/i18n/locale-format'
import {
  countNewExamsInAppend,
  hasClinicalConsultationSelected,
  hasLabResults,
  parsePrescribedExamsByKind,
  parsePrescribedExamCommentsByKind,
  parsePrescribedHospitalisationDays,
  parsePharmacyOrdonnanceLines,
  isPharmacyCatalogLine,
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
    diagnosis?: string | null
    updatedAt?: string
    labSentToLabAt?: string | null
  } | null
}

const props = withDefaults(
  defineProps<{
    visit: PrescriptionVisit | null
    mode: 'edit' | 'append'
    /** Affiche l’onglet résumé (comme l’ancien « Voir ») en premier. */
    showResumeTab?: boolean
    /** Onglet d’ouverture : résumé (Voir) ou formulaire d’édition (Modifier). */
    startTab?: 'resume' | 'edit' | 'notes'
  }>(),
  {
    showResumeTab: false,
  },
)

const emit = defineEmits<{
  close: []
  saved: []
}>()

const auth = useAuthStore()
const { uiText, examNameText } = useAppI18n()

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
const consultModalTab = ref<'resume' | 'exams' | 'pharmacy' | 'external' | 'notes'>('exams')
/** Mode effectif (peut passer de edit → append depuis le résumé). */
const workingMode = ref<'edit' | 'append'>(props.mode)

const latestVitals = computed(() => sessionVisit.value?.vitalSigns?.[0] ?? null)

const showConsultationPanel = computed(() =>
  hasClinicalConsultationSelected(selectedExamsByKind.value),
)

/** Résultats labo déjà saisis : examens figés ; ordonnance / notes encore modifiables. */
const isLabLocked = computed(() => {
  const notes = sessionVisit.value?.consultation?.clinicalNotes
  return hasLabResults(notes)
})

const canSavePharmacyFollowUp = computed(
  () =>
    workingMode.value === 'edit' &&
    isLabLocked.value &&
    (pharmacyOrdonnance.value.length > 0 || doctorComment.value.trim().length >= 2),
)

const existingExamsByKind = computed(() =>
  parsePrescribedExamsByKind(sessionVisit.value?.consultation?.clinicalNotes),
)

const excludeByKind = computed(() =>
  workingMode.value === 'append' ? existingExamsByKind.value : emptyExamsByKind(),
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
  workingMode.value === 'append'
    ? countNewExamsInAppend(sessionVisit.value?.consultation?.clinicalNotes, selectedExamsByKind.value)
    : countExamsByKind(selectedExamsByKind.value),
)

const selectedInPickerCount = computed(() => countExamsByKind(selectedExamsByKind.value))

const pharmacyCatalogCount = computed(
  () => pharmacyOrdonnance.value.filter((line) => isPharmacyCatalogLine(line)).length,
)

const pharmacyExternalCount = computed(
  () => pharmacyOrdonnance.value.filter((line) => !isPharmacyCatalogLine(line)).length,
)

const addsNewHospitalisation = computed(() => {
  const hadHosp = (existingExamsByKind.value.hospitalisation?.length ?? 0) > 0
  const addsHosp = (selectedExamsByKind.value.hospitalisation?.length ?? 0) > 0
  return addsHosp && !hadHosp
})

const canSubmit = computed(() => {
  if (workingMode.value === 'append') {
    if (newExamsCount.value > 0) return true
    return addsNewHospitalisation.value && (hospitalisationDays.value ?? 0) >= 1
  }
  if (canSavePharmacyFollowUp.value) return true
  if (isLabLocked.value) return false
  if (selectedInPickerCount.value > 0) return true
  return pharmacyOrdonnance.value.length > 0 || doctorComment.value.trim().length >= 2
})

const duplicateSelectionHint = computed(() => {
  if (workingMode.value !== 'append' || !selectedInPickerCount.value || newExamsCount.value > 0) return ''
  return 'Les examens sélectionnés sont déjà prescrits sur ce dossier. Choisissez d\'autres examens.'
})

const labLockedHint = computed(() => {
  if (workingMode.value !== 'edit' || !isLabLocked.value) return ''
  if (consultModalTab.value === 'exams') {
    return 'Des résultats labo sont déjà enregistrés. Pour ajouter des examens, utilisez « Ajouter des examens ». Vous pouvez modifier l’ordonnance pharmacie ici.'
  }
  return ''
})

const modalTitle = computed(() => {
  if (props.showResumeTab && consultModalTab.value === 'resume') return uiText('Dossier consulté')
  if (workingMode.value === 'append') return uiText('Ajouter des examens')
  if (props.startTab === 'notes') return uiText('Modifier le dossier')
  if (isLabLocked.value) return uiText('Ordonnance / notes')
  return uiText('Modifier la prescription')
})

const submitLabel = computed(() => {
  if (workingMode.value === 'append') return uiText('Envoyer au labo')
  if (isLabLocked.value) return uiText('Enregistrer l’ordonnance')
  return uiText('Enregistrer la prescription')
})

const resumeExamSections = computed(() => {
  const source =
    workingMode.value === 'append' ? existingExamsByKind.value : selectedExamsByKind.value
  const comments =
    workingMode.value === 'append' ? existingCommentsByKind.value : examCommentsByKind.value
  return EXAM_KIND_ORDER.map((kind) => ({
    kind,
    label: EXAM_KIND_LABELS[kind],
    exams: source[kind] ?? [],
    comment: comments[kind]?.trim() ?? '',
  })).filter((section) => section.exams.length > 0 || section.comment)
})

const resumePharmacyCount = computed(() => resumePharmacyLines.value.length)

const resumePharmacyLines = computed((): PharmacyOrdonnanceLine[] => {
  if (workingMode.value === 'append') {
    return parsePharmacyOrdonnanceLines(sessionVisit.value?.consultation?.clinicalNotes)
  }
  return pharmacyOrdonnance.value
})

const resumeDoctorComment = computed(() =>
  workingMode.value === 'append'
    ? sessionVisit.value?.consultation?.doctorComment?.trim() || ''
    : doctorComment.value.trim(),
)

/** Diagnostic enregistré (champ dédié) ou 1ʳᵉ ligne des notes cliniques. */
const resumeDiagnosis = computed(() => {
  const comment = resumeDoctorComment.value
  const fromComment =
    comment
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) || ''
  if (workingMode.value !== 'append' && fromComment) return fromComment
  return sessionVisit.value?.consultation?.diagnosis?.trim() || fromComment
})

const catalogPharmacyLines = computed(() =>
  pharmacyOrdonnance.value.filter((line) => isPharmacyCatalogLine(line)),
)

const externalPharmacyLines = computed(() =>
  pharmacyOrdonnance.value.filter((line) => !isPharmacyCatalogLine(line)),
)

const patientMetaLine = computed(() => {
  if (!sessionVisit.value) return ''
  const parts = [sessionVisit.value.patient.code]
  if (sessionVisit.value.patient.phone) parts.push(sessionVisit.value.patient.phone)
  parts.push(formatAppDateTime(sessionVisit.value.createdAt))
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

const existingExamsFlat = computed(() =>
  existingExamSections.value.flatMap((section) =>
    section.exams.map((exam) => ({
      key: `${section.kind}-${exam}`,
      label: exam,
      kindLabel: section.label,
    })),
  ),
)

function resetForm() {
  workingMode.value = props.mode
  const startOnNotes = props.startTab === 'notes'
  const startOnEdit = props.startTab === 'edit' || (!props.showResumeTab && props.mode === 'edit')
  if (startOnNotes) {
    consultModalTab.value = 'notes'
  } else if (startOnEdit) {
    consultModalTab.value = isLabLocked.value ? 'pharmacy' : 'exams'
  } else {
    consultModalTab.value = props.showResumeTab && props.mode === 'edit' ? 'resume' : 'exams'
  }
  if (!sessionVisit.value) {
    selectedExamsByKind.value = emptyExamsByKind()
    examCommentsByKind.value = emptyExamCommentsByKind()
    hospitalisationDays.value = null
    doctorComment.value = ''
    pharmacyOrdonnance.value = []
    operationAmountFcfa.value = null
    return
  }
  if (workingMode.value === 'append') {
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

function switchToEditFromResume() {
  workingMode.value = 'edit'
  selectedExamsByKind.value = parsePrescribedExamsByKind(sessionVisit.value?.consultation?.clinicalNotes)
  examCommentsByKind.value = parsePrescribedExamCommentsByKind(sessionVisit.value?.consultation?.clinicalNotes)
  hospitalisationDays.value = parsePrescribedHospitalisationDays(sessionVisit.value?.consultation?.clinicalNotes)
  doctorComment.value = sessionVisit.value?.consultation?.doctorComment?.trim() ?? ''
  pharmacyOrdonnance.value = parsePharmacyOrdonnanceLines(sessionVisit.value?.consultation?.clinicalNotes)
  consultModalTab.value = isLabLocked.value ? 'pharmacy' : 'exams'
}

function switchToAppendFromResume() {
  workingMode.value = 'append'
  selectedExamsByKind.value = emptyExamsByKind()
  examCommentsByKind.value = emptyExamCommentsByKind()
  hospitalisationDays.value = null
  doctorComment.value = ''
  pharmacyOrdonnance.value = []
  operationAmountFcfa.value = null
  consultModalTab.value = 'exams'
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

  if (workingMode.value === 'append' && newExamsCount.value === 0 && !addsNewHospitalisation.value) {
    errorMessage.value = 'Sélectionnez au moins un nouvel examen à ajouter.'
    return
  }

  // Résultats labo déjà saisis : enregistrer seulement pharmacie / notes (sans réécrire les examens).
  if (workingMode.value === 'edit' && isLabLocked.value) {
    if (!canSavePharmacyFollowUp.value) {
      errorMessage.value = uiText('Ajoutez au moins un produit ou une note clinique (2 caractères min.).')
      return
    }
    submitting.value = true
    errorMessage.value = ''
    try {
      await api.post('/consultations/prescribe-exams', {
        visitId: sessionVisit.value.id,
        pharmacyOrdonnance: pharmacyOrdonnance.value,
        doctorComment: doctorComment.value.trim() || undefined,
      })
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
    return
  }

  if (
    workingMode.value === 'edit' &&
    !selectedInPickerCount.value &&
    !(pharmacyOrdonnance.value.length || doctorComment.value.trim().length >= 2)
  ) {
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
      examsByKind: selectedInPickerCount.value > 0 ? selectedExamsByKind.value : undefined,
      examCommentsByKind:
        selectedInPickerCount.value > 0
          ? filterInvoiceExamComments(examCommentsByKind.value)
          : undefined,
      hospitalisationDays:
        selectedInPickerCount.value > 0 && hospPrescribed
          ? hospitalisationDays.value ?? undefined
          : undefined,
      doctorComment: doctorComment.value.trim() || undefined,
      pharmacyOrdonnance:
        workingMode.value === 'append'
          ? undefined
          : showConsultationPanel.value || props.showResumeTab
            ? pharmacyOrdonnance.value
            : pharmacyOrdonnance.value.length
              ? pharmacyOrdonnance.value
              : undefined,
      append: workingMode.value === 'append',
      ...(
        selectedInPickerCount.value > 0 &&
        (selectedExamsByKind.value.operation?.length ?? 0) > 0 &&
        operationAmountFcfa.value != null
          ? { operationAmountFcfa: operationAmountFcfa.value }
          : {}
      ),
    })
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
            <p>{{ patientMetaLine }} — {{ modalTitle }}</p>
            <p v-if="vitalsLine" class="modal__vitals">
              <HeartPulse :size="13" />
              {{ vitalsLine }}
            </p>
          </div>
          <button type="button" class="modal__close" :aria-label="uiText('Fermer')" @click="emit('close')">
            <X :size="18" />
          </button>
        </header>

        <div class="modal__body">
          <p v-if="errorMessage" class="modal-error">{{ errorMessage }}</p>
          <p v-else-if="duplicateSelectionHint" class="modal-hint">{{ uiText(duplicateSelectionHint) }}</p>
          <p v-else-if="labLockedHint" class="modal-hint">{{ uiText(labLockedHint) }}</p>

          <section
            v-if="workingMode === 'append' && existingExamsFlat.length"
            class="info-section info-section--existing"
          >
            <h3>
              <FlaskConical :size="15" />
              {{ uiText('Déjà prescrits') }}
              <span class="info-section__count">{{ existingExamsFlat.length }}</span>
            </h3>
            <div class="existing-chips">
              <button
                v-for="exam in existingExamsFlat"
                :key="exam.key"
                type="button"
                class="existing-chip"
                :title="uiText(exam.kindLabel)"
                disabled
              >
                {{ examNameText(exam.label) }}
              </button>
            </div>
          </section>

          <div
            class="consult-tabs"
            role="tablist"
            :aria-label="uiText('Sections consultation')"
          >
            <button
              v-if="showResumeTab"
              type="button"
              class="consult-tabs__btn"
              :class="{ 'consult-tabs__btn--active': consultModalTab === 'resume' }"
              role="tab"
              :aria-selected="consultModalTab === 'resume'"
              @click="consultModalTab = 'resume'"
            >
              {{ uiText('Résumé') }}
            </button>
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
              <span v-if="selectedInPickerCount" class="consult-tabs__badge">{{ selectedInPickerCount }}</span>
            </button>
            <button
              v-if="showConsultationPanel || showResumeTab"
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
              v-if="showConsultationPanel || showResumeTab"
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
              <span class="consult-tabs__label">
                {{ uiText('Notes') }}
                <small>{{ uiText('facultatif') }}</small>
              </span>
            </button>
          </div>

          <section v-show="consultModalTab === 'resume'" class="info-section info-section--resume">
            <h3>{{ uiText('Informations patient') }}</h3>
            <dl class="info-grid">
              <div>
                <dt>{{ uiText('Matricule') }}</dt>
                <dd>{{ sessionVisit.patient.code }}</dd>
              </div>
              <div v-if="sessionVisit.patient.phone">
                <dt>{{ uiText('Téléphone') }}</dt>
                <dd>{{ sessionVisit.patient.phone }}</dd>
              </div>
              <div v-if="sessionVisit.assignedDoctor">
                <dt>{{ uiText('Médecin assigné') }}</dt>
                <dd>
                  Dr
                  {{
                    fullName(
                      sessionVisit.assignedDoctor.firstName,
                      sessionVisit.assignedDoctor.lastName,
                    )
                  }}
                </dd>
              </div>
              <div>
                <dt>{{ uiText('Consulté le') }}</dt>
                <dd>
                  {{
                    formatAppDateTime(
                      sessionVisit.consultation?.updatedAt ?? sessionVisit.updatedAt,
                    )
                  }}
                </dd>
              </div>
            </dl>

            <div v-if="latestVitals" class="resume-vitals">
              <h4>
                <HeartPulse :size="14" />
                {{ uiText('Constantes (réception)') }}
              </h4>
              <p>{{ vitalsLine }}</p>
            </div>

            <h3>
              <FlaskConical :size="15" />
              {{ uiText('Examens prescrits') }}
              <span v-if="resumeExamSections.length" class="info-section__count">
                {{
                  resumeExamSections.reduce((sum, section) => sum + section.exams.length, 0)
                }}
              </span>
            </h3>
            <p v-if="!resumeExamSections.length" class="section-hint">
              {{ uiText('Aucun examen prescrit pour cette consultation.') }}
            </p>
            <div v-else class="resume-exam-sections">
              <div v-for="section in resumeExamSections" :key="section.kind" class="resume-exam-section">
                <h4>{{ uiText(section.label) }}</h4>
                <ul v-if="section.exams.length">
                  <li v-for="exam in section.exams" :key="`${section.kind}-${exam}`">
                    {{ examNameText(exam) }}
                  </li>
                </ul>
                <p v-if="section.comment" class="resume-comment">{{ section.comment }}</p>
              </div>
            </div>

            <div class="resume-block">
              <h3>{{ uiText('Diagnostic') }}</h3>
              <p v-if="resumeDiagnosis" class="resume-block__text">{{ resumeDiagnosis }}</p>
              <p v-else class="section-hint">{{ uiText('Aucun diagnostic enregistré.') }}</p>
            </div>

            <div class="resume-block">
              <h3>{{ uiText('Notes cliniques') }}</h3>
              <p v-if="resumeDoctorComment" class="resume-block__text resume-block__text--pre">
                {{ resumeDoctorComment }}
              </p>
              <p v-else class="section-hint">{{ uiText('Aucune note clinique.') }}</p>
            </div>

            <div class="resume-block">
              <h3>
                {{ uiText('Prescriptions') }}
                <span v-if="resumePharmacyCount" class="info-section__count">
                  {{ resumePharmacyCount }}
                </span>
              </h3>
              <p v-if="!resumePharmacyCount" class="section-hint">
                {{ uiText('Aucune prescription pharmacie.') }}
              </p>
              <ul v-else class="resume-rx-list">
                <li v-for="(line, index) in resumePharmacyLines" :key="`${line.name}-${index}`">
                  <strong>{{ line.name }}</strong>
                  <span v-if="line.dosage" class="resume-rx-meta">{{ line.dosage }}</span>
                  <span class="resume-rx-meta">× {{ line.quantity }}</span>
                  <span
                    v-if="!isPharmacyCatalogLine(line)"
                    class="resume-rx-badge"
                  >{{ uiText('Hors stock') }}</span>
                  <em v-if="line.instructions">{{ line.instructions }}</em>
                </li>
              </ul>
            </div>
          </section>

          <section v-if="consultModalTab === 'exams'" class="info-section info-section--picker">
            <MultiExamPrescriptionPicker
              v-model="selectedExamsByKind"
              v-model:comments="examCommentsByKind"
              v-model:hospitalisation-days="hospitalisationDays"
              v-model:operation-amount-fcfa="operationAmountFcfa"
              :exclude-by-kind="excludeByKind"
              :doctor-id="auth.user?.id"
            />
          </section>

          <section
            v-show="consultModalTab === 'notes'"
            class="info-section info-section--consultation"
          >
            <div v-if="resumeDiagnosis" class="current-diag">
              <strong>{{ uiText('Diagnostic enregistré') }}</strong>
              <p>{{ resumeDiagnosis }}</p>
            </div>
            <UiTextarea
              v-model="doctorComment"
              :label="uiText('Notes cliniques / diagnostic')"
              :rows="4"
              :placeholder="uiText('Motif, examen clinique, diagnostic…')"
            />
            <p class="section-hint">
              {{ uiText('La première ligne des notes est enregistrée comme diagnostic.') }}
            </p>
          </section>

          <section
            v-if="showConsultationPanel || showResumeTab"
            v-show="consultModalTab === 'pharmacy' || consultModalTab === 'external'"
            class="info-section info-section--pharmacy"
          >
            <div
              v-if="
                (consultModalTab === 'pharmacy' && catalogPharmacyLines.length) ||
                (consultModalTab === 'external' && externalPharmacyLines.length)
              "
              class="current-rx"
            >
              <strong>
                {{
                  consultModalTab === 'external'
                    ? uiText('Prescriptions hors pharmacie')
                    : uiText('Prescriptions en stock')
                }}
              </strong>
              <ul class="resume-rx-list">
                <li
                  v-for="(line, index) in consultModalTab === 'external'
                    ? externalPharmacyLines
                    : catalogPharmacyLines"
                  :key="`tab-${line.name}-${index}`"
                >
                  <strong>{{ line.name }}</strong>
                  <span v-if="line.dosage" class="resume-rx-meta">{{ line.dosage }}</span>
                  <span class="resume-rx-meta">× {{ line.quantity }}</span>
                  <em v-if="line.instructions">{{ line.instructions }}</em>
                </li>
              </ul>
            </div>
            <DoctorPharmacyOrdonnancePicker
              v-model="pharmacyOrdonnance"
              :mode="consultModalTab === 'external' ? 'external' : 'catalog'"
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
          <UiButton variant="ghost" @click="emit('close')">
            {{ consultModalTab === 'resume' ? uiText('Fermer') : uiText('Annuler') }}
          </UiButton>
          <template v-if="consultModalTab === 'resume' && showResumeTab">
            <UiButton variant="primary" :icon="Plus" @click="switchToAppendFromResume">
              {{ uiText('Ajouter des examens') }}
            </UiButton>
            <UiButton variant="secondary" :icon="Pencil" @click="switchToEditFromResume">
              {{ isLabLocked ? uiText('Ordonnance / notes') : uiText('Modifier') }}
            </UiButton>
          </template>
          <UiButton
            v-else
            variant="primary"
            :icon="workingMode === 'append' ? Plus : Save"
            :disabled="submitting || !canSubmit"
            @click="submit"
          >
            {{ submitting ? uiText('Enregistrement…') : submitLabel }}
            <span v-if="workingMode === 'append' && newExamsCount > 0" class="submit-badge">
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
  max-width: min(52rem, 100%);
  max-height: min(92dvh, 860px);
}

.info-section--consultation {
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 0.75rem 0.9rem;
  background: #fff;
}

.info-section--pharmacy {
  padding: 0.15rem 0;
}

.info-section--resume .info-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.55rem 1rem;
  margin: 0 0 0.85rem;
}

.info-section--resume dt {
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-light);
  margin-bottom: 0.1rem;
}

.info-section--resume dd {
  margin: 0;
  font-size: 0.875rem;
  font-weight: 600;
}

.resume-vitals {
  margin: 0 0 0.85rem;
  padding: 0.65rem 0.75rem;
  border-radius: var(--radius-sm);
  background: #f8fafc;
  border: 1px solid var(--border);
}

.resume-vitals h4 {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  margin: 0 0 0.3rem;
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--primary-800);
}

.resume-vitals p {
  margin: 0;
  font-size: 0.8125rem;
  font-weight: 600;
}

.resume-exam-sections {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.resume-exam-section h4 {
  margin: 0 0 0.25rem;
  font-size: 0.6875rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-light);
}

.resume-exam-section ul {
  margin: 0;
  padding-left: 1.1rem;
  font-size: 0.8125rem;
}

.resume-comment,
.resume-note {
  margin: 0.35rem 0 0;
  font-size: 0.8125rem;
  color: var(--text-muted);
  line-height: 1.4;
}

.resume-block {
  margin-top: 0.85rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--border);
}

.resume-block h3 {
  margin-bottom: 0.45rem;
}

.resume-block__text {
  margin: 0;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text);
  line-height: 1.45;
}

.resume-block__text--pre {
  white-space: pre-wrap;
  font-weight: 500;
}

.resume-rx-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.resume-rx-list li {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.35rem 0.55rem;
  padding: 0.5rem 0.65rem;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: #fff;
  font-size: 0.8125rem;
}

.resume-rx-list em {
  flex-basis: 100%;
  font-style: normal;
  color: var(--text-muted);
  font-size: 0.75rem;
}

.resume-rx-meta {
  color: var(--text-muted);
  font-weight: 600;
}

.resume-rx-badge {
  padding: 0.1rem 0.4rem;
  border-radius: 999px;
  background: #fffbeb;
  border: 1px solid #fde68a;
  color: #92400e;
  font-size: 0.625rem;
  font-weight: 700;
}

.current-diag,
.current-rx {
  margin-bottom: 0.75rem;
  padding: 0.65rem 0.75rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--primary-100);
  background: var(--primary-50, #eff6ff);
}

.current-diag strong,
.current-rx strong {
  display: block;
  margin-bottom: 0.35rem;
  font-size: 0.75rem;
  color: var(--primary-800);
}

.current-diag p {
  margin: 0;
  font-size: 0.875rem;
  font-weight: 600;
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

.modal__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem 1.25rem 0;
  flex-shrink: 0;
}

.modal__header h2 {
  margin: 0;
  font-size: 1.1rem;
}

.modal__header p {
  margin: 0.25rem 0 0;
  font-size: 0.75rem;
  color: var(--text-muted);
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
  padding: 0.85rem 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.modal-error {
  margin: 0;
  padding: 0.55rem 0.75rem;
  border-radius: var(--radius-sm);
  background: var(--danger-bg);
  color: var(--danger);
  font-size: 0.8125rem;
}

.modal-hint {
  margin: 0;
  padding: 0.55rem 0.75rem;
  border-radius: var(--radius-sm);
  background: #fffbeb;
  border: 1px solid #fde68a;
  color: #92400e;
  font-size: 0.8125rem;
}

.section-hint {
  margin: -0.25rem 0 0.55rem;
  font-size: 0.75rem;
  color: var(--text-muted);
}

.info-section h3 {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  margin: 0 0 0.55rem;
  font-size: 0.8125rem;
  font-weight: 700;
  color: var(--primary-800);
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

.info-section--existing {
  padding: 0.65rem 0.75rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: #f8fafc;
}

.existing-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.existing-chip {
  display: inline-flex;
  align-items: center;
  padding: 0.4rem 0.7rem;
  border-radius: 999px;
  background: #fff;
  border: 1px solid var(--border);
  font: inherit;
  font-size: 0.75rem;
  font-weight: 650;
  color: var(--text-muted);
  cursor: default;
}

.modal__footer {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-items: center;
  gap: 0.65rem;
  padding: 0.85rem 1.25rem 1.1rem;
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
  .modal-overlay {
    padding: 0.5rem;
  }

  .modal--consult {
    max-height: 96dvh;
  }
}
</style>
