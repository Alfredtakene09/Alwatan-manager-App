<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import axios from 'axios'
import {
  LayoutDashboard,
  Search,
  UserPlus,
  Users,
  CalendarDays,
  RotateCcw,
  Pencil,
  X,
  Stethoscope,
  Banknote,
  Printer,
  Percent,
} from '@lucide/vue'
import api from '@/api/client'
import { showDuplicateModalFromError, confirmAppModal, showApiErrorModal } from '@/lib/api-modal-helper'
import { fullName } from '@/lib/roles'
import {
  joinPatientFullName,
  parsePatientAge,
  splitPatientFullName,
} from '@/lib/patient-name'
import { normalizePatientAgeUnit, type PatientAgeUnit } from '@/lib/patient-age'
import { sortPatientsNewestFirst } from '@/lib/patient-sort'
import {
  PATIENT_CATEGORIES,
  isExemptCategory,
  showConsultationBillingSummary,
  type PatientCategory,
} from '@/lib/patient-category'
import {
  defaultConsultationAmountForDoctor,
  doctorConsultationBillingValid,
  doctorIsFixedSalary,
  doctorNeedsConsultationAmountInput,
  doctorQuotaHint,
  doctorSelectSuffix,
  doctorShowsFixedConsultationPrice,
  resolveConsultationAmountForDoctor,
  showDoctorConsultationBilling,
  type ConsultationRenewalPreview,
  type DoctorOption,
} from '@/lib/doctor-compensation'
import { buildConsultationReceiptHtml, openPrintDocument } from '@/lib/print-document'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiFormModal from '@/components/ui/UiFormModal.vue'
import PatientsDataTable from '@/components/ui/PatientsDataTable.vue'
import ReceptionPatientIdentityFields from '@/components/reception/ReceptionPatientIdentityFields.vue'

type ReceptionStats = {
  registeredToday: number
  femalePatients: number
  malePatients: number
  visitsToday: number
  revenueTodayFcfa: number
  expensesTodayFcfa?: number
  netTodayFcfa?: number
  isPersonalScope?: boolean
  consultationsTodayFcfa?: number
  examsTodayFcfa?: number
  surgeryTodayFcfa?: number
  hospitalizationTodayFcfa?: number
}

type Patient = {
  id: string
  code: string
  firstName: string
  lastName: string
  age?: number | null
  ageUnit?: PatientAgeUnit | null
  phone?: string
  gender?: string
  category?: PatientCategory
  createdAt?: string
}

type Doctor = DoctorOption

function findDoctor(doctorId: string) {
  return doctors.value.find((doctor) => doctor.id === doctorId)
}

type PatientDetail = Patient & {
  category?: PatientCategory
  waitingVisit?: {
    doctorId?: string | null
    doctor?: Doctor | null
    consultationFeeFcfa?: number | null
    reductionFcfa?: number | null
    consultationAmountFcfa?: number | null
    invoiceNumber?: string | null
    totalFcfa?: number | null
  } | null
}

type ReceiptData = {
  patientCode: string
  patientName: string
  doctorName: string
  amount: number
  reduction: number
  total: number
  invoiceNumber?: string
  date: string
  age?: number | null
  ageUnit?: PatientAgeUnit | null
  gender?: string | null
  phone?: string | null
}

const patients = ref<Patient[]>([])
const doctors = ref<Doctor[]>([])
const stats = ref<ReceptionStats>({
  registeredToday: 0,
  femalePatients: 0,
  malePatients: 0,
  visitsToday: 0,
  revenueTodayFcfa: 0,
})
const loadingStats = ref(false)
const search = ref('')
const message = ref('')
const messageType = ref<'success' | 'error'>('success')
let messageTimer: ReturnType<typeof setTimeout> | undefined

function showAlert(text: string, type: 'success' | 'error' = 'success') {
  if (messageTimer) clearTimeout(messageTimer)
  message.value = text
  messageType.value = type
  if (type === 'success') {
    messageTimer = setTimeout(() => {
      message.value = ''
      messageTimer = undefined
    }, 3000)
  }
}

function clearAlert() {
  if (messageTimer) clearTimeout(messageTimer)
  messageTimer = undefined
  message.value = ''
}
const loadingPatients = ref(false)
const submitting = ref(false)
const showModal = ref(false)
const showEditModal = ref(false)
const showReconsultModal = ref(false)
const selectedPatient = ref<PatientDetail | null>(null)
const savingEdit = ref(false)
const loadingEdit = ref(false)
const submittingReconsult = ref(false)
const deletingPatientId = ref<string | null>(null)

const reconsultForm = ref({
  doctorId: '',
  consultationAmount: '',
})
const renewalPreview = ref<ConsultationRenewalPreview | null>(null)
const loadingRenewalPreview = ref(false)

const editForm = ref({
  fullName: '',
  age: '',
  ageUnit: 'YEARS' as PatientAgeUnit,
  phone: '',
  gender: 'F',
  category: 'STANDARD' as PatientCategory,
  doctorId: '',
  consultationAmount: '',
  reduction: '0',
})

const form = ref({
  fullName: '',
  age: '',
  ageUnit: 'YEARS' as PatientAgeUnit,
  phone: '',
  gender: 'F',
  category: 'STANDARD' as PatientCategory,
  doctorId: '',
  consultationAmount: '',
  reduction: '0',
})

const formParsedName = computed(() => splitPatientFullName(form.value.fullName))
const editParsedName = computed(() => splitPatientFullName(editForm.value.fullName))
const formAge = computed(() => parsePatientAge(form.value.age, form.value.ageUnit))
const editAge = computed(() => parsePatientAge(editForm.value.age, editForm.value.ageUnit))

const formAmount = computed(() => Number(form.value.consultationAmount) || 0)
const formReduction = computed(() => Math.max(0, Number(form.value.reduction) || 0))
const formEffectiveAmount = computed(() => {
  if (formBillingExempt.value) return 0
  return resolveConsultationAmountForDoctor(formDoctor.value, formAmount.value)
})
const formTotal = computed(() => Math.max(0, formEffectiveAmount.value - formReduction.value))

