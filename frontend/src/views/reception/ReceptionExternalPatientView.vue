<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  UserRound,
  FlaskConical,
  CreditCard,
  Search,
  X,
  RotateCcw,
  Percent,
  UserPlus,
  Printer,
  Pencil,
} from '@lucide/vue'
import api from '@/api/client'
import { showDuplicateModalFromError } from '@/lib/api-modal-helper'
import { formatFcfa, fullName } from '@/lib/roles'
import { parsePatientAge, splitPatientFullName, formatPatientAge } from '@/lib/patient-name'
import { normalizePatientAgeUnit, type PatientAgeUnit } from '@/lib/patient-age'
import { computeGrossFcfaFromExamsByKind, getLabExamPriceFcfa } from '@/lib/lab-exams'
import { CLINIC } from '@/lib/clinic'
import { buildClinicPrintHeader, buildLabExamThermalReceiptHtml, openPrintDocument } from '@/lib/print-document'
import MultiExamPrescriptionPicker from '@/components/MultiExamPrescriptionPicker.vue'
import {
  emptyExamsByKind,
  countExamsByKind,
  EXTERNAL_PATIENT_EXAM_KINDS,
  EXAM_KIND_LABELS,
  type ExamKindSlug,
  type ExamsByKind,
} from '@/lib/exam-catalog'
import {
  doctorClinicServiceNames,
  type DoctorOption,
} from '@/lib/doctor-compensation'
import ReceptionPatientIdentityFields from '@/components/reception/ReceptionPatientIdentityFields.vue'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiFormModal from '@/components/ui/UiFormModal.vue'
import UiBadge from '@/components/ui/UiBadge.vue'
import ReceptionQueueRowActions, {
  type QueueRowAction,
} from '@/components/reception/ReceptionQueueRowActions.vue'
import { useAppI18n } from '@/i18n/useAppI18n'
import { translateTemplate } from '@/lib/dashboard-i18n'

type PatientRow = {
  id: string
  code: string
  firstName: string
  lastName: string
  phone?: string | null
  gender?: string | null
  age?: number | null
  ageUnit?: PatientAgeUnit | null
}

type QueuePatient = {
  id: string
  code: string
  firstName: string
  lastName: string
  phone?: string | null
  gender?: string | null
  age?: number | null
  ageUnit?: PatientAgeUnit | null
}

type ExternalQueueRow = {
  id: string
  visitId: string
  patientId: string
  updatedAt: string
  hasExams: boolean
  examsSummary: string
  grossFcfa: number
  netFcfa: number
  invoiced: boolean
  invoiceNumber?: string | null
  labSentToLabAt: string | null
  service?: string | null
  clinicalNotes?: string | null
  patient: QueuePatient
}

type DraftNewPatient = {
  fullName: string
  age: string
  ageUnit: PatientAgeUnit
  phone: string
  gender: string
}

const { uiText, dateTimeText, localeCode } = useAppI18n()

const search = ref('')
const searchResults = ref<PatientRow[]>([])
const showNewPatientModal = ref(false)
const showExamsModal = ref(false)
const showEditModal = ref(false)
const activeRow = ref<ExternalQueueRow | null>(null)
const editingPatientId = ref<string | null>(null)
const queue = ref<ExternalQueueRow[]>([])
const loadingQueue = ref(false)
const registering = ref(false)

const patientForm = ref<DraftNewPatient>({
  fullName: '',
  age: '',
  ageUnit: 'YEARS',
  phone: '',
  gender: 'F',
})

const editForm = ref({
  fullName: '',
  age: '',
  ageUnit: 'YEARS' as PatientAgeUnit,
  phone: '',
  gender: 'F',
})

const examsByKind = ref<ExamsByKind>(emptyExamsByKind())
const reductionFcfa = ref(0)
/** Montant net facturé (éditable) — défaut = tarif catalogue. */
const amountFcfa = ref('')
const amountManuallyEdited = ref(false)
/** Montant opération personnalisé (depuis le sélecteur). */
const operationAmountFcfa = ref<number | null>(null)
const submitting = ref(false)
const savingEdit = ref(false)
const message = ref('')
const messageType = ref<'success' | 'error'>('success')

const doctors = ref<DoctorOption[]>([])
const selectedDoctorId = ref('')
const activeServiceContext = ref<{
  kind: ExamKindSlug | 'consultation' | null
  clinicServiceId: string | null
  clinicServiceName: string | null
}>({ kind: null, clinicServiceId: null, clinicServiceName: null })

const KIND_SERVICE_ALIASES: Partial<Record<ExamKindSlug, string[]>> = {
  examen: ['Laboratoire', 'Labo'],
  radio: ['Imagerie', 'Radio'],
  echo: ['Echographie', 'Échographie', 'Écho', 'Echo'],
  odonto: ['Odontologie', 'Odonto'],
  operation: ['Bloc opératoire', 'Opération', 'Ophtalmologie', 'Tromatologie', 'Traumatologie'],
}

