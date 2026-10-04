<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  FolderOpen,
  Search,
  Upload,
  Eye,
  Trash2,
  RefreshCw,
  UserRound,
  Plus,
  History,
  Paperclip,
  Banknote,
  Stethoscope,
  Printer,
  FileDown,
  Pencil,
} from '@lucide/vue'
import api from '@/api/client'
import { confirmAppModal, showApiErrorModal } from '@/lib/api-modal-helper'
import { useAuthStore } from '@/stores/auth'
import { fullName, canWriteDossierDocuments, isDirectionOrGestionnaire } from '@/lib/roles'
import { matchesPatientSearch } from '@/lib/patient-search'
import { normalizePatientAgeUnit, type PatientAgeUnit } from '@/lib/patient-age'
import {
  PATIENT_DOCUMENT_KIND_LABELS,
  PATIENT_DOCUMENT_KINDS,
  formatFileSize,
  type PatientDocumentKind,
} from '@/lib/patient-documents'
import { printPatientDossier } from '@/lib/patient-dossier-print'
import PatientMedicalHistory, {
  type MedicalHistoryEntry,
} from '@/components/dossier/PatientMedicalHistory.vue'
import PatientPaymentHistory from '@/components/dossier/PatientPaymentHistory.vue'
import MedecinPrescriptionModal, {
  type PrescriptionVisit,
} from '@/components/MedecinPrescriptionModal.vue'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import UiInput from '@/components/ui/UiInput.vue'
import { useAppI18n } from '@/i18n/useAppI18n'
import { translateTemplate } from '@/lib/dashboard-i18n'

type PatientSummary = {
  id: string
  code: string
  firstName: string
  lastName: string
  age?: number | null
  ageUnit?: PatientAgeUnit | null
  phone?: string | null
  gender?: string | null
  address?: string | null
  category: string
  ongName?: string | null
  recommendedByName?: string | null
  service?: string | null
  createdAt: string
  treatingDoctor?: { firstName: string; lastName: string } | null
  createdBy?: { firstName: string; lastName: string } | null
}

type PatientDocument = {
  id: string
  kind: PatientDocumentKind
  title: string
  documentDate: string
  fileName: string
  mimeType: string
  fileSize: number
  createdAt: string
  uploadedBy: { firstName: string; lastName: string }
}

type MedecinPatientRow = {
  patient: PatientSummary
  lastVisitAt: string
  labResultsCount: number
  hasComment: boolean
}

type AdminDoctorAct = {
  id: string
  visitId: string
  patient: { id: string; code: string; firstName: string; lastName: string }
  doctorId: string
  doctorName: string
  actedAt: string
  action: 'consultation' | 'operation'
  detail: string | null
}

type DossierResponse = {
  patient: PatientSummary
  dossier: { id: string; createdAt: string }
  documents: PatientDocument[]
  medicalHistory: MedicalHistoryEntry[]
  countsByKind: Partial<Record<PatientDocumentKind, number>>
  dataProtection?: {
    hasPaidBilling: boolean
    canDeleteDocuments: boolean
  }
  reconsult?: {
    canReconsult: boolean
    activeVisitId: string | null
  } | null
}

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const { uiText, dateText, localeCode } = useAppI18n()

const canWriteDocuments = computed(() =>
  auth.user ? canWriteDossierDocuments(auth.user.role) : false,
)

const canDeleteDocuments = computed(
  () => dossier.value?.dataProtection?.canDeleteDocuments !== false,
)

const isMedecin = computed(() => auth.user?.role === 'MEDECIN')
const isAdmin = computed(() => auth.user?.role === 'ADMIN')
const isManagementDossier = computed(() =>
  auth.user ? isDirectionOrGestionnaire(auth.user.role) : false,
)
const showPatientSidebar = computed(() => isMedecin.value || isAdmin.value)

const searchQuery = ref('')
const searchResults = ref<PatientSummary[]>([])
const searching = ref(false)
const selectedPatientId = ref<string | null>(null)

const dossier = ref<DossierResponse | null>(null)
const loadingDossier = ref(false)
const dossierError = ref('')
const activeTab = ref<'history' | 'payments' | 'files'>('history')
const activeKind = ref<PatientDocumentKind | 'ALL'>('ALL')

const medecinPatients = ref<MedecinPatientRow[]>([])
const adminActs = ref<AdminDoctorAct[]>([])
const adminDoctorId = ref('')
const selectedActId = ref<string | null>(null)
const loadingMedecinPatients = ref(false)
const loadingAdminActs = ref(false)
const sidebarQuery = ref('')

