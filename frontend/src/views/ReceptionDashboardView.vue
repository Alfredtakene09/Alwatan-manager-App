<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
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
  CircleDollarSign,
  FlaskConical,
} from '@lucide/vue'
import api from '@/api/client'
import { confirmAppModal, showApiErrorModal, showValidationErrorModal } from '@/lib/api-modal-helper'
import { fullName, formatFcfa, formatFcfaCompact, isDirectionOrGestionnaire } from '@/lib/roles'
import {
  joinPatientFullName,
  parsePatientAge,
  splitPatientFullName,
} from '@/lib/patient-name'
import { normalizePatientAgeUnit, type PatientAgeUnit } from '@/lib/patient-age'
import { sortPatientsNewestFirst } from '@/lib/patient-sort'
import { type PatientCategory } from '@/lib/patient-category'
import {
  doctorMatchesService,
  doctorShowsFixedConsultationPrice,
  defaultConsultationAmountForDoctor,
  type ConsultationRenewalPreview,
  type DoctorOption,
} from '@/lib/doctor-compensation'
import { translateTemplate } from '@/lib/dashboard-i18n'
import { useAuthStore } from '@/stores/auth'
import { useAppI18n } from '@/i18n/useAppI18n'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiFormModal from '@/components/ui/UiFormModal.vue'
import PatientsDataTable from '@/components/ui/PatientsDataTable.vue'
import ReceptionPatientIdentityFields from '@/components/reception/ReceptionPatientIdentityFields.vue'
import DoctorSharesReceivablePanel from '@/components/reception/DoctorSharesReceivablePanel.vue'

type ReceptionStats = {
  registeredToday: number
  femalePatients: number
  malePatients: number
  visitsToday: number
  externalPatientsToday?: number
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
  service?: string | null
  gender?: string
  category?: PatientCategory
  treatingDoctorId?: string | null
  treatingDoctor?: Doctor | null
  createdAt?: string
  canDelete?: boolean
  createdBy?: { id: string; firstName: string; lastName: string } | null
}

type Doctor = DoctorOption
type ServiceOption = { id: string; name: string }
type ReceptionistOption = { id: string; name: string }

function findDoctor(doctorId: string) {
  return doctors.value.find((doctor) => doctor.id === doctorId)
}

type PatientDetail = Patient & {
  category?: PatientCategory
  treatingDoctorId?: string | null
  treatingDoctor?: Doctor | null
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

const { uiText, dateText, localeCode } = useAppI18n()
const auth = useAuthStore()
const isReceptionist = computed(() => auth.user?.role === 'RECEPTIONNISTE')

type ReceptionPageTab = 'enregistrement' | 'doctor-shares'
const canSeeDoctorSharesTab = computed(() =>
  Boolean(auth.user && isDirectionOrGestionnaire(auth.user.role)),
)
const activeReceptionTab = ref<ReceptionPageTab>('enregistrement')

const receptionTabs = computed(() => {
  void localeCode.value
  const tabs: Array<{ id: ReceptionPageTab; label: string; icon: typeof UserPlus }> = [
    { id: 'enregistrement', label: uiText('Enregistrement'), icon: UserPlus },
  ]
  if (canSeeDoctorSharesTab.value) {
    tabs.push({
      id: 'doctor-shares',
      label: uiText('Parts médecins à percevoir'),
      icon: CircleDollarSign,
    })
  }
  return tabs
})

watch(canSeeDoctorSharesTab, (canSee) => {
  if (!canSee && activeReceptionTab.value === 'doctor-shares') {
    activeReceptionTab.value = 'enregistrement'
  }
})

function todayInputValue() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const patients = ref<Patient[]>([])
const doctors = ref<Doctor[]>([])
const services = ref<ServiceOption[]>([])
const receptionists = ref<ReceptionistOption[]>([])
const filterReceptionistId = ref('')
const listFrom = ref(todayInputValue())
const listTo = ref(todayInputValue())
const sortedDoctors = computed(() =>
  [...doctors.value].sort((a, b) => {
    const byLast = a.lastName.localeCompare(b.lastName, 'fr', { sensitivity: 'base' })
    if (byLast !== 0) return byLast
    return a.firstName.localeCompare(b.firstName, 'fr', { sensitivity: 'base' })
  }),
)
function filteredDoctorsByService(serviceName: string) {
  if (!serviceName) return sortedDoctors.value
  return sortedDoctors.value.filter((doctor) => doctorMatchesService(doctor, serviceName))
}
const formServiceDoctors = computed(() => filteredDoctorsByService(form.value.service))
const editServiceDoctors = computed(() => filteredDoctorsByService(editForm.value.service))
const stats = ref<ReceptionStats>({
  registeredToday: 0,
  femalePatients: 0,
  malePatients: 0,
  visitsToday: 0,
  externalPatientsToday: 0,
  revenueTodayFcfa: 0,
})
const loadingStats = ref(false)
const showDaySummary = ref(false)
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
})
const renewalPreview = ref<ConsultationRenewalPreview | null>(null)
const loadingRenewalPreview = ref(false)