function doctorMatchesActiveService(doctor: DoctorOption): boolean {
  const ctx = activeServiceContext.value
  if (ctx.clinicServiceId) {
    const ids = doctor.clinicServiceIds ?? []
    if (ids.includes(ctx.clinicServiceId) || doctor.clinicServiceId === ctx.clinicServiceId) {
      return true
    }
  }
  const names = doctorClinicServiceNames(doctor).map((n) => n.toLowerCase())
  if (ctx.clinicServiceName) {
    const target = ctx.clinicServiceName.toLowerCase()
    if (names.some((n) => n === target || n.includes(target) || target.includes(n))) return true
  }
  const kind = ctx.kind
  if (kind && kind !== 'consultation' && kind !== 'specialty') {
    const aliases = KIND_SERVICE_ALIASES[kind as ExamKindSlug] ?? []
    if (
      aliases.some((alias) =>
        names.some((n) => n === alias.toLowerCase() || n.includes(alias.toLowerCase())),
      )
    ) {
      return true
    }
  }
  return false
}

const doctorsForActiveService = computed(() => {
  const list = doctors.value.filter(
    (d) => d.acceptingPatients !== false && doctorMatchesActiveService(d),
  )
  // Si aucun médecin lié au service, ne pas bloquer : liste vide → message
  return list.sort((a, b) =>
    fullName(a.firstName, a.lastName).localeCompare(fullName(b.firstName, b.lastName), 'fr'),
  )
})

const doctorSelectRequired = computed(() => doctorsForActiveService.value.length > 0)

const activeServiceLabel = computed(() => {
  void localeCode.value
  const name = activeServiceContext.value.clinicServiceName
  if (name) return uiText(name)
  const kind = activeServiceContext.value.kind
  if (kind && kind !== 'consultation') return uiText(EXAM_KIND_LABELS[kind as ExamKindSlug] ?? kind)
  return uiText('Service')
})

function onActiveServiceChange(payload: {
  kind: ExamKindSlug | 'consultation' | null
  clinicServiceId: string | null
  clinicServiceName: string | null
}) {
  activeServiceContext.value = payload
}

watch(doctorsForActiveService, (list) => {
  if (!list.length) {
    selectedDoctorId.value = ''
    return
  }
  if (!list.some((d) => d.id === selectedDoctorId.value)) {
    selectedDoctorId.value = list.length === 1 ? list[0].id : ''
  }
})

async function loadDoctors() {
  try {
    const { data } = await api.get<DoctorOption[]>('/visits/doctors')
    doctors.value = Array.isArray(data) ? data : []
  } catch {
    doctors.value = []
  }
}

const parsedName = computed(() => splitPatientFullName(patientForm.value.fullName))
const parsedAge = computed(() => parsePatientAge(patientForm.value.age, patientForm.value.ageUnit))
const editParsedName = computed(() => splitPatientFullName(editForm.value.fullName))
const editParsedAge = computed(() => parsePatientAge(editForm.value.age, editForm.value.ageUnit))

const grossFcfa = computed(() => {
  const base = computeGrossFcfaFromExamsByKind(examsByKind.value)
  const opLabels = examsByKind.value.operation ?? []
  if (!opLabels.length || operationAmountFcfa.value == null) return base
  const catalogOp = opLabels.reduce((sum, label) => sum + getLabExamPriceFcfa(label), 0)
  return Math.max(0, base - catalogOp + operationAmountFcfa.value)
})
const netFcfa = computed(() => {
  const typed = Number(amountFcfa.value)
  if (Number.isFinite(typed) && amountFcfa.value !== '') return Math.max(0, Math.floor(typed))
  return Math.max(0, grossFcfa.value - (Number(reductionFcfa.value) || 0))
})

watch(grossFcfa, (gross) => {
  if (amountManuallyEdited.value) {
    const amount = Number(amountFcfa.value)
    if (Number.isFinite(amount) && amountFcfa.value !== '' && amount <= gross) {
      reductionFcfa.value = Math.max(0, gross - Math.floor(amount))
    }
    return
  }
  amountFcfa.value = gross > 0 ? String(gross) : ''
  reductionFcfa.value = 0
})

function onAmountInput(value: string | number) {
  amountManuallyEdited.value = true
  const raw = String(value ?? '').trim()
  amountFcfa.value = raw
  const amount = Number(raw)
  if (!Number.isFinite(amount) || raw === '') {
    reductionFcfa.value = 0
    return
  }
  const rounded = Math.max(0, Math.floor(amount))
  if (rounded <= grossFcfa.value) {
    reductionFcfa.value = Math.max(0, grossFcfa.value - rounded)
  } else {
    reductionFcfa.value = 0
  }
}

function onReductionInput(value: string | number) {
  amountManuallyEdited.value = true
  const reduction = Math.max(0, Math.floor(Number(value) || 0))
  reductionFcfa.value = Math.min(reduction, grossFcfa.value)
  amountFcfa.value = String(Math.max(0, grossFcfa.value - reductionFcfa.value))
}

const newPatientExamCount = computed(() => countExamsByKind(examsByKind.value))