const showUpload = ref(false)
const uploading = ref(false)
const uploadError = ref('')
const uploadForm = ref({
  kind: 'EXAMEN' as PatientDocumentKind,
  title: '',
  documentDate: new Date().toISOString().slice(0, 10),
  file: null as File | null,
})
const reconsulting = ref(false)
const deletingPatient = ref(false)
const preserveTabOnReload = ref(false)
const prescriptionVisit = ref<PrescriptionVisit | null>(null)
const loadingEditDossier = ref(false)

const canReconsult = computed(
  () => isMedecin.value && !!dossier.value?.reconsult?.canReconsult,
)

const editVisitId = computed(
  () =>
    dossier.value?.reconsult?.activeVisitId ??
    dossier.value?.medicalHistory[0]?.visitId ??
    null,
)

const canEditDossier = computed(() => isMedecin.value && !!editVisitId.value)

const filteredMedecinPatients = computed(() => {
  const q = sidebarQuery.value.trim()
  if (!q) return medecinPatients.value
  return medecinPatients.value.filter((row) =>
    matchesPatientSearch(
      {
        code: row.patient.code,
        firstName: row.patient.firstName,
        lastName: row.patient.lastName,
        phone: row.patient.phone,
      },
      q,
    ),
  )
})

const adminDoctors = computed(() => {
  const names = new Map<string, string>()
  for (const act of adminActs.value) names.set(act.doctorId, act.doctorName)
  return [...names.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
})

const filteredAdminActs = computed(() => {
  const q = sidebarQuery.value.trim().toLowerCase()
  return adminActs.value.filter((act) => {
    if (adminDoctorId.value && act.doctorId !== adminDoctorId.value) return false
    if (!q) return true
    return (
      matchesPatientSearch(
        {
          code: act.patient.code,
          firstName: act.patient.firstName,
          lastName: act.patient.lastName,
        },
        q,
      ) || act.doctorName.toLowerCase().includes(q)
    )
  })
})

const adminActGroups = computed(() => {
  const groups = new Map<string, { doctorId: string; doctorName: string; acts: AdminDoctorAct[] }>()
  for (const act of filteredAdminActs.value) {
    const group = groups.get(act.doctorId)
    if (group) group.acts.push(act)
    else groups.set(act.doctorId, { doctorId: act.doctorId, doctorName: act.doctorName, acts: [act] })
  }
  return [...groups.values()]
})

const loadingSidebarPatients = computed(() =>
  isMedecin.value ? loadingMedecinPatients.value : loadingAdminActs.value,
)

const historyCount = computed(() => dossier.value?.medicalHistory.length ?? 0)
const filesCount = computed(() => dossier.value?.documents.length ?? 0)

const filteredDocuments = computed(() => {
  if (!dossier.value) return []
  if (activeKind.value === 'ALL') return dossier.value.documents
  return dossier.value.documents.filter((doc) => doc.kind === activeKind.value)
})

const kindFilters = computed(() => {
  void localeCode.value
  const counts = dossier.value?.countsByKind ?? {}
  const total = filesCount.value
  return [
    { value: 'ALL' as const, label: uiText('Tous'), count: total },
    ...PATIENT_DOCUMENT_KINDS.map((kind) => ({
      value: kind,
      label: uiText(PATIENT_DOCUMENT_KIND_LABELS[kind]),
      count: counts[kind] ?? 0,
    })),
  ]
})

function formatValidatedMeta(iso: string, formCount: number, hasComment: boolean) {
  void localeCode.value
  const parts = [dateText(iso)]
  if (formCount > 0) {
    parts.push(translateTemplate('{n} résultat(s) labo', { n: formCount }))
  }
  if (hasComment) parts.push(uiText('Notes cliniques'))
  return parts.join(' · ')
}

function patientAgeLabel(age: number, unit: PatientAgeUnit | null | undefined) {
  void localeCode.value
  const normalized = normalizePatientAgeUnit(unit)
  if (normalized === 'MONTHS') {
    return translateTemplate('Âge : {age} mois', { age })
  }
  if (normalized === 'DAYS') {
    return age > 1
      ? translateTemplate('Âge : {age} jours', { age })
      : translateTemplate('Âge : {age} jour', { age })
  }
  return age > 1
    ? translateTemplate('Âge : {age} ans', { age })
    : translateTemplate('Âge : {age} an', { age })
}

function patientCardDescription(patient: PatientSummary) {
  void localeCode.value
  const parts = [patient.code]
  if (patient.age != null) parts.push(patientAgeLabel(patient.age, patient.ageUnit))
  if (patient.gender === 'F') parts.push(uiText('Féminin'))
  else if (patient.gender === 'M') parts.push(uiText('Masculin'))
  else if (patient.gender) parts.push(patient.gender)
  if (patient.phone) parts.push(patient.phone)
  return parts.join(' · ')
}

let searchTimer: ReturnType<typeof setTimeout> | undefined

async function searchPatients() {
  const q = searchQuery.value.trim()
  if (q.length < 2) {
    searchResults.value = []
    return
  }
  searching.value = true
  try {
    const { data } = await api.get<PatientSummary[]>('/patients', { params: { q } })
    searchResults.value = data
  } finally {
    searching.value = false
  }
}

watch(searchQuery, () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(searchPatients, 300)
})