const editAmount = computed(() => Number(editForm.value.consultationAmount) || 0)
const editReduction = computed(() => Math.max(0, Number(editForm.value.reduction) || 0))
const editEffectiveAmount = computed(() => {
  if (editBillingExempt.value) return 0
  return resolveConsultationAmountForDoctor(editDoctor.value, editAmount.value)
})
const editTotal = computed(() => Math.max(0, editEffectiveAmount.value - editReduction.value))

const formBillingExempt = computed(() => isExemptCategory(form.value.category))
const editBillingExempt = computed(() => isExemptCategory(editForm.value.category))

const formDoctor = computed(() => findDoctor(form.value.doctorId))
const editDoctor = computed(() => findDoctor(editForm.value.doctorId))
const reconsultDoctor = computed(() => findDoctor(reconsultForm.value.doctorId))

const formDoctorQuotaHint = computed(() => doctorQuotaHint(formDoctor.value, formEffectiveAmount.value))
const editDoctorQuotaHint = computed(() => doctorQuotaHint(editDoctor.value, editEffectiveAmount.value))
const reconsultDoctorQuotaHint = computed(() =>
  doctorQuotaHint(
    reconsultDoctor.value,
    resolveConsultationAmountForDoctor(
      reconsultDoctor.value,
      Number(reconsultForm.value.consultationAmount) || 0,
    ),
  ),
)

const showFormConsultationBilling = computed(
  () =>
    showConsultationBillingSummary(form.value.category) &&
    !formBillingExempt.value &&
    showDoctorConsultationBilling(formDoctor.value),
)
const showEditConsultationBilling = computed(
  () =>
    showConsultationBillingSummary(editForm.value.category) &&
    !editBillingExempt.value &&
    showDoctorConsultationBilling(editDoctor.value),
)

const canSubmit = computed(() => {
  const { firstName, lastName } = formParsedName.value
  const base =
    firstName.length >= 2 &&
    lastName.length >= 2 &&
    formAge.value !== null &&
    !!form.value.doctorId
  if (!base) return false
  if (formBillingExempt.value || !showDoctorConsultationBilling(formDoctor.value)) return true
  return (
    formEffectiveAmount.value > 0 &&
    formReduction.value <= formEffectiveAmount.value &&
    formTotal.value > 0
  )
})

const canSaveEdit = computed(() => {
  const { firstName, lastName } = editParsedName.value
  const base =
    firstName.length >= 2 &&
    lastName.length >= 2 &&
    editAge.value !== null &&
    !!editForm.value.doctorId
  if (!base) return false
  if (editBillingExempt.value || !showDoctorConsultationBilling(editDoctor.value)) return true
  return (
    editEffectiveAmount.value > 0 &&
    editReduction.value <= editEffectiveAmount.value &&
    editTotal.value > 0
  )
})

const canSubmitReconsult = computed(() => {
  if (!reconsultForm.value.doctorId) return false
  const patient = selectedPatient.value
  if (patient?.category && isExemptCategory(patient.category)) return true
  if (renewalPreview.value?.withinValidity) return true
    const amount =
      renewalPreview.value?.amountFcfa ?? (Number(reconsultForm.value.consultationAmount) || 0)
  if (doctorShowsFixedConsultationPrice(reconsultDoctor.value)) return amount >= 0
  return doctorConsultationBillingValid(reconsultDoctor.value, amount) || amount === 0
})

const searchLabel = computed(() =>
  search.value.trim() ? `${patients.value.length} résultat(s)` : `${patients.value.length} dossier(s) affiché(s)`,
)

const dashboardStats = computed(() => [
  {
    id: 'today',
    label: 'Inscrits aujourd\'hui',
    value: stats.value.registeredToday,
    hint: `${stats.value.visitsToday} passage(s) enregistré(s)`,
    icon: CalendarDays,
    variant: 'amber' as const,
  },
  {
    id: 'female',
    label: 'Féminin',
    value: stats.value.femalePatients,
    hint: 'Dossiers patients',
    icon: Users,
    variant: 'rose' as const,
  },
  {
    id: 'male',
    label: 'Masculin',
    value: stats.value.malePatients,
    hint: 'Dossiers patients',
    icon: Users,
    variant: 'blue' as const,
  },
  {
    id: 'revenue',
    label: stats.value.isPersonalScope ? 'Mes encaissements (jour)' : 'Recettes du jour',
    value: formatFcfaCompact(stats.value.netTodayFcfa ?? stats.value.revenueTodayFcfa),
    hint: stats.value.isPersonalScope
      ? stats.value.expensesTodayFcfa
        ? `Brut ${formatFcfaCompact(stats.value.revenueTodayFcfa)} − dépenses ${formatFcfaCompact(stats.value.expensesTodayFcfa ?? 0)}`
        : 'Uniquement vos encaissements'
      : 'Consultations, examens, opérations, hospitalisation (hors associés)',
    icon: Banknote,
    variant: 'violet' as const,
  },
])

function formatFcfaCompact(amount: number) {
  if (amount === 0) return '0'
  return amount.toLocaleString('fr-FR')
}

let searchTimer: ReturnType<typeof setTimeout> | undefined

async function loadReceptionStats() {
  loadingStats.value = true
  try {
    const { data } = await api.get<ReceptionStats>('/patients/reception-stats')
    stats.value = data
  } finally {
    loadingStats.value = false
  }
}

async function loadPatients() {
  loadingPatients.value = true
  try {
    const { data } = await api.get('/patients', { params: { q: search.value.trim() || undefined } })
    patients.value = sortPatientsNewestFirst(data)
  } finally {
    loadingPatients.value = false
  }
}

async function loadDoctors() {
  const { data } = await api.get('/visits/doctors')
  doctors.value = data
}