const canConfirmNewPatient = computed(() => {
  const { firstName, lastName } = parsedName.value
  return firstName.length >= 2 && lastName.length >= 2 && parsedAge.value !== null
})

/** Enregistrement + prescription directe (paiement) en une étape. */
const canConfirmNewPatientWithExams = computed(
  () =>
    canConfirmNewPatient.value &&
    newPatientExamCount.value > 0 &&
    netFcfa.value > 0 &&
    (!doctorSelectRequired.value || !!selectedDoctorId.value),
)

const canSaveEdit = computed(() => {
  const { firstName, lastName } = editParsedName.value
  return firstName.length >= 2 && lastName.length >= 2 && editParsedAge.value !== null
})

const canSubmitExams = computed(
  () =>
    !!activeRow.value &&
    countExamsByKind(examsByKind.value) > 0 &&
    netFcfa.value > 0 &&
    (!doctorSelectRequired.value || !!selectedDoctorId.value),
)

const externalExamKinds = EXTERNAL_PATIENT_EXAM_KINDS

function destinationServicesLabel(byKind: ExamsByKind): string {
  const labels = (EXTERNAL_PATIENT_EXAM_KINDS as ExamKindSlug[])
    .filter((kind) => (byKind[kind]?.length ?? 0) > 0)
    .map((kind) => uiText(EXAM_KIND_LABELS[kind]))
  if (!labels.length) return uiText('laboratoire')
  if (labels.length === 1) return labels[0]
  return `${labels.slice(0, -1).join(', ')} ${uiText('et')} ${labels[labels.length - 1]}`
}

/** Service dérivé des types d'examens choisis (plus de champ Service manuel). */
function serviceFromExams(byKind: ExamsByKind): string | undefined {
  if (activeServiceContext.value.clinicServiceName) {
    return activeServiceContext.value.clinicServiceName
  }
  const labels = (EXTERNAL_PATIENT_EXAM_KINDS as ExamKindSlug[])
    .filter((kind) => (byKind[kind]?.length ?? 0) > 0)
    .map((kind) => EXAM_KIND_LABELS[kind])
  return labels.length ? labels.join(', ') : undefined
}

const activePatientLabel = computed(() => {
  if (!activeRow.value) return ''
  const p = activeRow.value.patient
  return `${p.code} — ${fullName(p.firstName, p.lastName)}`
})

const searchLabel = computed(() => {
  void localeCode.value
  return searchResults.value.length
    ? translateTemplate('{n} résultat(s)', { n: searchResults.value.length })
    : uiText('Rechercher un dossier existant')
})

const queueCountLabel = computed(() => {
  void localeCode.value
  return translateTemplate('{n} dossier(s)', { n: queue.value.length })
})

const examsModalSubtitle = computed(() => {
  void localeCode.value
  if (!activePatientLabel.value) return ''
  return translateTemplate('{patient} — Laboratoire, radiologie, échographie…', {
    patient: activePatientLabel.value,
  })
})

const tableHeaders = computed(() => {
  void localeCode.value
  return {
    patient: uiText('Patient'),
    exams: uiText('Examens'),
    amount: uiText('Montant'),
    status: uiText('Statut'),
    actions: uiText('Actions'),
  }
})

const formLabels = computed(() => {
  void localeCode.value
  return {
    prescription: uiText('Prescrire des examens'),
    netDue: uiText('Net à payer'),
    registering: uiText('Enregistrement…'),
    savePending: uiText('Enregistrer sans examen'),
    saveAndSend: uiText('Valider et envoyer au service'),
    save: uiText('Enregistrer'),
    validating: uiText('Validation…'),
    validate: uiText('Valider et envoyer au service'),
  }
})

const subtotalLabel = computed(() => {
  void localeCode.value
  return translateTemplate('Sous-total {amount}', { amount: formatFcfa(grossFcfa.value) })
})

function resetPatientForm() {
  patientForm.value = {
    fullName: '',
    age: '',
    ageUnit: 'YEARS',
    phone: '',
    gender: 'F',
  }
}

function openNewPatientModal() {
  resetPatientForm()
  resetExamsForm()
  showNewPatientModal.value = true
}

function closeNewPatientModal() {
  showNewPatientModal.value = false
  resetExamsForm()
}

function resetExamsForm() {
  examsByKind.value = emptyExamsByKind()
  reductionFcfa.value = 0
  amountFcfa.value = ''
  amountManuallyEdited.value = false
  selectedDoctorId.value = ''
  operationAmountFcfa.value = null
}

function billingPayload() {
  return {
    examsByKind: examsByKind.value,
    reductionFcfa: Number(reductionFcfa.value) || 0,
    amountFcfa: netFcfa.value,
    ...(
      (examsByKind.value.operation?.length ?? 0) > 0 && operationAmountFcfa.value != null
        ? { operationAmountFcfa: operationAmountFcfa.value }
        : {}
    ),
  }
}

function openExamsModal(row: ExternalQueueRow) {
  if (row.hasExams) return
  activeRow.value = row
  resetExamsForm()
  showExamsModal.value = true
}