async function loadMedecinPatients() {
  if (!isMedecin.value) return
  loadingMedecinPatients.value = true
  try {
    const { data } = await api.get<MedecinPatientRow[]>('/patient-dossiers/medecin/patients')
    medecinPatients.value = data
  } catch {
    medecinPatients.value = []
  } finally {
    loadingMedecinPatients.value = false
  }
}

async function loadAdminActivity() {
  if (!isAdmin.value) return
  loadingAdminActs.value = true
  try {
    const { data } = await api.get<AdminDoctorAct[]>('/patient-dossiers/admin/activity')
    adminActs.value = data
  } catch {
    adminActs.value = []
  } finally {
    loadingAdminActs.value = false
  }
}

function selectAdminAct(act: AdminDoctorAct) {
  selectedActId.value = act.id
  selectPatient(act.patient)
}

async function loadDossier(patientId: string) {
  loadingDossier.value = true
  dossierError.value = ''
  try {
    const params = activeTab.value === 'files' && activeKind.value !== 'ALL' ? { kind: activeKind.value } : undefined
    const { data } = await api.get<DossierResponse>(`/patient-dossiers/${patientId}`, { params })
    dossier.value = data
    selectedPatientId.value = patientId
    if (!preserveTabOnReload.value) {
      activeTab.value = data.medicalHistory.length ? 'history' : 'files'
    }
    preserveTabOnReload.value = false
    router.replace({ query: { patient: patientId } })
  } catch {
    dossier.value = null
    dossierError.value = uiText('Impossible de charger le dossier patient.')
  } finally {
    loadingDossier.value = false
  }
}

function actActionLabel(act: AdminDoctorAct) {
  void localeCode.value
  return act.action === 'operation' ? uiText('Opération') : uiText('Consultation')
}

function actShortDate(iso: string) {
  return dateText(iso, { day: '2-digit', month: '2-digit', year: '2-digit' })
}

function selectPatient(patient: Pick<PatientSummary, 'id' | 'code' | 'firstName' | 'lastName'>) {
  searchQuery.value = `${patient.code} — ${fullName(patient.firstName, patient.lastName)}`
  searchResults.value = []
  activeKind.value = 'ALL'
  preserveTabOnReload.value = false
  loadDossier(patient.id)
}

function exportDossier(autoPrint: boolean) {
  if (!dossier.value) return
  printPatientDossier({
    patient: dossier.value.patient,
    history: dossier.value.medicalHistory,
    doctorName: auth.user
      ? `Dr ${fullName(auth.user.firstName, auth.user.lastName)}`
      : null,
    autoPrint,
  })
}

async function startReconsult() {
  if (!selectedPatientId.value || !canReconsult.value) return
  reconsulting.value = true
  dossierError.value = ''
  try {
    const activeId = dossier.value?.reconsult?.activeVisitId
    if (activeId) {
      await router.push({ name: 'consultation', query: { visit: activeId } })
      return
    }
    const { data } = await api.post<{
      visitId: string
      requiresPayment?: boolean
      amountFcfa?: number
      message?: string
    }>(`/patient-dossiers/${selectedPatientId.value}/reconsult`)
    if (data.requiresPayment && data.amountFcfa) {
      dossierError.value = translateTemplate(
        'Reconsultation ouverte — paiement de {amount} FCFA à régulariser à la réception.',
        { amount: data.amountFcfa.toLocaleString('fr-FR') },
      )
    }
    await router.push({ name: 'consultation', query: { visit: data.visitId } })
  } catch (error: unknown) {
    const err = error as { response?: { data?: { error?: string } } }
    dossierError.value =
      err.response?.data?.error || uiText('Impossible d’ouvrir la reconsultation.')
  } finally {
    reconsulting.value = false
  }
}

async function openEditDossier(visitId?: string) {
  const id = visitId || editVisitId.value
  if (!id || !canEditDossier.value || loadingEditDossier.value) return
  loadingEditDossier.value = true
  dossierError.value = ''
  try {
    const { data } = await api.get<PrescriptionVisit>(`/visits/${id}`)
    prescriptionVisit.value = data
  } catch (error: unknown) {
    await showApiErrorModal(error, uiText('Impossible d’ouvrir le dossier à modifier.'))
  } finally {
    loadingEditDossier.value = false
  }
}