const editForm = ref({
  fullName: '',
  age: '',
  ageUnit: 'YEARS' as PatientAgeUnit,
  phone: '',
  service: '',
  gender: 'F',
  category: 'STANDARD' as PatientCategory,
  doctorId: '',
  treatingDoctorId: '',
})

const form = ref({
  fullName: '',
  age: '',
  ageUnit: 'YEARS' as PatientAgeUnit,
  phone: '',
  service: '',
  gender: 'F',
  category: 'STANDARD' as PatientCategory,
  doctorId: '',
  treatingDoctorId: '',
})

const formParsedName = computed(() => splitPatientFullName(form.value.fullName))
const editParsedName = computed(() => splitPatientFullName(editForm.value.fullName))
const formAge = computed(() => parsePatientAge(form.value.age, form.value.ageUnit))
const editAge = computed(() => parsePatientAge(editForm.value.age, editForm.value.ageUnit))

const formDoctor = computed(() => findDoctor(form.value.doctorId))
const editDoctor = computed(() => findDoctor(editForm.value.doctorId))

const formConsultationPrice = computed(() => {
  const doctor = formDoctor.value
  if (!doctor) return 0
  if (doctorShowsFixedConsultationPrice(doctor)) {
    return defaultConsultationAmountForDoctor(doctor)
  }
  return Math.max(0, Number(doctor.consultationTotalFcfa) || 0)
})

const editConsultationPrice = computed(() => {
  const doctor = editDoctor.value
  if (!doctor) return 0
  if (doctorShowsFixedConsultationPrice(doctor)) {
    return defaultConsultationAmountForDoctor(doctor)
  }
  return Math.max(0, Number(doctor.consultationTotalFcfa) || 0)
})

const reconsultConsultationPrice = computed(() => {
  if (renewalPreview.value?.withinValidity) return 0
  return Math.max(0, Number(renewalPreview.value?.amountFcfa) || 0)
})

function collectNewPatientValidationErrors(): string[] {
  const issues: string[] = []
  const { firstName, lastName } = formParsedName.value
  const phoneDigits = form.value.phone.replace(/\D/g, '')
  const phoneRaw = form.value.phone.trim()

  if (!form.value.fullName.trim()) {
    issues.push('Indiquez le nom et le prénom du patient.')
  } else {
    if (firstName.length < 2) {
      issues.push('Le prénom doit contenir au moins 2 lettres (séparez nom et prénom par un espace).')
    }
    if (lastName.length < 2) {
      issues.push('Le nom doit contenir au moins 2 lettres (séparez nom et prénom par un espace).')
    }
  }

  if (!phoneRaw) {
    issues.push('Le téléphone est obligatoire (au moins 6 chiffres).')
  } else if (phoneDigits.length < 6) {
    issues.push('Le téléphone doit contenir au moins 6 chiffres.')
  }

  if (formAge.value === null) {
    issues.push('Indiquez un âge valide.')
  }

  if (!form.value.service) {
    issues.push('Sélectionnez un service.')
  }

  if (!form.value.doctorId) {
    issues.push('Sélectionnez un médecin.')
  }

  return issues
}

function collectEditPatientValidationErrors(): string[] {
  const issues: string[] = []
  const { firstName, lastName } = editParsedName.value

  if (!editForm.value.fullName.trim()) {
    issues.push('Indiquez le nom et le prénom du patient.')
  } else {
    if (firstName.length < 2) {
      issues.push('Le prénom doit contenir au moins 2 lettres (séparez nom et prénom par un espace).')
    }
    if (lastName.length < 2) {
      issues.push('Le nom doit contenir au moins 2 lettres (séparez nom et prénom par un espace).')
    }
  }

  if (editAge.value === null) {
    issues.push('Indiquez un âge valide.')
  }

  if (!editForm.value.service) {
    issues.push('Sélectionnez un service.')
  }

  if (!editForm.value.doctorId) {
    issues.push('Sélectionnez un médecin.')
  }

  return issues
}

function collectReconsultValidationErrors(): string[] {
  const issues: string[] = []
  if (!reconsultForm.value.doctorId) {
    issues.push('Sélectionnez un médecin.')
  }
  return issues
}

const searchLabel = computed(() =>
  search.value.trim()
    ? translateTemplate('{n} résultat(s)', { n: patients.value.length })
    : translateTemplate('{n} dossier(s) affiché(s)', { n: patients.value.length }),
)

