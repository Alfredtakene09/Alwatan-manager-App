<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  FolderOpen,
  Search,
  Upload,
  Eye,
  Trash2,
  FileText,
  RefreshCw,
  UserRound,
  Plus,
  History,
  Paperclip,
} from '@lucide/vue'
import api from '@/api/client'
import { confirmAppModal } from '@/lib/api-modal-helper'
import { useAuthStore } from '@/stores/auth'
import { fullName, canWriteDossierDocuments } from '@/lib/roles'
import { matchesPatientSearch } from '@/lib/patient-search'
import { formatPatientAge, normalizePatientAgeUnit, type PatientAgeUnit } from '@/lib/patient-age'
import {
  PATIENT_DOCUMENT_KIND_LABELS,
  PATIENT_DOCUMENT_KINDS,
  formatDocumentDate,
  formatFileSize,
  type PatientDocumentKind,
} from '@/lib/patient-documents'
import PatientMedicalHistory, {
  type MedicalHistoryEntry,
} from '@/components/dossier/PatientMedicalHistory.vue'
import UiPageHeader from '@/components/ui/UiPageHeader.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import UiInput from '@/components/ui/UiInput.vue'

type PatientSummary = {
  id: string
  code: string
  firstName: string
  lastName: string
  age?: number | null
  ageUnit?: PatientAgeUnit | null
  phone?: string | null
  gender?: string | null
  category: string
  createdAt: string
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
}

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const canWriteDocuments = computed(() =>
  auth.user ? canWriteDossierDocuments(auth.user.role) : false,
)

const canDeleteDocuments = computed(
  () => dossier.value?.dataProtection?.canDeleteDocuments !== false,
)

const isMedecin = computed(() => auth.user?.role === 'MEDECIN')

const searchQuery = ref('')
const searchResults = ref<PatientSummary[]>([])
const searching = ref(false)
const selectedPatientId = ref<string | null>(null)

const dossier = ref<DossierResponse | null>(null)
const loadingDossier = ref(false)
const dossierError = ref('')
const activeTab = ref<'history' | 'files'>('history')
const activeKind = ref<PatientDocumentKind | 'ALL'>('ALL')

const medecinPatients = ref<MedecinPatientRow[]>([])
const loadingMedecinPatients = ref(false)
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

const historyCount = computed(() => dossier.value?.medicalHistory.length ?? 0)
const filesCount = computed(() => dossier.value?.documents.length ?? 0)

const filteredDocuments = computed(() => {
  if (!dossier.value) return []
  if (activeKind.value === 'ALL') return dossier.value.documents
  return dossier.value.documents.filter((doc) => doc.kind === activeKind.value)
})

const kindFilters = computed(() => {
  const counts = dossier.value?.countsByKind ?? {}
  const total = filesCount.value
  return [
    { value: 'ALL' as const, label: 'Tous', count: total },
    ...PATIENT_DOCUMENT_KINDS.map((kind) => ({
      value: kind,
      label: PATIENT_DOCUMENT_KIND_LABELS[kind],
      count: counts[kind] ?? 0,
    })),
  ]
})

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

async function loadDossier(patientId: string) {
  loadingDossier.value = true
  dossierError.value = ''
  try {
    const params = activeTab.value === 'files' && activeKind.value !== 'ALL' ? { kind: activeKind.value } : undefined
    const { data } = await api.get<DossierResponse>(`/patient-dossiers/${patientId}`, { params })
    dossier.value = data
    selectedPatientId.value = patientId
    activeTab.value = data.medicalHistory.length ? 'history' : 'files'
    router.replace({ query: { patient: patientId } })
  } catch {
    dossier.value = null
    dossierError.value = 'Impossible de charger le dossier patient.'
  } finally {
    loadingDossier.value = false
  }
}

function selectPatient(patient: PatientSummary) {
  searchQuery.value = `${patient.code} — ${fullName(patient.firstName, patient.lastName)}`
  searchResults.value = []
  activeKind.value = 'ALL'
  loadDossier(patient.id)
}

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  uploadForm.value.file = input.files?.[0] ?? null
}