function closeEditDossier() {
  prescriptionVisit.value = null
}

async function onDossierPrescriptionSaved() {
  closeEditDossier()
  if (selectedPatientId.value) {
    preserveTabOnReload.value = true
    await loadDossier(selectedPatientId.value)
  }
}

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  uploadForm.value.file = input.files?.[0] ?? null
}

async function submitUpload() {
  if (!selectedPatientId.value || !uploadForm.value.file) {
    uploadError.value = uiText('Veuillez sélectionner un fichier.')
    return
  }

  uploading.value = true
  uploadError.value = ''

  const formData = new FormData()
  formData.append('file', uploadForm.value.file)
  formData.append('kind', uploadForm.value.kind)
  formData.append('title', uploadForm.value.title.trim() || uploadForm.value.file.name)
  formData.append('documentDate', uploadForm.value.documentDate)

  try {
    await api.post(`/patient-dossiers/${selectedPatientId.value}/documents`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    showUpload.value = false
    uploadForm.value = {
      kind: 'EXAMEN',
      title: '',
      documentDate: new Date().toISOString().slice(0, 10),
      file: null,
    }
    activeTab.value = 'files'
    await loadDossier(selectedPatientId.value)
  } catch {
    uploadError.value = uiText(
      "Impossible d'ajouter le document. Vérifiez le fichier (PDF, image, max 15 Mo).",
    )
  } finally {
    uploading.value = false
  }
}

function openDocument(documentId: string) {
  if (!selectedPatientId.value) return
  window.open(`/api/patient-dossiers/${selectedPatientId.value}/documents/${documentId}/file`, '_blank')
}

async function deletePatientDossier() {
  if (!isManagementDossier.value || !dossier.value) return
  const patient = dossier.value.patient
  const patientName = fullName(patient.firstName, patient.lastName)
  const confirmed = await confirmAppModal({
    type: 'DELETE',
    title: uiText('Supprimer le patient (admin)'),
    message: translateTemplate(
      'Supprimer le dossier {code} — {name} même s’il a déjà été consulté ? Visites, consultations, factures et documents liés seront aussi supprimés. Cette action est irréversible.',
      { code: patient.code, name: patientName },
    ),
    confirmLabel: uiText('Supprimer'),
  })
  if (!confirmed) return

  deletingPatient.value = true
  dossierError.value = ''
  try {
    await api.delete(`/patients/${patient.id}`)
    dossier.value = null
    selectedPatientId.value = null
    searchQuery.value = ''
    searchResults.value = []
    await router.replace({ query: {} })
    await Promise.all([loadMedecinPatients(), loadAdminActivity()])
  } catch (error: unknown) {
    await showApiErrorModal(error, 'Impossible de supprimer ce patient.')
  } finally {
    deletingPatient.value = false
  }
}

async function deleteDocument(doc: PatientDocument) {
  if (!selectedPatientId.value || !canDeleteDocuments.value) return
  const confirmed = await confirmAppModal({
    type: 'DELETE',
    title: uiText('Supprimer le document'),
    message: translateTemplate('Supprimer « {title} » du dossier ?', { title: doc.title }),
    confirmLabel: uiText('Supprimer'),
  })
  if (!confirmed) return

  try {
    await api.delete(`/patient-dossiers/${selectedPatientId.value}/documents/${doc.id}`)
    await loadDossier(selectedPatientId.value)
  } catch {
    dossierError.value = uiText(
      'Impossible de supprimer ce document : le patient a déjà effectué un paiement.',
    )
  }
}

watch(activeKind, () => {
  if (selectedPatientId.value && activeTab.value === 'files') {
    preserveTabOnReload.value = true
    loadDossier(selectedPatientId.value)
  }
})

onMounted(async () => {
  await Promise.all([loadMedecinPatients(), loadAdminActivity()])
  const patientId = route.query.patient as string | undefined
  if (patientId) {
    await loadDossier(patientId)
    if (dossier.value) {
      searchQuery.value = `${dossier.value.patient.code} — ${fullName(dossier.value.patient.firstName, dossier.value.patient.lastName)}`
    }
  } else if (isMedecin.value && medecinPatients.value[0]) {
    selectPatient(medecinPatients.value[0].patient)
  }
})
</script>

<template>
  <div class="dossier-page">
    <UiPageHeader
      title="Dossier patient"
      :subtitle="
        isAdmin
          ? uiText('Patients, date et action (consultation ou opération)')
          : uiText('Parcours, résultats, opérations et fichiers')
      "
      :icon="FolderOpen"
    />

    <div class="dossier-layout" :class="{ 'dossier-layout--with-sidebar': showPatientSidebar }">
      <aside v-if="isMedecin" class="dossier-sidebar">
        <UiCard
          :title="uiText('Mes patients')"
          :description="uiText('Patients déjà consultés')"
          :icon="UserRound"
          icon-variant="teal"
        >
          <label class="sidebar-search">
            <Search :size="14" />
            <input v-model="sidebarQuery" type="search" :placeholder="uiText('Filtrer…')" />
          </label>

          <p v-if="loadingMedecinPatients" class="hint">{{ uiText('Chargement…') }}</p>
          <p v-else-if="!filteredMedecinPatients.length" class="hint">
            {{ uiText('Aucun patient suivi pour le moment.') }}
          </p>

          <ul v-else class="patient-list">
            <li v-for="row in filteredMedecinPatients" :key="row.patient.id">
              <button
                type="button"
                class="patient-list__item"
                :class="{ 'patient-list__item--active': selectedPatientId === row.patient.id }"
                @click="selectPatient(row.patient)"
              >
                <strong>{{ row.patient.code }}</strong>
                <span>{{ fullName(row.patient.firstName, row.patient.lastName) }}</span>
                <span class="patient-list__meta">
                  {{ formatValidatedMeta(row.lastVisitAt, row.labResultsCount, row.hasComment) }}
                </span>
              </button>
            </li>
          </ul>
        </UiCard>
      </aside>

      <aside v-else-if="isAdmin" class="dossier-sidebar">
        <UiCard title="Activité des médecins" :icon="UserRound" icon-variant="teal" direct>
          <UiSelect v-model="adminDoctorId" label="Médecin">
            <option value="">{{ uiText('Tous les médecins') }}</option>
            <option v-for="doctor in adminDoctors" :key="doctor.id" :value="doctor.id">
              {{ doctor.name }}
            </option>
          </UiSelect>
          <label class="sidebar-search">
            <Search :size="14" />
            <input v-model="sidebarQuery" type="search" :placeholder="uiText('Filtrer…')" />
          </label>

          <p v-if="loadingAdminActs" class="hint">{{ uiText('Chargement…') }}</p>
          <p v-else-if="!filteredAdminActs.length" class="hint">
            {{ uiText('Aucune activité pour ce médecin.') }}
          </p>

          <div v-else class="act-groups">
            <section v-for="group in adminActGroups" :key="group.doctorId">
              <p v-if="!adminDoctorId" class="act-group">{{ group.doctorName }}</p>
              <ul class="patient-list">
                <li v-for="act in group.acts" :key="act.id">
                  <button
                    type="button"
                    class="act-row"
                    :class="{ 'act-row--active': selectedActId === act.id }"
                    :title="`${act.patient.code} — ${fullName(act.patient.firstName, act.patient.lastName)}`"
                    @click="selectAdminAct(act)"
                  >
                    <span class="act-row__name">{{ fullName(act.patient.firstName, act.patient.lastName) }}</span>
                    <span class="act-row__date">{{ actShortDate(act.actedAt) }}</span>
                    <span
                      class="act-badge"
                      :class="act.action === 'operation' ? 'act-badge--operation' : 'act-badge--consultation'"
                    >
                      {{ actActionLabel(act) }}
                    </span>
                  </button>
                </li>
              </ul>
            </section>
          </div>
        </UiCard>
      </aside>

      <div class="dossier-main">
        <UiCard v-if="!isMedecin" class="search-card" direct>
          <div class="search-block">
            <label class="search-field">
              <Search :size="16" />
              <input
                v-model="searchQuery"
                type="search"
                :placeholder="uiText('Nom, code ou téléphone')"
                autocomplete="off"
              />
            </label>

            <ul v-if="searchResults.length" class="search-results">
              <li
                v-for="patient in searchResults.filter((p) =>
                  matchesPatientSearch(
                    { code: p.code, firstName: p.firstName, lastName: p.lastName, phone: p.phone },
                    searchQuery.split('—')[0]?.trim() ?? searchQuery,
                  ),
                )"
                :key="patient.id"
              >
                <button type="button" class="search-result" @click="selectPatient(patient)">
                  <strong>{{ patient.code }}</strong>
                  <span>{{ fullName(patient.firstName, patient.lastName) }}</span>
                </button>
              </li>
            </ul>
          </div>
        </UiCard>

        <p v-if="dossierError" class="dossier-error">{{ dossierError }}</p>

        <template v-if="dossier">
          <UiCard class="patient-card" :icon="UserRound" icon-variant="teal" direct>
            <template #actions>
              <UiButton
                v-if="canEditDossier"
                variant="secondary"
                size="sm"
                :icon="Pencil"
                :loading="loadingEditDossier"
                @click="openEditDossier()"
              >
                {{ uiText('Modifier') }}
              </UiButton>
              <UiButton
                v-if="canReconsult"
                variant="primary"
                size="sm"
                :icon="Stethoscope"
                :loading="reconsulting"
                @click="startReconsult"
              >
                {{
                  dossier.reconsult?.activeVisitId
                    ? uiText('Continuer')
                    : uiText('Reconsulter')
                }}
              </UiButton>
              <UiButton
                variant="secondary"
                size="sm"
                :icon="Printer"
                ui-action="export.print"
                :disabled="!dossier.medicalHistory.length"
                @click="exportDossier(true)"
              >
                {{ uiText('Imprimer') }}
              </UiButton>
              <UiButton
                variant="ghost"
                size="sm"
                :icon="FileDown"
                ui-action="export.pdf"
                :title="uiText('Exporter PDF')"
                :disabled="!dossier.medicalHistory.length"
                @click="exportDossier(false)"
              />
              <UiButton
                v-if="canWriteDocuments"
                variant="ghost"
                size="sm"
                :icon="Plus"
                ui-action="dossier.attach"
                :title="uiText('Joindre un fichier')"
                @click="showUpload = true"
              />
              <UiButton
                v-if="isManagementDossier"
                variant="danger"
                size="sm"
                :icon="Trash2"
                :title="uiText('Supprimer le patient')"
                :disabled="deletingPatient"
                :loading="deletingPatient"
                @click="deletePatientDossier"
              />
              <UiButton
                variant="ghost"
                size="sm"
                :icon="RefreshCw"
                :title="uiText('Actualiser')"
                :disabled="loadingDossier"
                @click="preserveTabOnReload = true; loadDossier(selectedPatientId!)"
              />
            </template>

            <p class="patient-identity__name">{{ fullName(dossier.patient.firstName, dossier.patient.lastName) }}</p>
            <p class="patient-identity__meta">{{ patientCardDescription(dossier.patient) }}</p>
          </UiCard>

          <div class="tab-bar">
            <button
              type="button"
              class="tab-btn"
              :class="{ 'tab-btn--active': activeTab === 'history' }"
              @click="activeTab = 'history'"
            >
              <History :size="16" />
              {{ uiText('Parcours médical') }}
              <span class="tab-btn__count">{{ historyCount }}</span>
            </button>
            <button
              type="button"
              class="tab-btn"
              :class="{ 'tab-btn--active': activeTab === 'payments' }"
              @click="activeTab = 'payments'"
            >
              <Banknote :size="16" />
              {{ uiText('Paiements') }}
            </button>
            <button
              type="button"
              class="tab-btn"
              :class="{ 'tab-btn--active': activeTab === 'files' }"
              @click="activeTab = 'files'"
            >
              <Paperclip :size="16" />
              {{ uiText('Fichiers attachés') }}
              <span class="tab-btn__count">{{ filesCount }}</span>
            </button>
          </div>

          <UiCard v-if="activeTab === 'history'" title="Historique médical" :icon="History" icon-variant="violet">
            <PatientMedicalHistory
              :entries="dossier.medicalHistory"
              :loading="loadingDossier"
              :show-open-lab-link="isMedecin"
              :patient="dossier.patient"
              expand-first
              :continue-visit-id="dossier.reconsult?.activeVisitId"
              :continue-loading="reconsulting || loadingEditDossier"
              :empty-message="
                isMedecin
                  ? uiText('Aucune consultation, ordonnance ou examen enregistré pour ce patient.')
                  : undefined
              "
              @continue-consultation="openEditDossier"
            />
          </UiCard>

          <UiCard v-else-if="activeTab === 'payments'" title="Historique des paiements" :icon="Banknote" icon-variant="green">
            <PatientPaymentHistory :patient-id="selectedPatientId" />
          </UiCard>

          <UiCard
            v-else
            title="Fichiers attachés"
            description="Radios, échos, PDF et autres documents importés"
            :icon="FolderOpen"
            icon-variant="blue"
          >
            <div class="kind-filters">
              <button
                v-for="filter in kindFilters"
                :key="filter.value"
                type="button"
                class="kind-chip"
                :class="{ 'kind-chip--active': activeKind === filter.value }"
                @click="activeKind = filter.value"
              >
                {{ filter.label }}
                <span class="kind-chip__count">{{ filter.count }}</span>
              </button>
            </div>

            <p v-if="loadingDossier" class="empty">{{ uiText('Chargement…') }}</p>
            <p v-else-if="!filteredDocuments.length" class="empty">
              {{
                uiText(
                  "Aucun fichier importé. Les résultats de laboratoire apparaissent dans l'onglet Parcours médical.",
                )
              }}
            </p>

            <p v-if="filteredDocuments.length && !canDeleteDocuments" class="hint hint--warning">
              {{
                uiText(
                  'Les documents ne peuvent pas être supprimés : ce patient a déjà effectué un paiement.',
                )
              }}
            </p>

            <ul v-if="filteredDocuments.length" class="doc-list">
              <li v-for="doc in filteredDocuments" :key="doc.id" class="doc-item">
                <div class="doc-item__main">
                  <span class="doc-item__kind">{{ uiText(PATIENT_DOCUMENT_KIND_LABELS[doc.kind]) }}</span>
                  <strong class="doc-item__title">{{ doc.title }}</strong>
                  <span class="doc-item__meta">
                    {{ dateText(doc.documentDate) }} · {{ formatFileSize(doc.fileSize) }}
                  </span>
                </div>
                <div class="doc-item__actions">
                  <UiButton variant="ghost" size="sm" :icon="Eye" @click="openDocument(doc.id)">
                    {{ uiText('Voir') }}
                  </UiButton>
                  <UiButton
                    v-if="canWriteDocuments && canDeleteDocuments"
                    variant="ghost"
                    size="sm"
                    :icon="Trash2"
                    @click="deleteDocument(doc)"
                  >
                    {{ uiText('Supprimer') }}
                  </UiButton>
                </div>
              </li>
            </ul>
          </UiCard>
        </template>

        <UiCard
          v-else-if="showPatientSidebar && !loadingSidebarPatients"
          title="Sélectionnez un patient"
          :icon="UserRound"
        >
          <p class="hint">{{ uiText('Choisissez un patient dans la liste.') }}</p>
        </UiCard>
      </div>
    </div>

    <div v-if="showUpload" class="modal-backdrop" @click.self="showUpload = false">
      <div class="modal">
        <h3><Upload :size="18" /> {{ uiText('Joindre un fichier') }}</h3>
        <UiSelect v-model="uploadForm.kind" label="Type">
          <option v-for="kind in PATIENT_DOCUMENT_KINDS" :key="kind" :value="kind">
            {{ uiText(PATIENT_DOCUMENT_KIND_LABELS[kind]) }}
          </option>
        </UiSelect>
        <UiInput
          v-model="uploadForm.title"
          label="Titre"
          placeholder="Ex. Radio thorax"
        />
        <UiInput v-model="uploadForm.documentDate" label="Date" type="date" required />
        <label class="file-field">
          <span class="file-field__label">{{ uiText('Fichier (PDF, image — max 15 Mo)') }}</span>
          <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx" @change="onFileChange" />
        </label>
        <p v-if="uploadError" class="error">{{ uploadError }}</p>
        <div class="modal__actions">
          <UiButton variant="ghost" @click="showUpload = false">{{ uiText('Annuler') }}</UiButton>
          <UiButton variant="primary" :icon="Upload" :disabled="uploading" @click="submitUpload">
            {{ uploading ? uiText('Envoi…') : uiText('Enregistrer') }}
          </UiButton>
        </div>
      </div>
    </div>

    <MedecinPrescriptionModal
      :key="`${prescriptionVisit?.id ?? 'closed'}-notes`"
      :visit="prescriptionVisit"
      mode="edit"
      start-tab="notes"
      @close="closeEditDossier"
      @saved="onDossierPrescriptionSaved"
    />
  </div>