async function refreshAll() {
  await Promise.all([loadPatients(), loadReceptionStats(), loadDoctors()])
}

function formatFcfa(amount: number) {
  return `${amount.toLocaleString('fr-FR')} FCFA`
}

function resetForm() {
  form.value = {
    fullName: '',
    age: '',
    ageUnit: 'YEARS',
    phone: '',
    gender: 'F',
    category: 'STANDARD',
    doctorId: doctors.value[0]?.id ?? '',
    consultationAmount: '',
    reduction: '0',
  }
}

async function refreshReconsultFee() {
  const patient = selectedPatient.value
  if (!patient?.id || !reconsultForm.value.doctorId) {
    renewalPreview.value = null
    return
  }

  loadingRenewalPreview.value = true
  try {
    const { data } = await api.get<ConsultationRenewalPreview>(
      `/patients/${patient.id}/consultation-fee`,
      {
        params: {
          doctorId: reconsultForm.value.doctorId,
          amount: reconsultForm.value.consultationAmount || undefined,
        },
      },
    )
    renewalPreview.value = data
    reconsultForm.value.consultationAmount = String(data.amountFcfa)
  } catch {
    renewalPreview.value = null
    applyDoctorBillingDefaults('reconsult')
  } finally {
    loadingRenewalPreview.value = false
  }
}

function applyDoctorBillingDefaults(target: 'form' | 'edit' | 'reconsult') {
  if (target === 'form') {
    const doctor = findDoctor(form.value.doctorId)
    if (isExemptCategory(form.value.category)) {
      form.value.consultationAmount = '0'
      form.value.reduction = '0'
      return
    }
    if (doctorShowsFixedConsultationPrice(doctor)) {
      form.value.consultationAmount = String(defaultConsultationAmountForDoctor(doctor))
      return
    }
    if (doctorNeedsConsultationAmountInput(doctor)) {
      form.value.consultationAmount = ''
      return
    }
    form.value.consultationAmount = '0'
    form.value.reduction = '0'
    return
  }
  if (target === 'edit') {
    const doctor = findDoctor(editForm.value.doctorId)
    if (isExemptCategory(editForm.value.category)) {
      editForm.value.consultationAmount = '0'
      editForm.value.reduction = '0'
      return
    }
    if (doctorShowsFixedConsultationPrice(doctor)) {
      editForm.value.consultationAmount = String(defaultConsultationAmountForDoctor(doctor))
      return
    }
    if (doctorNeedsConsultationAmountInput(doctor)) {
      editForm.value.consultationAmount = ''
      return
    }
    editForm.value.consultationAmount = '0'
    editForm.value.reduction = '0'
    return
  }
  const doctor = findDoctor(reconsultForm.value.doctorId)
  if (doctorShowsFixedConsultationPrice(doctor)) {
    reconsultForm.value.consultationAmount = String(defaultConsultationAmountForDoctor(doctor))
    return
  }
  if (doctorNeedsConsultationAmountInput(doctor)) {
    reconsultForm.value.consultationAmount = ''
    return
  }
  reconsultForm.value.consultationAmount = '0'
}

function applyCategoryBillingDefaults(target: 'form' | 'edit') {
  const state = target === 'form' ? form.value : editForm.value
  if (isExemptCategory(state.category)) {
    state.consultationAmount = '0'
    state.reduction = '0'
  }
  applyDoctorBillingDefaults(target)
}

function openModal() {
  resetForm()
  showModal.value = true
}

function closeModal() {
  showModal.value = false
  resetForm()
}

function getDoctorName(doctorId: string) {
  const doctor = doctors.value.find((d) => d.id === doctorId)
  return doctor ? `Dr ${fullName(doctor.firstName, doctor.lastName)}` : '—'
}

function printReceipt(r: ReceiptData) {
  openPrintDocument(`Reçu ${r.patientCode}`, buildConsultationReceiptHtml(r))
}

function printDetailReceipt(detail: PatientDetail) {
  if (!detail.waitingVisit) {
    showAlert(
      'Aucune consultation en cours à imprimer. Ouvrez le dossier, vérifiez le médecin et le montant, puis enregistrez à nouveau.',
      'error',
    )
    return
  }

  const visit = detail.waitingVisit
  const amount = visit.consultationFeeFcfa ?? visit.consultationAmountFcfa ?? 0
  const reduction = visit.reductionFcfa ?? 0
  const total = visit.totalFcfa ?? Math.max(0, amount - reduction)

  if (amount <= 0 && !isExemptCategory(detail.category ?? 'STANDARD')) {
    showAlert('Aucun montant de consultation à imprimer.', 'error')
    return
  }

  const doctorName = visit.doctor
    ? `Dr ${fullName(visit.doctor.firstName, visit.doctor.lastName)}`
    : '—'

  const invoiceNumber = visit.invoiceNumber ?? undefined

  printReceipt({
    patientCode: detail.code,
    patientName: fullName(detail.firstName, detail.lastName),
    doctorName,
    amount: isExemptCategory(detail.category ?? 'STANDARD') ? 0 : amount,
    reduction: isExemptCategory(detail.category ?? 'STANDARD') ? 0 : reduction,
    total: isExemptCategory(detail.category ?? 'STANDARD') ? 0 : total,
    invoiceNumber,
    date: new Date().toLocaleString('fr-FR'),
    age: detail.age,
    ageUnit: normalizePatientAgeUnit(detail.ageUnit),
    gender: detail.gender,
    phone: detail.phone,
  })
}