function closeExamsModal() {
  showExamsModal.value = false
  activeRow.value = null
}

function openEditModal(row: ExternalQueueRow) {
  editingPatientId.value = row.patientId
  editForm.value = {
    fullName: fullName(row.patient.firstName, row.patient.lastName),
    age: row.patient.age != null ? String(row.patient.age) : '',
    ageUnit: normalizePatientAgeUnit(row.patient.ageUnit),
    phone: row.patient.phone ?? '',
    gender: row.patient.gender ?? 'F',
  }
  showEditModal.value = true
}

function closeEditModal() {
  showEditModal.value = false
  editingPatientId.value = null
}

function queueStatusLabel(row: ExternalQueueRow) {
  void localeCode.value
  if (!row.hasExams) return uiText('En attente examens')
  if (row.invoiced) return row.invoiceNumber ?? uiText('Payé')
  return uiText('Envoyé au labo')
}

function queueStatusVariant(row: ExternalQueueRow): 'success' | 'warning' | 'info' {
  if (!row.hasExams) return 'warning'
  if (row.invoiced) return 'success'
  return 'info'
}

function externalRowActions(row: ExternalQueueRow): QueueRowAction[] {
  void localeCode.value
  return [
    {
      key: 'exams',
      label: uiText('Examens'),
      icon: FlaskConical,
      variant: 'accent',
      disabled: row.hasExams,
      disabledReason: row.hasExams ? uiText('Examens déjà prescrits') : undefined,
    },
    { key: 'edit', label: uiText('Modifier'), icon: Pencil },
    { key: 'print', label: uiText('Imprimer'), icon: Printer },
  ]
}

function examsSummaryLabel(row: ExternalQueueRow) {
  if (!row.hasExams || row.examsSummary === 'Examens en attente') {
    return uiText('Examens en attente')
  }
  return row.examsSummary
}

function serviceDisplayLabel(service: string | null | undefined) {
  if (!service) return ''
  return service
    .split(', ')
    .map((part) => uiText(part.trim()))
    .join(', ')
}

function onExternalRowAction(key: string, row: ExternalQueueRow) {
  if (key === 'exams') openExamsModal(row)
  if (key === 'edit') openEditModal(row)
  if (key === 'print') printRow(row)
}

function examLabelsFromRow(row: ExternalQueueRow) {
  if (!row.hasExams) return []
  return row.examsSummary.split(', ').filter(Boolean)
}

function printRow(row: ExternalQueueRow) {
  const patient = row.patient
  const patientName = fullName(patient.firstName, patient.lastName)

  if (!row.hasExams) {
    openPrintDocument(
      `Fiche patient ${patient.code}`,
      `
${buildClinicPrintHeader(uiText('Fiche patient externe'))}
  <div class="row"><span>${uiText('Date')}</span><strong>${dateTimeText(row.updatedAt)}</strong></div>
  <div class="row"><span>${uiText('Patient')}</span><strong>${patientName}</strong></div>
  <div class="row"><span>${uiText('Matricule')}</span><strong>${patient.code}</strong></div>
  ${patient.phone ? `<div class="row"><span>${uiText('Téléphone')}</span><strong>${patient.phone}</strong></div>` : ''}
  ${patient.age != null ? `<div class="row"><span>${uiText('Âge')}</span><strong>${formatPatientAge(patient.age, normalizePatientAgeUnit(patient.ageUnit))}</strong></div>` : ''}
  <p style="margin-top:1rem;color:#64748b;font-size:0.875rem;">${uiText('Dossier enregistré — examens en attente de prescription.')}</p>
  <div class="footer">${CLINIC.fullAddress}<br>${CLINIC.phoneLabel} — ${CLINIC.email}</div>
`,
    )
    return
  }

  const labels = examLabelsFromRow(row)
  const reduction = Math.max(0, row.grossFcfa - row.netFcfa)

  openPrintDocument(
    `Facture examens ${patient.code}`,
    buildLabExamThermalReceiptHtml({
      patientCode: patient.code,
      patientName,
      prescribedBy: uiText('Patient externe — réception'),
      examLines: labels.map((label) => ({
        label,
        amountFcfa: getLabExamPriceFcfa(label),
      })),
      grossFcfa: row.grossFcfa,
      reductionFcfa: reduction,
      totalFcfa: row.netFcfa,
      invoiceNumber: row.invoiceNumber ?? undefined,
      date: row.updatedAt,
      age: patient.age,
      ageUnit: normalizePatientAgeUnit(patient.ageUnit),
      gender: patient.gender,
      phone: patient.phone ?? undefined,
    }),
    { pageSize: '80mm' },
  )
}

async function loadQueue() {
  loadingQueue.value = true
  try {
    const { data } = await api.get<ExternalQueueRow[]>('/visits/external-queue')
    queue.value = data
  } finally {
    loadingQueue.value = false
  }
}