async function submitUpload() {
  if (!selectedPatientId.value || !uploadForm.value.file) {
    uploadError.value = 'Veuillez sélectionner un fichier.'
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
    uploadError.value = 'Impossible d\'ajouter le document. Vérifiez le fichier (PDF, image, max 15 Mo).'
  } finally {
    uploading.value = false
  }
}

function openDocument(documentId: string) {
  if (!selectedPatientId.value) return
  window.open(`/api/patient-dossiers/${selectedPatientId.value}/documents/${documentId}/file`, '_blank')
}

async function deleteDocument(doc: PatientDocument) {
  if (!selectedPatientId.value || !canDeleteDocuments.value) return
  const confirmed = await confirmAppModal({
    type: 'DELETE',
    title: 'Supprimer le document',
    message: `Supprimer « ${doc.title} » du dossier ?`,
    confirmLabel: 'Supprimer',
  })
  if (!confirmed) return

  try {
    await api.delete(`/patient-dossiers/${selectedPatientId.value}/documents/${doc.id}`)
    await loadDossier(selectedPatientId.value)
  } catch {
    dossierError.value =
      'Impossible de supprimer ce document : le patient a déjà effectué un paiement.'
  }
}

watch(activeKind, () => {
  if (selectedPatientId.value && activeTab.value === 'files') {
    loadDossier(selectedPatientId.value)
  }
})