async function createPatientAndVisit() {
  if (!canSubmit.value) return
  clearAlert()
  submitting.value = true
  try {
    const { firstName, lastName } = formParsedName.value
    const amount = formEffectiveAmount.value
    const reduction = formBillingExempt.value ? 0 : formReduction.value
    const total = formBillingExempt.value ? 0 : formTotal.value

    const { data } = await api.post<{
      patient: Patient
      invoiceNumber?: string | null
      totalFcfa: number
      billingDeferred?: boolean
    }>('/patients/register-consultation', {
      firstName,
      lastName,
      age: formAge.value ?? undefined,
      ageUnit: form.value.ageUnit,
      phone: form.value.phone.trim() || undefined,
      gender: form.value.gender,
      category: form.value.category,
      doctorId: form.value.doctorId,
      consultationAmountFcfa: formBillingExempt.value ? 0 : amount,
      reductionFcfa: reduction,
    })

    const patient = data.patient
    printReceipt({
      patientCode: patient.code,
      patientName: fullName(patient.firstName, patient.lastName),
      doctorName: getDoctorName(form.value.doctorId),
      amount,
      reduction,
      total,
      invoiceNumber: data.invoiceNumber
        ?? (formBillingExempt.value
          ? 'Exonéré'
          : data.billingDeferred
            ? 'Facturation différée'
            : undefined),
      date: new Date().toLocaleString('fr-FR'),
      age: formAge.value,
      ageUnit: form.value.ageUnit,
      gender: form.value.gender,
      phone: form.value.phone.trim() || undefined,
    })
    showAlert(`Dossier ${patient.code} enregistré — ${fullName(patient.firstName, patient.lastName)} est en attente de consultation.`)
    closeModal()
    await refreshAll()
  } catch (error) {
    const shown = await showDuplicateModalFromError(error, {
      confirmLabel: 'Compris',
      cancelLabel: 'Fermer',
    })
    if (!shown) {
      showAlert('Erreur lors de la création du dossier.', 'error')
    }
  } finally {
    submitting.value = false
  }
}

async function loadPatientDetail(patientId: string) {
  const { data } = await api.get<PatientDetail>(`/patients/${patientId}`)
  return data
}

function printPatientReceipt(patient: Patient) {
  clearAlert()
  loadPatientDetail(patient.id)
    .then(printDetailReceipt)
    .catch(() => {
      showAlert('Impossible d\'imprimer le reçu.', 'error')
    })
}

async function deletePatient(patient: Patient) {
  const patientName = fullName(patient.firstName, patient.lastName)
  const confirmed = await confirmAppModal({
    type: 'DELETE',
    title: 'Supprimer le patient',
    message: `Supprimer le dossier ${patient.code} — ${patientName} ? Cette action est irréversible.`,
    confirmLabel: 'Supprimer',
  })
  if (!confirmed) return

  deletingPatientId.value = patient.id
  clearAlert()
  try {
    await api.delete(`/patients/${patient.id}`)
    showAlert(`Dossier ${patient.code} supprimé.`)
    await refreshAll()
  } catch (error: unknown) {
    await showApiErrorModal(
      error,
      'Impossible de supprimer ce patient.',
    )
  } finally {
    deletingPatientId.value = null
  }
}

async function openEditModal(patient: Patient) {
  loadingEdit.value = true
  showEditModal.value = true
  try {
    const detail = await loadPatientDetail(patient.id)
    selectedPatient.value = detail
    editForm.value = {
      fullName: joinPatientFullName(detail.firstName, detail.lastName),
      age: detail.age != null ? String(detail.age) : '',
      ageUnit: normalizePatientAgeUnit(detail.ageUnit),
      phone: detail.phone ?? '',
      gender: detail.gender ?? 'F',
      category: detail.category === 'ONG' ? 'STANDARD' : (detail.category ?? 'STANDARD'),
      doctorId: detail.waitingVisit?.doctorId ?? doctors.value[0]?.id ?? '',
      consultationAmount: detail.waitingVisit?.consultationAmountFcfa
        ? String(detail.waitingVisit.consultationAmountFcfa)
        : '',
      reduction: detail.waitingVisit?.reductionFcfa != null
        ? String(detail.waitingVisit.reductionFcfa)
        : '0',
    }
    applyCategoryBillingDefaults('edit')
  } catch {
    showAlert('Impossible de charger le dossier patient.', 'error')
    closeEditModal()
  } finally {
    loadingEdit.value = false
  }
}

function resetEditForm() {
  if (!selectedPatient.value) return
  editForm.value = {
    fullName: joinPatientFullName(selectedPatient.value.firstName, selectedPatient.value.lastName),
    age: selectedPatient.value.age != null ? String(selectedPatient.value.age) : '',
    ageUnit: normalizePatientAgeUnit(selectedPatient.value.ageUnit),
    phone: selectedPatient.value.phone ?? '',
    gender: selectedPatient.value.gender ?? 'F',
    category:
      selectedPatient.value.category === 'ONG'
        ? 'STANDARD'
        : (selectedPatient.value.category ?? 'STANDARD'),
    doctorId: selectedPatient.value.waitingVisit?.doctorId ?? doctors.value[0]?.id ?? '',
    consultationAmount: selectedPatient.value.waitingVisit?.consultationAmountFcfa
      ? String(selectedPatient.value.waitingVisit.consultationAmountFcfa)
      : '',
    reduction: selectedPatient.value.waitingVisit?.reductionFcfa != null
      ? String(selectedPatient.value.waitingVisit.reductionFcfa)
      : '0',
  }
}

function closeEditModal() {
  showEditModal.value = false
  selectedPatient.value = null
}

function openReconsultModal(patient: Patient) {
  selectedPatient.value = patient
  reconsultForm.value = {
    doctorId: doctors.value[0]?.id ?? '',
    consultationAmount: '',
  }
  renewalPreview.value = null
  applyDoctorBillingDefaults('reconsult')
  showReconsultModal.value = true
  void refreshReconsultFee()
}

function closeReconsultModal() {
  showReconsultModal.value = false
  selectedPatient.value = null
  reconsultForm.value = { doctorId: '', consultationAmount: '' }
  renewalPreview.value = null
}