async function searchPatients() {
  if (!search.value.trim()) {
    searchResults.value = []
    return
  }
  const { data } = await api.get<PatientRow[]>('/patients', {
    params: { q: search.value.trim(), category: 'STANDARD' },
  })
  searchResults.value = data
}

function clearSearch() {
  search.value = ''
  searchResults.value = []
}

async function registerPatient(payload: Record<string, unknown>) {
  registering.value = true
  message.value = ''
  try {
    const { data } = await api.post<{ alreadyRegistered?: boolean }>('/visits/external-patient', payload)
    message.value = data.alreadyRegistered
      ? uiText('Patient déjà dans la liste des dossiers externes.')
      : uiText('Patient enregistré. Prescrivez les examens pour l’envoyer au service.')
    messageType.value = 'success'
    await loadQueue()
  } catch (error: unknown) {
    const shown = await showDuplicateModalFromError(error)
    if (shown) return
    const apiMessage =
      error && typeof error === 'object' && 'response' in error
        ? (error as { response?: { data?: { error?: string } } }).response?.data?.error
        : undefined
    message.value = apiMessage ?? uiText("Erreur lors de l'enregistrement.")
    messageType.value = 'error'
  } finally {
    registering.value = false
  }
}

async function confirmNewPatient() {
  if (!canConfirmNewPatient.value) return
  const { firstName, lastName } = parsedName.value
  const age = parsePatientAge(patientForm.value.age, patientForm.value.ageUnit)
  const basePayload = {
    firstName,
    lastName,
    age: age ?? undefined,
    ageUnit: patientForm.value.ageUnit,
    phone: patientForm.value.phone.trim() || undefined,
    gender: patientForm.value.gender,
  }

  if (newPatientExamCount.value > 0) {
    if (!canConfirmNewPatientWithExams.value) return
    registering.value = true
    message.value = ''
    try {
      const { data } = await api.post('/visits/external-lab-order', {
        ...basePayload,
        service: serviceFromExams(examsByKind.value),
        ...billingPayload(),
        doctorId: selectedDoctorId.value || undefined,
      })
      const destination = destinationServicesLabel(examsByKind.value)
      message.value = data.invoice
        ? translateTemplate(
            'Paiement validé — {invoice}. Patient envoyé vers {destination} (sans consultation médecin).',
            { invoice: data.invoice.invoiceNumber, destination },
          )
        : translateTemplate(
            'Examens enregistrés. Patient envoyé vers {destination} (sans consultation médecin).',
            { destination },
          )
      messageType.value = 'success'
      closeNewPatientModal()
      resetPatientForm()
      resetExamsForm()
      await loadQueue()
    } catch (error: unknown) {
      const shown = await showDuplicateModalFromError(error)
      if (shown) return
      const apiMessage =
        error && typeof error === 'object' && 'response' in error
          ? (error as { response?: { data?: { error?: string } } }).response?.data?.error
          : undefined
      message.value = apiMessage ?? uiText("Erreur lors de l'enregistrement.")
      messageType.value = 'error'
    } finally {
      registering.value = false
    }
    return
  }

  await registerPatient(basePayload)
  closeNewPatientModal()
  resetPatientForm()
}

async function selectPatient(patient: PatientRow) {
  await registerPatient({ patientId: patient.id })
  clearSearch()
  const pending = queue.value.find((row) => row.patientId === patient.id && !row.hasExams)
  if (pending) openExamsModal(pending)
}

async function submitExams() {
  if (!canSubmitExams.value || !activeRow.value) return
  submitting.value = true
  message.value = ''
  const destination = destinationServicesLabel(examsByKind.value)
  try {
    const { data } = await api.post('/visits/external-lab-order', {
      patientId: activeRow.value.patientId,
      ...billingPayload(),
      service: serviceFromExams(examsByKind.value) ?? activeRow.value.service ?? undefined,
      doctorId: selectedDoctorId.value || undefined,
    })
    message.value = data.invoice
      ? translateTemplate(
          'Paiement validé — {invoice}. Patient envoyé vers {destination} (sans consultation médecin).',
          { invoice: data.invoice.invoiceNumber, destination },
        )
      : translateTemplate(
          'Examens enregistrés. Patient envoyé vers {destination} (sans consultation médecin).',
          { destination },
        )
    messageType.value = 'success'
    closeExamsModal()
    resetExamsForm()
    await loadQueue()
  } catch (error: unknown) {
    const apiMessage =
      error && typeof error === 'object' && 'response' in error
        ? (error as { response?: { data?: { error?: string } } }).response?.data?.error
        : undefined
    message.value = apiMessage ?? uiText('Erreur lors de la validation.')
    messageType.value = 'error'
  } finally {
    submitting.value = false
  }
}