const listDateLabel = computed(() => {
  const formatOne = (value: string) => {
    if (!value) return uiText("Aujourd'hui")
    const [y, m, d] = value.split('-').map(Number)
    if (!y || !m || !d) return value
    return dateText(new Date(y, m - 1, d), {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
  }
  const from = listFrom.value || todayInputValue()
  const to = listTo.value || from
  if (from === to) return formatOne(from)
  return translateTemplate('du {from} au {to}', {
    from: formatOne(from),
    to: formatOne(to),
  })
})

const canFilterByReceptionist = computed(() => !isReceptionist.value)

const selectedReceptionistName = computed(() => {
  if (!filterReceptionistId.value) return ''
  return receptionists.value.find((item) => item.id === filterReceptionistId.value)?.name ?? ''
})

const patientsPanelSubtitle = computed(() => {
  const scope =
    auth.user?.role === 'RECEPTIONNISTE'
      ? uiText('Vos dossiers créés à la réception')
      : selectedReceptionistName.value
        ? translateTemplate('Dossiers enregistrés par {name}', { name: selectedReceptionistName.value })
        : uiText('Liste des dossiers créés à la réception')
  return translateTemplate('{scope} — {date}', {
    scope,
    date: listDateLabel.value,
  })
})

const isListDateToday = computed(() => {
  const today = todayInputValue()
  return listFrom.value === today && listTo.value === today
})

const dashboardStats = computed(() => {
  const base = [
  {
    id: 'today',
    label: 'Inscrits aujourd\'hui',
    value: stats.value.registeredToday,
    hint: translateTemplate('{n} passage(s) enregistré(s)', { n: stats.value.visitsToday }),
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
    id: 'external',
    label: 'Patients externes',
    value: stats.value.externalPatientsToday ?? 0,
    hint: 'Examens sans consultation — aujourd’hui',
    icon: FlaskConical,
    variant: 'teal' as const,
  },
  ]
  if (isReceptionist.value) return base
  return [
    ...base,
    {
      id: 'revenue',
      label: stats.value.isPersonalScope ? 'Mes encaissements (jour)' : 'Recettes du jour',
      value: formatFcfaCompact(stats.value.netTodayFcfa ?? stats.value.revenueTodayFcfa),
      hint: stats.value.isPersonalScope
        ? stats.value.expensesTodayFcfa
          ? translateTemplate('Brut {gross} − dépenses {expenses}', {
              gross: formatFcfaCompact(stats.value.revenueTodayFcfa),
              expenses: formatFcfaCompact(stats.value.expensesTodayFcfa ?? 0),
            })
          : 'Uniquement vos encaissements'
        : 'Consultations, examens, opérations, hospitalisation (hors associés)',
      icon: Banknote,
      variant: 'violet' as const,
    },
  ]
})

let searchTimer: ReturnType<typeof setTimeout> | undefined

async function loadReceptionStats() {
  loadingStats.value = true
  try {
    const { data } = await api.get<ReceptionStats>('/patients/reception-stats', {
      params: {
        createdById: canFilterByReceptionist.value ? filterReceptionistId.value || undefined : undefined,
      },
    })
    stats.value = data
  } finally {
    loadingStats.value = false
  }
}

async function openDaySummary() {
  await loadReceptionStats()
  showDaySummary.value = true
}

async function loadPatients() {
  loadingPatients.value = true
  try {
    let from = listFrom.value || todayInputValue()
    let to = listTo.value || from
    if (from > to) {
      ;[from, to] = [to, from]
      listFrom.value = from
      listTo.value = to
    }
    const { data } = await api.get('/patients', {
      params: {
        q: search.value.trim() || undefined,
        from,
        to,
        createdById: canFilterByReceptionist.value ? filterReceptionistId.value || undefined : undefined,
      },
    })
    patients.value = sortPatientsNewestFirst(data)
  } finally {
    loadingPatients.value = false
  }
}

async function loadDoctors() {
  try {
    const { data } = await api.get('/visits/doctors')
    doctors.value = Array.isArray(data) ? data : []
    syncDoctorForService('form')
    syncDoctorForService('edit')
  } catch {
    doctors.value = []
  }
}

async function loadReceptionists() {
  if (!canFilterByReceptionist.value) {
    receptionists.value = []
    return
  }
  try {
    const { data } = await api.get<ReceptionistOption[]>('/patients/receptionists')
    receptionists.value = Array.isArray(data) ? data : []
  } catch {
    receptionists.value = []
  }
}

async function loadServices() {
  try {
    const { data } = await api.get<ServiceOption[]>('/visits/external-services')
    services.value = Array.isArray(data) ? data : []
    if (!form.value.service) form.value.service = services.value[0]?.name ?? ''
    if (!editForm.value.service) editForm.value.service = services.value[0]?.name ?? ''
    syncDoctorForService('form')
    syncDoctorForService('edit')
  } catch {
    services.value = []
  }
}

async function refreshAll() {
  await Promise.all([
    loadPatients(),
    loadReceptionStats(),
    loadDoctors(),
    loadServices(),
    loadReceptionists(),
  ])
}

function resetForm() {
  form.value = {
    fullName: '',
    age: '',
    ageUnit: 'YEARS',
    phone: '',
    service: services.value[0]?.name ?? '',
    gender: 'F',
    category: 'STANDARD',
    doctorId: '',
    treatingDoctorId: '',
  }
  syncDoctorForService('form')
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
        },
      },
    )
    renewalPreview.value = data
  } catch {
    renewalPreview.value = null
  } finally {
    loadingRenewalPreview.value = false
  }
}