onMounted(async () => {
  await loadMedecinPatients()
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
      subtitle="Résultats validés par le laboratoire et fichiers attachés"
      :icon="FolderOpen"
    />

    <div class="dossier-layout" :class="{ 'dossier-layout--with-sidebar': isMedecin }">
      <aside v-if="isMedecin" class="dossier-sidebar">
        <UiCard
          title="Mes patients"
          description="Résultats enregistrés et validés par le labo"
          :icon="UserRound"
          icon-variant="teal"
        >
          <label class="sidebar-search">
            <Search :size="14" />
            <input v-model="sidebarQuery" type="search" placeholder="Filtrer…" />
          </label>

          <p v-if="loadingMedecinPatients" class="hint">Chargement…</p>
          <p v-else-if="!filteredMedecinPatients.length" class="hint">
            Aucun patient avec résultats validés par le laboratoire.
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
                  Validé le {{ new Date(row.lastVisitAt).toLocaleDateString('fr-FR') }}
                  · {{ row.labResultsCount }} formulaire(s)
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
                placeholder="Matricule, nom, prénom ou téléphone…"
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
            :description="`Matricule ${dossier.patient.code}${dossier.patient.phone ? ' · ' + dossier.patient.phone : ''}`"
            :icon="UserRound"
            icon-variant="teal"
          >
            <template #actions>
              <UiButton
                v-if="canWriteDocuments"
                variant="primary"
                size="sm"
                :icon="Plus"
                @click="showUpload = true"
              >
                Joindre un fichier
              </UiButton>
              <UiButton
                variant="ghost"
                size="sm"
                :icon="RefreshCw"
                :disabled="loadingDossier"
                @click="loadDossier(selectedPatientId!)"
              >
                Actualiser
              </UiButton>
            </template>

            <div class="summary-row">
              <span class="summary-chip">
                <History :size="14" />
                <strong>{{ historyCount }}</strong> visite(s)
              </span>
              <span class="summary-chip">
                <Paperclip :size="14" />
                <strong>{{ filesCount }}</strong> fichier(s)
              </span>
              <span v-if="dossier.patient.age != null" class="summary-chip">
                Âge : {{ formatPatientAge(dossier.patient.age, normalizePatientAgeUnit(dossier.patient.ageUnit)) }}
              </span>
            </div>
          </UiCard>

          <div class="tab-bar">
            <button
              type="button"
              class="tab-btn"
              :class="{ 'tab-btn--active': activeTab === 'history' }"
              @click="activeTab = 'history'"
            >
              <History :size="16" />
              Parcours labo
              <span class="tab-btn__count">{{ historyCount }}</span>
            </button>
            <button
              type="button"
              class="tab-btn"
              :class="{ 'tab-btn--active': activeTab === 'files' }"
              @click="activeTab = 'files'"
            >
              <Paperclip :size="16" />
              Fichiers attachés
              <span class="tab-btn__count">{{ filesCount }}</span>
            </button>
          </div>

          <UiCard v-if="activeTab === 'history'" title="Résultats validés (labo)" :icon="History" icon-variant="violet">
            <PatientMedicalHistory
              :entries="dossier.medicalHistory"
              :loading="loadingDossier"
              :show-open-lab-link="isMedecin"
              :empty-message="
                isMedecin
                  ? 'Aucun résultat validé par le laboratoire pour ce patient.'
                  : undefined
              "
            />
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

            <p v-if="loadingDossier" class="empty">Chargement…</p>
            <p v-else-if="!filteredDocuments.length" class="empty">
              Aucun fichier importé. Les résultats de laboratoire apparaissent dans l'onglet Parcours médical.
            </p>

            <p v-if="filteredDocuments.length && !canDeleteDocuments" class="hint hint--warning">
              Les documents ne peuvent pas être supprimés : ce patient a déjà effectué un paiement.
            </p>

            <ul v-if="filteredDocuments.length" class="doc-list">
              <li v-for="doc in filteredDocuments" :key="doc.id" class="doc-item">
                <div class="doc-item__main">
                  <span class="doc-item__kind">{{ PATIENT_DOCUMENT_KIND_LABELS[doc.kind] }}</span>
                  <strong class="doc-item__title">{{ doc.title }}</strong>
                  <span class="doc-item__meta">
                    {{ formatDocumentDate(doc.documentDate) }} · {{ formatFileSize(doc.fileSize) }}
                  </span>
                </div>
                <div class="doc-item__actions">
                  <UiButton variant="ghost" size="sm" :icon="Eye" @click="openDocument(doc.id)">
                    Voir
                  </UiButton>
                  <UiButton
                    v-if="canWriteDocuments && canDeleteDocuments"
                    variant="ghost"
                    size="sm"
                    :icon="Trash2"
                    @click="deleteDocument(doc)"
                  >
                    Supprimer
                  </UiButton>
                </div>
              </li>
            </ul>
          </UiCard>
        </template>

        <UiCard v-else-if="isMedecin && !loadingMedecinPatients" title="Sélectionnez un patient" :icon="UserRound">
          <p class="hint">
            Seuls les patients dont le laboratoire a enregistré et validé des résultats apparaissent ici.
          </p>
        </UiCard>
      </div>
    </div>

    <div v-if="showUpload" class="modal-backdrop" @click.self="showUpload = false">
      <div class="modal">
        <h3><Upload :size="18" /> Joindre un fichier</h3>
        <UiSelect v-model="uploadForm.kind" label="Type">
          <option v-for="kind in PATIENT_DOCUMENT_KINDS" :key="kind" :value="kind">
            {{ PATIENT_DOCUMENT_KIND_LABELS[kind] }}
          </option>
        </UiSelect>
        <UiInput v-model="uploadForm.title" label="Titre" placeholder="Ex. Radio thorax" />
        <UiInput v-model="uploadForm.documentDate" label="Date" type="date" required />
        <label class="file-field">
          <span class="file-field__label">Fichier (PDF, image — max 15 Mo)</span>
          <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx" @change="onFileChange" />
        </label>
        <p v-if="uploadError" class="error">{{ uploadError }}</p>
        <div class="modal__actions">
          <UiButton variant="ghost" @click="showUpload = false">Annuler</UiButton>
          <UiButton variant="primary" :icon="Upload" :disabled="uploading" @click="submitUpload">
            {{ uploading ? 'Envoi…' : 'Enregistrer' }}
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