async function submitReconsultation() {
  if (!selectedPatient.value || !canSubmitReconsult.value) return
  clearAlert()
  submittingReconsult.value = true
  try {
    const amount =
      renewalPreview.value?.amountFcfa ??
      (selectedPatient.value.category && isExemptCategory(selectedPatient.value.category)
        ? 0
        : resolveConsultationAmountForDoctor(
            reconsultDoctor.value,
            Number(reconsultForm.value.consultationAmount) || 0,
          ))

    const { data } = await api.post('/visits', {
      patientId: selectedPatient.value.id,
      doctorId: reconsultForm.value.doctorId,
      consultationAmountFcfa: amount,
    })
    const hint = (data as { renewalHint?: string }).renewalHint
    showAlert(
      hint
        ? `${fullName(selectedPatient.value.firstName, selectedPatient.value.lastName)} remis en consultation — ${hint}`
        : `${fullName(selectedPatient.value.firstName, selectedPatient.value.lastName)} remis en consultation.`,
    )
    closeReconsultModal()
    await refreshAll()
  } catch (e: unknown) {
    if (axios.isAxiosError(e)) {
      const apiMessage =
        typeof e.response?.data?.error === 'string' ? e.response.data.error : null
      if (apiMessage) {
        showAlert(apiMessage, 'error')
      } else if (e.response?.status === 409) {
        showAlert('Ce patient a déjà une visite en cours à la réception.', 'error')
      } else {
        showAlert('Impossible de créer la reconsultation.', 'error')
      }
    } else {
      showAlert('Impossible de créer la reconsultation.', 'error')
    }
  } finally {
    submittingReconsult.value = false
  }
}

async function saveEdit() {
  if (!selectedPatient.value || !canSaveEdit.value) return
  clearAlert()
  savingEdit.value = true
  try {
    const { firstName, lastName } = editParsedName.value
    const amount = editEffectiveAmount.value
    const reduction = editBillingExempt.value ? 0 : editReduction.value
    const { data } = await api.patch(`/patients/${selectedPatient.value.id}`, {
      firstName,
      lastName,
      age: editAge.value ?? undefined,
      ageUnit: editForm.value.ageUnit,
      phone: editForm.value.phone.trim() || undefined,
      gender: editForm.value.gender,
      category: editForm.value.category,
      doctorId: editForm.value.doctorId,
      consultationAmountFcfa: amount || undefined,
      reductionFcfa: reduction,
    })
    showAlert(`Dossier ${data.code} mis à jour.`)
    closeEditModal()
    await refreshAll()
  } catch (error: unknown) {
    const shown = await showDuplicateModalFromError(error)
    if (!shown) {
      await showApiErrorModal(error, 'Erreur lors de la modification du dossier.')
    }
  } finally {
    savingEdit.value = false
  }
}

function clearSearch() {
  search.value = ''
  loadPatients()
}

watch(search, () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(loadPatients, 300)
})

watch(() => form.value.category, () => applyCategoryBillingDefaults('form'))
watch(() => editForm.value.category, () => applyCategoryBillingDefaults('edit'))
watch(() => form.value.doctorId, () => applyDoctorBillingDefaults('form'))
watch(() => editForm.value.doctorId, () => applyDoctorBillingDefaults('edit'))
watch(() => reconsultForm.value.doctorId, () => {
  applyDoctorBillingDefaults('reconsult')
  void refreshReconsultFee()
})

onMounted(refreshAll)
onUnmounted(clearAlert)
</script>