function syncDoctorForService(target: 'form' | 'edit') {
  const state = target === 'form' ? form.value : editForm.value
  const allowed = target === 'form' ? formServiceDoctors.value : editServiceDoctors.value
  if (!allowed.length) {
    state.doctorId = ''
    if (state.treatingDoctorId && !findDoctor(state.treatingDoctorId)) state.treatingDoctorId = ''
    return
  }
  if (!allowed.some((doctor) => doctor.id === state.doctorId)) {
    state.doctorId = allowed[0]?.id ?? ''
  }
  if (state.treatingDoctorId && !allowed.some((doctor) => doctor.id === state.treatingDoctorId)) {
    state.treatingDoctorId = ''
  }
}

async function openModal() {
  await loadServices()
  resetForm()
  showModal.value = true
}

function closeModal() {
  showModal.value = false
  resetForm()
}

async function createPatientAndVisit() {
  const validationIssues = collectNewPatientValidationErrors()
  if (validationIssues.length) {
    await showValidationErrorModal(validationIssues)
    return
  }
  clearAlert()
  submitting.value = true
  try {
    const { firstName, lastName } = formParsedName.value

    const { data } = await api.post<{
      patient: Patient
      invoiceNumber?: string | null
      totalFcfa: number
      billingDeferred?: boolean
      linkedExistingDossier?: boolean
    }>('/patients/register-consultation', {
      firstName,
      lastName,
      age: formAge.value ?? undefined,
      ageUnit: form.value.ageUnit,
      phone: form.value.phone.trim(),
      service: form.value.service || undefined,
      gender: form.value.gender,
      category: 'STANDARD',
      doctorId: form.value.doctorId,
      treatingDoctorId: form.value.treatingDoctorId || null,
    })

    const patient = data.patient
    showAlert(
      translateTemplate(
        'Dossier {code} enregistré — {name} est en attente de consultation.',
        {
          code: patient.code,
          name: fullName(patient.firstName, patient.lastName),
        },
      ),
    )
    closeModal()
    listFrom.value = todayInputValue()
    listTo.value = todayInputValue()
    await refreshAll()
  } catch (error) {
    await showApiErrorModal(error, 'Erreur lors de la création du dossier.')
  } finally {
    submitting.value = false
  }
}

async function loadPatientDetail(patientId: string) {
  const { data } = await api.get<PatientDetail>(`/patients/${patientId}`)
  return data
}

async function deletePatient(patient: Patient) {
  if (patient.canDelete === false) {
    showAlert(
      'Impossible de supprimer : ce patient a déjà été envoyé et consulté.',
      'error',
    )
    return
  }

  const patientName = fullName(patient.firstName, patient.lastName)
  const confirmed = await confirmAppModal({
    type: 'DELETE',
    title: 'Supprimer le patient',
    message: translateTemplate(
      'Supprimer le dossier {code} — {name} ? Cette action est irréversible.',
      { code: patient.code, name: patientName },
    ),
    confirmLabel: 'Supprimer',
  })
  if (!confirmed) return

  deletingPatientId.value = patient.id
  clearAlert()
  try {
    await api.delete(`/patients/${patient.id}`)
    showAlert(translateTemplate('Dossier {code} supprimé.', { code: patient.code }))
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
    await loadServices()
    const detail = await loadPatientDetail(patient.id)
    selectedPatient.value = detail
    editForm.value = {
      fullName: joinPatientFullName(detail.firstName, detail.lastName),
      age: detail.age != null ? String(detail.age) : '',
      ageUnit: normalizePatientAgeUnit(detail.ageUnit),
      phone: detail.phone ?? '',
      service: detail.service || services.value[0]?.name || '',
      gender: detail.gender ?? 'F',
      category: detail.category === 'ONG' ? 'STANDARD' : (detail.category ?? 'STANDARD'),
      doctorId: detail.waitingVisit?.doctorId ?? doctors.value[0]?.id ?? '',
      treatingDoctorId: detail.treatingDoctorId ?? '',
    }
    syncDoctorForService('edit')
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
    service: selectedPatient.value.service ?? '',
    gender: selectedPatient.value.gender ?? 'F',
    category:
      selectedPatient.value.category === 'ONG'
        ? 'STANDARD'
        : (selectedPatient.value.category ?? 'STANDARD'),
    doctorId: selectedPatient.value.waitingVisit?.doctorId ?? doctors.value[0]?.id ?? '',
    treatingDoctorId: selectedPatient.value.treatingDoctorId ?? '',
  }
  syncDoctorForService('edit')
}

function closeEditModal() {
  showEditModal.value = false
  selectedPatient.value = null
}

function openReconsultModal(patient: Patient) {
  selectedPatient.value = patient
  reconsultForm.value = {
    doctorId: doctors.value[0]?.id ?? '',
  }
  renewalPreview.value = null
  showReconsultModal.value = true
  void refreshReconsultFee()
}