</template>

<style scoped>
.dossier-layout {
  display: block;
}

.dossier-layout--with-sidebar {
  display: grid;
  grid-template-columns: minmax(280px, 340px) minmax(0, 1fr);
  gap: 1rem;
  align-items: start;
}

.dossier-sidebar {
  position: sticky;
  top: 1rem;
}

.sidebar-search {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  margin-bottom: 0.65rem;
  padding: 0.45rem 0.65rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-muted);
}

.sidebar-search input {
  flex: 1;
  border: 0;
  outline: none;
  font-size: 0.8125rem;
  background: transparent;
}

.patient-list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 28rem;
  overflow: auto;
}

.patient-list__item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.1rem;
  width: 100%;
  padding: 0.65rem 0.75rem;
  border: 0;
  border-bottom: 1px solid var(--border);
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.patient-list__item:hover,
.patient-list__item--active {
  background: var(--primary-50);
}

.patient-list__item strong {
  font-family: monospace;
  font-size: 0.75rem;
  color: var(--primary-700);
}

.patient-list__meta {
  font-size: 0.6875rem;
  color: var(--text-muted);
}

.act-groups {
  max-height: 32rem;
  overflow: auto;
}

.act-group {
  margin: 0.65rem 0 0.15rem;
  padding: 0 0.15rem;
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--primary-800, #115e59);
}