<template>
  <div class="reception-dashboard">
    <section class="dashboard-sticky">
      <UiPageHeader
        title="Dashboard"
        subtitle="Vue d'ensemble et enregistrement des patients"
        :icon="LayoutDashboard"
      />

      <UiAlert v-if="message" :type="messageType" :message="message" class="page-alert" />

      <div class="stats-grid" :class="{ 'stats-grid--loading': loadingStats }">
        <article
          v-for="item in dashboardStats"
          :key="item.id"
          class="dash-stat card-accent card-accent--green"
          :class="`dash-stat--${item.variant}`"
        >
          <div class="dash-stat__icon">
            <component :is="item.icon" :size="18" />
          </div>
          <div class="dash-stat__body">
            <span class="dash-stat__label">{{ item.label }}</span>
            <strong class="dash-stat__value">
              {{ item.value }}
              <small v-if="item.id === 'revenue'" class="dash-stat__unit">FCFA</small>
            </strong>
            <span class="dash-stat__hint">{{ item.hint }}</span>
          </div>
        </article>
      </div>

      <div class="patients-panel-sticky">
        <div class="table-toolbar">
          <div class="table-toolbar__title">
            <h3>Patients enregistrés</h3>
            <p>Liste des dossiers créés à la réception</p>
          </div>

          <div class="table-toolbar__search">
            <div class="search-compact">
              <Search :size="16" class="search-compact__icon" />
              <input
                v-model="search"
                type="search"
                class="search-compact__input"
                placeholder="Rechercher par matricule, nom ou téléphone…"
                @keydown.enter.prevent="loadPatients"
              />
              <button
                v-if="search"
                type="button"
                class="search-compact__clear"
                aria-label="Effacer la recherche"
                @click="clearSearch"
              >
                <X :size="14" />
              </button>
            </div>
            <span class="search-count">{{ searchLabel }}</span>
          </div>

          <UiButton variant="primary" class="table-toolbar__new" @click="openModal">
            Nouveau
          </UiButton>
        </div>
      </div>
    </section>

    <section class="dashboard-body">
      <div class="patients-table-card">
        <div class="table-wrap">
          <PatientsDataTable
            fill
            :patients="patients"
            :loading="loadingPatients || !!deletingPatientId"
            @print="printPatientReceipt"
            @edit="openEditModal"
            @reconsult="openReconsultModal"
            @delete="deletePatient"
          />
        </div>
      </div>
    </section>

    <UiFormModal
      v-if="showModal"
      title-id="modal-title"
      title="Nouveau patient"
      subtitle="Enregistrement et consultation"
      :icon="UserPlus"
      @close="closeModal"
    >
      <form
        id="reception-new-patient-form"
        class="ui-form-modal__form reception-modal-form"
        @submit.prevent="createPatientAndVisit"
      >
        <ReceptionPatientIdentityFields
          v-model:full-name="form.fullName"
          v-model:age="form.age"
          v-model:age-unit="form.ageUnit"
          v-model:phone="form.phone"
          v-model:gender="form.gender"
        />

        <UiSelect
          v-model="form.category"
          label="Type de patient"
          @update:model-value="applyCategoryBillingDefaults('form')"
        >
          <option v-for="cat in PATIENT_CATEGORIES" :key="cat.value" :value="cat.value">
            {{ cat.label }}
          </option>
        </UiSelect>

        <div class="form-grid-2">
          <UiSelect v-model="form.doctorId" label="Médecin" required>
            <option value="" disabled>Sélectionner</option>
            <option v-for="doctor in doctors" :key="doctor.id" :value="doctor.id">
              Dr {{ fullName(doctor.firstName, doctor.lastName) }}{{ doctorSelectSuffix(doctor) }}
            </option>
          </UiSelect>
          <UiInput
            v-if="!formBillingExempt && doctorNeedsConsultationAmountInput(formDoctor)"
            v-model="form.consultationAmount"
            label="Montant consultation (FCFA)"
            type="number"
            min="0"
            placeholder="5000"
            :icon="Banknote"
            required
          />
          <div
            v-else-if="!formBillingExempt && doctorShowsFixedConsultationPrice(formDoctor)"
            class="total-preview total-preview--compact"
          >
            <span>Prix consultation</span>
            <strong>{{ formatFcfa(formEffectiveAmount) }}</strong>
          </div>
        </div>

        <p v-if="formDoctorQuotaHint" class="doctor-hint doctor-hint--compact">{{ formDoctorQuotaHint }}</p>
        <p v-else-if="doctorIsFixedSalary(formDoctor)" class="doctor-hint doctor-hint--compact">
          Médecin salarié — saisissez le montant de la consultation.
        </p>

        <div v-if="showFormConsultationBilling" class="form-grid-2">
          <UiInput
            v-model="form.reduction"
            label="Réduction (FCFA)"
            type="number"
            min="0"
            placeholder="0"
            :icon="Percent"
          />
          <div class="total-preview total-preview--compact">
            <span>Total à payer</span>
            <strong>{{ formatFcfa(formTotal) }}</strong>
          </div>
        </div>
      </form>

      <template #footer>
        <UiButton type="button" variant="ghost" @click="closeModal">Annuler</UiButton>
        <UiButton type="button" variant="ghost" :icon="RotateCcw" @click="resetForm">Effacer</UiButton>
        <UiButton
          type="submit"
          form="reception-new-patient-form"
          variant="primary"
          :icon="Printer"
          :loading="submitting"
          :disabled="!canSubmit"
        >
          Valider
        </UiButton>
      </template>
    </UiFormModal>

    <UiFormModal
      v-if="showEditModal && selectedPatient"
      title="Modifier le patient"
      :subtitle="selectedPatient.code"
      :icon="Pencil"
      @close="closeEditModal"
    >
      <div v-if="loadingEdit" class="reception-modal-loading">Chargement…</div>

      <form
        v-else
        id="reception-edit-patient-form"
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

        <UiSelect
          v-model="editForm.category"
          label="Type de patient"
          @update:model-value="applyCategoryBillingDefaults('edit')"
        >
          <option v-for="cat in PATIENT_CATEGORIES" :key="cat.value" :value="cat.value">
            {{ cat.label }}
          </option>
        </UiSelect>

        <div class="form-grid-2">
          <UiSelect v-model="editForm.doctorId" label="Médecin" required>
            <option value="" disabled>Sélectionner</option>
            <option v-for="doctor in doctors" :key="doctor.id" :value="doctor.id">
              Dr {{ fullName(doctor.firstName, doctor.lastName) }}{{ doctorSelectSuffix(doctor) }}
            </option>
          </UiSelect>
          <UiInput
            v-if="!editBillingExempt && doctorNeedsConsultationAmountInput(editDoctor)"
            v-model="editForm.consultationAmount"
            label="Montant consultation (FCFA)"
            type="number"
            min="0"
            placeholder="5000"
            :icon="Banknote"
            required
          />
          <div
            v-else-if="!editBillingExempt && doctorShowsFixedConsultationPrice(editDoctor)"
            class="total-preview total-preview--compact"
          >
            <span>Prix consultation</span>
            <strong>{{ formatFcfa(editEffectiveAmount) }}</strong>
          </div>
        </div>

        <p v-if="editDoctorQuotaHint" class="doctor-hint doctor-hint--compact">{{ editDoctorQuotaHint }}</p>
        <p v-else-if="doctorIsFixedSalary(editDoctor)" class="doctor-hint doctor-hint--compact">
          Médecin salarié — saisissez le montant de la consultation.
        </p>

        <div v-if="showEditConsultationBilling" class="form-grid-2">
          <UiInput
            v-model="editForm.reduction"
            label="Réduction (FCFA)"
            type="number"
            min="0"
            placeholder="0"
            :icon="Percent"
          />
          <div class="total-preview total-preview--compact">
            <span>Total à payer</span>
            <strong>{{ formatFcfa(editTotal) }}</strong>
          </div>
        </div>
      </form>

      <template #footer>
        <UiButton type="button" variant="ghost" @click="closeEditModal">Annuler</UiButton>
        <UiButton
          v-if="!loadingEdit"
          type="button"
          variant="ghost"
          :icon="RotateCcw"
          @click="resetEditForm"
        >
          Effacer
        </UiButton>
        <UiButton
          type="submit"
          form="reception-edit-patient-form"
          variant="primary"
          :icon="Pencil"
          :loading="savingEdit"
          :disabled="loadingEdit || !canSaveEdit"
        >
          Enregistrer
        </UiButton>
      </template>
    </UiFormModal>

    <UiFormModal
      v-if="showReconsultModal && selectedPatient"
      title="Reconsultation"
      :subtitle="`${fullName(selectedPatient.firstName, selectedPatient.lastName)} — ${selectedPatient.code}`"
      :icon="RotateCcw"
      @close="closeReconsultModal"
    >
      <form
        id="reception-reconsult-form"
        class="ui-form-modal__form reception-modal-form"
        @submit.prevent="submitReconsultation"
      >
        <p class="reconsult-hint">
          Nouvelle visite de consultation — examens, opérations et hospitalisation peuvent être prescrits à chaque passage.
          Si la validité du médecin est encore active, la consultation est gratuite (0 FCFA).
          L'historique précédent reste enregistré dans le dossier patient.
        </p>

        <p v-if="renewalPreview" class="renewal-banner" :class="{ 'renewal-banner--free': renewalPreview.withinValidity }">
          {{ renewalPreview.message }}
        </p>
        <p v-else-if="loadingRenewalPreview" class="doctor-hint">Calcul du tarif…</p>

        <section class="form-panel">
          <h3 class="form-panel__title">
            <Stethoscope :size="14" />
            Consultation
          </h3>
          <div class="form-grid-2">
            <UiSelect v-model="reconsultForm.doctorId" label="Médecin" required>
              <option value="" disabled>Sélectionner un médecin</option>
              <option v-for="doctor in doctors" :key="doctor.id" :value="doctor.id">
                Dr {{ fullName(doctor.firstName, doctor.lastName) }}{{ doctorSelectSuffix(doctor) }}
              </option>
            </UiSelect>
            <UiInput
              v-if="
                (!selectedPatient?.category || !isExemptCategory(selectedPatient.category)) &&
                doctorNeedsConsultationAmountInput(reconsultDoctor)
              "
              v-model="reconsultForm.consultationAmount"
              label="Montant consultation (FCFA)"
              type="number"
              min="1"
              placeholder="Ex. 5000"
              :icon="Banknote"
              required
            />
            <div
              v-else-if="
                (!selectedPatient?.category || !isExemptCategory(selectedPatient.category)) &&
                doctorShowsFixedConsultationPrice(reconsultDoctor)
              "
              class="total-preview total-preview--compact"
            >
              <span>Prix consultation</span>
              <strong>{{
                formatFcfa(renewalPreview?.amountFcfa ?? resolveConsultationAmountForDoctor(
                  reconsultDoctor,
                  Number(reconsultForm.consultationAmount) || 0,
                ))
              }}</strong>
            </div>
          </div>
          <p v-if="reconsultDoctorQuotaHint" class="doctor-hint">{{ reconsultDoctorQuotaHint }}</p>
          <p v-else-if="doctorIsFixedSalary(reconsultDoctor)" class="doctor-hint">
            Médecin salarié — saisissez le montant de la consultation.
          </p>
        </section>
      </form>

      <template #footer>
        <UiButton type="button" variant="ghost" @click="closeReconsultModal">Annuler</UiButton>
        <UiButton
          type="submit"
          form="reception-reconsult-form"
          variant="primary"
          :loading="submittingReconsult"
          :disabled="!canSubmitReconsult"
        >
          {{ submittingReconsult ? 'Envoi…' : 'Valider' }}
        </UiButton>
      </template>
    </UiFormModal>
  </div>