function closeReconsultModal() {
  showReconsultModal.value = false
  selectedPatient.value = null
  reconsultForm.value = { doctorId: '' }
  renewalPreview.value = null
}

async function submitReconsultation() {
  if (!selectedPatient.value) return
  const validationIssues = collectReconsultValidationErrors()
  if (validationIssues.length) {
    await showValidationErrorModal(validationIssues)
    return
  }
  clearAlert()
  submittingReconsult.value = true
  try {
    const { data } = await api.post('/visits', {
      patientId: selectedPatient.value.id,
      doctorId: reconsultForm.value.doctorId,
    })
    const hint = (data as { renewalHint?: string }).renewalHint
    const patientName = fullName(selectedPatient.value.firstName, selectedPatient.value.lastName)
    showAlert(
      hint
        ? translateTemplate('{name} remis en consultation — {hint}', {
            name: patientName,
            hint: uiText(hint),
          })
        : translateTemplate('{name} remis en consultation.', { name: patientName }),
    )
    closeReconsultModal()
    await refreshAll()
  } catch (error) {
    await showApiErrorModal(error, 'Impossible de créer la reconsultation.')
  } finally {
    submittingReconsult.value = false
  }
}

async function saveEdit() {
  if (!selectedPatient.value) return
  const validationIssues = collectEditPatientValidationErrors()
  if (validationIssues.length) {
    await showValidationErrorModal(validationIssues)
    return
  }
  clearAlert()
  savingEdit.value = true
  try {
    const { firstName, lastName } = editParsedName.value
    const { data } = await api.patch(`/patients/${selectedPatient.value.id}`, {
      firstName,
      lastName,
      age: editAge.value ?? undefined,
      ageUnit: editForm.value.ageUnit,
      phone: editForm.value.phone.trim() || undefined,
      service: editForm.value.service || undefined,
      gender: editForm.value.gender,
      category: 'STANDARD',
      doctorId: editForm.value.doctorId,
      treatingDoctorId: editForm.value.treatingDoctorId || null,
    })
    showAlert(translateTemplate('Dossier {code} mis à jour.', { code: data.code }))
    closeEditModal()
    await refreshAll()
  } catch (error: unknown) {
    await showApiErrorModal(error, 'Erreur lors de la modification du dossier.')
  } finally {
    savingEdit.value = false
  }
}

function clearSearch() {
  search.value = ''
  loadPatients()
}

function resetListDateToToday() {
  const today = todayInputValue()
  listFrom.value = today
  listTo.value = today
}

watch(search, () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(loadPatients, 300)
})

watch([listFrom, listTo, filterReceptionistId], () => {
  loadPatients()
  void loadReceptionStats()
})