.act-groups .patient-list {
  max-height: none;
  overflow: visible;
}

.act-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 0.35rem;
  align-items: center;
  width: 100%;
  padding: 0.4rem 0.35rem;
  border: 0;
  border-bottom: 1px solid var(--border);
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.act-row:hover,
.act-row--active {
  background: var(--primary-50);
}

.act-row__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.8125rem;
  font-weight: 600;
}

.act-row__date {
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
  color: var(--text-muted);
  white-space: nowrap;
}

.act-badge {
  display: inline-flex;
  padding: 0.08rem 0.4rem;
  border-radius: 999px;
  font-size: 0.6875rem;
  font-weight: 700;
  line-height: 1.3;
  white-space: nowrap;
}

.act-badge--consultation {
  background: #ecfdf5;
  color: #047857;
}

.act-badge--operation {
  background: #fff7ed;
  color: #c2410c;
}

.tab-bar {
  display: flex;
  gap: 0.5rem;
  margin: 1rem 0 0.75rem;
}

.tab-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.55rem 0.9rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: #fff;
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-muted);
  cursor: pointer;
}

.tab-btn--active {
  border-color: var(--primary-400);
  background: var(--primary-50);
  color: var(--primary-800);
}

.tab-btn__count {
  min-width: 1.2rem;
  padding: 0.05rem 0.35rem;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.06);
  font-size: 0.6875rem;
}

