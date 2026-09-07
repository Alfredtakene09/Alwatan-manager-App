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
} from '@lucide/vue'
import api from '@/api/client'
import { confirmAppModal, showApiErrorModal } from '@/lib/api-modal-helper'
import { useAuthStore } from '@/stores/auth'
import { fullName, canWriteDossierDocuments, isDirectionOrGestionnaire } from '@/lib/roles'
import { matchesPatientSearch } from '@/lib/patient-search'
import { normalizePatientAgeUnit, type PatientAgeUnit } from '@/lib/patient-age'
import { patientCategoryLabel, type PatientCategory } from '@/lib/patient-category'
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

type DirectionPatientRow = {
  patient: PatientSummary
  lastVisitAt: string
  doctorName: string | null
  visitCount: number
  labResultsCount: number
  hasComment: boolean
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
const showPatientSidebar = computed(() => isMedecin.value || isManagementDossier.value)

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
const managementPatients = ref<DirectionPatientRow[]>([])
const loadingMedecinPatients = ref(false)
const loadingManagementPatients = ref(false)
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

const canReconsult = computed(
  () => isMedecin.value && !!dossier.value?.reconsult?.canReconsult,
)

const latestClinicalSummary = computed(() => {
  const entry = dossier.value?.medicalHistory[0]
  if (!entry) return null
  return entry.diagnosis?.trim() || entry.doctorComment?.trim() || null
})

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

const filteredManagementPatients = computed(() => {
  const q = sidebarQuery.value.trim()
  if (!q) return managementPatients.value
  return managementPatients.value.filter((row) =>
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

const loadingSidebarPatients = computed(() =>
  isMedecin.value ? loadingMedecinPatients.value : loadingManagementPatients.value,
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
  const parts = [translateTemplate('Matricule {code}', { code: patient.code })]
  if (patient.phone) parts.push(patient.phone)
  if (patient.gender === 'F') parts.push(uiText('Féminin'))
  else if (patient.gender === 'M') parts.push(uiText('Masculin'))
  else if (patient.gender) parts.push(patient.gender)
  if (patient.category && patient.category !== 'STANDARD') {
    parts.push(uiText(patientCategoryLabel(patient.category as PatientCategory)))
  }
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

async function loadManagementPatients() {
  if (!isManagementDossier.value) return
  loadingManagementPatients.value = true
  try {
    const { data } = await api.get<DirectionPatientRow[]>('/patient-dossiers/direction/patients')
    managementPatients.value = data
  } catch {
    managementPatients.value = []
  } finally {
    loadingManagementPatients.value = false
  }
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

function selectPatient(patient: PatientSummary) {
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
  if (!isAdmin.value || !dossier.value) return
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
    await Promise.all([loadMedecinPatients(), loadManagementPatients()])
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
  await Promise.all([loadMedecinPatients(), loadManagementPatients()])
  const patientId = route.query.patient as string | undefined
  if (patientId) {
    await loadDossier(patientId)
    if (dossier.value) {
      searchQuery.value = `${dossier.value.patient.code} — ${fullName(dossier.value.patient.firstName, dossier.value.patient.lastName)}`
    }
  } else if (isMedecin.value && medecinPatients.value[0]) {
    selectPatient(medecinPatients.value[0].patient)
  } else if (isManagementDossier.value && managementPatients.value[0]) {
    selectPatient(managementPatients.value[0].patient)
  }
})
</script>

<template>
  <div class="dossier-page">
    <UiPageHeader
      title="Dossier patient"
      :subtitle="
        isManagementDossier
          ? uiText('Patients consultés par les médecins — historique clinique complet')
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

      <aside v-else-if="isManagementDossier" class="dossier-sidebar">
        <UiCard
          :title="uiText('Patients consultés')"
          :description="uiText('Dossiers enregistrés par les médecins')"
          :icon="UserRound"
          icon-variant="teal"
        >
          <label class="sidebar-search">
            <Search :size="14" />
            <input v-model="sidebarQuery" type="search" :placeholder="uiText('Filtrer la liste…')" />
          </label>

          <p v-if="loadingManagementPatients" class="hint">{{ uiText('Chargement…') }}</p>
          <p v-else-if="!filteredManagementPatients.length" class="hint">
            {{ uiText('Aucun dossier médical pour le moment.') }}
          </p>

          <ul v-else class="patient-list">
            <li v-for="row in filteredManagementPatients" :key="row.patient.id">
              <button
                type="button"
                class="patient-list__item"
                :class="{ 'patient-list__item--active': selectedPatientId === row.patient.id }"
                @click="selectPatient(row.patient)"
              >
                <strong>{{ row.patient.code }}</strong>
                <span>{{ fullName(row.patient.firstName, row.patient.lastName) }}</span>
                <span class="patient-list__meta">
                  {{ row.doctorName || uiText('Médecin') }}
                  · {{ formatValidatedMeta(row.lastVisitAt, row.labResultsCount, row.hasComment) }}
                </span>
              </button>
            </li>
          </ul>
        </UiCard>
      </aside>

      <div class="dossier-main">
        <UiCard v-if="!isMedecin" title="Rechercher un patient" :icon="Search" icon-variant="blue">
          <div class="search-block">
            <label class="search-field">
              <Search :size="16" />
              <input
                v-model="searchQuery"
                type="search"
                :placeholder="uiText('Matricule, nom, prénom ou téléphone…')"
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
          <UiCard
            class="patient-card"
            :title="fullName(dossier.patient.firstName, dossier.patient.lastName)"
            :description="patientCardDescription(dossier.patient)"
            :icon="UserRound"
            icon-variant="teal"
          >
            <template #actions>
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
                    ? uiText('Continuer la consultation')
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
                :disabled="!dossier.medicalHistory.length"
                @click="exportDossier(false)"
              >
                {{ uiText('Exporter PDF') }}
              </UiButton>
              <UiButton
                v-if="canWriteDocuments"
                variant="ghost"
                size="sm"
                :icon="Plus"
                ui-action="dossier.attach"
                @click="showUpload = true"
              >
                {{ uiText('Joindre un fichier') }}
              </UiButton>
              <UiButton
                v-if="isAdmin"
                variant="danger"
                size="sm"
                :icon="Trash2"
                :disabled="deletingPatient"
                :loading="deletingPatient"
                @click="deletePatientDossier"
              >
                {{ uiText('Supprimer le patient') }}
              </UiButton>
              <UiButton
                variant="ghost"
                size="sm"
                :icon="RefreshCw"
                :disabled="loadingDossier"
                @click="preserveTabOnReload = true; loadDossier(selectedPatientId!)"
              >
                {{ uiText('Actualiser') }}
              </UiButton>
            </template>

            <div class="summary-row">
              <span class="summary-chip">
                <History :size="14" />
                <strong>{{ historyCount }}</strong>
                {{ uiText('visite(s)') }}
              </span>
              <span class="summary-chip">
                <Paperclip :size="14" />
                <strong>{{ filesCount }}</strong>
                {{ uiText('fichier(s)') }}
              </span>
              <span v-if="dossier.patient.age != null" class="summary-chip">
                {{ patientAgeLabel(dossier.patient.age, dossier.patient.ageUnit) }}
              </span>
              <span v-if="dossier.patient.address" class="summary-chip">
                {{ dossier.patient.address }}
              </span>
              <span v-if="dossier.patient.treatingDoctor" class="summary-chip">
                {{
                  translateTemplate('Dr {name}', {
                    name: fullName(
                      dossier.patient.treatingDoctor.firstName,
                      dossier.patient.treatingDoctor.lastName,
                    ),
                  })
                }}
              </span>
              <span v-if="dossier.patient.createdBy" class="summary-chip">
                {{
                  translateTemplate('Enregistré par {name}', {
                    name: fullName(dossier.patient.createdBy.firstName, dossier.patient.createdBy.lastName),
                  })
                }}
              </span>
            </div>
            <p v-if="latestClinicalSummary" class="latest-clinical">
              <strong>{{ uiText('Dernière note') }} :</strong>
              {{ latestClinicalSummary }}
            </p>
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
              :empty-message="
                isMedecin
                  ? uiText('Aucune consultation, ordonnance ou examen enregistré pour ce patient.')
                  : undefined
              "
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
          <p class="hint">
            {{
              isMedecin
                ? uiText(
                    'Seuls les patients dont le laboratoire a enregistré et validé des résultats apparaissent ici.',
                  )
                : uiText(
                    'Choisissez un patient dans la liste ou recherchez par matricule, nom ou téléphone.',
                  )
            }}
          </p>
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
  </div>
</template>

<style scoped>
.dossier-layout {
  display: block;
}

.dossier-layout--with-sidebar {
  display: grid;
  grid-template-columns: minmax(240px, 280px) minmax(0, 1fr);
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

.patient-card { margin-top: 1rem; }

.latest-clinical {
  margin: 0.85rem 0 0;
  padding: 0.7rem 0.85rem;
  border-radius: 10px;
  background: rgba(124, 58, 237, 0.06);
  border: 1px solid rgba(124, 58, 237, 0.12);
  font-size: 0.875rem;
  line-height: 1.45;
  color: var(--text);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.latest-clinical strong {
  color: #6d28d9;
}

.summary-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.summary-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.35rem 0.7rem;
  border-radius: 999px;
  font-size: 0.8125rem;
  background: var(--bg-muted, #f8fafc);
  border: 1px solid var(--border);
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