watch(() => form.value.service, () => {
  syncDoctorForService('form')
})
watch(() => editForm.value.service, () => {
  syncDoctorForService('edit')
})
watch(() => reconsultForm.value.doctorId, () => {
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
        subtitle="Enregistrement des patients uniquement — le paiement est géré par le gestionnaire"
        :icon="LayoutDashboard"
      >
        <template #actions>
          <UiButton
            variant="ghost"
            :icon="CalendarDays"
            :loading="loadingStats"
            @click="openDaySummary"
          >
            Bilan du jour
          </UiButton>
        </template>
      </UiPageHeader>

      <div
        v-if="canSeeDoctorSharesTab"
        class="reception-page-tabs"
        role="tablist"
        :aria-label="uiText('Sections réception')"
      >
        <button
          v-for="tab in receptionTabs"
          :key="tab.id"
          type="button"
          role="tab"
          class="reception-page-tabs__btn"
          :class="{ 'reception-page-tabs__btn--active': activeReceptionTab === tab.id }"
          :aria-selected="activeReceptionTab === tab.id"
          @click="activeReceptionTab = tab.id"
        >
          <component :is="tab.icon" :size="16" />
          {{ tab.label }}
        </button>
      </div>

      <DoctorSharesReceivablePanel
        v-if="canSeeDoctorSharesTab && activeReceptionTab === 'doctor-shares'"
      />

      <template v-if="!canSeeDoctorSharesTab || activeReceptionTab === 'enregistrement'">
      <UiAlert v-if="message" :type="messageType" :message="message" class="page-alert" />

      <div class="stats-grid" :class="{ 'stats-grid--loading': loadingStats && dashboardStats.length }">
        <article
          v-for="item in dashboardStats"
          :key="item.id"
          class="dash-stat card-accent card-accent--green dash-stat--direct"
          :class="`dash-stat--${item.variant}`"
        >
          <div class="dash-stat__body">
            <strong class="dash-stat__value">
              {{ item.value }}
              <small v-if="item.id === 'revenue'" class="dash-stat__unit">FCFA</small>
            </strong>
            <span class="dash-stat__label">{{ uiText(item.label) }}</span>
            <span class="dash-stat__hint">{{ uiText(item.hint) }}</span>
          </div>
          <div class="dash-stat__icon">
            <component :is="item.icon" :size="18" />
          </div>
        </article>
      </div>

      <div class="patients-panel-sticky">
        <div class="table-toolbar">
          <div class="table-toolbar__title">
            <h3>{{ uiText('Patients enregistrés') }}</h3>
            <p>{{ patientsPanelSubtitle }}</p>
          </div>

          <div class="table-toolbar__filters">
            <div class="date-range-filter">
              <label class="date-filter">
                <span class="date-filter__label">{{ uiText('Du') }}</span>
                <input
                  v-model="listFrom"
                  type="date"
                  class="date-filter__input"
                  :max="listTo || undefined"
                  :aria-label="uiText('Du')"
                />
              </label>
              <label class="date-filter">
                <span class="date-filter__label">{{ uiText('Au') }}</span>
                <input
                  v-model="listTo"
                  type="date"
                  class="date-filter__input"
                  :min="listFrom || undefined"
                  :aria-label="uiText('Au')"
                />
              </label>
              <label v-if="canFilterByReceptionist" class="date-filter">
                <span class="date-filter__label">{{ uiText('Réceptionniste') }}</span>
                <select
                  v-model="filterReceptionistId"
                  class="date-filter__input"
                  :aria-label="uiText('Réceptionniste')"
                >
                  <option value="">{{ uiText('Tous les réceptionnistes') }}</option>
                  <option v-for="item in receptionists" :key="item.id" :value="item.id">
                    {{ item.name }}
                  </option>
                </select>
              </label>
              <button
                v-if="!isListDateToday"
                type="button"
                class="date-filter__today"
                @click="resetListDateToToday"
              >
                {{ uiText("Aujourd'hui") }}
              </button>
            </div>

            <div class="table-toolbar__search">
              <div class="search-compact">
                <Search :size="16" class="search-compact__icon" />
                <input
                  v-model="search"
                  type="search"
                  class="search-compact__input"
                  :placeholder="uiText('Rechercher par matricule, nom ou téléphone…')"
                  @keydown.enter.prevent="loadPatients"
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
              <span class="search-count">{{ searchLabel }}</span>
            </div>
          </div>

          <UiButton variant="primary" class="table-toolbar__new" @click="openModal">
            Nouveau
          </UiButton>
        </div>
      </div>
      </template>
    </section>

    <section
      v-if="!canSeeDoctorSharesTab || activeReceptionTab === 'enregistrement'"
      class="dashboard-body"
    >
      <div class="patients-table-card">
        <div class="table-wrap">
          <PatientsDataTable
            fill
            :patients="patients"
            :loading="loadingPatients || !!deletingPatientId"
            :show-receptionist="canFilterByReceptionist"
            @edit="openEditModal"
            @reconsult="openReconsultModal"
            @delete="deletePatient"
          />
        </div>
      </div>
    </section>

    <UiFormModal
      v-if="showDaySummary"
      title="Bilan du jour"
      :subtitle="
        selectedReceptionistName
          ? translateTemplate('Enregistrements de {name} aujourd’hui', { name: selectedReceptionistName })
          : uiText('Patients enregistrés aujourd’hui — sans encaissement à la réception')
      "
      :icon="CalendarDays"
      @close="showDaySummary = false"
    >
      <div class="day-summary">
        <div class="day-summary__grid">
          <div class="day-summary__item">
            <span>{{ uiText('Inscrits aujourd\'hui') }}</span>
            <strong>{{ stats.registeredToday }}</strong>
          </div>
          <div class="day-summary__item">
            <span>{{ uiText('Passages') }}</span>
            <strong>{{ stats.visitsToday }}</strong>
          </div>
          <div class="day-summary__item">
            <span>{{ uiText('Féminin') }}</span>
            <strong>{{ stats.femalePatients }}</strong>
          </div>
          <div class="day-summary__item">
            <span>{{ uiText('Masculin') }}</span>
            <strong>{{ stats.malePatients }}</strong>
          </div>
          <div class="day-summary__item">
            <span>{{ uiText('Patients externes') }}</span>
            <strong>{{ stats.externalPatientsToday ?? 0 }}</strong>
          </div>
        </div>
        <p class="day-summary__hint">
          {{ uiText('Le paiement des consultations et examens se fait chez le gestionnaire.') }}
        </p>
      </div>
      <template #footer>
        <UiButton variant="primary" @click="showDaySummary = false">Fermer</UiButton>
      </template>
    </UiFormModal>

    <UiFormModal
      v-if="showModal && (!canSeeDoctorSharesTab || activeReceptionTab === 'enregistrement')"
      title-id="modal-title"
      title="Nouveau patient"
      subtitle="Enregistrement — paiement chez le gestionnaire"
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

        <div class="form-grid-2">
          <UiSelect
            v-model="form.service"
            label="Service"
            required
            :key="`form-service-${localeCode}`"
          >
            <option value="" disabled>
              {{ services.length ? uiText('Sélectionner un service') : uiText('Aucun service disponible') }}
            </option>
            <option
              v-if="form.service && !services.some((s) => s.name === form.service)"
              :value="form.service"
            >
              {{ uiText(form.service) }}
            </option>
            <option v-for="service in services" :key="service.id" :value="service.name">
              {{ uiText(service.name) }}
            </option>
          </UiSelect>
          <UiSelect v-model="form.doctorId" label="Médecin" required>
            <option value="" disabled>{{
              formServiceDoctors.length ? uiText('Sélectionner') : uiText('Aucun médecin sur ce service')
            }}</option>
            <option v-for="doctor in formServiceDoctors" :key="doctor.id" :value="doctor.id">
              Dr {{ fullName(doctor.firstName, doctor.lastName) }}
            </option>
          </UiSelect>
        </div>

        <UiAlert v-if="!formServiceDoctors.length" type="warning" message="Aucun médecin lié à ce service. Affectez les médecins au service depuis la page Services." />
        <p v-if="!formServiceDoctors.length" class="doctors-empty-alert__links">
          <RouterLink to="/admin/services">{{ uiText('Services') }}</RouterLink>
          <span aria-hidden="true"> · </span>
          <RouterLink to="/admin/employes">{{ uiText('Employés') }}</RouterLink>
        </p>

        <div v-if="formDoctor && formConsultationPrice > 0" class="consultation-price-box">
          <div class="total-preview total-preview--compact">
            <span>{{ uiText('Prix consultation') }}</span>
            <strong>{{ formatFcfa(formConsultationPrice) }}</strong>
          </div>
          <p class="doctor-hint doctor-hint--compact doctor-hint--pay">
            {{ uiText('À payer chez le gestionnaire.') }}
          </p>
        </div>
        <p v-else-if="formDoctor" class="doctor-hint doctor-hint--compact doctor-hint--pay">
          {{ uiText('Tarif selon le gestionnaire — à régler chez le gestionnaire.') }}
        </p>
      </form>

      <template #footer>
        <UiButton type="button" variant="ghost" @click="closeModal">Annuler</UiButton>
        <UiButton type="button" variant="ghost" :icon="RotateCcw" @click="resetForm">Effacer</UiButton>
        <UiButton
          type="submit"
          form="reception-new-patient-form"
          variant="primary"
          :icon="UserPlus"
          :loading="submitting"
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

        <div class="form-grid-2">
          <UiSelect
            v-model="editForm.service"
            label="Service"
            required
            :key="`edit-service-${localeCode}`"
          >
            <option value="" disabled>
              {{ services.length ? uiText('Sélectionner un service') : uiText('Aucun service disponible') }}
            </option>
            <option
              v-if="editForm.service && !services.some((s) => s.name === editForm.service)"
              :value="editForm.service"
            >
              {{ uiText(editForm.service) }}
            </option>
            <option v-for="service in services" :key="service.id" :value="service.name">
              {{ uiText(service.name) }}
            </option>
          </UiSelect>
          <UiSelect v-model="editForm.doctorId" label="Médecin" required>
            <option value="" disabled>{{
              editServiceDoctors.length ? uiText('Sélectionner') : uiText('Aucun médecin sur ce service')
            }}</option>
            <option v-for="doctor in editServiceDoctors" :key="doctor.id" :value="doctor.id">
              Dr {{ fullName(doctor.firstName, doctor.lastName) }}
            </option>
          </UiSelect>
        </div>

        <UiSelect v-model="editForm.treatingDoctorId" label="Médecin traitant (dossier)">
          <option value="">{{ uiText('Aucun (optionnel)') }}</option>
          <option v-for="doctor in editServiceDoctors" :key="doctor.id" :value="doctor.id">
            Dr {{ fullName(doctor.firstName, doctor.lastName) }}
          </option>
        </UiSelect>

        <p
          v-if="selectedPatient.treatingDoctor"
          class="doctor-hint doctor-hint--compact"
        >
          {{ uiText('Médecin traitant actuel :') }}
          Dr {{ fullName(selectedPatient.treatingDoctor.firstName, selectedPatient.treatingDoctor.lastName) }}
        </p>

        <UiAlert v-if="!editServiceDoctors.length" type="warning" message="Aucun médecin lié à ce service. Affectez les médecins au service depuis la page Services." />
        <p v-if="!editServiceDoctors.length" class="doctors-empty-alert__links">
          <RouterLink to="/admin/services">{{ uiText('Services') }}</RouterLink>
          <span aria-hidden="true"> · </span>
          <RouterLink to="/admin/employes">{{ uiText('Employés') }}</RouterLink>
        </p>

        <div v-if="editDoctor && editConsultationPrice > 0" class="consultation-price-box">
          <div class="total-preview total-preview--compact">
            <span>{{ uiText('Prix consultation') }}</span>
            <strong>{{ formatFcfa(editConsultationPrice) }}</strong>
          </div>
          <p class="doctor-hint doctor-hint--compact doctor-hint--pay">
            {{ uiText('À payer chez le gestionnaire.') }}
          </p>
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
          :disabled="loadingEdit"
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
          {{
            uiText(
              'Nouvelle visite de consultation — examens, opérations et hospitalisation peuvent être prescrits à chaque passage. Si la validité du médecin est encore active, la consultation est gratuite. L\'historique précédent reste enregistré dans le dossier patient.',
            )
          }}
        </p>

        <p v-if="renewalPreview" class="renewal-banner" :class="{ 'renewal-banner--free': renewalPreview.withinValidity }">
          {{ renewalPreview.message }}
        </p>
        <p v-else-if="loadingRenewalPreview" class="doctor-hint">{{ uiText('Vérification de la validité…') }}</p>

        <section class="form-panel">
          <h3 class="form-panel__title">
            <Stethoscope :size="14" />
            {{ uiText('Consultation') }}
          </h3>
          <UiSelect v-model="reconsultForm.doctorId" label="Médecin" required>
            <option value="" disabled>{{ sortedDoctors.length ? uiText('Sélectionner un médecin') : uiText('Aucun médecin disponible') }}</option>
            <option v-for="doctor in sortedDoctors" :key="doctor.id" :value="doctor.id">
              Dr {{ fullName(doctor.firstName, doctor.lastName) }}
            </option>
          </UiSelect>

          <div
            v-if="reconsultForm.doctorId && !loadingRenewalPreview && reconsultConsultationPrice > 0"
            class="consultation-price-box"
          >
            <div class="total-preview total-preview--compact">
              <span>{{ uiText('Prix consultation') }}</span>
              <strong>{{ formatFcfa(reconsultConsultationPrice) }}</strong>
            </div>
            <p class="doctor-hint doctor-hint--compact doctor-hint--pay">
              {{ uiText('À payer chez le gestionnaire.') }}
            </p>
          </div>
          <p
            v-else-if="reconsultForm.doctorId && renewalPreview?.withinValidity"
            class="doctor-hint doctor-hint--compact"
          >
            {{ uiText('Consultation gratuite (validité en cours).') }}
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

.reception-page-tabs {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin: 0 0 0.85rem;
  padding: 0.25rem;
  background: #f1f5f9;
  border: 1px solid var(--border);
  border-radius: 10px;
  width: fit-content;
}

.reception-page-tabs__btn {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.45rem 0.85rem;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text-muted);
  font-family: var(--font);
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.reception-page-tabs__btn--active {
  background: #fff;
  color: var(--primary-700, #1d4ed8);
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08);
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

.dash-stat--direct {
  align-items: center;
  justify-content: space-between;
  padding: 0.55rem 0.7rem;
}

.dash-stat--direct .dash-stat__body {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 0;
}

.dash-stat--direct .dash-stat__value {
  font-size: 1.2rem;
  line-height: 1.1;
}

.dash-stat--direct .dash-stat__hint {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 0.65rem 0.85rem;
  margin-bottom: 0;
}

.table-toolbar__title {
  min-width: 0;
  flex: 0 1 13.5rem;
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
  margin-inline-start: auto;
}

.table-toolbar__filters {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
  flex: 1 1 auto;
}

.date-range-filter {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 0.4rem;
  flex-shrink: 0;
}

.date-filter {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 0.35rem;
  flex-shrink: 0;
}

.date-filter__label {
  font-size: 0.625rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
  white-space: nowrap;
}

.date-filter__input {
  height: 2.25rem;
  padding: 0 0.55rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-card);
  color: var(--text);
  font: inherit;
  font-size: 0.8125rem;
  min-width: 8.25rem;
}

.date-filter__input[type='date'] {
  width: 8.75rem;
}

.date-filter select.date-filter__input {
  min-width: 11.5rem;
  width: auto;
  max-width: 14rem;
}

.date-filter__today {
  padding: 0;
  border: none;
  background: none;
  color: var(--primary-600, #0d9488);
  font-size: 0.6875rem;
  font-weight: 600;
  cursor: pointer;
  text-align: start;
  white-space: nowrap;
}

.date-filter__today:hover {
  text-decoration: underline;
}

.table-toolbar__search {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 0.45rem;
  flex: 1 1 12rem;
  min-width: 10rem;
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

.doctor-hint--pay {
  color: #b45309;
  font-weight: 700;
}

.consultation-price-box {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin-top: 0.15rem;
}

.doctors-empty-alert__links {
  margin: -0.25rem 0 0;
  font-size: 0.8125rem;
}

.doctors-empty-alert__links a {
  color: var(--primary-700, #4b5d2a);
  font-weight: 600;
}

.day-summary {
  display: grid;
  gap: 0.85rem;
}

.day-summary__grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.65rem;
}

.day-summary__item {
  display: grid;
  gap: 0.2rem;
  padding: 0.7rem 0.8rem;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: #f8fafc;
}

.day-summary__item span {
  font-size: 0.75rem;
  color: var(--text-muted);
  font-weight: 600;
}

.day-summary__item strong {
  font-size: 1.25rem;
  font-variant-numeric: tabular-nums;
}

.day-summary__hint {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--text-muted);
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
    flex-wrap: wrap;
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