.search-block { position: relative; }

.search-field {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.55rem 0.75rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: #fff;
  color: var(--text-muted);
}

.search-field input {
  flex: 1;
  border: 0;
  outline: none;
  font-size: 0.875rem;
  color: var(--text);
  background: transparent;
}

.search-results {
  list-style: none;
  margin: 0.5rem 0 0;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: #fff;
}

.search-result {
  display: flex;
  gap: 0.5rem;
  width: 100%;
  padding: 0.65rem 0.85rem;
  border: 0;
  border-bottom: 1px solid var(--border);
  background: transparent;
  cursor: pointer;
  text-align: left;
}

.search-result:hover { background: var(--primary-50); }

.hint, .empty {
  margin: 0.75rem 0 0;
  color: var(--text-muted);
  font-size: 0.875rem;
}

.hint--warning {
  color: var(--warning-700, #b45309);
}

.dossier-error {
  margin: 0.75rem 0 0;
  color: var(--danger);
  font-size: 0.875rem;
}

.patient-card { margin-top: 0.75rem; }

.patient-card :deep(.ui-card__header) {
  flex-wrap: wrap;
  align-items: center;
}

.patient-card :deep(.ui-card__actions) {
  width: 100%;
  margin-left: 0;
  justify-content: flex-end;
}

.patient-identity__name {
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 1rem;
  font-weight: 700;
}

.patient-identity__meta {
  margin: 0.15rem 0 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.8125rem;
  color: var(--text-muted);
}

.kind-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  margin-bottom: 1rem;
}