</template>

<style scoped>
.reception-dashboard {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  height: calc(100dvh - 9rem);
  min-height: 0;
}

.dashboard-sticky {
  flex-shrink: 0;
  position: sticky;
  top: 0;
  z-index: 30;
  margin: -1.75rem -2rem 0;
  padding: 0.875rem 2rem 1.125rem;
  background: var(--bg-app);
  border-bottom: none;
  box-shadow: none;
}

.dashboard-sticky :deep(.page-header) {
  margin-bottom: 0.625rem;
}

.dashboard-sticky :deep(.page-header__main) {
  gap: 0.625rem;
}

.dashboard-sticky :deep(.page-header__icon) {
  width: 2.25rem;
  height: 2.25rem;
  border-radius: 10px;
  box-shadow: none;
}

.dashboard-sticky :deep(.page-header__icon svg) {
  width: 18px;
  height: 18px;
}

.dashboard-sticky :deep(.page-header h1) {
  font-size: 1.125rem;
  line-height: 1.2;
}

.dashboard-sticky :deep(.page-header p) {
  margin-top: 0.1rem;
  font-size: 0.75rem;
  line-height: 1.3;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.625rem;
  margin: 0;
}

.stats-grid--loading {
  opacity: 0.65;
  pointer-events: none;
}

.dash-stat {
  display: flex;
  align-items: flex-start;
  gap: 0.625rem;
  padding: 0.7rem 0.8rem;
  min-width: 0;
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.dash-stat__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  border-radius: 10px;
  flex-shrink: 0;
}

.dash-stat--teal .dash-stat__icon {
  background: var(--primary-100);
  color: var(--primary-700);
}

.dash-stat--amber .dash-stat__icon {
  background: var(--warning-bg);
  color: var(--warning);
}

.dash-stat--blue .dash-stat__icon {
  background: var(--medical-blue-light);
  color: var(--medical-blue);
}

.dash-stat--violet .dash-stat__icon {
  background: #ede9fe;
  color: #7c3aed;
}

.dash-stat--rose .dash-stat__icon {
  background: #ffe4e6;
  color: #e11d48;
}

.dash-stat__body {
  min-width: 0;
  flex: 1;
}

.dash-stat__label {
  display: block;
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--text-muted);
  line-height: 1.2;
}

.dash-stat__value {
  display: flex;
  align-items: baseline;
  gap: 0.2rem;
  margin-top: 0.15rem;
  font-size: 1.375rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.1;
  color: var(--text);
}

.dash-stat__unit {
  font-size: 0.625rem;
  font-weight: 600;
  color: var(--text-muted);
}