async function saveEdit() {
  if (!canSaveEdit.value || !editingPatientId.value) return
  savingEdit.value = true
  message.value = ''
  try {
    const { firstName, lastName } = editParsedName.value
    const age = editParsedAge.value
    await api.patch(`/patients/${editingPatientId.value}`, {
      firstName,
      lastName,
      age: age ?? undefined,
      ageUnit: editForm.value.ageUnit,
      phone: editForm.value.phone.trim() || undefined,
      gender: editForm.value.gender,
    })
    message.value = uiText('Informations patient mises à jour.')
    messageType.value = 'success'
    closeEditModal()
    await loadQueue()
  } catch (error: unknown) {
    const shown = await showDuplicateModalFromError(error)
    if (!shown) {
      const apiMessage =
        error && typeof error === 'object' && 'response' in error
          ? (error as { response?: { data?: { error?: string } } }).response?.data?.error
          : undefined
      message.value = apiMessage ?? uiText('Erreur lors de la modification.')
      messageType.value = 'error'
    }
  } finally {
    savingEdit.value = false
  }
}

onMounted(() => {
  loadQueue()
  loadDoctors()
})
</script>

<template>
  <div>
    <UiPageHeader
      :title="uiText('Patient externe')"
      :subtitle="uiText('Prescrivez labo, radio, écho… directement — le patient part au service sans passer par un médecin')"
      :icon="UserRound"
    />

    <UiAlert v-if="message" :type="messageType" :message="message" />

    <UiCard :title="uiText('Rechercher un patient existant')" :icon="UserRound" icon-variant="teal" class="patient-card">
      <div class="search-block">
        <div class="search-compact">
          <Search :size="16" class="search-compact__icon" />
          <input
            v-model="search"
            type="search"
            class="search-compact__input"
            :placeholder="uiText('Rechercher par matricule, nom ou téléphone…')"
            @keydown.enter.prevent="searchPatients"
          />
          <button
            v-if="search"
            type="button"
            class="search-compact__clear"
            :aria-label="uiText('Effacer la recherche')"
            @click="clearSearch"
          >
            <X :size="14" />
          </button>
        </div>
        <div class="search-actions">
          <span class="search-count">{{ searchLabel }}</span>
          <UiButton variant="ghost" size="sm" @click="searchPatients">
            {{ uiText('Chercher') }}
          </UiButton>
        </div>

        <ul v-if="searchResults.length" class="search-results">
          <li v-for="patient in searchResults" :key="patient.id">
            <button type="button" :disabled="registering" @click="selectPatient(patient)">
              <strong>{{ fullName(patient.firstName, patient.lastName) }}</strong>
              <span>{{ patient.code }}</span>
            </button>
          </li>
        </ul>
      </div>
    </UiCard>

    <UiCard :title="uiText('Patients externes enregistrés')" class="queue-card" :icon="UserRound" icon-variant="blue">
      <template #actions>
        <UiButton variant="primary" size="sm" @click="openNewPatientModal">
          {{ uiText('Nouveau') }}
        </UiButton>
        <UiButton variant="ghost" size="sm" :disabled="loadingQueue" @click="loadQueue">
          {{ uiText('Actualiser') }}
        </UiButton>
        <span class="list-count">{{ queueCountLabel }}</span>
      </template>

      <p v-if="!loadingQueue && !queue.length" class="empty">
        {{ uiText('Aucun patient externe enregistré pour le moment') }}
      </p>
      <div v-else class="queue-table-wrap">
        <table class="queue-table">
          <thead>
            <tr>
              <th>{{ tableHeaders.patient }}</th>
              <th>{{ tableHeaders.exams }}</th>
              <th>{{ tableHeaders.amount }}</th>
              <th>{{ tableHeaders.status }}</th>
              <th class="col-actions">{{ tableHeaders.actions }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in queue" :key="row.id">
              <td>
                <strong>{{ fullName(row.patient.firstName, row.patient.lastName) }}</strong>
                <span class="sub">{{ row.patient.code }}</span>
                <span v-if="row.service" class="sub">{{ serviceDisplayLabel(row.service) }}</span>
              </td>
              <td>{{ examsSummaryLabel(row) }}</td>
              <td>{{ row.hasExams ? formatFcfa(row.netFcfa) : '—' }}</td>
              <td>
                <UiBadge :variant="queueStatusVariant(row)">
                  {{ queueStatusLabel(row) }}
                </UiBadge>
              </td>
              <td class="col-actions">
                <ReceptionQueueRowActions
                  :actions="externalRowActions(row)"
                  @action="onExternalRowAction($event, row)"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </UiCard>

    <UiFormModal
      v-if="showNewPatientModal"
      title-id="external-modal-title"
      :title="uiText('Nouveau patient externe')"
      :subtitle="uiText('Identité + prescription directe — labo, radio, écho, odonto')"
      :icon="UserPlus"
      size="wide"
      @close="closeNewPatientModal"
    >
      <form
        id="external-new-patient-form"
        class="ui-form-modal__form reception-modal-form"
        @submit.prevent="confirmNewPatient"
      >
        <section class="form-panel">
          <h3 class="form-panel__title">
            <UserRound :size="14" />
            {{ uiText('Informations patient') }}
          </h3>
          <ReceptionPatientIdentityFields
            v-model:full-name="patientForm.fullName"
            v-model:age="patientForm.age"
            v-model:age-unit="patientForm.ageUnit"
            v-model:phone="patientForm.phone"
            v-model:gender="patientForm.gender"
          />
        </section>

        <section class="form-panel form-panel--accent">
          <h3 class="form-panel__title">
            <FlaskConical :size="14" />
            {{ formLabels.prescription }}
          </h3>
          <p class="form-panel__hint">
            {{
              uiText(
                'Choisissez le service puis les examens ou opérations. Sélectionnez le médecin du service si disponible.',
              )
            }}
          </p>
          <MultiExamPrescriptionPicker
            v-model="examsByKind"
            v-model:operation-amount-fcfa="operationAmountFcfa"
            :kinds="externalExamKinds"
            :show-comments="false"
            :show-consultation="false"
            @active-service-change="onActiveServiceChange"
          />
          <div v-if="activeServiceContext.kind || activeServiceContext.clinicServiceId" class="doctor-service-row">
            <UiSelect
              v-model="selectedDoctorId"
              :label="translateTemplate('Médecin — {service}', { service: activeServiceLabel })"
              :required="doctorSelectRequired"
              :disabled="!doctorsForActiveService.length"
            >
              <option value="">
                {{
                  doctorsForActiveService.length
                    ? uiText('Sélectionner un médecin…')
                    : uiText('Aucun médecin lié à ce service')
                }}
              </option>
              <option v-for="doctor in doctorsForActiveService" :key="doctor.id" :value="doctor.id">
                {{ fullName(doctor.firstName, doctor.lastName) }}
              </option>
            </UiSelect>
          </div>
          <div class="form-grid-2">
            <UiInput
              :model-value="reductionFcfa"
              :label="uiText('Réduction (FCFA)')"
              type="number"
              min="0"
              :max="grossFcfa"
              placeholder="0"
              :icon="Percent"
              @update:model-value="onReductionInput"
            />
            <div class="total-preview total-preview--editable">
              <UiInput
                :model-value="amountFcfa"
                :label="formLabels.netDue"
                type="number"
                min="0"
                placeholder="0"
                @update:model-value="onAmountInput"
              />
              <small>{{ subtotalLabel }}</small>
            </div>
          </div>
        </section>
      </form>

      <template #footer>
        <UiButton type="button" variant="ghost" @click="closeNewPatientModal">{{ uiText('Annuler') }}</UiButton>
        <UiButton type="button" variant="ghost" :icon="RotateCcw" @click="resetPatientForm(); resetExamsForm()">
          {{ uiText('Effacer') }}
        </UiButton>
        <UiButton
          v-if="newPatientExamCount === 0"
          type="submit"
          form="external-new-patient-form"
          variant="primary"
          :icon="UserPlus"
          :disabled="!canConfirmNewPatient || registering"
        >
          {{ registering ? formLabels.registering : formLabels.savePending }}
        </UiButton>
        <UiButton
          v-else
          type="submit"
          form="external-new-patient-form"
          variant="success"
          :icon="CreditCard"
          :disabled="!canConfirmNewPatientWithExams || registering"
        >
          {{ registering ? formLabels.validating : formLabels.saveAndSend }}
        </UiButton>
      </template>
    </UiFormModal>

    <UiFormModal
      v-if="showEditModal"
      title-id="edit-modal-title"
      :title="uiText('Modifier le patient')"
      :icon="Pencil"
      @close="closeEditModal"
    >
      <form
        id="external-edit-patient-form"
        class="ui-form-modal__form reception-modal-form"
        @submit.prevent="saveEdit"
      >
        <ReceptionPatientIdentityFields
          v-model:full-name="editForm.fullName"
          v-model:age="editForm.age"
          v-model:age-unit="editForm.ageUnit"
          v-model:phone="editForm.phone"
          v-model:gender="editForm.gender"
        />
      </form>

      <template #footer>
        <UiButton type="button" variant="ghost" @click="closeEditModal">{{ uiText('Annuler') }}</UiButton>
        <UiButton
          type="submit"
          form="external-edit-patient-form"
          variant="primary"
          :icon="Pencil"
          :disabled="!canSaveEdit || savingEdit"
        >
          {{ savingEdit ? formLabels.registering : formLabels.save }}
        </UiButton>
      </template>
    </UiFormModal>

    <UiFormModal
      v-if="showExamsModal"
      title-id="exams-modal-title"
      :title="uiText('Prescrire des examens')"
      :subtitle="examsModalSubtitle"
      :icon="FlaskConical"
      size="wide"
      @close="closeExamsModal"
    >
      <section class="form-panel form-panel--accent">
        <h3 class="form-panel__title">
          <FlaskConical :size="14" />
          {{ formLabels.prescription }}
        </h3>
        <p class="form-panel__hint">
          {{
            uiText(
              'Choisissez le service puis les examens ou opérations. Sélectionnez le médecin du service si disponible.',
            )
          }}
        </p>
        <MultiExamPrescriptionPicker
          v-model="examsByKind"
          v-model:operation-amount-fcfa="operationAmountFcfa"
          :kinds="externalExamKinds"
          :show-comments="false"
          :show-consultation="false"
          @active-service-change="onActiveServiceChange"
        />
        <div v-if="activeServiceContext.kind || activeServiceContext.clinicServiceId" class="doctor-service-row">
          <UiSelect
            v-model="selectedDoctorId"
            :label="translateTemplate('Médecin — {service}', { service: activeServiceLabel })"
            :required="doctorSelectRequired"
            :disabled="!doctorsForActiveService.length"
          >
            <option value="">
              {{
                doctorsForActiveService.length
                  ? uiText('Sélectionner un médecin…')
                  : uiText('Aucun médecin lié à ce service')
              }}
            </option>
            <option v-for="doctor in doctorsForActiveService" :key="doctor.id" :value="doctor.id">
              {{ fullName(doctor.firstName, doctor.lastName) }}
            </option>
          </UiSelect>
        </div>

        <div class="form-grid-2">
          <UiInput
            :model-value="reductionFcfa"
            :label="uiText('Réduction (FCFA)')"
            type="number"
            min="0"
            :max="grossFcfa"
            placeholder="0"
            :icon="Percent"
            @update:model-value="onReductionInput"
          />
          <div class="total-preview total-preview--editable">
            <UiInput
              :model-value="amountFcfa"
              :label="formLabels.netDue"
              type="number"
              min="0"
              placeholder="0"
              @update:model-value="onAmountInput"
            />
            <small>{{ subtotalLabel }}</small>
          </div>
        </div>
      </section>

      <template #footer>
        <UiButton type="button" variant="ghost" @click="closeExamsModal">{{ uiText('Annuler') }}</UiButton>
        <UiButton
          variant="success"
          :icon="CreditCard"
          :disabled="submitting || !canSubmitExams"
          @click="submitExams"
        >
          {{ submitting ? formLabels.validating : formLabels.validate }}
        </UiButton>
      </template>
    </UiFormModal>
  </div>
</template>

<style scoped>
.patient-card {
  margin-bottom: 1rem;
}

.search-block {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.search-compact {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.45rem 0.65rem;
  border: 1.5px solid var(--border);
  border-radius: var(--radius-sm);
  background: #fff;
}

.search-compact:focus-within {
  border-color: var(--border-focus);
  box-shadow: 0 0 0 3px var(--focus-ring-sm);
}

.search-compact__icon {
  color: var(--text-light);
  flex-shrink: 0;
}

.search-compact__input {
  flex: 1;
  border: 0;
  background: transparent;
  font-size: 0.875rem;
  outline: none;
  min-width: 0;
}

.search-compact__clear {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.25rem;
  height: 1.25rem;
  border: 0;
  border-radius: 999px;
  background: #f1f5f9;
  color: var(--text-muted);
  cursor: pointer;
}

.search-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.search-count {
  font-size: 0.6875rem;
  color: var(--text-muted);
}

.search-results {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.search-results button {
  display: flex;
  justify-content: space-between;
  width: 100%;
  padding: 0.65rem 0.85rem;
  border: 0;
  border-bottom: 1px solid var(--border);
  background: #fff;
  text-align: left;
  cursor: pointer;
}

.search-results button:hover:not(:disabled) {
  background: var(--primary-50);
}

.search-results button:disabled {
  opacity: 0.6;
  cursor: wait;
}

.search-results span {
  color: var(--text-muted);
  font-size: 0.8125rem;
}

.form-section {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1rem;
  margin-bottom: 0;
  background: var(--primary-50);
  border: 1px solid var(--primary-100);
  border-radius: var(--radius-sm);
}

.form-section__title {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--primary-800);
}

.form-grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
}

.total-preview {
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: 0.2rem;
  padding: 0.65rem 0.9rem;
  background: #fff;
  border: 1.5px solid var(--primary-200);
  border-radius: var(--radius-sm);
}

.total-preview--editable {
  padding: 0;
  border: 0;
  background: transparent;
  gap: 0.35rem;
}

.total-preview span {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.total-preview strong {
  font-size: 1.125rem;
  color: var(--primary-800);
}

.total-preview small {
  font-size: 0.75rem;
  color: var(--text-muted);
}

.queue-table-wrap {
  overflow-x: auto;
}

.queue-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8125rem;
}

.queue-table th,
.queue-table td {
  padding: 0.65rem 0.5rem;
  border-bottom: 1px solid var(--border);
  text-align: left;
  vertical-align: middle;
}

.queue-table .sub {
  display: block;
  font-size: 0.75rem;
  color: var(--text-muted);
}

.col-actions {
  min-width: 9.5rem;
  text-align: right;
  white-space: nowrap;
}

.list-count {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-muted);
  white-space: nowrap;
}

.doctor-service-row {
  margin: 0.75rem 0 0.25rem;
}

.empty {
  text-align: center;
  color: var(--text-light);
  padding: 1.5rem;
}

@media (max-width: 960px) {
  .form-grid-2 {
    grid-template-columns: 1fr;
  }
}
</style>