.kind-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.4rem 0.75rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: #fff;
  font-size: 0.8125rem;
  cursor: pointer;
  color: var(--text-muted);
}

.kind-chip--active {
  border-color: var(--primary-400);
  background: var(--primary-50);
  color: var(--primary-800);
  font-weight: 600;
}

.kind-chip__count {
  min-width: 1.25rem;
  padding: 0.05rem 0.35rem;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.06);
  font-size: 0.75rem;
}

.doc-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.doc-item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.85rem 1rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: #fff;
}

.doc-item__kind {
  display: inline-block;
  margin-bottom: 0.25rem;
  padding: 0.15rem 0.5rem;
  border-radius: 999px;
  font-size: 0.6875rem;
  font-weight: 700;
  background: var(--primary-50);
  color: var(--primary-800);
}

.doc-item__title {
  display: block;
  font-size: 0.9375rem;
  margin-bottom: 0.2rem;
}

.doc-item__meta {
  display: block;
  font-size: 0.8125rem;
  color: var(--text-muted);
}

.doc-item__actions {
  display: flex;
  flex-shrink: 0;
  gap: 0.25rem;
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background: rgba(15, 23, 42, 0.45);
}

.modal {
  width: min(100%, 28rem);
  padding: 1.25rem;
  border-radius: var(--radius-md, 12px);
  background: #fff;
}

.modal h3 {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0 0 1rem;
}

.file-field { display: block; margin-bottom: 1rem; }
.file-field__label { display: block; margin-bottom: 0.4rem; font-size: 0.8125rem; font-weight: 600; }
.error { color: #dc2626; font-size: 0.8125rem; }
.modal__actions { display: flex; justify-content: flex-end; gap: 0.5rem; }

@media (max-width: 900px) {
  .dossier-layout--with-sidebar {
    grid-template-columns: 1fr;
  }

  .dossier-sidebar { position: static; }
}
</style>