.dash-stat__hint {
  display: block;
  margin-top: 0.15rem;
  font-size: 0.625rem;
  color: var(--text-light);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dashboard-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding-top: 0;
}

.patients-panel-sticky {
  margin-top: 0.625rem;
  padding-top: 0.625rem;
  padding-bottom: 0.25rem;
  border-top: 1px solid var(--border);
}

.patients-table-card {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  margin-top: 0.25rem;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-sm);
  overflow: hidden;
}

.patients-table-card .table-wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 0.5rem 0.75rem 0.75rem;
}

.page-alert {
  margin-top: 0 !important;
  margin-bottom: 0.5rem;
  padding: 0.5rem 0.75rem !important;
  font-size: 0.8125rem !important;
}

.table-toolbar {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 22rem) auto;
  align-items: center;
  gap: 0.75rem 1rem;
  margin-bottom: 0;
}

.table-toolbar__title {
  min-width: 0;
}

.table-toolbar__title h3 {
  margin: 0;
  font-size: 0.9375rem;
  font-weight: 700;
  color: var(--text);
  line-height: 1.2;
}

.table-toolbar__title p {
  margin: 0.1rem 0 0;
  font-size: 0.6875rem;
  color: var(--text-muted);
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.table-toolbar__new {
  flex-shrink: 0;
  justify-self: end;
}

.table-toolbar__search {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0.2rem;
  width: 100%;
  min-width: 0;
  padding: 0;
}

.search-compact {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.45rem 0.875rem;
  border: 1.5px solid var(--border);
  border-radius: 999px;
  background: #fff;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.search-compact:focus-within {
  border-color: var(--primary-500);
  box-shadow: 0 0 0 3px var(--focus-ring-sm);
}

.search-compact__icon {
  color: var(--text-light);
  flex-shrink: 0;
}

.search-compact__input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  font-size: 0.8125rem;
  color: var(--text);
  outline: none;
}

.search-compact__input::placeholder {
  color: var(--text-light);
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

.search-compact__clear:hover {
  background: #e2e8f0;
}

.search-count {
  font-size: 0.6875rem;
  color: var(--text-muted);
  line-height: 1;
  padding-left: 0.25rem;
}

.row-actions {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 0.25rem;
}

.row-actions :deep(.ui-btn--sm) {
  padding: 0.35rem 0.55rem;
  font-size: 0.75rem;
  gap: 0.3rem;
}

.reconsult-hint,
.doctor-hint {
  margin: 0 0 0.75rem;
  font-size: 0.8125rem;
  color: var(--text-muted);
  line-height: 1.45;
}

.doctor-hint {
  margin-top: 0.5rem;
}

.reconsult-hint {
  margin: 0;
  font-size: 0.875rem;
  line-height: 1.5;
}

.renewal-banner {
  margin: 0.75rem 0 0;
  padding: 0.65rem 0.85rem;
  border-radius: var(--radius-sm);
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--warning);
  background: var(--warning-bg);
  border: 1px solid color-mix(in srgb, var(--warning) 25%, transparent);
}

.renewal-banner--free {
  color: var(--success);
  background: var(--success-bg);
  border-color: color-mix(in srgb, var(--success) 25%, transparent);
}

.form-section {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1rem;
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

.form-section :deep(.ui-field) {
  margin-bottom: 0;
}

.form-grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
}

.form-grid-2--single {
  grid-template-columns: 1fr;
}

@media (max-width: 560px) {
  .form-grid-2 {
    grid-template-columns: 1fr;
  }
}

.total-preview {
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: 0.35rem;
  padding: 0.65rem 0.9rem;
  background: #fff;
  border: 1.5px solid var(--primary-200);
  border-radius: var(--radius-sm);
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

.gender-field {
  margin: 0;
  padding: 0;
  border: 0;
}

.gender-field legend {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text);
  margin-bottom: 0.45rem;
  padding: 0;
}

.gender-options {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem;
}

.gender-option {
  padding: 0.7rem 0.75rem;
  border: 1.5px solid var(--border);
  border-radius: var(--radius-sm);
  background: #fff;
  color: var(--text-muted);
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.gender-option--active {
  border-color: var(--primary-500);
  background: var(--primary-50);
  color: var(--primary-800);
}

.reception-modal-form {
  gap: 0.65rem;
}

.reception-modal-form :deep(.ui-field) {
  margin-bottom: 0;
}

.reception-modal-form .form-grid-2 {
  gap: 0.6rem;
}

.reception-modal-loading {
  padding: 2rem 0;
  text-align: center;
  color: var(--text-light);
  font-size: 0.875rem;
}

.doctor-hint--compact {
  margin: 0;
  font-size: 0.75rem;
  line-height: 1.35;
}

.total-preview--compact {
  padding: 0.5rem 0.75rem;
  gap: 0.2rem;
}

.total-preview--compact span {
  font-size: 0.6875rem;
}

.total-preview--compact strong {
  font-size: 1rem;
}

@media (max-width: 1100px) {
  .stats-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 768px) {
  .reception-dashboard {
    height: auto;
  }

  .dashboard-sticky {
    margin: -1.75rem -1rem 0;
    padding: 0.75rem 1rem 0.75rem;
  }

  .stats-grid {
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
  }

  .dash-stat__value {
    font-size: 1.125rem;
  }

  .dashboard-body {
    flex: none;
    min-height: auto;
  }

  .patients-table-card {
    flex: none;
    min-height: auto;
  }

  .table-wrap {
    max-height: 55dvh;
  }

  .col-actions {
    width: auto;
  }

  .table-toolbar {
    grid-template-columns: 1fr;
    gap: 0.5rem;
  }

  .table-toolbar__new {
    width: 100%;
    justify-self: stretch;
  }

  .table-toolbar__title p {
    white-space: normal;
  }

  .search-compact {
    width: 100%;
  }

  .row-actions {
    flex-wrap: wrap;
  }

  .modal__footer :deep(.ui-btn) {
    flex: 1;
  }
}
</style>
